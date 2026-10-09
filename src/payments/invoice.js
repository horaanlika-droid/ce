/**
 * Proforma invoice (счёт) в AED: печатная форма A4 + сводка для API.
 */
import { getSeller } from '../catalog.js';
import { config } from '../config.js';

export function invoiceSummary(order) {
  const seller = getSeller();
  return {
    number: order.invoiceNumber || order.id,
    date: new Date(order.createdAt).toISOString().slice(0, 10),
    url: `/invoice/${order.id}`,
    seller: {
      name: seller.name,
      legalName: seller.legalName,
      trn: seller.trn,
      address: seller.address,
      bankName: seller.bankName,
      iban: seller.iban,
      swift: seller.swift,
      phone: seller.phone,
      email: seller.email,
    },
    totalAed: order.totals.totalAed,
    totalUsd: order.totals.totalUsd,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderInvoiceHtml(order) {
  const s = getSeller();
  const t = order.totals;
  const vat = config.seller.vat;
  const date = new Date(order.createdAt);
  const rows = order.items
    .map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(it.name)}<span class="mut">${esc(it.collection || '')} · ${esc(it.id)}</span></td>
        <td class="num">${it.qty}</td>
        <td class="num">${it.priceAed != null ? money(it.priceAed) : 'on request'}</td>
        <td class="num">${it.priceAed != null ? money(it.priceAed * it.qty) : '—'}</td>
      </tr>`)
    .join('');

  const vatLine = vat === '5'
    ? `<tr><td colspan="4">Subtotal</td><td class="num">${money(t.subtotalAed)}</td></tr>
       <tr><td colspan="4">VAT 5%</td><td class="num">${money(t.subtotalAed * 0.05)}</td></tr>`
    : `<tr><td colspan="4" class="mut">VAT: not applicable</td><td class="num"></td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${esc(order.invoiceNumber || order.id)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.5 -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #10141c; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .brand span { display: block; font-size: 11px; font-weight: 500; color: #6b7280; letter-spacing: .08em; text-transform: uppercase; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 18px; letter-spacing: -0.01em; }
  .doc p { margin: 2px 0 0; color: #6b7280; }
  .parties { display: flex; gap: 24px; margin: 26px 0 18px; }
  .party { flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
  .party h3 { margin: 0 0 6px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #6b7280; }
  .party p { margin: 0; white-space: pre-line; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
  td { padding: 8px; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .mut { color: #9aa1ab; display: block; font-size: 10px; }
  .totals { margin-left: auto; width: 260px; margin-top: 12px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 8px; }
  .totals .grand { font-weight: 700; font-size: 15px; border-top: 1px solid #e5e7eb; margin-top: 4px; padding-top: 8px; }
  .note { margin-top: 22px; color: #6b7280; font-size: 11px; white-space: pre-line; }
  .sign { margin-top: 34px; display: flex; justify-content: space-between; color: #404652; }
  @media print { .noprint { display: none; } }
  .noprint { position: fixed; top: 12px; right: 12px; background: #10141c; color: #fff; border: 0; border-radius: 999px; padding: 10px 18px; font-size: 13px; cursor: pointer; }
</style>
</head>
<body>
<button class="noprint" onclick="window.print()">Print / Save PDF</button>
<div class="head">
  <div class="brand">${esc(s.name)}<span>Premium glassware · Dubai</span></div>
  <div class="doc">
    <h1>Invoice ${esc(order.invoiceNumber || order.id)}</h1>
    <p>${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
    <p>Payment status: <b>${esc(order.paymentStatus)}</b></p>
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>Seller</h3>
    <p>${esc(s.legalName || s.name)}${s.trn ? `\nTRN: ${esc(s.trn)}` : ''}\n${esc(s.address)}${s.phone ? `\n${esc(s.phone)}` : ''}${s.email ? `\n${esc(s.email)}` : ''}</p>
  </div>
  <div class="party">
    <h3>Buyer</h3>
    <p>${esc(order.company?.name || order.customer?.name)}${order.company?.inn ? `\nINN: ${esc(order.company.inn)}` : ''}${order.company?.address ? `\n${esc(order.company.address)}` : ''}
${esc(order.customer?.name || '')}${order.customer?.phone ? `\n${esc(order.customer.phone)}` : ''}${order.customer?.email ? `\n${esc(order.customer.email)}` : ''}</p>
  </div>
</div>

<table>
  <thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Price, AED</th><th class="num">Amount, AED</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="totals">
  ${vatLine}
  <tr></tr>
  <div><span>Delivery</span><span>${t.shippingAed == null ? 'quoted by manager' : money(t.shippingAed)}</span></div>
  <div class="grand"><span>Total</span><span>AED ${money(t.totalAed)}</span></div>
  <div><span class="mut">≈ USD ${t.totalUsd}</span><span></span></div>
</div>

<p class="note">${s.bankName ? `Bank: ${esc(s.bankName)}\n` : ''}${s.iban ? `IBAN: ${esc(s.iban)}\n` : ''}${s.swift ? `SWIFT: ${esc(s.swift)}\n` : ''}
Please reference invoice number ${esc(order.invoiceNumber || order.id)} in the payment purpose.
Goods are dispatched within 1–2 business days after the payment is received.</p>

<div class="sign">
  <span>${esc(s.signer || s.name)}</span>
  <span>____________________</span>
</div>
</body>
</html>`;
}

function money(v) {
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
