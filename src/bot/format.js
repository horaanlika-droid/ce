/**
 * Форматирование текстов для бота.
 */
export const money = (v, cur = 'AED') => (v == null ? 'по запросу' : `${cur} ${Number(v).toLocaleString('en-US')}`);

export function productLine(p) {
  const specs = [p.volumeMl && `${p.volumeMl} ml`, p.heightMm && `${p.heightMm} mm`].filter(Boolean).join(' · ');
  return `${p.name} — ${money(p.priceAed)}${specs ? ` (${specs})` : ''} [${p.id}]`;
}

export function orderText(o, { full = false } = {}) {
  const lines = [
    `🧾 Заказ <b>${o.id}</b> · ${new Date(o.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    `Статус: <b>${o.status}</b> · оплата: ${o.paymentStatus}`,
    `Состав:`,
    ...o.items.map((it) => `  • ${it.name} × ${it.qty} — ${money((it.priceAed || 0) * it.qty)}`),
    `Итого: <b>${money(o.totals.totalAed)}</b> (≈ $${o.totals.totalUsd})`,
    `Клиент: ${o.customer?.name || '—'} · ${o.customer?.phone || ''}`,
    `Доставка: ${o.delivery?.method || '—'}${o.delivery?.address ? ` · ${o.delivery.address}` : ''}`,
  ];
  if (o.company?.name) lines.push(`Компания: ${o.company.name}${o.company.inn ? ` (INN ${o.company.inn})` : ''}`);
  if (o.comment) lines.push(`Комментарий: ${o.comment}`);
  if (full && o.invoiceNumber) lines.push(`Счёт: ${o.invoiceNumber}`);
  return lines.join('\n');
}

export const kb = (rows) => rows.map((r) => r.filter(Boolean));
