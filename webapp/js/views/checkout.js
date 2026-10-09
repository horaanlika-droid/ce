/**
 * Оформление: контакты, доставка, оплата (счёт / карта), компания для счёта.
 */
import { h, esc, money, toast } from '../ui.js';
import { icons } from '../icons.js';
import { state, cartDetailed, computeLocal } from '../state.js';
import { navbar, emptyState } from '../components.js';
import { api } from '../api.js';
import { tg } from '../tg.js';
import { go } from '../router.js';

export async function render() {
  const items = cartDetailed();
  if (!items.length) return emptyState('bag', 'Nothing to check out', 'Your cart is empty', ['Browse collections', '/collections']);

  const methods = state.config.delivery.methods || [];
  const payments = state.config.payments.filter((p) => p.enabled);
  let delivery = 'uae';
  let payment = payments[0]?.id || 'invoice';

  const el = h(`<div>
    ${navbar({ title: 'Checkout', back: true })}
    <div class="scroll">
      <div class="wrap form-wrap" style="padding-top: 16px; display: grid; gap: 22px;">
        <section>
          <div class="section-head"><h2 style="font-size: 19px;">Contact</h2></div>
          <div class="form">
            <div class="field"><label>Name</label><input data-f="name" placeholder="Your name" autocomplete="name"></div>
            <div class="field"><label>Phone / WhatsApp</label><input data-f="phone" placeholder="+971 …" autocomplete="tel" inputmode="tel"></div>
            <div class="field"><label>E-mail</label><input data-f="email" placeholder="you@bar.com" autocomplete="email" inputmode="email"></div>
          </div>
        </section>

        <section>
          <div class="section-head"><h2 style="font-size: 19px;">Delivery</h2></div>
          <div class="opts" data-delivery>
            ${methods.map((m) => `
              <button class="opt ${m.id === delivery ? 'on' : ''}" data-m="${m.id}">
                <span class="rad"></span>
                <span class="t"><b>${esc(m.title)}</b><span>${esc(m.subtitle)}</span></span>
                <span class="cost" data-cost="${m.id}"></span>
              </button>`).join('')}
          </div>
          <div class="field" style="margin-top: 12px;" data-address-wrap>
            <label>Address</label>
            <textarea data-f="address" placeholder="City, street, building, office"></textarea>
          </div>
        </section>

        <section>
          <div class="section-head"><h2 style="font-size: 19px;">Payment</h2></div>
          <div class="opts" data-payment>
            ${payments.map((p) => `
              <button class="opt ${p.id === payment ? 'on' : ''}" data-p="${p.id}">
                <span class="rad"></span>
                <span class="t"><b>${esc(p.title)}</b><span>${esc(p.subtitle)}</span></span>
              </button>`).join('')}
          </div>
          <div class="form" style="margin-top: 12px;" data-company hidden>
            <div class="field"><label>Company name</label><input data-f="company" placeholder="LLC / FZ-LLC name"></div>
            <div class="field"><label>INN / TRN (optional)</label><input data-f="inn" placeholder="—"></div>
          </div>
        </section>

        <section>
          <div class="field"><label>Comment</label><textarea data-f="comment" placeholder="Wishes, timing, markup details…"></textarea></div>
        </section>

        <section data-totals></section>
      </div>
    </div>
  </div>`);

  const totalsBox = el.querySelector('[data-totals]');
  const companyBox = el.querySelector('[data-company]');
  const addrWrap = el.querySelector('[data-address-wrap]');

  function drawTotals() {
    const t = computeLocal(delivery);
    totalsBox.textContent = '';
    totalsBox.appendChild(h(`
      <div class="totals">
        <div class="tr"><span>Subtotal</span><b class="num">${money(t.subtotalAed)}</b></div>
        <div class="tr"><span>Delivery</span><b>${t.shippingAed == null ? 'quoted by manager' : t.shippingAed === 0 ? 'Free' : money(t.shippingAed)}</b></div>
        <div class="grand">
          <span class="lbl">Total</span>
          <span class="val num">${money(t.totalAed)}<small>≈ USD ${t.totalUsd}</small></span>
        </div>
        ${t.onRequest ? '<p class="mut" style="margin:4px 0 0;font-size:12.5px">Part of the order is priced on request — a manager will confirm it with you.</p>' : ''}
        <button class="btn block" data-submit style="margin-top: 6px;">Place order ${icons.arrow}</button>
      </div>`));
    totalsBox.querySelector('[data-submit]').addEventListener('click', submit);
  }

  function drawCosts() {
    const t = computeLocal(delivery);
    for (const m of methods) {
      const node = el.querySelector(`[data-cost="${m.id}"]`);
      if (m.id === 'pickup') node.textContent = 'Free';
      else if (m.id === 'uae') node.textContent = t.subtotalAed >= state.config.shop.freeShippingFrom ? 'Free' : money(state.config.shop.shippingCost);
      else node.textContent = 'quote';
    }
    addrWrap.style.display = delivery === 'pickup' ? 'none' : '';
  }

  el.querySelector('[data-delivery]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    delivery = b.dataset.m;
    el.querySelectorAll('[data-delivery] .opt').forEach((x) => x.classList.toggle('on', x === b));
    tg.haptic('light');
    drawCosts(); drawTotals();
  });

  el.querySelector('[data-payment]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    payment = b.dataset.p;
    el.querySelectorAll('[data-payment] .opt').forEach((x) => x.classList.toggle('on', x === b));
    companyBox.hidden = payment !== 'invoice';
    tg.haptic('light');
  });
  companyBox.hidden = payment !== 'invoice';

  const val = (k) => el.querySelector(`[data-f="${k}"]`)?.value.trim() || '';

  async function submit() {
    if (!val('name') || !val('phone')) { toast('Please add your name and phone'); tg.haptic('error'); return; }
    if (payment === 'invoice' && !val('company')) { toast('Company name is required for an invoice'); tg.haptic('error'); return; }
    const btn = el.querySelector('[data-submit]');
    btn.disabled = true;
    try {
      const res = await api.createOrder({
        items: state.cart,
        customer: { name: val('name'), phone: val('phone'), email: val('email') },
        delivery: { method: delivery, address: val('address') },
        paymentMethod: payment,
        company: payment === 'invoice' ? { name: val('company'), inn: val('inn') } : undefined,
        comment: val('comment'),
      });
      tg.haptic('success');
      if (res.confirmationUrl) { tg.openLink(res.confirmationUrl); }
      go(`/success/${res.order.id}`, { replace: false });
    } catch (err) {
      toast(err.message);
      tg.haptic('error');
      btn.disabled = false;
    }
  }

  drawCosts();
  drawTotals();
  return el;
}

/** Экран успеха после заказа. */
export async function renderSuccess({ id }) {
  let order = null;
  try { order = (await api.order(id)).order; } catch {}
  return h(`<div>
    ${navbar({ title: 'Order placed', back: false })}
    <div class="scroll">
      <div class="success">
        <div class="ring">${icons.check}</div>
        <h1>Thank you!</h1>
        <p>Order <b>${esc(id)}</b> is with our manager. We'll confirm details and payment in WhatsApp or Telegram shortly.</p>
        ${order?.invoiceNumber ? `<button class="btn ghost" data-invoice="/invoice/${esc(id)}">${icons.doc} Open invoice</button>` : ''}
        <button class="btn" data-go="/orders">My orders</button>
        <button class="btn ghost sm" data-go="/">Back to home</button>
      </div>
    </div>
  </div>`);
}
