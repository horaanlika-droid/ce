/** Keep the fetch-independent storefront recovery copy in sync with its JSON source. */
import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../data/content.json', import.meta.url);
const target = new URL('../js/content-snapshot.js', import.meta.url);
const data = JSON.parse(await readFile(source, 'utf8'));
if (!data || !Array.isArray(data.products) || !Array.isArray(data.categories) || !data.settings) {
  throw new Error('Cannot build the storefront snapshot: malformed data/content.json');
}

const moduleText = '// Generated from data/content.json by npm run content:snapshot. Do not edit.\n'
  + '// Last-resort catalogue for browsers that cannot fetch the JSON file.\n'
  + `export default JSON.parse(${JSON.stringify(JSON.stringify(data))});\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== moduleText) {
    throw new Error('The storefront snapshot is out of date. Run npm run content:snapshot.');
  }
} else {
  await writeFile(target, moduleText);
  console.log(`[content] recovery snapshot: ${data.products.length} products, ${data.categories.length} categories`);
}
