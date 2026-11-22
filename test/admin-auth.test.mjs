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

function runApp(t, { env = {}, args = ['src/index.js'] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-admin-'));
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
    get log() { return log; },
    async waitFor(re, timeout = 30_000) {
      const started = Date.now();
      for (;;) {
        if (re.test(log)) return;
        if (proc.exitCode !== null) throw new Error(`процесс завершился (${proc.exitCode}):\n${log}`);
        if (Date.now() - started > timeout) throw new Error(`таймаут ожидания ${re}:\n${log}`);
        await new Promise((r) => { setTimeout(r, 50); });
      }
    },
  };
}

test('admin auth: default password logs in, wrong password rejected, password change persists', async (t) => {
  const port = await freePort();
  const app = runApp(t, { env: { MODE: 'web', PORT: String(port) } });
  await app.waitFor(/Mini App on/);

  // --- wrong password: 401, nothing about the password in the body
  const bad = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nope' }),
  });
  assert.equal(bad.status, 401);
  const badBody = await bad.json();
  assert.equal(badBody.ok, undefined);

  // --- default password: token back
  const login = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'embassy2026' }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.match(token, /^[a-f0-9]{48}$/);

  // --- password change: needs the admin bearer token
  const unauth = await fetch(`http://127.0.0.1:${port}/api/admin/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'embassy2026', newPassword: 'newpass-123' }),
  });
  assert.equal(unauth.status, 401);

  const change = await fetch(`http://127.0.0.1:${port}/api/admin/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: 'embassy2026', newPassword: 'newpass-123' }),
  });
  assert.equal(change.status, 200);

  // --- old password gone, new password works
  const oldLogin = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'embassy2026' }),
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'newpass-123' }),
  });
  assert.equal(newLogin.status, 200);

  // --- bogus token is not accepted
  const bogus = await fetch(`http://127.0.0.1:${port}/api/admin/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-token' },
    body: JSON.stringify({ currentPassword: 'newpass-123', newPassword: 'other-1234' }),
  });
  assert.equal(bogus.status, 401);

  // --- the admin deep path is served and carries the deep-path fallback
  const admin = await fetch(`http://127.0.0.1:${port}/admin`);
  assert.equal(admin.status, 200);
  assert.match(admin.headers.get('content-type'), /text\/html/);
  assert.match(await admin.text(), /Deep-path fallback/);
});
