/**
 * Тонкий клиент API. В Telegram каждый запрос подписан initData.
 */
import { tg } from './tg.js';

async function call(method, path, body) {
  const headers = {};
  if (tg.initData) headers['X-Telegram-Init-Data'] = tg.initData;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export const api = {
  config: () => call('GET', '/config'),
  catalog: () => call('GET', '/catalog'),
  favorites: () => call('GET', '/favorites'),
  toggleFavorite: (id) => call('POST', `/favorites/${id}`),
  cart: () => call('GET', '/cart'),
  putCart: (items) => call('PUT', '/cart', { items }),
  quote: (items, deliveryMethod) => call('POST', '/cart/quote', { items, deliveryMethod }),
  orders: () => call('GET', '/orders'),
  order: (id) => call('GET', `/orders/${id}`),
  createOrder: (payload) => call('POST', '/orders', payload),
  checkOrder: (id) => call('POST', `/orders/${id}/check`),
  cancelOrder: (id) => call('POST', `/orders/${id}/cancel`),
  support: () => call('GET', '/support'),
  sendSupport: (text, context) => call('POST', '/support', { text, context }),
  supportUpdates: (since) => call('GET', `/support/updates?since=${since}`),
};
