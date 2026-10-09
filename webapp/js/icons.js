/** Инлайновые SVG-иконки (stroke, 24px grid). */
const p = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const icons = {
  home: p('<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-9.5Z"/>'),
  grid: p('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
  bag: p('<path d="M6 8h12l-1 12a1.8 1.8 0 0 1-1.8 1.6H8.8A1.8 1.8 0 0 1 7 20L6 8Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'),
  user: p('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/>'),
  heart: p('<path d="M12 20s-7.2-4.4-9-9c-1.2-3 .8-6.6 4.2-6.6 2 0 3.6 1.2 4.8 3 1.2-1.8 2.8-3 4.8-3 3.4 0 5.4 3.6 4.2 6.6-1.8 4.6-9 9-9 9Z"/>'),
  search: p('<circle cx="11" cy="11" r="6.4"/><path d="m20 20-3.6-3.6"/>'),
  plus: p('<path d="M12 5.5v13M5.5 12h13"/>'),
  minus: p('<path d="M5.5 12h13"/>'),
  x: p('<path d="m6 6 12 12M18 6 6 18"/>'),
  chev: p('<path d="m9 5 7 7-7 7"/>'),
  back: p('<path d="m15 5-7 7 7 7"/>'),
  arrow: p('<path d="M4 12h15m-6-6 6 6-6 6"/>'),
  check: p('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  truck: p('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),
  shield: p('<path d="M12 3.5 19 6v6c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6l7-2.5Z"/>'),
  spark: p('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  drop: p('<path d="M12 3.5s6 6.6 6 10.7A6 6 0 0 1 6 14.2C6 10.1 12 3.5 12 3.5Z"/>'),
  ruler: p('<path d="M4 15 15 4l5 5L9 20l-5-5Z"/><path d="m9 10 1.5 1.5M12 7l1.5 1.5M15 4l1.5 1.5" transform="translate(0 3)"/>'),
  circle: p('<circle cx="12" cy="12" r="8"/>'),
  box: p('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/>'),
  chat: p('<path d="M4 6h16v10H9l-5 4V6Z"/>'),
  doc: p('<path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'),
  phone: p('<path d="M6 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4 5.5a2 2 0 0 1 2-2Z"/>'),
  insta: p('<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="17" cy="7" r=".9" fill="currentColor" stroke="none"/>'),
  wa: p('<path d="M12 3.8a8.2 8.2 0 0 0-7 12.4L4 20.2l4.1-1a8.2 8.2 0 1 0 3.9-15.4Z"/><path d="M9.2 9.4c.4 2.6 2.8 5 5.4 5.4l1-1.4 1.8.9c-.2 1.2-1.2 2-2.4 1.8-3.2-.5-6.1-3.4-6.6-6.6-.2-1.2.6-2.2 1.8-2.4l.9 1.8-1.9.5Z" fill="currentColor" stroke="none"/>'),
  send: p('<path d="M4 12 20 4l-4 16-4.5-6.5L4 12Z"/><path d="M11.5 13.5 20 4"/>'),
  globe: p('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5s1.3-6.1 3.8-8.5Z"/>'),
  store: p('<path d="M4 10v10h16V10"/><path d="M3 6l1.5-3h15L21 6c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3S3 7.7 3 6Z"/><path d="M10 20v-6h4v6"/>'),
  stats: p('<path d="M5 20V10M12 20V4M19 20v-7"/>'),
  logout: p('<path d="M14 4h-8v16h8M10 12h10m-3-3 3 3-3 3"/>'),
  glass: p('<path d="M7 3h10l-4 8v7M7 3l4 8M8.5 21h7"/>'),
};

export const icon = (name, cls = '') => `<span class="ic-svg ${cls}">${icons[name] || ''}</span>`;
