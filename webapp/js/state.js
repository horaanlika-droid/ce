/**
 * Глобальное состояние: конфиг, каталог, корзина, избранное.
 * Корзина и избранное живут на сервере (синхронизация между устройствами),
 * локально — оптимистичные обновления.
 */
import { api } from './api.js';
import { setAssetsV } from './assets.js';

export const state = {
  config: null,
  categories: [],
  products: [],
  cart: [],          // [{ id, qty }]
  favorites: [],     // [id]
  orders: null,
  listeners: new Set(),
};

export function subscribe(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function notify(event) {
  for (const fn of state.listeners) fn(event);
}

export async function boot() {
  const [config, catalog] = await Promise.all([api.config(), api.catalog()]);
  state.config = config;
  setAssetsV(config.assetsV);
  state.categories = catalog.categories;
  state.products = catalog.products;
  const [fav, cart] = await Promise.all([api.favorites(), api.cart()]);
  state.favorites = fav.ids || [];
  state.cart = cart.items || [];
}

export const productById = (id) => state.products.find((p) => p.id === id) || null;
export const categoryById = (id) => state.categories.find((c) => c.id === id) || null;

export function cartCount() {
  return state.cart.reduce((s, it) => s + it.qty, 0);
}

export function cartDetailed() {
  return state.cart
    .map((it) => ({ ...it, product: productById(it.id) }))
    .filter((it) => it.product);
}

export async function setCart(items, { sync = true } = {}) {
  state.cart = items;
  notify('cart');
  if (sync) {
    try { await api.putCart(items); } catch {}
  }
}

export async function addToCart(id, qty = 1) {
  const cur = state.cart.find((it) => it.id === id);
  const items = cur
    ? state.cart.map((it) => (it.id === id ? { ...it, qty: Math.min(999, it.qty + qty) } : it))
    : [...state.cart, { id, qty }];
  await setCart(items);
}

export async function setQty(id, qty) {
  if (qty <= 0) return removeFromCart(id);
  await setCart(state.cart.map((it) => (it.id === id ? { ...it, qty: Math.min(999, qty) } : it)));
}

export async function removeFromCart(id) {
  await setCart(state.cart.filter((it) => it.id !== id));
}

/** Локальный пересчёт итогов (зеркалит серверную логику). */
export function computeLocal(deliveryMethod = 'pickup') {
  const shop = state.config?.shop || { freeShippingFrom: 1500, shippingCost: 35 };
  const list = cartDetailed();
  const subtotalAed = list.reduce((s, it) => s + (it.product.priceAed || 0) * it.qty, 0);
  const subtotalUsd = list.reduce((s, it) => s + (it.product.priceUsd || 0) * it.qty, 0);
  let shippingAed = 0;
  let shippingQuote = false;
  if (deliveryMethod === 'uae') {
    shippingAed = subtotalAed >= shop.freeShippingFrom ? 0 : shop.shippingCost;
  } else if (deliveryMethod === 'worldwide') {
    shippingQuote = true;
  }
  return {
    items: list,
    subtotalAed: Math.round(subtotalAed * 100) / 100,
    subtotalUsd: Math.round(subtotalUsd * 10) / 10,
    shippingAed: shippingQuote ? null : shippingAed,
    shippingQuote,
    totalAed: Math.round((subtotalAed + (shippingQuote ? 0 : shippingAed)) * 100) / 100,
    totalUsd: Math.round((subtotalUsd + (shippingQuote ? 0 : shippingAed / 3.6725)) * 10) / 10,
    onRequest: list.some((it) => it.product.priceAed == null),
  };
}

export async function toggleFavorite(id) {
  const res = await api.toggleFavorite(id);
  state.favorites = res.ids || [];
  notify('favorites');
  return state.favorites.includes(id);
}
