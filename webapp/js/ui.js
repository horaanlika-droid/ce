/**
 * UI-хелперы: создание DOM, форматирование, toast.
 */
export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function money(v, cur = 'AED') {
  if (v == null) return '—';
  const n = Number(v);
  const s = n % 1 === 0 ? n.toString() : n.toFixed(2).replace(/\.?0+$/, '');
  return `${cur} ${Number(s).toLocaleString('en-US')}`;
}

export function priceHtml(product, cls = '') {
  if (product.priceAed == null) {
    return `<div class="price onreq ${cls}"><span class="aed">Price on request</span></div>`;
  }
  return `<div class="price ${cls}">
    <span class="aed num">${money(product.priceAed)}</span>
    ${product.priceUsd != null ? `<span class="usd num">USD ${product.priceUsd}</span>` : ''}
  </div>`;
}

export function dateStr(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeStr(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

let toastEl = null;
let toastTimer = null;
export function toast(text) {
  if (!toastEl) {
    toastEl = h('<div class="toast"></div>');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  requestAnimationFrame(() => toastEl.classList.add('on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
}

/** Картинка товара с фолбэком на подготовленную студийную панель. */
export function productImg(product, cls = '') {
  const fb = `assets/products/fb-${product.id}.jpg`;
  return `<img class="${cls}" src="${product.image}" alt="${esc(product.name)}" loading="lazy"
    onerror="this.onerror=null;this.src='${fb}'">`;
}

export function plural(n, one, many) {
  return n === 1 ? one : many;
}
