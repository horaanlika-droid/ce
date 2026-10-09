/**
 * Роутер со стеком экранов и iOS-переходами push/pop.
 * История — в location.hash, поэтому работают свайп «назад» в Telegram
 * и кнопка «назад» браузера/Android.
 */
import { tg } from './tg.js';

const routes = [];
let stack = [];          // [{ path, el }]
let currentRender = null;
let navigating = false;

export function route(pattern, render, opts = {}) {
  routes.push({ pattern, render, opts });
}

function match(path) {
  for (const r of routes) {
    const keys = [];
    const rx = new RegExp('^' + r.pattern.replace(/:[^/]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    const m = path.match(rx);
    if (m) {
      const params = {};
      keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
  }
  return null;
}

export function currentPath() {
  return (location.hash.slice(1) || '/').split('?')[0];
}

export function go(path, { replace = false } = {}) {
  if (replace) location.replace('#' + path);
  else location.hash = path;
}

export function back() {
  if (stack.length > 1) history.back();
  else go('/');
}

export async function start(renderInto) {
  currentRender = renderInto;
  window.addEventListener('hashchange', () => navigate());
  window.addEventListener('popstate', () => {});
  await navigate(true);
}

async function navigate(first = false) {
  if (navigating) return;
  navigating = true;
  const path = currentPath();
  const m = match(path) || match('/');
  const prev = stack[stack.length - 1];
  const isBack = prev && stack.some((s) => s.path === path);

  let el;
  try {
    el = await m.route.render(m.params);
  } catch (err) {
    console.error(err);
    el = document.createElement('div');
    el.textContent = 'Something went wrong';
  }

  const screen = document.createElement('div');
  screen.className = 'screen' + (m.route.opts.noTab ? ' no-tab' : '');
  if (el.querySelector('.scroll')) el.classList.add('page');
  screen.appendChild(el);
  screen._cleanup = () => el._cleanup?.();

  if (isBack) {
    stack = stack.slice(0, stack.findIndex((s) => s.path === path) + 1);
    stack[stack.length - 1] = { path, el: screen };
  } else {
    stack.push({ path, el: screen });
  }

  currentRender(screen, { first, isBack, prevEl: prev?.el, opts: m.route.opts });
  navigating = false;

  // Telegram BackButton
  if (stack.length > 1) tg.backButton.show(() => history.back());
  else tg.backButton.hide();
}

export function stackDepth() {
  return stack.length;
}
