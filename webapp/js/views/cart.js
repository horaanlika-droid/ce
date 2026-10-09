/**
 * Корзина: позиции, степперы, прогресс до бесплатной доставки, итоги.
 */
import { h, esc, money, productImg } from '../ui.js';
import { icons } from '../icons.js';
import { state, cartDetailed, cartCount, computeLocal, subscribe, removeFromCart, setQty } from '../state.js';
import { navbar, stepper, emptyState } from '../components.js';
import { tg, inTelegram } from '../tg.js';
import { go, stackDepth } from '../router.js';

export async function render() {
  const el = h(`<div>
    ${navbar({ title: 'Your Cart', back: stackDepth() > 1 })}
    <div class="scroll">
      <div class="wrap" style="padding-top: 16px;" data-body></div>
    </div>
  </div>`);
  const body = el.querySelector('[data-body]');

  function draw() {
    const items = cartDetailed();
    body.textContent = '';
    if (!items.length) {
      body.appendChild(emptyState('bag', 'Your cart is empty', 'Add glassware you like — it will wait for you here', ['Browse collections', '/collections']));
      if (inTelegram) tg.mainButton.hide();
      return;
    }

    const t = computeLocal('uae');
    const free = state.config.shop.freeShippingFrom;

    body.appendChild(h(`
      <div class="cart-body"><div class="cart-split">
        <div>
          <div style="display: grid; gap: 10px;" data-lines></div>
          <div class="progress">
            <div class="bar"><i style="width: ${Math.min(100, (t.subtotalAed / free) * 100)}%"></i></div>
            <p>${t.subtotalAed >= free
              ? '✨ Free UAE delivery unlocked'
              : `${money(free - t.subtotalAed)} away from free UAE delivery`}</p>
          </div>
        </div>
        <div>
          <div class="totals">
            <div class="tr"><span>Items</span><b>${cartCount()}</b></div>
            <div class="tr"><span>Subtotal</span><b class="num">${money(t.subtotalAed)}</b></div>
            <div class="tr"><span style="font-size:12px">≈ USD</span><b class="num" style="color:var(--mut)">${t.subtotalUsd}</b></div>
            <div class="grand">
              <span class="lbl">Total</span>
              <span class="val num">${money(t.subtotalAed)}<small>delivery at checkout</small></span>
            </div>
          </div>
          <div class="trust">
            <div class="prop"><span class="ic">${icons.shield}</span><div><b>Premium quality</b><span>Lead-free crystal glass</span></div></div>
            <div class="prop"><span class="ic">${icons.truck}</span><div><b>Fast delivery</b><span>UAE & worldwide</span></div></div>
            <div class="prop"><span class="ic">${icons.doc}</span><div><b>Invoice for companies</b><span>AED · bank transfer</span></div></div>
          </div>
        </div>
      </div>
      <div class="sticky-cta"><button class="btn block" data-checkout>Proceed to checkout ${icons.arrow}</button></div></div>
    `));

    const lines = body.querySelector('[data-lines]');
    for (const it of items) {
      const st = stepper(it.id, it.qty);
      const line = h(`
        <div class="cline">
          <div class="th" data-product="${it.product.id}">${productImg(it.product)}</div>
          <div class="t">
            <b>${esc(it.product.name)}</b>
            <span class="sub">${esc(it.product.collection)} · COD ${esc(it.product.id)}</span>
          </div>
          <div class="right">
            <button class="rm" data-rm="${it.id}" aria-label="Remove">${icons.x}</button>
            <div class="price"><span class="aed num">${money((it.product.priceAed || 0) * it.qty)}</span></div>
          </div>
        </div>`);
      line.querySelector('.t').appendChild(st);
      lines.appendChild(line);
    }

    body.querySelector('[data-checkout]').addEventListener('click', () => {
      tg.haptic('light');
      go('/checkout');
    });
    body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      await removeFromCart(b.dataset.rm);
      tg.haptic('light');
    }));

    if (inTelegram) tg.mainButton.show('Proceed to checkout', () => go('/checkout'));
  }

  draw();
  const un = subscribe((ev) => { if (ev === 'cart') draw(); });
  el._cleanup = () => { un(); if (inTelegram) tg.mainButton.hide(); };
  return el;
}
