import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../404.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function redirectFor(url) {
  const link = { setAttribute(name, value) { this[name] = value; } };
  const retargeted = [];
  const location = {
    href: url,
    get search() { return new URL(url).search; },
    replace(target) { retargeted.push(target); },
  };
  const window = { location };
  const sandbox = {
    window,
    document: { getElementById: () => link },
    URL,
  };
  vm.runInNewContext(script, sandbox);
  return { retargeted, link };
}

test('404 page exists in the repository root', () => {
  assert.ok(html.length > 100, '404.html is missing or suspiciously small');
  assert.match(html, /noindex/);
  assert.match(html, /<main>/);
});

test('404 page forwards path-like misses to the hash route', () => {
  for (const [url, target] of [
    ['https://horaanlika-droid.github.io/ce/admin', '/ce/#/admin'],
    ['https://horaanlika-droid.github.io/ce/admin/products', '/ce/#/admin/products'],
    ['https://horaanlika-droid.github.io/ce/shop?c=glasses', '/ce/#/shop?c=glasses'],
    ['https://horaanlika-droid.github.io/ce/product/AG0015', '/ce/#/product/AG0015'],
  ]) {
    const { retargeted } = redirectFor(url);
    assert.equal(retargeted[0], target, `${url} must forward to ${target}`);
  }
});

test('404 page forwards admin misses on a root-domain deployment', () => {
  const { retargeted, link } = redirectFor('https://example.com/admin');
  assert.equal(retargeted[0], '/#/admin');
  assert.equal(link.href, '/#/admin', 'the fallback link points at the same target');
});

test('404 page keeps genuine file and root misses as real 404s', () => {
  for (const url of [
    'https://horaanlika-droid.github.io/ce/missing-photo.png',
    'https://horaanlika-droid.github.io/ce/assets/brand/favicon.ico',
  ]) {
    const { retargeted } = redirectFor(url);
    assert.deepEqual(retargeted, [], `${url} must not redirect`);
  }
});
