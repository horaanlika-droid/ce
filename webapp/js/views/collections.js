/**
 * Каталог: список коллекций + поиск; детальная страница коллекции.
 */
import { h, esc, productImg } from '../ui.js';
import { icons } from '../icons.js';
import { state } from '../state.js';
import { navbar, productCard, emptyState } from '../components.js';

export async function renderList() {
  const el = h(`<div>
    ${navbar({ brand: true, right: `<button class="nav-btn" data-go="/support" aria-label="Support">${icons.chat}</button>` })}
    <div class="scroll">
      <div class="wrap" style="padding-top: 14px; display: grid; gap: 14px;">
        <div class="searchbar">${icons.search}<input placeholder="Search glassware…" data-q></div>
        <div class="chips" data-chips>
          <button class="chip on" data-group="">All</button>
          <button class="chip" data-group="cocktail">Cocktail</button>
          <button class="chip" data-group="bar">Bar</button>
          <button class="chip" data-group="accessories">Accessories</button>
        </div>
        <div style="display: grid; gap: 10px;" data-list></div>
      </div>
    </div>
  </div>`);

  const list = el.querySelector('[data-list]');
  const input = el.querySelector('[data-q]');
  let group = '';

  function draw() {
    const q = input.value.trim().toLowerCase();
    list.textContent = '';
    const cats = state.categories.filter((c) => !group || c.group === group);
    let shown = 0;
    for (const c of cats) {
      const items = state.products.filter((p) => p.collection === c.id
        && (!q || p.name.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)));
      if (!items.length) continue;
      shown += items.length;
      const cover = items[0];
      list.appendChild(h(`
        <button class="coll-row" data-go="/collection/${c.id}">
          <span class="th">${productImg(cover)}</span>
          <span class="t"><b>${esc(c.title)}</b><span>${esc(c.subtitle)}</span></span>
          <span class="cnt">${items.length}</span>
          ${icons.chev}
        </button>`));
    }
    if (!shown) list.appendChild(emptyState('search', 'Nothing found', 'Try a different request or reset filters'));
  }

  input.addEventListener('input', draw);
  el.querySelector('[data-chips]').addEventListener('click', (e) => {
    const c = e.target.closest('[data-group]');
    if (!c) return;
    group = c.dataset.group;
    el.querySelectorAll('[data-chips] .chip').forEach((x) => x.classList.toggle('on', x === c));
    draw();
  });
  draw();
  return el;
}

export async function renderCollection({ id }) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return emptyState('grid', 'Not found', 'This collection does not exist');
  const items = state.products.filter((p) => p.collection === id);

  const el = h(`<div>
    ${navbar({ title: cat.title, back: true })}
    <div class="scroll">
      <div class="wrap" style="padding-top: 16px;">
        <span class="eyebrow">${esc(cat.subtitle)}</span>
        <h1 style="font-size: 30px; margin: 8px 0 6px; letter-spacing: -0.03em;">${esc(cat.title)}</h1>
        <p class="mut" style="margin: 0 0 20px; font-size: 14.5px; max-width: 46ch;">${esc(cat.blurb || '')}</p>
        <div class="grid" data-grid></div>
      </div>
    </div>
  </div>`);
  const g = el.querySelector('[data-grid]');
  for (const p of items) g.appendChild(productCard(p));
  return el;
}
