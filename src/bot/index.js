/**
 * Клиентский бот + уведомления + точка входа админки.
 */
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { config } from '../config.js';
import { on } from '../events.js';
import { getCategories, publicProducts, getBrand, findProduct } from '../catalog.js';
import { userOrders, getOrder } from '../orders.js';
import { addAdminMessage, getThread, listThreads, markAdminRead } from '../support.js';
import { db } from '../store.js';
import { money, productLine, orderText } from './format.js';
import { registerAdmin, isAdmin } from './admin.js';

export async function startBot() {
  const bot = new Bot(config.telegram.token);
  const appUrl = config.publicUrl;

  const webAppButton = appUrl ? { web_app: { url: appUrl } } : undefined;

  // кнопка меню слева от поля ввода → сразу Mini App
  try {
    if (appUrl?.startsWith('https://')) {
      await bot.api.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Cocktail Embassy', ...webAppButton } });
    }
  } catch (err) {
    console.warn('[bot] не удалось поставить menu button:', err.message);
  }

  bot.command('start', async (ctx) => {
    const brand = getBrand();
    const kb = new InlineKeyboard();
    if (webAppButton) kb.webApp('🥂 Open the store', webAppButton.web_app).row();
    kb.callback('🍸 Collections', 'cat:root').callback('📦 My orders', 'my:orders').row();
    kb.callback('💬 Support', 'my:support');
    await ctx.reply(
      `<b>${brand.name}</b> — ${brand.tagline}.\n\n`
      + `${brand.subtitle || ''}\n\n`
      + `Catalog, cart and order tracking live in the mini app — it opens right inside Telegram.`,
      { parse_mode: 'HTML', reply_markup: kb },
    );
  });

  bot.command('catalog', async (ctx) => {
    const kb = new InlineKeyboard();
    for (const c of getCategories()) {
      kb.callback(c.title, `cat:${c.id}`);
      if (getCategories().indexOf(c) % 2 === 1) kb.row();
    }
    await ctx.reply('Choose a collection:', { reply_markup: kb });
  });

  bot.command('orders', async (ctx) => {
    const orders = userOrders(ctx.from.id);
    if (!orders.length) return ctx.reply('Пока нет заказов — откройте магазин кнопкой слева от поля ввода.');
    const kb = new InlineKeyboard();
    for (const o of orders.slice(0, 8)) kb.callback(`${o.id} · ${o.status} · ${money(o.totals.totalAed)}`, `my:order:${o.id}`).row();
    await ctx.reply('Ваши заказы:', { reply_markup: kb });
  });


  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCallbackQuery();
    if (id === 'root') {
      const kb = new InlineKeyboard();
      getCategories().forEach((c, i) => {
        kb.callback(c.title, `cat:${c.id}`);
        if (i % 2 === 1) kb.row();
      });
      return ctx.editMessageText('Choose a collection:', { reply_markup: kb });
    }
    const items = publicProducts().filter((p) => p.collection === id);
    const kb = new InlineKeyboard();
    items.forEach((p, i) => {
      kb.callback(p.name, `catp:${p.id}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().callback('← Back', 'cat:root');
    await ctx.editMessageText(`Collection items:`, { reply_markup: kb });
  });

  bot.callbackQuery(/^catp:(.+)$/, async (ctx) => {
    const p = findProduct(ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!p) return;
    const kb = new InlineKeyboard();
    if (webAppButton) kb.webApp('🛒 Open in store', webAppButton.web_app);
    await ctx.reply(
      `<b>${p.name}</b>\n${productLine(p)}\n<i>${p.description || ''}</i>`,
      { parse_mode: 'HTML', reply_markup: kb },
    );
  });

  bot.callbackQuery(/^my:order:(.+)$/, async (ctx) => {
    const o = getOrder(ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!o || o.userId !== ctx.from.id) return;
    const kb = new InlineKeyboard();
    if (webAppButton) kb.webApp('Open order status', webAppButton.web_app);
    await ctx.reply(orderText(o, { full: true }), { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.callbackQuery(/^my:(orders|support)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (webAppButton) {
      const kb = new InlineKeyboard().webApp(ctx.match[1] === 'support' ? '💬 Open support chat' : '📦 Open orders', webAppButton.web_app);
      return ctx.reply('Это удобнее сделать в мини-приложении:', { reply_markup: kb });
    }
    return ctx.reply('Мини-приложение недоступно: не задан PUBLIC_URL.');
  });

  // ─── события сервера → уведомления ───────────────────────────
  const notifyAdmins = (text, kb) => {
    for (const id of config.telegram.adminIds) {
      bot.api.sendMessage(id, text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
    }
  };

  on('order:new', (o) => {
    const kb = new InlineKeyboard().callback('📦 Open order', `adm:order:${o.id}`);
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
    const kb = new InlineKeyboard().callback('💬 Open dialog', `adm:sup:${userId}`);
    notifyAdmins(`💬 <b>Поддержка:</b> ${message.userName}\n${message.text}`, kb);
  });

  // ответ админа обычным reply на пересланное сообщение поддержки
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

  if (config.telegram.mode === 'webhook' && config.publicUrl) {
    await bot.init();
    await bot.api.setWebhook(`${config.publicUrl}/webhook/telegram`, {
      secret_token: config.telegram.webhookSecret || undefined,
    });
    console.log('[bot] webhook установлен');
  } else {
    bot.start({ onStart: (me) => console.log(`[bot] запущен @${me.username} (polling)`) });
  }
  return bot;
}
