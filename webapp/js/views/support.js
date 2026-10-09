/**
 * Чат поддержки: сообщения покупателя и менеджеров, поллинг ответов.
 */
import { h, esc, timeStr } from '../ui.js';
import { icons } from '../icons.js';
import { navbar } from '../components.js';
import { api } from '../api.js';
import { tg } from '../tg.js';

export async function render() {
  const el = h(`<div>
    ${navbar({ title: 'Support', back: true })}
    <div class="scroll" style="padding-bottom: 76px;"><div class="chat" data-chat></div></div>
    <form class="chat-input" data-form>
      <input placeholder="Message…" data-input autocomplete="off">
      <button class="send" type="submit" aria-label="Send">${icons.send}</button>
    </form>
  </div>`);

  const chat = el.querySelector('[data-chat]');
  const scroll = el.querySelector('.scroll');
  const input = el.querySelector('[data-input]');
  let since = 0;
  let timer = null;

  function addMessage(m) {
    chat.appendChild(h(`
      <div class="msg ${m.from}">
        ${esc(m.text)}
        <span class="at">${timeStr(m.at)}</span>
      </div>`));
    scroll.scrollTop = scroll.scrollHeight;
  }

  const data = await api.support();
  if (!data.messages.length) {
    chat.appendChild(h(`<div class="empty" style="padding: 40px 20px;">
      <div class="ic">${icons.chat}</div>
      <h3>How can we help?</h3>
      <p>Write to us — a manager replies here and in WhatsApp during business hours (GST 9:00–21:00).</p>
    </div>`));
  } else {
    for (const m of data.messages) addMessage(m);
  }
  since = Date.now();

  // предзаполнение из карточки товара («запросить цену»)
  const prefill = (e) => { input.value = e.detail; input.focus(); };
  document.addEventListener('ce:prefill-support', prefill);

  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    chat.querySelector('.empty')?.remove();
    addMessage({ from: 'user', text, at: Date.now() });
    tg.haptic('light');
    try {
      await api.sendSupport(text);
    } catch (err) {
      addMessage({ from: 'admin', text: '⚠️ ' + err.message, at: Date.now() });
    }
  });

  timer = setInterval(async () => {
    if (!document.body.contains(el)) return;
    try {
      const res = await api.supportUpdates(since);
      for (const m of res.messages) {
        if (m.from === 'admin') { addMessage(m); tg.haptic('success'); }
        since = Math.max(since, m.at);
      }
      if (res.now) since = Math.max(since, res.now - 1);
    } catch {}
  }, 4000);

  el._cleanup = () => {
    clearInterval(timer);
    document.removeEventListener('ce:prefill-support', prefill);
  };
  return el;
}
