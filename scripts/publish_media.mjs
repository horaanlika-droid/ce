/** Validate the complete release before deployment. No image library required. */
import fs from 'node:fs';
import { buildMediaManifest } from '../src/media.js';
const manifest = buildMediaManifest();
const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url)));
const required = catalog.products.flatMap((p) => [p.image, p.image.replace(/\.jpg$/, '-card.jpg')]);
required.push(...catalog.categories.map((c) => `assets/covers/${c.id}.jpg`));
for (let i = 1; i <= 5; i++) {
  const n = String(i).padStart(2, '0');
  required.push(`assets/app/hero-${n}.jpg`, `assets/app/hero-${n}-m.jpg`);
}
required.push('assets/app/background.jpg', 'assets/app/collections.jpg', 'assets/brand/og.jpg');
const missing = required.filter((key) => !manifest.files[key]);
if (missing.length) {
  console.error('[media] incomplete release:\n' + missing.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`[media] release ${manifest.version}: ${required.length} required images verified; ${Object.keys(manifest.files).length} published files`);
}
