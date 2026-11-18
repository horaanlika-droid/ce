/** Shared UI primitives: escaping, toast, sheet, placeholders, motion helpers. */
import { icon } from "./icons.js";

export const esc = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const attr = esc;

export function debounce(fn, ms = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- Toast ---------- */
let toastTimer;
export function toast(message, { iconName = "checkCircle", duration = 2600 } = {}) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.body.appendChild(node);
  }
  node.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
  requestAnimationFrame(() => node.classList.add("is-visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), duration);
}

/* ---------- Sheet ---------- */
let activeSheet = null;

export function openSheet({ title = "", body = "", actions = "", onMount } = {}) {
  closeSheet(true);

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.dataset.role = "scrim";

  const sheet = document.createElement("section");
  sheet.className = "sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", title || "Dialog");
  sheet.innerHTML = `
    <div class="sheet__grab" aria-hidden="true"></div>
    <header class="sheet__head">
      <h2 class="sheet__title">${esc(title)}</h2>
      <button class="iconbtn" type="button" data-close aria-label="Close">${icon("close")}</button>
    </header>
    <div class="sheet__body">${body}</div>
    ${actions ? `<div class="sheet__actions" style="margin-top:16px;display:flex;gap:10px">${actions}</div>` : ""}
  `;

  document.body.append(scrim, sheet);
  document.body.classList.add("is-locked");
  activeSheet = { scrim, sheet };

  requestAnimationFrame(() => {
    scrim.classList.add("is-open");
    sheet.classList.add("is-open");
    const focusable = sheet.querySelector("input, textarea, select, button:not([data-close])");
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 320);
  });

  scrim.addEventListener("click", () => closeSheet());
  sheet.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeSheet();
  });

  // drag the sheet down to dismiss it, the way a native one behaves
  let drag = null;
  const onDown = (e) => {
    if (e.target.closest("[data-close]")) return;
    drag = { y: e.clientY, dy: 0, at: performance.now(), id: e.pointerId };
    sheet.classList.add("is-dragging");
    try {
      sheet.setPointerCapture(e.pointerId);
    } catch {
      /* older engines: pointer capture is a nicety, not a requirement */
    }
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    sheet.style.transform = `translateY(${drag.dy}px)`;
  };
  const onUp = () => {
    if (!drag) return;
    const { dy, at } = drag;
    drag = null;
    sheet.classList.remove("is-dragging");
    sheet.style.transform = "";
    if (dy > 96 || (dy > 24 && performance.now() - at < 260)) closeSheet();
  };
  [sheet.querySelector(".sheet__grab"), sheet.querySelector(".sheet__head")].forEach((handle) => {
    if (!handle) return;
    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      closeSheet();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  if (typeof onMount === "function") onMount(sheet);
  return sheet;
}

export function closeSheet(immediate = false) {
  if (!activeSheet) return;
  const { scrim, sheet } = activeSheet;
  activeSheet = null;
  sheet.classList.remove("is-open");
  scrim.classList.remove("is-open");
  const done = () => {
    sheet.remove();
    scrim.remove();
    if (!document.querySelector(".sheet")) document.body.classList.remove("is-locked");
  };
  if (immediate) done();
  else setTimeout(done, 380);
}

/* ---------- Skeletons ---------- */
export function skeletonGrid(n = 6) {
  return `<div class="grid">${Array.from(
    { length: n },
    () => `<div class="sk-card"><div class="skeleton sk-card__media"></div>
      <div class="sk-card__body">
        <div class="skeleton" style="height:12px;width:72%"></div>
        <div class="skeleton" style="height:10px;width:44%"></div>
        <div class="skeleton" style="height:11px;width:28%;margin-top:4px"></div>
      </div></div>`
  ).join("")}</div>`;
}

/* ---------- Small markup helpers ---------- */
export function arrowLink(href, label) {
  return `<a class="link" href="${attr(href)}">${esc(label)}${icon("arrowRight")}</a>`;
}

export function notice(text, iconName = "warning") {
  return `<div class="notice" role="status">${icon(iconName)}<span>${esc(text)}</span></div>`;
}

export function stockLabel(inStock) {
  return inStock
    ? `<span class="stock">In stock</span>`
    : `<span class="stock stock--out">Made to order</span>`;
}
