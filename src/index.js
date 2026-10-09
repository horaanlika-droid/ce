/**
 * Точка входа: один процесс поднимает и витрину, и бота (MODE=all|web|bot).
 *
 * Под Bothost (и подобные платформы) настроен так, что в переменных
 * окружения достаточно BOT_TOKEN и ADMIN_IDS:
 *  - порт: из PORT, если хостинг его задаёт; иначе слушаем 80/3000/8080;
 *  - публичный URL: из PUBLIC_URL/DOMAIN или из Host первого запроса;
 *  - username бота: из BOT_USERNAME или сам из getMe;
 *  - режим Telegram: polling по умолчанию — вебхук не обязателен.
 *
 * Главное правило: приложение не должно «тихо умереть». Если ни один порт не
 * поднялся и бот не стартовал, процесс остаётся жить и пишет внятную сводку —
 * иначе хостинг видит упавший контейнер и перезапускает его по кругу,
 * заполняя логи одним и тем же стектрейсом.
 */
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { createServer } from './server.js';
import { selfHeal, catalogStatus } from './catalog.js';

selfHeal();

const HINT = {
  EADDRINUSE: 'порт уже занят другим процессом в контейнере (проверьте команду запуска: приложение могло стартовать дважды, либо порт держит сторонний сервер)',
  EACCES: 'нет прав на этот порт (нужен root или порт > 1024)',
  EADDRNOTAVAIL: 'адрес недоступен в этом контейнере',
};

/** Не дать процессу завершиться, когда слушать нечего (защита от crash-loop). */
function keepAlive(reason) {
  console.error(`[boot] процесс остаётся жить (${reason}) — перезапуск контейнера проблему не решит, смотрите строки выше`);
  setInterval(() => {}, 60_000);
}

/**
 * Слушаем все порты из config.webPorts. Отказ одного (EACCES на 80 без прав,
 * EADDRINUSE, если порт занят) не роняет процесс — работаем на остальных.
 * Возвращает { bound: [port], failed: [{ port, code, message }] }.
 */
function listenAll(app) {
  return Promise.all(config.webPorts.map((port) => new Promise((resolve) => {
    const server = app.listen(port, config.host);
    server.once('listening', () => resolve({ port, ok: true }));
    server.once('error', (err) => resolve({ port, ok: false, code: err.code || '', message: err.message }));
  }))).then((results) => ({
    bound: results.filter((r) => r.ok).map((r) => r.port),
    failed: results.filter((r) => !r.ok),
  }));
}

let app = null;
let web = null;

if (config.mode !== 'bot') {
  app = createServer();
  web = await listenAll(app);

  for (const f of web.failed) {
    console.warn(`[web] порт ${f.port}: ${f.code || f.message}${HINT[f.code] ? ` — ${HINT[f.code]}` : ''}`);
  }
  if (web.bound.length) {
    console.log(`[web] Mini App on ${web.bound.map((p) => `http://${config.host}:${p}`).join(', ')}`);
  } else {
    console.error(
      `[web] ни один порт не поднялся (${config.webPorts.join(', ')}).\n`
      + '  Задайте PORT тем значением, которое проксирует хостинг, либо освободите занятый порт.',
    );
  }
  console.log(`[web] data dir: ${config.dataDir}`);
}

let bot = null;

if (config.mode !== 'web' && config.telegram.hasBot) {
  const { startBot } = await import('./bot/index.js');
  bot = await startBot().catch((err) => {
    console.error('[bot] ошибка запуска:', err);
    return null;
  });

  if (bot && config.telegram.mode === 'webhook') {
    if (config.publicUrl) {
      // Вебхук на том же express, что и витрина (или на своём, если MODE=bot).
      const express = (await import('express')).default;
      const hookApp = app || express();
      if (!app) {
        const extra = await listenAll(hookApp);
        for (const f of extra.failed) console.warn(`[web] порт ${f.port}: ${f.code || f.message}`);
      }
      hookApp.post('/webhook/telegram', webhookCallback(bot, 'express', {
        secretToken: config.telegram.webhookSecret || undefined,
        onTimeout: 'ignore',
      }));
      const url = `${config.publicUrl}/webhook/telegram`;
      bot.api.setWebhook(url, {
        secret_token: config.telegram.webhookSecret || undefined,
        allowed_updates: ['message', 'callback_query', 'edited_message'],
      }).then(() => console.log(`[bot] webhook установлен: ${url}`))
        .catch((err) => console.error('[bot] не удалось установить webhook:', err.message));
    } else {
      console.warn('[bot] TELEGRAM_MODE=webhook, но публичный URL пока неизвестен — работаем в polling. Задайте PUBLIC_URL, чтобы включить webhook.');
      bot.start({ onStart: (me) => console.log(`[bot] запущен @${me.username} (polling, ждём URL для webhook)`) });
    }
  } else if (bot) {
    bot.start({ onStart: (me) => console.log(`[bot] запущен @${me.username} (polling)`) });
  }
} else if (config.mode !== 'web') {
  console.log('[bot] BOT_TOKEN не задан — работаем только как сайт (гостевой режим)');
}

// ── итоговая сводка: одна строка, по которой видно, что реально поднялось ──
const cat = catalogStatus();
console.log(
  '[boot] '
  + `mode=${config.mode}`
  + ` · web=${web ? (web.bound.length ? `ok:${web.bound.join(',')}` : 'НЕТ ПОРТА') : 'off'}`
  + ` · bot=${bot ? `ok${config.telegram.username ? `:@${config.telegram.username}` : ''}` : 'НЕ ЗАПУЩЕН'}`
  + ` · каталог=${cat.ok ? `${cat.products} поз. из ${cat.file}` : 'НЕ ЗАГРУЖЕН'}`,
);

// Ни витрины, ни бота — жить дальше, а не падать и не плодить рестарты.
if (config.mode !== 'bot' && web && web.bound.length === 0 && !bot) {
  keepAlive('не поднялся ни веб-порт, ни бот');
} else if (config.mode === 'bot' && !bot) {
  keepAlive('MODE=bot, но бот не стартовал');
}
