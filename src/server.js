/**
 * HTTP-сервер: раздаёт витрину и обслуживает API.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, paymentMethods, ROOT, assetsVersion, notePublicUrl } from './config.js';
import { db, save, upsertUser } from './store.js';
import { validateInitData } from './lib/telegram-auth.js';
import {
  publicProducts, findProduct, getCategories, getBrand,
  getDeliveryInfo, getShopSettings, getTexts, catalogStatus,
} from './catalog.js';
import {
  createOrder, getOrder, userOrders, updateOrder, markPaid,
  normalizeItems, computeTotals, DELIVERY_METHODS, ORDER_STATUSES,
} from './orders.js';
import { addUserMessage, getThread, markUserRead } from './support.js';
import { renderInvoiceHtml, invoiceSummary } from './payments/invoice.js';
import * as yookassa from './payments/yookassa.js';

const WEBAPP_DIR = path.join(ROOT, 'webapp');

export function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '8mb' }));

  // Lazy-детект публичного URL: хостинг (Bothost) не всегда прокидывает
  // домен переменной — берём его из заголовка Host первого публичного
  // запроса и используем для кнопки Mini App, ссылок t.me?startapp и og.
  app.use((req, res, next) => {
    notePublicUrl(req.get('host'), req.get('x-forwarded-proto') || 'https');
    next();
  });

  // ─── авторизация ─────────────────────────────────────────────
  // В Telegram проверяется подпись initData. В обычном браузере магазин
  // открывается без авторизации: гостевой профиль с подписанной cookie.
  const GUEST_COOKIE = 'ce_guest';
  const GUEST_COOKIE_MAX_AGE = 365 * 24 * 3600 * 1000;

  function guestSecret() {
    if (!db.settings.guestSecret) {
      db.settings.guestSecret = crypto.randomBytes(24).toString('hex');
      save();
    }
    return db.settings.guestSecret;
  }

  function signGuestId(id) {
    return crypto.createHmac('sha256', guestSecret()).update(`guest:${id}`).digest('base64url');
  }

  function readGuestCookie(req) {
    for (const part of (req.get('cookie') || '').split(';')) {
      const i = part.indexOf('=');
      if (i === -1 || part.slice(0, i).trim() !== GUEST_COOKIE) continue;
      const m = part.slice(i + 1).trim().match(/^(-\d+)\.([A-Za-z0-9_-]{1,64})$/);
      if (!m) return 0;
      const id = Number(m[1]);
      const sig = Buffer.from(m[2]);
      const calc = Buffer.from(signGuestId(id));
      if (sig.length === calc.length && crypto.timingSafeEqual(sig, calc)) return id;
      return 0;
    }
    return 0;
  }

  function authenticate(req, res, next) {
    const initData = req.get('X-Telegram-Init-Data') || '';
    if (initData && config.telegram.token) {
      const result = validateInitData(initData, config.telegram.token);
      if (result.ok) {
        req.user = upsertUser(result.user);
        req.viaTelegram = true;
        return next();
      }
      console.warn(`[auth] initData rejected (${result.reason}) — continuing as guest`);
    }

    let guestId = readGuestCookie(req);
    if (!guestId) {
      guestId = -Math.floor(Math.random() * 2_000_000_000) - 1;
      res.setHeader('Set-Cookie',
        `${GUEST_COOKIE}=${guestId}.${signGuestId(guestId)}; Path=/; Max-Age=${GUEST_COOKIE_MAX_AGE / 1000}; HttpOnly; SameSite=Lax`);
    }
    req.user = upsertUser({ id: guestId, isGuest: true, first_name: 'Guest' });
    req.guest = true;
    next();
  }

  const api = express.Router();
  api.use(authenticate);

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[api]', err);
      if (!res.headersSent) res.status(400).json({ error: err.message || 'error' });
    });
  };

  // ─── конфигурация витрины ─────────────────────────────────────
  api.get('/config', wrap((req, res) => {
    const shop = getShopSettings();
    res.json({
      brand: getBrand(),
      delivery: {
        ...getDeliveryInfo(),
        methods: Object.entries(DELIVERY_METHODS).map(([id, m]) => ({ id, ...m })),
        freeFrom: shop.freeShippingFrom,
        cost: shop.shippingCost,
      },
      shop,
      texts: getTexts(),
      payments: paymentMethods(),
      statuses: ORDER_STATUSES,
      currency: { ...config.currency, rate: getShopSettings().usdRate },
      user: req.user,
      guest: Boolean(req.guest),
      botUsername: config.telegram.username,
      supportEnabled: true,
      assetsV: assetsVersion(),
    });
  }));

  api.get('/catalog', wrap((req, res) => {
    res.json({ categories: getCategories(), products: publicProducts() });
  }));

  // ─── избранное ────────────────────────────────────────────────
  api.get('/favorites', wrap((req, res) => {
    res.json({ ids: db.favorites[String(req.user.id)] || [] });
  }));

  api.post('/favorites/:id', wrap((req, res) => {
    const key = String(req.user.id);
    const list = new Set(db.favorites[key] || []);
    const id = req.params.id;
    if (!findProduct(id)) throw new Error('Product not found');
    if (list.has(id)) list.delete(id);
    else list.add(id);
    db.favorites[key] = [...list];
    save();
    res.json({ ids: db.favorites[key] });
  }));

  // ─── корзина ──────────────────────────────────────────────────
  api.get('/cart', wrap((req, res) => {
    res.json({ items: db.carts[String(req.user.id)] || [] });
  }));

  api.put('/cart', wrap((req, res) => {
    const items = (req.body?.items || [])
      .filter((it) => findProduct(it.id))
      .map((it) => ({ id: String(it.id), qty: Math.max(1, Math.min(999, Number(it.qty) || 1)) }));
    db.carts[String(req.user.id)] = items;
    save();
    res.json({ items });
  }));

  api.post('/cart/quote', wrap((req, res) => {
    const totals = computeTotals(req.body?.items, req.body?.deliveryMethod);
    res.json(totals);
  }));

  // ─── заказы ───────────────────────────────────────────────────
  api.get('/orders', wrap((req, res) => {
    res.json({ orders: userOrders(req.user.id) });
  }));

  api.get('/orders/:id', wrap((req, res) => {
    const order = getOrder(req.params.id);
    if (!order || order.userId !== req.user.id) return res.status(404).json({ error: 'not-found' });
    res.json({ order, invoice: order.invoiceNumber ? invoiceSummary(order) : null });
  }));

  api.post('/orders', wrap(async (req, res) => {
    const body = req.body || {};
    const method = body.paymentMethod;
    const available = paymentMethods().filter((m) => m.enabled).map((m) => m.id);
    if (!available.includes(method)) throw new Error('Payment method is not available');
    if (!body.customer?.name || !body.customer?.phone) throw new Error('Name and phone are required');
    if (method === 'invoice' && !body.company?.name) {
      throw new Error('Company name is required for an invoice');
    }

    const order = createOrder({
      userId: req.user.id,
      items: body.items,
      customer: body.customer,
      delivery: body.delivery,
      paymentMethod: method,
      company: body.company,
      comment: body.comment,
    });

    db.carts[String(req.user.id)] = [];
    save();

    const payload = { order };

    if (method === 'yookassa') {
      const returnUrl = req.viaTelegram && config.telegram.username
        ? `https://t.me/${config.telegram.username}?startapp=order_${order.id}`
        : `${config.publicUrl || ''}/?order=${order.id}`;
      try {
        const payment = await yookassa.createPayment(order, { returnUrl });
        updateOrder(order.id, { payment: { provider: 'yookassa', id: payment.id }, paymentStatus: 'pending' });
        payload.confirmationUrl = payment.confirmation_url;
      } catch (err) {
        updateOrder(order.id, { paymentError: err.message });
        throw err;
      }
    }

    if (method === 'invoice') payload.invoice = invoiceSummary(order);
    res.json(payload);
  }));

  api.post('/orders/:id/check', wrap(async (req, res) => {
    const order = getOrder(req.params.id);
    if (!order || order.userId !== req.user.id) return res.status(404).json({ error: 'not-found' });
    if (order.paymentStatus === 'paid') return res.json({ order, paid: true });

    if (order.paymentMethod === 'yookassa' && order.payment?.id) {
      const payment = await yookassa.getPayment(order.payment.id);
      if (payment.paid || payment.status === 'succeeded') {
        markPaid(order, { provider: 'yookassa', id: payment.id, method: payment.payment_method }, 'yookassa');
        return res.json({ order, paid: true });
      }
      if (payment.status === 'canceled') {
        updateOrder(order.id, { paymentStatus: 'canceled', status: 'canceled' });
        return res.json({ order, paid: false, canceled: true });
      }
    }
    res.json({ order, paid: false });
  }));

  api.post('/orders/:id/cancel', wrap((req, res) => {
    const order = getOrder(req.params.id);
    if (!order || order.userId !== req.user.id) return res.status(404).json({ error: 'not-found' });
    if (order.paymentStatus === 'paid') throw new Error('Paid orders are canceled by a manager — contact support');
    updateOrder(order.id, { status: 'canceled', paymentStatus: 'canceled' }, 'user');
    res.json({ order });
  }));

  // ─── поддержка ────────────────────────────────────────────────
  api.get('/support', wrap((req, res) => {
    const thread = getThread(req.user.id);
    markUserRead(req.user.id);
    res.json({ messages: thread.messages, status: thread.status, online: true });
  }));

  api.post('/support', wrap((req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) throw new Error('Empty message');
    const message = addUserMessage(req.user, text, req.body?.context ? { context: req.body.context } : {});
    res.json({ message });
  }));

  api.get('/support/updates', wrap((req, res) => {
    const since = Number(req.query.since || 0);
    const thread = getThread(req.user.id, false);
    const messages = (thread?.messages || []).filter((m) => m.at > since);
    if (messages.length) markUserRead(req.user.id);
    res.json({ messages, now: Date.now() });
  }));

  app.use('/api', api);

  // ─── вебхук эквайринга ────────────────────────────────────────
  app.post('/webhook/yookassa', express.json(), async (req, res) => {
    try {
      const event = req.body?.event;
      const obj = req.body?.object || {};
      const order = obj.metadata?.orderId ? getOrder(obj.metadata.orderId) : null;
      if (order && event === 'payment.succeeded') {
        markPaid(order, { provider: 'yookassa', id: obj.id, method: obj.payment_method }, 'webhook');
      }
      if (order && event === 'payment.canceled') {
        updateOrder(order.id, { paymentStatus: 'canceled', status: 'canceled' });
      }
    } catch (err) {
      console.error('[webhook]', err);
    }
    res.json({ ok: true });
  });

  // ─── печатная форма счёта ─────────────────────────────────────
  app.get('/invoice/:id', authenticate, (req, res) => {
    const order = getOrder(req.params.id);
    if (!order || (order.userId !== req.user.id && !config.telegram.adminIds.includes(Number(req.user.id)))) {
      return res.status(404).send('Not found');
    }
    if (!order.invoiceNumber) return res.status(404).send('No invoice for this order');
    res.type('html').send(renderInvoiceHtml(order));
  });

  app.get('/health', (req, res) => {
    // Всегда 200 — иначе хостинг начнёт перезапускать контейнер по кругу
    // из-за проблемы, которую перезапуск не лечит (например, нет catalog.json).
    // Подробности видны в теле ответа и в логах старта.
    const cat = catalogStatus();
    res.json({
      ok: true,
      app: 'cocktail-embassy',
      time: new Date().toISOString(),
      catalog: { ok: cat.ok, products: cat.products, file: cat.file, error: cat.error },
      dataDir: config.dataDir,
    });
  });

  // index: false — корень отдаёт app.get('*') ниже, с абсолютными og-тегами
  app.use(express.static(WEBAPP_DIR, {
    index: false,
    setHeaders(res, filePath) {
      // раунд 8: старый mime в express не знает .avif — отдаём верный тип,
      // иначе <picture> получит octet-stream и пропустит производный кадр
      if (filePath.endsWith('.avif')) res.setHeader('Content-Type', 'image/avif');
      else if (filePath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
      else if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
      // 4K-кадры тяжёлые (≈0.6 МБ): неделю кэша + immutable, а перегонку стиля
      // ловит метка ?v= из assetsVersion() — старые файлы под тем же именем
      if (/assets\//.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  app.get('*', (req, res) => {
    // og:image в файле относительный; превью-валидаторам Telegram/WhatsApp
    // нужен абсолютный — подставляем PUBLIC_URL на лету
    let html = fs.readFileSync(path.join(WEBAPP_DIR, 'index.html'), 'utf8');
    const pub = config.publicUrl;
    if (pub) {
      html = html.split('content="/assets/').join(`content="${pub}/assets/`)
                 .split('href="/assets/').join(`href="${pub}/assets/`);
      if (!html.includes('og:url')) {
        html = html.replace('<meta property="og:type"',
          `<meta property="og:url" content="${pub}/">\n  <meta property="og:type"`);
      }
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  });

  return app;
}
