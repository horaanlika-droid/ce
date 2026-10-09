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
 * Публичный HTTPS-адрес. Приоритет источников:
 *  1. PUBLIC_URL (или DOMAIN / BOTHOST_DOMAIN / BOT_DOMAIN от хостинга);
 *  2. lazy-детект из заголовка Host входящих запросов (Bothost и подобные
 *     платформы не всегда прокидывают домен переменной — первый же запрос
 *     покупателя/админа по публичному адресу раскрывает его).
 * Пока значение не задано ниоткуда — строка пуста, бот работает, а кнопка
 * Mini App и ссылки подставляются, как только URL станет известен.
 */
const envPublicUrl = (() => {
  let url = str('PUBLIC_URL');
  if (!url) {
    url = str('DOMAIN') || str('BOTHOST_DOMAIN') || str('BOT_DOMAIN');
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
})();

let detectedPublicUrl = envPublicUrl;
const publicUrlListeners = [];

const isLocalHost = (host) => {
  const h = (host || '').toLowerCase().split(':')[0];
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::' || h === '[::1]') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // любой IP
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // private
  if (h.endsWith('.e2b.app')) return true; // песочница Arena — не публичный адрес
  return false;
};

/**
 * Зафиксировать публичный URL из входящего запроса. Вызывается из HTTP-сервера
 * на каждый запрос; пишет значение только если URL ещё не задан переменными.
 */
export function notePublicUrl(host, proto = 'https') {
  if (!host || isLocalHost(host)) return false;
  const url = `${String(proto || 'https').replace(/\/+$/, '')}://${host.replace(/\/+$/, '')}`;
  if (envPublicUrl || detectedPublicUrl === url) return detectedPublicUrl === url;
  detectedPublicUrl = url;
  console.log(`[config] публичный URL обнаружен по заголовку Host: ${url}`);
  for (const fn of publicUrlListeners) {
    try { fn(url); } catch { /* слушатель не сломал остальное */ }
  }
  return true;
}

/** Подписка на появление/смену публичного URL (мощная кнопка бота и т.п.). */
export function onPublicUrlChange(fn) {
  publicUrlListeners.push(fn);
  if (detectedPublicUrl) setImmediate(() => fn(detectedPublicUrl));
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
  // раунд 7: метка считается по всем каталогам кадров — товары, hero и og,
  // обложки коллекций; перегонка любого из них обновляет ?v= у витрины
  const dirs = ['products', 'brand', 'covers'].map((d) =>
    path.join(ROOT, 'webapp', 'assets', d));
  const now = Date.now();
  if (_assetsV !== null && now - _assetsAt < 60_000) return _assetsV;
  let newest = 0;
  for (const dir of dirs) {
    try {
      for (const f of fs.readdirSync(dir)) {
        // раунд 8: производные .avif/.webp тоже участвуют — перегонка любого
        // формата обновляет метку ?v= у витрины
        if (!/\.(jpg|avif|webp)$/.test(f)) continue;
        const m = fs.statSync(path.join(dir, f)).mtimeMs;
        if (m > newest) newest = m;
      }
    } catch {
      /* каталога нет — пропускаем */
    }
  }
  _assetsAt = now;
  _assetsV = newest ? Math.floor(newest / 1000).toString(36) : '';
  return _assetsV;
}

const _botUsername = str('BOT_USERNAME').replace(/^@/, '');
let _detectedBotUsername = '';

export const config = {
  root: ROOT,
  mode: (str('MODE', 'all') || 'all').toLowerCase(), // all | web | bot
  port: num('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  // Каталог данных: DATA_DIR — для volumes на хостинге (на бесплатных
  // тарифах Bothost данные в контейнере не переживают перезапуск).
  dataDir: str('DATA_DIR') || path.join(ROOT, 'data'),
  // Порт(ы) веб-сервера. Если хостинг задаёт PORT — слушаем только его.
  // Если не задан — раскидываемся по типовым портам, чтобы гарантированно
  // попасть в прокси Bothost/Render-подобных платформ (отказы отдельных
  // портов, например EACCES на 80, не роняют процесс).
  webPorts: (() => {
    const main = num('PORT', 0);
    if (main > 0) {
      const extra = str('EXTRA_PORTS', '')
        .split(/[,;\s]+/)
        .map((p) => Number.parseInt(p, 10))
        .filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
      return [...new Set([main, ...extra])];
    }
    return [80, 3000, 8080];
  })(),
  /** Публичный HTTPS-адрес: из env или обнаруженный из Host (см. notePublicUrl). */
  get publicUrl() {
    return detectedPublicUrl;
  },

  telegram: {
    token: botToken,
    hasBot: Boolean(botToken),
    // username: из env BOT_USERNAME; если не задан — подхватывается из getMe
    // при запуске бота, поэтому в переменных хостинга вводить не нужно.
    get username() { return _botUsername || _detectedBotUsername; },
    set username(v) { if (!_botUsername) _detectedBotUsername = String(v || '').replace(/^@/, ''); },
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
