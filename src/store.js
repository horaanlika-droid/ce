/**
 * JSON-хранилище с атомарной записью и отложенным сбросом на диск.
 * Данных немного (заказы, чаты, настройки), поэтому внешняя БД не нужна.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Каталог данных из DATA_DIR (volume хостинга) или ./data по умолчанию.
const DATA_DIR = config.dataDir;
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = {
  version: 2,
  users: {},        // id -> профиль
  orders: [],       // заказы
  threads: {},      // userId -> { messages: [], unreadAdmin, unreadUser, status }
  overrides: {},    // productId -> { priceAed, hidden, outOfStock, ... }
  favorites: {},    // userId -> [productId]
  carts: {},        // userId -> [{ id, qty }]
  counters: { order: 1000 },
  settings: {},
  customProducts: {},
  customCategories: [],
  categoryOverrides: {},
  deletedProducts: [],
  deletedCategories: [],
  shopInfo: {
    brand: {},
    delivery: {},
    shop: {},
    seller: {},
    texts: {},
  },
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const merged = { ...structuredClone(EMPTY), ...parsed };
    merged.counters = { ...EMPTY.counters, ...(parsed.counters || {}) };
    merged.settings = parsed.settings || {};
    merged.shopInfo = { ...structuredClone(EMPTY.shopInfo), ...(parsed.shopInfo || {}) };
    if (!Array.isArray(merged.customCategories)) merged.customCategories = [];
    if (!Array.isArray(merged.deletedProducts)) merged.deletedProducts = [];
    if (!Array.isArray(merged.deletedCategories)) merged.deletedCategories = [];
    merged.version = EMPTY.version;
    return merged;
  } catch (err) {
    console.error('[store] db.json damaged, creating a new one:', err.message);
    try {
      fs.copyFileSync(DB_FILE, `${DB_FILE}.broken-${Date.now()}`);
    } catch {}
    return structuredClone(EMPTY);
  }
}

export const db = read();

let timer = null;
let writing = false;

function flush() {
  if (writing) return;
  writing = true;
  try {
    ensureDir();
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('[store] write error:', err.message);
  } finally {
    writing = false;
  }
}

/** Пометить БД изменённой — запись произойдёт пакетно. */
export function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, 250);
}

export function saveNow() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flush();
}

process.on('SIGINT', () => {
  saveNow();
  process.exit(0);
});
process.on('SIGTERM', () => {
  saveNow();
  process.exit(0);
});

export function nextId(counter, prefix = '') {
  db.counters[counter] = (db.counters[counter] || 0) + 1;
  save();
  return `${prefix}${db.counters[counter]}`;
}

export function upsertUser(user) {
  if (!user?.id) return null;
  const id = String(user.id);
  const prev = db.users[id] || { createdAt: Date.now(), ordersCount: 0, totalSpent: 0 };
  db.users[id] = {
    ...prev,
    id: Number(user.id),
    firstName: user.first_name ?? user.firstName ?? prev.firstName ?? '',
    lastName: user.last_name ?? user.lastName ?? prev.lastName ?? '',
    username: user.username ?? prev.username ?? '',
    languageCode: user.language_code ?? prev.languageCode ?? '',
    isPremium: user.is_premium ?? prev.isPremium ?? false,
    isGuest: Boolean(user.isGuest ?? prev.isGuest ?? false),
    photoUrl: user.photo_url ?? prev.photoUrl ?? '',
    lastSeen: Date.now(),
  };
  save();
  return db.users[id];
}

export function getUser(id) {
  return db.users[String(id)] || null;
}

export function userTitle(id) {
  const u = getUser(id);
  if (!u) return `ID ${id}`;
  if (u.isGuest) return 'Гость (сайт)';
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  const uname = u.username ? ` @${u.username}` : '';
  return `${name || 'Без имени'}${uname}`;
}
