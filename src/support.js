/**
 * Чат поддержки: диалог покупателя (сайт/Mini App) с администраторами в боте.
 */
import { db, save } from './store.js';
import { emit } from './events.js';

function thread(userId, create = true) {
  const key = String(userId);
  if (!db.threads[key] && create) {
    db.threads[key] = { messages: [], unreadAdmin: 0, unreadUser: 0, status: 'open', createdAt: Date.now() };
    save();
  }
  return db.threads[key] || null;
}

export function getThread(userId, create = true) {
  return thread(userId, create);
}

export function listThreads() {
  return Object.entries(db.threads)
    .map(([userId, t]) => ({ userId: Number(userId), ...t }))
    .sort((a, b) => (lastAt(b) || 0) - (lastAt(a) || 0));
}

const lastAt = (t) => (t.messages.length ? t.messages[t.messages.length - 1].at : t.createdAt);

export function addUserMessage(user, text, extra = {}) {
  const t = thread(user.id);
  const message = {
    from: 'user',
    text,
    at: Date.now(),
    userName: [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.isGuest ? 'Guest' : `ID ${user.id}`),
    ...extra,
  };
  t.messages.push(message);
  t.unreadAdmin += 1;
  t.status = 'open';
  save();
  emit('support:user', { userId: user.id, message });
  return message;
}

export function addAdminMessage(userId, text) {
  const t = thread(userId);
  const message = { from: 'admin', text, at: Date.now() };
  t.messages.push(message);
  t.unreadUser += 1;
  save();
  emit('support:admin', { userId, message });
  return message;
}

export function markUserRead(userId) {
  const t = db.threads[String(userId)];
  if (t && t.unreadUser) {
    t.unreadUser = 0;
    save();
  }
}

export function markAdminRead(userId) {
  const t = db.threads[String(userId)];
  if (t && t.unreadAdmin) {
    t.unreadAdmin = 0;
    save();
  }
}
