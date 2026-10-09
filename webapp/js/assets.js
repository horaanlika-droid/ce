/**
 * Метка версии картинок. Кадры тяжёлые (4K), поэтому отдаются с недельным
 * кэшем; чтобы перегонка стиля не показала покупателям старые файлы под тем
 * же именем, к URL добавляется ?v=<метка> — сервер считает её по самому
 * свежему mtime в webapp/assets/products (см. assetsVersion в src/config.js).
 */
let tag = '';

export function setAssetsV(v) {
  tag = v ? String(v) : '';
}

export function assetUrl(path) {
  // внешние URL (фото кастомных товаров по ссылке из админки) — без ?v=
  if (!path || !tag || path.startsWith('data:') || /^https?:\/\//i.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}v=${tag}`;
}
