import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const run = (dataDir) => {
  const r = spawnSync(process.execPath, ['test/_print-catalog.mjs'], {
    cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, `процесс завершился с ошибкой: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

test('пустой DATA_DIR (volume поверх ./data) не лишает витрину каталога', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-empty-'));
  const out = run(dir);
  assert.equal(out.status.ok, true, 'каталог найден');
  assert.equal(out.status.file, path.join(ROOT, 'data', 'catalog.json'), 'взят закоммиченный каталог');
  assert.ok(out.products > 0, 'на витрине есть товары');
  assert.equal(out.brand, 'Cocktail Embassy');
});

test('catalog.json в DATA_DIR имеет приоритет над закоммиченным', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-data-'));
  const custom = {
    brand: { name: 'Volume Brand' }, delivery: {}, categories: [{ id: 'c1', title: 'C1' }],
    products: [{ id: 'X1', title: 'Тест', priceAed: 10 }],
  };
  fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(custom));
  const out = run(dir);
  assert.equal(out.status.file, path.join(dir, 'catalog.json'));
  assert.equal(out.products, 1);
  assert.equal(out.brand, 'Volume Brand');
});

test('совсем без каталога — понятная ошибка, пустая витрина и живое приложение', () => {
  const r = spawnSync(process.execPath, ['test/_print-catalog.mjs'], {
    cwd: ROOT,
    env: { ...process.env, CATALOG_FILE: '/nonexistent-ce/catalog.json' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, 'процесс не упал');
  assert.match(r.stderr, /каталог не найден/);
  assert.match(r.stderr, /npm run catalog/);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.status.ok, false);
  assert.equal(out.products, 0);
});
