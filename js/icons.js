/** Inline SVG icon set — thin, SF-Symbol-like strokes.
 *  Presentational width/height="18" prevents unsized 300×300 SVG fallback while
 *  letting any CSS width/height rule override with zero specificity friction. */
const s = (paths, extra = "") =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;

export const icons = {
  home: s('<path d="M3.6 10.4 12 3.5l8.4 6.9"/><path d="M5.5 9.4V20h13V9.4"/><path d="M9.7 20v-5.3h4.6V20"/>'),
  shop: s('<circle cx="11" cy="11" r="6.6"/><path d="m16.2 16.2 4 4"/>'),
  bag: s('<path d="M5.4 8h13.2l-1 12H6.4L5.4 8Z"/><path d="M9 8V6.4a3 3 0 0 1 6 0V8"/>'),
  info: s('<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.4"/><circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none"/>'),
  arrowRight: s('<path d="M4 12h15"/><path d="m13.4 6.4 5.6 5.6-5.6 5.6"/>'),
  arrowUpRight: s('<path d="M7 17 17 7"/><path d="M8.6 7H17v8.4"/>'),
  arrowLeft: s('<path d="M20 12H5"/><path d="m10.6 6.4-5.6 5.6 5.6 5.6"/>'),
  plus: s('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  close: s('<path d="m6 6 12 12"/><path d="m18 6-12 12"/>'),
  chevronLeft: s('<path d="m14.5 5.5-6 6.5 6 6.5"/>'),
  chevronRight: s('<path d="m9.5 5.5 6 6.5-6 6.5"/>'),
  chevronDown: s('<path d="m5.5 9.5 6.5 6 6.5-6"/>'),
  check: s('<path d="m4.8 12.6 4.6 4.6L19.4 7"/>'),
  checkCircle: s('<circle cx="12" cy="12" r="8.4"/><path d="m8.4 12.3 2.5 2.4 4.7-5"/>'),
  filter: s('<path d="M4 7.5h16"/><path d="M7 12h10"/><path d="M10 16.5h4"/>'),
  sort: s('<path d="M7 4.5v15"/><path d="m3.6 16 3.4 3.5L10.4 16"/><path d="M17 19.5v-15"/><path d="m13.6 8 3.4-3.5L20.4 8"/>'),
  warning: s('<path d="M12 4.5 21 20H3L12 4.5Z"/><path d="M12 10v4.4"/><circle cx="12" cy="17.2" r="0.85" fill="currentColor" stroke="none"/>'),
  mail: s('<rect x="3.4" y="5.6" width="17.2" height="12.8" rx="2.6"/><path d="m4.6 8 6.2 4.6a2 2 0 0 0 2.4 0L19.4 8"/>'),
  phone: s('<path d="M6.4 3.8h2.8l1.5 3.7-2 1.4a11 11 0 0 0 5.4 5.4l1.4-2 3.7 1.5v2.8a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 4.4 6a2 2 0 0 1 2-2.2Z"/>'),
  pin: s('<path d="M12 21s6.5-6.1 6.5-11a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/>'),
  clock: s('<circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3 1.8"/>'),
  instagram: s('<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.8"/><circle cx="12" cy="12" r="4"/><circle cx="17.1" cy="6.9" r="0.9" fill="currentColor" stroke="none"/>'),
  telegram: s('<path d="M20.6 4.3 2.9 10.9l5 1.8 1.8 5.3 2.7-3.1 3.8 2.7 4.4-13.3Z"/><path d="m7.9 12.7 9.4-6.4-6.4 7.4"/>'),
  whatsapp: s('<path d="M20 11.6a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.6Z"/><path d="M9 9.2c0 3.2 2.6 5.8 5.8 5.8l.9-1.6-1.9-1-.9.9c-1-.4-1.9-1.3-2.3-2.3l.9-.9-1-1.9-1.5.9Z"/>'),
  grid: s('<rect x="4" y="4" width="6.4" height="6.4" rx="1.6"/><rect x="13.6" y="4" width="6.4" height="6.4" rx="1.6"/><rect x="4" y="13.6" width="6.4" height="6.4" rx="1.6"/><rect x="13.6" y="13.6" width="6.4" height="6.4" rx="1.6"/>'),
  sparkle: s('<path d="M12 3.6l1.9 4.9 4.9 1.9-4.9 1.9L12 17.2l-1.9-4.9-4.9-1.9 4.9-1.9L12 3.6Z"/><path d="M18.4 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>'),
  sliders: s('<path d="M5 8h9"/><circle cx="16.5" cy="8" r="2.4"/><path d="M19 16h-9"/><circle cx="7.5" cy="16" r="2.4"/>'),
  truck: s('<path d="M3.6 7.4h9.2v8.8H3.6z"/><path d="M12.8 10.6h3.6l3 3v2.6h-6.6z"/><circle cx="7" cy="17.8" r="1.7"/><circle cx="16.6" cy="17.8" r="1.7"/>'),
  shield: s('<path d="M12 3.6 19 6v5.6c0 4.3-3 7-7 8.8-4-1.8-7-4.5-7-8.8V6l7-2.4Z"/><path d="m9.2 11.8 2 2 3.6-3.8"/>'),
  search: s('<circle cx="11" cy="11" r="6.6"/><path d="m16.2 16.2 4 4"/>'),
  quote: s('<path d="M4.5 6.5h15"/><path d="M4.5 12h15"/><path d="M4.5 17.5h9"/>'),
  eye: s('<path d="M2.2 12S5.8 5.5 12 5.5 21.8 12 21.8 12 18.2 18.5 12 18.5 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeOff: s('<path d="M3 3l18 18"/><path d="M10.6 10.6a2.8 2.8 0 0 0 3.9 3.9"/><path d="M9.4 5.8A9.8 9.8 0 0 1 12 5.5c6.2 0 9.8 6.5 9.8 6.5a16.8 16.8 0 0 1-3.2 4.1"/><path d="M6.2 6.3C3.8 8.1 2.2 12 2.2 12s3.6 6.5 9.8 6.5c1.5 0 2.9-.4 4.1-1"/>'),
  upload: s('<path d="M12 15.5V4.5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  trash: s('<path d="M4.5 7h15"/><path d="M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7"/><path d="m6.8 7 .8 12.2c0 .9.8 1.6 1.7 1.6h5.4c.9 0 1.6-.7 1.7-1.6L17.2 7"/>'),
  edit: s('<path d="M15.8 4.6a2.1 2.1 0 0 1 3 3L8.2 18.2l-4 .9.9-4L15.8 4.6Z"/>'),
  lock: s('<rect x="5" y="11" width="14" height="9.5" rx="2.2"/><path d="M8 11V7.8a4 4 0 0 1 8 0V11"/>'),
  globe: s('<circle cx="12" cy="12" r="8.6"/><path d="M3.6 12h16.8"/><path d="M12 3.4a13 13 0 0 1 0 17.2"/><path d="M12 3.4a13 13 0 0 0 0 17.2"/>'),
  refresh: s('<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>'),
};

export const icon = (name) => icons[name] || "";
