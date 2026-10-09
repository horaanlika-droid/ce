/**
 * Каталог витрины: базовый data/catalog.json + правки админа из db.json.
 * Базовые товары физически не удаляются — только помечаются, поэтому
 * всё можно вернуть из админки в любой момент.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { db } from './store.js';

/**
 * Где искать базовый каталог:
 *  1. CATALOG_FILE — явный путь, если он задан (удобно для нестандартных
 *     схем деплоя и для тестов);
 *  2. DATA_DIR/catalog.json — volume хостинга, там же живёт db.json;
 *  3. ./data/catalog.json из деплоя.
 *
 * Без третьего пути любая площадка, которая монтирует volume поверх ./data
 * (README как раз советует DATA_DIR для персистентности), прятала бы
 * закоммиченный data/catalog.json, и витрина поднималась пустой с ошибкой
 * ENOENT в логах.
 */
const CATALOG_CANDIDATES = [...new Set(
  config.catalogFile
    ? [config.catalogFile]
    : [path.join(config.dataDir, 'catalog.json'), path.join(ROOT, 'data', 'catalog.json')],
)];

const EMPTY = { brand: {}, delivery: {}, categories: [], products: [] };

let base = structuredClone(EMPTY);
let source = '';
const missing = [];

for (const file of CATALOG_CANDIDATES) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.products)) {
      throw new Error('в файле нет массива products');
    }
    base = { ...structuredClone(EMPTY), ...parsed };
    source = file;
    break;
  } catch (err) {
    missing.push(`${file} (${err.code === 'ENOENT' ? 'нет файла' : err.message})`);
  }
}

// Обычный случай для volume: своего каталога там нет, работает копия из
// деплоя. Говорим об этом одной спокойной строкой — без ложной тревоги.
if (source && missing.length) {
  console.log(`[catalog] взят ${source} · не найден: ${missing.join(', ')}`);
}
const loadError = missing.length ? missing[missing.length - 1] : '';

if (!source) {
  console.error(
    '[catalog] каталог не найден — витрина будет пустой.\n'
    + `  Проверено: ${CATALOG_CANDIDATES.join(', ')}\n`
    + '  1) убедитесь, что data/catalog.json попадает в деплой (он закоммичен в репозиторий);\n'
    + '  2) если DATA_DIR указывает на пустой volume — файл берётся из ./data автоматически;\n'
    + '  3) пересобрать каталог: npm run catalog (python3 scripts/build_catalog.py).',
  );
}

/** Состояние каталога — для /health и сводки при старте. */
export function catalogStatus() {
  return {
    ok: Boolean(source),
    file: source || null,
    error: source ? null : loadError,
    searched: CATALOG_CANDIDATES,
    products: base.products.length,
    categories: (base.categories || []).length,
  };
}

const clone = (x) => structuredClone(x);

/** Все товары с учётом правок, скрытия и товаров, добавленных админом. */
export function allProducts() {
  const deleted = new Set(db.deletedProducts || []);
  const list = base.products
    .filter((p) => !deleted.has(p.id))
    .map((p) => ({ ...clone(p), ...(db.overrides[p.id] || {}) }));
  const custom = Object.values(db.customProducts || {})
    .filter((p) => !deleted.has(p.id))
    .map((p) => ({ ...clone(p), ...(db.overrides[p.id] || {}) }));
  return [...list, ...custom];
}

/**
 * Товар в том числе удалённый — для раздела «Удалённые» в админке
 * (возврат позиции в один тап). Базовая карточка + правки админа.
 */
export function findAnyProduct(id) {
  const key = String(id);
  const raw = base.products.find((p) => String(p.id) === key) || db.customProducts?.[key] || null;
  if (!raw) return null;
  return { ...clone(raw), ...(db.overrides[key] || {}), _deleted: (db.deletedProducts || []).includes(key) };
}

export function deletedProducts() {
  return (db.deletedProducts || [])
    .map((id) => findAnyProduct(id))
    .filter(Boolean);
}

export function deletedCategories() {
  const list = [];
  for (const id of db.deletedCategories || []) {
    const baseCat = base.categories.find((c) => c.id === id);
    const customCat = (db.customCategories || []).find((c) => c.id === id);
    const raw = baseCat || customCat;
    if (!raw) continue;
    list.push({
      id,
      ...clone(raw),
      ...(baseCat ? (db.categoryOverrides[id] || {}) : {}),
      _custom: Boolean(customCat),
    });
  }
  return list;
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
  const custom = (db.customCategories || [])
    .filter((c) => !deleted.has(c.id))
    .map((c) => clone(c));
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
    /** Курс USD к AED для конвертации цен (меняется в админке → Магазин). */
    usdRate: Number(db.shopInfo.shop?.usdRate ?? config.currency.rate),
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
