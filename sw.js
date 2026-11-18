/* Cocktail Embassy — offline shell.
   Code, catalogue JSON, and per-item photo folders (glasses/, covers/, packaging/)
   use network-first so replaced repository photos appear on the very first reload. */
const CACHE = "ce-shell-v19";
const SHELL = [
  "./",
  "index.html",
  "css/app.css?v=19",
  "js/app.js?v=19",
  "js/config.js?v=19",
  "js/api.js",
  "js/content-snapshot.js",
  "js/admin.js",
  "js/store.js",
  "js/ui.js",
  "js/views.js",
  "js/icons.js",
  "data/content.json",
  "data/folder-defaults.json",
  "manifest.webmanifest",
  "assets/brand/mark-dark.png",
  "assets/brand/ce-logo-chrome.png",
  "assets/brand/mark-chrome.png",
  "assets/brand/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Cache independently: one missing JSON/photo must not cancel the entire
      // offline shell, including the fetch-independent recovery catalogue.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never cache the API.
  if (url.pathname.includes("/api/") || url.pathname.includes("/media/")) return;
  if (url.origin !== location.origin) return;

  const isFreshFirst =
    request.mode === "navigate" ||
    /\.(html|css|js|mjs|json|webmanifest)$/i.test(url.pathname) ||
    /\/(glasses|covers|packaging)\//i.test(url.pathname) ||
    url.pathname.endsWith("/");

  if (isFreshFirst) {
    // Network-first so code/JSON and folder photography updates land immediately.
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then(async (response) => {
          if (response && response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}));
            return response;
          }
          // HTTP 404/5xx do not reject fetch(). Keep a known-good cached file
          // during a deployment/outage instead of returning an error over it.
          return (await caches.match(request)) || response;
        })
        .catch(async (err) => {
          const cached = await caches.match(request);
          if (cached) return cached;
          throw err;
        })
    );
    return;
  }

  // Brand icons and legacy static assets: cache-first, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
