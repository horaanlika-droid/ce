/**
 * Точка входа: один процесс поднимает и витрину, и бота (MODE=all|web|bot).
 *
 * Под Bothost (и подобные платформы) настроен так, что в переменных
 * окружения достаточно BOT_TOKEN и ADMIN_IDS:
 *  - порт: из PORT, если хостинг его задаёт; иначе слушаем 80/3000/8080;
 *  - публичный URL: из PUBLIC_URL/DOMAIN или из Host первого запроса;
 *  - username бота: из BOT_USERNAME или сам из getMe;
 *  - режим Telegram: polling по умолчанию — вебхук не обязателен.
 */
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { createServer } from './server.js';
import { selfHeal } from './catalog.js';

selfHeal();

let app = null;

if (config.mode !== 'bot') {
  app = createServer();
  for (const port of config.webPorts) {
    const server = app.listen(port, config.host, () => {
      if (port === config.webPorts[0]) {
        console.log(`[web] Mini App on ${config.webPorts.map((p) => `http://${config.host}:${p}`).join(', ')}`);
      }
    });
    // Один мёртвый порт (EACCES на 80 без прав, EADDRINUSE) не роняет процесс.
    server.on('error', (err) => {
      console.warn(`[web] порт ${port}: ${err.code || err.message}`);
    });
  }
  console.log(`[web] data dir: ${config.dataDir}`);
}

if (config.mode !== 'web' && config.telegram.hasBot) {
  const { startBot } = await import('./bot/index.js');
  const bot = await startBot().catch((err) => {
    console.error('[bot] ошибка запуска:', err);
    return null;
  });

  if (bot && config.telegram.mode === 'webhook') {
    if (config.publicUrl) {
      // Вебхук на том же express, что и витрина (или на своём, если MODE=bot).
      const express = (await import('express')).default;
      const hookApp = app || express();
      if (!app) {
        for (const port of config.webPorts) {
          const s = hookApp.listen(port, config.host, () => {});
          s.on('error', (err) => console.warn(`[web] порт ${port}: ${err.code || err.message}`));
        }
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
