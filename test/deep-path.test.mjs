import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const script = blocks.find((b) => b.includes('Deep-path fallback'));

function redirectFor(url, hash = '') {
  const retargeted = [];
  const location = {
    get pathname() { return new URL(url).pathname; },
    get search() { return new URL(url).search; },
    get hash() { return hash; },
    replace(target) { retargeted.push(target); },
  };
  const sandbox = { location, URL, console: { error: () => {} } };
  vm.runInNewContext(script, sandbox);
  return retargeted[0];
}

test('index.html carries a deep-path fallback redirect', () => {
  assert.ok(script, 'index.html must carry the deep-path fallback inline script');
  assert.match(script, /location\.replace/);
});

test('the inline fallback forwards path-like misses into the hash route', () => {
  for (const [url, expected] of [
    ['http://host/admin', '/#/admin'],
    ['http://host/ce/admin', '/ce/#/admin'],
    ['http://host/ce/admin/products', '/ce/#/admin/products'],
    ['http://host/ce/shop?c=glasses', '/ce/#/shop?c=glasses'],
    ['http://host/ce/product/AG0015', '/ce/#/product/AG0015'],
    ['http://host/product/AG0015', '/#/product/AG0015'],
    ['http://host/ce/admin?x=1', '/ce/#/admin?x=1'],
  ]) {
    assert.equal(redirectFor(url), expected, `${url} must forward to ${expected}`);
  }
});

test('the inline fallback leaves the site root and file misses alone', () => {
  for (const url of [
    'http://host/',
    'http://host/ce/',
    'http://host/missing-photo.png',
    'http://host/ce/assets/photo.png',
  ]) {
    assert.equal(redirectFor(url), undefined, `${url} must not redirect`);
  }
});

test('the inline fallback stays put once a hash already names a route', () => {
  assert.equal(redirectFor('http://host/ce/admin', '#/admin'), undefined);
  assert.equal(redirectFor('http://host/admin', '#/shop'), undefined);
});
