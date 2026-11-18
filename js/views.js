/** Page views. Each returns { title, html, mount? }. */
import { icon } from "./icons.js";
import { selectors, mediaUrl, submitRequest, apiBase } from "./api.js";
import { request } from "./store.js";
import {
  esc,
  attr,
  toast,
  openSheet,
  closeSheet,
  skeletonGrid,
  arrowLink,
  notice,
  stockLabel,
} from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");
const price = (data, value) => selectors.price(data, value);

/* ------------------------------------------------------------------ cards */

export function cardMedia(product, sizes = "") {
  const src = product.images && product.images[0];
  if (!src) {
    return `<span class="fallback">${icon("sparkle")}<span>${esc(product.categorySlug === "acids" ? "Trade supply" : "Cocktail Embassy")}</span></span>`;
  }
  return `<img src="${attr(mediaUrl(src))}" alt="${attr(product.name)} — ${attr(
    product.subtitle || ""
  )}" loading="lazy" decoding="async" ${sizes ? `sizes="${attr(sizes)}"` : ""}>`;
}

/* Whole-scene hero plates — room, glow and glass baked into one raster file by
   tools/render_scenes.py. The page never stacks a glass over a backdrop. */
/* The opening plate is the piece itself: its catalogue plate already carries the
   deep-black stage, so it blends into the page instead of sitting in a picture
   frame. No separate wide render can drift away from the product photography. */
const HERO_PLATES = new Set([
  "levitating-martini",
  "etched-highball",
  "champagne-saucer",
  "levitating-super-pony",
]);

function heroScene(product) {
  return mediaUrl(product.images?.[0] || "");
}

/* The opening stage: a wide plate for tablets and desktop, a tall one for the
   phone, both of the same piece on the same black. Because the room inside the
   photograph is the room the page is painted in, the picture can run edge to
   edge on any screen without a frame, a letterbox or a seam. */
function heroPicture(slide, first = false) {
  const lead = first ? 'fetchpriority="high"' : 'loading="lazy"';
  const product = (slide && slide.product) || slide || {};
  const hasSlideCover = !!(slide && slide.cover);
  const cover = hasSlideCover
    ? slide.cover
    : HERO_PLATES.has(product.slug)
    ? `covers/hero-${product.slug}/cover.webp`
    : "";
  const portrait = hasSlideCover
    ? slide.portraitCover || ""
    : HERO_PLATES.has(product.slug)
    ? `covers/hero-${product.slug}/portrait.webp`
    : "";
  if (cover) {
    return `<picture>
      ${portrait ? `<source media="(max-aspect-ratio: 1/1)" srcset="${attr(mediaUrl(portrait))}">` : ""}
      <img src="${attr(mediaUrl(cover))}" alt="" ${lead} decoding="async">
    </picture>`;
  }
  // a plain catalogue plate is 4:5 and must be shown whole, never cropped
  return `<picture class="is-plain"><img src="${attr(heroScene(product))}" alt="" ${lead} decoding="async"></picture>`;
}

// The kinetic row under the hero. Live copy comes from settings.marquee; text
// wrapped in *asterisks* is set in italic, the way the house voice stresses a
// word. Anything else is printed straight.
const FALLBACK_MARQUEE = [
  "Hand-blown *crystal*",
  "52 pieces · six categories",
  "Bars, hotels & *studios*",
  "Trade prices in *AED*",
  "Dubai",
  "Worldwide *delivery*",
  "Breakage replaced *free*",
];

function marqueeLines(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function kineticHTML(settings = {}) {
  const custom = marqueeLines(settings.marquee);
  const lines = custom.length ? custom : FALLBACK_MARQUEE;
  return lines
    .map((line) => `<span>${esc(line).replace(/\*([^*]+)\*/g, "<em>$1</em>")}</span>`)
    .join("");
}

function productCard(data, product) {
  const badge = product.comingSoon
    ? `<span class="badge badge--out">First series</span>`
    : !product.inStock
    ? `<span class="badge badge--out">Made to order</span>`
    : product.badge
    ? `<span class="badge${product.badge === "New" ? " badge--accent" : ""}">${esc(product.badge)}</span>`
    : "";
  return `<article class="card">
    <a class="card__link" href="#/product/${attr(product.slug)}" aria-label="${attr(product.name)}">
      <div class="card__media">${badge}${cardMedia(product, "(min-width: 1080px) 24vw, (min-width: 760px) 32vw, 46vw")}</div>
    </a>
    <div class="card__body">
      <a href="#/product/${attr(product.slug)}">
        ${product.article ? `<span class="card__article mono">${esc(product.article)}</span>` : ""}
        <h3 class="card__name">${esc(product.name)}</h3>
        <p class="card__sub">${esc(product.subtitle || "")}</p>
      </a>
      <p class="card__price">${esc(product.comingSoon ? "First series" : price(data, product.price))}</p>
    </div>
    <button class="card__add" type="button" data-add="${attr(product.slug)}" aria-label="Add ${attr(
    product.name
  )} to request">${icon("plus")}</button>
  </article>`;
}

function categoryTile(data, category) {
  const items = selectors.productsByCategory(data, category.slug);
  // a category that ships its own cover plate uses it; the glass shelves fall
  // back to the first piece they hold, so every tile is one piece on black
  const cover = category.cover || (() => {
    const lead = items.find((p) => p.images && p.images.length) || items[0];
    return lead && lead.images && lead.images[0];
  })();
  const img = cover
    ? `<img src="${attr(mediaUrl(cover))}" alt="" loading="lazy" decoding="async">`
    : "";
  return `<a class="tile spotlight" href="#/shop?c=${attr(category.slug)}">
    <span class="tile__media">${img}</span>
    <span class="tile__inner">
      <span class="tile__eyebrow">${esc(category.blurb || "Category")}</span>
      <span class="tile__name">${esc(category.name)}</span>
      <span class="tile__count">${items.length} ${items.length === 1 ? "piece" : "pieces"}</span>
    </span>
  </a>`;
}

/* ------------------------------------------------------------------- home */

export function homeView(data) {
  const settings = data.settings || {};
  const slides = (settings.hero || [])
    .map((slide) => ({ ...slide, product: selectors.productBySlug(data, slide.productSlug) }))
    .filter((slide) => slide.product);
  const first = slides[0];
  const featured = selectors.featured(data);
  const grid = (featured.length ? featured : data.products.filter((p) => !p.comingSoon)).slice(0, 4);
  const categories = data.categories.filter((c) => selectors.productsByCategory(data, c.slug).length);
  const kinetic = kineticHTML(settings);

  const heroHTML = first
    ? `<section class="hero" data-hero>
      <div class="hero__art" aria-hidden="true">
        <div class="hero__track" data-hero-track>
          ${slides
            .map((slide, i) => `<div class="hero__slide" data-hero-slide="${i}">${heroPicture(slide, i === 0)}</div>`)
            .join("")}
        </div>
      </div>
      <div class="hero__inner">
        <p class="hero__kicker" data-hero-kicker>${esc(first.kicker || "The house")}</p>
        <div class="hero__titleWrap">
          <h1 class="h-hero hero__title" data-hero-title>${esc(first.title || first.name)}</h1>
        </div>
        <div class="hero__stage"></div>
        <div class="hero__meta">
          <div>
            <div class="hero__meta-name" data-hero-name>${esc(first.name)}</div>
            <div class="hero__meta-sub" data-hero-sub>${esc(first.subtitle || "")}</div>
            <div class="hero__meta-price" data-hero-price>${esc(price(data, first.product.price))}</div>
          </div>
          <p class="hero__meta-copy" data-hero-copy>${esc(first.copy || first.product.description)}</p>
          <div class="hero__actions">
            <a class="btn" href="#/product/${attr(first.product.slug)}" data-hero-cta>
              View piece ${icon("arrowRight")}
            </a>
            <div class="hero__dots" role="tablist" aria-label="Featured pieces">
              ${slides
                .map(
                  (_, i) =>
                    `<button class="hero__dot${i === 0 ? " is-active" : ""}" type="button" role="tab" aria-selected="${
                      i === 0
                    }" data-hero-dot="${i}" aria-label="Show piece ${i + 1}"></button>`
                )
                .join("")}
            </div>
          </div>
        </div>
        <div class="hero__nav">
          <button class="iconbtn" type="button" data-hero-prev aria-label="Previous">${icon("chevronLeft")}</button>
          <button class="iconbtn" type="button" data-hero-next aria-label="Next">${icon("chevronRight")}</button>
        </div>
      </div>
    </section>`
    : "";

  const html = `${heroHTML}

    <div class="kinetic" aria-hidden="true">
      <div class="kinetic__row">
        ${kinetic}${kinetic}
      </div>
    </div>

    <div class="wrap">
      <section class="section reveal" aria-labelledby="categories-title">
        <div class="section-head">
          <div>
            <p class="eyebrow">Categories</p>
            <h2 class="h2" id="categories-title" style="margin-top:8px">Six ways to serve</h2>
          </div>
          ${arrowLink("#/shop", "All pieces")}
        </div>
        <div class="catgrid">${categories.map((c) => categoryTile(data, c)).join("")}</div>
      </section>

      <section class="section split reveal" aria-labelledby="craft-title">
        <div class="split__media split__media--portrait">
          <img src="${attr(
            mediaUrl((settings.covers && settings.covers.homeCraft) || "covers/home-craft/cover.webp")
          )}" alt="Embassy Goblet — hand-blown crystal in the Embassy studio" loading="lazy" decoding="async">
        </div>
        <div class="split__copy">
          <p class="eyebrow">The craft</p>
          <h2 class="h1" id="craft-title">Hand-blown,<br>never manufactured.</h2>
          <p>Every piece passes through the hands of a glassblower before it reaches your bar — blown one at a time in our workshops in China, in small batches, and rejected if it does not sit perfectly balanced in the hand.</p>
          <p class="muted" style="font-size:14px">No two pieces are identical. Slight variations in weight and texture are the signature of the process — and the reason bars keep coming back.</p>
          ${arrowLink("#/info", "Our story")}
        </div>
      </section>

      <section class="section reveal" aria-labelledby="trade-title">
        <div class="mesh-card spotlight">
          <div style="display:grid;gap:18px;max-width:56ch;position:relative">
            <p class="eyebrow" style="color:var(--faint)">Trade programme</p>
            <h2 class="h2" id="trade-title">Built for bars, hotels &amp; studios.</h2>
            <p style="margin:0;color:var(--fg-soft);line-height:1.6;max-width:46ch">Volume pricing, replacement on breakage, and an account manager who answers in one business day. Build a request and we&rsquo;ll quote the full case.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
              <a class="btn" href="#/shop">Start a request ${icon("arrowRight")}</a>
              <a class="btn btn--ghost" href="#/info">Talk to us</a>
            </div>
          </div>
        </div>
      </section>

      <section class="section" aria-labelledby="assurance-title">
        <h2 class="sr-only" id="assurance-title">Our assurances</h2>
        <div class="assurance">
          <div class="assurance__item">${icon("truck")}<h3>Dispatch in 2–4 days</h3><p>${esc(
    settings.shippingNote || "Worldwide shipping, pallet orders quoted individually."
  )}</p></div>
          <div class="assurance__item">${icon("shield")}<h3>Breakage replaced</h3><p>${esc(
    settings.returnsNote || "Transit breakage is replaced free of charge."
  )}</p></div>
          <div class="assurance__item">${icon("sparkle")}<h3>Hand-blown</h3><p>Small-batch crystal, blown by hand in China.</p></div>
        </div>
      </section>
    </div>`;

  return { title: settings.brand || "Cocktail Embassy", html, mount: (root) => mountHero(root, slides) };
}

function mountHero(root, slides) {
  const hero = root.querySelector("[data-hero]");
  if (!hero || slides.length === 0) return;
  const track = hero.querySelector("[data-hero-track]");
  const count = slides.length;
  const els = {
    kicker: hero.querySelector("[data-hero-kicker]"),
    title: hero.querySelector("[data-hero-title]"),
    name: hero.querySelector("[data-hero-name]"),
    sub: hero.querySelector("[data-hero-sub]"),
    priceEl: hero.querySelector("[data-hero-price]"),
    copy: hero.querySelector("[data-hero-copy]"),
    cta: hero.querySelector("[data-hero-cta]"),
    dots: [...hero.querySelectorAll("[data-hero-dot]")],
  };
  const data = window.__CE_DATA__;
  const fmt = (v) => (data ? selectors.price(data, v) : v);

  let index = 0;
  let timer = null;
  let dragging = false;
  let startX = 0;
  let dx = 0;
  let metaTimer = null;

  function place(offset = 0, animate = true) {
    if (!track) return;
    track.classList.toggle("is-dragging", !animate);
    track.style.transform = `translate3d(calc(${-index * 100}% + ${offset}px), 0, 0)`;
  }

  function paintMeta(i) {
    const slide = slides[i];
    if (!slide) return;
    els.kicker.textContent = slide.kicker || "The house";
    els.title.textContent = slide.title || slide.name;
    els.name.textContent = slide.name;
    els.sub.textContent = slide.subtitle || "";
    els.priceEl.textContent = fmt(slide.product.price);
    els.copy.textContent = slide.copy || slide.product.description;
    els.cta.setAttribute("href", `#/product/${slide.product.slug}`);
  }

  /* The window moves the way the thumb moved: the strip follows the pointer, and
     on release it glides to whichever plate is nearer. */
  function go(next, animate = true) {
    index = ((next % count) + count) % count;
    place(0, animate);
    els.dots.forEach((d, i) => {
      d.classList.toggle("is-active", i === index);
      d.setAttribute("aria-selected", String(i === index));
    });
    clearTimeout(metaTimer);
    metaTimer = setTimeout(() => paintMeta(index), animate ? 170 : 0);
  }

  function start() {
    stop();
    if (count < 2) return;
    timer = setInterval(() => go(index + 1), 7000);
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  const threshold = () => Math.min(140, Math.max(46, hero.clientWidth * 0.16));

  function begin(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("a, button")) return;
    dragging = true;
    startX = e.clientX;
    dx = 0;
    stop();
    hero.classList.add("is-dragging");
    hero.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!dragging) return;
    dx = e.clientX - startX;
    if (Math.abs(dx) > 4) place(dx, false);
  }
  function finish() {
    if (!dragging) return;
    dragging = false;
    hero.classList.remove("is-dragging");
    const limit = threshold();
    if (dx <= -limit) go(index + 1);
    else if (dx >= limit) go(index - 1);
    else go(index);
    dx = 0;
    start();
  }

  hero.addEventListener("pointerdown", begin);
  hero.addEventListener("pointermove", move);
  hero.addEventListener("pointerup", finish);
  hero.addEventListener("pointercancel", finish);
  hero.addEventListener("pointerleave", () => dragging && finish());

  /* keyboard and the arrow buttons drive the same strip */
  hero.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") go(index + 1);
    if (e.key === "ArrowLeft") go(index - 1);
  });
  els.dots.forEach((dot, i) =>
    dot.addEventListener("click", () => {
      go(i);
      start();
    })
  );
  hero.querySelector("[data-hero-next]")?.addEventListener("click", () => {
    go(index + 1);
    start();
  });
  hero.querySelector("[data-hero-prev]")?.addEventListener("click", () => {
    go(index - 1);
    start();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  place(0, false);
  els.dots.forEach((d, i) => {
    d.classList.toggle("is-active", i === 0);
    d.setAttribute("aria-selected", String(i === 0));
  });
  start();
}

/* ------------------------------------------------------------------- shop */

const SORTS = [
  { id: "featured", label: "Featured" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
  { id: "name", label: "Name: A–Z" },
  { id: "volume", label: "Volume: small to large" },
  { id: "new", label: "Newest first" },
];

export function shopView(data, params = {}) {
  const activeCat = params.c || "all";
  const sort = SORTS.some((s) => s.id === params.sort) ? params.sort : "featured";
  const query = params.q || "";
  const onlyNew = params.new === "1";
  const inStock = params.stock === "1";
  const maxPrice = Number(params.max) > 0 ? Number(params.max) : 0;
  const category = selectors.categoryBySlug(data, activeCat);
  const ceiling = Math.ceil(Math.max(...data.products.map((p) => p.price), 1) / 10) * 10;

  const heading = category ? category.name : "The catalogue";
  const subheading = category ? category.blurb : "Crystal, barware and cocktail acids — hand-blown, trade-ready.";

  const html = `<div class="wrap">
    <header class="shop-head">
      <p class="eyebrow">${esc(category ? "Category" : "Shop")}</p>
      <div class="shop-title-row">
        <h1 class="h1" style="margin-top:6px">${esc(heading)}</h1>
      </div>
      <p class="lede" style="margin:10px 0 0;max-width:52ch">${esc(subheading || "")}</p>
    </header>

    <div class="controls">
      <div class="searchbar">
        ${icon("search")}
        <input type="search" placeholder="Search pieces, materials, categories" value="${attr(
          query
        )}" aria-label="Search the catalogue" data-shop-search>
        <button class="searchbar__clear" type="button" data-shop-clear aria-label="Clear search" ${
          query ? "" : "hidden"
        }>${icon("close")}</button>
      </div>
      <div class="chips">
        <button class="chip" type="button" data-chip="all" aria-pressed="${
          activeCat === "all"
        }">All</button>
        ${data.categories
          .map(
            (c) =>
              `<button class="chip" type="button" data-chip="${attr(c.slug)}" aria-pressed="${
                activeCat === c.slug
              }">${esc(c.name)}</button>`
          )
          .join("")}
        <button class="chip chip--ghost" type="button" data-open-filters>${icon("sliders")}<span data-filter-label>Filters</span></button>
        <button class="chip chip--ghost" type="button" data-open-sort>${icon("sort")}<span data-sort-label>${esc(
          SORTS.find((s) => s.id === sort).label
        )}</span></button>
      </div>
    </div>

    <p class="result-count" data-shop-count aria-live="polite"></p>
    <div data-shop-grid style="margin-top:14px">${skeletonGrid(6)}</div>
  </div>`;

  return {
    title: `${heading} — ${data.settings.brand || "Cocktail Embassy"}`,
    html,
    mount(root) {
      let current = { cat: activeCat, sort, q: query, onlyNew, inStock, maxPrice };
      const grid = root.querySelector("[data-shop-grid]");
      const count = root.querySelector("[data-shop-count]");
      const search = root.querySelector("[data-shop-search]");
      const clear = root.querySelector("[data-shop-clear]");

      function compute() {
        let list = data.products.slice();
        if (current.cat !== "all") list = list.filter((p) => p.categorySlug === current.cat);
        if (current.onlyNew) list = list.filter((p) => p.badge === "New");
        if (current.inStock) list = list.filter((p) => p.inStock);
        if (current.maxPrice) list = list.filter((p) => p.price <= current.maxPrice);
        const q = current.q.trim().toLowerCase();
        if (q) {
          list = list.filter((p) =>
            [p.name, p.subtitle, p.description, p.categorySlug, p.article]
              .join(" ")
              .toLowerCase()
              .includes(q)
          );
        }
        switch (current.sort) {
          case "price-asc":
            list.sort((a, b) => a.price - b.price);
            break;
          case "price-desc":
            list.sort((a, b) => b.price - a.price);
            break;
          case "name":
            list.sort((a, b) => a.name.localeCompare(b.name));
            break;
          case "volume":
            list.sort((a, b) => a.volumeMl - b.volumeMl || a.sort - b.sort);
            break;
          case "new":
            list.sort((a, b) => Number(b.badge === "New") - Number(a.badge === "New") || a.sort - b.sort);
            break;
          default:
            list.sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort - b.sort);
        }
        return list;
      }

      function render() {
        const list = compute();
        count.textContent = `${list.length} ${list.length === 1 ? "piece" : "pieces"}${
          current.q ? ` matching “${current.q}”` : ""
        }`;
        grid.innerHTML = list.length
          ? `<div class="grid">${list.map((p) => productCard(data, p)).join("")}</div>`
          : `<div class="empty">${icon("search")}<p style="margin:0;font-weight:600;color:var(--ink)">Nothing matches that search</p>
             <p style="margin:0;font-size:14px">Try a different word, or browse the full catalogue.</p>
             <button class="btn btn--ghost btn--sm" type="button" data-reset>Reset filters</button></div>`;
        const activeFilters = Number(current.onlyNew) + Number(current.inStock) + Number(current.maxPrice > 0);
        const filterLabel = root.querySelector("[data-filter-label]");
        if (filterLabel) filterLabel.textContent = activeFilters ? `Filters · ${activeFilters}` : "Filters";
        const url = new URL(location.href);
        const hashParams = new URLSearchParams();
        if (current.cat !== "all") hashParams.set("c", current.cat);
        if (current.sort !== "featured") hashParams.set("sort", current.sort);
        if (current.q) hashParams.set("q", current.q);
        if (current.onlyNew) hashParams.set("new", "1");
        if (current.inStock) hashParams.set("stock", "1");
        if (current.maxPrice) hashParams.set("max", String(current.maxPrice));
        const qs = hashParams.toString();
        const nextHash = `#/shop${qs ? `?${qs}` : ""}`;
        if (url.hash !== nextHash) history.replaceState(null, "", nextHash);
      }

      search.addEventListener("input", () => {
        current.q = search.value;
        clear.hidden = !search.value;
        render();
      });
      clear.addEventListener("click", () => {
        search.value = "";
        current.q = "";
        clear.hidden = true;
        search.focus();
        render();
      });
      root.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-chip]");
        if (chip) {
          current.cat = chip.dataset.chip;
          root.querySelectorAll("[data-chip]").forEach((c) =>
            c.setAttribute("aria-pressed", String(c === chip))
          );
          render();
        }
        if (e.target.closest("[data-reset]")) {
          current = { cat: "all", sort: "featured", q: "", onlyNew: false, inStock: false, maxPrice: 0 };
          search.value = "";
          clear.hidden = true;
          root.querySelectorAll("[data-chip]").forEach((c) =>
            c.setAttribute("aria-pressed", String(c.dataset.chip === "all"))
          );
          render();
        }
        if (e.target.closest("[data-open-filters]")) {
          const flag = (on) => (on ? "is-on" : "");
          const marks = (on) => (on ? icon("check") : "");
          const ceilings = [50, 100, 200, ceiling].filter((v, i, a) => a.indexOf(v) === i);
          openSheet({
            title: "Filters",
            body: `<div class="sortlist">
              <button class="sortlist__row" type="button" data-flag="onlyNew">
                <span>Only new pieces</span><span class="sortlist__check">${marks(current.onlyNew)}</span>
              </button>
              <button class="sortlist__row" type="button" data-flag="inStock">
                <span>Only in stock</span><span class="sortlist__check">${marks(current.inStock)}</span>
              </button>
              <div class="sortlist__row sortlist__row--static"><span>Price up to <b data-price-value>${current.maxPrice ? price(data, current.maxPrice) : "any"}</b></span></div>
              <div class="filters__prices">${ceilings
                .map(
                  (v) =>
                    `<button class="chip" type="button" data-max="${v}" aria-pressed="${
                      current.maxPrice === v
                    }">${esc(price(data, v))}</button>`
                )
                .join("")}<button class="chip" type="button" data-max="0" aria-pressed="${
                current.maxPrice === 0
              }">Any</button></div>
            </div>`,
            onMount(sheetEl) {
              sheetEl.addEventListener("click", (ev) => {
                const flagBtn = ev.target.closest("[data-flag]");
                if (flagBtn) {
                  const key = flagBtn.dataset.flag;
                  current[key] = !current[key];
                  flagBtn.querySelector(".sortlist__check").innerHTML = marks(current[key]);
                  flagBtn.classList.toggle("is-on", current[key]);
                  render();
                  return;
                }
                const maxBtn = ev.target.closest("[data-max]");
                if (maxBtn) {
                  current.maxPrice = Number(maxBtn.dataset.max);
                  sheetEl.querySelectorAll("[data-max]").forEach((b) =>
                    b.setAttribute("aria-pressed", String(b === maxBtn))
                  );
                  const label = sheetEl.querySelector("[data-price-value]");
                  if (label) label.textContent = current.maxPrice ? price(data, current.maxPrice) : "any";
                  render();
                }
              });
            },
          });
        }
        if (e.target.closest("[data-open-sort]")) {
          openSheet({
            title: "Sort by",
            body: `<div class="sortlist">${SORTS.map(
              (s) =>
                `<button class="sortlist__row" type="button" data-sort="${s.id}">
                  <span>${esc(s.label)}</span>
                  <span class="sortlist__check">${s.id === current.sort ? icon("check") : ""}</span>
                </button>`
            ).join("")}</div>`,
            onMount(sheet) {
              sheet.addEventListener("click", (ev) => {
                const btn = ev.target.closest("[data-sort]");
                if (!btn) return;
                current.sort = btn.dataset.sort;
                root.querySelector("[data-sort-label]").textContent =
                  SORTS.find((s) => s.id === current.sort).label;
                closeSheet();
                render();
              });
            },
          });
        }
      });

      render();
    },
  };
}

/* ---------------------------------------------------------------- product */

export function productView(data, slug) {
  const product = selectors.productBySlug(data, slug);
  if (!product) return null;

  const category = selectors.categoryBySlug(data, product.categorySlug);
  const related = selectors.related(data, product, 4);
  const specs = Object.entries(product.specs || {});
  const img = product.images[0] ? mediaUrl(product.images[0]) : "";

  const html = `<div class="pdp">
    <section class="pdp__stage" aria-label="${attr(product.name)}">
      <div class="pdp__stage-inner">
        ${
          img
            ? `<img class="pdp__figure" data-pdp-img src="${attr(img)}" alt="${attr(product.name)} — ${attr(
                product.subtitle || ""
              )}" fetchpriority="high" decoding="async">`
            : `<img class="pdp__figure" src="assets/brand/mark-chrome.png" alt="" style="height:min(30dvh,280px);opacity:.45">`
        }
        ${
          product.images.length > 1
            ? `<div class="pdp__thumbs">${product.images
                .map(
                  (src, i) =>
                    `<button class="pdp__thumb${i === 0 ? " is-active" : ""}" type="button" data-pdp-thumb="${attr(
                      mediaUrl(src)
                    )}" aria-label="View image ${i + 1}"><img src="${attr(
                      mediaUrl(src)
                    )}" alt="" loading="lazy"></button>`
                )
                .join("")}</div>`
            : ""
        }
      </div>
    </section>

    <div class="pdp__body">
      <div class="pdp__head">
        <div class="pdp__eyebrow">
          <a href="#/shop?c=${attr(product.categorySlug)}" style="text-transform:inherit">${esc(
    category ? category.name : "Catalogue"
  )}</a>
          ${product.article ? `<span aria-hidden="true"> · </span><span class="mono">${esc(product.article)}</span>` : ""}
        </div>
        <h1 class="pdp__title">${esc(product.name)}</h1>
        <p class="muted" style="margin:0;font-size:15px">${esc(product.subtitle || "")}</p>
        <div class="pdp__price-row">
          <span class="pdp__price">${esc(product.comingSoon ? "First series" : price(data, product.price))}</span>
          ${product.comingSoon ? `<span class="stock stock--out">First series</span>` : stockLabel(product.inStock)}
        </div>
        <p class="pdp__price-note">${esc(data.settings.priceNote || "")}</p>
      </div>

      <p class="pdp__desc">${esc(product.description || "")}</p>

      <div class="pdp__buy">
        <div class="qty" data-qty>
          <button type="button" data-qty-minus aria-label="Decrease quantity" disabled>${icon("minus")}</button>
          <output data-qty-value>1</output>
          <button type="button" data-qty-plus aria-label="Increase quantity">${icon("plus")}</button>
        </div>
        <button class="btn" type="button" data-add="${attr(product.slug)}" data-add-qty>${
    product.comingSoon ? "Request this piece" : "Add to request"
  } ${icon("bag")}</button>
      </div>

      ${specs.length ? `<div class="specs">${specs
        .map(
          ([k, v]) =>
            `<div class="specs__row"><span class="specs__k">${esc(k)}</span><span class="specs__v">${esc(
              v
            )}</span></div>`
        )
        .join("")}</div>` : ""}

      ${
        category
          ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="chip" href="#/shop?c=${attr(
              category.slug
            )}">${esc(category.name)}</a></div>`
          : ""
      }

      <div class="info-card">
        <h3>Shipping &amp; terms</h3>
        <p>${esc(data.settings.shippingNote || "")} ${esc(data.settings.requestNote || "")}</p>
      </div>
    </div>
  </div>

  ${
    related.length
      ? `<div class="wrap"><section class="section" aria-labelledby="related-title">
          <div class="section-head">
            <h2 class="h3" id="related-title">Pairs well with</h2>
            ${arrowLink("#/shop", "All pieces")}
          </div>
          <div class="grid">${related.map((p) => productCard(data, p)).join("")}</div>
        </section></div>`
      : ""
  }

  <div class="pdp__actions">
    <div class="qty qty--sm" data-qty>
      <button type="button" data-qty-minus aria-label="Decrease quantity" disabled>${icon("minus")}</button>
      <output data-qty-value>1</output>
      <button type="button" data-qty-plus aria-label="Increase quantity">${icon("plus")}</button>
    </div>
    <button class="btn" type="button" data-add="${attr(product.slug)}" data-add-qty>Add to request</button>
  </div>`;

  return {
    title: `${product.name} — ${data.settings.brand || "Cocktail Embassy"}`,
    html,
    navTitle: product.name,
    theme: "dark-top",
    mount(root) {
      const buy = root.querySelector(".pdp__buy [data-qty]");
      const bar = root.querySelector(".pdp__actions [data-qty]");
      let qty = 1;
      const sync = () => {
        root.querySelectorAll("[data-qty-value]").forEach((o) => (o.textContent = String(qty)));
        root.querySelectorAll("[data-qty-minus]").forEach((b) => (b.disabled = qty <= 1));
        root.querySelectorAll("[data-qty-plus]").forEach((b) => (b.disabled = qty >= 99));
        root.querySelectorAll("[data-add-qty]").forEach((b) => (b.dataset.addQty = String(qty)));
      };
      root.addEventListener("click", (e) => {
        if (e.target.closest("[data-qty-minus]")) {
          qty = Math.max(1, qty - 1);
          sync();
        }
        if (e.target.closest("[data-qty-plus]")) {
          qty = Math.min(99, qty + 1);
          sync();
        }
        const thumb = e.target.closest("[data-pdp-thumb]");
        if (thumb) {
          const main = root.querySelector("[data-pdp-img]");
          if (main) main.src = thumb.dataset.pdpThumb;
          root.querySelectorAll("[data-pdp-thumb]").forEach((t) =>
            t.classList.toggle("is-active", t === thumb)
          );
        }
      });
      sync();
      if (buy) buy.dataset.qtyScope = "desktop";
      if (bar) bar.dataset.qtyScope = "mobile";
    },
  };
}

/* ---------------------------------------------------------------- request */

/* ---------------------------------------------------------------- request */

export function requestView(data) {
  const settings = data.settings || {};
  const contacts = settings.contacts || {};
  const lines = request.lines(data);

  if (!lines.length) {
    return {
      title: `Request — ${settings.brand || "Cocktail Embassy"}`,
      html: `<div class="wrap">
        <section class="section empty" style="min-height:56dvh;align-content:center">
          ${icon("bag")}
          <h1 class="h2" style="color:var(--ink);margin:6px 0 0">Your request is empty</h1>
          <p style="max-width:40ch;margin:0">Add pieces as you browse. We confirm availability, shipping and invoicing by email — no payment is taken online.</p>
          <a class="btn" href="#/shop" style="margin-top:8px">Browse the catalogue ${icon("arrowRight")}</a>
        </section>
      </div>`,
    };
  }

  const total = request.total(data);

  const html = `<div class="wrap">
    <header class="shop-head">
      <p class="eyebrow">Request</p>
      <h1 class="h1" style="margin-top:6px">Your request</h1>
      <p class="lede" style="margin:10px 0 0;max-width:56ch">${esc(
        settings.requestNote || "Submit your list and our team will confirm everything by email."
      )}</p>
    </header>

    <div class="cart-layout" style="margin-top:22px">
      <div style="display:grid;gap:18px">
        <div class="cart-list" data-lines>
          ${lines.map((line) => lineItem(data, line, true)).join("")}
        </div>
        <div class="info-card">
          <h3>How it works</h3>
          <p>1 — Send this request. 2 — We confirm stock, shipping cost and lead time within one business day. 3 — Invoice and dispatch. No payment is collected on this site.</p>
        </div>
      </div>

      <aside class="cart-aside">
        <div class="summary">
          <div class="summary__row"><span>Pieces</span><span class="num" data-sum-qty>${request.count()}</span></div>
          <div class="summary__row"><span>Subtotal</span><span class="num">${esc(price(data, total))}</span></div>
          <div class="summary__row"><span>Shipping</span><span>Quoted</span></div>
          <div class="summary__row summary__row--total"><span>Estimated</span><span class="num">${esc(
            price(data, total)
          )}</span></div>
          ${
            lines.some((l) => l.product.comingSoon)
              ? `<p class="muted" style="margin:10px 0 0;font-size:13px">First-series pieces have no price yet — we confirm it with your request.</p>`
              : ""
          }
          <p class="muted" style="font-size:11.5px;margin:0">${esc(settings.priceNote || "")}</p>
        </div>

        <form class="form" data-request-form novalidate>
          <div class="form-grid form-grid--2">
            <div class="field">
              <label class="field__label" for="rf-name">Full name</label>
              <input class="field__input" id="rf-name" name="name" autocomplete="name" required>
            </div>
            <div class="field">
              <label class="field__label" for="rf-company">Venue / company</label>
              <input class="field__input" id="rf-company" name="company" autocomplete="organization">
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="rf-email">Email</label>
            <input class="field__input" id="rf-email" name="email" type="email" autocomplete="email" required>
          </div>
          <div class="form-grid form-grid--2">
            <div class="field">
              <label class="field__label" for="rf-phone">Phone / WhatsApp</label>
              <input class="field__input" id="rf-phone" name="phone" type="tel" autocomplete="tel">
            </div>
            <div class="field">
              <label class="field__label" for="rf-country">Country</label>
              <input class="field__input" id="rf-country" name="country" autocomplete="country-name">
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="rf-note">Notes</label>
            <textarea class="field__area" id="rf-note" name="note" placeholder="Delivery window, case quantities, engraving…"></textarea>
          </div>
          <button class="btn btn--block" type="submit" data-submit>Send request ${icon("arrowRight")}</button>
          <p class="field__hint">By sending you accept that we will contact you about this request. No newsletter, no payment.</p>
          ${
            apiBase()
              ? ""
              : `<div class="notice">${icon("info")}<span>Demo mode: the order bot is not connected yet, so this request opens in your email app for sending.</span></div>`
          }
        </form>
      </aside>
    </div>
  </div>`;

  return {
    title: `Request — ${settings.brand || "Cocktail Embassy"}`,
    html,
    mount(root) {
      const form = root.querySelector("[data-request-form]");

      root.addEventListener("click", (e) => {
        const inc = e.target.closest("[data-inc]");
        const dec = e.target.closest("[data-dec]");
        const del = e.target.closest("[data-remove]");
        if (!inc && !dec && !del) return;
        const slug = (inc || dec || del).dataset.inc || (inc || dec || del).dataset.dec || (inc || dec || del).dataset.remove;
        const line = request.lines(data).find((l) => l.slug === slug);
        if (!line) return;
        if (inc) request.setQty(slug, line.qty + 1);
        if (dec) request.setQty(slug, line.qty - 1);
        if (del) {
          request.remove(slug);
          toast("Removed from request");
        }
        refreshRequestPage(data);
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fields = [...form.querySelectorAll("[required]")];
        let valid = true;
        fields.forEach((f) => {
          const ok = f.value.trim() !== "" && (f.type !== "email" || /.+@.+\..+/.test(f.value));
          f.closest(".field").classList.toggle("is-invalid", !ok);
          if (!ok && valid) {
            f.focus();
            valid = false;
          }
        });
        if (!valid) {
          toast("Please check the highlighted fields", { iconName: "warning" });
          return;
        }

        const fd = new FormData(form);
        const payload = {
          name: String(fd.get("name") || "").trim(),
          company: String(fd.get("company") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          phone: String(fd.get("phone") || "").trim(),
          country: String(fd.get("country") || "").trim(),
          note: String(fd.get("note") || "").trim(),
          items: request.lines(data).map((l) => ({
            slug: l.slug,
            name: l.product.name,
            qty: l.qty,
            price: l.product.price,
          })),
          total,
          currency: settings.currency || "EUR",
          source: "web",
        };

        const btn = form.querySelector("[data-submit]");
        const original = btn.innerHTML;
        btn.innerHTML = `<span class="btn__spinner" aria-hidden="true"></span> Sending…`;
        btn.disabled = true;

        const result = await submitRequest(payload);
        btn.innerHTML = original;
        btn.disabled = false;

        if (!result.ok) {
          toast(result.error || "Could not send the request", { iconName: "warning" });
          return;
        }

        const reference = result.reference || `CE-${Date.now().toString().slice(-6)}`;
        const summaryLines = payload.items.map((i) => `${i.qty} × ${i.name}`).join("%0D%0A");
        const mailto = `mailto:${encodeURIComponent(
          window.CE_CONFIG?.requestEmail || contacts.email || ""
        )}?subject=${encodeURIComponent(`Request ${reference} — ${settings.brand || ""}`)}&body=${encodeURIComponent(
          `${payload.name}${payload.company ? ` (${payload.company})` : ""}\n${payload.email} · ${
            payload.phone || "—"
          }\n${payload.country || ""}\n\n${summaryLines}\n\nNote: ${payload.note || "—"}`
        )}`;

        request.clear();
        renderRequestSuccess(root, { reference, total, data, mailto, channel: result.channel });
      });
    },
  };
}

export function lineItem(data, line, removable) {
  const p = line.product;
  return `<div class="line-item" data-line="${attr(p.slug)}">
    <a class="line-item__media" href="#/product/${attr(p.slug)}" aria-hidden="true" tabindex="-1">
      ${
        p.images[0]
          ? `<img src="${attr(mediaUrl(p.images[0]))}" alt="" loading="lazy">`
          : `<span style="opacity:.35">${icon("sparkle")}</span>`
      }
    </a>
    <div>
      <a href="#/product/${attr(p.slug)}"><div class="line-item__name">${esc(p.name)}</div></a>
      <div class="line-item__sub">${esc(p.subtitle || "")}</div>
      <div class="line-item__price">${esc(p.comingSoon ? "First series" : price(data, p.price * line.qty))}</div>
    </div>
    <div class="line-item__right">
      <div class="qty qty--sm">
        <button type="button" data-dec="${attr(p.slug)}" aria-label="Decrease ${attr(p.name)}" ${
    line.qty <= 1 ? "disabled" : ""
  }>${icon("minus")}</button>
        <output>${line.qty}</output>
        <button type="button" data-inc="${attr(p.slug)}" aria-label="Increase ${attr(p.name)}">${icon("plus")}</button>
      </div>
      ${removable ? `<button type="button" class="remove" data-remove="${attr(p.slug)}">Remove</button>` : ""}
    </div>
  </div>`;
}

function refreshRequestPage(data) {
  const lines = request.lines(data);
  const container = document.querySelector("[data-lines]");
  if (!container) {
    location.reload();
    return;
  }
  if (!lines.length) {
    location.hash = "#/request";
    location.reload();
    return;
  }
  container.innerHTML = lines.map((line) => lineItem(data, line, true)).join("");
  const total = request.total(data);
  const summary = document.querySelector(".summary");
  const qtyEl = summary.querySelector("[data-sum-qty]");
  if (qtyEl) qtyEl.textContent = String(request.count());
  summary.querySelectorAll(".num")[1].textContent = selectors.price(data, total);
  summary.querySelector(".summary__row--total .num").textContent = selectors.price(data, total);
}

function renderRequestSuccess(root, { reference, total, data, mailto, channel }) {
  const wrap = root.querySelector(".wrap");
  wrap.innerHTML = `<section class="success">
    <div class="success__mark">${icon("check")}</div>
    <p class="eyebrow">Request received</p>
    <h1 class="h2">Thank you — we&rsquo;re on it.</h1>
    <p class="lede" style="margin:0">Reference <code>${esc(reference)}</code>. Our team confirms availability and shipping within one business day at the email you provided.</p>
    <p class="muted" style="font-size:13px;margin:0">Estimated value <strong>${esc(
      selectors.price(data, total)
    )}</strong> · ${esc(data.settings.priceNote || "")}</p>
    ${
      channel === "email"
        ? `<a class="btn" href="${attr(mailto)}">Send a copy by email ${icon("mail")}</a>`
        : ""
    }
    <a class="btn btn--ghost" href="#/shop">Continue browsing</a>
  </section>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ------------------------------------------------------------------- info */

export function infoView(data) {
  const settings = data.settings || {};
  const c = settings.contacts || {};
  const social = [
    c.instagram ? `<a href="${attr(c.instagram)}" target="_blank" rel="noopener">${icon("instagram")} Instagram</a>` : "",
    c.telegram ? `<a href="${attr(c.telegram)}" target="_blank" rel="noopener">${icon("telegram")} Telegram</a>` : "",
    c.whatsapp ? `<a href="${attr(c.whatsapp)}" target="_blank" rel="noopener">${icon("whatsapp")} WhatsApp</a>` : "",
  ].join("");

  const infoBanner = (settings.covers && settings.covers.infoBanner) || "covers/info-banner/cover.webp";
  const infoStory = (settings.covers && settings.covers.infoStory) || "covers/info-story/cover.webp";

  const html = `<section class="hero-mini">
      <div class="hero-mini__bg"><img src="${attr(mediaUrl(infoBanner))}" alt=""></div>
      <div class="hero-mini__inner">
        <p class="eyebrow" style="color:rgba(255,255,255,.55)">The Embassy</p>
        <h1 class="h1">Glass, considered.</h1>
        <p class="lede" style="color:rgba(255,255,255,.75);max-width:56ch;margin:0">${esc(
          settings.about || ""
        )}</p>
      </div>
    </section>

    <div class="wrap">
      <section class="section split">
        <div class="split__media split__media--portrait">
          <img src="${attr(mediaUrl(infoStory))}" alt="Saucer Coupe — hand-blown crystal" loading="lazy">
        </div>
        <div class="split__copy">
          <p class="eyebrow">Since 2024</p>
          <h2 class="h2">A small house with a long memory.</h2>
          <p>Cocktail Embassy is a Dubai house supplying bars, hotels and studios across the Gulf and beyond. Every piece is blown by hand, one at a time, in our partner workshops in China — then checked here against the shape and the weight it has to hit.</p>
          <p>Editions stay small and specifications are published honestly — because the bar manager with a broken stem at midnight needs a real answer, not a marketing line.</p>
        </div>
      </section>

      <section class="section" aria-labelledby="contact-title">
        <div class="section-head">
          <h2 class="h2" id="contact-title">Talk to us</h2>
        </div>
        <div class="info-grid">
          <div class="info-card">
            <h3>Orders &amp; trade</h3>
            <p><a href="mailto:${attr(c.email || "")}">${esc(c.email || "")}</a></p>
            <p>${esc(c.hours || "")}</p>
          </div>
          <div class="info-card">
            <h3>Phone</h3>
            <p><a href="tel:${attr((c.phone || "").replace(/\s/g, ""))}">${esc(c.phone || "")}</a></p>
            <p>${esc(c.address || "")}</p>
          </div>
          <div class="info-card">
            <h3>Shipping</h3>
            <p>${esc(settings.shippingNote || "")}</p>
          </div>
          <div class="info-card">
            <h3>Returns &amp; breakage</h3>
            <p>${esc(settings.returnsNote || "")}</p>
          </div>
          <div class="info-card">
            <h3>Trade programme</h3>
            <p>Volume pricing, engraved editions and replacement stock for bars, hotels and studios. Ask for the trade sheet.</p>
            <p><a href="#/shop">Start a request →</a></p>
          </div>
          <div class="info-card">
            <h3>Follow</h3>
            <p style="display:flex;gap:16px;flex-wrap:wrap">${social || `<span>${esc(c.instagram || "")}</span>`}</p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="mesh-card">
          <div style="display:grid;gap:14px;max-width:52ch">
            <h2 class="h2">Open the catalogue.</h2>
            <p style="margin:0;color:var(--fg-soft);line-height:1.6">Fifty-two pieces, six categories, one house standard.</p>
            <div><a class="btn" href="#/shop">Shop all pieces ${icon("arrowRight")}</a></div>
          </div>
        </div>
      </section>
    </div>`;

  return {
    title: `About — ${settings.brand || "Cocktail Embassy"}`,
    html,
    theme: "dark-top",
  };
}

/* ------------------------------------------------------------------- 404 */

export function notFoundView(data) {
  return {
    title: "Not found — Cocktail Embassy",
    html: `<div class="wrap"><section class="section empty" style="min-height:60dvh;align-content:center">
      ${icon("warning")}
      <h1 class="h2" style="color:var(--ink);margin:6px 0 0">We can&rsquo;t find that page</h1>
      <p style="margin:0">The piece may have been retired or the link is mistyped.</p>
      <a class="btn" href="#/shop">Back to the catalogue ${icon("arrowRight")}</a>
    </section></div>`,
  };
}

/* -------------------------------------------------------------- admin */

import { adminView } from "./admin.js";

export { adminView };
