/**
 * Конфигурация приложения. Всё берётся из переменных окружения —
 * ни токенов, ни ключей, ни ID администраторов в коде нет.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const str = (k, def = '') => (process.env[k] ?? def).toString().trim();
const num = (k, def) => {
  const v = Number.parseFloat(str(k));
  return Number.isFinite(v) ? v : def;
};

const botToken = str('BOT_TOKEN');
const adminIds = str('ADMIN_IDS')
  .split(/[,;\s]+/)
  .map((x) => x.trim())
  .filter(Boolean)
  .map(Number)
  .filter((x) => Number.isFinite(x) && x > 0);

/**
 * Публичный HTTPS-адрес. Если PUBLIC_URL не задан, подхватываем домен,
 * который хостинг прокидывает переменными DOMAIN / BOTHOST_DOMAIN.
 */
function detectPublicUrl() {
  let url = str('PUBLIC_URL');
  if (!url) {
    url = str('DOMAIN') || str('BOTHOST_DOMAIN') || str('BOT_DOMAIN');
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

/**
 * Метка версии ассетов кадров: самый свежий mtime в webapp/assets/products.
 * Витрина кэширует тяжёлые 4K-файлы на неделю под неизменными именами, а
 * перегонка стиля (scripts/build_photos.py) меняет mtime → браузер заберёт
 * новые кадры сам, без ручного сброса кэша. Пересчитывается не чаще раза в
 * минуту и только пока процесс живёт.
 */
let _assetsV = null;
let _assetsAt = 0;
export function assetsVersion() {
  const dir = path.join(ROOT, 'webapp', 'assets', 'products');
  const now = Date.now();
  if (_assetsV !== null && now - _assetsAt < 60_000) return _assetsV;
  let newest = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jpg')) continue;
      const m = fs.statSync(path.join(dir, f)).mtimeMs;
      if (m > newest) newest = m;
    }
  } catch {
    /* каталога нет — метки нет */
  }
  _assetsAt = now;
  _assetsV = newest ? Math.floor(newest / 1000).toString(36) : '';
  return _assetsV;
}

export const config = {
  root: ROOT,
  mode: (str('MODE', 'all') || 'all').toLowerCase(), // all | web | bot
  port: num('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  webPorts: (() => {
    const main = num('PORT', 3000);
    const extra = str('EXTRA_PORTS', '3000,8080')
      .split(/[,;\s]+/)
      .map((p) => Number.parseInt(p, 10))
      .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
    return [...new Set([main, ...extra])];
  })(),
  publicUrl: detectPublicUrl(),

  telegram: {
    token: botToken,
    hasBot: Boolean(botToken),
    username: str('BOT_USERNAME').replace(/^@/, ''),
    adminIds,
    mode: str('TELEGRAM_MODE', 'polling').toLowerCase(),
    webhookSecret: str('TELEGRAM_WEBHOOK_SECRET'),
  },

  yookassa: {
    shopId: str('YOOKASSA_SHOP_ID'),
    secretKey: str('YOOKASSA_SECRET_KEY'),
    vatCode: num('YOOKASSA_VAT_CODE', 1),
    receipt: Boolean(str('YOOKASSA_RECEIPT', '1') === '1'),
    get enabled() {
      return Boolean(this.shopId && this.secretKey);
    },
  },

  seller: {
    name: str('SELLER_NAME', 'Cocktail Embassy'),
    legalName: str('SELLER_LEGAL_NAME'),
    trn: str('SELLER_TRN'),
    address: str('SELLER_ADDRESS', 'Dubai, UAE'),
    bankName: str('SELLER_BANK_NAME'),
    iban: str('SELLER_IBAN'),
    swift: str('SELLER_SWIFT'),
    signer: str('SELLER_SIGNER'),
    phone: str('SELLER_PHONE', '+971 56 238 8262'),
    email: str('SELLER_EMAIL'),
    invoicePrefix: str('INVOICE_PREFIX', 'CE-'),
    vat: str('INVOICE_VAT', 'none'),
    get configured() {
      return Boolean(this.legalName || this.iban);
    },
  },

  shop: {
    freeShippingFrom: num('FREE_SHIPPING_FROM', 1500),
    shippingCost: num('SHIPPING_COST', 35),
    minOrderTotal: num('MIN_ORDER_TOTAL', 0),
  },

  currency: { primary: 'AED', secondary: 'USD', rate: 3.6725 },
};

/** Список способов оплаты для витрины. */
export function paymentMethods() {
  return [
    {
      id: 'yookassa',
      title: 'Card online',
      subtitle: 'Visa, Mastercard, Amex · secure checkout',
      enabled: config.yookassa.enabled,
      hint: config.yookassa.enabled ? '' : 'Card acquiring not configured',
    },
    {
      id: 'invoice',
      title: 'Invoice / bank transfer',
      subtitle: 'Proforma invoice in AED for companies and HoReCa',
      enabled: true,
      hint: '',
    },
  ];
}

export function isAdmin(userId) {
  return config.telegram.adminIds.includes(Number(userId));
}
