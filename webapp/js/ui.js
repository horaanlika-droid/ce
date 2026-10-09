import { assetUrl } from './assets.js';

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

/**
 * Кадр товара, как в бренд-референсах: тот же кадр, сильно размытый, служит
 * подложкой (заполняет всю область), а сам кадр лежит поверх целиком — так
 * стекло не обрезается ни в карточке 3:4, ни в квадратной сцене.
 * Если студийного кадра ещё нет — включается галерейная панель fb-<COD>.jpg.
 *
 * Разрешение: мастер `<COD>.jpg` — 4K (2576×3840), он нужен большой сцене
 * карточки товара и pinch-zoom. Для сеток, рельсов и миниатюр тот же кадр
 * в размере карточки — `<COD>-card.jpg` (859×1280, ≈65 KB вместо ≈630 KB),
 * иначе 25 тяжёлых файлов в ленте разорвали бы мобильный трафик. Оба файла
 * делает `scripts/build_photos.py`. Подложка-блюр всегда берёт маленький кадр:
 * он всё равно размывается в пятно.
 *
 * variant: 'card' (по умолчанию) | 'full' (4K).
 */
export function productImg(product, cls = '', variant = 'card') {
  const base = product.image || '';
  const full = assetUrl(base);
  const card = assetUrl(base.replace(/\.jpg$/, '-card.jpg'));
  const src = variant === 'full' ? full : card;
  const fb = assetUrl(`assets/products/fb-${product.id}.jpg`);
  // 404 на -card.jpg (пайплайн ещё не прогнан) → сначала пробуем 4K, потом фолбэк
  const retry = variant === 'full'
    ? `this.onerror=null;this.closest('.pshot').classList.add('fb');this.src='${fb}'`
    : `this.onerror=function(){this.onerror=null;this.closest('.pshot').classList.add('fb');this.src='${fb}'};this.src='${full}'`;
  return `<span class="pshot ${cls}" style="--shot:url('${card}')">
    <img src="${src}" alt="${esc(product.name)}" loading="lazy" decoding="async"
      onerror="${retry}">
    <i class="rim" aria-hidden="true"></i>
  </span>`;
}

export function plural(n, one, many) {
  return n === 1 ? one : many;
}
