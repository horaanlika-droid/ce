/**
 * Админ-панель в боте: заказы, поддержка, каталог, магазин, статистика, рассылка.
 * Доступна только ID из ADMIN_IDS.
 */
import { InlineKeyboard } from 'grammy';
import { config, isAdmin } from '../config.js';
import { db, save, userTitle } from '../store.js';
import {
  allProducts, publicProducts, findProduct, getCategories, getBrand, getShopSettings,
} from '../catalog.js';
import { getOrder, ORDER_STATUSES } from '../orders.js';
import { listThreads, addAdminMessage, markAdminRead } from '../support.js';
import { money, productLine, orderText } from './format.js';

const wait = new Map(); // userId -> { type, id }

export { isAdmin };

export function registerAdmin(bot) {
  const guard = (ctx, next) => (isAdmin(ctx.from?.id) ? next() : Promise.resolve());

  bot.command('admin', guard, async (ctx) => menu(ctx));

  bot.callbackQuery(/^adm:/, guard, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, action, a, b] = ctx.callbackQuery.data.split(':');
    const id = ctx.from.id;

    // ── меню ──
    if (action === 'menu') return menu(ctx);

    // ── заказы ──
    if (action === 'orders') return ordersList(ctx, a || 'active');
    if (action === 'order') return orderCard(ctx, a);
    if (action === 'status') {
      const o = getOrder(a);
      if (o) {
        const { updateOrder } = await import('../orders.js');
        updateOrder(o.id, { status: b }, 'admin');
      }
      return orderCard(ctx, a);
    }

    // ── поддержка ─
    if (action === 'sup' && a === 'list') return supList(ctx);
    if (action === 'sup') return supThread(ctx, a);
    if (action === 'supwait') {
      wait.set(id, { type: 'support', id: a });
      return ctx.reply('Напишите ответ — я отправлю его в чат поддержки.');
    }

    // ── каталог ──
    if (action === 'cat' && a === 'root') return catRoot(ctx);
    if (action === 'cat') return catList(ctx, a);
    if (action === 'p') return productCard(ctx, a);
    if (action === 'pact') {
      const p = findProduct(b);
      if (!p) return;
      const o = db.overrides[p.id] || (db.overrides[p.id] = {});
      if (a === 'hide') o.hidden = !p.hidden;
      if (a === 'stock') o.outOfStock = !p.outOfStock;
      if (a === 'price') {
        wait.set(id, { type: 'price', id: p.id });
        return ctx.reply(`Текущая цена ${money(p.priceAed)}. Введите новую (AED):`);
      }
      if (a === 'del') {
        db.deletedProducts = db.deletedProducts || [];
        if (!db.deletedProducts.includes(p.id)) db.deletedProducts.push(p.id);
      }
      if (a === 'restore') {
        db.deletedProducts = (db.deletedProducts || []).filter((x) => x !== p.id);
        delete db.overrides[p.id]?.hidden;
      }
      save();
      return productCard(ctx, p.id);
    }

    // ── магазин ──
    if (action === 'shop') return shopCard(ctx);
    if (action === 'shopedit') {
      wait.set(id, { type: `shop:${a}` });
      const hints = {
        tagline: 'Текущий: ' + getBrand().tagline,
        whatsapp: 'Текущий: ' + getBrand().whatsapp,
        instagram: 'Текущий: ' + getBrand().instagram,
        free: 'Порог бесплатной доставки (AED): ' + getShopSettings().freeShippingFrom,
        ship: 'Стоимость доставки (AED): ' + getShopSettings().shippingCost,
        delivery: 'Текущий текст: ' + (db.shopInfo.delivery?.note || '—'),
      };
      return ctx.reply(hints[a] || 'Введите значение:');
    }

    // ── статистика и рассылка ──
    if (action === 'stats') return stats(ctx);
    if (action === 'mail') {
      wait.set(id, { type: 'mail' });
      return ctx.reply('Напишите текст рассылки — отправлю всем пользователям.');
    }

    return menu(ctx);
  });

  // ввод значений админом
  bot.on('message:text', guard, async (ctx, next) => {
    const w = wait.get(ctx.from.id);
    if (!w) return next();
    if (ctx.message.text.startsWith('/')) return next();
    wait.delete(ctx.from.id);
    const text = ctx.message.text.trim();

    if (w.type === 'price') {
      const v = Number(text.replace(',', '.'));
      if (!Number.isFinite(v) || v < 0) return ctx.reply('Не похоже на число.');
      const o = db.overrides[w.id] || (db.overrides[w.id] = {});
      o.priceAed = v;
      o.priceUsd = Math.round((v / 3.6725) * 10) / 10;
      save();
      return ctx.reply(`✅ Цена ${w.id}: ${money(v)} (≈ USD ${o.priceUsd}).`);
    }

    if (w.type === 'support') {
      addAdminMessage(Number(w.id), text);
      return ctx.reply(`✅ Отправлено пользователю ${w.id}.`);
    }

    if (w.type.startsWith('shop:')) {
      const key = w.type.slice(5);
      const brand = db.shopInfo.brand || (db.shopInfo.brand = {});
      const shop = db.shopInfo.shop || (db.shopInfo.shop = {});
      const del = db.shopInfo.delivery || (db.shopInfo.delivery = {});
      if (key === 'tagline') brand.tagline = text;
      if (key === 'whatsapp') brand.whatsapp = text;
      if (key === 'instagram') brand.instagram = text.replace('@', '');
      if (key === 'free') shop.freeShippingFrom = Number(text) || shop.freeShippingFrom;
      if (key === 'ship') shop.shippingCost = Number(text) || shop.shippingCost;
      if (key === 'delivery') del.note = text;
      save();
      return ctx.reply('✅ Сохранил.');
    }

    if (w.type === 'mail') {
      const users = Object.values(db.users).filter((u) => !u.isGuest);
      let sent = 0;
      for (const u of users) {
        try {
          await bot.api.sendMessage(u.id, text, { parse_mode: 'HTML' });
          sent++;
        } catch {}
        await new Promise((r) => setTimeout(r, 60));
      }
      return ctx.reply(`📣 Отправлено ${sent} из ${users.length}.`);
    }

    return next();
  });
}

async function menu(ctx) {
  const kb = new InlineKeyboard()
    .callback('📦 Orders', 'adm:orders:active').callback('💬 Support', 'adm:sup:list').row()
    .callback('🍸 Catalog', 'adm:cat:root').callback('🏪 Shop', 'adm:shop').row()
    .callback('📊 Stats', 'adm:stats').callback('📣 Mailing', 'adm:mail');
  await safeEdit(ctx, '🛠 <b>Admin · Cocktail Embassy</b>', kb);
}

async function safeEdit(ctx, text, kb) {
  try {
    if (ctx.callbackQuery) await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
    else await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  } catch {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
}

async function ordersList(ctx, kind) {
  let orders = db.orders || [];
  if (kind === 'active') orders = orders.filter((o) => !['delivered', 'canceled'].includes(o.status));
  if (kind === 'paid') orders = orders.filter((o) => o.paymentStatus === 'paid');
  if (kind === 'invoice') orders = orders.filter((o) => o.paymentMethod === 'invoice');
  const kb = new InlineKeyboard();
  for (const o of orders.slice(0, 12)) {
    kb.callback(`${ORDER_STATUSES[o.status]?.emoji || ''} ${o.id} · ${money(o.totals.totalAed)}`, `adm:order:${o.id}`).row();
  }
  kb.callback('Active', 'adm:orders:active').callback('All', 'adm:orders:all').row()
    .callback('Paid', 'adm:orders:paid').callback('Invoices', 'adm:orders:invoice').row()
    .callback('← Menu', 'adm:menu');
  await safeEdit(ctx, `📦 <b>Orders · ${kind}</b> (${orders.length})`, kb);
}

async function orderCard(ctx, id) {
  const o = getOrder(id);
  if (!o) return ctx.reply('Заказ не найден.');
  const kb = new InlineKeyboard();
  const row = [];
  for (const s of Object.keys(ORDER_STATUSES)) {
    if (s === o.status) continue;
    row.push(InlineKeyboard.text(`${ORDER_STATUSES[s].emoji} ${ORDER_STATUSES[s].title}`, `adm:status:${o.id}:${s}`));
    if (row.length === 3) { kb.add(...row).row(); row.length = 0; }
  }
  if (row.length) kb.add(...row).row();
  kb.callback('← Orders', 'adm:orders:active').row();
  const who = userTitle(o.userId);
  await safeEdit(ctx, `${orderText(o, { full: true })}\n\n👤 ${who}`, kb);
}

async function supList(ctx) {
  const threads = listThreads();
  const kb = new InlineKeyboard();
  for (const t of threads.slice(0, 12)) {
    const badge = t.unreadAdmin ? ` (${t.unreadAdmin})` : '';
    kb.callback(`${badge ? '🔴' : '💬'} ${userTitle(t.userId)}${badge}`, `adm:sup:${t.userId}`).row();
  }
  kb.callback('← Menu', 'adm:menu');
  await safeEdit(ctx, `💬 <b>Support dialogs</b> (${threads.length})`, kb);
}

async function supThread(ctx, userId) {
  markAdminRead(userId);
  const t = db.threads[String(userId)];
  if (!t) return ctx.reply('Диалог не найден.');
  const tail = t.messages.slice(-8).map((m) => `${m.from === 'admin' ? '' : ''} ${m.text}`).join('\n\n');
  const kb = new InlineKeyboard()
    .callback('✍️ Reply', `adm:supwait:${userId}`).callback('← List', 'adm:sup:list').row();
  await safeEdit(ctx, `💬 <b>${userTitle(userId)}</b> #${userId}\n\n${tail || 'Пусто'}`, kb);
}

async function catRoot(ctx) {
  const kb = new InlineKeyboard();
  getCategories().forEach((c, i) => {
    kb.callback(c.title, `adm:cat:${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().callback('← Menu', 'adm:menu');
  await safeEdit(ctx, '🍸 <b>Catalog</b>', kb);
}

async function catList(ctx, catId) {
  const items = allProducts().filter((p) => p.collection === catId);
  const kb = new InlineKeyboard();
  items.forEach((p, i) => {
    kb.callback(`${p.hidden ? '🚫' : p.outOfStock ? '⛔️' : ''} ${p.name}`, `adm:p:${p.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().callback('← Catalog', 'adm:cat:root');
  await safeEdit(ctx, `Collection <b>${catId}</b> (${items.length})`, kb);
}

async function productCard(ctx, id) {
  const p = findProduct(id);
  if (!p) return ctx.reply('Товар не найден.');
  const kb = new InlineKeyboard()
    .callback('💰 Price', `adm:pact:price:${id}`).callback(p.outOfStock ? '✅ In stock' : '⛔️ Out of stock', `adm:pact:stock:${id}`).row()
    .callback(p.hidden ? '👁 Show' : '🚫 Hide', `adm:pact:hide:${id}`).callback('🗑 Delete', `adm:pact:del:${id}`).row()
    .callback('↩️ Restore', `adm:pact:restore:${id}`).callback('← Back', `adm:cat:${p.collection}`).row();
  await safeEdit(ctx, `🍸 <b>${p.name}</b> [${p.id}]\n${productLine(p)}\n${p.hidden ? '🚫 скрыт' : 'виден на витрине'}`, kb);
}

async function shopCard(ctx) {
  const b = getBrand();
  const s = getShopSettings();
  const kb = new InlineKeyboard()
    .callback('Tagline', 'adm:shopedit:tagline').callback('Delivery text', 'adm:shopedit:delivery').row()
    .callback('WhatsApp', 'adm:shopedit:whatsapp').callback('Instagram', 'adm:shopedit:instagram').row()
    .callback('Free from', 'adm:shopedit:free').callback('Shipping cost', 'adm:shopedit:ship').row()
    .callback('← Menu', 'adm:menu');
  await safeEdit(ctx,
    `🏪 <b>Shop</b>\n${b.name} · ${b.tagline}\nWA: ${b.whatsapp || '—'} · IG: @${b.instagram || '—'}\n`
    + `Free delivery from ${money(s.freeShippingFrom)}, shipping ${money(s.shippingCost)}`, kb);
}

async function stats(ctx) {
  const orders = db.orders || [];
  const day = Date.now() - 86400e3;
  const week = Date.now() - 7 * 86400e3;
  const sum = (list) => list.reduce((s, o) => s + (o.totals?.totalAed || 0), 0);
  const paid = orders.filter((o) => o.paymentStatus === 'paid');
  const top = {};
  for (const o of orders) for (const it of o.items) top[it.name] = (top[it.name] || 0) + it.qty;
  const topStr = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, q], i) => `${i + 1}. ${n} — ${q}`).join('\n') || '—';
  await safeEdit(ctx,
    `📊 <b>Stats</b>\nOrders 24h: ${orders.filter((o) => o.createdAt > day).length} · 7d: ${orders.filter((o) => o.createdAt > week).length}\n`
    + `Revenue (paid): ${money(sum(paid))}\nAvg check: ${money(paid.length ? sum(paid) / paid.length : 0)}\n`
    + `Users: ${Object.keys(db.users).length} · guests: ${Object.values(db.users).filter((u) => u.isGuest).length}\n\nTop:\n${topStr}`,
    new InlineKeyboard().callback('← Menu', 'adm:menu'));
}
