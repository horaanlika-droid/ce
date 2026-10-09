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
 * Раунд 8 — три формата одного кадра: `<picture>` с AVIF (q55, ≈1/12 веса
 * JPEG) и WebP (q70, ≈1/5); JPEG остаётся фолбэком для WebView Telegram и
 * старых браузеров. Производные пишет `build_photos.py --derive-only` из того
 * же финального кадра, поэтому оптика и кромка = --bg у всех трёх совпадают.
 * Пока кадр едет, контейнер держит блюр-подложку --shot, а сам кадр
 * проявляется (opacity 0→1 + scale 1.04→1, класс .ready — см. initFrames).
 *
 * variant: 'card' (по умолчанию) | 'full' (4K).
 */
export function productImg(product, cls = '', variant = 'card') {
  const base = product.image || '';
  const full = assetUrl(base);
  const card = assetUrl(base.replace(/\.jpg$/, '-card.jpg'));
  const src = variant === 'full' ? full : card;
  const fb = assetUrl(`assets/products/fb-${product.id}.jpg`);
  // цепочку фолбэков 404 (карточка → 4K → fb-панель) ведёт initFrames(): внутри
  // <picture> подмена src не спасает, пока живы <source>
  return `<span class="pshot ${cls}" style="--shot:url('${card}')">
    <picture>${sources(src)}
      <img src="${src}" alt="${esc(product.name)}" loading="lazy" decoding="async"
        data-full="${full}" data-fb="${fb}">
    </picture>
    <i class="rim" aria-hidden="true"></i>
  </span>`;
}

/**
 * Обложка коллекции (раунд 7): кадр 1280×720 из того же пайплайна, что и
 * товары, — кладётся в рельс `.coll-row` и в шапку страницы коллекции вместо
 * миниатюры товара. Если обложки нет (404) — фолбэк на productImg-кадр:
 * --shot и src переключаются на карточку товара, панель не ломается.
 */
export function coverImg(collId, product, cls = '') {
  const url = assetUrl(`assets/covers/${collId}.jpg`);
  if (!product) return `<span class="pshot ${cls}"></span>`;
  const fb = assetUrl((product.image || '').replace(/\.jpg$/, '-card.jpg'));
  return `<span class="pshot ccover ${cls}" style="--shot:url('${url}')">
    <picture>${sources(url)}
      <img src="${url}" alt="${esc(product.name)}" loading="lazy" decoding="async"
        data-fb="${fb}">
    </picture>
    <i class="rim" aria-hidden="true"></i>
  </span>`;
}

export function plural(n, one, many) {
  return n === 1 ? one : many;
}

/**
 * Раунд 8 — <source> для <picture>: браузер, который не знает формат, просто
 * пройдёт мимо, поэтому отдельная проверка поддержки не нужна. Расширение
 * подставляется в URL до `?v=`, чтобы метка версии кадров работала и тут.
 */
export function sources(jpgUrl) {
  return `<source type="image/avif" srcset="${withExt(jpgUrl, 'avif')}">
          <source type="image/webp" srcset="${withExt(jpgUrl, 'webp')}">`;
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
    if (!shot) return;
    // сначала убираем <source>: пока они на месте, браузер берёт их, а не src
    img.parentElement?.querySelectorAll('source').forEach((s) => s.remove());
    const { full, fb } = img.dataset;
    if (full && !img.dataset.triedFull) {
      img.dataset.triedFull = '1';
      img.src = full;                       // карточки нет → пробуем 4K
      return;
    }
    if (fb && !img.dataset.triedFb) {
      img.dataset.triedFb = '1';
      shot.classList.add('fb');             // нет и 4K → галерейная панель
      shot.style.setProperty('--shot', `url('${fb}')`);
      img.src = fb;
      return;
    }
    shot.classList.add('fb');
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
