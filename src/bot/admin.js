/**
 * Админ-панель в боте (расширенная): /admin доступен только ID из ADMIN_IDS.
 *
 * Разделы:
 *  📦 Заказы      — фильтры, поиск, карточка, смена статуса, «оплачено», счёт,
 *                   сообщение клиенту
 *  💬 Поддержка   — диалоги с непрочитанными, ответ в один тап
 *  🍸 Каталог     — коллекции (создать/переименовать/удалить/вернуть),
 *                   товары: цена, название, описание, объём, высота, фото по
 *                   ссылке, перенос, создание позиции по шагам, поиск,
 *                   скрытие/наличие/удаление/восстановление
 *  👥 Клиенты     — список, профиль, история заказов, написать
 *  🏪 Магазин     — бренд, доставка, мин. заказ, курс USD/AED, реквизиты счёта,
 *                   тексты витрины
 *  📊 Аналитика   — 24 ч / 7 дн / 30 дн / всё время: заказы, выручка, средний
 *                   чек, новые клиенты, топ товаров
 *  📣 Рассылка    — всем или покупателям, предпросмотр, покротечная отправка
 *  💾 Данные      — экспорт БД (JSON) и заказов (CSV)
 */
import fs from 'node:fs';
import path from 'node:path';
import { InlineKeyboard } from 'grammy';
import { config, isAdmin } from '../config.js';
import { db, save, userTitle, getUser, nextId } from '../store.js';
import {
  allProducts, findProduct, findAnyProduct, getCategories, getBrand,
  getShopSettings, getSeller, getDeliveryInfo, getTexts,
  deletedProducts, deletedCategories,
} from '../catalog.js';
import { getOrder, updateOrder, ORDER_STATUSES, DELIVERY_METHODS } from '../orders.js';
import { listThreads, addAdminMessage, markAdminRead } from '../support.js';
import { money, esc, toCsv } from './format.js';

export { isAdmin };

const PAGE = 10;
const DAY = 86_400_000;
const DB_FILE = path.join(config.dataDir, 'db.json');

/** Русские подписи статусов (в витрине остаются английские ORDER_STATUSES). */
const STATUS_RU = {
  new: 'новый', paid: 'оплачен', packing: 'собирается',
  shipped: 'отправлен', delivered: 'доставлен', canceled: 'отменён',
};

const ORDER_FILTERS = {
  new: { label: '🆕 Новые', match: (o) => o.status === 'new' },
  active: { label: '🔥 Активные', match: (o) => !['delivered', 'canceled'].includes(o.status) },
  paid: { label: '💳 Оплаченные', match: (o) => o.paymentStatus === 'paid' },
  inv: { label: '📄 Счета', match: (o) => o.paymentMethod === 'invoice' },
  all: { label: '📋 Все', match: () => true },
};

// ожидающий ввод: userId -> { type, step?, id?, target?, data? }
const wait = new Map();
// текущий paginated-вид: userId -> { kind, page, ... }
const views = new Map();

export function registerAdmin(bot) {
  const guard = (ctx, next) => (isAdmin(ctx.from?.id) ? next() : Promise.resolve());

  bot.command('admin', guard, (ctx) => menu(ctx));
  bot.command('stats', guard, (ctx) => showStats(ctx, 'w'));
  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

  bot.callbackQuery(/^adm:/, guard, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    try {
      await handleCallback(ctx);
    } catch (err) {
      console.error('[admin]', err);
    }
  });

  // ввод значений админом
  bot.on('message:text', guard, async (ctx, next) => {
    const w = wait.get(ctx.from.id);
    if (!w) return next();
    if (ctx.message.text.startsWith('/')) return next(); // команды проходят мимо
    const t = ctx.message.text.trim();
    if (t === 'отмена' || t === '✖️') {
      wait.delete(ctx.from.id);
      return ctx.reply('Отменено.');
    }
    try {
      await handleInput(ctx, w, t);
    } catch (err) {
      console.error('[admin input]', err);
      wait.delete(ctx.from.id);
      ctx.reply('Не удалось обработать ввод. Попробуйте ещё раз.');
    }
  });

  // ─────────────────────────── кнопки ───────────────────────────
  async function handleCallback(ctx) {
    const [, action, a, b] = ctx.callbackQuery.data.split(':');
    const id = ctx.from.id;

    // ── навигация ──
    if (action === 'menu') return menu(ctx);
    if (action === 'pg') {
      const v = views.get(id);
      if (!v) return;
      v.page = Math.max(0, (v.page || 0) + Number(a));
      return renderView(ctx, v);
    }
    if (action === 'waitcancel') {
      wait.delete(id);
      return show(ctx, 'Отменено.', new InlineKeyboard().text('← Меню', 'adm:menu'));
    }

    // ── заказы ──
    if (action === 'ol') return openOrderList(ctx, a || 'active');
    if (action === 'o') return orderCard(ctx, a);
    if (action === 'ost') {
      const o = getOrder(a);
      if (o) updateOrder(o.id, { status: b }, 'admin');
      return orderCard(ctx, a);
    }
    if (action === 'opaid') {
      const o = getOrder(a);
      if (o) updateOrder(o.id, {
        paymentStatus: 'paid',
        status: o.status === 'new' ? 'paid' : o.status,
        payment: o.payment || { provider: 'manual' },
      }, 'admin');
      return orderCard(ctx, a);
    }
    if (action === 'oinv') {
      const o = getOrder(a);
      if (!o) return;
      const url = config.publicUrl;
      if (url) return show(ctx, `Счёт <b>${esc(o.invoiceNumber || o.id)}</b>`, new InlineKeyboard().webApp('📄 Открыть счёт', `${url}/invoice/${o.id}`));
      return show(ctx, `Счёт доступен по адресу <code>/invoice/${o.id}</code> на сайте (публичный URL пока не определён).`, new InlineKeyboard().text('← Меню', 'adm:menu'));
    }
    if (action === 'omsg') {
      const o = getOrder(a);
      if (!o) return;
      if (o.userId > 0) {
        wait.set(id, { type: 'omsg', id: o.id });
        return ctx.reply(`✍️ Сообщение клиенту (${userTitle(o.userId)}) о заказе ${o.id}:`, { reply_markup: cancelKb() });
      }
      return show(ctx, 'Это гостевой заказ (сайт) — ответить можно в чате поддержки.', new InlineKeyboard().text('← Меню', 'adm:menu'));
    }
    if (action === 'osearch') {
      wait.set(id, { type: 'osearch' });
      return ctx.reply('🔍 Введите ID заказа, имя клиента или телефон:', { reply_markup: cancelKb() });
    }

    // ── поддержка ──
    if (action === 'sup' && a === 'list') { views.set(id, { kind: 'threads', page: 0 }); return renderView(ctx, views.get(id)); }
    if (action === 'sup') return supThread(ctx, a);
    if (action === 'supwait') {
      wait.set(id, { type: 'support', id: a });
      return ctx.reply('✍️ Напишите ответ — я отправлю его в чат поддержки.', { reply_markup: cancelKb() });
    }

    // ── каталог ──
    if (action === 'cat' && a === 'root') return catRoot(ctx);
    if (action === 'cat' && a) { views.set(id, { kind: 'prods', cat: a, page: 0 }); return renderView(ctx, views.get(id)); }
    if (action === 'catnew') {
      wait.set(id, { type: 'newcat' });
      return ctx.reply('🆕 Название новой коллекции (латиницей, например «Retro 2026»):', { reply_markup: cancelKb() });
    }
    if (action === 'catren') {
      wait.set(id, { type: 'catren', id: a });
      const c = getCategories().find((x) => x.id === a);
      return ctx.reply(`✏️ Новое название коллекции «${c?.title || a}»:`, { reply_markup: cancelKb() });
    }
    if (action === 'catdel') {
      db.deletedCategories = db.deletedCategories || [];
      if (!db.deletedCategories.includes(a)) db.deletedCategories.push(a);
      save();
      return catRoot(ctx);
    }
    if (action === 'catres') {
      db.deletedCategories = (db.deletedCategories || []).filter((x) => x !== a);
      save();
      return deletedSection(ctx);
    }
    if (action === 'del') return deletedSection(ctx);
    if (action === 'p') return productCard(ctx, a);
    if (action === 'pa') {
      const p = findProduct(b) || findAnyProduct(b);
      if (!p) return;
      if (a === 'st' || a === 'hd') {
        const o = db.overrides[p.id] || (db.overrides[p.id] = {});
        if (a === 'st') o.outOfStock = !p.outOfStock;
        else o.hidden = !p.hidden;
        save();
        return productCard(ctx, p.id);
      }
      const prompts = {
        price: [`💰 Текущая цена: ${money(p.priceAed)}. Новая цена, AED:`, { type: 'price', id: p.id }],
        name: [`🏷 Новое название «${esc(p.name)}»:`, { type: 'name', id: p.id }],
        desc: ['📝 Новое описание (или «0» чтобы очистить):', { type: 'desc', id: p.id }],
        vol: [`📏 Объём, мл (сейчас: ${p.volumeMl || '—'}; «0» — убрать):`, { type: 'vol', id: p.id }],
        hgt: [`⬆️ Высота, мм (сейчас: ${p.heightMm || '—'}; «0» — убрать):`, { type: 'hgt', id: p.id }],
        ph: ['🖼 Ссылка на фото (http/https):', { type: 'ph', id: p.id }],
      };
      if (prompts[a]) {
        wait.set(id, prompts[a][1]);
        return ctx.reply(prompts[a][0], { reply_markup: cancelKb() });
      }
      if (a === 'mov') {
        const kb = new InlineKeyboard();
        getCategories().forEach((c, i) => {
          kb.text(`${c.id === p.collection ? '✓ ' : ''}${c.title}`, `adm:pam:${p.id}:${c.id}`);
          if (i % 2 === 1) kb.row();
        });
        kb.row().text('← Назад', `adm:p:${p.id}`);
        return show(ctx, '📁 Перенести в коллекцию:', kb);
      }
      return productCard(ctx, p.id);
    }
    if (action === 'pam') {
      const o = db.overrides[b] || (db.overrides[b] = {});
      o.collection = a;
      save();
      return productCard(ctx, b);
    }
    if (action === 'pdel') {
      db.deletedProducts = db.deletedProducts || [];
      if (!db.deletedProducts.includes(a)) db.deletedProducts.push(a);
      save();
      return deletedSection(ctx);
    }
    if (action === 'pdelr') {
      db.deletedProducts = (db.deletedProducts || []).filter((x) => x !== a);
      delete db.overrides[a]?.hidden;
      save();
      return productCard(ctx, a);
    }
    if (action === 'cadd') {
      wait.set(id, { type: 'np', step: 1, data: {} });
      return npStep(ctx, 1);
    }
    if (action === 'npc') {
      const w = wait.get(id);
      if (!w || w.type !== 'np') return;
      w.data.cat = a;
      w.step = 4;
      wait.set(id, w);
      return npStep(ctx, 4);
    }
    if (action === 'npskip') {
      const w = wait.get(id);
      if (!w || w.type !== 'np') return;
      w.step += 1;
      wait.set(id, w);
      return npStep(ctx, w.step);
    }
    if (action === 'npcancel') {
      wait.delete(id);
      return show(ctx, 'Создание отменено.', new InlineKeyboard().text('← Меню', 'adm:menu'));
    }
    if (action === 'csearch') {
      wait.set(id, { type: 'csearch' });
      return ctx.reply('🔍 Введите название или код товара:', { reply_markup: cancelKb() });
    }

    // ── клиенты ──
    if (action === 'usr') { views.set(id, { kind: 'users', page: 0 }); return renderView(ctx, views.get(id)); }
    if (action === 'u') return userCard(ctx, a);
    if (action === 'umsg') {
      wait.set(id, { type: 'umsg', id: a });
      return ctx.reply(`✍️ Сообщение пользователю ${a}:`, { reply_markup: cancelKb() });
    }

    // ── магазин ──
    if (action === 'shop') return shopCard(ctx);
    if (action === 'seller') return sellerCard(ctx);
    if (action === 'texts') return textsCard(ctx);
    if (action === 'se') {
      wait.set(id, { type: 'shop', id: a });
      return ctx.reply(shopHints(a), { reply_markup: cancelKb() });
    }

    // ── аналитика ──
    if (action === 'st') return showStats(ctx, a || 'w');

    // ── рассылка ──
    if (action === 'mail') {
      const users = tgUsers();
      const buyers = users.filter((u) => (u.ordersCount || 0) > 0);
      return show(ctx, '📣 Кому отправить рассылку?', new InlineKeyboard()
        .text(`👥 Все пользователи — ${users.length}`, 'adm:mailt:all')
        .text(`🛍 Покупатели — ${buyers.length}`, 'adm:mailt:buyers'));
    }
    if (action === 'mailt') {
      wait.set(id, { type: 'mail', target: a, data: {} });
      return ctx.reply('Введите текст рассылки (обычный текст, без форматирования):', { reply_markup: cancelKb() });
    }
    if (action === 'mailgo') return doMailing(ctx);
    if (action === 'mailredo') {
      const w = wait.get(id);
      wait.set(id, { type: 'mail', target: w?.target || 'all', data: {} });
      return ctx.reply('Введите текст рассылки ещё раз:', { reply_markup: cancelKb() });
    }

    // ── данные ─
    if (action === 'data') return dataCard(ctx);
    if (action === 'expdb') return exportDb(ctx);
    if (action === 'expcsv') return exportCsv(ctx);

    // ── витрина ──
    if (action === 'store') {
      const url = config.publicUrl;
      if (!url) return show(ctx, 'Публичный URL пока не определён — откройте витрину в браузере, и я подхвачу адрес.', new InlineKeyboard().text('← Меню', 'adm:menu'));
      return show(ctx, '🏠 Магазин:', new InlineKeyboard().webApp('Открыть магазин', url));
    }

    return menu(ctx);
  }

  // ─────────────────────────── ввод ───────────────────────────
  async function handleInput(ctx, w, t) {
    const id = ctx.from.id;
    const done = () => wait.delete(id);

    if (w.type === 'price') {
      const v = Number(t.replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || v > 10_000_000) return ctx.reply('Не похоже на число. Пример: 350');
      const o = db.overrides[w.id] || (db.overrides[w.id] = {});
      o.priceAed = v;
      o.priceUsd = Math.round((v / getShopSettings().usdRate) * 10) / 10;
      save(); done();
      return ctx.reply(`✅ ${w.id}: ${money(v)} (≈ USD ${o.priceUsd}).`);
    }
    if (w.type === 'name') {
      if (!t) return ctx.reply('Название не может быть пустым.');
      const o = db.overrides[w.id] || (db.overrides[w.id] = {});
      o.name = t.slice(0, 120);
      save(); done();
      return ctx.reply('✅ Название обновлено.');
    }
    if (w.type === 'desc') {
      const o = db.overrides[w.id] || (db.overrides[w.id] = {});
      if (t === '0') delete o.description;
      else o.description = t.slice(0, 500);
      save(); done();
      return ctx.reply('✅ Описание обновлено.');
    }
    if (w.type === 'vol' || w.type === 'hgt') {
      const key = w.type === 'vol' ? 'volumeMl' : 'heightMm';
      if (t !== '0') {
        const v = Number(t);
        if (!Number.isFinite(v) || v <= 0 || v > 10_000) return ctx.reply('Введите число (мм/мл) или 0, чтобы убрать.');
        const o = db.overrides[w.id] || (db.overrides[w.id] = {});
        o[key] = v;
      } else {
        const o = db.overrides[w.id] || (db.overrides[w.id] = {});
        delete o[key];
      }
      save(); done();
      return ctx.reply('✅ Сохранено.');
    }
    if (w.type === 'ph') {
      if (!/^https?:\/\/\S+$/i.test(t)) return ctx.reply('Нужна ссылка вида https://…');
      const o = db.overrides[w.id] || (db.overrides[w.id] = {});
      o.image = t.slice(0, 500);
      save(); done();
      return ctx.reply('✅ Фото обновлено (видит витрина в карточке товара).');
    }
    if (w.type === 'support') {
      addAdminMessage(Number(w.id), t);
      done();
      return ctx.reply(`✅ Отправлено пользователю ${w.id}.`);
    }
    if (w.type === 'omsg') {
      const o = getOrder(w.id);
      if (!o) { done(); return ctx.reply('Заказ не найден.'); }
      try {
        await bot.api.sendMessage(o.userId, `Заказ <b>${o.id}</b>:\n${esc(t)}`, { parse_mode: 'HTML' });
        done();
        return ctx.reply('✅ Отправлено клиенту.');
      } catch {
        done();
        return ctx.reply('Не удалось отправить (пользователь заблокировал бота).');
      }
    }
    if (w.type === 'umsg') {
      try {
        await bot.api.sendMessage(Number(w.id), t);
        done();
        return ctx.reply('✅ Отправлено.');
      } catch {
        done();
        return ctx.reply('Не удалось отправить (пользователь заблокировал бота).');
      }
    }
    if (w.type === 'newcat') {
      const title = t.slice(0, 60);
      let catId = slugify(title);
      db.customCategories = db.customCategories || [];
      if (!catId || db.customCategories.some((c) => c.id === catId)) catId = `${slugify(title) || 'c'}-${Date.now().toString(36)}`;
      db.customCategories.push({ id: catId, title });
      save(); done();
      return ctx.reply(`✅ Коллекция «${title}» создана.`, {
        reply_markup: new InlineKeyboard().text(`Открыть «${title}»`, `adm:cat:${catId}`).row().text('← Меню', 'adm:menu'),
      });
    }
    if (w.type === 'catren') {
      db.categoryOverrides = db.categoryOverrides || {};
      const o = db.categoryOverrides[w.id] || (db.categoryOverrides[w.id] = {});
      o.title = t.slice(0, 60);
      const custom = (db.customCategories || []).find((c) => c.id === w.id);
      if (custom) custom.title = o.title;
      save(); done();
      return ctx.reply('✅ Коллекция переименована.', {
        reply_markup: new InlineKeyboard().text(`Открыть «${o.title}»`, `adm:cat:${w.id}`).row().text('← Коллекции', 'adm:cat:root'),
      });
    }
    if (w.type === 'osearch') {
      const q = t.toLowerCase();
      const digits = q.replace(/\D/g, '');
      const found = (db.orders || []).filter((o) =>
        String(o.id).toLowerCase().includes(q)
        || String(o.customer?.name || '').toLowerCase().includes(q)
        || (digits && String(o.customer?.phone || '').replace(/\D/g, '').includes(digits))
        || String(o.company?.name || '').toLowerCase().includes(q));
      if (!found.length) { done(); return ctx.reply(`По запросу «${t}» ничего не нашлось.`); }
      done();
      views.set(id, { kind: 'osearch', q: t, ids: found.slice(0, 30).map((o) => o.id), page: 0 });
      return renderView(ctx, views.get(id));
    }
    if (w.type === 'csearch') {
      const q = t.toLowerCase();
      const found = allProducts().filter((p) =>
        String(p.id).toLowerCase().includes(q) || String(p.name).toLowerCase().includes(q));
      if (!found.length) { done(); return ctx.reply(`По запросу «${t}» ничего не нашлось.`); }
      done();
      views.set(id, { kind: 'psearch', q: t, ids: found.slice(0, 30).map((p) => p.id), page: 0 });
      return renderView(ctx, views.get(id));
    }
    if (w.type === 'shop') return applyShopSetting(ctx, w.id, t);
    if (w.type === 'mail') {
      if (!t) return ctx.reply('Текст пустой.');
      w.data.text = t;
      wait.set(id, w); // остаёмся на шаге подтверждения
      const target = w.target === 'buyers' ? 'покупателям' : 'всем пользователям';
      return ctx.reply(`Предпросмотр (уходит ${target}):\n\n${t.slice(0, 400)}${t.length > 400 ? '…' : ''}`, {
        reply_markup: new InlineKeyboard()
          .text('✅ Отправить', 'adm:mailgo').text('✏️ Переписать', 'adm:mailredo').row()
          .text('← Отмена', 'adm:menu'),
      });
    }
    if (w.type === 'np') return npInput(ctx, w, t);
  }

  // ─────────────────────────── создание товара ───────────────────────────
  const NP_STEPS = {
    1: '🆕 Новый товар · 1/7\nНазвание:',
    2: '🆕 Новый товар · 2/7\nЦена, AED (цифры; «0» — цена по запросу):',
    3: '🆕 Новый товар · 3/7\nКоллекция (кнопкой):',
    4: '🆕 Новый товар · 4/7\nОбъём, мл (или «0»):',
    5: '🆕 Новый товар · 5/7\nВысота, мм (или «0»):',
    6: '🆕 Новый товар · 6/7\nФото: ссылка http/https (или «0»):',
    7: '🆕 Новый товар · 7/7\nОписание, 1–2 предложения (или «0»):',
  };

  function npStep(ctx, step) {
    if (step > 7) return npFinish(ctx);
    const w = wait.get(ctx.from.id);
    if (!w || w.type !== 'np') return;
    w.step = step;
    wait.set(ctx.from.id, w);
    const kb = new InlineKeyboard();
    if (step === 3) {
      getCategories().forEach((c, i) => {
        kb.text(c.title, `adm:npc:${c.id}`);
        if (i % 2 === 1) kb.row();
      });
      kb.row().text('✖️ Отмена', 'adm:npcancel');
    } else {
      if (step === 4 || step === 5 || step === 6 || step === 7) kb.text('⏭ Пропустить', 'adm:npskip');
      kb.text('✖️ Отмена', 'adm:npcancel');
    }
    return ctx.reply(NP_STEPS[step], { reply_markup: kb });
  }

  async function npInput(ctx, w, t) {
    const d = w.data;
    if (w.step === 1) {
      if (!t) return ctx.reply('Название не может быть пустым.');
      d.name = t.slice(0, 120);
      return npStep(ctx, 2);
    }
    if (w.step === 2) {
      if (t === '0') { d.price = null; return npStep(ctx, 3); }
      const v = Number(t.replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || v > 10_000_000) return ctx.reply('Введите цену цифрами, например 350 (или 0 — по запросу).');
      d.price = v;
      return npStep(ctx, 3);
    }
    if (w.step === 4) {
      if (t === '0') { d.vol = null; return npStep(ctx, 5); }
      const v = Number(t);
      if (!Number.isFinite(v) || v <= 0 || v > 100_000) return ctx.reply('Введите число (мл) или 0 — пропустить.');
      d.vol = v;
      return npStep(ctx, 5);
    }
    if (w.step === 5) {
      if (t === '0') { d.hgt = null; return npStep(ctx, 6); }
      const v = Number(t);
      if (!Number.isFinite(v) || v <= 0 || v > 100_000) return ctx.reply('Введите число (мм) или 0 — пропустить.');
      d.hgt = v;
      return npStep(ctx, 6);
    }
    if (w.step === 6) {
      if (t === '0') { d.photo = null; return npStep(ctx, 7); }
      if (!/^https?:\/\/\S+$/i.test(t)) return ctx.reply('Нужна ссылка http/https или 0 — пропустить.');
      d.photo = t.slice(0, 500);
      return npStep(ctx, 7);
    }
    if (w.step === 7) {
      d.desc = t === '0' ? null : t.slice(0, 500);
      return npStep(ctx, 8); // 8 → npFinish
    }
    // шаг 3 (коллекция) — только кнопками
    return ctx.reply('Коллекцию выбирают кнопкой выше 🙂');
  }

  async function npFinish(ctx) {
    const w = wait.get(ctx.from.id);
    const d = w?.data || {};
    wait.delete(ctx.from.id);
    if (!d.name || !d.cat) return ctx.reply('Не хватает данных — создание отменено.');
    const id = nextId('custom', 'C-');
    const rate = getShopSettings().usdRate;
    const photo = d.photo && /^https?:\/\//i.test(d.photo) ? d.photo : '';
    db.customProducts = db.customProducts || {};
    db.customProducts[id] = {
      id, article: id, name: d.name, collection: d.cat,
      group: 'custom', type: 'custom',
      priceAed: d.price ?? null, priceUsd: d.price != null ? Math.round((d.price / rate) * 10) / 10 : null,
      volumeMl: d.vol || null, heightMm: d.hgt || null,
      material: 'crystal glass', craft: 'MADE TO ORDER', note: null,
      image: photo, description: d.desc || '',
      isNew: true, isHit: false,
    };
    save();
    return productCard(ctx, id);
  }

  // ─────────────────────────── настройки магазина ───────────────────────────
  async function applyShopSetting(ctx, key, t) {
    const done = () => wait.delete(ctx.from.id);
    const brand = db.shopInfo.brand || (db.shopInfo.brand = {});
    const shop = db.shopInfo.shop || (db.shopInfo.shop = {});
    const del = db.shopInfo.delivery || (db.shopInfo.delivery = {});
    const seller = db.shopInfo.seller || (db.shopInfo.seller = {});
    const texts = db.shopInfo.texts || (db.shopInfo.texts = {});
    const setStr = (obj, k, v) => (v ? (obj[k] = v) : delete obj[k]);
    const setNum = (obj, k, v, min, max) => {
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < min || n > max) return null;
      obj[k] = n;
      return n;
    };

    if (key === 'tagline') setStr(brand, 'tagline', t);
    else if (key === 'subtitle') setStr(brand, 'subtitle', t);
    else if (key === 'whatsapp') setStr(brand, 'whatsapp', t);
    else if (key === 'instagram') setStr(brand, 'instagram', t.replace(/^@/, ''));
    else if (key === 'phone') setStr(brand, 'phone', t);
    else if (key === 'email') setStr(brand, 'email', t);
    else if (key === 'location') setStr(brand, 'location', t);
    else if (key === 'free') { const n = setNum(shop, 'freeShippingFrom', t, 0, 1_000_000); if (n == null) return ctx.reply('Введите сумму, AED (или 0).'); done(); return ctx.reply(`✅ Бесплатная доставка от ${money(n)}.`); }
    else if (key === 'ship') { const n = setNum(shop, 'shippingCost', t, 0, 100_000); if (n == null) return ctx.reply('Введите сумму, AED.'); done(); return ctx.reply(`✅ Доставка: ${money(n)}.`); }
    else if (key === 'minord') { const n = setNum(shop, 'minOrderTotal', t, 0, 1_000_000); if (n == null) return ctx.reply('Введите сумму, AED.'); done(); return ctx.reply(`✅ Минимальный заказ: ${money(n)}.`); }
    else if (key === 'rate') { const n = setNum(shop, 'usdRate', t, 0.1, 100); if (n == null) return ctx.reply('Введите курс, например 3.6725.'); done(); return ctx.reply(`✅ Курс: 1 USD = ${n} AED.`); }
    else if (key === 'delivery') setStr(del, 'note', t);
    else if (key === 's_name') setStr(seller, 'name', t);
    else if (key === 's_legal') setStr(seller, 'legalName', t);
    else if (key === 's_trn') setStr(seller, 'trn', t);
    else if (key === 's_addr') setStr(seller, 'address', t);
    else if (key === 's_bank') setStr(seller, 'bankName', t);
    else if (key === 's_iban') setStr(seller, 'iban', t);
    else if (key === 's_swift') setStr(seller, 'swift', t);
    else if (key === 's_signer') setStr(seller, 'signer', t);
    else if (key === 's_phone') setStr(seller, 'phone', t);
    else if (key === 's_email') setStr(seller, 'email', t);
    else if (key === 't_welcome') setStr(texts, 'welcome', t);
    else if (key === 't_about') setStr(texts, 'about', t);
    else if (key === 't_footer') setStr(texts, 'footerNote', t);
    else { done(); return ctx.reply('Неизвестная настройка.'); }
    save();
    done();
    return ctx.reply('✅ Сохранено.', { reply_markup: new InlineKeyboard().text('← Магазин', 'adm:shop') });
  }

  function shopHints(key) {
    const b = getBrand();
    const s = getShopSettings();
    const d = getDeliveryInfo();
    const sl = getSeller();
    const t = getTexts();
    const H = {
      tagline: `✏️ Tagline (сейчас: «${b.tagline || '—'}»):`,
      subtitle: `✏️ Subtitle (сейчас: «${(b.subtitle || '—').slice(0, 60)}…» ):`,
      whatsapp: `✏️ WhatsApp (сейчас: ${b.whatsapp || '—'}):`,
      instagram: `✏️ Instagram, без @ (сейчас: @${b.instagram || '—'}):`,
      phone: `✏️ Телефон (сейчас: ${b.phone || '—'}):`,
      email: `✏️ Email (сейчас: ${b.email || '—'}):`,
      location: `✏️ Локация (сейчас: ${b.location || '—'}):`,
      free: `🚚 Порог бесплатной доставки, AED (сейчас: ${s.freeShippingFrom}):`,
      ship: `🚚 Стоимость доставки UAE, AED (сейчас: ${s.shippingCost}):`,
      minord: `🧾 Минимальная сумма заказа, AED (сейчас: ${s.minOrderTotal}):`,
      rate: `💱 Курс: 1 USD = ? AED (сейчас: ${s.usdRate}):`,
      delivery: `📦 Текст о доставке (сейчас: «${(d.note || '—').slice(0, 80)}…» ):`,
      s_name: `🏢 Seller name (сейчас: ${sl.name || '—'}):`,
      s_legal: `🏢 Legal name (сейчас: ${sl.legalName || '—'}):`,
      s_trn: `🧾 TRN (сейчас: ${sl.trn || '—'}):`,
      s_addr: `📍 Адрес продавца (сейчас: ${sl.address || '—'}):`,
      s_bank: `🏦 Банк (сейчас: ${sl.bankName || '—'}):`,
      s_iban: `🏦 IBAN (сейчас: ${sl.iban || '—'}):`,
      s_swift: `🏦 SWIFT (сейчас: ${sl.swift || '—'}):`,
      s_signer: `✍️ Подпись (сейчас: ${sl.signer || '—'}):`,
      s_phone: `📞 Телефон продавца (сейчас: ${sl.phone || '—'}):`,
      s_email: `✉️ Email продавца (сейчас: ${sl.email || '—'}):`,
      t_welcome: `✏️ Welcome-текст (сейчас: «${(t.welcome || '—').slice(0, 60)}…» ):`,
      t_about: `✏️ About (сейчас: «${(t.about || '—').slice(0, 60)}…» ):`,
      t_footer: `✏️ Подвал (сейчас: «${(t.footerNote || '—').slice(0, 60)}…» ):`,
    };
    return H[key] || 'Введите значение:';
  }

  // ─────────────────────────── рассылка / выгрузки ───────────────────────────
  async function doMailing(ctx) {
    const w = wait.get(ctx.from.id);
    if (!w || w.type !== 'mail' || !w.data.text) {
      wait.delete(ctx.from.id);
      return ctx.reply('Сначала введите текст рассылки.');
    }
    wait.delete(ctx.from.id);
    const users = tgUsers().filter((u) => (w.target === 'buyers' ? (u.ordersCount || 0) > 0 : true));
    const chunks = chunkText(w.data.text);
    const total = users.length * chunks.length;
    let sent = 0;
    const report = await ctx.reply(`📣 Отправляю: ${total} сообщ. × ${users.length} пользователей…`);
    for (const u of users) {
      for (const c of chunks) {
        try {
          await bot.api.sendMessage(u.id, c);
          sent++;
        } catch { /* заблокировал бота / не писал */ }
        await new Promise((r) => setTimeout(r, 70));
      }
    }
    try { await report.editText(`✅ Рассылка завершена: доставлено ${sent} из ${total} (аудитория: ${users.length}).`); }
    catch { await ctx.reply(`✅ Рассылка завершена: доставлено ${sent} из ${total}.`); }
  }

  async function exportDb(ctx) {
    try {
      const buf = fs.readFileSync(DB_FILE);
      const name = `ce-backup-${ts()}.json`;
      await bot.api.sendDocument(ctx.from.id, buf, { filename: name, caption: `Резервная копия данных · ${buf.length} байт` });
      return ctx.reply(`📤 Файл ${name} отправлен.`);
    } catch (err) {
      console.error('[admin] export db:', err);
      return ctx.reply('Не удалось отправить файл: ' + err.message);
    }
  }

  async function exportCsv(ctx) {
    const orders = db.orders || [];
    const rows = orders.map((o) => [
      o.id,
      new Date(o.createdAt).toISOString(),
      o.userId,
      o.status,
      o.paymentMethod,
      o.paymentStatus,
      o.items.map((it) => `${it.name} x${it.qty}`).join(' | '),
      o.items.reduce((s, it) => s + it.qty, 0),
      o.totals?.totalAed,
      o.totals?.totalUsd,
      o.customer?.name,
      o.customer?.phone,
      o.customer?.email,
      o.company?.name,
      o.delivery?.method,
      o.delivery?.address,
      o.comment,
    ]);
    const csv = toCsv(
      ['id', 'date', 'user', 'status', 'payment', 'pay_status', 'items', 'qty', 'total_aed', 'total_usd', 'name', 'phone', 'email', 'company', 'delivery', 'address', 'comment'],
      rows,
    );
    const name = `ce-orders-${ts()}.csv`;
    try {
      await bot.api.sendDocument(ctx.from.id, Buffer.from('\uFEFF' + csv, 'utf8'), { filename: name, caption: `Заказов в выгрузке: ${orders.length}` });
    } catch (err) {
      console.error('[admin] export csv:', err);
      return ctx.reply('Не удалось отправить файл: ' + err.message);
    }
    return ctx.reply(`📤 Файл ${name} отправлен.`);
  }
}

// ─────────────────────────── экраны ───────────────────────────

/** Ответ или правка текущего сообщения (без спама новыми). */
async function show(ctx, text, kb) {
  const opts = { parse_mode: 'HTML', reply_markup: kb || undefined };
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (err) {
      if (!/not modified/i.test(err?.message || '')) {
        return ctx.reply(text, opts).catch(() => {});
      }
    }
  }
  await ctx.reply(text, opts).catch(() => {});
}

function cancelKb() {
  return new InlineKeyboard().text('✖️ Отмена', 'adm:waitcancel');
}

function pager(kb, v) {
  const pages = v.pageCount || 1;
  if (pages > 1) {
    const parts = [];
    if (v.page > 0) parts.push(InlineKeyboard.text('← Назад', 'adm:pg:-1'));
    parts.push(InlineKeyboard.text(`${v.page + 1}/${pages}`, 'noop'));
    if (v.page < pages - 1) parts.push(InlineKeyboard.text('Вперёд →', 'adm:pg:1'));
    kb.row().add(...parts);
  }
  return kb;
}

function menu(ctx) {
  const orders = db.orders || [];
  const fresh = orders.filter((o) => o.status === 'new').length;
  const unreadSup = Object.values(db.threads || {}).reduce((s, t) => s + (t.unreadAdmin || 0), 0);
  const today = orders.filter((o) => o.createdAt > Date.now() - DAY);
  const todayPaid = today.filter((o) => o.paymentStatus === 'paid')
    .reduce((s, o) => s + (o.totals?.totalAed || 0), 0);
  const kb = new InlineKeyboard()
    .text(`📦 Заказы${fresh ? ` · ${fresh}` : ''}`, 'adm:ol:active').text(`💬 Поддержка${unreadSup ? ` · ${unreadSup}` : ''}`, 'adm:sup:list').row()
    .text('🍸 Каталог', 'adm:cat:root').text('👥 Клиенты', 'adm:usr').row()
    .text('🏪 Магазин', 'adm:shop').text('📊 Аналитика', 'adm:st:w').row()
    .text('📣 Рассылка', 'adm:mail').text('💾 Данные', 'adm:data').row()
    .text('🏠 Открыть магазин', 'adm:store');
  const line = today.length
    ? `Сегодня: ${today.length} зак. · оплачено ${money(todayPaid)}`
    : 'Сегодня заказов пока нет';
  return show(ctx, `🛠 <b>Админ · ${esc(getBrand().name)}</b>\n${line}`, kb);
}

// ── заказы ──
function openOrderList(ctx, filter) {
  const orders = (db.orders || []).filter(ORDER_FILTERS[filter]?.match || (() => true));
  views.set(ctx.from.id, { kind: 'orders', filter, page: 0 });
  return show(ctx, `📦 <b>Заказы · ${ORDER_FILTERS[filter]?.label || filter}</b> (${orders.length})`, orderListKb(orders, { page: 0 }));
}

function orderListKb(orders, v) {
  const page = orders.slice(v.page * PAGE, (v.page + 1) * PAGE);
  const kb = new InlineKeyboard();
  for (const o of page) {
    const st = ORDER_STATUSES[o.status]?.emoji || '';
    kb.text(`${st} ${o.id} · ${money(o.totals.totalAed)} · ${esc(userTitle(o.userId)).slice(0, 22)}`, `adm:o:${o.id}`).row();
  }
  if (!page.length) kb.text('— пусто —', 'noop');
  kb.row()
    .text('🆕', 'adm:ol:new').text('🔥', 'adm:ol:active').text('💳', 'adm:ol:paid').row()
    .text('📄', 'adm:ol:inv').text('📋', 'adm:ol:all').text('🔍 Поиск', 'adm:osearch').row()
    .text('← Меню', 'adm:menu');
  return pager(kb, { ...v, pageCount: Math.max(1, Math.ceil(orders.length / PAGE)) });
}

function orderCard(ctx, id) {
  const o = getOrder(id);
  if (!o) return ctx.reply('Заказ не найден.');
  const kb = new InlineKeyboard();
  const row = [];
  for (const s of Object.keys(ORDER_STATUSES)) {
    if (s === o.status) continue;
    row.push(InlineKeyboard.text(`${ORDER_STATUSES[s].emoji} ${STATUS_RU[s]}`, `adm:ost:${o.id}:${s}`));
    if (row.length === 3) { kb.add(...row).row(); row.length = 0; }
  }
  if (row.length) kb.add(...row).row();
  if (o.paymentStatus !== 'paid') kb.text('💳 Отметить оплаченным', `adm:opaid:${o.id}`).row();
  const extra = [];
  if (o.invoiceNumber) extra.push(InlineKeyboard.text('📄 Счёт', `adm:oinv:${o.id}`));
  if (o.userId > 0) extra.push(InlineKeyboard.text('✍️ Написать клиенту', `adm:omsg:${o.id}`));
  if (extra.length) kb.add(...extra).row();
  kb.text('← К списку', 'adm:ol:active');
  const hist = (o.history || []).slice(-3)
    .map((h) => `${new Date(h.at).toLocaleDateString('ru-RU')} ${STATUS_RU[h.status] || h.status} (${h.by})`).join(' → ');
  const deliveryTitle = DELIVERY_METHODS[o.delivery?.method]?.title || o.delivery?.method || '—';
  return show(
    ctx,
    `🧾 <b>${esc(o.id)}</b> · ${new Date(o.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}\n`
    + `Статус: <b>${STATUS_RU[o.status] || o.status}</b> · оплата: ${esc(o.paymentStatus)} (${esc(o.paymentMethod)})\n`
    + o.items.map((it) => `• ${esc(it.name)} × ${it.qty} — ${money((it.priceAed || 0) * it.qty)}`).join('\n')
    + `\nИтого: <b>${money(o.totals.totalAed)}</b> (≈ $${o.totals.totalUsd})`
    + (o.totals.shippingQuote ? '\n🌍 Доставка: рассчитает менеджер' : o.totals.shippingAed ? `\nДоставка: ${money(o.totals.shippingAed)}` : '')
    + `\nКлиент: ${esc(o.customer?.name || '—')} · ${esc(o.customer?.phone || '')}${o.customer?.email ? ' · ' + esc(o.customer.email) : ''}`
    + (o.company?.name ? `\nКомпания: ${esc(o.company.name)}${o.company.inn ? ` (INN ${esc(o.company.inn)})` : ''}` : '')
    + `\nДоставка: ${esc(deliveryTitle)}${o.delivery?.address ? ` · ${esc(o.delivery.address)}` : ''}`
    + (o.comment ? `\n💬 ${esc(o.comment)}` : '')
    + (o.invoiceNumber ? `\nСчёт: ${esc(o.invoiceNumber)}` : '')
    + (hist ? `\nИстория: ${esc(hist)}` : ''),
    kb,
  );
}

// ── поддержка ──
function supThread(ctx, userId) {
  markAdminRead(Number(userId));
  const t = db.threads[String(userId)];
  if (!t) return ctx.reply('Диалог не найден.');
  const lines = t.messages.slice(-10).map((m) =>
    `${m.from === 'admin' ? '🛠' : '👤'} <i>${new Date(m.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</i>\n${esc(m.text)}`).join('\n\n');
  const kb = new InlineKeyboard()
    .text('✍️ Ответить', `adm:supwait:${userId}`).text('← К диалогам', 'adm:sup:list');
  return show(ctx, `💬 <b>${esc(userTitle(userId))}</b> #${userId}\n\n${lines || '— пусто —'}`, kb);
}

// ── каталог ──
function catRoot(ctx) {
  const cats = getCategories();
  const counts = {};
  for (const p of allProducts()) counts[p.collection] = (counts[p.collection] || 0) + 1;
  const deletedN = (db.deletedProducts || []).length + (db.deletedCategories || []).length;
  const kb = new InlineKeyboard();
  cats.forEach((c, i) => {
    kb.text(`${c.title} · ${counts[c.id] || 0}`, `adm:cat:${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text('🔍 Найти товар', 'adm:csearch').text('➕ Новая коллекция', 'adm:catnew').row();
  if (deletedN) kb.row().text(`↩️ Удалённое · ${deletedN}`, 'adm:del');
  kb.row().text('← Меню', 'adm:menu');
  return show(ctx, '🍸 <b>Каталог</b> — коллекции', kb);
}

function deletedSection(ctx) {
  const prods = deletedProducts();
  const cats = deletedCategories();
  const kb = new InlineKeyboard();
  for (const p of prods.slice(0, 15)) kb.text(`↩️ ${p.name} [${p.id}]`, `adm:pdelr:${p.id}`).row();
  for (const c of cats.slice(0, 5)) kb.text(`↩️ Коллекция: ${c.title || c.id}`, `adm:catres:${c.id}`).row();
  kb.row().text('← Коллекции', 'adm:cat:root');
  const text = prods.length || cats.length
    ? `🗑 <b>Удалённое</b>\nТоваров: ${prods.length} · коллекций: ${cats.length}\nВосстановить в один тап:`
    : '🗑 <b>Удалённое</b>\nВсё чистое — удалять было нечего.';
  return show(ctx, text, kb);
}

function productCard(ctx, id) {
  const p = findProduct(id) || findAnyProduct(id);
  if (!p) return ctx.reply('Товар не найден.');
  const isDeleted = (db.deletedProducts || []).includes(String(id));
  const cat = getCategories().find((c) => c.id === p.collection)?.title || p.collection || '—';
  const kb = new InlineKeyboard()
    .text('💰 Цена', `adm:pa:price:${p.id}`).text('🏷 Название', `adm:pa:name:${p.id}`).row()
    .text('📏 Объём', `adm:pa:vol:${p.id}`).text('⬆️ Высота', `adm:pa:hgt:${p.id}`).row()
    .text('📝 Описание', `adm:pa:desc:${p.id}`).text('🖼 Фото', `adm:pa:ph:${p.id}`).row()
    .text('📁 Перенести', `adm:pa:mov:${p.id}`).text(p.outOfStock ? '✅ В наличии' : '⛔️ Нет в наличии', `adm:pa:st:${p.id}`).row()
    .text(p.hidden ? '👁 Показать' : '🚫 Скрыть', `adm:pa:hd:${p.id}`)
    .text(isDeleted ? '↩️ Восстановить' : '🗑 Удалить', isDeleted ? `adm:pdelr:${p.id}` : `adm:pdel:${p.id}`).row()
    .text(`← ${cat}`, `adm:cat:${p.collection || 'root'}`);
  const price = p.priceAed == null ? 'по запросу' : `${money(p.priceAed)} (≈ $${p.priceUsd ?? '?'})`;
  const specs = [p.volumeMl && `${p.volumeMl} мл`, p.heightMm && `${p.heightMm} мм`, p.diameterMm && `Φ ${p.diameterMm} мм`].filter(Boolean).join(' · ');
  return show(
    ctx,
    `🍸 <b>${esc(p.name)}</b> <i>[${p.id}]${isDeleted ? ' · УДАЛЁН' : ''}</i>\n`
    + `Цена: <b>${price}</b>\n`
    + (specs ? `${specs}\n` : '')
    + `Коллекция: ${esc(cat)}\n`
    + `Статус: ${p.hidden ? '🚫 скрыт с витрины' : '👁 на витрине'}${p.outOfStock ? ' · ⛔ нет в наличии' : ' · ✅ в наличии'}`
    + (p.description ? `\nОписание: <i>${esc(p.description)}</i>` : ''),
    kb,
  );
}

function prodList(ctx, catId, page) {
  const items = allProducts().filter((p) => p.collection === catId);
  const slice = items.slice(page * PAGE, (page + 1) * PAGE);
  const kb = new InlineKeyboard();
      for (const p of slice) {
    const mark = p.hidden ? '🚫 ' : p.outOfStock ? '⛔ ' : '';
    const name = p.name.length > 38 ? `${p.name.slice(0, 38)}…` : p.name;
    kb.text(`${mark}${name} — ${p.priceAed == null ? 'по запросу' : money(p.priceAed)}`, `adm:p:${p.id}`).row();
  }
  if (!slice.length) kb.text('— пусто —', 'noop');
  kb.row().text('➕ Новый товар', 'adm:cadd').text('✏️ Название коллекции', `adm:catren:${catId}`).row()
    .text('🗑 Удалить коллекцию', `adm:catdel:${catId}`).text('← Коллекции', 'adm:cat:root');
  pager(kb, { page, pageCount: Math.max(1, Math.ceil(items.length / PAGE)) });
  const cat = getCategories().find((c) => c.id === catId);
  return show(ctx, `📁 <b>${esc(cat?.title || catId)}</b> · ${items.length} поз.`, kb);
}

// ── клиенты ──
function tgUsers() {
  return Object.values(db.users || {}).filter((u) => !u.isGuest && u.id > 0);
}

function userCard(ctx, userId) {
  const u = getUser(userId);
  if (!u) return ctx.reply('Пользователь не найден.');
  const orders = (db.orders || []).filter((o) => o.userId === Number(userId));
  const kb = new InlineKeyboard();
  for (const o of orders.slice(0, 8)) {
    kb.text(`${ORDER_STATUSES[o.status]?.emoji || ''} ${o.id} · ${money(o.totals.totalAed)}`, `adm:o:${o.id}`).row();
  }
  kb.text('✍️ Написать', `adm:umsg:${u.id}`).text('← Клиенты', 'adm:usr');
  const spend = orders.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + (o.totals?.totalAed || 0), 0);
  return show(
    ctx,
    `👤 <b>${esc(userTitle(u.id))}</b>\nID: ${u.id}${u.isPremium ? ' · ⭐ Premium' : ''}\n`
    + `Заказов: ${orders.length} · оплачено: ${money(spend)}\n`
    + `Впервые: ${new Date(u.createdAt || Date.now()).toLocaleDateString('ru-RU')} · онлайн: ${new Date(u.lastSeen || Date.now()).toLocaleString('ru-RU')}`,
    kb,
  );
}

// ── магазин ──
function shopCard(ctx) {
  const b = getBrand();
  const s = getShopSettings();
  const kb = new InlineKeyboard()
    .text('Tagline', 'adm:se:tagline').text('Sub-title', 'adm:se:subtitle').row()
    .text('WhatsApp', 'adm:se:whatsapp').text('Instagram', 'adm:se:instagram').row()
    .text('Телефон', 'adm:se:phone').text('Email', 'adm:se:email').row()
    .text('Локация', 'adm:se:location').text(`🚚 Free from · ${s.freeShippingFrom}`, 'adm:se:free').row()
    .text(`🚚 Доставка · ${s.shippingCost}`, 'adm:se:ship').text(`🧾 Мин. заказ · ${s.minOrderTotal}`, 'adm:se:minord').row()
    .text(`💱 Курс USD · ${s.usdRate}`, 'adm:se:rate').text('📦 Текст доставки', 'adm:se:delivery').row()
    .text('🏢 Реквизиты счёта', 'adm:seller').text('✏️ Тексты сайта', 'adm:texts').row()
    .text('← Меню', 'adm:menu');
  return show(ctx,
    `🏪 <b>${esc(b.name)}</b>\n${esc(b.tagline || '')}\nWA: ${esc(b.whatsapp || '—')} · IG: @${esc(b.instagram || '—')}`, kb);
}

function sellerCard(ctx) {
  const s = getSeller();
  const kb = new InlineKeyboard()
    .text('Name', 'adm:se:s_name').text('Legal name', 'adm:se:s_legal').row()
    .text('TRN', 'adm:se:s_trn').text('Адрес', 'adm:se:s_addr').row()
    .text('Банк', 'adm:se:s_bank').text('IBAN', 'adm:se:s_iban').row()
    .text('SWIFT', 'adm:se:s_swift').text('Подпись', 'adm:se:s_signer').row()
    .text('Телефон', 'adm:se:s_phone').text('Email', 'adm:se:s_email').row()
    .text('← Магазин', 'adm:shop');
  return show(ctx,
    `🏢 <b>Реквизиты счёта (proforma invoice)</b>\n${esc(s.legalName || s.name)}${s.trn ? `\nTRN: ${esc(s.trn)}` : ''}\n${esc(s.address)}`, kb);
}

function textsCard(ctx) {
  const t = getTexts();
  const kb = new InlineKeyboard()
    .text('Welcome', 'adm:se:t_welcome').text('About', 'adm:se:t_about').row()
    .text('Footer', 'adm:se:t_footer').row()
    .text('← Магазин', 'adm:shop');
  return show(ctx,
    `✏️ <b>Тексты витрины</b>\nWelcome: «${esc(t.welcome)}»\nAbout: «${esc(t.about)}»\nFooter: «${esc(t.footerNote)}»`, kb);
}

// ── аналитика ──
async function showStats(ctx, period) {
  const from = period === 'd' ? Date.now() - DAY : period === 'w' ? Date.now() - 7 * DAY : period === 'm' ? Date.now() - 30 * DAY : 0;
  const orders = (db.orders || []).filter((o) => o.createdAt >= from);
  const paid = orders.filter((o) => o.paymentStatus === 'paid');
  const revenue = paid.reduce((s, o) => s + (o.totals?.totalAed || 0), 0);
  const pending = orders.filter((o) => o.status !== 'canceled' && o.paymentStatus !== 'paid')
    .reduce((s, o) => s + (o.totals?.totalAed || 0), 0);
  const top = {};
  for (const o of orders) for (const it of o.items) {
    top[it.name] = top[it.name] || { qty: 0, rev: 0 };
    top[it.name].qty += it.qty;
    top[it.name].rev += (it.priceAed || 0) * it.qty;
  }
  const topStr = Object.entries(top).sort((x, y) => y[1].rev - x[1].rev).slice(0, 5)
    .map(([n, v], i) => `${i + 1}. ${esc(n)} — ${v.qty} шт · ${money(v.rev)}`).join('\n') || '—';
  const usersNew = Object.values(db.users || {}).filter((u) => !u.isGuest && (u.createdAt || 0) >= from).length;
  const supNew = Object.values(db.threads || {}).filter((t) => (t.createdAt || 0) >= from).length;
  const kb = new InlineKeyboard()
    .text('24 ч', 'adm:st:d').text('7 дн', 'adm:st:w').text('30 дн', 'adm:st:m').row()
    .text('Всё время', 'adm:st:all').text('← Меню', 'adm:menu');
  const label = { d: '24 часа', w: '7 дней', m: '30 дней', all: 'за всё время' }[period] || period;
  await show(
    ctx,
    `📊 <b>Аналитика · ${label}</b>\n`
    + `Заказы: <b>${orders.length}</b> (оплачено ${paid.length}, отменено ${orders.filter((o) => o.status === 'canceled').length})\n`
    + `Выручка (оплачено): <b>${money(revenue)}</b>\n`
    + `В работе: ${money(pending)}\n`
    + `Средний чек: ${money(paid.length ? revenue / paid.length : 0)}\n`
    + `Новых клиентов: ${usersNew} · диалогов поддержки: ${supNew}\n\n`
    + `🏆 Топ товаров:\n${topStr}`,
    kb,
  );
}

// ── данные ──
function dataCard(ctx) {
  const ordersN = (db.orders || []).length;
  const usersN = Object.keys(db.users || {}).length;
  let size = '—';
  try {
    const b = fs.statSync(DB_FILE).size;
    size = b < 1024 ? `${b} Б` : b < 1048576 ? `${(b / 1024).toFixed(1)} КБ` : `${(b / 1048576).toFixed(1)} МБ`;
  } catch { /* файла ещё нет */ }
  const kb = new InlineKeyboard()
    .text('📤 Экспорт БД (JSON)', 'adm:expdb').text('📊 Экспорт заказов (CSV)', 'adm:expcsv').row()
    .text('← Меню', 'adm:menu');
  return show(ctx, `💾 <b>Данные</b>\nЗаказов: ${ordersN} · пользователей: ${usersN} · файл БД: ${size}`, kb);
}

// ── paginated-виды ──
function renderView(ctx, v) {
  switch (v.kind) {
    case 'orders': {
      const orders = (db.orders || []).filter(ORDER_FILTERS[v.filter]?.match || (() => true));
      return show(ctx, `📦 <b>Заказы · ${ORDER_FILTERS[v.filter]?.label || v.filter}</b> (${orders.length})`, orderListKb(orders, v));
    }
    case 'osearch': {
      const ids = v.ids || [];
      const slice = ids.slice(v.page * PAGE, (v.page + 1) * PAGE).map(getOrder).filter(Boolean);
      const kb = new InlineKeyboard();
      for (const o of slice) kb.text(`${ORDER_STATUSES[o.status]?.emoji || ''} ${o.id} · ${money(o.totals.totalAed)} · ${esc(userTitle(o.userId)).slice(0, 20)}`, `adm:o:${o.id}`).row();
      if (!slice.length) kb.text('—', 'noop');
      kb.row().text('📋 Все заказы', 'adm:ol:all').text('← Меню', 'adm:menu');
      pager(kb, { ...v, pageCount: Math.max(1, Math.ceil(ids.length / PAGE)) });
      return show(ctx, `🔍 Заказы по запросу «${esc(v.q)}» (${ids.length}):`, kb);
    }
    case 'prods':
      return prodList(ctx, v.cat, v.page);
    case 'psearch': {
      const ids = v.ids || [];
      const slice = ids.slice(v.page * PAGE, (v.page + 1) * PAGE).map(findAnyProduct).filter(Boolean);
      const kb = new InlineKeyboard();
      for (const p of slice) kb.text(`${p.name} — ${p.priceAed == null ? 'по запросу' : money(p.priceAed)}`, `adm:p:${p.id}`).row();
      if (!slice.length) kb.text('—', 'noop');
      kb.row().text('🍸 Коллекции', 'adm:cat:root').text('← Меню', 'adm:menu');
      pager(kb, { ...v, pageCount: Math.max(1, Math.ceil(ids.length / PAGE)) });
      return show(ctx, `🔍 Товары по запросу «${esc(v.q)}» (${ids.length}):`, kb);
    }
    case 'users': {
      const users = tgUsers().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      const slice = users.slice(v.page * PAGE, (v.page + 1) * PAGE);
      const kb = new InlineKeyboard();
      for (const u of slice) kb.text(`${userTitle(u.id).slice(0, 34)} · ${u.ordersCount || 0} зак.`, `adm:u:${u.id}`).row();
      if (!slice.length) kb.text('Пока никто не писал в бота.', 'noop');
      const guests = Object.values(db.users || {}).filter((u) => u.isGuest).length;
      kb.row().text('← Меню', 'adm:menu');
      pager(kb, { ...v, pageCount: Math.max(1, Math.ceil(users.length / PAGE)) });
      return show(ctx, `👥 <b>Клиенты</b> · ${users.length} (гостей сайта: ${guests})`, kb);
    }
    case 'threads': {
      const threads = listThreads();
      const slice = threads.slice(v.page * PAGE, (v.page + 1) * PAGE);
      const kb = new InlineKeyboard();
      for (const t of slice) {
        const last = t.messages[t.messages.length - 1];
        const who = userTitle(t.userId).slice(0, 24);
        const tail = last ? ` · ${esc(last.text.replace(/\s+/g, ' ').slice(0, 26))}` : '';
        kb.text(`${t.unreadAdmin ? '🔴' : '💬'} ${who}${t.unreadAdmin ? ` (${t.unreadAdmin})` : ''}${tail}`, `adm:sup:${t.userId}`).row();
      }
      if (!slice.length) kb.text('Обращений пока нет.', 'noop');
      kb.row().text('← Меню', 'adm:menu');
      pager(kb, { ...v, pageCount: Math.max(1, Math.ceil(threads.length / PAGE)) });
      return show(ctx, `💬 <b>Поддержка</b> · диалогов: ${threads.length}`, kb);
    }
    default:
      return show(ctx, 'Раздел не найден.', new InlineKeyboard().text('← Меню', 'adm:menu'));
  }
}

// ── утилиты ──
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const ts = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

function chunkText(text, size = 3800) {
  const out = [];
  let rest = String(text);
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = rest.lastIndexOf(' ', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
