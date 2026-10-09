import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

/** Запуск приложения с набором env; собирает логи, умеет ждать строку. */
function runApp(t, { env = {}, args = ['src/index.js'] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-boot-'));
  const proc = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (d) => { log += d; });
  }
  t.after(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });

  return {
    proc,
    get log() { return log; },
    /** Ждать строку в логах; ошибка по таймауту или по выходу процесса. */
    async waitFor(re, timeout = 20_000) {
      const started = Date.now();
      for (;;) {
        if (re.test(log)) return;
        if (proc.exitCode !== null) {
          throw new Error(`процесс завершился (${proc.exitCode}), не дождавшись ${re}:\n${log}`);
        }
        if (Date.now() - started > timeout) throw new Error(`таймаут ожидания ${re}:\n${log}`);
        await new Promise((r) => { setTimeout(r, 50); });
      }
    },
    async alive(ms) {
      await new Promise((r) => setTimeout(r, ms));
      return proc.exitCode === null;
    },
  };
}

test('витрина поднимается и /health показывает каталог', async (t) => {
  const port = await freePort();
  const app = runApp(t, { env: { MODE: 'web', PORT: String(port) } });
  await app.waitFor(/Mini App on/);

  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.catalog.ok, true, 'каталог загружен');
  assert.equal(body.catalog.products, 25, 'все 25 позиций из прайса');

  const home = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(home.status, 200, 'главная отдаётся');
  assert.match(app.log, /\[boot\] mode=web · web=ok:/);
});

test('занятый порт: понятная диагностика и живой процесс (без crash-loop)', async (t) => {
  const port = await freePort();
  // Занимаем порт сторонним сервером — как в контейнере хостинга.
  const holder = net.createServer();
  await new Promise((r) => holder.listen(port, '0.0.0.0', r));
  t.after(() => holder.close());

  const app = runApp(t, { env: { MODE: 'web', PORT: String(port) } });
  await app.waitFor(/EADDRINUSE/);

  assert.match(app.log, /порт уже занят другим процессом/, 'подсказка, что делать');
  assert.match(app.log, /\[boot\] mode=web · web=НЕТ ПОРТА/, 'сводка честно говорит, что порта нет');
  assert.ok(await app.alive(1500), 'процесс не вышел — контейнер не уйдёт в бесконечный рестарт');
});

test('MODE=all: веб и бот поднимаются вместе', async (t) => {
  const port = await freePort();
  const app = runApp(t, {
    env: { MODE: 'all', PORT: String(port), BOT_TOKEN: '123456:TEST', ADMIN_IDS: '42' },
    args: ['--import', './test/_stub-telegram.mjs', 'src/index.js'],
  });
  await app.waitFor(/\[boot\]/);

  assert.match(app.log, /\[bot\] @ce_test_bot/, 'username бота из getMe');
  assert.match(app.log, /bot=ok:@ce_test_bot/, 'бот учтён в сводке');
  assert.match(app.log, /web=ok:/, 'веб учтён в сводке');
  assert.doesNotMatch(app.log, /TypeError/, 'никаких падений при старте');

  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal((await res.json()).catalog.ok, true);
});
