/**
 * Точка входа витрины: boot, shell, роуты, переходы экранов.
 */
import { boot, state, subscribe, cartCount } from './state.js';
import { route, start, go, currentPath, stackDepth } from './router.js';
import { tabbar, bindShell } from './components.js';
import { h } from './ui.js';
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

  await start((screen, { first, isBack, prevEl, opts = {} }) => {
    stackEl.appendChild(screen);
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

main().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.innerHTML = '<div class="boot-name">Connection problem…</div>';
});
