/* Cocktail Embassy — offline shell.
   Code, catalogue JSON, and per-item photo folders (glasses/, covers/, packaging/)
   use network-first so replaced repository photos appear on the very first reload. */
const CACHE = "ce-shell-v18";
const SHELL = [
  "./",
  "index.html",
  "css/app.css?v=18",
  "js/app.js?v=18",
  "js/config.js?v=18",
  "js/api.js",
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
      .then((cache) => cache.addAll(SHELL).catch(() => {}))
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
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
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
