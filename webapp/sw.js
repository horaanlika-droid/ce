/*
 * Cocktail Embassy — service worker (раунд 8).
 *
 * Невесомость интерфейса: оболочка и открытые ранее кадры живут в
 * Cache Storage, повторное открытие витрины работает без сети. В Telegram
 * WebView SW не регистрируется (см. js/app.js) — там свой кэш.
 *
 * Стратегии:
 *   навигация  → network-first, при офлайне отдаём кэшированный shell `/`
 *                 (SPA дорисует любой маршрут на клиенте);
 *   оболочка   → cache-first + фоновое обновление (stale-while-revalidate);
 *   кадры      → stale-while-revalidate с LRU-потолком 120 файлов, чтобы
 *                 офлайн открылись недавно просмотренные товары/обложки.
 *
 * Кэш-ключ кадров — полный URL с меткой `?v=` из assetsVersion(): перегонка
 * стиля меняет метку, и браузер сквозь SW добирает свежие файлы сам.
 */

const VERSION = 'ce-r8-1';
const SHELL = `shell-${VERSION}`;
const SHOTS = `shots-${VERSION}`;
const SHOT_LIMIT = 120;
const LRU_KEY = '/__sw_lru_index';

const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/css/base.css',
  '/css/app.css',
  '/js/api.js', '/js/app.js', '/js/assets.js', '/js/components.js', '/js/icons.js',
  '/js/router.js', '/js/state.js', '/js/tg.js', '/js/tilt.js', '/js/ui.js',
  '/js/views/cart.js', '/js/views/checkout.js', '/js/views/collections.js',
  '/js/views/favorites.js', '/js/views/home.js', '/js/views/orders.js',
  '/js/views/product.js', '/js/views/profile.js', '/js/views/support.js',
  '/assets/brand/favicon.png', '/assets/brand/apple-touch-icon.png',
  '/assets/brand/icon-192.png', '/assets/brand/icon-512.png',
  '/assets/brand/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // кладём по одному: единичный 404 не должен ронять весь precache
    await Promise.all(SHELL_URLS.map((u) =>
      fetch(u, { cache: 'reload' })
        .then((r) => { if (r.ok) return c.put(u, r); })
        .catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [SHELL, SHOTS];
    for (const name of await caches.keys()) {
      if (!keep.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function lruTouch(cache, url) {
  let list = [];
  try {
    const r = await cache.match(LRU_KEY);
    if (r) list = await r.json();
  } catch { /* нет индекса — начнём заново */ }
  list = list.filter((k) => k !== url);
  list.push(url);
  while (list.length > SHOT_LIMIT) {
    const old = list.shift();
    await cache.delete(old);
  }
  await cache.put(LRU_KEY, new Response(JSON.stringify(list), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

async function staleWhileRevalidate(req, cacheName, lru) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res.ok) {
      cache.put(req, res.clone()).then(() => (lru ? lruTouch(cache, req.url) : null));
    }
    return res;
  }).catch(() => cached);
  return cached || refresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // telegram.org и др. — мимо

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
        return res;
      }).catch(async () => (await caches.match('/')) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(staleWhileRevalidate(req, SHOTS, true));
    return;
  }

  if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/') ||
      url.pathname === '/manifest.webmanifest') {
    e.respondWith(staleWhileRevalidate(req, SHELL, false));
  }
});
