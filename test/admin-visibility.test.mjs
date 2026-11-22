import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

test('storefront UI contains no Admin tab or link in header, mobile tabbar, or footer', () => {
  assert.doesNotMatch(appSource, /href="#\/admin"/, 'no UI link should point to #/admin');
  assert.doesNotMatch(appSource, /data-tab="admin"/, 'mobile tabbar must not include an admin tab');
  assert.doesNotMatch(appSource, /data-navlink="admin"/, 'header navigation must not include an admin link');
  assert.doesNotMatch(appSource, /footer__admin-link/, 'footer must not include an admin link');
});

test('admin route remains directly accessible via the address bar', () => {
  assert.match(appSource, /test:\s*\(s\)\s*=>\s*s\[0\]\s*===\s*"admin".*adminView/, 'router must keep the #/admin route');
});
