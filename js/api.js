/**
 * Data layer.
 * Priority: live API (BotHost / local server) → admin local override → bundled data/content.json → offline cache.
 * The bundled file guarantees GitHub Pages always renders a complete catalogue,
 * while the local override lets #/admin edit & preview immediately even without a backend.
 */
import { icon } from "./icons.js";

const CONFIG = (typeof window !== "undefined" && window.CE_CONFIG) || {};
const CUSTOM_API_KEY = "ce.admin.apiBase";
const OVERRIDE_KEY = "ce.admin.override.v1";
const LOCAL_REQ_KEY = "ce.requests.local.v1";
const CONTENT_KEY = "ce.content.v1";
const GH_TREE_KEY = "ce.gh.tree.v1";
const GH_TOKEN_KEY = "ce.admin.ghToken"; // saved by the admin panel's GitHub publisher
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 3; // 3 days
/** Every raster format a photo dropped into glasses/|covers/|packaging/ may use.
 *  PNG is fully supported — single source of truth for the tree filter, the
 *  <img> onerror fallback in app.js and the render checks. */
export const FOLDER_IMAGE_EXTS = ["webp", "png", "jpg", "jpeg", "avif", "gif"];
const FOLDER_IMAGE_RE = new RegExp(
  `^(glasses|covers|packaging)\\/[^/]+\\/[^/]+\\.(${FOLDER_IMAGE_EXTS.join("|")})$`,
  "i"
);
const PACKAGING_CATS = new Set(["acids", "essences"]);
export const SITE_COVER_KEYS = [
  ["homeCraft", "covers/home-craft"],
  ["infoBanner", "covers/info-banner"],
  ["infoStory", "covers/info-story"],
  ["ogShare", "covers/og-share"],
  ["announcementImage", "covers/announcement"],
];

let sameOriginApi = null; // null = unknown, "" = none, string = origin
let contentPromise = null;
let bundledCache = null;
let folderDefaultsCache = null;
let source = "static";

export const state = {
  content: null,
  loading: true,
  online: false,
};

export function getCustomApiBase() {
  try {
    return (localStorage.getItem(CUSTOM_API_KEY) || "").trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function setCustomApiBase(url) {
  try {
    const clean = String(url || "").trim().replace(/\/+$/, "");
    if (clean) localStorage.setItem(CUSTOM_API_KEY, clean);
    else localStorage.removeItem(CUSTOM_API_KEY);
  } catch {
    /* ignore */
  }
  contentPromise = null;
}

export function apiBase() {
  const custom = getCustomApiBase();
  if (custom) return custom;
  const configured = String(CONFIG.apiBase || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (sameOriginApi) return sameOriginApi;
  return "";
}

export function isStatic() {
  return !apiBase();
}

/** Probe whether the current origin also hosts the FastAPI server (/api/health). */
export async function probeSameOriginApi() {
  if (sameOriginApi !== null) return sameOriginApi;
  if (getCustomApiBase() || String(CONFIG.apiBase || "").trim()) {
    sameOriginApi = "";
    return "";
  }
  const host = (typeof location !== "undefined" && location.hostname) || "";
  const origin = (typeof location !== "undefined" && location.origin) || "";
  if (!host || !origin || origin === "null" || host.endsWith(".github.io")) {
    sameOriginApi = "";
    return "";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`${origin}/api/health`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json && json.ok === true) {
        sameOriginApi = origin.replace(/\/+$/, "");
        return sameOriginApi;
      }
    }
  } catch {
    /* static server */
  } finally {
    clearTimeout(timer);
  }
  sameOriginApi = "";
  return "";
}

/** Turn a stored media path into a usable URL, wherever it came from. */
export function mediaUrl(path) {
  if (!path) return "";
  if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
  if (path.startsWith("/")) {
    const base = apiBase();
    return base ? base + path : path;
  }
  return path;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CONTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    if (Date.now() - parsed.at > CACHE_MAX_AGE) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CONTENT_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota or private mode — ignore */
  }
}

/* ---------- Local admin override (used on static hosts like GitHub Pages) ---------- */

export function readLocalOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || !Array.isArray(data.products)) return null;
    return data;
  } catch {
    return null;
  }
}

export function hasLocalOverride() {
  return !!readLocalOverride();
}

let lastSaveStrippedImagesFlag = false;
/** True when the last saveLocalOverride() hit the storage quota and had to drop inline data: photos. */
export function lastSaveStrippedImages() {
  return lastSaveStrippedImagesFlag;
}

/** Deep-copy a payload without inline data: images (they are too big for localStorage). */
function stripInlineImages(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  for (const p of clone.products || []) {
    if (Array.isArray(p.images)) p.images = p.images.filter((u) => !String(u).startsWith("data:"));
  }
  for (const c of clone.categories || []) {
    if (String(c.cover || "").startsWith("data:")) delete c.cover;
  }
  const covers = clone.settings && clone.settings.covers;
  if (covers && typeof covers === "object") {
    for (const k of Object.keys(covers)) {
      if (String(covers[k] || "").startsWith("data:")) delete covers[k];
    }
  }
  for (const slide of (clone.settings && clone.settings.hero) || []) {
    for (const field of ["cover", "portraitCover"]) {
      if (String(slide[field] || "").startsWith("data:")) delete slide[field];
    }
  }
  return clone;
}

export function saveLocalOverride(rawContent) {
  const normalized = normalize(rawContent);
  const payload = {
    version: 7,
    updatedAt: new Date().toISOString(),
    settings: normalized.settings,
    categories: normalized.categories,
    products: normalized.products,
  };
  lastSaveStrippedImagesFlag = false;
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ at: Date.now(), data: payload }));
  } catch {
    // QuotaExceededError: the draft with inline data: photos doesn't fit into
    // localStorage. Persist it WITHOUT the inline photos — they stay in memory
    // (state.content) for this session, so preview and «Опубликовать на сайт»
    // still see and upload them. Only fail if even the stripped draft doesn't fit.
    const stripped = stripInlineImages(payload);
    lastSaveStrippedImagesFlag = JSON.stringify(stripped) !== JSON.stringify(payload);
    try {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ at: Date.now(), data: stripped }));
    } catch {
      throw new Error(
        "Черновик не помещается в хранилище браузера. Сохраните GitHub-токен во вкладке «Публикация» — " +
          "тогда фото будут сразу заливаться в папки репозитория, либо нажмите «Опубликовать на сайт»."
      );
    }
  }
  state.content = normalized;
  source = "local";
  if (typeof window !== "undefined") {
    window.__CE_DATA__ = normalized;
    window.dispatchEvent?.(new CustomEvent("ce-content-updated", { detail: normalized }));
  }
  return normalized;
}

export function clearLocalOverride() {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* ignore */
  }
  contentPromise = null;
}

export async function loadBundledRaw() {
  if (bundledCache) return JSON.parse(JSON.stringify(bundledCache));
  const raw = await fetchJSON("data/content.json", { cache: "no-cache" });
  bundledCache = raw;
  return JSON.parse(JSON.stringify(raw));
}

/** Normalise whatever the API or the file returns into the UI shape. */
export function normalize(raw) {
  const data = raw && raw.data ? raw.data : raw;
  if (!data || !Array.isArray(data.products)) throw new Error("Malformed content");
  const settings = data.settings || {};
  const products = data.products.map((p, i) => ({
    ...p,
    price: Number(p.price) || 0,
    images: Array.isArray(p.images) ? p.images.filter(Boolean) : p.image ? [p.image] : [],
    specs: p.specs && typeof p.specs === "object" ? p.specs : {},
    article: (p.specs && p.specs.Code) || p.article || "",
    volumeMl: Number(String(p.volume || "").replace(/[^\d.]/g, "")) || 0,
    sort: Number.isFinite(p.sort) ? p.sort : i,
    featured: !!p.featured,
    inStock: p.inStock !== false,
    comingSoon: !!p.comingSoon,
  }));
  const categories = (data.categories || []).map((c, i) => ({ sort: i, ...c }));
  return {
    settings,
    categories: categories.sort((a, b) => a.sort - b.sort),
    products: products.sort((a, b) => a.sort - b.sort),
  };
}

function naturalCompare(aName, bName) {
  const stem = (n) => String(n).toLowerCase().replace(/\.[^.]+$/, "");
  const prio = (n) => (/^(photo|cover|main|1|01|wide)$/.test(stem(n)) ? 0 : 1);
  const pa = prio(aName);
  const pb = prio(bName);
  if (pa !== pb) return pa - pb;
  return String(aName).localeCompare(String(bName), undefined, { numeric: true, sensitivity: "base" });
}

function versionedPath(entry, defaults) {
  if (!entry.sha) return entry.path;
  if (defaults && defaults[entry.path] && defaults[entry.path] === entry.sha) return entry.path;
  return `${entry.path}?v=${String(entry.sha).slice(0, 8)}`;
}

function pickFolderImages(entries, defaults) {
  if (!entries || !entries.length) return [];
  const sorted = [...entries].sort((a, b) => naturalCompare(a.name, b.name));
  if (sorted.length > 1 && defaults) {
    const custom = sorted.filter((e) => !defaults[e.path] || defaults[e.path] !== e.sha);
    if (custom.length) return custom.map((e) => versionedPath(e, defaults));
  }
  return sorted.map((e) => versionedPath(e, defaults));
}

function pickHeroImages(entries, defaults) {
  if (!entries || !entries.length) return { cover: "", portraitCover: "" };
  const isPortrait = (e) => /portrait|mobile|tall/i.test(String(e.name).replace(/\.[^.]+$/, ""));
  let portraits = entries.filter(isPortrait).sort((a, b) => naturalCompare(a.name, b.name));
  let mains = entries.filter((e) => !isPortrait(e)).sort((a, b) => naturalCompare(a.name, b.name));

  if (mains.length > 1 && defaults) {
    const customMains = mains.filter((e) => !defaults[e.path] || defaults[e.path] !== e.sha);
    if (customMains.length) mains = customMains;
  }
  if (!mains.length) {
    return { cover: versionedPath(portraits[0], defaults), portraitCover: "" };
  }
  const main = mains[0];
  if (!portraits.length) {
    return { cover: versionedPath(main, defaults), portraitCover: "" };
  }
  if (portraits.length > 1 && defaults) {
    const customPortraits = portraits.filter((e) => !defaults[e.path] || defaults[e.path] !== e.sha);
    if (customPortraits.length) portraits = customPortraits;
  }
  const portrait = portraits[0];
  if (defaults) {
    const mainChanged = !defaults[main.path] || defaults[main.path] !== main.sha;
    const portraitChanged = !defaults[portrait.path] || defaults[portrait.path] !== portrait.sha;
    if (mainChanged && !portraitChanged) {
      return { cover: versionedPath(main, defaults), portraitCover: "" };
    }
  }
  return {
    cover: versionedPath(main, defaults),
    portraitCover: versionedPath(portrait, defaults),
  };
}

/**
 * Apply discovered repository folder files (`glasses/*`, `covers/*`, `packaging/*`)
 * onto normalized catalogue data so dropping/replacing any image in a folder updates the site.
 */
export function applyFolderFiles(data, files, defaults = {}) {
  if (!data || !Array.isArray(files) || !files.length) return data;
  const byFolder = new Map();
  for (const item of files) {
    if (!item || !FOLDER_IMAGE_RE.test(item.path)) continue;
    const slash = item.path.lastIndexOf("/");
    const folder = item.path.slice(0, slash);
    const name = item.path.slice(slash + 1);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push({ name, path: item.path, sha: item.sha || "" });
  }
  if (!byFolder.size) return data;

  for (const product of data.products || []) {
    const hasInline = (product.images || []).some(
      (u) => String(u).startsWith("data:") || String(u).startsWith("/media/")
    );
    if (hasInline) continue;
    const top = PACKAGING_CATS.has(product.categorySlug) ? "packaging" : "glasses";
    const folder = `${top}/${product.slug}`;
    if (byFolder.has(folder)) {
      const imgs = pickFolderImages(byFolder.get(folder), defaults);
      if (imgs.length) product.images = imgs;
    }
  }

  for (const cat of data.categories || []) {
    if (cat.cover && (String(cat.cover).startsWith("data:") || String(cat.cover).startsWith("/media/"))) {
      continue;
    }
    const folder = `covers/category-${cat.slug}`;
    if (byFolder.has(folder)) {
      const imgs = pickFolderImages(byFolder.get(folder), defaults);
      if (imgs.length) cat.cover = imgs[0];
    }
  }

  const settings = data.settings || (data.settings = {});
  for (const slide of settings.hero || []) {
    if (!slide.productSlug) continue;
    const folder = `covers/hero-${slide.productSlug}`;
    if (byFolder.has(folder)) {
      const { cover, portraitCover } = pickHeroImages(byFolder.get(folder), defaults);
      if (cover) slide.cover = cover;
      else delete slide.cover;
      if (portraitCover) slide.portraitCover = portraitCover;
      else delete slide.portraitCover;
    }
  }

  const covers = { ...(settings.covers || {}) };
  for (const [key, folder] of SITE_COVER_KEYS) {
    if (byFolder.has(folder)) {
      const imgs = pickFolderImages(byFolder.get(folder), defaults);
      if (imgs.length) covers[key] = imgs[0];
    }
  }
  settings.covers = covers;
  return data;
}

export function detectGitHubRepo() {
  const configured = String(CONFIG.githubRepo || "").trim();
  if (configured) {
    return { repo: configured, branch: String(CONFIG.githubBranch || "main").trim() || "main" };
  }
  const host = (typeof location !== "undefined" && location.hostname) || "";
  const pathname = (typeof location !== "undefined" && location.pathname) || "/";
  if (host.endsWith(".github.io")) {
    const owner = host.slice(0, -".github.io".length);
    const seg = pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
    if (owner && seg) {
      return { repo: `${owner}/${seg}`, branch: String(CONFIG.githubBranch || "main").trim() || "main" };
    }
  }
  return null;
}

async function loadFolderDefaults() {
  if (folderDefaultsCache) return folderDefaultsCache;
  try {
    folderDefaultsCache = await fetchJSON("data/folder-defaults.json", { cache: "no-cache" });
  } catch {
    folderDefaultsCache = {};
  }
  return folderDefaultsCache;
}

async function resolveRepoFolders(data) {
  const gh = detectGitHubRepo();
  if (!gh) return data;

  let cachedTree = null;
  try {
    const raw = localStorage.getItem(GH_TREE_KEY);
    if (raw) cachedTree = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const sameTarget = cachedTree && cachedTree.repo === gh.repo && cachedTree.branch === gh.branch;

  let files = sameTarget && Array.isArray(cachedTree.files) ? cachedTree.files : null;

  // If the owner saved a GitHub token in the admin panel (used for publishing),
  // reuse it here for api.github.com only: it lifts the anonymous 60 req/hour
  // rate limit to 5000, so a photo just dropped into a repo folder shows up on
  // the very next reload even after heavy refreshing while testing.
  let ghToken = "";
  try {
    ghToken = (localStorage.getItem(GH_TOKEN_KEY) || "").trim();
  } catch {
    /* ignore */
  }

  const treeUrl = `https://api.github.com/repos/${gh.repo}/git/trees/${encodeURIComponent(gh.branch)}?recursive=1`;
  const fetchTree = (headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    return fetch(treeUrl, { cache: "no-store", signal: controller.signal, headers }).finally(() =>
      clearTimeout(timer)
    );
  };

  try {
    const headers = { Accept: "application/vnd.github+json" };
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
    else if (sameTarget && cachedTree.etag) headers["If-None-Match"] = cachedTree.etag;
    let res = await fetchTree(headers);
    if (res.status !== 200 && res.status !== 304 && !ghToken) {
      // conditional request went sideways (etag drift / 412) — retry plainly once
      res = await fetchTree({ Accept: "application/vnd.github+json" });
    }
    if (res.status === 200) {
      const json = await res.json();
      if (json && Array.isArray(json.tree)) {
        files = json.tree
          .filter((item) => item.type === "blob" && FOLDER_IMAGE_RE.test(item.path))
          .map((item) => ({ path: item.path, sha: item.sha || "" }));
        const etag = res.headers?.get?.("etag") || "";
        try {
          localStorage.setItem(
            GH_TREE_KEY,
            JSON.stringify({ repo: gh.repo, branch: gh.branch, etag, files, at: Date.now() })
          );
        } catch {
          /* ignore */
        }
      }
    }
    // 304 / non-200: keep the cached list — offline or rate-limited fallback
  } catch {
    /* offline or rate-limited — fall back to cached tree or bundled paths */
  }

  if (!files || !files.length) return data;
  const defaults = await loadFolderDefaults();
  return applyFolderFiles(data, files, defaults);
}

async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function loadContent({ force = false } = {}) {
  if (contentPromise && !force) return contentPromise;

  contentPromise = (async () => {
    await probeSameOriginApi();
    const base = apiBase();

    // 1. Live API
    if (base) {
      try {
        const raw = await fetchJSON(`${base}/api/content`, { cache: "no-store" });
        const data = normalize(raw);
        state.content = data;
        state.online = true;
        state.loading = false;
        source = "api";
        writeCache(data);
        return data;
      } catch (err) {
        console.warn("[CE] API unavailable, falling back to local/static data", err);
      }
    }

    // 2. Local admin override (immediate edits made in #/admin on static hosting)
    const override = readLocalOverride();
    if (override) {
      try {
        const data = await resolveRepoFolders(normalize(override));
        state.content = data;
        state.online = false;
        state.loading = false;
        source = "local";
        return data;
      } catch (err) {
        console.warn("[CE] local override malformed, ignoring", err);
      }
    }

    // 3. Bundled JSON
    try {
      const raw = await fetchJSON("data/content.json", { cache: "no-cache" });
      bundledCache = raw;
      const data = await resolveRepoFolders(normalize(raw));
      state.content = data;
      state.online = false;
      state.loading = false;
      source = "static";
      writeCache(data);
      return data;
    } catch (err) {
      console.warn("[CE] bundled data failed", err);
    }

    // 4. Cache
    const cached = readCache();
    if (cached) {
      const data = await resolveRepoFolders(normalize(cached));
      state.content = data;
      state.online = false;
      state.loading = false;
      source = "cache";
      return data;
    }

    state.loading = false;
    throw new Error("Catalogue unavailable");
  })();

  return contentPromise;
}

export function dataSource() {
  return source;
}

/* ---------- Local request log (fallback when API is not connected) ---------- */

export function listLocalRequests() {
  try {
    const raw = localStorage.getItem(LOCAL_REQ_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function setLocalRequestStatus(id, status) {
  const list = listLocalRequests();
  const idx = list.findIndex((r) => String(r.id) === String(id));
  if (idx >= 0) {
    list[idx].status = status;
    try {
      localStorage.setItem(LOCAL_REQ_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
  return list;
}

function recordLocalRequest(payload, reference) {
  try {
    const list = listLocalRequests();
    const id = Date.now();
    list.unshift({
      id,
      reference,
      createdAt: new Date().toISOString(),
      status: "new",
      ...payload,
    });
    localStorage.setItem(LOCAL_REQ_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

/** Submit a quote/order request. Returns { ok, reference, mailto? }. */
export async function submitRequest(payload) {
  const base = apiBase();
  if (base) {
    try {
      const res = await fetch(`${base}/api/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: true, reference: json.reference || json.id || "", channel: "api" };
      }
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail || `Request failed (${res.status})`);
    } catch (err) {
      if (err && /Request failed/.test(err.message)) {
        return { ok: false, error: err.message };
      }
      console.warn("[CE] request API unreachable, using email fallback", err);
    }
  }
  const reference = `CE-${Date.now().toString().slice(-6)}`;
  recordLocalRequest(payload, reference);
  return { ok: true, reference, channel: "email" };
}

/* ---------- Selectors ---------- */
export const selectors = {
  productBySlug: (data, slug) => data.products.find((p) => p.slug === slug),
  categoryBySlug: (data, slug) => data.categories.find((c) => c.slug === slug),
  productsByCategory: (data, slug) => data.products.filter((p) => p.categorySlug === slug),
  featured: (data) => data.products.filter((p) => p.featured),
  related: (data, product, limit = 4) =>
    data.products
      .filter((p) => p.slug !== product.slug && p.categorySlug === product.categorySlug)
      .slice(0, limit),
  price: (data, value) => {
    const settings = data.settings || {};
    const currency = settings.currency || "EUR";
    const locale = settings.locale || "en-IE";
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
        minimumFractionDigits: 0,
      }).format(value);
    } catch {
      return `${currency} ${value}`;
    }
  },
};

/* ---------- Small helpers reused by views ---------- */
export function placeholderMedia() {
  return `<span class="fallback">${icon("sparkle")}<span>Cocktail Embassy</span></span>`;
}
