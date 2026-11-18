import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const origin = 'https://shop.example.test';

function worker({ network, cached, add = async () => {}, put = async () => {} } = {}) {
  const handlers = new Map();
  const writes = [];
  vm.runInNewContext(script, {
    self: {
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => {},
    },
    location: { origin },
    URL,
    fetch: network || (async () => Response.json({ live: true })),
    caches: {
      open: async () => ({
        add,
        put: async (...args) => { writes.push(args); await put(...args); },
      }),
      match: async () => cached?.clone(),
    },
  });
  return {
    writes,
    install: async () => {
      let pending;
      handlers.get('install')({ waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
    request: async (path = '/ce/data/content.json') => {
      let pending;
      const tasks = [];
      handlers.get('fetch')({
        request: new Request(`${origin}${path}`),
        respondWith: (promise) => { pending = promise; },
        waitUntil: (promise) => tasks.push(promise),
      });
      const response = await pending;
      await Promise.all(tasks);
      return response;
    },
  };
}

test('offline shell installation survives a failed catalogue JSON download', async () => {
  const cached = [];
  const sw = worker({
    add: async (url) => {
      if (url === 'data/content.json') throw new Error('HTTP 503');
      cached.push(url);
    },
  });
  await sw.install();
  assert.ok(cached.includes('js/content-snapshot.js'));
  assert.ok(cached.includes('js/api.js'));
  assert.ok(cached.includes('index.html'));
});

for (const status of [404, 503]) {
  test(`HTTP ${status} uses a known-good cached catalogue instead of an error page`, async () => {
    const sw = worker({
      network: async () => new Response('Unavailable', { status }),
      cached: Response.json({ products: ['cached'] }),
    });
    const response = await sw.request();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { products: ['cached'] });
    assert.equal(sw.writes.length, 0, 'error responses must not overwrite the cache');
  });
}

test('network errors still use cached modules and catalogue data', async () => {
  const sw = worker({
    network: async () => { throw new TypeError('Offline'); },
    cached: new Response('export default {};'),
  });
  assert.equal(await (await sw.request('/ce/js/content-snapshot.js')).text(), 'export default {};');
});

test('a fresh successful response replaces stale cached content', async () => {
  const sw = worker({
    network: async () => Response.json({ fresh: true }),
    cached: Response.json({ fresh: false }),
  });
  assert.deepEqual(await (await sw.request()).json(), { fresh: true });
  assert.equal(sw.writes.length, 1);
  assert.deepEqual(await sw.writes[0][1].json(), { fresh: true });
});

test('cache quota errors cannot turn a successful request into an outage', async () => {
  const sw = worker({ put: async () => { throw new Error('Quota exceeded'); } });
  assert.deepEqual(await (await sw.request()).json(), { live: true });
});

test('without a cached copy, HTTP errors remain errors so the app can recover', async () => {
  const sw = worker({ network: async () => new Response('Unavailable', { status: 503 }) });
  assert.equal((await sw.request()).status, 503);
});

test('API traffic is never intercepted or cached by the offline worker', async () => {
  const sw = worker({ network: async () => { throw new Error('Worker must not fetch the API'); } });
  assert.equal(await sw.request('/api/content'), undefined);
});
