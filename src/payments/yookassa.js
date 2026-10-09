/**
 * Опциональный эквайринг (ЮKassa). Включается только при заданных ключах;
 * без них витрина показывает счёт и оплату по подтверждению менеджера.
 */
import { config } from '../config.js';

const BASE = 'https://api.yookassa.ru/v3';

function auth() {
  return 'Basic ' + Buffer.from(`${config.yookassa.shopId}:${config.yookassa.secretKey}`).toString('base64');
}

async function call(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: auth(),
      'Content-Type': 'application/json',
      'Idempotence-Key': cryptoKey(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.description || `YooKassa ${res.status}`);
  return json;
}

const cryptoKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export async function createPayment(order, { returnUrl }) {
  const value = Math.round(order.totals.totalAed * 3.6725 * 100) / 100; // AED -> RUB-эквивалент задаётся магазином; здесь сумма в валюте магазина
  return call('/payments', 'POST', {
    amount: { value: order.totals.totalAed.toFixed(2), currency: 'AED' },
    capture: true,
    confirmation: { type: 'redirect', return_url: returnUrl },
    description: `Order ${order.id} · Cocktail Embassy`,
    metadata: { orderId: order.id, userId: String(order.userId) },
    receipt: config.yookassa.receipt
      ? {
          customer: {
            email: order.customer?.email,
            phone: order.customer?.phone,
          },
          items: order.items.map((it) => ({
            description: it.name,
            quantity: it.qty,
            amount: { value: (it.priceAed || 0).toFixed(2), currency: 'AED' },
            vat_code: config.yookassa.vatCode,
            payment_mode: 'full_payment',
            payment_subject: 'commodity',
          })),
        }
      : undefined,
  });
}

export async function getPayment(id) {
  return call(`/payments/${id}`);
}
