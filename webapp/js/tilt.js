/**
 * Раунд 8 — tilt-параллакс: свет «плывёт» по стеклу за рукой.
 *
 * Кадр поворачивается не более чем на 2.5°, слой .rim и блюр-подложка --shot
 * уходят навстречу на 4–6 px (значения — в CSS: --tilt-deg / --tilt-shift),
 * на экране товара амплитуда ×1.5 (--tilt-k у .stage). При уходе указателя —
 * возврат за 450 мс тем же smoothstep, что и rim glow раунда 6.
 *
 * Правила, из-за которых это остаётся бесплатным для телефона:
 *  — меняются только transform/opacity (композитор), ни width/height/top;
 *  — один rAF-контроллер на все карточки, троттлинг 1 кадр;
 *  — pointermove только запоминает позицию, математика — в кадре;
 *  — prefers-reduced-motion и тач без гиро — выключено целиком.
 */

const MAX = 1;              // нормированный отклик: -1…1, дальше — клиппинг
const BACK_MS = 450;        // возврат в ноль
const EASE_MS = 90;         // сглаживание слежения за рукой (мкс-лаг кадра)
const TARGET = '.pcard, .pview .stage';
const smoothstep = (t) => t * t * (3 - 2 * t);

let raf = 0;
let last = 0;
const live = new Map();     // .pshot → { tx, ty, fx, fy, release, t0, from }

function shotOf(el) {
  return el?.querySelector?.('.pshot') || null;
}

function write(s) {
  s.el.style.setProperty('--tx', s.tx.toFixed(4));
  s.el.style.setProperty('--ty', s.ty.toFixed(4));
}

function entry(shot) {
  let s = live.get(shot);
  if (!s) {
    s = { el: shot, tx: 0, ty: 0, fx: 0, fy: 0, release: 0, t0: 0, from: [0, 0] };
    live.set(shot, s);
    shot.classList.add('tilting');
  }
  return s;
}

function frame(now) {
  const dt = Math.min(64, now - (last || now));
  last = now;
  let busy = false;

  for (const s of live.values()) {
    if (s.release) {
      const t = Math.min(1, (now - s.t0) / BACK_MS);
      const k = 1 - smoothstep(t);
      s.tx = s.from[0] * k;
      s.ty = s.from[1] * k;
      if (t >= 1) {
        s.tx = s.ty = 0;
        s.el.classList.remove('tilting');
        s.el.style.removeProperty('--tx');
        s.el.style.removeProperty('--ty');
        live.delete(s.el);
        continue;
      }
      busy = true;
    } else {
      // экспоненциальное сглаживание: рука ведёт, кадр догоняет без рывков
      const k = 1 - Math.exp(-dt / EASE_MS);
      s.tx += (s.fx - s.tx) * k;
      s.ty += (s.fy - s.ty) * k;
      busy = true;
    }
    write(s);
  }

  raf = busy ? requestAnimationFrame(frame) : 0;
}

function kick() {
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(frame);
  }
}

function release(s) {
  if (!live.has(s.el)) return;
  s.release = 1;
  s.t0 = performance.now();
  s.from = [s.tx, s.ty];
  kick();
}

/** Указатель над элементом: запоминаем цель, кадра касается только rAF. */
function point(e) {
  const host = e.target?.closest?.(TARGET);
  const shot = shotOf(host);
  if (!shot) return;
  const r = host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const s = entry(shot);
  s.release = 0;
  s.fx = Math.max(-MAX, Math.min(MAX, ((e.clientX - r.left) / r.width) * 2 - 1));
  s.fy = Math.max(-MAX, Math.min(MAX, ((e.clientY - r.top) / r.height) * 2 - 1));
  kick();
}

function away(e) {
  const shot = shotOf(e.target?.closest?.(TARGET));
  const s = shot && live.get(shot);
  if (s) release(s);
}

/** Гиро на телефоне: наклоняют корпус — свет едет по стеклу следом. */
function orient(e) {
  if (e.gamma == null || e.beta == null) return;
  const shot = document.querySelector('.pview .stage .pshot')
    || document.querySelector('.pcard .pshot');
  if (!shot) return;
  const s = entry(shot);
  s.release = 0;
  s.fx = Math.max(-MAX, Math.min(MAX, e.gamma / 22));
  s.fy = Math.max(-MAX, Math.min(MAX, (e.beta - 46) / 22));
  kick();
}

export function initTilt() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;

  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  if (fine) {
    document.addEventListener('pointermove', point, { passive: true });
    document.addEventListener('pointerleave', away, { passive: true });
    document.addEventListener('pointercancel', away, { passive: true });
    window.addEventListener('blur', () => { for (const s of live.values()) release(s); });
    return 'pointer';
  }

  // тач: наклон телефона, если гиро вообще отдаёт события (иначе — выключено)
  if (typeof DeviceOrientationEvent !== 'undefined') {
    window.addEventListener('deviceorientation', orient, { passive: true });
    return 'gyro';
  }
  return false;
}
