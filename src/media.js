/** Publication registry: only files present in this release are advertised.
 * Versions are content hashes, never checkout mtimes. Custom remote images are
 * deliberately outside the registry (no guessed -card/AVIF siblings).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './config.js';

export function buildMediaManifest(root = path.join(ROOT, 'webapp')) {
  const files = {};
  for (const dir of ['products', 'brand', 'covers', 'app']) {
    const folder = path.join(root, 'assets', dir);
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder).sort()) {
      if (!/\.(jpg|png|webp|avif|svg)$/i.test(name) || /^(st-|src-)/.test(name)) continue;
      const key = `assets/${dir}/${name}`;
      const bytes = fs.readFileSync(path.join(folder, name));
      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      files[key] = { url: `/${key}?v=${hash}`, bytes: bytes.length };
    }
  }
  const version = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
  return { version, files };
}

// Release registry for this process. Build offline, validate, deploy/restart.
// URLs identify current bytes, not historical versions (no archive copies).
let release;
export function mediaManifest() {
  return release ||= buildMediaManifest();
}
