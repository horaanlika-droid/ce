/**
 * Каталог витрины: базовый data/catalog.json + правки админа из db.json.
 * Базовые товары физически не удаляются — только помечаются, поэтому
 * всё можно вернуть из админки в любой момент.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { db } from './store.js';

const CATALOG_FILE = path.join(ROOT, 'data', 'catalog.json');

let base = { brand: {}, delivery: {}, categories: [], products: [] };
try {
  base = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
} catch (err) {
  console.error('[catalog] нет data/catalog.json — запустите scripts/build_catalog.py:', err.message);
}

const clone = (x) => structuredClone(x);

/** Все товары с учётом правок, скрытия и товаров, добавленных админом. */
export function allProducts() {
  const deleted = new Set(db.deletedProducts || []);
  const list = base.products
    .filter((p) => !deleted.has(p.id))
    .map((p) => ({ ...clone(p), ...(db.overrides[p.id] || {}) }));
  const custom = Object.values(db.customProducts || {}).map((p) => clone(p));
  return [...list, ...custom];
}

/** Товары, видимые на витрине. */
export function publicProducts() {
  return allProducts().filter((p) => !p.hidden);
}

export function findProduct(id) {
  return allProducts().find((p) => String(p.id) === String(id)) || null;
}

export function getCategories() {
  const deleted = new Set(db.deletedCategories || []);
  const baseCats = base.categories
    .filter((c) => !deleted.has(c.id))
    .map((c) => ({ ...clone(c), ...(db.categoryOverrides[c.id] || {}) }));
  const custom = (db.customCategories || []).map((c) => clone(c));
  return [...baseCats, ...custom];
}

export function getBrand() {
  return { ...clone(base.brand || {}), ...(db.shopInfo.brand || {}) };
}

export function getDeliveryInfo() {
  return { ...clone(base.delivery || {}), ...(db.shopInfo.delivery || {}) };
}

export function getShopSettings() {
  return {
    freeShippingFrom: Number(db.shopInfo.shop?.freeShippingFrom ?? config.shop.freeShippingFrom),
    shippingCost: Number(db.shopInfo.shop?.shippingCost ?? config.shop.shippingCost),
    minOrderTotal: Number(db.shopInfo.shop?.minOrderTotal ?? config.shop.minOrderTotal),
  };
}

export function getSeller() {
  return { ...config.seller, ...(db.shopInfo.seller || {}) };
}

export function getTexts() {
  return {
    welcome: 'Timeless glassware for modern bars',
    about: 'Cocktail Embassy is a Dubai-based HoReCa supplier of hand-blown crystal '
      + 'glassware. We work with bars and restaurants worldwide: from single signature '
      + 'serves to full bar openings.',
    footerNote: 'Cocktail Embassy · Dubai · Worldwide delivery',
    ...(db.shopInfo.texts || {}),
  };
}

/** Самозащита витрины: если админ случайно скрыл всё — возвращаем прайс. */
export function selfHeal() {
  if (base.products.length && publicProducts().length === 0) {
    const n = base.products.length;
    db.deletedProducts = [];
    for (const p of base.products) {
      const o = db.overrides[p.id];
      if (o) delete o.hidden;
    }
    console.warn(`[catalog] витрина была пустой — вернул из прайса ${n} поз.`);
    return true;
  }
  return false;
}
