/** App shell, router and global interactions. */
import { icon } from "./icons.js";
import { loadContent, state, mediaUrl, detectGitHubRepo, FOLDER_IMAGE_EXTS } from "./api.js";
import { request } from "./store.js";
import { toast, esc, attr, prefersReducedMotion } from "./ui.js";
import {
  homeView,
  shopView,
  productView,
  requestView,
  infoView,
  notFoundView,
  adminView,
} from "./views.js";
import { isAdmin, logout } from "./admin.js";

const app = document.getElementById("app");
const NAV_ITEMS = [
  { key: "home", href: "#/", label: "Home" },
  { key: "shop", href: "#/shop", label: "Shop" },
  { key: "info", href: "#/info", label: "The Embassy" },
];

/* ------------------------------------------------------------ ticker */

// Shown only until the catalogue answers, or when the owner has cleared the
// running lines in the back office. The live copy is settings.ticker.
const FALLBACK_TICKER = [
  "Worldwide delivery from Dubai",
  "52 pieces · six categories",
  "Trade prices in AED",
  "bartending.solution.uae@gmail.com",
  "+971 56 238 8262",
  "Dispatch in 2–4 days",
  "Breakage replaced free",
];

/** A settings value may arrive as a list or as one newline-separated block. */
export function linesOf(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function tickerHTML(settings = {}) {
  const announcement = String(settings.announcement || "").trim();
  const announcementImg = String((settings.covers && settings.covers.announcementImage) || "").trim();
  const custom = linesOf(settings.ticker);
  const words = [announcement, ...(custom.length ? custom : FALLBACK_TICKER)].filter(Boolean);
  // optional picture rides with the announcement phrase (admin can upload it)
  const img = announcementImg
    ? `<img class="ticker__img" src="${attr(mediaUrl(announcementImg))}" alt="" loading="lazy" decoding="async">`
    : "";
  const lap = words
    .map(
      (word, i) =>
        `<span class="ticker__word${i === 0 && announcement ? " ticker__word--announce" : ""}">${
          i === 0 && img ? img : ""
        }${esc(word)}</span>`
    )
    .join("");
  // the row is carried twice: one lap is exactly half the track, so the loop is seamless
  return `<div class="ticker__track" data-ticker-track>${lap}${lap}</div>`;
}

/** Repaint the top bar from live settings — called once the catalogue lands. */
function paintTicker(settings) {
  const ticker = document.querySelector("[data-ticker]");
  if (!ticker) return;
  const signature = JSON.stringify([
    settings?.announcement || "",
    settings?.covers?.announcementImage || "",
    settings?.ticker || [],
  ]);
  if (ticker.dataset.signature === signature) return;
  ticker.dataset.signature = signature;
  ticker.innerHTML = tickerHTML(settings || {});
}

/* --------------------------------------------------------------- shell */

function tabbarInnerHTML() {
  return `<a class="tab" href="#/" data-tab="home">${icon("home")}<span>Home</span></a>
    <a class="tab" href="#/shop" data-tab="shop">${icon("shop")}<span>Shop</span></a>
    <a class="tab" href="#/request" data-tab="request">${icon("bag")}<span>Request</span><span class="tab__badge" data-tab-badge hidden>0</span></a>
    <a class="tab" href="#/info" data-tab="info">${icon("info")}<span>Info</span></a>
    ${isAdmin() ? `<a class="tab" href="#/admin" data-tab="admin">${icon("sliders")}<span>Admin</span></a>` : ""}`;
}

function shellHTML() {
  return `<a class="skip-link" href="#view">Skip to content</a>
  <header class="nav" data-nav data-theme="light" data-deep="false">
    <div class="nav__inner">
      <a class="nav__back" href="#/shop" data-nav-back aria-label="Back" hidden>${icon("chevronLeft")}</a>
      <a class="brand" href="#/" aria-label="Cocktail Embassy — home">
        <img src="assets/brand/mark-dark.png" alt="Cocktail Embassy">
      </a>
      <span class="nav__title" data-nav-title aria-hidden="true"></span>
      <nav class="nav__links" aria-label="Primary">
        ${NAV_ITEMS.map(
          (item) => `<a class="nav__link" href="${item.href}" data-navlink="${item.key}">${item.label}</a>`
        ).join("")}
        <a class="nav__link" href="#/request" data-navlink="request">Request</a>
        <a class="nav__link" href="#/admin" data-navlink="admin">Admin</a>
      </nav>
      <a class="iconbtn" href="#/request" aria-label="Open request" data-cartbtn>
        ${icon("bag")}
        <span class="cart-count" data-cart-count hidden>0</span>
      </a>
    </div>
  </header>

  <div class="ticker" data-ticker aria-hidden="true">${tickerHTML()}</div>

  <div class="scrollline" data-scrollline aria-hidden="true"></div>

  <main id="view" tabindex="-1"></main>

  <footer class="footer" data-footer></footer>

  <a class="rail" href="#/request" data-rail aria-label="Open your request">
    <span><span class="rail__count" data-rail-count>0</span> in your request</span>
    <span class="btn">Review ${icon("arrowRight")}</span>
  </a>

  <nav class="tabbar" data-tabbar aria-label="Primary">
    ${tabbarInnerHTML()}
  </nav>`;
}

function footerHTML(data) {
  const s = data.settings || {};
  const c = s.contacts || {};
  return `<div class="footer__inner">
    <div class="footer__brand">
      <img src="assets/brand/mark-chrome.png" alt="${attr(s.brand || "Cocktail Embassy")}">
      <p>${esc(s.about || "")}</p>
    </div>
    <div class="footer__col">
      <h4>Catalogue</h4>
      ${data.categories.map((cat) => `<a href="#/shop?c=${attr(cat.slug)}">${esc(cat.name)}</a>`).join("")}
      <a href="#/shop">All pieces</a>
    </div>
    <div class="footer__col">
      <h4>Contact</h4>
      ${c.email ? `<a href="mailto:${attr(c.email)}">${esc(c.email)}</a>` : ""}
      ${c.phone ? `<a href="tel:${attr(c.phone.replace(/\s/g, ""))}">${esc(c.phone)}</a>` : ""}
      ${c.telegram ? `<a href="${attr(c.telegram)}" target="_blank" rel="noopener">Telegram</a>` : ""}
      ${c.instagram ? `<a href="${attr(c.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""}
      <span>${esc(c.address || "")}</span>
    </div>
  </div>
  <div class="footer__base">
    <span>© ${new Date().getFullYear()} ${esc(s.brand || "Cocktail Embassy")}. All rights reserved.</span>
    <span>${esc(s.priceNote || "")}${s.priceNote ? " · " : ""}<a href="#/admin" class="footer__admin-link">Admin</a></span>
  </div>`;
}

/* ------------------------------------------------------ opening curtain */

const bootEl = document.querySelector("[data-boot]");
const bootBarEl = document.querySelector("[data-boot-bar]");
const BOOT_MIN = prefersReducedMotion() ? 900 : 1500;
const bootT0 = performance.now();
let bootValue = 0;
let bootReady = false;
let bootFinished = false;
let bootFrame = 0;

function bootPaint() {
  const elapsed = performance.now() - bootT0;
  // the bar is the only thing that reports progress. It creeps towards the end
  // of the opening and only runs home once the catalogue is in hand *and* the
  // opening has had its time, so it never parks at 100 % and waits.
  const ready = bootReady && elapsed >= BOOT_MIN - 600;
  bootValue = ready
    ? Math.min(100, bootValue + 1.6)
    : Math.min(92, bootValue + (8 + (elapsed / 1000) * 40 - bootValue) * 0.06);
  if (bootBarEl) bootBarEl.style.width = `${Math.max(0, Math.round(bootValue))}%`;
  if (bootReady && bootValue >= 100 && elapsed >= BOOT_MIN) {
    bootFinish();
    return;
  }
  bootFrame = requestAnimationFrame(bootPaint);
}

function bootFinish() {
  if (bootFinished) return;
  bootFinished = true;
  cancelAnimationFrame(bootFrame);
  if (bootBarEl) bootBarEl.style.width = "100%";
  document.body.classList.remove("is-booting");
  document.body.classList.add("is-ready");
  bootEl?.classList.add("is-done");
  bootEl?.setAttribute("aria-busy", "false");
  setTimeout(() => bootEl?.remove(), 1000);
}

requestAnimationFrame(bootPaint);

/* ------------------------------------------------------------- router */

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const params = {};
  new URLSearchParams(queryPart || "").forEach((value, key) => {
    params[key] = value;
  });
  return { segments, params, path: "/" + segments.join("/") };
}

const routeDefs = [
  { test: (s) => s.length === 0, view: (data) => homeView(data), tab: "home", nav: "home" },
  { test: (s) => s[0] === "shop", view: (data, p, params) => shopView(data, params), tab: "shop", nav: "shop" },
  {
    test: (s) => s[0] === "product" && s[1],
    view: (data, p, params, s) => productView(data, s[1]),
    tab: "shop",
    nav: "shop",
  },
  { test: (s) => s[0] === "request", view: (data) => requestView(data), tab: "request", nav: "request" },
  { test: (s) => s[0] === "info", view: (data) => infoView(data), tab: "info", nav: "info" },
  { test: (s) => s[0] === "admin", view: (data) => adminView(data), tab: "admin", nav: "admin" },
];

/* How deep a route sits: the tab roots are one step in, a piece or a collection
   is two. That is all the router needs to know whether a tap went forward or
   came back, so the screen can move the way the user's thumb did. */
function routeDepth(segments) {
  if (!segments.length) return 0;
  if (segments[0] === "product") return 2;
  return 1;
}

const NAV_LABELS = { home: "Cocktail Embassy", shop: "Catalogue", info: "The Embassy", request: "Trade request" };

let currentRoute = null;
let currentView = { theme: "light" };
let lastDepth = -1;

async function render() {
  const data = state.content;
  if (!data) return;

  const { segments, params } = parseHash();
  const def = routeDefs.find((r) => r.test(segments));
  let view = def ? def.view(data, params, params, segments) : null;
  if (!view) view = notFoundView(data);

  currentRoute = def || null;
  currentView = view;

  document.title = view.title || data.settings?.brand || "Cocktail Embassy";

  const depth = routeDepth(segments);
  const direction = lastDepth < 0 ? "fade" : depth > lastDepth ? "push" : depth < lastDepth ? "pop" : "fade";
  lastDepth = depth;

  const main = document.getElementById("view");
  const screen = document.createElement("div");
  screen.className = `screen is-${direction}`;
  screen.innerHTML = `<div class="page">${view.html}</div>`;
  main.replaceChildren(screen);

  if (typeof view.mount === "function") {
    try {
      view.mount(main, { data });
    } catch (err) {
      console.error("[CE] view mount failed", err);
    }
  }

  updateActiveNav(def);
  updateNavMeta(view, def, depth, segments);
  updateNavTheme(true);
  motionEngine();

  // Scroll: top for a new destination, restore for in-page updates.
  if (!location.hash.includes("?")) window.scrollTo({ top: 0, behavior: "instant" in document.documentElement.style ? "instant" : "auto" });
  document.getElementById("view")?.focus({ preventScroll: true });
}

function updateActiveNav(def) {
  const tab = def ? def.tab : "";
  document.querySelectorAll("[data-tab]").forEach((el) => {
    if (el.dataset.tab === tab) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-navlink]").forEach((el) => {
    if (def && el.dataset.navlink === def.nav) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
}

function updateNavMeta(view, def, depth, segments) {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;
  const deep = depth >= 2;
  nav.dataset.deep = deep ? "true" : "false";
  const back = nav.querySelector("[data-nav-back]");
  if (back) {
    back.hidden = !deep;
    back.href = "#/shop";
    back.setAttribute("aria-label", "Back to the catalogue");
  }
  const title = nav.querySelector("[data-nav-title]");
  if (title) {
    title.textContent = view.navTitle || NAV_LABELS[def?.nav] || "";
  }
  if (state.content?.settings) paintTicker(state.content.settings);
}

/* --------------------------------------------------------- nav styling */

function updateNavTheme(force = false) {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;
  const y = window.scrollY;
  const wantsDark = currentView.theme === "dark-top" || currentRoute?.tab === "home";
  let threshold = 260;
  if (currentRoute?.tab === "home") {
    const hero = document.querySelector("[data-hero]");
    threshold = hero ? Math.max(160, hero.offsetHeight - 96) : 340;
  }
  const solid = y > 12;
  nav.classList.toggle("is-solid", solid);
  // the whole site is one dark room: the bar only gets denser as you scroll
  nav.dataset.theme = "dark";
}

/* --------------------------------------------------------------- motion */

let revealObserver = null;

function motionEngine() {
  const line = document.querySelector("[data-scrollline]");
  const rail = document.querySelector("[data-rail]");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      if (line) line.style.setProperty("--progress", p.toFixed(4));
      if (rail) rail.classList.toggle("is-in", window.scrollY > window.innerHeight * 0.7 && request.count() > 0);
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  // reveal sections as they come into view
  if (revealObserver) revealObserver.disconnect();
  if ("IntersectionObserver" in window && !reduced) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            revealObserver.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    document.querySelectorAll(".reveal:not(.is-in)").forEach((el, i) => {
      el.style.setProperty("--reveal-delay", `${Math.min(i, 6) * 60}ms`);
      revealObserver.observe(el);
    });
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-in"));
  }

  // a light that follows the pointer across the glass panels
  if (!reduced) {
    document.querySelectorAll(".spotlight").forEach((el) => {
      el.addEventListener(
        "pointermove",
        (ev) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${ev.clientX - r.left}px`);
          el.style.setProperty("--my", `${ev.clientY - r.top}px`);
        },
        { passive: true }
      );
    });
  }
  onScroll();
}

/* -------------------------------------------------------------- badges */

function updateBadges() {
  const count = request.count();
  const railCount = document.querySelector("[data-rail-count]");
  if (railCount) railCount.textContent = String(count);
  const rail = document.querySelector("[data-rail]");
  if (rail && count === 0) rail.classList.remove("is-in");
  document.querySelectorAll("[data-cart-count], [data-tab-badge]").forEach((el) => {
    el.textContent = String(count);
    el.hidden = count === 0;
  });
}

/* ------------------------------------------------------- global events */

document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  if (add) {
    const slug = add.dataset.add;
    const qty = Math.max(1, Number(add.dataset.addQty || 1));
    const product = state.content?.products.find((p) => p.slug === slug);
    request.add(slug, qty);
    if (product) {
      toast(`${product.name} · ${qty > 1 ? `${qty} pcs · ` : ""}added to request`);
      const btn = add;
      btn.classList.add("is-added");
      setTimeout(() => btn.classList.remove("is-added"), 900);
    }
    return;
  }
});

request.subscribe(updateBadges);

window.addEventListener("scroll", () => updateNavTheme(), { passive: true });
window.addEventListener("resize", () => updateNavTheme(), { passive: true });
window.addEventListener("hashchange", render);
window.addEventListener("ce-auth-changed", () => {
  const tabbar = document.querySelector("[data-tabbar]");
  if (tabbar) {
    tabbar.innerHTML = tabbarInnerHTML();
    updateBadges();
    updateActiveNav(currentRoute);
  }
});
window.addEventListener("ce-content-updated", () => {
  const data = state.content;
  if (!data) return;
  paintTicker(data.settings || {});
  const footer = document.querySelector("[data-footer]");
  if (footer) footer.innerHTML = footerHTML(data);
});

/* ---------------------------------------------------------------- boot */

async function boot() {
  app.innerHTML = shellHTML();
  updateBadges();

  let data;
  try {
    data = await loadContent();
  } catch (err) {
    document.getElementById("view").innerHTML = `<div class="wrap"><section class="section empty" style="min-height:60dvh;align-content:center">
      ${icon("warning")}
      <h1 class="h2" style="color:var(--ink)">Catalogue temporarily unavailable</h1>
      <p>Please refresh in a moment.</p>
      <button class="btn" onclick="location.reload()">Retry</button>
    </section></div>`;
    bootReady = true;
    return;
  }

  window.__CE_DATA__ = data;
  paintTicker(data.settings || {});
  // og:image follows settings.covers.ogShare when the owner changes it in the admin panel
  const ogShare = String((data.settings?.covers && data.settings.covers.ogShare) || "").trim();
  const ogMeta = document.querySelector('meta[property="og:image"]');
  if (ogShare && ogMeta) ogMeta.setAttribute("content", mediaUrl(ogShare));
  const footerEl = document.querySelector("[data-footer]");
  if (footerEl) footerEl.innerHTML = footerHTML(data);

  // Preload the hero plates after first paint — each is one finished raster
  // picture (room + glow + glass), so the carousel never flashes a frame.
  requestAnimationFrame(() => {
    const slides = (data.settings?.hero || []).slice(0, 3);
    slides
      .map((slide) => slide.cover || (data.products.find((p) => p.slug === slide.productSlug) || {}).images?.[0])
      .filter(Boolean)
      .forEach((src) => {
        const img = new Image();
        img.src = mediaUrl(src);
      });
  });

  // Fallback chain if a folder image was swapped to another extension offline or Pages CDN is mid-deploy
  document.addEventListener(
    "error",
    (ev) => {
      const img = ev && ev.target;
      if (!img || img.tagName !== "IMG") return;
      const rawSrc = img.getAttribute("src") || "";
      if (!rawSrc || /^data:/i.test(rawSrc)) return;
      const m = /(?:^|\/)((?:glasses|covers|packaging)\/[^?#]+)(\?[^#]*)?$/i.exec(rawSrc);
      if (!m) return;
      const relPath = m[1];
      const qs = m[2] || "";
      const tried = (img.dataset.ceFallback || "").split(",").filter(Boolean);

      // 1. On GitHub Pages right after a commit, raw.githubusercontent.com has the new file immediately
      const gh = detectGitHubRepo();
      if (gh && !rawSrc.includes("raw.githubusercontent.com") && !tried.includes("ghraw")) {
        tried.push("ghraw");
        img.dataset.ceFallback = tried.join(",");
        img.src = `https://raw.githubusercontent.com/${gh.repo}/${encodeURIComponent(gh.branch)}/${relPath}${qs}`;
        return;
      }

      // 2. Try sibling image extensions (png, jpg, jpeg, webp, avif, gif) — a folder
      //    photo swapped from .webp to .png must still render without the tree API
      const baseNoExt = relPath.replace(/\.[^./]+$/, "");
      for (const ext of FOLDER_IMAGE_EXTS) {
        const candidate = `${baseNoExt}.${ext}`;
        if (candidate.toLowerCase() === relPath.toLowerCase()) continue;
        if (!tried.includes(ext)) {
          tried.push(ext);
          img.dataset.ceFallback = tried.join(",");
          img.src = candidate;
          return;
        }
      }
    },
    true
  );

  try {
    await render();

    // The curtain stays until the opening plate is decoded, so the first frame the
    // visitor sees is already the finished picture — never a half-painted hero.
    // Image decoding is cosmetic: a failed or stalled decode must never block boot.
    const heroImg = document.querySelector("[data-hero] img");
    if (heroImg && typeof heroImg.decode === "function") {
      await Promise.race([
        heroImg.decode().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);
    }
  } catch (err) {
    console.error("Catalogue render failed:", err);
    const view = document.getElementById("view");
    if (view) {
      view.innerHTML = `<div class="wrap"><section class="section empty" style="min-height:60dvh;align-content:center">
        ${icon("warning")}
        <h1 class="h2" style="color:var(--ink)">Something went wrong</h1>
        <p>Please refresh the page to try again.</p>
        <button class="btn" onclick="location.reload()">Retry</button>
      </section></div>`;
    }
  } finally {
    // Always release the opening curtain, even if rendering or image decoding fails.
    bootReady = true;
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker
      .register("sw.js?v=18")
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  }
}

boot();
