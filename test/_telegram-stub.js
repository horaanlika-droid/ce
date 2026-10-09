/**
 * Тестовая заглушка сети Telegram.
 *
 * grammy (Node-сборка) берёт fetch из `node-fetch` через геттер, который
 * читает `module.exports.default` при каждом вызове — подменяя его, мы
 * перехватываем все обращения к api.telegram.org. При этом сам grammy
 * (bot.init, polling, ретраи) и весь код бота исполняются по-настоящему.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodeFetch = require('node-fetch');

export const apiCalls = [];

export function stubTelegram({ username = 'ce_test_bot', id = 777, longPollMs = 1000 } = {}) {
  const original = nodeFetch.default;
  nodeFetch.default = async function fetchStub(url, options = {}) {
    const u = String(url);
    const method = u.split('/').pop().split('?')[0];
    let payload = {};
    try { payload = options.body ? JSON.parse(options.body) : {}; } catch { /* не JSON — не важно */ }
    apiCalls.push({ method, payload });
    if (method === 'getMe') {
      return json({
        id, is_bot: true, first_name: 'Cocktail Embassy', username,
        can_join_groups: false, can_read_all_group_messages: false,
        supports_inline_queries: false,
      });
    }
    // Telegram отдаёт getUpdates долгим опросом: без паузы grammy крутит
    // цикл вплотную и вытесняет из event loop всё остальное (включая HTTP).
    if (method === 'getUpdates') {
      await sleep(longPollMs);
      return json([]);
    }
    return json(true);
  };
  return () => { nodeFetch.default = original; };
}

const json = (result) => ({ json: async () => ({ ok: true, result }) });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
