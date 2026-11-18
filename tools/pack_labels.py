#!/usr/bin/env python3
"""Cocktail Embassy — packaging labels.

The packaging masters in `brand-source/navy/pack-*-blank.png` are shot clean:
matte black, navy studio, contact shadow, blurred reflection, no text. This
script prints the house label onto them, so every SKU of the line shares one
grid, one typeface and one set of margins — and nothing can be misspelled.

    python3 tools/pack_labels.py            # write assets/packaging/*
    python3 tools/pack_labels.py --preview  # contact sheet in /tmp only

Type: thin uppercase grotesque, wide tracking, warm neutral white. The printed
ink is modulated by the local shade of the surface, so the label sits *on* the
bottle instead of floating over it.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand-source" / "navy"
OUT = ROOT / "assets" / "packaging"

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
INK = np.array([250.0, 250.0, 251.0], np.float32)   # warm neutral white
MAX_ALPHA = 1.0

TARGET = (1200, 1500)      # 4:5, as the rest of assets/packaging
SMALL = (700, 875)


@dataclass
class Spec:
    """One printed SKU: which master, what it says, how big it prints."""

    asset: str                 # output basename, without extension
    master: str                # pack-*.png in brand-source/navy
    title: str                 # the name of the product
    sub: str                   # the volume / weight line
    mark: bool = True          # tiny hairline mark above the name
    y: float = 0.50            # print centre, fraction of the object height
    scale: float = 1.0         # relative type size
    quad: tuple | None = None  # perspective corners for angled packs


SPECS: list[Spec] = [
    # --- jars: acids -------------------------------------------------------
    Spec("jar-malic", "pack-jar-blank", "MALIC ACID", "1000 g"),
    Spec("jar-citric", "pack-jar-blank", "CITRIC ACID", "1000 g"),
    Spec("jar-ascorbic", "pack-jar-blank", "ASCORBIC ACID", "1000 g"),
    Spec("jar-tartaric", "pack-jar-blank", "TARTARIC ACID", "1000 g"),
    Spec("jar-agar", "pack-jar-blank", "AGAR AGAR", "1000 g"),
    # --- hydrocolloid bottle ----------------------------------------------
    Spec("bottle-pectinase", "pack-bottle-blank", "PECTINASE", "300 ml"),
    # --- flavour essences --------------------------------------------------
    *[
        Spec(f"essence-{slug}", "pack-essence-blank", name.upper(), "100 ml")
        for slug, name in [
            ("strawberry", "Strawberry"),
            ("raspberry", "Raspberry"),
            ("grapefruit", "Grapefruit"),
            ("peach", "Peach"),
            ("vanilla", "Vanilla"),
            ("cherry", "Cherry"),
            ("green-apple", "Green apple"),
            ("mango", "Mango"),
            ("banana", "Banana"),
            ("blackcurrant", "Blackcurrant"),
        ]
    ],
    # --- straw sleeves -----------------------------------------------------
    Spec("sleeve-sugarcane", "pack-sleeve-blank", "STRAWS", "SUGAR CANE", mark=False, y=0.52),
    Spec("sleeve-coffee", "pack-sleeve-blank", "STRAWS", "COFFEE", mark=False, y=0.52),
    # --- inventory box: printed on the angled front face -------------------
    Spec(
        "box-jigger",
        "pack-box-blank",
        "COCKTAIL EMBASSY",
        "JIGGER",
        y=0.50,
        scale=0.62,
        quad=((322, 390), (665, 382), (667, 915), (332, 918)),
    ),
]


# ------------------------------------------------------------------ helpers


def object_box(img: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of the black pack against the lit navy backdrop."""
    a = np.asarray(img.convert("L")).astype(np.float32)
    backdrop = np.asarray(
        img.convert("L").filter(ImageFilter.GaussianBlur(60))
    ).astype(np.float32)
    mask = (backdrop - a) > 12                     # the pack is darker than its halo
    # ignore the mirror reflection: keep the widest row upward from the bottom
    rows = mask.sum(1)
    widest = int(np.argmax(rows))
    mask[widest + 4:, :] = False
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, font, fill, tracking: float):
    """Draw uppercase text with letter-spacing, centred on x."""
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = xy[0] - total / 2
    for ch, w in zip(text, widths):
        draw.text((x, xy[1]), ch, font=font, fill=fill, anchor="lm")
        x += w + tracking
    return total


def ink_layer(size: tuple[int, int], spec: Spec, box) -> Image.Image:
    """Alpha mask of the printed block, at image scale."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    layer = Image.new("L", size, 0)
    d = ImageDraw.Draw(layer)

    cap = max(11, int(h * 0.034 * spec.scale))         # cap height of the name
    font = ImageFont.truetype(FONT, cap)
    small = ImageFont.truetype(FONT, max(8, int(cap * 0.74)))
    track = cap * 0.34
    cx = (x0 + x1) / 2
    cy = y0 + h * spec.y

    if spec.mark:
        rule_w = cap * 1.15
        d.rectangle(
            [cx - rule_w / 2, cy - cap * 2.55, cx + rule_w / 2, cy - cap * 2.55 + max(1, cap * 0.06)],
            fill=210,
        )
    tracked(d, (cx, cy), spec.title, font, 255, track)
    if spec.sub:
        tracked(d, (cx, cy + cap * 2.1), spec.sub, small, 205, cap * 0.26)
    return layer


def _homography(dst, src):
    """8 coefficients for PIL's PERSPECTIVE transform: output quad → source rect."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(dst, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.append(u)
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.append(v)
    return np.linalg.solve(np.array(rows, float), np.array(rhs, float))


def warp_to_quad(layer: Image.Image, quad) -> Image.Image:
    """Map the printed block onto an angled face of a carton."""
    box = layer.getbbox()
    if not box:
        return layer
    crop = layer.crop(box)
    w, h = crop.size
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = _homography(quad, src)
    return crop.transform(
        layer.size, Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC
    )


def shrink(quad, fx: float, fy: float):
    """Shrink a quad around its centre — leaves a paper margin on the face."""
    cx = sum(p[0] for p in quad) / 4
    cy = sum(p[1] for p in quad) / 4
    return [(cx + (x - cx) * fx, cy + (y - cy) * fy) for x, y in quad]


def print_on(blank: Image.Image, spec: Spec) -> Image.Image:
    """Composite the label onto the pack, following its local shading."""
    box = object_box(blank)
    alpha = ink_layer(blank.size, spec, box)
    if spec.quad:                                       # angled carton face
        alpha = warp_to_quad(alpha, shrink(spec.quad, 0.62, 0.34))

    lum = np.asarray(blank.convert("L")).astype(np.float32)
    shade = np.asarray(
        Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))
    ).astype(np.float32)
    shade = np.clip(shade / max(1.0, float(np.median(shade[shade > 0]))), 0.62, 1.22)

    m = (np.asarray(alpha).astype(np.float32) / 255.0)[..., None] * MAX_ALPHA
    rgb = np.asarray(blank, np.float32)
    ink = np.clip(INK[None, None, :] * shade[..., None] * 0.97, 0, 255)
    out = rgb * (1 - m) + ink * m
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def to_4x5(img: Image.Image, size=TARGET) -> Image.Image:
    """Fit the 2:3 master into 4:5 by extending the smooth backdrop sideways."""
    w, h = size
    scale = h / img.height
    core = img.resize((max(1, int(round(img.width * scale))), h), Image.LANCZOS)
    if core.width >= w:
        left = (core.width - w) // 2
        return core.crop((left, 0, left + w, h))
    pad = w - core.width
    canvas = Image.new("RGB", size)
    canvas.paste(core, (pad // 2, 0))
    # stretch the outermost columns — the backdrop is a smooth gradient
    left_col = core.crop((0, 0, 1, h)).resize((pad // 2 + 1, h))
    right_col = core.crop((core.width - 1, 0, core.width, h)).resize((pad - pad // 2 + 1, h))
    canvas.paste(left_col, (0, 0))
    canvas.paste(right_col, (w - right_col.width, 0))
    return canvas


def save(img: Image.Image, asset: str) -> None:
    master = to_4x5(img)
    master.save(OUT / f"{asset}.webp", "WEBP", quality=88, method=6)
    master.resize(SMALL, Image.LANCZOS).save(
        OUT / f"{asset}-sm.webp", "WEBP", quality=84, method=6
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="only write a contact sheet")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    cache: dict[str, Image.Image] = {}
    thumbs = []
    for spec in SPECS:
        blank = cache.setdefault(
            spec.master, Image.open(SRC / f"{spec.master}.png").convert("RGB")
        )
        plate = print_on(blank, spec)
        if not args.preview:
            save(plate, spec.asset)
        t = to_4x5(plate).resize((300, 375), Image.LANCZOS)
        thumbs.append((spec.asset, t))
        print(("preview " if args.preview else "wrote   ") + spec.asset)

    cols = 6
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 310, rows * 400), (8, 10, 16))
    d = ImageDraw.Draw(sheet)
    for i, (name, t) in enumerate(thumbs):
        x, y = (i % cols) * 310, (i // cols) * 400
        sheet.paste(t, (x + 5, y + 5))
        d.text((x + 8, y + 383), name, fill=(235, 235, 235))
    target = Path("/tmp/pack-contact.png") if args.preview else ROOT / "docs" / "pack-lineup.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target)
    print("sheet  ", target)


if __name__ == "__main__":
    main()
