/**
 * Переиспользуемые компоненты витрины.
 */
import { icons } from './icons.js';
import { h, esc, priceHtml, productImg } from './ui.js';
import { state, toggleFavorite, addToCart, cartCount } from './state.js';
import { go } from './router.js';
import { tg } from './tg.js';
import { toast } from './ui.js';

export function navbar({ title, back: showBack = false, right = '', brand = false, sub = false } = {}) {
  return h(`
    <header class="navbar">
      ${showBack
        ? `<button class="nav-btn" data-act="back" aria-label="Back">${icons.back}</button>`
        : ''}
      ${brand
        ? `<div class="nav-brand">
             <span class="mark">${icons.glass}</span>
             <b>${esc(state.config?.brand?.name || 'Cocktail Embassy')}</b>
           </div>`
        : `<div class="nav-title ${sub ? 'small' : ''}">${esc(title || '')}</div>`}
      <nav class="nav-links">
        <button data-nav="/">Home</button>
        <button data-nav="/collections">Collections</button>
        <button data-nav="/cart">Cart</button>
        <button data-nav="/profile">Account</button>
      </nav>
      ${right}
    </header>`);
}

export function tabbar(active) {
  const count = cartCount();
  const tabs = [
    ['/', 'home', 'Home'],
    ['/collections', 'grid', 'Collections'],
    ['/cart', 'bag', 'Cart'],
    ['/profile', 'user', 'Profile'],
  ];
  return h(`
    <nav class="tabbar">
      ${tabs.map(([path, ic, label]) => `
        <button class="tab ${active === path ? 'on' : ''}" data-tab="${path}">
          ${icons[ic]}
          <span>${label}</span>
          ${path === '/cart' && count ? `<i class="badge">${count}</i>` : ''}
        </button>`).join('')}
    </nav>`);
}

export function productCard(product) {
  const fav = state.favorites.includes(product.id);
  const inCart = state.cart.some((it) => it.id === product.id);
  const coll = state.categories.find((c) => c.id === product.collection);
  // .picked — позиция уже выбрана (лежит в корзине): rim glow горит постоянно,
  // но не на полную силу; hover/тап докручивают его до максимума (см. app.css)
  return h(`
    <article class="pcard ${inCart ? 'picked' : ''}" data-product="${product.id}"
             tabindex="0" role="link" aria-label="${esc(product.name)}">
      <div class="ph">
        ${productImg(product)}
        <div class="flags">
          ${product.isNew ? '<i class="flag new">New</i>' : ''}
          ${product.isHit && !product.isNew ? '<i class="flag">Hit</i>' : ''}
        </div>
        <button class="fav ${fav ? 'on' : ''}" data-fav="${product.id}" aria-label="Favorite">
          ${fav ? filledHeart() : icons.heart}
        </button>
      </div>
      <div class="info">
        <span class="coll">${esc(coll?.title || product.collection)}</span>
        <span class="name">${esc(product.name)}</span>
        <span class="spec">${product.volumeMl ? `${product.volumeMl} ml` : ''}${product.heightMm ? ` · H ${product.heightMm} mm` : ''}</span>
        <div class="foot">
          ${priceHtml(product)}
          <button class="add ${inCart ? 'in' : ''}" data-add="${product.id}" aria-label="Add to cart">
            ${inCart ? icons.check : icons.plus}
          </button>
        </div>
      </div>
    </article>`);
}

const filledHeart = () => icons.heart.replace('<svg', '<svg fill="currentColor"');

export function grid(products) {
  return h(`<div class="grid">${products.map((p) => productCard(p).outerHTML).join('')}</div>`);
}

export function stepper(id, qty) {
  return h(`
    <div class="stepper" data-stepper="${id}">
      <button data-step="-1" aria-label="Less">${icons.minus}</button>
      <b>${qty}</b>
      <button data-step="1" aria-label="More">${icons.plus}</button>
    </div>`);
}

export function emptyState(ic, title, text, cta) {
  return h(`
    <div class="empty">
      <div class="ic">${icons[ic]}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${cta ? `<button class="btn ghost sm" data-go="${cta[1]}">${esc(cta[0])}</button>` : ''}
    </div>`);
}

/** Делегированные обработчики карточек/табов — вешаются один раз на shell. */
export function bindShell(root) {
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-nav],[data-go],[data-fav],[data-add],[data-act],[data-product],[data-step]');
    if (!t) return;

    if (t.dataset.tab) { go(t.dataset.tab); return; }
    if (t.dataset.nav) { go(t.dataset.nav); return; }
    if (t.dataset.go) { go(t.dataset.go); return; }
    if (t.dataset.act === 'back') { history.back(); return; }

    if (t.dataset.fav) {
      e.stopPropagation();
      const id = t.dataset.fav;
      const on = await toggleFavorite(id);
      t.classList.toggle('on', on);
      t.innerHTML = on ? filledHeart() : icons.heart;
      tg.haptic('light');
      return;
    }

    if (t.dataset.add) {
      e.stopPropagation();
      const id = t.dataset.add;
      const product = state.products.find((p) => p.id === id);
      if (product?.priceAed == null) {
        toast('This piece is made to order — request a price');
        go(`/product/${id}`);
        return;
      }
      await addToCart(id, 1);
      t.classList.add('in');
      t.innerHTML = icons.check;
      t.closest('.pcard')?.classList.add('picked');  // карточка «выбрана» — glow нарастает
      tg.haptic('success');
      toast(`${product.name} added to cart`);
      return;
    }

    if (t.dataset.step) {
      const wrap = t.closest('[data-stepper]');
      const id = wrap.dataset.stepper;
      const delta = Number(t.dataset.step);
      const item = state.cart.find((it) => it.id === id);
      if (!item) return;
      const { setQty, removeFromCart } = await import('./state.js');
      if (item.qty + delta <= 0) await removeFromCart(id);
      else await setQty(id, item.qty + delta);
      tg.haptic('light');
      return;
    }

    if (t.dataset.product) {
      selectCard(t);
      go(`/product/${t.dataset.product}`);
    }
  });

  // клавиатура: карточка — ссылка, Enter/Space открывают её с тем же разгоном glow
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target.closest?.('[data-product]');
    if (!t) return;
    e.preventDefault();
    selectCard(t);
    go(`/product/${t.dataset.product}`);
  });
}

/** Подсвечивает выбранную карточку до перехода: уходящий экран видно ~240 ms. */
function selectCard(card) {
  const el = card.closest('.pcard') || card;
  el.classList.add('sel');
  tg.haptic('light');
  setTimeout(() => el.classList.remove('sel'), 700);
}
