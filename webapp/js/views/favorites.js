/**
 * Избранное.
 */
import { h } from '../ui.js';
import { state } from '../state.js';
import { navbar, productCard, emptyState } from '../components.js';

export async function render() {
  const items = state.products.filter((p) => state.favorites.includes(p.id));
  const el = h(`<div>
    ${navbar({ title: 'Favorites', back: true })}
    <div class="scroll"><div class="wrap" style="padding-top: 16px;" data-body></div></div>
  </div>`);
  const body = el.querySelector('[data-body]');
  if (!items.length) {
    body.appendChild(emptyState('heart', 'No favorites yet', 'Tap the heart on a product to keep it here', ['Browse collections', '/collections']));
    return el;
  }
  const g = h('<div class="grid"></div>');
  for (const p of items) g.appendChild(productCard(p));
  body.appendChild(g);
  return el;
}
