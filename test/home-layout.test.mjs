import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homeView } from '../js/views.js';

const data = JSON.parse(await readFile(new URL('../data/content.json', import.meta.url), 'utf8'));

test('home shows slides, collections, then the full assortment', () => {
  const { html } = homeView(data);
  const hero = html.indexOf('data-hero>');
  const collections = html.indexOf('aria-labelledby="categories-title"');
  const catalogue = html.indexOf('data-home-catalog>');
  assert.ok(hero >= 0 && hero < collections && collections < catalogue);
  assert.match(html, /<p class="eyebrow">Collections<\/p>/);
  assert.doesNotMatch(html, /aria-labelledby="featured-title"/);
  const grid = html.split('<div class="grid" data-home-grid>')[1].split('</div>\n        <div style="text-align:center')[0];
  assert.equal((grid.match(/<article class="card">/g) || []).length, data.products.length);
});
