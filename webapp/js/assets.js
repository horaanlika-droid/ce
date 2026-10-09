/** Verified release URLs. Never invent a derivative for a remote photo. */
let tag = '';
let files = {};
export function setAssetsV(v) { tag = v ? String(v) : ''; }
export function setAssetsManifest(manifest) { files = manifest?.files || {}; }
export function assetUrl(path) {
  if (!path || /^(data:|https?:\/\/)/i.test(path)) return path;
  const key = path.replace(/^\//, '').split(/[?#]/)[0];
  if (files[key]) return files[key].url;
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return tag ? `${absolute}${absolute.includes('?') ? '&' : '?'}v=${tag}` : absolute;
}
export function published(path) { return files[String(path).replace(/^\//, '')]?.url || ''; }
export function imageSources(path, media = '') {
  const key = String(path).replace(/^\//, '').split(/[?#]/)[0];
  if (!/\.jpg$/i.test(key)) return '';
  return ['avif', 'webp'].map((ext) => {
    const url = published(key.replace(/\.jpg$/i, `.${ext}`));
    return url ? `<source type="image/${ext}"${media ? ` media="${media}"` : ''} srcset="${url}">` : '';
  }).join('');
}
