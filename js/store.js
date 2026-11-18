/** Tiny reactive store for the request list (cart) held on-device. */
const KEY = "ce.request.v1";

let items = read();
const listeners = new Set();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((i) => i && typeof i.slug === "string")
      .map((i) => ({ slug: i.slug, qty: Math.max(1, Math.min(999, Number(i.qty) || 1)) }));
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(items));
}

export const request = {
  get items() {
    return items.slice();
  },
  count() {
    return items.reduce((n, i) => n + i.qty, 0);
  },
  lines(data) {
    const bySlug = new Map((data ? data.products : []).map((p) => [p.slug, p]));
    return items
      .map((i) => ({ ...i, product: bySlug.get(i.slug) }))
      .filter((i) => !!i.product);
  },
  total(data) {
    return this.lines(data).reduce((sum, i) => sum + i.product.price * i.qty, 0);
  },
  has(slug) {
    return items.some((i) => i.slug === slug);
  },
  qtyOf(slug) {
    return (items.find((i) => i.slug === slug) || {}).qty || 0;
  },
  add(slug, qty = 1) {
    const line = items.find((i) => i.slug === slug);
    if (line) line.qty = Math.min(999, line.qty + qty);
    else items.push({ slug, qty });
    persist();
  },
  setQty(slug, qty) {
    if (qty <= 0) return this.remove(slug);
    const line = items.find((i) => i.slug === slug);
    if (line) line.qty = Math.min(999, qty);
    persist();
  },
  remove(slug) {
    items = items.filter((i) => i.slug !== slug);
    persist();
  },
  clear() {
    items = [];
    persist();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
