/**
 * Клиентский бот + уведомления + точка входа админки.
 *
 * Всё, что нужно боту, берётся из окружения BOT_TOKEN + ADMIN_IDS:
 * username определяется из getMe, публичный URL — из env или из Host
 * первого запроса к витрине (см. notePublicUrl в config.js).
 */
import { Bot, InlineKeyboard } from 'grammy';
import { config, onPublicUrlChange } from '../config.js';
import { on } from '../events.js';
import { getCategories, publicProducts, getBrand, findProduct } from '../catalog.js';
import { userOrders, getOrder } from '../orders.js';
import { addAdminMessage } from '../support.js';
import { db } from '../store.js';
import { money, productLine, orderText } from './format.js';
import { registerAdmin, isAdmin } from './admin.js';

/** Кнопка Mini App: появляется, как только публичный URL стал известен. */
const webAppUrl = () => {
  const u = config.publicUrl;
  return u && u.startsWith('https://') ? u : null;
};

export async function startBot() {
  const bot = new Bot(config.telegram.token);

  // ── username: если BOT_USERNAME не задан, подхватываем из getMe ──
  // Таймаут 20 с: grammy ретраит getMe, и при мёртвой сети не будем висеть
  // вечно — веб-часть уже работает, бот подхватится при перезапуске.
  let me;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20_000);
    me = await bot.init(ctrl.signal);
    clearTimeout(to);
  } catch (err) {
    console.error(`[bot] getMe не удался (токен недействителен или нет сети): ${err.message} — веб-витрина продолжает работать`);
    return null;
  }
  if (me?.username) config.telegram.username = me.username;
  console.log(`[bot] @${me.username} · режим: ${config.telegram.mode}${config.publicUrl ? ` · URL: ${config.publicUrl}` : ' · URL появится из запросов к витрине'}`);

  // ── кнопка меню (слева от поля ввода) → Mini App ──
  // Устанавливается, когда URL уже известен; при lazy-детекте URL — сразу
  // после первого публичного запроса к сайту.
  const syncMenuButton = () => {
    const url = webAppUrl();
    if (!url) return;
    bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Cocktail Embassy', web_app: { url } },
    })
      .catch((err) => console.warn('[bot] не удалось поставить menu button:', err.message));
  };
  syncMenuButton();
  onPublicUrlChange(syncMenuButton);

  const startMsg = async (ctx) => {
    const brand = getBrand();
    const kb = new InlineKeyboard();
    const url = webAppUrl();
    if (url) kb.webApp('🥂 Open the store', url).row();
    kb.text('🍸 Collections', 'cat:root').text('📦 My orders', 'my:orders').row();
    kb.text('💬 Support', 'my:support');
    let extra = '';
    if (!url) {
      extra = config.telegram.username
        ? `\n\nStore URL is being configured — try again in a minute, or open the mini app from the menu button (left of the input).`
        : '\n\n⚠️ Store URL is not configured yet: set PUBLIC_URL in the hosting environment.';
    }
    const isAdminNote = isAdmin(ctx.from?.id) ? '\n\n/admin — панель управления.' : '';
    await ctx.reply(
      `<b>${brand.name}</b> — ${brand.tagline}.\n\n`
      + `${brand.subtitle || ''}\n\n`
      + `Catalog, cart and order tracking live in the mini app — it opens right inside Telegram.${extra}${isAdminNote}`,
      { parse_mode: 'HTML', reply_markup: kb },
    );
  };
  bot.command('start', startMsg);

  bot.command('catalog', async (ctx) => {
    const kb = new InlineKeyboard();
    const cats = getCategories();
    cats.forEach((c, i) => {
      kb.text(c.title, `cat:${c.id}`);
      if (i % 2 === 1) kb.row();
    });
    await ctx.reply('Choose a collection:', { reply_markup: kb });
  });

  bot.command('orders', async (ctx) => {
    const orders = userOrders(ctx.from.id);
    if (!orders.length) return ctx.reply('Пока нет заказов — откройте магазин кнопкой слева от поля ввода.');
    const kb = new InlineKeyboard();
    for (const o of orders.slice(0, 8)) kb.text(`${o.id} · ${o.status} · ${money(o.totals.totalAed)}`, `my:order:${o.id}`).row();
    await ctx.reply('Ваши заказы:', { reply_markup: kb });
  });

  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCallbackQuery();
    if (id === 'root') {
      const kb = new InlineKeyboard();
      getCategories().forEach((c, i) => {
        kb.text(c.title, `cat:${c.id}`);
        if (i % 2 === 1) kb.row();
      });
      return ctx.editMessageText('Choose a collection:', { reply_markup: kb });
    }
    const items = publicProducts().filter((p) => p.collection === id);
    const kb = new InlineKeyboard();
    items.forEach((p, i) => {
      kb.text(p.name, `catp:${p.id}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text('← Back', 'cat:root');
    await ctx.editMessageText(`Collection items:`, { reply_markup: kb });
  });

  bot.callbackQuery(/^catp:(.+)$/, async (ctx) => {
    const p = findProduct(ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!p) return;
    const url = webAppUrl();
    const kb = new InlineKeyboard();
    if (url) kb.webApp('🛒 Open in store', url);
    await ctx.reply(
      `<b>${p.name}</b>\n${productLine(p)}\n<i>${p.description || ''}</i>`,
      { parse_mode: 'HTML', reply_markup: kb },
    );
  });

  bot.callbackQuery(/^my:order:(.+)$/, async (ctx) => {
    const o = getOrder(ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!o || o.userId !== ctx.from.id) return;
    const url = webAppUrl();
    const kb = new InlineKeyboard();
    if (url) kb.webApp('Open order status', url);
    await ctx.reply(orderText(o, { full: true }), { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.callbackQuery(/^my:(orders|support)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const url = webAppUrl();
    if (url) {
      const kb = new InlineKeyboard().webApp(ctx.match[1] === 'support' ? '💬 Open support chat' : '📦 Open orders', url);
      return ctx.reply('Это удобнее сделать в мини-приложении:', { reply_markup: kb });
    }
    return ctx.reply('Мини-приложение пока недоступно: публичный URL ещё не задан.');
  });

  // ─── события сервера → уведомления ───────────────────────────
  const notifyAdmins = (text, kb) => {
    for (const id of config.telegram.adminIds) {
      bot.api.sendMessage(id, text, { parse_mode: 'HTML', reply_markup: kb }).catch((err) => {
        console.warn(`[bot] не отправить уведомление админу ${id}:`, err.message);
      });
    }
  };

  on('order:new', (o) => {
    const kb = new InlineKeyboard().text('📦 Open order', `adm:o:${o.id}`);
    notifyAdmins(` <b>Новый заказ ${o.id}</b>\n${orderText(o)}`, kb);
    if (o.userId > 0) {
      bot.api.sendMessage(o.userId,
        `Спасибо! Заказ <b>${o.id}</b> принят.\nСтатусы можно следить в мини-приложении или командой /orders.`,
        { parse_mode: 'HTML' }).catch(() => {});
    }
  });

  on('order:status', (o) => {
    if (o.userId > 0) {
      bot.api.sendMessage(o.userId,
        `Заказ <b>${o.id}</b>: статус изменён на <b>${o.status}</b>.`, { parse_mode: 'HTML' }).catch(() => {});
    }
  });

  on('support:user', ({ userId, message }) => {
    // #userId в тексте: админ может ответить простым reply на это сообщение —
    // бот допустит ответ в чат поддержки без захода в /admin.
    const kb = new InlineKeyboard().text('💬 Open dialog', `adm:sup:${userId}`);
    notifyAdmins(`💬 <b>Поддержка #${userId}</b> · ${message.userName}\n${escapeHtml(message.text)}`, kb);
  });

  // ответ админа обычным reply на уведомление «Поддержка #<id>»
  bot.on('message', async (ctx, next) => {
    const reply = ctx.message?.reply_to_message;
    const m = reply?.text?.match(/#(−?\d+|-?\d+)/);
    if (m && isAdmin(ctx.from.id) && ctx.message.text) {
      const userId = Number(m[1]);
      addAdminMessage(userId, ctx.message.text);
      return ctx.reply(`Отправлено пользователю ${userId}.`);
    }
    return next();
  });

  registerAdmin(bot);

  // polling: обычный режим (по умолчанию — работает без публичного URL).
  // Webhook-режим: роут /webhook/telegram и setWebhook делает index.js.
  if (config.telegram.mode !== 'webhook') {
    bot.start();
  }
  return bot;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
