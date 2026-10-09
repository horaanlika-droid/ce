/**
 * Карточка товара: сцена с фото, характеристики, похожие позиции.
 * В Telegram основная кнопка — нативная MainButton.
 */
import { h, esc, priceHtml, productImg, toast } from '../ui.js';
import { icons } from '../icons.js';
import { state, addToCart, toggleFavorite } from '../state.js';
import { navbar, productCard } from '../components.js';
import { tg, inTelegram } from '../tg.js';
import { go } from '../router.js';

export async function render({ id }) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return h('<div></div>');
  const cat = state.categories.find((c) => c.id === p.collection);
  const fav = state.favorites.includes(p.id);
  const inCart = state.cart.some((it) => it.id === p.id);
  const similar = state.products.filter((x) => x.collection === p.collection && x.id !== p.id).slice(0, 6);

  const specs = [
    p.volumeMl ? ['drop', 'Capacity', `${p.volumeMl} ml`] : null,
    p.heightMm ? ['ruler', 'Height', `${p.heightMm} mm`] : null,
    p.diameterMm ? ['circle', 'Diameter', `Φ ${p.diameterMm} mm`] : null,
    ['spark', 'Material', p.material || 'crystal glass'],
  ].filter(Boolean);

  const el = h(`<div>
    ${navbar({
      title: cat?.title || '',
      back: true,
      right: `<button class="nav-btn" data-fav="${p.id}" aria-label="Favorite" style="color:${fav ? '#ff7d9d' : 'inherit'}">${fav ? icons.heart.replace('<svg', '<svg fill="currentColor"') : icons.heart}</button>`,
    })}
    <div class="scroll">
      <div class="product-split">
        <div class="pview">
          <div class="stage" data-stage>${productImg(p, '', 'full')}</div>
        </div>
        <div class="pinfo">
          <span class="coll">${esc(cat?.title || p.collection)}</span>
          <h1>${esc(p.name)}</h1>
          <p class="desc">${esc(p.description || '')}</p>
          <div class="badges">
            ${p.craft ? `<i class="flag">${esc(p.craft)}</i>` : ''}
            ${p.note ? `<i class="flag">${esc(p.note)}</i>` : ''}
            ${p.isNew ? '<i class="flag new">New</i>' : ''}
          </div>
          <div class="specs">
            ${specs.map(([ic, label, val]) => `
              <div class="spec"><span class="ic">${icons[ic]}</span><div><small>${label}</small><b>${esc(val)}</b></div></div>`).join('')}
          </div>
          <div style="margin-top: 20px; display: flex; align-items: center; justify-content: space-between; gap: 14px;">
            ${priceHtml(p)}
            <span class="dim" style="font-size: 12px;">COD ${esc(p.id)}</span>
          </div>
        </div>
      </div>

      <div class="wrap">
        <div class="sticky-cta">
          <button class="btn block" data-main ${p.priceAed == null ? 'disabled' : ''}>
            ${p.priceAed == null ? 'Request price' : `Add to cart · ${p.priceAed} AED`} ${icons.bag}
          </button>
        </div>

        ${similar.length ? `
        <section class="section">
          <div class="section-head"><h2 style="font-size: 20px;">From the same collection</h2></div>
          <div class="grid" data-sim></div>
        </section>` : ''}
      </div>
    </div>
  </div>`);

  // rim glow сцены набирает силу плавно, при появлении карточки товара
  const stage = el.querySelector('[data-stage]');
  // reflow фиксирует стартовое состояние, иначе переход .lit может не отыграть
  requestAnimationFrame(() => {
    void stage.offsetWidth;
    stage.classList.add('lit');
  });

  const sim = el.querySelector('[data-sim]');
  if (sim) for (const s of similar) sim.appendChild(productCard(s));

  const add = async () => {
    if (p.priceAed == null) {
      go('/support');
      setTimeout(() => document.dispatchEvent(new CustomEvent('ce:prefill-support', {
        detail: `Hello! I'd like a price for ${p.name} (${p.id}).`,
      })), 250);
      return;
    }
    await addToCart(p.id, 1);
    tg.haptic('success');
    toast(`${p.name} added to cart`);
    if (!inTelegram) go('/cart');
  };

  el.querySelector('[data-main]').addEventListener('click', add);
  if (inTelegram && p.priceAed != null) {
    tg.mainButton.show(`Add to cart · AED ${p.priceAed}`, add);
    el._cleanup = () => tg.mainButton.hide();
  }

  return el;
}
