/**
 * Cocktail Embassy — web admin panel (#/admin).
 *
 * Works in TWO seamless modes:
 * 1. Live API mode — when `window.CE_CONFIG.apiBase` (or custom API URL in
 *    Admin → Публикация, or same-origin FastAPI server) is reachable:
 *    authenticates against `/api/admin/login` and writes straight to SQLite.
 * 2. Static / GitHub Pages mode — when hosted statically with no Python server:
 *    authenticates against SHA-256 password hash, saves edits immediately in
 *    browser override storage (live preview across the storefront), and supports
 *    1-click publishing to GitHub Pages (`data/content.json` + uploaded photos)
 *    or JSON export/import.
 */

import {
  mediaUrl,
  apiBase,
  isStatic,
  state,
  loadContent,
  loadBundledRaw,
  saveLocalOverride,
  clearLocalOverride,
  hasLocalOverride,
  getCustomApiBase,
  setCustomApiBase,
  listLocalRequests,
  setLocalRequestStatus,
  lastSaveStrippedImages,
  SITE_COVER_KEYS,
} from "./api.js";
import { esc, attr, toast } from "./ui.js";
import { icon } from "./icons.js";

const TOKEN_KEY = "ce.admin.token";
const PW_HASH_KEY = "ce.admin.pwHash";
const GH_TOKEN_KEY = "ce.admin.ghToken";
const GH_REPO_KEY = "ce.admin.ghRepo";

/** Human-readable error text; storage quota errors get a clear explanation. */
function errText(err) {
  const msg = String((err && err.message) || err || "");
  if ((err && err.name === "QuotaExceededError") || /quota/i.test(msg)) {
    return (
      "Не хватает места в хранилище браузера (черновик с фото слишком большой). " +
      "Сохраните GitHub-токен во вкладке «Публикация» — тогда фото будут сразу заливаться в папки репозитория, " +
      "либо нажмите «Опубликовать на сайт»."
    );
  }
  return msg || "Неизвестная ошибка";
}
// Default SHA-256("embassy2026")
const DEFAULT_PW_HASH = "81c02e5848f5cf8363cd941e29c5cb337b0033ad8d7ab834530aea6c7ecb15c1";

let adminToken = "";
try {
  adminToken = localStorage.getItem(TOKEN_KEY) || "";
} catch {
  /* ignore */
}

/* ----------------------------------------------------- pure-JS SHA-256 */
/* Works identically on HTTPS, plain HTTP LAN IPs, and Node test runners. */
function sha256Hex(ascii) {
  const bytes = new TextEncoder().encode(String(ascii));
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLen = bytes.length * 8;
  const totalLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(totalLen - 4, bitLen >>> 0, false);

  const W = new Uint32Array(64);
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, W[i - 15]) ^ rotr(18, W[i - 15]) ^ (W[i - 15] >>> 3);
      const s1 = rotr(17, W[i - 2]) ^ rotr(19, W[i - 2]) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return H.map((v) => v.toString(16).padStart(8, "0")).join("");
}

function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-") || `item-${Date.now().toString(36)}`
  );
}

/* -------------------------------------------------------------- auth API */

export function isAdmin() {
  return !!adminToken;
}

function notifyAuthChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent?.(new CustomEvent("ce-auth-changed", { detail: { admin: isAdmin() } }));
  }
}

export function logout() {
  adminToken = "";
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  notifyAuthChange();
  location.hash = "#/";
}

function expectedLocalHash() {
  try {
    return localStorage.getItem(PW_HASH_KEY) || DEFAULT_PW_HASH;
  } catch {
    return DEFAULT_PW_HASH;
  }
}

export async function adminLogin(password) {
  const clean = String(password || "").trim();
  if (!clean) throw new Error("Введите пароль");

  const base = apiBase();
  if (base) {
    let res;
    try {
      res = await fetch(`${base}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: clean }),
      });
    } catch {
      throw new Error(`Сервер недоступен (${base})`);
    }
    if (!res.ok) {
      if (res.status === 401) throw new Error("Неверный пароль");
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail || `Ошибка входа (${res.status})`);
    }
    const json = await res.json();
    adminToken = json.token;
  } else {
    const hash = sha256Hex(clean);
    if (hash !== expectedLocalHash()) {
      throw new Error("Неверный пароль");
    }
    adminToken = `local-${Date.now().toString(36)}`;
  }

  try {
    localStorage.setItem(TOKEN_KEY, adminToken);
  } catch {
    /* ignore */
  }
  notifyAuthChange();
  return adminToken;
}

export async function changeAdminPassword(currentPassword, newPassword) {
  const cur = String(currentPassword || "").trim();
  const next = String(newPassword || "").trim();
  if (next.length < 4) throw new Error("Новый пароль слишком короткий (минимум 4 символа)");

  const base = apiBase();
  if (base) {
    await api("/api/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: cur, newPassword: next }),
    });
    return;
  }

  if (sha256Hex(cur) !== expectedLocalHash()) {
    throw new Error("Текущий пароль указан неверно");
  }
  try {
    localStorage.setItem(PW_HASH_KEY, sha256Hex(next));
  } catch {
    throw new Error(errText({ name: "QuotaExceededError", message: "quota" }));
  }
}

function authHeaders() {
  return adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
}

async function api(path, options = {}) {
  const base = apiBase();
  if (!base) throw new Error("API сервер не подключён");
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    adminToken = "";
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    notifyAuthChange();
    location.hash = "#/admin";
    throw new Error("Сессия истекла — войдите заново");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error((detail && detail.detail) || `Ошибка запроса (${res.status})`);
  }
  return await res.json();
}

/* ------------------------------------------- unified data operations */

function cloneContent(data) {
  return JSON.parse(
    JSON.stringify({
      settings: data.settings || {},
      categories: data.categories || [],
      products: data.products || [],
    })
  );
}

async function refreshStorefront() {
  const fresh = await loadContent({ force: true });
  if (typeof window !== "undefined") {
    window.__CE_DATA__ = fresh;
    window.dispatchEvent?.(new CustomEvent("ce-content-updated", { detail: fresh }));
  }
  return fresh;
}

async function saveSettingsOp(settingsPatch, data) {
  if (!isStatic()) {
    try {
      await api("/api/admin/settings/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: settingsPatch }),
      });
    } catch {
      for (const [key, value] of Object.entries(settingsPatch)) {
        await api("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
      }
    }
    return await refreshStorefront();
  }
  const copy = cloneContent(data);
  copy.settings = { ...copy.settings, ...settingsPatch };
  return saveLocalOverride(copy);
}

async function saveProductOp(existingSlug, payload, data) {
  if (!isStatic()) {
    if (existingSlug) {
      await api(`/api/admin/products/${encodeURIComponent(existingSlug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    return await refreshStorefront();
  }
  const copy = cloneContent(data);
  if (existingSlug) {
    const idx = copy.products.findIndex((p) => p.slug === existingSlug);
    const nextSlug = payload.slug || existingSlug;
    const merged = { ...(idx >= 0 ? copy.products[idx] : {}), ...payload, slug: nextSlug };
    if (idx >= 0) copy.products[idx] = merged;
    else copy.products.push(merged);
  } else {
    let baseSlug = slugify(payload.slug || payload.name);
    let candidate = baseSlug;
    let n = 2;
    while (copy.products.some((p) => p.slug === candidate)) {
      candidate = `${baseSlug}-${n++}`;
    }
    const maxSort = copy.products.reduce((m, p) => Math.max(m, Number(p.sort) || 0), 0);
    copy.products.push({
      ...payload,
      slug: candidate,
      sort: Number.isFinite(payload.sort) ? payload.sort : maxSort + 1,
    });
  }
  return saveLocalOverride(copy);
}

async function deleteProductOp(slug, data) {
  if (!isStatic()) {
    await api(`/api/admin/products/${encodeURIComponent(slug)}`, { method: "DELETE" });
    return await refreshStorefront();
  }
  const copy = cloneContent(data);
  copy.products = copy.products.filter((p) => p.slug !== slug);
  return saveLocalOverride(copy);
}

async function saveCategoryOp(existingSlug, payload, data) {
  const cleanSlug = slugify(payload.slug || existingSlug || payload.name);
  const fullPayload = { ...payload, slug: cleanSlug };
  if (!isStatic()) {
    await api(`/api/admin/categories/${encodeURIComponent(existingSlug || cleanSlug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullPayload),
    });
    return await refreshStorefront();
  }
  const copy = cloneContent(data);
  if (existingSlug) {
    const idx = copy.categories.findIndex((c) => c.slug === existingSlug);
    if (idx >= 0) copy.categories[idx] = { ...copy.categories[idx], ...fullPayload };
    else copy.categories.push(fullPayload);
    if (existingSlug !== cleanSlug) {
      copy.products.forEach((p) => {
        if (p.categorySlug === existingSlug) p.categorySlug = cleanSlug;
      });
    }
  } else {
    copy.categories.push(fullPayload);
  }
  return saveLocalOverride(copy);
}

async function deleteCategoryOp(slug, data) {
  if (!isStatic()) {
    await api(`/api/admin/categories/${encodeURIComponent(slug)}`, { method: "DELETE" });
    return await refreshStorefront();
  }
  const copy = cloneContent(data);
  copy.categories = copy.categories.filter((c) => c.slug !== slug);
  copy.products.forEach((p) => {
    if (p.categorySlug === slug) p.categorySlug = "";
  });
  return saveLocalOverride(copy);
}

/** Resize/compress picked image file in browser, then upload to API or return compact data URL.
 *  Static mode + saved GitHub token: the photo goes straight into its repo folder
 *  (target = { folder, baseName }), so only a small path string is stored locally —
 *  no multi-megabyte data URLs that overflow localStorage. */
async function processImageFile(file, target = null) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Неподдерживаемый формат изображения"));
      img.onload = () => {
        // When the result will be kept in localStorage (static mode, no GitHub
        // token), compress harder so several photos still fit the storage quota.
        const willStoreLocally = isStatic() && !(localStorage.getItem(GH_TOKEN_KEY) || "").trim();
        const maxSide = willStoreLocally ? 960 : 1200;
        const q = willStoreLocally ? 0.78 : 0.84;
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
          const ratio = Math.min(maxSide / width, maxSide / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        let out = canvas.toDataURL("image/webp", q);
        if (!out.startsWith("data:image/webp")) {
          out = canvas.toDataURL("image/jpeg", Math.min(q + 0.06, 0.86));
        }
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  if (!isStatic()) {
    const res = await api("/api/admin/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name || "photo.webp", dataUrl }),
    });
    return res.url;
  }
  // Static (GitHub Pages) mode: if the owner saved a token in the Публикация tab,
  // upload directly into the item's repo folder and keep just the path.
  const token = (localStorage.getItem(GH_TOKEN_KEY) || "").trim();
  if (token && target && target.folder) {
    const repo = (localStorage.getItem(GH_REPO_KEY) || "horaanlika-droid/ce").trim();
    const m = /^data:image\/(webp|png|jpe?g);base64,(.+)$/i.exec(dataUrl);
    const ext = m ? (m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase()) : "webp";
    const filePath = `${target.folder}/${target.baseName || "photo"}.${ext}`;
    await ghPutFile({
      repo,
      branch: "main",
      token,
      path: filePath,
      base64Content: m ? m[2] : "",
      message: `Admin: upload ${filePath}`,
    });
    return filePath;
  }
  return dataUrl;
}

/* ------------------------------------------- GitHub Pages publisher */

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function ghPutFile({ repo, branch, token, path, base64Content, message }) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  let sha = "";
  const existing = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, { headers });
  if (existing.ok) {
    const meta = await existing.json();
    sha = meta.sha || "";
  } else if (existing.status !== 404) {
    const err = await existing.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API ${existing.status}`);
  }
  const body = { message, content: base64Content, branch };
  if (sha) body.sha = sha;
  const putRes = await fetch(apiUrl, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `Ошибка записи в GitHub (${putRes.status})`);
  }
  return await putRes.json();
}

async function publishToGitHub({ repo, branch = "main", token }, data, onStatus) {
  const cleanRepo = String(repo || "horaanlika-droid/ce").trim();
  const cleanToken = String(token || "").trim();
  if (!cleanToken) throw new Error("Укажите GitHub Personal Access Token");

  const copy = cloneContent(data);

  // Upload any inline data: images into per-item folders (glasses/, packaging/, covers/)
  for (const product of copy.products) {
    if (!Array.isArray(product.images)) continue;
    const topFolder =
      product.categorySlug === "acids" || product.categorySlug === "essences"
        ? "packaging"
        : "glasses";
    for (let i = 0; i < product.images.length; i++) {
      const img = product.images[i];
      const m = /^data:image\/(webp|png|jpe?g);base64,(.+)$/i.exec(img || "");
      if (m) {
        const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
        const fileName = i === 0 ? `photo.${ext}` : `photo-${i + 1}.${ext}`;
        const filePath = `${topFolder}/${slugify(product.slug)}/${fileName}`;
        onStatus?.(`Загрузка фото ${product.name}…`);
        await ghPutFile({
          repo: cleanRepo,
          branch,
          token: cleanToken,
          path: filePath,
          base64Content: m[2],
          message: `Admin: upload image for ${product.slug}`,
        });
        product.images[i] = filePath;
      }
    }
  }

  for (const cat of copy.categories) {
    const m = /^data:image\/(webp|png|jpe?g);base64,(.+)$/i.exec(cat.cover || "");
    if (m) {
      const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
      const filePath = `covers/category-${slugify(cat.slug)}/cover.${ext}`;
      onStatus?.(`Загрузка обложки ${cat.name}…`);
      await ghPutFile({
        repo: cleanRepo,
        branch,
        token: cleanToken,
        path: filePath,
        base64Content: m[2],
        message: `Admin: upload cover for ${cat.slug}`,
      });
      cat.cover = filePath;
    }
  }

  // Site-wide covers (settings.covers.*) as inline data: -> repo folders
  const coversIn = (copy.settings && copy.settings.covers) || {};
  for (const [key, folder] of SITE_COVER_KEYS) {
    const val = coversIn[key];
    if (typeof val !== "string") continue;
    const m = /^data:image\/(webp|png|jpe?g);base64,(.+)$/i.exec(val);
    if (!m) continue;
    const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
    const base = key === "announcementImage" ? "announcement" : "cover";
    const filePath = `${folder}/${base}.${ext}`;
    onStatus?.(`Загрузка обложки ${key}…`);
    await ghPutFile({
      repo: cleanRepo,
      branch,
      token: cleanToken,
      path: filePath,
      base64Content: m[2],
      message: `Admin: upload site cover ${key}`,
    });
    copy.settings.covers = { ...coversIn, [key]: filePath };
  }

  // Hero slide covers (settings.hero[].cover / portraitCover) as inline data:
  // -> covers/hero-<productSlug>/
  for (const slide of (copy.settings && copy.settings.hero) || []) {
    if (!slide.productSlug) continue;
    const folder = `covers/hero-${slugify(slide.productSlug)}`;
    for (const field of ["cover", "portraitCover"]) {
      const val = slide[field];
      if (typeof val !== "string") continue;
      const m = /^data:image\/(webp|png|jpe?g);base64,(.+)$/i.exec(val);
      if (!m) continue;
      const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
      const base = field === "portraitCover" ? "portrait" : "cover";
      const filePath = `${folder}/${base}.${ext}`;
      onStatus?.(`Загрузка обложки слайда ${slide.productSlug} (${base})…`);
      await ghPutFile({
        repo: cleanRepo,
        branch,
        token: cleanToken,
        path: filePath,
        base64Content: m[2],
        message: `Admin: upload hero ${base} for ${slide.productSlug}`,
      });
      slide[field] = filePath;
    }
  }

  const exportPayload = {
    version: 7,
    updatedAt: new Date().toISOString(),
    settings: copy.settings,
    categories: copy.categories.map(({ slug, name, blurb, sort, cover }) => ({
      slug,
      name,
      blurb: blurb || "",
      sort: Number(sort) || 0,
      ...(cover ? { cover } : {}),
    })),
    products: copy.products.map((p, idx) => {
      const out = {
        slug: p.slug,
        name: p.name,
        subtitle: p.subtitle || "",
        description: p.description || "",
        price: Number(p.price) || 0,
        volume: p.volume || "",
        categorySlug: p.categorySlug || "",
        badge: p.badge || "",
        featured: !!p.featured,
        inStock: p.inStock !== false,
        sort: Number.isFinite(p.sort) ? p.sort : idx,
        images: Array.isArray(p.images) ? p.images : [],
        specs: p.specs || {},
      };
      if (p.comingSoon) out.comingSoon = true;
      if (p.priceUsd !== undefined) out.priceUsd = p.priceUsd;
      return out;
    }),
  };

  onStatus?.("Публикация data/content.json в GitHub…");
  await ghPutFile({
    repo: cleanRepo,
    branch,
    token: cleanToken,
    path: "data/content.json",
    base64Content: toBase64Utf8(JSON.stringify(exportPayload, null, 2) + "\n"),
    message: "Update catalogue via web admin panel",
  });

  saveLocalOverride(exportPayload);
}

/* ---------------------------------------------------------- modal helper */

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove("is-open");
  document.body.style.overflow = "";
}

/* ------------------------------------------------------------ UI helpers */

function input(label, name, value = "", type = "text", placeholder = "", extra = "") {
  return `<div class="admin__field">
    <label class="admin__label">${esc(label)}</label>
    <input class="admin__input" name="${attr(name)}" type="${attr(type)}"
      value="${attr(value ?? "")}" placeholder="${attr(placeholder)}" ${extra}>
  </div>`;
}

function textarea(label, name, value = "", rows = 3, placeholder = "") {
  return `<div class="admin__field">
    <label class="admin__label">${esc(label)}</label>
    <textarea class="admin__textarea" name="${attr(name)}" rows="${rows}" placeholder="${attr(placeholder)}">${esc(value ?? "")}</textarea>
  </div>`;
}

function btn(label, kind = "default", type = "button", extraAttrs = "") {
  return `<button type="${attr(type)}" class="admin__btn admin__btn--${attr(kind)}" ${extraAttrs}>${label}</button>`;
}

function formatPrice(data, value) {
  const s = (data && data.settings) || {};
  try {
    return new Intl.NumberFormat(s.locale || "en-AE", {
      style: "currency",
      currency: s.currency || "AED",
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      minimumFractionDigits: 0,
    }).format(Number(value) || 0);
  } catch {
    return `${s.currency || "AED"} ${value}`;
  }
}

/* ------------------------------------------------------------ Login view */

function loginView() {
  const serverMode = !isStatic();
  const modeHint = serverMode
    ? `Сервер подключён: ${apiBase()}`
    : "Автономный режим: изменения сразу применяются на сайте и могут публиковаться в GitHub Pages";

  return {
    title: "Вход в админ-панель — Cocktail Embassy",
    html: `
      <div class="admin admin--login">
        <div class="admin__shell">
          <div class="admin__login-card">
            <img src="assets/brand/mark-chrome.png" alt="Cocktail Embassy" class="admin__logo">
            <h1 class="admin__h1">Админ-панель</h1>
            <p class="admin__subtitle">Управление каталогом, ценами, бегущими строками и настройками</p>

            <form class="admin__login-form" novalidate>
              <div class="admin__field">
                <label class="admin__label" for="admin-pw-input">Пароль администратора</label>
                <div class="admin__pw-wrap">
                  <input id="admin-pw-input" class="admin__input" name="password" type="password"
                    autocomplete="current-password" placeholder="Введите пароль" required>
                  <button type="button" class="admin__pw-toggle" data-pw-toggle aria-label="Показать пароль">
                    ${icon("eye")}
                  </button>
                </div>
              </div>
              <div class="admin__error" data-login-error hidden></div>
              <button type="submit" class="admin__btn admin__btn--primary admin__btn--full" data-login-submit>
                ${icon("lock")}<span>Войти</span>
              </button>
            </form>

            <p class="admin__hint">${esc(modeHint)}</p>
            <div style="text-align:center;margin-top:12px">
              <a href="#/" class="admin__back-link">← Вернуться в каталог</a>
            </div>
          </div>
        </div>
      </div>
    `,
    mount(main) {
      const form = main.querySelector(".admin__login-form");
      if (!form) return;
      const inp = form.querySelector('[name="password"]');
      const errEl = form.querySelector("[data-login-error]");
      const submitBtn = form.querySelector("[data-login-submit]");
      const toggleBtn = form.querySelector("[data-pw-toggle]");

      toggleBtn?.addEventListener("click", () => {
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        toggleBtn.innerHTML = icon(show ? "eyeOff" : "eye");
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errEl.hidden = true;
        submitBtn.disabled = true;
        try {
          await adminLogin(inp.value);
          toast("Вход выполнен");
          if (!location.hash.startsWith("#/admin/")) {
            location.hash = "#/admin/products";
          } else {
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          }
        } catch (err) {
          errEl.textContent = errText(err) || "Неверный пароль";
          errEl.hidden = false;
          inp.focus();
          inp.select?.();
        } finally {
          submitBtn.disabled = false;
        }
      });
    },
  };
}

/* --------------------------------------------------------- Products tab */

function productsView(data, rerender) {
  const products = data.products || [];
  const categories = data.categories || [];
  const catOptions = [
    `<option value="">— Без категории —</option>`,
    ...categories.map((c) => `<option value="${attr(c.slug)}">${esc(c.name)}</option>`),
  ].join("");

  return {
    title: "Товары — Админ-панель",
    html: `
      <div class="admin__section">
        <header class="admin__bar">
          <div>
            <h2 class="admin__h2">Товары <span class="admin__count" data-prod-count>${products.length}</span></h2>
            <p class="admin__sub">Редактируйте цены, описания, наличие, характеристики и фотографии</p>
          </div>
          <div class="admin__bar-right">
            ${btn(`${icon("plus")}<span>Добавить товар</span>`, "primary", "button", 'data-prod-add')}
          </div>
        </header>

        <div class="admin__filters">
          <div class="admin__search">
            ${icon("search")}
            <input type="search" class="admin__input" placeholder="Поиск по названию, артикулу, категории…" data-prod-search>
          </div>
          <select class="admin__input admin__cat-select" data-prod-cat>
            <option value="all">Все категории (${products.length})</option>
            ${categories.map((c) => `<option value="${attr(c.slug)}">${esc(c.name)}</option>`).join("")}
          </select>
        </div>

        <div class="admin__product-list" data-prod-list></div>

        <div class="admin__modal" data-prod-modal role="dialog" aria-modal="true" aria-label="Редактор товара">
          <div class="admin__modal-card">
            <header class="admin__modal-head">
              <h3 class="admin__card-title" data-prod-modal-title>Товар</h3>
              <button type="button" class="admin__icon-close" data-modal-close aria-label="Закрыть">${icon("close")}</button>
            </header>
            <form class="admin__modal-form" id="admin-product-form">
              <input type="hidden" name="existingSlug">
              <div class="admin__grid admin__grid--2">
                ${input("Название *", "name", "", "text", "Levitating Martini", "required")}
                ${input("Подзаголовок", "subtitle", "", "text", "Hand-Blown Crystal")}
              </div>
              ${textarea("Описание", "description", "", 3, "Описание бокала или позиции…")}
              <div class="admin__grid admin__grid--3">
                ${input("Цена (AED)", "price", "", "number", "0", 'step="0.01" min="0"')}
                ${input("Объём", "volume", "", "text", "190 ml")}
                <div class="admin__field">
                  <label class="admin__label">Категория</label>
                  <select class="admin__input" name="categorySlug">${catOptions}</select>
                </div>
              </div>
              <div class="admin__grid admin__grid--3">
                ${input("Артикул (Code)", "specCode", "", "text", "AG0020")}
                ${input("Бейдж", "badge", "", "text", "New")}
                ${input("Порядок (sort)", "sort", "0", "number")}
              </div>
              <div class="admin__grid admin__grid--3">
                ${input("Высота (Height)", "specHeight", "", "text", "185 mm")}
                ${input("Диаметр (Diameter)", "specDiameter", "", "text", "92 mm")}
                ${input("Материал (Material)", "specMaterial", "", "text", "Hand-blown crystal")}
              </div>
              <div class="admin__checks">
                <label class="admin__label admin__label--checkbox">
                  <input type="checkbox" name="featured"> На главной / Featured
                </label>
                <label class="admin__label admin__label--checkbox">
                  <input type="checkbox" name="inStock" checked> В наличии
                </label>
                <label class="admin__label admin__label--checkbox">
                  <input type="checkbox" name="comingSoon"> First series (скоро)
                </label>
              </div>

              <div class="admin__field">
                <div class="admin__label-row">
                  <label class="admin__label">Фотографии (первая — обложка)</label>
                  <label class="admin__upload-btn">
                    ${icon("upload")}<span>Загрузить фото</span>
                    <input type="file" accept="image/*" hidden data-prod-upload>
                  </label>
                </div>
                <div class="admin__img-previews" data-prod-previews></div>
                <textarea class="admin__textarea" name="images" rows="2" placeholder="glasses/levitating-martini/photo.webp (по одному пути на строку)"></textarea>
              </div>

              <footer class="admin__modal-foot">
                ${btn("Отмена", "default", "button", "data-modal-close")}
                ${btn("Сохранить товар", "primary", "submit")}
              </footer>
            </form>
          </div>
        </div>
      </div>
    `,
    mount(root) {
      const listEl = root.querySelector("[data-prod-list]");
      const countEl = root.querySelector("[data-prod-count]");
      const searchEl = root.querySelector("[data-prod-search]");
      const catEl = root.querySelector("[data-prod-cat]");
      const modal = root.querySelector("[data-prod-modal]");
      const modalTitle = root.querySelector("[data-prod-modal-title]");
      const form = root.querySelector("#admin-product-form");
      const uploadInp = root.querySelector("[data-prod-upload]");
      const previewsEl = root.querySelector("[data-prod-previews]");
      const imagesArea = form.querySelector('[name="images"]');

      let extraSpecs = {};

      function paintPreviews() {
        const urls = imagesArea.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        previewsEl.innerHTML = urls
          .map(
            (u, idx) => `<div class="admin__img-chip">
              <img src="${attr(mediaUrl(u))}" alt="">
              <button type="button" data-rm-img="${idx}" aria-label="Удалить фото">${icon("close")}</button>
            </div>`
          )
          .join("");
      }

      previewsEl.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-rm-img]");
        if (!rm) return;
        const idx = Number(rm.dataset.rmImg);
        const urls = imagesArea.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        urls.splice(idx, 1);
        imagesArea.value = urls.join("\n");
        paintPreviews();
      });

      imagesArea.addEventListener("input", paintPreviews);

      uploadInp?.addEventListener("change", async () => {
        const file = uploadInp.files?.[0];
        uploadInp.value = "";
        if (!file) return;
        try {
          toast("Обработка фото…");
          // target folder so a saved GitHub token can drop the photo straight into the repo
          const slug =
            String(form.elements.existingSlug.value || "").trim() ||
            slugify(String(form.elements.name.value || ""));
          const catSlug = String(form.elements.categorySlug.value || "").trim();
          const top = catSlug === "acids" || catSlug === "essences" ? "packaging" : "glasses";
          const folder = slug ? `${top}/${slug}` : "";
          const folderImgs = folder
            ? imagesArea.value
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter((u) => u.startsWith(folder + "/"))
            : [];
          const baseName = folderImgs.length === 0 ? "photo" : `photo-${folderImgs.length + 1}`;
          const url = await processImageFile(file, folder ? { folder, baseName } : null);
          const cur = imagesArea.value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          cur.unshift(url);
          imagesArea.value = cur.join("\n");
          paintPreviews();
          toast("Фото добавлено");
        } catch (err) {
          toast("Ошибка загрузки: " + errText(err), { iconName: "warning" });
        }
      });

      function renderList() {
        const q = (searchEl.value || "").trim().toLowerCase();
        const cat = catEl.value;
        const filtered = products.filter((p) => {
          if (cat !== "all" && p.categorySlug !== cat) return false;
          if (!q) return true;
          return [p.name, p.subtitle, p.slug, p.article, p.categorySlug].join(" ").toLowerCase().includes(q);
        });
        countEl.textContent = String(filtered.length);
        if (!filtered.length) {
          listEl.innerHTML = `<div class="admin__empty">Ничего не найдено</div>`;
          return;
        }
        listEl.innerHTML = filtered
          .map((p) => {
            const catObj = categories.find((c) => c.slug === p.categorySlug);
            const thumb = p.images?.[0]
              ? `<img src="${attr(mediaUrl(p.images[0]))}" alt="" loading="lazy">`
              : `<span>${icon("sparkle")}</span>`;
            const status = p.comingSoon
              ? "First series"
              : p.inStock !== false
              ? "в наличии"
              : "под заказ";
            return `
              <div class="admin__product-row" data-slug="${attr(p.slug)}">
                <div class="admin__product-thumb">${thumb}</div>
                <div class="admin__product-info">
                  <div class="admin__product-name">
                    ${esc(p.name)}
                    ${p.featured ? `<span class="admin__pill">★ витрина</span>` : ""}
                    ${p.badge ? `<span class="admin__pill">${esc(p.badge)}</span>` : ""}
                  </div>
                  <div class="admin__product-meta">
                    ${p.article ? `<span>${esc(p.article)}</span> · ` : ""}
                    <strong>${esc(p.comingSoon ? "First series" : formatPrice(data, p.price))}</strong>
                    · ${esc(catObj ? catObj.name : p.categorySlug || "Без категории")}
                    ${p.volume ? ` · ${esc(p.volume)}` : ""}
                    · ${esc(status)}
                  </div>
                </div>
                <div class="admin__product-actions">
                  ${btn(`${icon("edit")}<span>Изменить</span>`, "default", "button", `data-edit="${attr(p.slug)}"`)}
                  ${btn(`${icon("trash")}`, "danger", "button", `data-del="${attr(p.slug)}" aria-label="Удалить"`)}
                </div>
              </div>
            `;
          })
          .join("");
      }

      function populateModal(p = null) {
        form.reset();
        const specs = (p && p.specs) || {};
        extraSpecs = { ...specs };
        delete extraSpecs.Code;
        delete extraSpecs.Capacity;
        delete extraSpecs.Height;
        delete extraSpecs.Diameter;
        delete extraSpecs.Material;

        modalTitle.textContent = p ? `Редактировать: ${p.name}` : "Новый товар";
        form.elements.existingSlug.value = p ? p.slug : "";
        form.elements.name.value = p?.name || "";
        form.elements.subtitle.value = p?.subtitle || "";
        form.elements.description.value = p?.description || "";
        form.elements.price.value = p ? p.price : "";
        form.elements.volume.value = p?.volume || specs.Capacity || "";
        form.elements.categorySlug.value = p?.categorySlug || categories[0]?.slug || "";
        form.elements.specCode.value = specs.Code || p?.article || "";
        form.elements.badge.value = p?.badge || "";
        form.elements.sort.value = p ? p.sort ?? 0 : products.length + 1;
        form.elements.specHeight.value = specs.Height || "";
        form.elements.specDiameter.value = specs.Diameter || "";
        form.elements.specMaterial.value = specs.Material || "";
        form.elements.featured.checked = !!p?.featured;
        form.elements.inStock.checked = p ? p.inStock !== false : true;
        form.elements.comingSoon.checked = !!p?.comingSoon;
        imagesArea.value = Array.isArray(p?.images) ? p.images.join("\n") : "";
        paintPreviews();
        openModal(modal);
      }

      searchEl.addEventListener("input", renderList);
      catEl.addEventListener("change", renderList);

      root.querySelector("[data-prod-add]")?.addEventListener("click", () => populateModal(null));

      root.querySelectorAll("[data-modal-close]").forEach((b) =>
        b.addEventListener("click", () => closeModal(modal))
      );
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal(modal);
      });

      listEl.addEventListener("click", async (e) => {
        const editBtn = e.target.closest("[data-edit]");
        if (editBtn) {
          const item = products.find((x) => x.slug === editBtn.dataset.edit);
          if (item) populateModal(item);
          return;
        }
        const delBtn = e.target.closest("[data-del]");
        if (delBtn) {
          const item = products.find((x) => x.slug === delBtn.dataset.del);
          if (!item) return;
          if (!confirm(`Удалить «${item.name}»?`)) return;
          try {
            const updated = await deleteProductOp(item.slug, data);
            toast("Товар удалён");
            rerender(updated);
          } catch (err) {
            toast("Ошибка: " + errText(err), { iconName: "warning" });
          }
        }
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        if (!name) {
          toast("Введите название товара", { iconName: "warning" });
          return;
        }
        const existingSlug = String(fd.get("existingSlug") || "").trim();
        const volume = String(fd.get("volume") || "").trim();
        const specs = { ...extraSpecs };
        const code = String(fd.get("specCode") || "").trim();
        const height = String(fd.get("specHeight") || "").trim();
        const diameter = String(fd.get("specDiameter") || "").trim();
        const material = String(fd.get("specMaterial") || "").trim();
        if (code) specs.Code = code;
        if (volume) specs.Capacity = volume;
        if (height) specs.Height = height;
        if (diameter) specs.Diameter = diameter;
        if (material) specs.Material = material;

        const payload = {
          slug: existingSlug || slugify(name),
          name,
          subtitle: String(fd.get("subtitle") || "").trim(),
          description: String(fd.get("description") || "").trim(),
          price: Number(fd.get("price")) || 0,
          volume,
          categorySlug: String(fd.get("categorySlug") || "").trim(),
          badge: String(fd.get("badge") || "").trim(),
          sort: Number(fd.get("sort")) || 0,
          featured: fd.has("featured"),
          inStock: fd.has("inStock"),
          comingSoon: fd.has("comingSoon"),
          images: String(fd.get("images") || "")
            .split(/\r?\n/)
            .map((v) => v.trim())
            .filter(Boolean),
          specs,
        };

        try {
          const updated = await saveProductOp(existingSlug, payload, data);
          closeModal(modal);
          toast(
            lastSaveStrippedImages()
              ? "Сохранено. Фото не влезли в черновик браузера — нажмите «Опубликовать на сайт» (вкладка «Публикация»), чтобы залить их в репозиторий"
              : "Товар сохранён",
            { iconName: lastSaveStrippedImages() ? "warning" : "checkCircle", duration: lastSaveStrippedImages() ? 6000 : 2600 }
          );
          rerender(updated);
        } catch (err) {
          toast("Ошибка сохранения: " + errText(err), { iconName: "warning" });
        }
      });

      renderList();
    },
  };
}

/* ------------------------------------------------------- Categories tab */

function categoriesView(data, rerender) {
  const categories = data.categories || [];
  const products = data.products || [];

  const rows = categories
    .map((c) => {
      const count = products.filter((p) => p.categorySlug === c.slug).length;
      return `
        <div class="admin__product-row" data-cat-row="${attr(c.slug)}">
          ${
            c.cover
              ? `<div class="admin__product-thumb"><img src="${attr(mediaUrl(c.cover))}" alt=""></div>`
              : `<div class="admin__product-thumb admin__product-thumb--empty">${icon("grid")}</div>`
          }
          <div class="admin__product-info">
            <div class="admin__product-name">${esc(c.name)}</div>
            <div class="admin__product-meta">
              <code>${esc(c.slug)}</code> · ${esc(c.blurb || "—")} · товаров: ${count} · sort: ${c.sort ?? 0}
            </div>
          </div>
          <div class="admin__product-actions">
            ${btn(`${icon("edit")}<span>Изменить</span>`, "default", "button", `data-cat-edit="${attr(c.slug)}"`)}
            ${btn(`${icon("trash")}`, "danger", "button", `data-cat-del="${attr(c.slug)}" aria-label="Удалить"`)}
          </div>
        </div>
      `;
    })
    .join("");

  return {
    title: "Категории — Админ-панель",
    html: `
      <div class="admin__section">
        <header class="admin__bar">
          <div>
            <h2 class="admin__h2">Категории <span class="admin__count">${categories.length}</span></h2>
            <p class="admin__sub">Разделы каталога и плитки на главной странице</p>
          </div>
          <div class="admin__bar-right">
            ${btn(`${icon("plus")}<span>Добавить категорию</span>`, "primary", "button", "data-cat-add")}
          </div>
        </header>

        <div class="admin__product-list">
          ${rows || `<div class="admin__empty">Категорий пока нет</div>`}
        </div>

        <div class="admin__modal" data-cat-modal role="dialog" aria-modal="true" aria-label="Редактор категории">
          <div class="admin__modal-card">
            <header class="admin__modal-head">
              <h3 class="admin__card-title" data-cat-modal-title>Категория</h3>
              <button type="button" class="admin__icon-close" data-cat-close aria-label="Закрыть">${icon("close")}</button>
            </header>
            <form class="admin__modal-form" id="admin-cat-form">
              <input type="hidden" name="existingSlug">
              <div class="admin__grid admin__grid--2">
                ${input("Название *", "name", "", "text", "Highball & Collins", "required")}
                ${input("Код (slug)", "slug", "", "text", "highball")}
              </div>
              <div class="admin__grid admin__grid--2">
                ${input("Краткое описание (blurb)", "blurb", "", "text", "Long drinks, collins, hurricanes")}
                ${input("Порядок сортировки", "sort", "1", "number")}
              </div>
              <div class="admin__field">
                <div class="admin__label-row">
                  <label class="admin__label">Обложка (необязательно — иначе берётся первый товар)</label>
                  <label class="admin__upload-btn">
                    ${icon("upload")}<span>Загрузить</span>
                    <input type="file" accept="image/*" hidden data-cat-upload>
                  </label>
                </div>
                <input class="admin__input" name="cover" type="text" placeholder="covers/category-acids/cover.webp">
              </div>
              <footer class="admin__modal-foot">
                ${btn("Отмена", "default", "button", "data-cat-close")}
                ${btn("Сохранить", "primary", "submit")}
              </footer>
            </form>
          </div>
        </div>
      </div>
    `,
    mount(root) {
      const modal = root.querySelector("[data-cat-modal]");
      const titleEl = root.querySelector("[data-cat-modal-title]");
      const form = root.querySelector("#admin-cat-form");
      const uploadInp = root.querySelector("[data-cat-upload]");

      function openCatModal(cat = null) {
        form.reset();
        titleEl.textContent = cat ? `Категория: ${cat.name}` : "Новая категория";
        form.elements.existingSlug.value = cat ? cat.slug : "";
        form.elements.name.value = cat?.name || "";
        form.elements.slug.value = cat?.slug || "";
        form.elements.blurb.value = cat?.blurb || "";
        form.elements.sort.value = cat ? cat.sort ?? 1 : categories.length + 1;
        form.elements.cover.value = cat?.cover || "";
        openModal(modal);
      }

      root.querySelector("[data-cat-add]")?.addEventListener("click", () => openCatModal(null));
      root.querySelectorAll("[data-cat-close]").forEach((b) =>
        b.addEventListener("click", () => closeModal(modal))
      );
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal(modal);
      });

      uploadInp?.addEventListener("change", async () => {
        const file = uploadInp.files?.[0];
        uploadInp.value = "";
        if (!file) return;
        try {
          toast("Обработка фото…");
          const slug =
            String(form.elements.existingSlug.value || "").trim() ||
            slugify(String(form.elements.slug.value || form.elements.name.value || ""));
          const folder = slug ? `covers/category-${slug}` : "";
          const cur = String(form.elements.cover.value || "").trim();
          // keep the current folder file if there is one, else use the canonical cover name
          const baseName =
            folder && cur.startsWith(folder + "/")
              ? cur.slice(folder.length + 1).replace(/\.[^.]+$/, "")
              : "cover";
          const url = await processImageFile(file, folder ? { folder, baseName } : null);
          form.elements.cover.value = url;
          toast("Обложка загружена");
        } catch (err) {
          toast("Ошибка: " + errText(err), { iconName: "warning" });
        }
      });

      root.addEventListener("click", async (e) => {
        const editBtn = e.target.closest("[data-cat-edit]");
        if (editBtn) {
          const cat = categories.find((c) => c.slug === editBtn.dataset.catEdit);
          if (cat) openCatModal(cat);
          return;
        }
        const delBtn = e.target.closest("[data-cat-del]");
        if (delBtn) {
          const cat = categories.find((c) => c.slug === delBtn.dataset.catDel);
          if (!cat) return;
          if (!confirm(`Удалить категорию «${cat.name}»?`)) return;
          try {
            const updated = await deleteCategoryOp(cat.slug, data);
            toast("Категория удалена");
            rerender(updated);
          } catch (err) {
            toast("Ошибка: " + errText(err), { iconName: "warning" });
          }
        }
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        if (!name) return;
        const existingSlug = String(fd.get("existingSlug") || "").trim();
        const payload = {
          name,
          slug: slugify(fd.get("slug") || existingSlug || name),
          blurb: String(fd.get("blurb") || "").trim(),
          sort: Number(fd.get("sort")) || 0,
          cover: String(fd.get("cover") || "").trim(),
        };
        try {
          const updated = await saveCategoryOp(existingSlug, payload, data);
          closeModal(modal);
          toast(
            lastSaveStrippedImages()
              ? "Сохранено. Фото не влезли в черновик браузера — нажмите «Опубликовать на сайт» (вкладка «Публикация»), чтобы залить их в репозиторий"
              : "Категория сохранена",
            { iconName: lastSaveStrippedImages() ? "warning" : "checkCircle", duration: lastSaveStrippedImages() ? 6000 : 2600 }
          );
          rerender(updated);
        } catch (err) {
          toast("Ошибка: " + errText(err), { iconName: "warning" });
        }
      });
    },
  };
}

/* --------------------------------------------------------- Partners tab */

function partnersView(data, rerender) {
  const partners = data.settings?.partners || [];
  const rows = partners.map((p, i) => `
    <form class="admin__product-row" data-partner-form="${i}" style="align-items:center;gap:10px;flex-wrap:wrap">
      <div style="width:68px;height:48px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04);border-radius:6px;padding:4px;flex:none">
        ${mediaUrl(p.logo || (p.file ? `assets/partners/${p.file}` : "")) ? `<img src="${attr(mediaUrl(p.logo || `assets/partners/${p.file || ""}`))}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">` : ""}
      </div>
      <label class="admin__field" style="flex:1;min-width:150px"><span class="admin__label">Название</span><input class="admin__input" name="name" required value="${attr(p.name || "")}"></label>
      <label class="admin__field" style="flex:1;min-width:130px"><span class="admin__label">Локация</span><input class="admin__input" name="location" value="${attr(p.location || "")}"></label>
      <label class="admin__field" style="flex:1;min-width:130px"><span class="admin__label">Бейдж</span><input class="admin__input" name="badge" value="${attr(p.badge || "")}"></label>
      <label class="admin__field" style="flex:2;min-width:180px"><span class="admin__label">Логотип (путь или URL)</span><input class="admin__input" name="logo" value="${attr(p.logo || (p.file ? `assets/partners/${p.file}` : ""))}"></label>
      <div style="display:flex;gap:6px">${btn("Сохранить", "primary", "submit")}${btn("Удалить", "danger", "button", `data-partner-delete="${i}"`)}</div>
    </form>`).join("");
  return {
    title: "Партнёры — Админ-панель",
    html: `<div class="admin__section-head"><div><h2 class="admin__section-title">Партнёры (${partners.length})</h2><p class="admin__section-desc">Премиальные заведения, бары и отели, использующие посуду Cocktail Embassy.</p></div>${btn(`${icon("plus")}<span>Добавить партнёра</span>`, "primary", "button", "data-partner-add")}</div><div class="admin__list">${rows || '<div class="admin__empty">Партнёров пока нет</div>'}</div>`,
    mount(root) {
      const save = (next) => saveLocalOverride({ ...cloneContent(data), settings: { ...data.settings, partners: next } });
      root.querySelector("[data-partner-add]")?.addEventListener("click", async () => {
        try { rerender(await save([...partners, { name: "Новый партнёр", location: "Dubai", badge: "", logo: "" }])); }
        catch (err) { toast("Ошибка: " + errText(err), { iconName: "warning" }); }
      });
      root.addEventListener("click", async (e) => {
        const button = e.target.closest("[data-partner-delete]");
        if (!button) return;
        const index = Number(button.dataset.partnerDelete);
        if (!confirm(`Удалить партнёра «${partners[index]?.name || ""}»?`)) return;
        try { rerender(await save(partners.filter((_, i) => i !== index))); }
        catch (err) { toast("Ошибка: " + errText(err), { iconName: "warning" }); }
      });
      root.querySelectorAll("[data-partner-form]").forEach((form) => form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const index = Number(form.dataset.partnerForm);
        const fd = new FormData(form);
        const next = partners.map((p, i) => i === index ? { ...p, name: String(fd.get("name")).trim(), location: String(fd.get("location")).trim(), badge: String(fd.get("badge")).trim(), logo: String(fd.get("logo")).trim(), file: "" } : p);
        try { rerender(await save(next)); toast("Партнёр сохранён"); }
        catch (err) { toast("Ошибка: " + errText(err), { iconName: "warning" }); }
      }));
    },
  };
}

/* --------------------------------------------------------- Settings tab */

function settingsView(data, rerender) {
  const s = data.settings || {};
  const c = s.contacts || {};
  const heroSlides = Array.isArray(s.hero) ? s.hero : [];
  const productOptions = (selectedSlug) =>
    (data.products || [])
      .map(
        (p) =>
          `<option value="${attr(p.slug)}" ${p.slug === selectedSlug ? "selected" : ""}>${esc(p.name)} (${esc(
            p.slug
          )})</option>`
      )
      .join("");

  // One editable site-wide cover (settings.covers.<key>): upload button + preview + path input
  const siteCoverField = (label, key, value, placeholder) => {
    const folder = (SITE_COVER_KEYS.find(([k]) => k === key) || [null, "covers"])[1];
    const base = key === "announcementImage" ? "announcement" : "cover";
    return `
          <div class="admin__field">
            <div class="admin__label-row">
              <label class="admin__label">${label}</label>
              <label class="admin__upload-btn">
                ${icon("upload")}<span>Загрузить</span>
                <input type="file" accept="image/*" hidden data-sitecover-upload data-key="${attr(key)}" data-folder="${attr(folder)}" data-base="${base}">
              </label>
            </div>
            <div class="admin__img-previews" data-sitecover-preview="${attr(key)}"></div>
            <input class="admin__input" name="covers.${attr(key)}" type="text"
              value="${attr(value || "")}" placeholder="${attr(placeholder)}">
          </div>`;
  };

  // Cover + portrait upload fields for one hero slide row
  const heroCoverFields = (coverVal, portraitVal) => `
                  <div class="admin__grid admin__grid--2" style="margin-top:8px">
                    <div class="admin__field">
                      <div class="admin__label-row">
                        <label class="admin__label">Обложка слайда (cover)</label>
                        <label class="admin__upload-btn">
                          ${icon("upload")}<span>Загрузить</span>
                          <input type="file" accept="image/*" hidden data-hero-cover-upload>
                        </label>
                      </div>
                      <div class="admin__img-previews" data-hero-cover-preview></div>
                      <input class="admin__input" type="text" data-hero-cover value="${attr(coverVal || "")}" placeholder="covers/hero-…/cover.webp">
                    </div>
                    <div class="admin__field">
                      <div class="admin__label-row">
                        <label class="admin__label">Обложка для мобильных (portrait)</label>
                        <label class="admin__upload-btn">
                          ${icon("upload")}<span>Загрузить</span>
                          <input type="file" accept="image/*" hidden data-hero-portrait-upload>
                        </label>
                      </div>
                      <div class="admin__img-previews" data-hero-portrait-preview></div>
                      <input class="admin__input" type="text" data-hero-portrait value="${attr(portraitVal || "")}" placeholder="covers/hero-…/portrait.webp">
                    </div>
                  </div>`;

  return {
    title: "Настройки сайта — Админ-панель",
    html: `
      <div class="admin__section">
        <header class="admin__bar admin__bar--sticky">
          <div>
            <h2 class="admin__h2">Настройки сайта</h2>
            <p class="admin__sub">Бренд, контакты, бегущие строки и главный экран</p>
          </div>
          <div class="admin__bar-right">
            <button type="submit" form="admin-settings-form" class="admin__btn admin__btn--primary">
              ${icon("check")}<span>Сохранить всё</span>
            </button>
          </div>
        </header>

        <form class="admin__form" id="admin-settings-form">
          <h3 class="admin__section-title">Основное</h3>
          <div class="admin__grid admin__grid--2">
            ${input("Название бренда", "brand", s.brand || "Cocktail Embassy")}
            ${input("Теглайн", "tagline", s.tagline || "")}
            ${input("Валюта", "currency", s.currency || "AED")}
            ${input("Локаль форматирования", "locale", s.locale || "en-AE")}
            ${input("Бесплатная доставка от", "freeShippingFrom", s.freeShippingFrom ?? "", "number")}
            ${input("Стоимость доставки", "shippingCost", s.shippingCost ?? "", "number")}
          </div>

          <div class="admin__grid admin__grid--2" style="margin-top:12px">
            ${textarea("Объявление (первая фраза бегущей строки)", "announcement", s.announcement || "", 2)}
            ${textarea("Примечание к цене", "priceNote", s.priceNote || "", 2)}
            ${textarea("Примечание к заявке", "requestNote", s.requestNote || "", 3)}
            ${textarea("Условия доставки", "shippingNote", s.shippingNote || "", 3)}
            ${textarea("Возврат и бой в пути", "returnsNote", s.returnsNote || "", 2)}
            ${textarea("О бренде (About)", "about", s.about || "", 3)}
          </div>

          <div class="admin__field" style="margin-top:12px">
            <div class="admin__label-row">
              <label class="admin__label">Картинка к объявлению (показывается в бегущей строке, необязательно)</label>
              <label class="admin__upload-btn">
                ${icon("upload")}<span>Загрузить картинку</span>
                <input type="file" accept="image/*" hidden data-announce-upload>
              </label>
            </div>
            <div class="admin__img-previews" data-announce-preview></div>
            <input class="admin__input" name="covers.announcementImage" type="text"
              value="${attr((s.covers && s.covers.announcementImage) || "")}" placeholder="covers/announcement/announcement.webp">
          </div>

          <h3 class="admin__section-title">Фото на сайте (главная, «Инфо», шаринг)</h3>
          <div class="admin__grid admin__grid--2">
            ${siteCoverField("Фото блока «Ремесло» на главной", "homeCraft", s.covers && s.covers.homeCraft, "covers/home-craft/cover.webp")}
            ${siteCoverField("Баннер на странице «Инфо»", "infoBanner", s.covers && s.covers.infoBanner, "covers/info-banner/cover.webp")}
            ${siteCoverField("Фото в блоке «История» на «Инфо»", "infoStory", s.covers && s.covers.infoStory, "covers/info-story/cover.webp")}
            ${siteCoverField("Картинка для шаринга (og:image)", "ogShare", s.covers && s.covers.ogShare, "covers/og-share/cover.jpg")}
          </div>

          <h3 class="admin__section-title">Контакты</h3>
          <div class="admin__grid admin__grid--2">
            ${input("Email", "contacts.email", c.email || "", "email")}
            ${input("Телефон", "contacts.phone", c.phone || "")}
            ${input("WhatsApp (ссылка)", "contacts.whatsapp", c.whatsapp || "")}
            ${input("Telegram (ссылка)", "contacts.telegram", c.telegram || "")}
            ${input("Instagram (ссылка)", "contacts.instagram", c.instagram || "")}
            ${input("Адрес", "contacts.address", c.address || "")}
            ${input("Подпись / режим работы", "contacts.hours", c.hours || "")}
          </div>

          <h3 class="admin__section-title">Бегущие строки</h3>
          <div class="admin__grid admin__grid--2">
            ${textarea(
              "Верхняя бегущая строка (по одной фразе на строку)",
              "ticker",
              Array.isArray(s.ticker) ? s.ticker.join("\n") : s.ticker || "",
              5
            )}
            ${textarea(
              "Крупная строка под героем (по одной на строку, *курсив*)",
              "marquee",
              Array.isArray(s.marquee) ? s.marquee.join("\n") : s.marquee || "",
              5
            )}
          </div>

          <div class="admin__subhead-row">
            <h3 class="admin__section-title" style="margin:0">Слайды на главной (Hero)</h3>
            ${btn(`${icon("plus")}<span>Добавить слайд</span>`, "default", "button", "data-hero-add")}
          </div>
          <div class="admin__repeater" data-hero-list>
            ${heroSlides
              .map(
                (sl) => `
              <div class="admin__repeater-item" data-hero-item>
                <div class="admin__repeater-main">
                  <div class="admin__grid admin__grid--3">
                    <select class="admin__input" data-hero-slug>${productOptions(sl.productSlug)}</select>
                    <input class="admin__input" type="text" data-hero-kicker value="${attr(sl.kicker || "")}" placeholder="Надпись сверху (kicker)">
                    <input class="admin__input" type="text" data-hero-title value="${attr(sl.title || "")}" placeholder="Крупный заголовок">
                  </div>
                  <div class="admin__grid admin__grid--2" style="margin-top:8px">
                    <input class="admin__input" type="text" data-hero-name value="${attr(sl.name || "")}" placeholder="Название модели">
                    <input class="admin__input" type="text" data-hero-sub value="${attr(sl.subtitle || "")}" placeholder="Подзаголовок">
                  </div>
                  <textarea class="admin__textarea" style="margin-top:8px" rows="2" data-hero-copy placeholder="Описание на слайде">${esc(
                    sl.copy || ""
                  )}</textarea>
                  ${heroCoverFields(sl.cover, sl.portraitCover)}
                </div>
                <button type="button" class="admin__btn admin__btn--danger" data-hero-rm aria-label="Удалить слайд">${icon("trash")}</button>
              </div>
            `
              )
              .join("")}
          </div>

          <div class="admin__form-footer">
            <button type="submit" class="admin__btn admin__btn--primary">
              ${icon("check")}<span>Сохранить настройки</span>
            </button>
          </div>
        </form>
      </div>
    `,
    mount(root) {
      const form = root.querySelector("#admin-settings-form");
      const heroListEl = root.querySelector("[data-hero-list]");

      /* announcement image: upload -> covers/announcement/ (repo, when token saved)
         or /media/ on the API server, or a data URL in plain static mode */
      const announceInp = root.querySelector("[data-announce-upload]");
      const announceField = form?.elements?.["covers.announcementImage"];
      const announcePreview = root.querySelector("[data-announce-preview]");
      function paintAnnouncePreview() {
        const v = String(announceField?.value || "").trim();
        if (announcePreview) {
          announcePreview.innerHTML = v
            ? `<div class="admin__img-chip"><img src="${attr(mediaUrl(v))}" alt=""></div>`
            : "";
        }
      }
      if (announceField) {
        announceField.addEventListener("input", paintAnnouncePreview);
        paintAnnouncePreview();
      }
      announceInp?.addEventListener("change", async () => {
        const file = announceInp.files?.[0];
        announceInp.value = "";
        if (!file) return;
        try {
          toast("Обработка фото…");
          const url = await processImageFile(file, {
            folder: "covers/announcement",
            baseName: "announcement",
          });
          announceField.value = url;
          paintAnnouncePreview();
          toast("Картинка загружена");
        } catch (err) {
          toast("Ошибка загрузки: " + errText(err), { iconName: "warning" });
        }
      });

      /* site-wide covers (settings.covers.homeCraft/infoBanner/infoStory/ogShare):
         upload -> covers/<folder>/ (repo, when token saved), /media/ on the API
         server, or a data URL in plain static mode */
      const paintSiteCoverPreview = (key) => {
        const field = form?.elements?.[`covers.${key}`];
        const preview = root.querySelector(`[data-sitecover-preview="${key}"]`);
        if (preview) {
          const v = String(field?.value || "").trim();
          preview.innerHTML = v
            ? `<div class="admin__img-chip"><img src="${attr(mediaUrl(v))}" alt=""></div>`
            : "";
        }
      };
      root.querySelectorAll("[data-sitecover-upload]").forEach((inp) => {
        const key = inp.dataset.key || "";
        const field = form?.elements?.[`covers.${key}`];
        field?.addEventListener("input", () => paintSiteCoverPreview(key));
        paintSiteCoverPreview(key);
        inp.addEventListener("change", async () => {
          const file = inp.files?.[0];
          inp.value = "";
          if (!file || !key) return;
          try {
            toast("Обработка фото…");
            const url = await processImageFile(file, {
              folder: inp.dataset.folder || "covers",
              baseName: inp.dataset.base || "cover",
            });
            if (field) field.value = url;
            paintSiteCoverPreview(key);
            toast("Фото загружено");
          } catch (err) {
            toast("Ошибка загрузки: " + errText(err), { iconName: "warning" });
          }
        });
      });

      /* hero slide covers: per-row upload into covers/hero-<productSlug>/ */
      const paintHeroPreviews = (row) => {
        for (const [fieldSel, prevSel] of [
          ["[data-hero-cover]", "[data-hero-cover-preview]"],
          ["[data-hero-portrait]", "[data-hero-portrait-preview]"],
        ]) {
          const field = row.querySelector(fieldSel);
          const preview = row.querySelector(prevSel);
          if (preview) {
            const v = String(field?.value || "").trim();
            preview.innerHTML = v
              ? `<div class="admin__img-chip"><img src="${attr(mediaUrl(v))}" alt=""></div>`
              : "";
          }
        }
      };
      heroListEl?.querySelectorAll("[data-hero-item]").forEach(paintHeroPreviews);
      heroListEl?.addEventListener("input", (e) => {
        if (e.target.closest("[data-hero-cover],[data-hero-portrait]")) {
          const row = e.target.closest("[data-hero-item]");
          if (row) paintHeroPreviews(row);
        }
      });
      heroListEl?.addEventListener("change", async (e) => {
        const inp = e.target.closest("[data-hero-cover-upload],[data-hero-portrait-upload]");
        if (!inp) return;
        const row = inp.closest("[data-hero-item]");
        const file = inp.files?.[0];
        inp.value = "";
        if (!file || !row) return;
        const isPortrait = inp.hasAttribute("data-hero-portrait-upload");
        const slug = String(row.querySelector("[data-hero-slug]")?.value || "").trim();
        const folder = slug ? `covers/hero-${slugify(slug)}` : "";
        const base = isPortrait ? "portrait" : "cover";
        const field = row.querySelector(isPortrait ? "[data-hero-portrait]" : "[data-hero-cover]");
        try {
          toast("Обработка фото…");
          const url = await processImageFile(file, folder ? { folder, baseName: base } : null);
          if (field) field.value = url;
          paintHeroPreviews(row);
          toast("Обложка слайда загружена");
        } catch (err) {
          toast("Ошибка загрузки: " + errText(err), { iconName: "warning" });
        }
      });

      root.querySelector("[data-hero-add]")?.addEventListener("click", () => {
        const firstProd = data.products?.[0];
        const div = document.createElement("div");
        div.className = "admin__repeater-item";
        div.dataset.heroItem = "";
        div.innerHTML = `
          <div class="admin__repeater-main">
            <div class="admin__grid admin__grid--3">
              <select class="admin__input" data-hero-slug>${productOptions(firstProd?.slug || "")}</select>
              <input class="admin__input" type="text" data-hero-kicker value="The House" placeholder="Надпись сверху (kicker)">
              <input class="admin__input" type="text" data-hero-title value="${attr(firstProd?.name || "")}" placeholder="Крупный заголовок">
            </div>
            <div class="admin__grid admin__grid--2" style="margin-top:8px">
              <input class="admin__input" type="text" data-hero-name value="${attr(firstProd?.name || "")}" placeholder="Название модели">
              <input class="admin__input" type="text" data-hero-sub value="${attr(firstProd?.subtitle || "")}" placeholder="Подзаголовок">
            </div>
            <textarea class="admin__textarea" style="margin-top:8px" rows="2" data-hero-copy placeholder="Описание на слайде"></textarea>
            ${heroCoverFields("", "")}
          </div>
          <button type="button" class="admin__btn admin__btn--danger" data-hero-rm aria-label="Удалить слайд">${icon("trash")}</button>
        `;
        heroListEl.appendChild(div);
      });

      heroListEl?.addEventListener("click", (e) => {
        const rm = e.target.closest("[data-hero-rm]");
        if (rm) rm.closest("[data-hero-item]")?.remove();
      });

      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const patch = {};
        const contacts = { ...(s.contacts || {}) };
        const coversPatch = {};

        for (const [key, value] of fd.entries()) {
          if (key.startsWith("contacts.")) {
            contacts[key.slice("contacts.".length)] = String(value).trim();
          } else if (key.startsWith("covers.")) {
            coversPatch[key.slice("covers.".length)] = String(value).trim();
          } else if (key === "ticker" || key === "marquee") {
            patch[key] = String(value)
              .split(/\r?\n/)
              .map((v) => v.trim())
              .filter(Boolean);
          } else if (key === "freeShippingFrom" || key === "shippingCost") {
            patch[key] = Number(value) || 0;
          } else {
            patch[key] = String(value).trim();
          }
        }
        patch.contacts = contacts;
        if (Object.keys(coversPatch).length) {
          patch.covers = { ...(s.covers || {}), ...coversPatch };
        }

        const existingHeroBySlug = new Map(heroSlides.map((h) => [h.productSlug, h]));
        patch.hero = [...heroListEl.querySelectorAll("[data-hero-item]")]
          .map((row) => {
            const productSlug = row.querySelector("[data-hero-slug]")?.value || "";
            const prev = existingHeroBySlug.get(productSlug) || {};
            const coverVal = String(row.querySelector("[data-hero-cover]")?.value || "").trim();
            const portraitVal = String(row.querySelector("[data-hero-portrait]")?.value || "").trim();
            return {
              productSlug,
              kicker: row.querySelector("[data-hero-kicker]")?.value.trim() || "",
              title: row.querySelector("[data-hero-title]")?.value.trim() || "",
              name: row.querySelector("[data-hero-name]")?.value.trim() || "",
              subtitle: row.querySelector("[data-hero-sub]")?.value.trim() || "",
              copy: row.querySelector("[data-hero-copy]")?.value.trim() || "",
              ...(coverVal ? { cover: coverVal } : prev.cover ? { cover: prev.cover } : {}),
              ...(portraitVal
                ? { portraitCover: portraitVal }
                : prev.portraitCover
                  ? { portraitCover: prev.portraitCover }
                  : {}),
            };
          })
          .filter((x) => x.productSlug);

        try {
          const updated = await saveSettingsOp(patch, data);
          toast(
            lastSaveStrippedImages()
              ? "Сохранено. Фото не влезли в черновик браузера — нажмите «Опубликовать на сайт» (вкладка «Публикация»), чтобы залить их в репозиторий"
              : "Настройки сохранены",
            { iconName: lastSaveStrippedImages() ? "warning" : "checkCircle", duration: lastSaveStrippedImages() ? 6000 : 2600 }
          );
          rerender(updated);
        } catch (err) {
          toast("Ошибка сохранения: " + errText(err), { iconName: "warning" });
        }
      });
    },
  };
}

/* --------------------------------------------------------- Requests tab */

const STATUS_LABELS = {
  new: "Новая",
  confirmed: "Подтверждена",
  packing: "Сборка",
  shipped: "Отправлена",
  delivered: "Доставлена",
  cancelled: "Отменена",
};

function requestsView(data) {
  return {
    title: "Заявки — Админ-панель",
    html: `
      <div class="admin__section">
        <header class="admin__bar">
          <div>
            <h2 class="admin__h2">Заявки <span class="admin__count" data-req-count>0</span></h2>
            <p class="admin__sub">
              ${
                isStatic()
                  ? "В статическом режиме показаны заявки с этого устройства (остальные приходят на почту). Подключите API-сервер для централизованного приёма."
                  : "Все входящие заявки с сайта в реальном времени"
              }
            </p>
          </div>
          <div class="admin__bar-right">
            <select class="admin__input" data-req-filter style="width:auto">
              <option value="all">Все статусы</option>
              ${Object.entries(STATUS_LABELS)
                .map(([k, label]) => `<option value="${attr(k)}">${esc(label)}</option>`)
                .join("")}
            </select>
          </div>
        </header>
        <div class="admin__req-list" data-req-list>
          <div class="admin__empty">Загрузка заявок…</div>
        </div>
      </div>
    `,
    mount(root) {
      const listEl = root.querySelector("[data-req-list]");
      const countEl = root.querySelector("[data-req-count]");
      const filterEl = root.querySelector("[data-req-filter]");

      async function load() {
        const status = filterEl.value;
        try {
          let items = [];
          if (!isStatic()) {
            const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
            items = await api(`/api/admin/requests${qs}`);
          } else {
            items = listLocalRequests().filter((r) => status === "all" || r.status === status);
          }
          countEl.textContent = String(items.length);
          if (!items.length) {
            listEl.innerHTML = `<div class="admin__empty">Заявок с выбранным фильтром пока нет</div>`;
            return;
          }
          listEl.innerHTML = items
            .map((r) => {
              const date = r.createdAt ? new Date(r.createdAt).toLocaleString("ru-RU") : "";
              const lines = (r.items || [])
                .map((i) => `${i.qty} × ${esc(i.name || i.slug)}`)
                .join(" · ");
              return `
                <div class="admin__card" style="margin:0">
                  <div class="admin__card-head">
                    <div>
                      <strong>${esc(r.reference || `#${r.id}`)}</strong>
                      <span style="color:#8a8a8a;font-size:12px;margin-left:8px">${esc(date)}</span>
                    </div>
                    <select class="admin__input" data-req-status="${attr(r.id)}" style="width:auto;padding:6px 10px">
                      ${Object.entries(STATUS_LABELS)
                        .map(
                          ([k, label]) =>
                            `<option value="${attr(k)}" ${r.status === k ? "selected" : ""}>${esc(label)}</option>`
                        )
                        .join("")}
                    </select>
                  </div>
                  <div class="admin__card-body" style="display:grid;gap:6px;font-size:13px">
                    <div><strong>${esc(r.name || "—")}</strong>${r.company ? ` · ${esc(r.company)}` : ""}${
                r.country ? ` · ${esc(r.country)}` : ""
              }</div>
                    <div style="color:#b0b0b0">
                      ${r.email ? `<a href="mailto:${attr(r.email)}">${esc(r.email)}</a>` : ""}
                      ${r.phone ? ` · <a href="tel:${attr(r.phone)}">${esc(r.phone)}</a>` : ""}
                    </div>
                    <div>${lines || "—"}</div>
                    <div><strong>Сумма: ${esc(formatPrice(data, r.total || 0))}</strong></div>
                    ${r.note ? `<div style="color:#9e9e9e">Комментарий: ${esc(r.note)}</div>` : ""}
                  </div>
                </div>
              `;
            })
            .join("");
        } catch (err) {
          listEl.innerHTML = `<div class="admin__empty">Ошибка загрузки заявок: ${esc(errText(err))}</div>`;
        }
      }

      filterEl.addEventListener("change", load);
      listEl.addEventListener("change", async (e) => {
        const sel = e.target.closest("[data-req-status]");
        if (!sel) return;
        const id = sel.dataset.reqStatus;
        const status = sel.value;
        try {
          if (!isStatic()) {
            await api(`/api/admin/requests/${encodeURIComponent(id)}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status }),
            });
          } else {
            setLocalRequestStatus(id, status);
          }
          toast("Статус обновлён");
        } catch (err) {
          toast("Ошибка: " + errText(err), { iconName: "warning" });
        }
      });

      load();
    },
  };
}

/* --------------------------------------------------- Sync / Publish tab */

function syncView(data, rerender) {
  let savedGhToken = "";
  let savedGhRepo = "horaanlika-droid/ce";
  try {
    savedGhToken = localStorage.getItem(GH_TOKEN_KEY) || "";
    savedGhRepo = localStorage.getItem(GH_REPO_KEY) || "horaanlika-droid/ce";
  } catch {
    /* ignore */
  }
  const customApi = getCustomApiBase();
  const hasDraft = hasLocalOverride();

  return {
    title: "Публикация и доступ — Админ-панель",
    html: `
      <div class="admin__section">
        <header class="admin__bar">
          <div>
            <h2 class="admin__h2">Публикация, сервер и безопасность</h2>
            <p class="admin__sub">Опубликуйте изменения для всех посетителей GitHub Pages, подключите API или скачайте резервную копию</p>
          </div>
        </header>

        <div class="admin__sync-grid">
          <div class="admin__card" style="margin:0">
            <div class="admin__card-head">
              <h3 class="admin__card-title">1. Прямая публикация на GitHub Pages (без сервера)</h3>
            </div>
            <div class="admin__card-body" style="display:grid;gap:12px">
              <p class="admin__help">
                Позволяет сохранять изменения прямо в репозиторий GitHub с телефона или компьютера — без запуска Python-сервера и BotHost.
                Создайте Fine-grained Token на GitHub с правом <code>Contents: Read and write</code> для репозитория <code>horaanlika-droid/ce</code>.
              </p>
              ${input("Репозиторий (owner/repo)", "ghRepo", savedGhRepo, "text", "horaanlika-droid/ce")}
              ${input("GitHub Token (хранится только в этом браузере)", "ghToken", savedGhToken, "password", "github_pat_... или ghp_...")}
              <div class="admin__status-line" data-gh-status hidden></div>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                ${btn(`${icon("upload")}<span>Опубликовать на сайт</span>`, "primary", "button", "data-gh-publish")}
              </div>
            </div>
          </div>

          <div class="admin__card" style="margin:0">
            <div class="admin__card-head">
              <h3 class="admin__card-title">2. Подключение API-сервера (BotHost / VPS)</h3>
            </div>
            <div class="admin__card-body" style="display:grid;gap:12px">
              <p class="admin__help">
                Текущий режим: <strong>${isStatic() ? "Статический (GitHub Pages / браузер)" : `API-сервер (${apiBase()})`}</strong>.
                Если у вас развёрнут сервер <code>server/main.py</code> на BotHost или VPS, укажите его HTTPS-адрес:
              </p>
              ${input("URL API-сервера", "customApi", customApi, "url", "https://cocktail-embassy.bothost.ru")}
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                ${btn("Сохранить и проверить API", "default", "button", "data-api-save")}
                ${customApi ? btn("Отключить внешний API", "danger", "button", "data-api-clear") : ""}
              </div>
            </div>
          </div>

          <div class="admin__card" style="margin:0">
            <div class="admin__card-head">
              <h3 class="admin__card-title">3. Экспорт / импорт каталога (data/content.json)</h3>
            </div>
            <div class="admin__card-body" style="display:grid;gap:12px">
              <p class="admin__help">
                Скачайте готовый файл <code>content.json</code> для резервной копии или ручной загрузки в папку <code>data/</code>.
                ${hasDraft ? "<strong>В браузере есть локальные правки.</strong>" : "Локальных несохранённых правок нет."}
              </p>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                ${btn("Скачать content.json", "default", "button", "data-json-export")}
                <label class="admin__btn admin__btn--default" style="cursor:pointer">
                  Импорт JSON
                  <input type="file" accept="application/json,.json" hidden data-json-import>
                </label>
                ${hasDraft ? btn(`${icon("refresh")}<span>Сбросить локальные правки</span>`, "danger", "button", "data-json-reset") : ""}
              </div>
            </div>
          </div>

          <div class="admin__card" style="margin:0">
            <div class="admin__card-head">
              <h3 class="admin__card-title">4. Смена пароля админ-панели</h3>
            </div>
            <form class="admin__card-body" data-pw-form style="display:grid;gap:12px">
              ${input("Текущий пароль", "curPw", "", "password", "Текущий пароль")}
              ${input("Новый пароль", "newPw", "", "password", "Минимум 4 символа")}
              <div>${btn("Обновить пароль", "default", "submit")}</div>
            </form>
          </div>
        </div>
      </div>
    `,
    mount(root) {
      const ghPublishBtn = root.querySelector("[data-gh-publish]");
      const ghStatus = root.querySelector("[data-gh-status]");

      ghPublishBtn?.addEventListener("click", async () => {
        const repo = root.querySelector('[name="ghRepo"]')?.value.trim() || "horaanlika-droid/ce";
        const token = root.querySelector('[name="ghToken"]')?.value.trim() || "";
        try {
          localStorage.setItem(GH_REPO_KEY, repo);
          if (token) localStorage.setItem(GH_TOKEN_KEY, token);
        } catch {
          /* ignore */
        }
        ghPublishBtn.disabled = true;
        ghStatus.hidden = false;
        ghStatus.textContent = "Подготовка к публикации…";
        try {
          await publishToGitHub({ repo, branch: "main", token }, data, (msg) => {
            ghStatus.textContent = msg;
          });
          ghStatus.textContent = "Опубликовано в ветку main! GitHub Pages обновится примерно за 30–60 секунд.";
          toast("Опубликовано на GitHub Pages");
        } catch (err) {
          ghStatus.textContent = "Ошибка: " + errText(err);
          toast("Ошибка публикации: " + errText(err), { iconName: "warning" });
        } finally {
          ghPublishBtn.disabled = false;
        }
      });

      root.querySelector("[data-api-save]")?.addEventListener("click", async () => {
        const rawUrl = root.querySelector('[name="customApi"]')?.value.trim().replace(/\/+$/, "") || "";
        if (!rawUrl) {
          setCustomApiBase("");
          toast("Внешний API отключён");
          rerender(await loadContent({ force: true }));
          return;
        }
        try {
          const res = await fetch(`${rawUrl}/api/health`, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setCustomApiBase(rawUrl);
          adminToken = "";
          localStorage.removeItem(TOKEN_KEY);
          notifyAuthChange();
          toast("API подключён — войдите с паролем сервера");
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } catch (err) {
          toast(`Не удалось подключиться к ${rawUrl}/api/health (${errText(err)})`, { iconName: "warning" });
        }
      });

      root.querySelector("[data-api-clear]")?.addEventListener("click", async () => {
        setCustomApiBase("");
        toast("Переключено в автономный режим");
        rerender(await loadContent({ force: true }));
      });

      root.querySelector("[data-json-export]")?.addEventListener("click", () => {
        const payload = {
          version: 7,
          updatedAt: new Date().toISOString(),
          settings: data.settings,
          categories: data.categories,
          products: data.products,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "content.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1500);
        toast("Файл content.json скачан");
      });

      const importInp = root.querySelector("[data-json-import]");
      importInp?.addEventListener("change", async () => {
        const file = importInp.files?.[0];
        importInp.value = "";
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const updated = saveLocalOverride(parsed);
          toast("Каталог импортирован");
          rerender(updated);
        } catch (err) {
          toast("Некорректный JSON: " + errText(err), { iconName: "warning" });
        }
      });

      root.querySelector("[data-json-reset]")?.addEventListener("click", async () => {
        if (!confirm("Сбросить локальные правки и вернуться к исходному каталогу сайта?")) return;
        clearLocalOverride();
        const raw = await loadBundledRaw();
        const fresh = await loadContent({ force: true });
        window.__CE_DATA__ = fresh;
        window.dispatchEvent(new CustomEvent("ce-content-updated", { detail: fresh, raw }));
        toast("Локальные правки сброшены");
        rerender(fresh);
      });

      root.querySelector("[data-pw-form]")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        try {
          await changeAdminPassword(fd.get("curPw"), fd.get("newPw"));
          e.currentTarget.reset();
          toast("Пароль успешно изменён");
        } catch (err) {
          toast(errText(err) || "Ошибка смены пароля", { iconName: "warning" });
        }
      });
    },
  };
}

/* ----------------------------------------------------- Main admin shell */

export function adminView(initialData) {
  if (!isAdmin()) return loginView();

  const data = state.content || initialData;
  const active = (location.hash.match(/^#\/admin\/([a-z]+)/) || [])[1] || "products";
  const tabs = [
    { key: "products", label: "Товары" },
    { key: "categories", label: "Категории" },
    { key: "partners", label: "Партнёры" },
    { key: "settings", label: "Настройки" },
    { key: "requests", label: "Заявки" },
    { key: "sync", label: "Публикация" },
  ];

  let subView = null;
  const rerender = () => {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  if (active === "categories") subView = categoriesView(data, rerender);
  else if (active === "partners") subView = partnersView(data, rerender);
  else if (active === "settings") subView = settingsView(data, rerender);
  else if (active === "requests") subView = requestsView(data, rerender);
  else if (active === "sync") subView = syncView(data, rerender);
  else subView = productsView(data, rerender);

  const serverOnline = !isStatic();
  const hasDraft = isStatic() && hasLocalOverride();

  const tabHtml = tabs
    .map(
      (t) =>
        `<a href="#/admin/${t.key}" class="admin__tab${
          active === t.key ? " admin__tab--active" : ""
        }" data-admin-tab="${t.key}">${esc(t.label)}</a>`
    )
    .join("");

  return {
    title: subView.title || "Админ-панель — Cocktail Embassy",
    navTitle: "Админ-панель",
    html: `
      <div class="admin admin--panel wrap">
        <header class="admin__shell-header">
          <div class="admin__shell-brand">
            <img src="assets/brand/mark-chrome.png" alt="Cocktail Embassy" class="admin__logo">
            <div>
              <div class="admin__shell-title">Админ-панель</div>
              <div class="admin__mode-badge ${serverOnline ? "is-online" : ""}">
                ${serverOnline ? `● Сервер подключён` : hasDraft ? "● Сохранено в браузере (есть правки для публикации)" : "● Автономный режим"}
              </div>
            </div>
          </div>
          <div class="admin__shell-actions">
            ${
              hasDraft && active !== "sync"
                ? `<a href="#/admin/sync" class="admin__btn admin__btn--primary">${icon("upload")}<span>Опубликовать</span></a>`
                : ""
            }
            <a href="#/" class="admin__btn admin__btn--default">В магазин</a>
            ${btn("Выйти", "danger", "button", "data-admin-logout")}
          </div>
        </header>
        <nav class="admin__tabs" aria-label="Разделы админ-панели">${tabHtml}</nav>
        <div class="admin__body" data-admin-body>${subView.html}</div>
      </div>
    `,
    mount(main) {
      main.querySelector("[data-admin-logout]")?.addEventListener("click", () => {
        logout();
        toast("Вы вышли из админ-панели");
      });
      const bodyEl = main.querySelector("[data-admin-body]") || main;
      if (typeof subView.mount === "function") {
        subView.mount(bodyEl, { data });
      }
    },
  };
}
