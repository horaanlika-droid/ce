/**
 * Проверка Telegram WebApp initData (HMAC-SHA256 по схеме из документации).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import crypto from 'node:crypto';

export function validateInitData(initData, botToken, { maxAgeSec = 86400 } = {}) {
  if (!initData || !botToken) return { ok: false, reason: 'no-data' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no-hash' };
  params.delete('hash');

  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-hash' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec && authDate && Date.now() / 1000 - authDate > maxAgeSec) {
    return { ok: false, reason: 'expired' };
  }

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {}
  if (!user?.id) return { ok: false, reason: 'no-user' };

  return { ok: true, user, authDate, startParam: params.get('start_param') || '' };
}
