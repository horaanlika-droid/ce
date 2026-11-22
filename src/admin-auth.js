/**
 * Админ-аутентификация веб-панели (Express).
 *
 * Эквивалент FastAPI-сервера (server/main.py): тот же fallback
 * («embassy2026») при отсутствии ADMIN_PASSWORD, то же хранение кастомных
 * хешей в db.settings['_web_admin_pw_hash'], тот же Bearer-токен на 24 часа.
 */
import crypto from 'node:crypto';
import { db, save } from './store.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 ч сессии
const DEFAULT_WEB_PASSWORD = 'embassy2026';

// В памяти процесса: token -> expiry (ms epoch)
const tokens = new Map();

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

function configuredPassword() {
  return (
    process.env.ADMIN_PASSWORD?.trim() ||
    process.env.BOT_PASSWORD?.trim() ||
    process.env.PASSWORD?.trim() ||
    ''
  );
}

/** Проверка пароля: кастомный хеш (БД) приоритетнее env/fallback. */
export function verifyAdminPassword(password) {
  const clean = String(password || '').trim();
  if (!clean) return false;
  const custom = db.settings['_web_admin_pw_hash'];
  if (typeof custom === 'string' && /^[0-9a-f]{64}$/.test(custom)) {
    return crypto.timingSafeEqual(Buffer.from(sha256(clean), 'hex'), Buffer.from(custom, 'hex'));
  }
  const expected = configuredPassword() || DEFAULT_WEB_PASSWORD;
  const a = Buffer.from(clean, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Сохранить новый пароль (хеш в БД; env-переменная приоритетно сбрасывается). */
export function setAdminPassword(newPassword) {
  const clean = String(newPassword || '').trim();
  if (clean.length < 4) throw new Error('слишком короткий пароль');
  db.settings['_web_admin_pw_hash'] = sha256(clean);
  save();
}

export function issueAdminToken() {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

export function validAdminToken(token) {
  const expiry = tokens.get(token);
  if (!expiry || Date.now() > expiry) {
    tokens.delete(token);
    return false;
  }
  return true;
}

/** Верхнеуровневая проверка Bearer-токена для защищённых admin-маршрутов. */
export function requireAdmin(req, res, next) {
  const auth = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/.exec(auth);
  if (!match || !validAdminToken(match[1])) {
    return res.status(401).json({ error: 'admin login required' });
  }
  next();
}
