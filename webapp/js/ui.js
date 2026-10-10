import { assetUrl, published, imageSources } from './assets.js';

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
 * Товарный кадр — обычный <img src="…jpg">. Никакого <picture>/<source>,
 * lazy-loading и гейта по событию load: WebView Telegram и кэши SW иногда
 * теряют эти события, и карточка оставалась пустой. JPEG-URL берётся из
 * реестра релиза (с версией-хешем), поэтому кадр всегда адресуется напрямую.
 * При ошибке загрузки initFrames() переключает на полный кадр и затем на
 * placeholder — пустого места не остаётся.
 */
export function productImg(product, cls = '', variant = 'card') {
  const base = product.image || '';
  const fallback = published(`assets/products/fb-${product.id}.jpg`);
  const full = base ? assetUrl(base) : fallback || '/assets/brand/placeholder.svg';
  const card = published(base.replace(/\.jpg$/, '-card.jpg')) || full;
  const src = variant === 'full' ? full : card;
  return `<span class="pshot ${cls}">
    <img src="${esc(src)}" alt="${esc(product.name)}" decoding="async"
      data-full="${esc(full)}" data-fb="${esc(fallback)}">
    <i class="rim" aria-hidden="true"></i>
  </span>`;
}

/** Обложки коллекций — тот же прямой <img>, без кодеков и гейта. */
export function coverImg(collId, product, cls = '') {
  const base = product?.image || '';
  const fb = published(base.replace(/\.jpg$/, '-card.jpg')) || assetUrl(base);
  const url = published(`assets/covers/${collId}.jpg`) || fb || '/assets/brand/placeholder.svg';
  return `<span class="pshot ccover ${cls}">
    <img src="${esc(url)}" alt="${esc(product?.name || collId)}" decoding="async"
      data-fb="${esc(fb)}">
    <i class="rim" aria-hidden="true"></i>
  </span>`;
}

export function plural(n, one, many) {
  return n === 1 ? one : many;
}

/** Codec URLs are supplied by the server registry, not string guesses. */
export function sources(jpgUrl) {
  return imageSources(jpgUrl);
}

export function withExt(url, ext) {
  return String(url).replace(/\.jpg(?=$|[?#])/i, `.${ext}`);
}

/**
 * Служебные слушатели кадров: фолбэк по 404 и blur-up проявление. Вешаются
 * один раз на document в фазе capture — load/error не всплывают, но сверху
 * вниз доходят, поэтому работают и для экранов, вставленных позже.
 */
export function initFrames() {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const shot = img.closest('.pshot');
    if (!shot && !img.closest('.hero .slide')) return;
    // сначала убираем <source>: пока они на месте, браузер берёт их, а не src
    const codecs = img.parentElement?.querySelectorAll('source');
    if (codecs?.length) {
      codecs.forEach((s) => s.remove());
      const jpeg = img.getAttribute('src');
      img.removeAttribute('src');
      img.src = jpeg;
      return;
    }
    const { full, fb } = img.dataset;
    if (full && !img.dataset.triedFull) {
      img.dataset.triedFull = '1';
      img.src = full;                       // карточки нет → пробуем 4K
      return;
    }
    if (fb && !img.dataset.triedFb) {
      img.dataset.triedFb = '1';
      shot?.classList.add('fb');             // нет и 4K → галерейная панель
      shot?.style.setProperty('--shot', `url('${fb}')`);
      img.src = fb;
      return;
    }
    shot?.classList.add('fb');
    if (!img.dataset.triedPlaceholder) {
      img.dataset.triedPlaceholder = '1';
      img.src = '/assets/brand/placeholder.svg';
    }
  }, true);

  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement) revealOne(img);
  }, true);
}

/** Кадр пришёл — шторка уходит: .pshot/.slide/.hero получают .ready. */
function revealOne(img) {
  img.closest('.pshot')?.classList.add('ready');
  const slide = img.closest('.hero .slide');
  if (slide) {
    slide.classList.add('ready');
    slide.closest('.hero')?.classList.add('ready');
  }
}

/**
 * Кадры из HTTP-кэша часто готовы ещё до вставки экрана в DOM — по ним load
 * уже отыграл. Проходим по дереву и проявляем то, что загружено; вызывается
 * после каждого перехода экрана (см. app.js).
 */
export function reveal(root) {
  if (!root?.querySelectorAll) return;
  for (const img of root.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth > 0) revealOne(img);
  }
}

/**
 * Раунд 8 (a11y-проход): связываем <label> с полем по for/id и превращаем
 * группы .opts в настоящие radiogroup с role=radio + aria-checked. Делается
 * общим проходом по новому экрану, чтобы не трогать каждую вьюху отдельно.
 */
let a11ySeq = 0;
export function a11y(root) {
  if (!root?.querySelectorAll) return;
  for (const label of root.querySelectorAll('label:not([for])')) {
    const field = label.closest('.field') || label.parentElement;
    const control = field?.querySelector('input, textarea, select');
    if (!control) continue;
    if (!control.id) control.id = `f-${++a11ySeq}`;
    label.setAttribute('for', control.id);
  }
  for (const group of root.querySelectorAll('.opts')) {
    group.setAttribute('role', 'radiogroup');
    for (const opt of group.querySelectorAll('.opt')) {
      opt.setAttribute('role', 'radio');
      opt.setAttribute('aria-checked', String(opt.classList.contains('on')));
    }
  }
}

/** Держим aria-checked в sync после переключения опции (вызывается по клику). */
export function syncRadio(opt) {
  const group = opt.closest('.opts');
  if (!group) return;
  for (const o of group.querySelectorAll('.opt')) {
    o.setAttribute('aria-checked', String(o.classList.contains('on')));
  }
}
