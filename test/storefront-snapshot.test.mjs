import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import snapshot from '../js/content-snapshot.js';

const root = new URL('../', import.meta.url);

test('the committed recovery snapshot exactly matches the published catalogue', async () => {
  const catalogue = JSON.parse(await readFile(new URL('data/content.json', root), 'utf8'));
  assert.deepEqual(snapshot, catalogue);
});

test('snapshot generation is deterministic and needs no npm dependencies', () => {
  const check = spawnSync(process.execPath, ['scripts/build_content_snapshot.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr);
});
