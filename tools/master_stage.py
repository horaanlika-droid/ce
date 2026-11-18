#!/usr/bin/env python3
"""Cocktail Embassy — one master stage for every plate.

The catalogue is not a set of cut-outs. Every photograph is a full frame with the
glass standing on the same stage, and that stage is the colour of the app itself,
so a plate can be dropped anywhere on the page and no edge, seam or halo shows.

This pass does three things to a plate, and nothing else — the glass keeps its
silhouette, its engraving, its wall and its base:

    stage   the light is neutralised to silver and the backdrop is crushed to the
            master black (#000000), so the whole catalogue shares one backdrop and
            one glass tone — no blue, no teal, no per-plate cast
    room    the pool of light that used to sit behind the piece is flattened out
            and the residual haze is clipped, so the stage is deep black
    glow    a controlled silver halo is bloomed from the piece's own highlights
            and screened back around it — light that reads as the glass glowing on
            black, never as a grey cloud, and it fades to pure black at the frame
    check   corner values are printed so a stray plate is caught

    python3 tools/master_stage.py --check                 # report, change nothing
    python3 tools/master_stage.py --glob "brand-source/black/*.png"
    python3 tools/master_stage.py --glob "assets/products/*.webp" --sheet /tmp/stage.png
"""
from __future__ import annotations

import argparse
import glob
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
BLACK = ROOT / "brand-source" / "black"
MASTER_BG = (0, 0, 0)          # == --bg in css/app.css; the plate and the page are one surface
AMBIENT_CUT = 0.90             # how much of the soft pool behind the piece is removed
AMBIENT_SIGMA = 0.05           # blur used to find it, as a fraction of the frame width
DETAIL_GAIN = 1.55             # rims, engraving and edges come back brighter than they left
HAZE_FLOOR = 3.0               # residual studio haze below this is clipped to black
GLOW_STRENGTH = 1.60           # how hard the halo blooms around the piece
GLOW_RADIUS = 0.10             # halo reach, as a fraction of the frame width
GLOW_FLOOR = 0.06              # only light above this share of the peak blooms
GLOW_TINT = (232, 238, 248)    # cool silver — the stage light, never a colour


def _border_median(a: np.ndarray) -> np.ndarray:
    ring = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    return np.median(ring, axis=0)


def neutralise(a: np.ndarray) -> np.ndarray:
    """Kill the colour cast of the backdrop (the old plates read 0,2,1 — a green tint)."""
    base = _border_median(a)
    gain = np.full(3, float(base.max())) / np.maximum(base, 1.0)
    gain = np.clip(gain, 0.9, 1.1)
    return np.clip(a * gain, 0, 255)


def to_silver(a: np.ndarray) -> np.ndarray:
    """Drop the colour of the stage light: the glass is silver, the room is black.

    Colour was never part of the product — it came from the old navy backdrop
    bleeding through the glass. Luminance is kept exactly, so nothing moves and
    nothing is redrawn, only the tint of the light goes.
    """
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    return np.repeat(lum[..., None], 3, axis=2)


def flatten_ambient(a: np.ndarray, strength: float = AMBIENT_CUT, sigma: float = AMBIENT_SIGMA) -> np.ndarray:
    """Take the wide pool of light out from behind the glass — on every frame.

    The studio lit a soft grey cloud behind every piece. It is entirely low
    frequency, so it is measured with a heavy blur and subtracted from the
    luminance; the rims, engraving and edges are high frequency and are lifted
    instead of lost, so the piece still reads as bright crystal, while the room
    behind it is deep black with nothing in it.
    """
    lum = a.max(axis=2)
    veil = ndi.gaussian_filter(lum, sigma=max(8.0, sigma * a.shape[1]))
    detail = lum - veil
    lit = np.clip(detail * DETAIL_GAIN + veil * (1.0 - strength), 0, 255)
    ratio = np.where(lum > 1e-3, lit / np.maximum(lum, 1e-3), 0.0)[..., None]
    return np.clip(a * ratio, 0, 255)


def add_glow(a: np.ndarray, strength: float = GLOW_STRENGTH, radius: float = GLOW_RADIUS) -> np.ndarray:
    """Bloom a silver halo out of the piece itself.

    The halo is made only from light already in the frame — the rims, the stem, the
    engraved dots — so it traces the real silhouette. It is screened on top of the
    black stage: the black stays black, only the air next to the glass picks up a
    little light. It is computed on a small copy and scaled back, because a blur of
    that reach on a 2400 px plate is a minute of work for the same picture.
    """
    lum = a.max(axis=2)
    peak = float(lum.max())
    if peak < 1.0:
        return a

    step = max(2, int(round(a.shape[1] / 400)))
    small = lum[::step, ::step]
    src = np.clip((small - GLOW_FLOOR * peak) / max(1.0, peak * (1.0 - GLOW_FLOOR)), 0, 1) ** 1.6
    sigma = max(2.0, radius * small.shape[1])
    halo_small = ndi.gaussian_filter(src, sigma=sigma) * strength

    # the halo lives around the piece, not over it, and dies before the frame edge
    ys, xs = np.where(small > 0.16 * peak)
    cy, cx = (ys.mean() / small.shape[0], xs.mean() / small.shape[1]) if len(ys) else (0.5, 0.5)
    yy, xx = np.mgrid[0 : small.shape[0], 0 : small.shape[1]]
    halo_small *= np.exp(-(((xx / small.shape[1] - cx) / 0.46) ** 2 + ((yy / small.shape[0] - cy) / 0.46) ** 2))

    halo = np.asarray(
        Image.fromarray(np.clip(halo_small, 0, 0.85).astype(np.float32), mode="F").resize(
            (a.shape[1], a.shape[0]), Image.BILINEAR
        )
    )
    halo = halo[..., None] * np.array(GLOW_TINT, dtype=np.float32) / 255.0
    return 255.0 - (255.0 - a) * (255.0 - halo * 255.0) / 255.0


def to_master(a: np.ndarray) -> np.ndarray:
    """Crush the backdrop to the exact master black, keeping the falloff above it."""
    k = float(_border_median(a).max()) + 1.0
    out = np.clip((a - k) * (255.0 / (255.0 - k)), 0, 255)
    out[a < 1.0] = 0
    return out


def glow_only(a: np.ndarray) -> np.ndarray:
    """Add the halo to a plate whose stage is already the master black."""
    a = np.clip(a - HAZE_FLOOR, 0, 255)
    a[a.max(axis=2) < 1.0] = 0
    return add_glow(a)


def process(path: Path, write: bool, silver: bool = True, glow: bool = True, glow_only_mode: bool = False) -> dict:
    img = Image.open(path).convert("RGB")
    a = np.asarray(img).astype(np.float32)
    before = _border_median(a)
    if glow_only_mode:
        a = glow_only(a) if glow else a
        out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        if write:
            (out.save(path, "WEBP", quality=90, method=6) if path.suffix.lower() == ".webp"
             else out.save(path, "PNG", optimize=True))
        return {"path": path, "before": before, "after": _border_median(np.asarray(out).astype(np.float32)), "img": out}
    if silver:
        a = to_silver(a)
    a = neutralise(a)
    a = flatten_ambient(a)
    a = np.clip(a - HAZE_FLOOR, 0, 255)
    a[a.max(axis=2) < 1.0] = 0
    a = to_master(a)
    if glow:
        a = add_glow(a)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    after = _border_median(np.asarray(out).astype(np.float32))
    if write:
        if path.suffix.lower() == ".webp":
            out.save(path, "WEBP", quality=90, method=6)
        else:
            out.save(path, "PNG", optimize=True)
    return {"path": path, "before": before, "after": after, "img": out}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--glob", default="")
    ap.add_argument("--check", action="store_true", help="only report the backdrop of every plate")
    ap.add_argument("--sheet", default="")
    ap.add_argument("--no-silver", action="store_true", help="keep the original cast")
    ap.add_argument("--out", default="", help="copy the result here instead of rewriting in place")
    ap.add_argument("--no-glow", action="store_true", help="flat stage, no halo")
    ap.add_argument("--glow-only", action="store_true", help="stage is already the master black; just add the halo")
    args = ap.parse_args()

    pattern = args.glob or "brand-source/black/*.png"
    paths = [Path(p) for p in sorted(glob.glob(str(ROOT / pattern)))]
    if not paths:
        raise SystemExit(f"nothing matched {pattern}")

    out_dir = Path(args.out) if args.out else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in paths:
        row = process(path, write=False, silver=not args.no_silver, glow=not args.no_glow,
                      glow_only_mode=args.glow_only)
        if out_dir:
            row["img"].save(out_dir / (path.stem + ".png"), "PNG", optimize=True)
        elif not args.check:
            row = process(path, write=True, silver=not args.no_silver, glow=not args.no_glow,
                          glow_only_mode=args.glow_only)
        rows.append(row)

    for r in rows:
        mark = "ok " if max(r["after"]) <= 1 else "!! "
        print(
            f"{mark}{r['path'].relative_to(ROOT)}  backdrop "
            f"{tuple(int(v) for v in r['before'])} -> {tuple(int(v) for v in r['after'])}"
        )
    print(f"{len(rows)} plates, master stage {MASTER_BG}")

    if args.sheet:
        cols, tw, th = 5, 250, 330
        sheet_rows = (len(rows) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, sheet_rows * th), MASTER_BG)
        draw = ImageDraw.Draw(sheet)
        for i, r in enumerate(rows):
            x, y = (i % cols) * tw, (i // cols) * th
            thumb = r["img"].copy()
            thumb.thumbnail((tw - 10, th - 28), Image.LANCZOS)
            sheet.paste(thumb, (x + (tw - thumb.width) // 2, y + 6))
            draw.text((x + 8, y + th - 20), r["path"].stem[:32], fill=(235, 235, 235))
        target = Path(args.sheet)
        target.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(target)
        print("sheet", target)


if __name__ == "__main__":
    main()
