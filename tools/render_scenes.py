#!/usr/bin/env python3
"""Cocktail Embassy — whole-scene raster plates.

The storefront never stacks a cut-out glass over a CSS backdrop. Every place a
piece appears — the hero, a collection tile, a product card — gets **one flat
raster image**: the navy room, its glow and the glass itself are baked into a
single WebP. The page only paints the app colour around it.

This tool renders those plates from the existing, approved glass photography
(`assets/products/`, `assets/archive/`) with the room and light of
`tools/harmonize_images.py`, so the family look is identical to the catalogue:

    assets/scenes/hero-<slug>.webp            16:9  hero, desktop
    assets/scenes/hero-<slug>-portrait.webp    3:4  hero, phones
    assets/scenes/cover-<slug>.webp           14:9  collection tiles
    assets/scenes/banner-<slug>.webp          16:9  collection / info page header

Usage:

    python3 tools/render_scenes.py --set all
    python3 tools/render_scenes.py --set hero --only martini --dry /tmp/prev
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENES = ROOT / "assets" / "scenes"

# The glass is never redrawn: these files are the approved pieces.
# slug → (source photo, is it already floating on its own glow?)
HERO = {
    "levitating-martini": ("assets/products/martini.webp", False),
    "etched-highball": ("assets/products/highball.webp", False),
    "champagne-saucer": ("assets/products/saucer.webp", False),
    "levitating-super-pony": ("assets/archive/AG0020.webp", True),
}

COVERS = {
    "levitating": ("assets/products/martini.webp", False),
    "noir": ("assets/products/rocks.webp", False),
    "signature": ("assets/products/cylinder.webp", False),
    "raw": ("assets/products/tumbler.webp", False),
}

# canvas, piece height, centre — measured against the layout in css/app.css
HERO_WIDE = ((1920, 1080), 0.30, 0.42, 0.47)
HERO_PORTRAIT = ((1080, 1440), 0.22, 0.50, 0.47)
COVER = ((1400, 900), 0.78, 0.50, 0.47)
BANNER = ((1600, 900), 0.30, 0.66, 0.47)


def load_harmonizer():
    path = Path(__file__).with_name("harmonize_images.py")
    spec = importlib.util.spec_from_file_location("harmonize_images", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["harmonize_images"] = mod
    spec.loader.exec_module(mod)
    return mod


def exposure(hi, sources: list[Path]) -> dict[str, float]:
    """One exposure for the whole set, exactly like the catalogue pass."""
    levels: dict[str, float] = {}
    for p in sources:
        try:
            I, Bc, M = hi.warp(p, (600, 750))[:3]
            D = hi.np.clip(I - Bc, 0, None) * hi.np.clip(M, 0, 1)[..., None]
            lv = float(hi.np.percentile(D[M > 0.5], 96.0)) if (M > 0.5).any() else 1.0
            levels[p.name] = max(lv, 1e-3)
        except Exception:  # noqa: BLE001
            levels[p.name] = 1.0
    med = float(hi.np.median(list(levels.values()))) if levels else 1.0
    return {k: float(hi.np.clip((med / v) ** 0.55, 0.78, 1.42)) for k, v in levels.items()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="all", choices=["hero", "covers", "banners", "all"])
    ap.add_argument("--only", default="", help="substring filter on the output slug")
    ap.add_argument("--quality", type=int, default=84)
    ap.add_argument("--dry", default="", help="write into this directory instead")
    args = ap.parse_args()

    hi = load_harmonizer()
    out = Path(args.dry) if args.dry else SCENES

    jobs: list[tuple[Path, tuple, bool, str]] = []
    if args.set in ("hero", "all"):
        for slug, (src, floating) in HERO.items():
            jobs.append((ROOT / src, HERO_WIDE, floating, f"hero-{slug}"))
            jobs.append((ROOT / src, HERO_PORTRAIT, floating, f"hero-{slug}-portrait"))
    if args.set in ("covers", "all"):
        for slug, (src, floating) in COVERS.items():
            jobs.append((ROOT / src, COVER, floating, f"cover-{slug}"))
    if args.set in ("banners", "all"):
        for slug, (src, floating) in COVERS.items():
            jobs.append((ROOT / src, BANNER, floating, f"banner-{slug}"))
    if args.only:
        jobs = [j for j in jobs if args.only in j[3]]

    # One exposure for the whole studio set, independent of --set: the source
    # photographs were graded as a family and a plate must not re-grade them
    # differently depending on which batch was rendered.
    studio = sorted((ROOT / "assets" / "products").glob("*.webp"))
    studio += [ROOT / src for src, _ in HERO.values() if "archive" in src]
    gains = exposure(hi, [p for p in studio if "-sm" not in p.name])

    for src, (canvas, piece_h, cx, cy), floating, name in jobs:
        st = hi.render(
            src,
            out,
            canvas=canvas,
            quality=args.quality,
            gain=gains.get(src.name, 1.0),
            upscale=1,
            floating=floating,
            piece_h=piece_h,
            piece_cx=cx,
            piece_cy=cy,
            thumbs=False,
            out_name=name,
        )
        print(
            f"  {name:<38} {src.name:<20} → {canvas[0]}x{canvas[1]}"
            f"  glass={piece_h:.0%}  gain={gains.get(src.name, 1.0):.2f}"
        )
        st.extra.clear()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
