#!/usr/bin/env python3
"""Cocktail Embassy — the image studio.

One set for the whole catalogue. Every photo is re-staged into the same room:

    • no floor, no cast shadow, no mirror reflection — the piece simply floats;
    • the room melts into the app background colour (#060c18), so a photo has no
      edge and sits invisibly on the page;
    • one light: a cool navy bloom behind the glass, and a bloom emitted by the
      glass itself — strong, but the glass stays crisp and readable;
    • one scale and one centre, so every card breathes at the same rhythm;
    • 4K masters (2400×3000, 7.2 MP) downsampled by the browser as needed.

The glass itself is never redrawn: the piece is carried over as the optical
difference it made in its old studio (`D = I − B`), composited onto the new
room. Silhouettes, rims and hand-etching stay pixel-identical.

    python3 tools/harmonize_images.py --set products
    python3 tools/harmonize_images.py --set all --preview --dry /tmp/prev
    python3 tools/harmonize_images.py --set products --only rocks --no-write
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
MANIFEST = ROOT / "data" / "image-audit.json"

# ------------------------------------------------------------------ the set
APP_BG = (10, 10, 10)         # deep matte black — matches IMG_1704 corners (~11)
WORK = (1200, 1800)           # 2:3 — composite space to match IMG_1704 benchmark
WORK_TYPE = (1400, 900)       # 14:9 wide covers
PREVIEW = (800, 1200)
PREVIEW_TYPE = (960, 617)
UPSCALE = 2                   # → 2400×3600 delivered masters (2:3, like IMG_1704)

PIECE_H = 0.50                # piece height, fraction of the canvas (~glass fill in IMG_1704)
PIECE_W = 0.80                # piece width cap
PIECE_CY = 0.56               # piece centre — IMG_1704 glass sits at cy≈0.56
PIECE_CX = 0.500              # piece centre — IMG_1704 glass centred cx=0.5

GLOW_MID = np.array([12.0, 12.0, 14.0], np.float32)   # nearly flat black room, barely above bg
GLOW_HOT = np.array([16.0, 17.0, 20.0], np.float32)
GLOW_HAZE = np.array([11.0, 11.0, 12.0], np.float32)
SHEEN = np.array([2.0, 1.0, 3.0], np.float32)         # thin-film violet on the rim

BLOOM_TIGHT = 3.00            # bright specular rim light off the glass (IMG_1704 p99≈245)
BLOOM_WIDE = 0.60             # soft halo around the glass, not in the background
SHARPEN = 1.20                # crisp rims, engraving and wall thickness

D_CLAMP = 400.0               # max light the piece may add to the new room (near-white speculars)
D_LF_BASE = 0.05              # soft glass body kept visible — darker body, brighter rims
D_LF_LIQUID = 0.35            # …and how much a drink keeps


# ------------------------------------------------------------------ helpers
def lum(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0 if e1 != e0 else 1e-6), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blur(a: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return a.astype(np.float32)
    if a.ndim == 2:
        return ndi.gaussian_filter(a.astype(np.float32), sigma, mode="nearest")
    out = np.empty_like(a, dtype=np.float32)
    for c in range(a.shape[2]):
        out[..., c] = ndi.gaussian_filter(a[..., c], sigma, mode="nearest")
    return out


def blur_fast(a: np.ndarray, sigma: float, scale: int = 4) -> np.ndarray:
    """Big blurs are low-frequency: run them small, return them smooth."""
    h, w = a.shape[:2]
    s = max(1, scale)
    small = a[::s, ::s]
    if small.shape[0] < 4 or small.shape[1] < 4:
        return blur(a, sigma)
    b = blur(small, max(0.5, sigma / s))
    chans = [np.asarray(Image.fromarray(np.ascontiguousarray(b[..., c]), "F").resize((w, h), Image.BILINEAR))
             for c in range(b.shape[2] if b.ndim == 3 else 1)]
    return np.stack(chans, axis=-1) if b.ndim == 3 else chans[0]


def edge_energy(img: np.ndarray) -> np.ndarray:
    y = lum(img / 255.0)
    gy, gx = np.gradient(blur(y, 1.3))
    return np.sqrt(gx ** 2 + gy ** 2)


# ------------------------------------------------------------------ matting
def piece_matte(img: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """Sharp-edge matte: the glass is all edges, the studio is all gradients."""
    h, w, _ = img.shape
    e = edge_energy(img)
    soft = e > max(0.006, float(np.percentile(e, 78.0)))
    strong = e > max(0.014, float(np.percentile(e, 96.0)))

    mask = ndi.binary_closing(soft, structure=np.ones((5, 5)))
    lab, n = ndi.label(mask)
    if n:
        sizes = ndi.sum(mask, lab, range(1, n + 1))
        best, score = 0, -1.0
        for i in range(1, n + 1):
            ys, xs = np.nonzero(lab == i)
            if xs.size < 0.0008 * h * w:
                continue
            cx, cy = xs.mean() / w, ys.mean() / h
            sc = sizes[i - 1] * (1 - 0.7 * abs(cx - 0.5)) * (1 - 0.25 * abs(cy - 0.52))
            if sc > score:
                score, best = sc, i
        near = ndi.binary_dilation(lab == best, iterations=max(3, int(w * 0.02)))
        mask = (near & mask) | (strong & ndi.binary_dilation(mask, iterations=max(6, int(w * 0.05))))

    closed = ndi.binary_closing(ndi.binary_dilation(mask, iterations=max(3, int(w * 0.006))),
                                structure=np.ones((7, 7)))
    filled = ndi.binary_fill_holes(closed)
    ys, xs = np.nonzero(filled)
    if not ys.size:
        filled[:] = False
        filled[int(h * 0.15): int(h * 0.85), int(w * 0.25): int(w * 0.75)] = True
        ys, xs = np.nonzero(filled)
    bbox = (int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max()))
    matte = ndi.binary_dilation(filled, iterations=max(2, int(w * 0.004))).astype(np.float32)
    return blur(matte, max(1.4, w * 0.0035)), bbox


def solid_silhouette(matte: np.ndarray, contact: int,
                     bbox: tuple[int, int, int, int] | None = None) -> np.ndarray:
    """Close the hollow parts of a vertical object, row by row.

    Each row above the contact line is filled between the glass's own left and
    right edge, so a bowl is as wide as its bowl, a stem as wide as its stem and
    a foot as wide as its foot — no boxes, no lost stems, no lost feet.
    """
    h, w = matte.shape
    contact = int(np.clip(contact, 1, h))
    out = np.zeros_like(matte)
    rows_done = 0
    # the glass can never be wider than its own bounding box
    x0, x1 = (bbox[0], bbox[1]) if bbox else (0, w - 1)
    cx = (x0 + x1) * 0.5
    half = max(4, (x1 - x0) * 0.52)
    lim_lo, lim_hi = int(max(0, cx - half)), int(min(w - 1, cx + half))
    for yy in range(0, contact):
        row = matte[yy] > 0.4
        if not row.any():
            continue
        # the largest contiguous run: the glass itself, not the floor line it sits on
        idx = np.flatnonzero(np.diff(np.concatenate(([0], row.astype(np.int8), [0]))))
        starts, ends = idx[0::2], idx[1::2]
        lens = ends - starts
        j = int(np.argmax(lens))
        if lens[j] < 2:
            continue
        a, b = max(starts[j], lim_lo), min(ends[j], lim_hi)
        if b - a < 2:
            continue
        out[yy, a:b] = 1.0
        rows_done += 1
    if rows_done < 4:
        return matte
    # never let the silhouette grow wider than what was actually found
    return blur(out.astype(np.float32), max(1.0, w * 0.0016))


def find_contact(img: np.ndarray, name: str, matte: np.ndarray) -> tuple[int, str]:
    """Where the piece meets its old floor.

    Everything below this line — floor, contact shadow, mirror reflection — has
    to go. The line is found by mirror symmetry of *structure* (not of the soft
    studio glow), constrained around the audited value in data/image-audit.json.
    """
    h, w, _ = img.shape
    prior = None
    try:
        man = json.loads(MANIFEST.read_text())
        for group in ("products", "editorial", "archive", "packaging", "covers"):
            frac = man.get(group, {}).get(name)
            if frac:
                prior = int(round(frac * h))
                break
    except Exception:  # noqa: BLE001
        pass

    y = lum(img / 255.0)
    hp = y - blur(y, 9.0)
    hp = hp / max(float(hp.std()), 1e-4)

    cols = np.nonzero(matte.max(axis=0) > 0.5)[0]
    if cols.size < 6:
        cols = np.arange(int(w * 0.2), int(w * 0.8))

    lo = int(prior * 0.92) if prior else int(h * 0.55)
    hi = int(prior * 1.08) if prior else int(h * 0.97)
    lo, hi = max(int(h * 0.40), lo), min(h - 2, hi)
    if hi <= lo:
        lo, hi = max(int(h * 0.40), int(h * 0.55)), h - 2

    if prior is not None:
        # the audited value was read off the pictures by eye: trust it, and only
        # nudge it when the mirror evidence is overwhelming
        best, best_score = prior, -1e9
    else:
        best, best_score = int(h * 0.78), -1e9
    best_score = -1e9
    band = max(18, int(h * 0.07))
    for cy in range(lo, hi):
        k = min(band, cy, h - cy - 1)
        if k < 10:
            continue
        up = hp[cy - k: cy][:, cols][::-1].ravel()
        dn = hp[cy: cy + k][:, cols].ravel()
        a, b = up - up.mean(), dn - dn.mean()
        den = float(np.sqrt((a * a).sum()) * np.sqrt((b * b).sum()))
        if den < 1e-6:
            continue
        score = float((a * b).sum() / den)
        score += 0.12 * float(np.clip(y[max(0, cy - k): cy][:, cols].mean()
                                      - y[cy: cy + k][:, cols].mean(), 0, 0.05))
        if prior:
            score -= 1.20 * abs(cy - prior) / max(1.0, 0.05 * h)
        if score > best_score:
            best_score, best = score, cy
    if prior is not None:
        return int(prior), "manifest"
    if best_score < 0.35:                     # no readable reflection: use the piece itself
        rows = np.nonzero(matte.max(axis=1) > 0.5)[0]
        if rows.size:
            return int(rows.max()) + 1, "matte"
    return int(best), "mirror"


def source_backdrop(img: np.ndarray, matte: np.ndarray, scale: int = 4) -> np.ndarray:
    """The source's own room (glow included) — only its broad shape is needed."""
    h, w, _ = img.shape
    tw, th = max(8, w // scale), max(8, h // scale)
    small = np.stack([np.asarray(Image.fromarray(np.ascontiguousarray(img[..., c]), "F")
                                 .resize((tw, th), Image.BILINEAR)) for c in range(3)], axis=-1)
    m = np.asarray(Image.fromarray(matte, "F").resize((tw, th), Image.BILINEAR))
    wgt = 1.0 - np.clip(m * 1.15, 0, 1)
    num, den = small * wgt[..., None], wgt[..., None]
    for s in (26, 13, 7):
        num, den = blur(num, s), blur(den, s)
    B = num / np.maximum(den, 1e-4)
    chans = [np.asarray(Image.fromarray(np.ascontiguousarray(B[..., c]), "F").resize((w, h), Image.BILINEAR))
             for c in range(3)]
    return np.clip(np.stack(chans, axis=-1), 0, 255)


# -------------------------------------------------------------------- the set
_ROOM: dict[tuple[int, int], np.ndarray] = {}


def room(h: int, w: int) -> np.ndarray:
    """The room. One function, one palette, identical at every size (cached)."""
    key = (h, w)
    if key in _ROOM:
        return _ROOM[key]

    bg = np.array(APP_BG, np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w * 0.5, h * 0.455
    r = np.sqrt(((xx - cx) / (w * 0.40)) ** 2 + ((yy - cy) / (h * 0.47)) ** 2)

    g = np.exp(-((r * 1.45) ** 2))
    core = np.exp(-((r * 3.25) ** 2))
    haze = np.exp(-((r * 0.72) ** 2))
    rim = np.exp(-(((r - 0.92) / 0.24) ** 2))

    col = bg + (GLOW_MID - bg) * np.clip(g, 0, 1)[..., None]
    col += (GLOW_HOT - bg) * np.clip(core * 0.85, 0, 1)[..., None]
    col += (GLOW_HAZE - bg) * np.clip(haze * 0.72, 0, 1)[..., None]
    col += rim[..., None] * SHEEN

    # die into the app colour before the frame edge: the photo has no border
    win = smoothstep(1.34, 0.86, r)
    col = bg + (col - bg) * win[..., None]
    col = np.clip(col, 0, 255)
    _ROOM[key] = col
    return col


def bloom(canvas: np.ndarray, piece: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """Glow from the glass itself: its rim lines, etched dots and highlights."""
    hp = np.clip(piece - blur(piece, 5.0), 0, 255) * keep[..., None]
    # only the strongest structure blooms: rims, etched dots, specular streaks.
    # the body of the glass must stay clear.
    inside = keep > 0.5
    thr = float(np.percentile(hp[inside], 88.0)) if inside.any() else 1.0
    hi = np.clip(hp - max(thr, 1.0), 0, None) ** 1.15
    tight = blur_fast(hi, 20)
    wide = blur_fast(hi, 74)
    tint = np.array([0.92, 0.98, 1.0], np.float32)
    return np.clip(canvas + (tight * BLOOM_TIGHT + wide * BLOOM_WIDE) * tint, 0, 255)


# ------------------------------------------------------------------ pipeline
@dataclass
class Stats:
    name: str
    src: tuple[int, int]
    contact: int
    contact_src: str
    scale: float
    canvas: tuple[int, int]
    extra: dict = field(default_factory=dict)


def warp(path: Path, canvas: tuple[int, int], floating: bool = False,
         piece_h: float = PIECE_H, piece_cx: float = PIECE_CX,
         piece_cy: float = PIECE_CY):
    src = Image.open(path).convert("RGB")
    img = np.asarray(src, dtype=np.float32)
    h, w, _ = img.shape

    matte, (x0, x1, y0, y1) = piece_matte(img)
    if floating:
        # archive plates already float on their own glow: there is no floor to cut.
        # The silhouette does the rest — the piece is carried, its glow is not.
        contact, cs = min(h - 1, y1 + 1), "floating"
    else:
        contact, cs = find_contact(img, path.name, matte)

    # the plate's horizon is a *thin, wide* line where the table meets the air,
    # and it rides right past the foot. In the contact band keep only shapes
    # that survive a horizontal erosion — a foot does, a horizon line does not.
    hh = int(h)
    b0 = max(0, int(contact - hh * 0.075))
    b1 = min(hh, int(contact + hh * 0.022))
    if b1 - b0 > 6:
        k = max(6, int(w * 0.055))
        band = matte[b0:b1] > 0.40
        thick = ndi.binary_opening(band, structure=np.ones((1, k)))
        keep_band = ndi.binary_dilation(thick, np.ones((3, 3)), iterations=2)
        new_matte = matte.copy()
        new_matte[b0:b1] = np.where(keep_band, matte[b0:b1], 0.0)
        if (new_matte[b0:b1] > 0.4).sum() > 0.25 * band.sum():
            matte = new_matte

    # the plate's horizon runs the full width of the frame: the piece is what
    # carries column mass *above* the contact, a table edge does not. Clip the
    # matte to the piece's own columns so no full-width line can survive.
    above = matte[: max(4, contact - int(h * 0.06))]
    cmass = above.sum(axis=0)
    ccols = np.nonzero(cmass > max(2.0, cmass.max() * 0.12))[0]
    if ccols.size > 4:
        pad_x = max(2, int(w * 0.012))
        matte = matte.copy()
        lo_c, hi_c = max(0, int(ccols[0]) - pad_x), min(w - 1, int(ccols[-1]) + pad_x)
        matte[:, :lo_c] = 0.0
        matte[:, hi_c + 1:] = 0.0
        ys, xs = np.nonzero(matte > 0.25)
        if ys.size:
            x0, x1 = int(xs.min()), int(xs.max())
            y0, y1 = int(ys.min()), int(ys.max())

    outline = matte.copy()
    outline[contact + 1:] = 0.0
    body = solid_silhouette(matte, contact, (x0, x1, y0, y1))
    body[contact + 1:] = 0.0
    B = source_backdrop(img, body)

    CW, CH = canvas
    gw, gh = max(1, x1 - x0 + 1), max(1, y1 - y0 + 1)
    scale = min((piece_h * CH) / gh, (PIECE_W * CW) / gw)

    left = (x0 + x1) / 2 - (piece_cx * CW) / scale
    top = (y0 + y1) / 2 - (piece_cy * CH) / scale
    pad = int(max(8, min(w, h) * 0.10))
    img_p = np.pad(img, ((pad, pad), (pad, pad), (0, 0)), mode="reflect")
    M_p = np.pad(outline, ((pad, pad), (pad, pad)), mode="reflect")
    F_p = np.pad(body, ((pad, pad), (pad, pad)), mode="reflect")
    B_p = np.pad(B, ((pad, pad), (pad, pad), (0, 0)), mode="edge")

    def sample(arr: np.ndarray, mode: int) -> np.ndarray:
        chans = []
        for c in range(arr.shape[2]):
            im = Image.fromarray(np.ascontiguousarray(arr[..., c]), "F").transform(
                (CW, CH), Image.AFFINE,
                (1.0 / scale, 0.0, left + pad, 0.0, 1.0 / scale, top + pad),
                resample=mode)
            chans.append(np.asarray(im, dtype=np.float32))
        return np.stack(chans, axis=-1)

    I = sample(img_p, Image.BICUBIC)
    Bc = sample(B_p, Image.BILINEAR)
    M = sample(M_p[..., None], Image.BICUBIC)[..., 0]
    F = sample(F_p[..., None], Image.BICUBIC)[..., 0]
    contact_c = (contact - top) * scale
    return I, Bc, M, F, scale, (w, h), contact_c, cs


def render(path: Path, out_dir: Path | None, canvas: tuple[int, int] = WORK,
           quality: int = 88, gain: float = 1.0, upscale: int = UPSCALE,
           floating: bool = False, piece_h: float = PIECE_H,
           piece_cx: float = PIECE_CX, piece_cy: float = PIECE_CY,
           thumbs: bool = True, out_name: str | None = None) -> Stats:
    I, Bc, M, F, scale, src_size, contact_c, cs = warp(
        path, canvas, floating, piece_h, piece_cx, piece_cy
    )
    CW, CH = canvas
    st = Stats(path.name, src_size, int(round(contact_c)), cs, scale, canvas)
    st.extra["gain"] = gain

    C = room(CH, CW)

    # rims (edges) keep their own pixels; the body only needs a soft carrier
    keep = np.clip(M * 1.25, 0, 1)
    keep = np.minimum(keep, blur(keep, 2.0) * 1.5)          # high-frequency: the rim
    fill = np.clip(F * 1.2, 0, 1)                            # low-frequency: the body

    # ---- no floor, no shadow, no reflection: hard cut at the contact line --
    line = float(np.clip(contact_c - CH * 0.004, CH * 0.25, CH - 2))
    rows = np.arange(CH, dtype=np.float32)
    # a smooth landing, not a hard cut: the old glow above the floor melts away
    # above the contact line: full strength (the piece lives there)
    # below it: a short, soft landing, so no reflection ever survives
    fade = smoothstep(line + CH * 0.050, line - CH * 0.014, rows)
    keep = keep * fade[:, None]
    fill = fill * fade[:, None]

    # ---- the glass is its own edges, not its old studio's glow ------------
    D = I - Bc
    # row levelling: a horizon or table edge runs the whole row, the glass does
    # not. Measure it on the row's *background* columns and remove it, so the
    # line vanishes beside the piece as well as at the frame edge.
    bg = M < 0.15
    if bg.any():
        masked = np.where(bg[..., None], D, np.nan)
        with np.errstate(all="ignore"):
            flat = np.nanmedian(masked, axis=1)          # (CH, 3)
        flat = np.nan_to_num(flat, nan=0.0)
        flat[~np.isfinite(flat).all(axis=1)] = 0.0
        D = D - flat[:, None, :]
    D_lf = blur(D, 20.0)
    sat = (I.max(axis=2) - I.min(axis=2)) / np.maximum(I.max(axis=2), 1.0)
    liquid = blur(smoothstep(0.22, 0.55, sat).astype(np.float32), 9.0)[..., None]
    lf_w = D_LF_BASE + D_LF_LIQUID * liquid
    if floating:
        # the carried plate must not bring its floor shadow along
        lf_w = lf_w * 0.22
    D = (D - D_lf) * keep[..., None] + D_lf * lf_w * fill[..., None]
    # the glass only ever adds light: a negative difference is the old studio's
    # shadow, and it must never reach the new room
    D = np.clip(D, 0, D_CLAMP)
    # nothing outside the piece itself may carry light — the source's floor
    # line, contact shadow and mirror reflection all live out there.
    # floating plates are already clean, so their halo is kept whole.
    D = D * (np.ones_like(F) if floating else np.clip(F * 1.25, 0, 1))[..., None]
    if not floating:
        # around the contact line the only light allowed is the glass itself:
        # the source's table edge runs beside the foot and must not travel
        near = smoothstep(CH * 0.14, CH * 0.02, np.abs(rows - float(contact_c)))[:, None, None]
        D = D * (1 - near * (1 - np.clip(M * 3.0, 0, 1))[..., None])

    scene = C + D

    # ---- 4K crispness: unsharp on the glass, nothing else -----------------
    sharp = I + (I - blur(I, 1.6)) * SHARPEN
    sD = sharp - Bc
    sD_lf = blur(sD, 20.0)
    sD = (sD - sD_lf) * keep[..., None] + sD_lf * lf_w * fill[..., None]
    sD = sD * (np.ones_like(F) if floating else np.clip(F * 1.25, 0, 1))[..., None]
    glass = np.clip((M - 0.30) / 0.55, 0, 1) * fade[:, None]
    scene = scene * (1 - glass[..., None] * 0.85) + (C + sD) * (glass[..., None] * 0.85)
    scene = np.clip(scene, 0, 255)

    # bloom over the room, not over the glass: the halo grows, the glass stays crisp
    interior = np.clip(smoothstep(0.30, 0.85, blur(M, 3.0)), 0, 1)
    # the glow hugs the silhouette: it may not streak out sideways past the glass
    reach = np.clip(blur(np.maximum(keep, fill * 0.8), CW * 0.012) * 2.4, 0, 1)
    glow = bloom(np.zeros_like(scene), np.clip(sharp, 0, 255), np.clip(keep * 1.4, 0, 1))
    scene = np.clip(scene + glow * reach[..., None] * (1.0 - 0.72 * interior[..., None]), 0, 255)

    # ---- the background is the room, nothing else --------------------------
    # A residual table edge (the source's wall/table seam) can still ride above
    # the contact line. It runs the full row; the glass does not. Flatten it out
    # of the background only, so the piece and its bloom keep every pixel.
    bg = M < 0.12
    if bg.any():
        diff = scene - C
        with np.errstate(all="ignore"):
            flat = np.nanmedian(np.where(bg[..., None], diff, np.nan), axis=1)
        flat = np.nan_to_num(flat, nan=0.0)
        scene = scene - flat[:, None, :] * bg[..., None]

    # ---- one exposure for the family --------------------------------------
    gain = float(st.extra.get("gain", 1.0))
    bgc = np.array(APP_BG, np.float32)
    scene = np.clip(bgc + (scene - bgc) * gain, 0, 255)

    # ---- last guarantee: the frame edge is exactly the app colour ---------
    bg = np.array(APP_BG, np.float32)
    yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
    edge = smoothstep(1.28, 1.02, np.sqrt(((xx - CW * 0.5) / (CW * 0.5)) ** 2 +
                                          ((yy - CH * 0.5) / (CH * 0.5)) ** 2))
    scene = bg + (scene - bg) * edge[..., None]

    res = Image.fromarray(np.clip(scene, 0, 255).astype(np.uint8), "RGB")

    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
        master = res
        if upscale > 1:
            w2, h2 = CW * upscale, CH * upscale
            master = res.resize((w2, h2), Image.LANCZOS)
            # a whisper of structure back after the resample: edges stay crisp
            from PIL import ImageFilter
            blurry = master.filter(ImageFilter.GaussianBlur(1.1))
            master = Image.blend(master, Image.blend(master, blurry, -1.0), 0.0) if False else                 Image.fromarray(np.clip(
                    np.asarray(master, np.float32) * 1.0
                    + (np.asarray(master, np.float32) - np.asarray(blurry, np.float32)) * 0.28,
                    0, 255).astype(np.uint8), "RGB")
        name = out_name or path.stem
        master.save(out_dir / f"{name}.webp", quality=quality, method=6)
        if thumbs:
            small = res.resize((840, max(1, int(round(840 * CH / CW)))), Image.LANCZOS)
            small.save(out_dir / f"{name}-sm.webp", quality=quality, method=6)
        st.extra["out"] = str(out_dir / f"{name}.webp")
        st.extra["master"] = f"{master.width}x{master.height}"
    return st


def collect(which: str, canvas: tuple[int, int], type_canvas: tuple[int, int],
            only: str, base: Path | None = None) -> list[tuple[Path, tuple[int, int]]]:
    ASSETS = base or globals()["ASSETS"]  # noqa: N806
    jobs: list[tuple[Path, tuple[int, int]]] = []
    if which in ("products", "all"):
        jobs += [(p, canvas) for p in sorted((ASSETS / "products").glob("*.webp")) if "-sm" not in p.name]
    if which in ("editorial", "all"):
        jobs += [(p, canvas) for p in sorted((ASSETS / "editorial").glob("*.webp")) if "mesh" not in p.name]
    if which in ("archive", "all"):
        jobs += [(p, canvas) for p in sorted((ASSETS / "archive").glob("*.webp"))
                 if "card" not in p.name and "-sm" not in p.name]
    if which in ("packaging", "all"):
        jobs += [(p, canvas) for p in sorted((ASSETS / "packaging").glob("*.webp"))]
    if which in ("covers", "all"):
        jobs += [(p, type_canvas) for p in sorted((ASSETS / "archive" / "covers").glob("*.webp"))
                 if "-sm" not in p.name]
    if only:
        jobs = [j for j in jobs if only in j[0].name]
    return jobs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="products",
                    choices=["products", "editorial", "archive", "packaging", "covers", "all"])
    ap.add_argument("--dry", default="", help="write to this dir instead of assets/")
    ap.add_argument("--only", default="", help="substring filter on filenames")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--preview", action="store_true", help="small canvas, fast iteration")
    ap.add_argument("--upscale", type=int, default=UPSCALE)
    ap.add_argument("--no-write", action="store_true", help="measure only")
    ap.add_argument("--src", default="", help="read from this assets dir (default assets/)")
    ap.add_argument("--dest", default="", help="write masters into this dir (default: in place)")
    args = ap.parse_args()

    canvas = PREVIEW if args.preview else WORK
    type_canvas = PREVIEW_TYPE if args.preview else WORK_TYPE
    upscale = 1 if args.preview else args.upscale
    dry = Path(args.dry) if args.dry else None

    src_base = Path(args.src) if args.src else None
    jobs = collect(args.set, canvas, type_canvas, args.only, base=src_base)

    # ---- pass 1: measure how bright each piece sits on the new set --------
    gains: dict[str, float] = {}
    levels: dict[str, float] = {}
    if len(jobs) > 2:
        for p, c in jobs:
            c = (c[0], c[1])
            try:
                _I, _B, _M, _F, _s, _sz, _cc, _cs = warp(p, c)
                I, Bc, M = _I, _B, _M
                D = np.clip((I - Bc), 0, None) * np.clip(M, 0, 1)[..., None]
                lv = float(np.percentile(D[M > 0.5], 96.0)) if (M > 0.5).any() else 1.0
                levels[p.name] = max(lv, 1e-3)
            except Exception:  # noqa: BLE001
                levels[p.name] = 1.0
        med = float(np.median(list(levels.values())))
        for k, v in levels.items():
            gains[k] = float(np.clip((med / v) ** 0.55, 0.78, 1.42))
        print(f"  exposure: median piece level {med:.1f}   gains "
              f"{min(gains.values()):.2f}…{max(gains.values()):.2f}")

    rows = []
    for p, c in jobs:
        try:
            # deliver over the existing filenames, in place (or into --dry)
            if dry:
                dest = dry
            elif args.no_write:
                dest = None
            elif args.dest:
                dest = Path(args.dest)
            else:
                dest = p.parent
            fl = (args.set in ("archive", "covers")
                  or (args.set == "all" and p.parent.name in ("archive", "covers")))
            cov = args.set == "covers" or (args.set == "all" and p.parent.name == "covers")
            st = render(p, dest, canvas=c, quality=args.quality,
                        gain=gains.get(p.name, 1.0), upscale=upscale, floating=fl,
                        piece_h=0.78 if cov else PIECE_H)
            rows.append({**st.__dict__})
            print(f"  {p.name:<28} {st.src[0]}x{st.src[1]}  contact={st.contact} ({st.contact_src})"
                  f"  → {c[0]}x{c[1]} scale={st.scale:.2f}")
        except Exception as exc:  # noqa: BLE001
            print(f"!! {p.name}: {exc}", file=sys.stderr)
    if args.dry:
        Path(args.dry).mkdir(parents=True, exist_ok=True)
        (Path(args.dry) / "stats.json").write_text(json.dumps(rows, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
