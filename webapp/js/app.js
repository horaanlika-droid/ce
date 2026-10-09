/**
 * Точка входа витрины: boot, shell, роуты, переходы экранов.
 */
import { boot, state, subscribe, cartCount } from './state.js';
import { route, start, go, currentPath, stackDepth } from './router.js';
import { tabbar, bindShell } from './components.js';
import { h, initFrames, reveal, a11y, syncRadio } from './ui.js';
import { initTilt } from './tilt.js';
import { tg, inTelegram } from './tg.js';

import * as home from './views/home.js';
import * as collections from './views/collections.js';
import * as product from './views/product.js';
import * as cart from './views/cart.js';
import * as checkout from './views/checkout.js';
import * as orders from './views/orders.js';
import * as favorites from './views/favorites.js';
import * as profile from './views/profile.js';
import * as support from './views/support.js';

route('/', home.render);
route('/collections', collections.renderList);
route('/collection/:id', collections.renderCollection);
route('/product/:id', product.render);
route('/cart', cart.render);
route('/checkout', checkout.render, { noTab: true });
route('/success/:id', checkout.renderSuccess, { noTab: true });
route('/orders', orders.renderList, { noTab: true });
route('/order/:id', orders.renderDetail, { noTab: true });
route('/favorites', favorites.render, { noTab: true });
route('/profile', profile.render);
route('/about', profile.renderAbout, { noTab: true });
route('/support', support.render, { noTab: true });

const TABS = ['/', '/collections', '/cart', '/profile'];

async function main() {
  await boot();

  // раунд 8: кадры (фолбэк по 404 + blur-up проявление) и tilt-параллакс
  initFrames();
  initTilt();
  registerSW();

  const app = document.getElementById('app');
  app.hidden = false;
  app.appendChild(h('<div class="shell"><div class="stack"></div></div>'));
  const shell = app.firstElementChild;
  const stackEl = shell.querySelector('.stack');
  const bar = tabbar('/');
  bar.hidden = false;
  shell.appendChild(bar);
  bindShell(shell);

  function refreshBar(path, hidden) {
    const active = TABS.includes(path) ? path : '';
    const next = tabbar(active);
    next.hidden = hidden;
    shell.querySelector('.tabbar')?.replaceWith(next);
    // активный пункт десктоп-навигации
    for (const b of next.parentElement?.querySelectorAll('.nav-links button') || []) {
      b.classList.toggle('on', b.dataset.nav === path);
    }
    return next;
  }

  subscribe((ev) => {
    if (ev === 'cart') {
      const path = currentPath();
      const cur = shell.querySelector('.tabbar');
      const replaced = refreshBar(path, cur?.hidden || false);
      void replaced;
    }
  });

  // держим aria-checked у radio-опций (.opts) в sync после переключения
  shell.addEventListener('click', (e) => {
    const opt = e.target.closest?.('.opt');
    if (opt) setTimeout(() => syncRadio(opt), 0);
  });

  await start((screen, { first, isBack, prevEl, opts = {} }) => {
    stackEl.appendChild(screen);
    reveal(screen);          // кадры из кэша уже готовы — проявляем без ожидания load
    a11y(screen);            // label↔поле, radiogroup/aria-checked
    if (!first) {
      screen.classList.add(isBack ? 'enter-below' : 'enter');
      if (prevEl) {
        prevEl.classList.add(isBack ? 'leave-back' : 'leave');
        setTimeout(() => {
          prevEl.remove();
          prevEl._cleanup?.();
        }, 460);
      }
    }
    const path = currentPath();
    refreshBar(path, Boolean(opts.noTab));
    for (const b of shell.querySelectorAll('.nav-links button')) {
      b.classList.toggle('on', b.dataset.nav === path);
    }
    // скролл-контейнер нового экрана — наверх
    screen.querySelector('.scroll')?.scrollTo(0, 0);
  });

  // deep-links: ?order=CE-1 / start_param=order_CE-1
  const qOrder = new URLSearchParams(location.search).get('order');
  const sParam = tg.startParam;
  const target = sParam?.startsWith('order_') ? sParam.slice(6) : qOrder;
  if (target) go(`/order/${target}`);

  document.getElementById('boot').classList.add('done');
  if (inTelegram) tg.expand();
}

/**
 * Раунд 8 — PWA-невесомость: оболочка и открытые ранее кадры живут в
 * Cache Storage, повторное открытие работает без сети. В Telegram WebView
 * не регистрируем: там свой кэш, а SW только мешал бы обновлению.
 * Путь абсолютный — иначе на /product/AG0001 браузер искал бы /product/sw.js.
 */
function registerSW() {
  if (inTelegram) return;
  if (!('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !local) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* офлайн — не критично */ });
  });
}

main().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.innerHTML = '<div class="boot-name">Connection problem…</div>';
});
