#!/usr/bin/env python3
"""Image audit for Cocktail Embassy.

Measures the things that have to be *identical* across the catalogue:
background tone, glow strength, framing, subject size, shadow floor, colour cast.

Usage:  python3 tools/audit_images.py [--json out.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

GROUPS = {
    "products": sorted((ASSETS / "products").glob("*.webp")),
    "editorial": sorted(
        p for p in (ASSETS / "editorial").rglob("*.webp") if "-sm" not in p.name
    ),
}


def srgb_to_lin(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.clip(x, 0, None), 1 / 2.4) - 0.055)


def lum(rgb: np.ndarray) -> np.ndarray:
    lin = srgb_to_lin(rgb / 255.0)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def analyse(path: Path) -> dict:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape
    y = lum(a)

    # --- background samples (the four corners, robust to a few stray pixels) ---
    k = max(4, min(h, w) // 24)
    corners = {
        "tl": a[:k, :k].reshape(-1, 3),
        "tr": a[:k, -k:].reshape(-1, 3),
        "bl": a[-k:, :k].reshape(-1, 3),
        "br": a[-k:, -k:].reshape(-1, 3),
    }
    corner_med = {n: np.median(c, axis=0) for n, c in corners.items()}
    edge = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]], axis=0)
    edge_med = np.median(edge, axis=0)

    # --- glow: background brightness with the subject masked out -----------------
    # The subject is anything clearly brighter than the local background.
    bg_ref = np.median(np.stack(list(corner_med.values())), axis=0)
    bg_y = float(lum(bg_ref[None, None, :])[0, 0])
    bright = y > max(bg_y + 0.10, 0.16)

    # glow = p99 of the non-subject luminance in the middle band of the frame
    band = y[int(h * 0.1) : int(h * 0.95), :]
    band_bright = bright[int(h * 0.1) : int(h * 0.95), :]
    quiet = band[~band_bright]
    glow_p99 = float(np.percentile(quiet, 99)) if quiet.size else float("nan")
    glow_p50 = float(np.percentile(quiet, 50)) if quiet.size else float("nan")

    # --- subject bounding box ---------------------------------------------------
    ys, xs = np.where(bright)
    if xs.size:
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        cx = (x0 + x1) / 2 / w
        # glass body = top 82 % of the subject (the rest is usually reflection)
        body_bottom = y0 + bh * 0.82
        subj_h_frac = (body_bottom - y0) / h
        fill = bw / w
    else:  # pragma: no cover
        cx = subj_h_frac = fill = float("nan")

    # --- floor / shadow: mean luminance of the bottom 12 % ----------------------
    floor_y = float(np.median(y[int(h * 0.88) :, :]))

    # --- colour cast of the backdrop ------------------------------------------
    r, g, b = bg_ref
    cast = {"r-b": float(r - b), "g-b": float(g - b), "sat": float((max(r, g, b) - min(r, g, b)))}

    return {
        "file": str(path.relative_to(ROOT)),
        "size": [w, h],
        "aspect": round(w / h, 4),
        "corner_rgb": [round(float(v), 1) for v in np.median(np.stack(list(corner_med.values())), axis=0)],
        "corner_spread": round(
            float(np.max([np.abs(c - bg_ref).max() for c in corner_med.values()])), 1
        ),
        "edge_rgb": [round(float(v), 1) for v in edge_med],
        "bg_lum": round(bg_y, 4),
        "glow_p99": round(glow_p99, 4),
        "glow_p50": round(glow_p50, 4),
        "subject_h": round(min(subj_h_frac, 1.0), 3),
        "subject_fill": round(fill, 3),
        "subject_cx": round(cx, 3),
        "floor_lum": round(floor_y, 4),
        **{f"cast_{k}": round(v, 1) for k, v in cast.items()},
    }


def main() -> int:
    rows = []
    for group, files in GROUPS.items():
        for f in files:
            if f.name.endswith("-sm.webp"):
                continue
            r = analyse(f)
            r["group"] = group
            rows.append(r)

    cols = ["group", "file", "size", "aspect", "corner_rgb", "corner_spread", "bg_lum",
            "glow_p99", "glow_p50", "subject_h", "subject_fill", "subject_cx", "floor_lum",
            "cast_r-b", "cast_g-b"]
    wd = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in cols}
    print(" ".join(c.ljust(wd[c]) for c in cols))
    print(" ".join("-" * wd[c] for c in cols))
    for r in rows:
        print(" ".join(str(r[c]).ljust(wd[c]) for c in cols))

    # ---- summary of spread per group ----
    print()
    for group in GROUPS:
        g = [r for r in rows if r["group"] == group]
        if len(g) < 2:
            continue
        print(f"[{group}] n={len(g)}")
        for key in ("aspect", "bg_lum", "glow_p99", "subject_h", "subject_fill",
                    "subject_cx", "floor_lum", "corner_spread"):
            vals = np.array([r[key] for r in g], dtype=float)
            print(f"  {key:<14} min={vals.min():.3f} max={vals.max():.3f} "
                  f"mean={vals.mean():.3f} sd={vals.std():.3f}")
        corner = np.array([r["corner_rgb"] for r in g], dtype=float)
        print("  corner mean    ", np.round(corner.mean(axis=0), 1),
              " max channel dev", round(float(np.abs(corner - corner.mean(axis=0)).max()), 1))

    if "--json" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--json") + 1])
        out.write_text(json.dumps(rows, indent=2))
        print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
