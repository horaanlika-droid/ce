/**
 * Заказы: список + карточка со статус-таймлайном, составом и счётом.
 */
import { h, esc, money, dateStr, productImg, toast } from '../ui.js';
import { icons } from '../icons.js';
import { state } from '../state.js';
import { navbar, emptyState } from '../components.js';
import { api } from '../api.js';
import { tg } from '../tg.js';
import { go, stackDepth } from '../router.js';

const FLOW = ['new', 'paid', 'packing', 'shipped', 'delivered'];

export async function renderList() {
  const el = h(`<div>
    ${navbar({ title: 'My orders', back: stackDepth() > 1 })}
    <div class="scroll"><div class="wrap" style="padding-top: 16px; display: grid; gap: 12px;" data-list></div></div>
  </div>`);
  const list = el.querySelector('[data-list]');
  const { orders } = await api.orders();
  state.orders = orders;
  if (!orders.length) {
    list.appendChild(emptyState('box', 'No orders yet', 'Your orders and their statuses will appear here', ['Browse collections', '/collections']));
    return el;
  }
  for (const o of orders) {
    const st = state.config.statuses[o.status] || { title: o.status, emoji: '' };
    list.appendChild(h(`
      <button class="order-card" data-go="/order/${o.id}">
        <div class="top">
          <span class="no">${esc(o.id)}</span>
          <span class="status ${o.status}">${st.emoji} ${esc(st.title)}</span>
        </div>
        <div class="thumbs">${o.items.slice(0, 4).map((it) => `<img src="${it.image}" alt="" loading="lazy">`).join('')}</div>
        <div class="row" style="justify-content: space-between;">
          <span class="mut" style="font-size: 12.5px;">${dateStr(o.createdAt)} · ${o.items.reduce((s, i) => s + i.qty, 0)} items</span>
          <b class="num">${money(o.totals.totalAed)}</b>
        </div>
      </button>`));
  }
  return el;
}

export async function renderDetail({ id }) {
  const { order, invoice } = await api.order(id);
  const st = state.config.statuses[order.status] || { title: order.status, emoji: '' };
  const flowIdx = FLOW.indexOf(order.status);

  const el = h(`<div>
    ${navbar({ title: order.id, back: true })}
    <div class="scroll">
      <div class="wrap" style="padding-top: 16px; display: grid; gap: 16px;">
        <div class="card" style="padding: 18px;">
          <div class="row" style="justify-content: space-between; margin-bottom: 14px;">
            <span class="status ${order.status}">${st.emoji} ${esc(st.title)}</span>
            <span class="mut" style="font-size: 12.5px;">${dateStr(order.createdAt)}</span>
          </div>
          ${order.status === 'canceled' ? '' : `
          <div class="timeline">
            ${FLOW.map((s, i) => {
              const meta = state.config.statuses[s];
              const done = i <= flowIdx;
              const at = order.history?.find((x) => x.status === s)?.at;
              return `<div class="tl ${done ? 'on' : ''}"><span class="dot"></span><div class="t"><b>${meta.title}</b><span>${at ? dateStr(at) : '—'}</span></div></div>`;
            }).join('')}
          </div>`}
        </div>

        <div class="card" style="padding: 6px;">
          ${order.items.map((it) => `
            <div class="cline" style="border: 0; background: none;">
              <div class="th" data-product="${it.id}">${productImg({ ...it, image: it.image, srcImage: '' })}</div>
              <div class="t"><b>${esc(it.name)}</b><span class="sub">× ${it.qty}</span></div>
              <div class="right"><div class="price"><span class="aed num">${money((it.priceAed || 0) * it.qty)}</span></div></div>
            </div>`).join('')}
        </div>

        <div class="totals">
          <div class="tr"><span>Subtotal</span><b class="num">${money(order.totals.subtotalAed)}</b></div>
          <div class="tr"><span>Delivery</span><b>${order.totals.shippingAed == null ? 'quoted' : order.totals.shippingAed === 0 ? 'Free' : money(order.totals.shippingAed)}</b></div>
          <div class="grand"><span class="lbl">Total</span><span class="val num">${money(order.totals.totalAed)}<small>≈ USD ${order.totals.totalUsd}</small></span></div>
        </div>

        <div class="card" style="padding: 16px; display: grid; gap: 6px; font-size: 14px;">
          <b style="font-size: 15px;">Delivery & contact</b>
          <span class="mut">${esc(order.customer.name)} · ${esc(order.customer.phone)}</span>
          <span class="mut">${esc((state.config.delivery.methods.find((m) => m.id === order.delivery.method) || {}).title || order.delivery.method)}${order.delivery.address ? ` · ${esc(order.delivery.address)}` : ''}</span>
          ${order.comment ? `<span class="mut">“${esc(order.comment)}”</span>` : ''}
        </div>

        <div style="display: grid; gap: 10px;">
          ${invoice ? `<button class="btn ghost block" data-invoice="${esc(invoice.url)}">${icons.doc} Open invoice ${esc(invoice.number)}</button>` : ''}
          ${order.paymentMethod === 'yookassa' && order.paymentStatus !== 'paid' ? `<button class="btn tint block" data-check>${icons.shield} Check payment</button>` : ''}
          ${order.status !== 'canceled' && order.paymentStatus !== 'paid' ? `<button class="btn danger block" data-cancel>Cancel order</button>` : ''}
          <button class="btn ghost block" data-go="/support">${icons.chat} Ask support</button>
        </div>
      </div>
    </div>
  </div>`);

  el.querySelector('[data-check]')?.addEventListener('click', async (e) => {
    const res = await api.checkOrder(id);
    toast(res.paid ? 'Payment confirmed ' : 'Payment is still pending');
    if (res.paid) setTimeout(() => location.reload(), 700);
  });
  el.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    if (!confirm('Cancel this order?')) return;
    await api.cancelOrder(id);
    tg.haptic('warning');
    go('/orders');
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-invoice]');
    if (b) window.open(b.dataset.invoice, '_blank');
  });
  return el;
}
