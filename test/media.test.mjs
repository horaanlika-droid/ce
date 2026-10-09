import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMediaManifest } from '../src/media.js';
import { setAssetsManifest, setAssetsV, assetUrl, imageSources } from '../webapp/js/assets.js';
import { productImg, coverImg } from '../webapp/js/ui.js';

test('publication: content hashes are stable across checkout timestamps; missing codecs are not advertised', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-media-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'assets/products');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'AG0001.jpg');
  fs.writeFileSync(file, 'release-one');
  fs.writeFileSync(path.join(dir, 'st-AG0001.jpg'), 'source-not-public');
  const before = buildMediaManifest(root);
  fs.utimesSync(file, new Date(0), new Date(0));
  assert.deepEqual(buildMediaManifest(root), before);
  fs.writeFileSync(file, 'release-two');
  const after = buildMediaManifest(root);
  assert.notEqual(after.version, before.version);
  assert.notEqual(after.files['assets/products/AG0001.jpg'].url, before.files['assets/products/AG0001.jpg'].url);
  assert.equal(Object.keys(after.files).length, 1);
  assert.equal(after.files['assets/products/AG0001.avif'], undefined);
});

test('client: absolute deep-route URLs, verified codecs, exact custom URLs, independent covers', () => {
  setAssetsV('release');
  setAssetsManifest({ files: {
    'assets/products/AG0001-card.jpg': { url: '/assets/products/AG0001-card.jpg?v=card' },
    'assets/products/AG0001-card.webp': { url: '/assets/products/AG0001-card.webp?v=webp' },
    'assets/covers/empty.jpg': { url: '/assets/covers/empty.jpg?v=cover' },
  } });
  assert.equal(assetUrl('assets/products/AG0001-card.jpg'), '/assets/products/AG0001-card.jpg?v=card');
  assert.match(assetUrl('assets/products/missing.jpg'), /^\/assets\//);
  const html = productImg({id: 'AG0001', name: 'Glass', image: 'assets/products/AG0001.jpg'});
  assert.match(html, /image\/webp/);
  assert.doesNotMatch(html, /image\/avif/);
  const url = 'https://example.com/photo.jpg?token=opaque';
  const custom = productImg({id: 'CUSTOM', name: 'Custom', image: url});
  assert.match(custom, /src="https:\/\/example.com\/photo.jpg\?token=opaque"/);
  assert.doesNotMatch(custom, /<source|photo-card/);
  assert.equal(imageSources(url), '');
  assert.match(coverImg('empty'), /src="\/assets\/covers\/empty.jpg\?v=cover"/);
  assert.match(productImg({id:'CUSTOM',name:'No photo'}), /placeholder\.svg/);
});
