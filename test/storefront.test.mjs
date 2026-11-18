import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalogue = JSON.parse(await readFile(new URL('../data/content.json', import.meta.url), 'utf8'));
let instance = 0;

async function storefront(t, { config = {}, stored = {}, fetch: fetcher, storageBlocked = false } = {}) {
  t.mock.method(console, 'warn', () => {}); // Failed requests are intentional in these tests.
  const previous = new Map(['window', 'location', 'localStorage', 'fetch'].map((key) => [key, globalThis[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const storage = new Map(Object.entries(stored));
  globalThis.window = { CE_CONFIG: config };
  globalThis.location = { hostname: 'shop.github.io', origin: 'https://shop.github.io', pathname: '/ce/' };
  globalThis.localStorage = {
    getItem(key) {
      if (storageBlocked) throw new Error('Storage is disabled');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (storageBlocked) throw new Error('Storage is disabled');
      storage.set(key, value);
    },
  };
  globalThis.fetch = fetcher || (async (url) => {
    if (String(url).includes('content.json')) return Response.json(catalogue);
    return new Response('Not found', { status: 404 });
  });
  // Isolate the module's memoized requests and runtime configuration per test.
  return import(`../js/api.js?storefront-test=${++instance}`);
}

function assertComplete(data) {
  assert.equal(data.products.length, catalogue.products.length);
  assert.equal(data.categories.length, catalogue.categories.length);
  assert.deepEqual(data.settings.partners, catalogue.settings.partners);
}

function pricedCatalogue(price) {
  return {
    ...structuredClone(catalogue),
    products: [{ slug: 'regression-piece', name: 'Regression piece', price, images: [] }],
  };
}

test('storefront loads the published JSON before using any recovery data', async (t) => {
  const fresh = pricedCatalogue(1234);
  const api = await storefront(t, {
    fetch: async (url) => String(url).includes('content.json')
      ? Response.json(fresh) : new Response(null, { status: 404 }),
  });
  assert.equal((await api.loadContent()).products[0].price, 1234);
  assert.equal(api.dataSource(), 'static');
  assert.equal(api.state.loading, false);
});

for (const failure of ['network error', 'HTTP 503', 'HTML instead of JSON', 'malformed catalogue']) {
  test(`storefront still opens on a first visit with ${failure} and no browser cache`, async (t) => {
    const api = await storefront(t, {
      storageBlocked: true,
      fetch: async () => {
        if (failure === 'network error') throw new TypeError('Failed to fetch');
        if (failure === 'HTTP 503') return new Response('Unavailable', { status: 503 });
        if (failure === 'HTML instead of JSON') return new Response('<!doctype html><h1>Not found</h1>');
        return Response.json({ error: 'No catalogue' });
      },
    });
    const data = await api.loadContent();
    assertComplete(data);
    assert.equal(api.state.content, data);
    assert.equal(api.state.loading, false);
    assert.equal(api.state.online, false);
    assert.equal(api.dataSource(), 'static');
  });
}

test('a stalled JSON request times out and uses the recovery catalogue', async (t) => {
  const api = await storefront(t, {
    fetch: async (url, { signal } = {}) => {
      if (!String(url).includes('content.json')) return new Response(null, { status: 404 });
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  assertComplete(await api.loadContent());
  assert.equal(api.state.loading, false);
});

test('an unreachable configured API falls back to a complete static catalogue', async (t) => {
  const api = await storefront(t, {
    config: { apiBase: 'https://api.example.test' },
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  });
  assertComplete(await api.loadContent());
  assert.equal(api.state.online, false);
});

test('local admin edits retain priority over recovery data', async (t) => {
  const api = await storefront(t, {
    stored: { 'ce.admin.override.v1': JSON.stringify({ data: pricedCatalogue(2222) }) },
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.equal((await api.loadContent()).products[0].price, 2222);
  assert.equal(api.dataSource(), 'local');
});

test('a working live API retains priority over local drafts and the snapshot', async (t) => {
  const api = await storefront(t, {
    config: { apiBase: 'https://api.example.test' },
    stored: { 'ce.admin.override.v1': JSON.stringify({ data: catalogue }) },
    fetch: async () => Response.json(pricedCatalogue(3333)),
  });
  assert.equal((await api.loadContent()).products[0].price, 3333);
  assert.equal(api.dataSource(), 'api');
  assert.equal(api.state.online, true);
});

test('a valid recent browser cache takes priority over the recovery snapshot', async (t) => {
  const api = await storefront(t, {
    stored: { 'ce.content.v1': JSON.stringify({ at: Date.now(), data: pricedCatalogue(4444) }) },
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.equal((await api.loadContent()).products[0].price, 4444);
  assert.equal(api.dataSource(), 'cache');
});

for (const data of [{ products: [null] }, { products: [], categories: {} }]) {
  test('a malformed browser cache cannot prevent the recovery catalogue from opening', async (t) => {
    const api = await storefront(t, {
      stored: { 'ce.content.v1': JSON.stringify({ at: Date.now(), data }) },
      fetch: async () => { throw new TypeError('Failed to fetch'); },
    });
    assertComplete(await api.loadContent());
    assert.equal(api.state.loading, false);
  });
}

for (const at of [undefined, 'invalid', Date.now() - 4 * 24 * 60 * 60 * 1000]) {
  test('an expired or undated cache cannot override the recovery catalogue', async (t) => {
    const api = await storefront(t, {
      stored: { 'ce.content.v1': JSON.stringify({ at, data: pricedCatalogue(9999) }) },
      fetch: async () => { throw new TypeError('Failed to fetch'); },
    });
    assertComplete(await api.loadContent());
    assert.equal(api.dataSource(), 'static');
  });
}

test('force refresh recovers fresh published data after a failed JSON request', async (t) => {
  let available = false;
  const api = await storefront(t, {
    fetch: async (url) => {
      if (available && String(url).includes('content.json')) return Response.json(pricedCatalogue(5555));
      throw new TypeError('Failed to fetch');
    },
  });
  assertComplete(await api.loadContent());
  available = true;
  const pending = api.loadContent({ force: true });
  assert.equal(api.state.loading, true);
  assert.equal((await pending).products[0].price, 5555);
  assert.equal(api.state.loading, false);
});

test('admin catalogue reset also works when the JSON request is unavailable', async (t) => {
  const api = await storefront(t, {
    fetch: async () => { throw new TypeError('Failed to fetch'); },
  });
  const data = await api.loadBundledRaw();
  assertComplete(data);
  data.settings.brand = 'Changed in this session';
  assert.equal((await api.loadBundledRaw()).settings.brand, catalogue.settings.brand);
});

test('static data URLs are module-relative, not relative to a nested page URL', async (t) => {
  const urls = [];
  const api = await storefront(t, {
    fetch: async (url) => {
      urls.push(String(url));
      if (String(url).includes('content.json')) return Response.json(catalogue);
      return new Response(null, { status: 404 });
    },
  });
  globalThis.location.pathname = '/ce/product/nested/';
  assertComplete(await api.loadContent());
  assert.ok(urls.includes(new URL('../data/content.json', import.meta.url).href));
});
