/**
 * Заказы: состав, итоги, статусы, доставка.
 */
import { db, save, nextId } from './store.js';
import { findProduct, getShopSettings } from './catalog.js';
import { emit } from './events.js';

export const DELIVERY_METHODS = {
  pickup: {
    title: 'Pickup in Dubai',
    subtitle: 'Al Quoz showroom · daily 10:00–20:00',
    cost: 0,
  },
  uae: {
    title: 'UAE courier',
    subtitle: 'Next-day delivery across the Emirates',
    cost: null, // берём из настроек магазина
  },
  worldwide: {
    title: 'Worldwide shipping',
    subtitle: 'DHL / Aramex · cost confirmed by manager',
    cost: null,
    quote: true,
  },
};

export const ORDER_STATUSES = {
  new: { title: 'New', emoji: '🆕' },
  paid: { title: 'Paid', emoji: '💳' },
  packing: { title: 'Packing', emoji: '📦' },
  shipped: { title: 'Shipped', emoji: '🚚' },
  delivered: { title: 'Delivered', emoji: '✅' },
  canceled: { title: 'Canceled', emoji: '🚫' },
};

export function normalizeItems(items) {
  const out = [];
  for (const raw of items || []) {
    const product = findProduct(raw.id);
    if (!product || product.hidden) continue;
    const qty = Math.max(1, Math.min(999, Number(raw.qty) || 1));
    const prev = out.find((x) => x.id === product.id);
    if (prev) prev.qty = Math.min(999, prev.qty + qty);
    else {
      out.push({
        id: product.id,
        name: product.name,
        collection: product.collection,
        priceAed: product.priceAed,
        priceUsd: product.priceUsd,
        image: product.image,
        qty,
      });
    }
  }
  return out;
}

export function computeTotals(items, deliveryMethod = 'pickup') {
  const shop = getShopSettings();
  const list = normalizeItems(items);
  const subtotalAed = list.reduce((s, it) => s + (it.priceAed || 0) * it.qty, 0);
  const subtotalUsd = list.reduce((s, it) => s + (it.priceUsd || 0) * it.qty, 0);
  const onRequest = list.some((it) => it.priceAed == null);

  let shippingAed = 0;
  let shippingQuote = false;
  const method = DELIVERY_METHODS[deliveryMethod] ? deliveryMethod : 'pickup';
  if (method === 'uae') {
    shippingAed = subtotalAed >= shop.freeShippingFrom ? 0 : shop.shippingCost;
  } else if (method === 'worldwide') {
    shippingQuote = true;
  }
  const totalAed = subtotalAed + (shippingQuote ? 0 : shippingAed);
  const totalUsd = subtotalUsd + (shippingQuote ? 0 : shippingAed / 3.6725);

  return {
    items: list,
    subtotalAed: round(subtotalAed),
    subtotalUsd: round(subtotalUsd, 1),
    shippingAed: shippingQuote ? null : round(shippingAed),
    shippingQuote,
    totalAed: round(totalAed),
    totalUsd: round(totalUsd, 1),
    onRequest,
    freeShippingGap: Math.max(0, shop.freeShippingFrom - subtotalAed),
    deliveryMethod: method,
  };
}

const round = (v, d = 2) => Math.round(v * 100) / 100;

export function createOrder({ userId, items, customer, delivery, paymentMethod, company, comment }) {
  const totals = computeTotals(items, delivery?.method);
  if (!totals.items.length) throw new Error('Cart is empty');
  const id = nextId('order', 'CE-');
  const order = {
    id,
    userId: Number(userId),
    createdAt: Date.now(),
    items: totals.items,
    customer: customer || {},
    delivery: {
      method: totals.deliveryMethod,
      address: delivery?.address || '',
      city: delivery?.city || '',
    },
    paymentMethod,
    paymentStatus: paymentMethod === 'invoice' ? 'invoice' : 'pending',
    company: company || null,
    comment: comment || '',
    status: 'new',
    invoiceNumber: paymentMethod === 'invoice' ? id : null,
    totals,
    history: [{ at: Date.now(), status: 'new', by: 'user' }],
  };
  db.orders.unshift(order);
  const u = db.users[String(userId)];
  if (u) {
    u.ordersCount = (u.ordersCount || 0) + 1;
  }
  save();
  emit('order:new', order);
  return order;
}

export function getOrder(id) {
  return db.orders.find((o) => o.id === id || String(o.id) === String(id)) || null;
}

export function userOrders(userId) {
  return db.orders.filter((o) => o.userId === Number(userId));
}

export function updateOrder(id, patch, by = 'admin') {
  const order = getOrder(id);
  if (!order) return null;
  Object.assign(order, patch);
  if (patch.status) {
    order.history = order.history || [];
    order.history.push({ at: Date.now(), status: patch.status, by });
  }
  save();
  if (patch.status) emit('order:status', order);
  return order;
}

export function markPaid(order, payment, by = 'system') {
  return updateOrder(order.id, {
    paymentStatus: 'paid',
    status: order.status === 'new' ? 'paid' : order.status,
    payment,
  }, by);
}
