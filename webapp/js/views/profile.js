/**
 * Профиль: пользователь, разделы, контакты бренда, о компании.
 */
import { h, esc } from '../ui.js';
import { icons } from '../icons.js';
import { state, cartCount } from '../state.js';
import { navbar } from '../components.js';
import { tg, inTelegram } from '../tg.js';

const TINTS = ['rgba(138,182,255,.18)', 'rgba(255,125,157,.16)', 'rgba(93,211,158,.15)', 'rgba(255,196,87,.15)'];

export async function render() {
  const u = state.config.user;
  const brand = state.config.brand;
  const name = u && !u.isGuest ? [u.firstName, u.lastName].filter(Boolean).join(' ') : 'Guest';
  const initials = name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase() || 'CE';

  const item = (ic, tint, title, val, act) => `
    <button class="menu-item" ${act}>
      <span class="ic" style="background: ${tint}; color: var(--text);">${icons[ic]}</span>
      <b>${title}</b>
      ${val ? `<span class="val">${val}</span>` : ''}
      ${icons.chev}
    </button>`;

  const el = h(`<div>
    ${navbar({ brand: true })}
    <div class="scroll">
      <div class="wrap" style="padding-top: 18px;">
        <div class="profile-head">
          <div class="avatar">${u?.photoUrl ? `<img src="${esc(u.photoUrl)}" alt="">` : esc(initials)}</div>
          <div>
            <b style="font-size: 19px; letter-spacing: -0.02em;">${esc(name)}</b>
            <div class="mut" style="font-size: 13px;">${u && !u.isGuest ? (u.username ? '@' + esc(u.username) : 'Telegram member') : 'Guest session · data is saved on this device'}</div>
          </div>
        </div>

        <div class="menu">
          ${item('box', TINTS[0], 'My orders', '', 'data-go="/orders"')}
          ${item('heart', TINTS[1], 'Favorites', String(state.favorites.length), 'data-go="/favorites"')}
          ${item('bag', TINTS[2], 'Cart', String(cartCount()), 'data-go="/cart"')}
          ${item('chat', TINTS[3], 'Support', '', 'data-go="/support"')}
        </div>

        <div class="menu" style="margin-top: 12px;">
          ${brand.instagram ? item('insta', TINTS[1], 'Instagram', '@' + esc(brand.instagram), `data-ext="https://instagram.com/${esc(brand.instagram)}"`) : ''}
          ${brand.whatsapp ? item('wa', TINTS[2], 'WhatsApp', esc(brand.phone || ''), `data-ext="https://wa.me/${esc(String(brand.whatsapp).replace(/[^0-9]/g, ''))}"`) : ''}
          ${item('globe', TINTS[0], 'About Cocktail Embassy', '', 'data-go="/about"')}
        </div>

        <p class="dim" style="font-size: 12px; text-align: center; margin: 26px 0 10px;">
          ${esc(state.config.texts.footerNote)}<br>
          ${inTelegram ? 'Telegram Mini App' : 'Web storefront'} · v1.0
        </p>
      </div>
    </div>
  </div>`);

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    if (b) {
      e.preventDefault();
      tg.openLink(b.dataset.ext);
    }
  });
  return el;
}

export async function renderAbout() {
  const brand = state.config.brand;
  const texts = state.config.texts;
  const delivery = state.config.delivery;
  return h(`<div>
    ${navbar({ title: 'About', back: true })}
    <div class="scroll">
      <div class="wrap" style="padding-top: 18px; display: grid; gap: 16px; max-width: 760px;">
        <div>
          <span class="eyebrow">${esc(brand.tagline)}</span>
          <h1 style="font-size: 30px; margin: 8px 0 10px; letter-spacing: -0.03em;">Cocktail Embassy</h1>
          <p class="mut" style="margin: 0; font-size: 15px;">${esc(texts.about)}</p>
        </div>
        <div class="card" style="padding: 18px; display: grid; gap: 10px;">
          <b>Delivery</b>
          <p class="mut" style="margin: 0; font-size: 14px;">${esc(delivery.note || '')}</p>
        </div>
        <div class="props">
          <div class="prop"><span class="ic">${icons.spark}</span><div><b>Hand blowing</b><span>Every piece is crafted by hand — unique in character</span></div></div>
          <div class="prop"><span class="ic">${icons.shield}</span><div><b>Lead-free crystal</b><span>Crystal clarity without lead, safe for daily service</span></div></div>
          <div class="prop"><span class="ic">${icons.store}</span><div><b>HoReCa supplier</b><span>Bars, restaurants and hotels — from DXB to the world</span></div></div>
        </div>
      </div>
    </div>
  </div>`);
}
