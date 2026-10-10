/**
 * Каталог: список коллекций + поиск; детальная страница коллекции.
 */
import { h, esc, coverImg, plural } from '../ui.js';
import { assetUrl } from '../assets.js';
import { icons } from '../icons.js';
import { state } from '../state.js';
import { navbar, productCard, emptyState, navActions, collectionRow } from '../components.js';

export async function renderList() {
  const el = h(`<div>
    ${navbar({ brand: true, right: navActions({ search: true }) })}
    <div class="scroll">
      <div class="wrap" style="padding-top: 12px; display: grid; gap: 12px;">
        <section class="catalog-banner">
          <img src="${assetUrl('assets/app/collections.jpg')}" alt="" decoding="async">
          <div><h1>Collections</h1><p>Signature glassware sets for every mood and occasion.</p></div>
        </section>
        <div class="searchbar" data-search hidden>${icons.search}<input placeholder="Search glassware…" data-q></div>
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
  const search = el.querySelector('[data-search]');
  const input = el.querySelector('[data-q]');
  let group = '';

  // референс: поиска на экране нет — он вызывается иконкой в навбаре
  const openSearch = () => {
    search.hidden = false;
    input.focus();
  };
  el.addEventListener('click', (e) => { if (e.target.closest('[data-nav-search]')) openSearch(); });

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
      list.appendChild(collectionRow(c, items));
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
        <span class="eyebrow">${esc(cat.group || 'Collection')} · ${items.length} ${plural(items.length, 'piece', 'pieces')}</span>
        <h1 style="font-size: 30px; margin: 8px 0 6px; letter-spacing: -0.03em;">${esc(cat.title)}</h1>
        <p class="mut" style="margin: 0 0 16px; font-size: 14.5px; max-width: 46ch;">${esc(cat.blurb || cat.subtitle || '')}</p>
        <div class="coll-hero">${coverImg(id, items[0], 'wide')}</div>
        <div class="grid" data-grid></div>
      </div>
    </div>
  </div>`);
  const g = el.querySelector('[data-grid]');
  for (const p of items) g.appendChild(productCard(p));
  return el;
}
