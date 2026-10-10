/**
 * Главная: hero-слайдер, коллекции, популярное, ценности бренда.
 */
import { h, esc } from '../ui.js';
import { icons } from '../icons.js';
import { assetUrl, imageSources } from '../assets.js';
import { state } from '../state.js';
import { navbar, productCard, navActions, collectionRow } from '../components.js';
import { go } from '../router.js';

const HEROES = ['01', '02', '03', '04', '05'];
const CAPS = ['Serves that catch the light', 'Crystal, blown by hand', 'Built for the bar shift', 'From Dubai, worldwide'];

/**
 * Слайд hero в трёх форматах (раунд 8): AVIF → WebP → JPEG, и по каждому —
 * десктоп 1920×1080 / мобильный 1080×1350. Порядок <source> важен: браузер
 * берёт первый, у которого сошёлся и media, и type.
 */
function heroSources(n) {
  const desk = assetUrl(`assets/app/hero-${n}.jpg`);
  const mob = assetUrl(`assets/app/hero-${n}-m.jpg`);
  return imageSources(desk, '(min-width: 768px)')
    + `<source media="(min-width: 768px)" srcset="${desk}">`
    + imageSources(mob);

}

export async function render() {
  const brand = state.config.brand;
  const texts = state.config.texts;
  const featured = state.products.filter((p) => p.isHit || p.isNew);
  const popular = (featured.length ? featured : state.products).slice(0, 8);

  const el = h(`<div>
    ${navbar({ brand: true, right: navActions() })}
    <div class="scroll">
      <section class="hero" data-hero aria-roledescription="carousel"
               aria-label="Cocktail Embassy — light and glass" aria-live="off">
        <div class="slides" id="hero-slides">
          ${HEROES.map((n, i) => `
            <div class="slide" role="group" aria-roledescription="slide"
                 aria-label="${i + 1} of ${HEROES.length}"${i === 0 ? '' : ' aria-hidden="true"'}>
              <picture>${heroSources(n)}
                <img src="${assetUrl(`assets/app/hero-${n}-m.jpg`)}" alt=""
                     decoding="async"${i === 0 ? '' : ' loading="lazy"'}>
              </picture>
              ${i === 0 ? `
              <div class="cap">
                <span class="eyebrow">${esc(brand.tagline)}</span>
                <h1>${esc(texts.welcome)}</h1>
                <p>${esc(brand.subtitle || '')}</p>
                <button class="btn cta" data-go="/collections">Explore Collection ${icons.arrow}</button>
              </div>` : `
              <div class="cap">
                <span class="eyebrow">Cocktail Embassy · ${esc(brand.location || 'Dubai')}</span>
                <h1>${esc(CAPS[i - 1] || '')}</h1>
              </div>`}
            </div>`).join('')}
        </div>
        <button class="hero-nav prev" data-hero-step="-1" aria-label="Previous slide"
                aria-controls="hero-slides">${icons.chev}</button>
        <button class="hero-nav next" data-hero-step="1" aria-label="Next slide"
                aria-controls="hero-slides">${icons.chev}</button>
        <div class="dots">
          ${HEROES.map((_, i) => `
            <button class="dot ${i === 0 ? 'on' : ''}" data-hero-dot="${i}"
                    aria-label="Slide ${i + 1} of ${HEROES.length}"${i === 0 ? ' aria-current="true"' : ''}>
              <i aria-hidden="true"></i>
            </button>`).join('')}
        </div>
      </section>

      <section class="section wrap">
        <div class="section-head">
          <h2>Collections</h2>
          <button class="link" data-go="/collections">View all ${icons.arrow}</button>
        </div>
      </section>
      <div class="rail" data-coll-rail></div>

      <section class="section wrap">
        <div class="section-head">
          <h2>Popular now</h2>
          <button class="link" data-go="/collections">Catalog ${icons.arrow}</button>
        </div>
        <div class="grid" data-popular></div>
      </section>

      <section class="section wrap">
        <div class="props">
          <div class="prop"><span class="ic">${icons.spark}</span><div><b>Hand-blown crystal</b><span>Lead-free, ultra-thin, balanced in the hand</span></div></div>
          <div class="prop"><span class="ic">${icons.truck}</span><div><b>Worldwide delivery</b><span>Dubai pickup, UAE next-day, DHL & Aramex</span></div></div>
          <div class="prop"><span class="ic">${icons.shield}</span><div><b>HoReCa grade</b><span>Built for busy shifts and signature serves</span></div></div>
        </div>
      </section>

      <section class="section wrap" style="padding-bottom: 8px;">
        <div class="card" style="padding: 20px; display: grid; gap: 12px;">
          <span class="eyebrow">About</span>
          <p class="mut" style="margin: 0; font-size: 14.5px;">${esc(texts.about)}</p>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            ${brand.instagram ? `<button class="btn ghost sm" data-ext="https://instagram.com/${esc(brand.instagram)}">${icons.insta} Instagram</button>` : ''}
            ${brand.whatsapp ? `<button class="btn ghost sm" data-ext="https://wa.me/${esc(String(brand.whatsapp).replace(/[^0-9]/g, ''))}">${icons.wa} WhatsApp</button>` : ''}
          </div>
        </div>
      </section>
    </div>
  </div>`);

  // collections rail
  const rail = el.querySelector('[data-coll-rail]');
  for (const c of state.categories) {
    const items = state.products.filter((p) => p.collection === c.id);
    if (items.length) rail.appendChild(collectionRow(c, items));
  }

  const pop = el.querySelector('[data-popular]');
  for (const p of popular) pop.appendChild(productCard(p));

  // ── hero: карусель (раунд 8, a11y) ────────────────────────────────────────
  // Автослайд ставится на паузу по наведению и по фокусу внутри (иначе
  // скринридер не успевает дочитать слайд), aria-live переключается off →
  // polite ровно на время паузы. Слайды, которых не видно, скрыты от AT
  // (aria-hidden) и выведены из порядка фокуса (tabindex -1).
  let idx = 0;
  const hero = el.querySelector('[data-hero]');
  const slides = el.querySelector('.slides');
  const slideEls = [...el.querySelectorAll('.slide')];
  const dots = [...el.querySelectorAll('[data-hero-dot]')];

  const goTo = (next) => {
    idx = (next + HEROES.length) % HEROES.length;
    slides.style.transform = `translateX(-${idx * 100}%)`;
    slideEls.forEach((s, i) => {
      const on = i === idx;
      s.setAttribute('aria-hidden', String(!on));
      for (const f of s.querySelectorAll('button, a[href], input')) f.tabIndex = on ? 0 : -1;
    });
    dots.forEach((d, i) => {
      d.classList.toggle('on', i === idx);
      if (i === idx) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
  };

  let paused = false;
  const setPaused = (on) => {
    if (paused === on) return;
    paused = on;
    hero.setAttribute('aria-live', on ? 'polite' : 'off');
  };
  hero.addEventListener('mouseenter', () => setPaused(true));
  hero.addEventListener('mouseleave', () => setPaused(false));
  hero.addEventListener('focusin', () => setPaused(true));
  hero.addEventListener('focusout', (e) => {
    if (!hero.contains(e.relatedTarget)) setPaused(false);
  });

  const timer = setInterval(() => {
    if (!document.body.contains(el)) return clearInterval(timer);
    if (!paused) goTo(idx + 1);
  }, 5200);

  hero.addEventListener('click', (e) => {
    const step = e.target.closest('[data-hero-step]')?.dataset.heroStep;
    const dot = e.target.closest('[data-hero-dot]')?.dataset.heroDot;
    if (step) goTo(idx + Number(step));
    else if (dot != null) goTo(Number(dot));
  });

  // swipe
  let x0 = null;
  hero.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) goTo(idx + (dx < 0 ? 1 : -1));
    x0 = null;
  }, { passive: true });

  goTo(0);
  el._cleanup = () => clearInterval(timer);

  // external links
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    if (b) {
      e.preventDefault();
      (window.Telegram?.WebApp ? window.Telegram.WebApp.openLink(b.dataset.ext) : window.open(b.dataset.ext, '_blank'));
    }
  });

  return el;
}
