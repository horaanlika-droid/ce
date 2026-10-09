/**
 * Форматирование текстов для бота.
 */
export const money = (v, cur = 'AED') => (v == null ? 'по запросу' : `${cur} ${Number(v).toLocaleString('en-US')}`);

/** Экранирование пользовательских данных для HTML-сообщений Telegram. */
export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function productLine(p) {
  const specs = [p.volumeMl && `${p.volumeMl} ml`, p.heightMm && `${p.heightMm} mm`].filter(Boolean).join(' · ');
  return `${esc(p.name)} — ${money(p.priceAed)}${specs ? ` (${specs})` : ''} [${p.id}]`;
}

export function orderText(o, { full = false } = {}) {
  const lines = [
    `🧾 Заказ <b>${esc(o.id)}</b> · ${new Date(o.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    `Статус: <b>${esc(o.status)}</b> · оплата: ${esc(o.paymentStatus)}`,
    `Состав:`,
    ...o.items.map((it) => `  • ${esc(it.name)} × ${it.qty} — ${money((it.priceAed || 0) * it.qty)}`),
    `Итого: <b>${money(o.totals.totalAed)}</b> (≈ $${o.totals.totalUsd})`,
    `Клиент: ${esc(o.customer?.name || '—')} · ${esc(o.customer?.phone || '')}`,
    `Доставка: ${esc(o.delivery?.method || '—')}${o.delivery?.address ? ` · ${esc(o.delivery.address)}` : ''}`,
  ];
  if (o.company?.name) lines.push(`Компания: ${esc(o.company.name)}${o.company.inn ? ` (INN ${esc(o.company.inn)})` : ''}`);
  if (o.comment) lines.push(`Комментарий: ${esc(o.comment)}`);
  if (full && o.invoiceNumber) lines.push(`Счёт: ${esc(o.invoiceNumber)}`);
  return lines.join('\n');
}

/** Клетка CSV: кавычки удваиваются, поле берётся в кавычки при необходимости. */
export function csvCell(v) {
  const s = String(v ?? '').replace(/\r\n/g, '\n');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV строки в RU-Excel стиле (разделитель «;»). */
export function toCsv(headers, rows) {
  const line = (cells) => cells.map(csvCell).join(';');
  return [line(headers), ...rows.map(line)].join('\r\n');
}

export const kb = (rows) => rows.map((r) => r.filter(Boolean));
