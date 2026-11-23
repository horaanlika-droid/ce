import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homeView } from '../js/views.js';

const data = JSON.parse(await readFile(new URL('../data/content.json', import.meta.url), 'utf8'));
const PAGE_SIZE = 12;

function gridMarkup(html) {
  const marker = '<div class="grid" id="home-catalog-grid" data-home-grid>';
  const start = html.indexOf(marker);
  const end = html.indexOf('\n        </div>\n        <div class="home-catalog__more">', start);
  assert.ok(start >= 0 && end > start, 'catalogue grid exists');
  return html.slice(start + marker.length, end);
}

function cardSlugs(html) {
  return [...html.matchAll(/<a class="card__link" href="#\/product\/([^"]+)"/g)].map((match) => match[1]);
}

// Exercise the actual home-view handlers without a browser dependency. A real
// grid only needs innerHTML, insertAdjacentHTML and children for these actions.
class Element {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  click(detail = 1) { if (!this.hidden) this.listeners.click?.({ detail }); }
}

class Grid extends Element {
  insertAdjacentHTML(where, html) {
    assert.equal(where, 'beforeend');
    this.innerHTML += html;
  }
  get children() {
    return cardSlugs(this.innerHTML).map((slug) => ({
      querySelector: (selector) => {
        assert.equal(selector, '.card__link');
        return { focus: () => { this.focusedSlug = slug; } };
      },
    }));
  }
}

function mountedHome(catalogue = data) {
  const view = homeView(catalogue);
  const grid = new Grid();
  grid.innerHTML = gridMarkup(view.html);
  const count = new Element();
  const status = new Element();
  const progress = new Element();
  const fill = new Element();
  const more = new Element();
  const moreTag = view.html.match(/<button[^>]*data-home-more[^>]*>/)?.[0];
  assert.ok(moreTag, 'load-more button exists');
  more.hidden = /\shidden\b/.test(moreTag);
  const chips = ['all', ...catalogue.categories.map((category) => category.slug)]
    .map((homeChip) => new Element({ homeChip }));
  const nodes = {
    '[data-home-grid]': grid,
    '[data-home-catalog-count]': count,
    '[data-home-catalog-status]': status,
    '[data-home-progress]': progress,
    '[data-home-progress-fill]': fill,
    '[data-home-more]': more,
  };
  const section = {
    querySelector: (selector) => nodes[selector] || null,
    querySelectorAll: (selector) => selector === '[data-home-chip]' ? chips : [],
  };
  view.mount({ querySelector: (selector) => selector === '[data-home-catalog]' ? section : null });
  return { ...view, grid, count, status, progress, fill, more, chips, chip: (slug) => chips.find((c) => c.dataset.homeChip === slug) };
}

test('home shows collections followed by the first page of the full assortment', () => {
  const { html } = homeView(data);
  const hero = html.indexOf('data-hero>');
  const collections = html.indexOf('aria-labelledby="categories-title"');
  const catalogue = html.indexOf('data-home-catalog>');
  assert.ok(hero >= 0 && hero < collections && collections < catalogue);
  assert.match(html, /<p class="eyebrow">Collections<\/p>/);
  assert.doesNotMatch(html, /aria-labelledby="featured-title"/);
  assert.deepEqual(cardSlugs(gridMarkup(html)), data.products.slice(0, PAGE_SIZE).map((p) => p.slug));
  assert.match(html, new RegExp(`Showing ${PAGE_SIZE} of ${data.products.length} pieces`));
  assert.match(html, /data-home-more aria-controls="home-catalog-grid"\s*>Show more pieces/);
  assert.match(html, /data-home-catalog-status role="status" aria-live="polite"/);
});

test('load more appends every product in order without duplicates', () => {
  const home = mountedHome();
  let shown = PAGE_SIZE;
  while (shown < data.products.length) {
    const before = cardSlugs(home.grid.innerHTML);
    home.more.click();
    shown = Math.min(shown + PAGE_SIZE, data.products.length);
    const after = cardSlugs(home.grid.innerHTML);
    assert.deepEqual(after.slice(0, before.length), before, 'existing cards stay in place');
    assert.deepEqual(after, data.products.slice(0, shown).map((p) => p.slug));
    assert.equal(home.status.textContent, `Showing ${shown} of ${data.products.length} pieces`);
    assert.equal(home.fill.style.width, `${Math.round(shown / data.products.length * 100)}%`);
    assert.equal(home.more.hidden, shown === data.products.length);
  }
  assert.equal(new Set(cardSlugs(home.grid.innerHTML)).size, data.products.length);
  home.more.click();
  assert.equal(cardSlugs(home.grid.innerHTML).length, data.products.length);
});

test('switching collections resets pagination and updates counts and controls', () => {
  const catalogue = {
    ...data,
    products: data.products.map((product, index) => ({ ...product, categorySlug: index < 7 ? 'rocks' : 'cocktail' })),
  };
  const home = mountedHome(catalogue);
  home.more.click();
  home.chip('all').click();
  assert.equal(cardSlugs(home.grid.innerHTML).length, PAGE_SIZE * 2, 'reselecting the active filter does not collapse loaded cards');
  home.chip('rocks').click();
  const rocks = catalogue.products.filter((p) => p.categorySlug === 'rocks');
  assert.deepEqual(cardSlugs(home.grid.innerHTML), rocks.map((p) => p.slug));
  assert.equal(home.count.textContent, `${rocks.length} pieces`);
  assert.equal(home.status.textContent, `Showing ${rocks.length} of ${rocks.length} pieces`);
  assert.equal(home.fill.style.width, '100%');
  assert.equal(home.more.hidden, true);
  assert.equal(home.chip('rocks').attributes['aria-pressed'], 'true');
  assert.equal(home.chip('all').attributes['aria-pressed'], 'false');

  home.chip('all').click();
  assert.deepEqual(cardSlugs(home.grid.innerHTML), data.products.slice(0, PAGE_SIZE).map((p) => p.slug));
  assert.equal(home.status.textContent, `Showing ${PAGE_SIZE} of ${data.products.length} pieces`);
  assert.equal(home.more.hidden, false);
  assert.equal(home.chip('all').attributes['aria-pressed'], 'true');
});

test('large collections can also be fully loaded, with keyboard focus on new pieces', () => {
  const catalogue = {
    ...data,
    products: data.products.slice(0, 25).map((product) => ({ ...product, categorySlug: 'cocktail' })),
  };
  const home = mountedHome(catalogue);
  home.chip('cocktail').click();
  assert.equal(home.more.hidden, false);
  home.more.click(0);
  assert.equal(home.grid.focusedSlug, catalogue.products[12].slug);
  assert.equal(cardSlugs(home.grid.innerHTML).length, 24);
  home.more.click(0);
  assert.equal(home.grid.focusedSlug, catalogue.products[24].slug);
  assert.deepEqual(cardSlugs(home.grid.innerHTML), catalogue.products.map((p) => p.slug));
  assert.equal(home.status.textContent, 'Showing 25 of 25 pieces');
  assert.equal(home.more.hidden, true);
});

test('empty, single-piece and exactly-one-page catalogues do not offer load more', () => {
  for (const size of [0, 1, PAGE_SIZE]) {
    const catalogue = { ...data, products: data.products.slice(0, size) };
    const home = mountedHome(catalogue);
    assert.equal(home.more.hidden, true);
    assert.equal(cardSlugs(home.grid.innerHTML).length, size);
    if (size === 0) {
      assert.match(home.html, /No pieces available/);
      assert.match(home.html, /data-home-progress aria-hidden="true" hidden/);
    }
    if (size === 1) assert.match(home.html, /Showing 1 of 1 piece<\/p>/);
  }
});

test('page footer repeats the preloader credit at the end', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const credit = index.match(/<div class="boot__by">([^<]+)<\/div>/)?.[1];
  assert.equal(credit, 'app by @stonym0ntana');
  assert.ok(app.includes(`<div class="footer__credit">${credit}</div>`));
  assert.ok(app.indexOf('class="footer__credit"') > app.indexOf('class="footer__base"'));
});
