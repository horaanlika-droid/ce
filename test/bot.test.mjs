import test from 'node:test';
import assert from 'node:assert/strict';

import { stubTelegram, apiCalls } from './_telegram-stub.js';

// config.js читает окружение при импорте — задаём его до загрузки src/*.
process.env.BOT_TOKEN ??= '123456:TESTTOKEN';
process.env.ADMIN_IDS ??= '42';

test('бот стартует и берёт username из getMe (bot.botInfo), а не из результата init()', async (t) => {
  stubTelegram({ username: 'ce_test_bot' });
  const { startBot } = await import('../src/bot/index.js');
  const { config } = await import('../src/config.js');

  const bot = await startBot();
  t.after(() => bot?.stop());

  assert.ok(bot, 'startBot() вернул bot, а не null — бот запускается');
  assert.equal(bot.botInfo?.username, 'ce_test_bot', 'grammy положил профиль в bot.botInfo');
  assert.equal(config.telegram.username, 'ce_test_bot', 'username подхвачен из getMe');
  assert.ok(apiCalls.some((c) => c.method === 'getMe'), 'getMe реально вызван');

  // bot.start() запускает polling фоном — ждём первый getUpdates.
  for (let i = 0; i < 40 && !apiCalls.some((c) => c.method === 'getUpdates'); i++) {
    await new Promise((r) => { setTimeout(r, 50); });
  }
  assert.ok(apiCalls.some((c) => c.method === 'getUpdates'), 'polling запущен');
});
