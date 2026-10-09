/**
 * Главная: hero-слайдер, коллекции, популярное, ценности бренда.
 */
import { h, esc, productImg } from '../ui.js';
import { icons } from '../icons.js';
import { assetUrl } from '../assets.js';
import { state } from '../state.js';
import { navbar, productCard } from '../components.js';
import { go } from '../router.js';

const HEROES = ['01', '02', '03', '04', '05'];

export async function render() {
  const brand = state.config.brand;
  const texts = state.config.texts;
  const popular = state.products.filter((p) => p.isHit || p.isNew).slice(0, 8);

  const el = h(`<div>
    ${navbar({ brand: true, right: `<button class="nav-btn" data-go="/support" aria-label="Support">${icons.chat}</button>` })}
    <div class="scroll">
      <section class="hero" data-hero>
        <div class="slides">
          ${HEROES.map((n, i) => `
            <div class="slide">
              <img src="${assetUrl(`assets/brand/hero-${n}.jpg`)}" alt="">
              ${i === 0 ? `
              <div class="cap">
                <span class="eyebrow">${esc(brand.tagline)}</span>
                <h1>${esc(texts.welcome)}</h1>
                <p>${esc(brand.subtitle || '')}</p>
                <button class="btn cta" data-go="/collections">Explore collection ${icons.arrow}</button>
              </div>` : `
              <div class="cap">
                <span class="eyebrow">Cocktail Embassy · ${esc(brand.location || 'Dubai')}</span>
                <h1>${esc(['Serves that catch the light', 'Crystal, blown by hand', 'Built for the bar shift', 'From Dubai, worldwide'][i - 1] || '')}</h1>
              </div>`}
            </div>`).join('')}
        </div>
        <div class="dots">${HEROES.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')}</div>
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
    const count = state.products.filter((p) => p.collection === c.id).length;
    const cover = state.products.find((p) => p.collection === c.id);
    const row = h(`
      <button class="coll-row" style="width: 240px; flex: none;" data-go="/collection/${c.id}">
        <span class="th">${cover ? productImg(cover) : ''}</span>
        <span class="t"><b>${esc(c.title)}</b><span>${esc(c.subtitle)}</span></span>
        <span class="cnt">${count}</span>
        ${icons.chev}
      </button>`);
    rail.appendChild(row);
  }

  const pop = el.querySelector('[data-popular]');
  for (const p of popular) pop.appendChild(productCard(p));

  // hero autoslide
  let idx = 0;
  const slides = el.querySelector('.slides');
  const dots = el.querySelectorAll('.dots i');
  const timer = setInterval(() => {
    if (!document.body.contains(el)) return clearInterval(timer);
    idx = (idx + 1) % HEROES.length;
    slides.style.transform = `translateX(-${idx * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));
  }, 5200);

  // swipe
  let x0 = null;
  const hero = el.querySelector('[data-hero]');
  hero.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  hero.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) {
      idx = (idx + (dx < 0 ? 1 : -1) + HEROES.length) % HEROES.length;
      slides.style.transform = `translateX(-${idx * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    }
    x0 = null;
  }, { passive: true });

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
