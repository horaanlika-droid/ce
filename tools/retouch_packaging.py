#!/usr/bin/env python3
"""Cocktail Embassy — new packaging photography, re-staged on the master black.

The owner's November 2026 shoot (`brand-source/photos-2026-11/`) is the real
product: aluminium essence bottles with the printed label, and the matte black
eco-straw sleeve. They were photographed in a bright room on a grey table, so
they cannot go into the catalogue as they are — the app is a black room and any
grey rectangle behind the pack reads as a box.

This script changes the *stage*, never the product:

    room     the light of the room (table, haze, the pool behind the pack) is
             modelled as a smooth field measured *around* the pack — a normalised
             convolution, so the pack's own pixels never vote — and subtracted.
             The pack keeps its ink, foil, fruit print and shading exactly as shot;
             the room falls to true black (#000000)
    frame    4:5 at 1200×1500, as every other packaging plate; the pack is 70 %
             of the frame height, the contact line at 85.5 %, nothing cropped
    stage    a mirrored reflection under the contact line, as on the glass plates
    glow     a controlled silver bloom taken only from the pack's own highlights

    python3 tools/retouch_packaging.py            # write packaging/*/photo.webp
    python3 tools/retouch_packaging.py --preview  # contact sheet, writes nothing
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand-source" / "photos-2026-11"
PACK = ROOT / "packaging"
ASSETS = ROOT / "assets" / "packaging"

TARGET = (1200, 1500)
PIECE_H = 0.700          # pack / frame height
BASE_Y = 0.855           # contact line, fraction of frame height
ROOM_SIGMA = 0.16        # reach of the room model, fraction of the frame height
FLOOR = 1.4              # residual below this is clipped to black
REFLECTION = 0.42        # opacity of the mirrored reflection
GLOW = 0.40              # halo strength (matte packs, so this stays quiet)
LIFT = 1.0               # exposure of the product itself

# the straw sleeve is shot against a much lighter table, so its stage needs a
# deeper cut; both numbers were measured on the frames, not guessed
SLUG_TUNING = {
    "eco-straw-sugar-cane": {"lift": 1.35},
    "eco-straw-coffee": {"lift": 1.25},
}


@dataclass
class Shot:
    src: str                  # file in brand-source/photos-2026-11
    slug: str                 # packaging/<slug>/
    box: tuple | None = None  # manual silhouette (x0, y0, x1, y1) in frame fractions


SHOTS: list[Shot] = [
    # --- flavour essences: the aluminium bottles ---------------------------
    Shot("IMG_1809.png", "essence-blackcurrant"),
    Shot("IMG_1810.png", "essence-strawberry"),
    Shot("IMG_1811.png", "essence-vanilla"),
    Shot("IMG_1812.png", "essence-peach"),
    Shot("IMG_1817.png", "essence-green-apple"),
    Shot("IMG_1818.png", "essence-banana"),
    Shot("IMG_1819.png", "essence-mango"),
    Shot("IMG_1820.png", "essence-raspberry"),
    Shot("IMG_1821.png", "essence-grapefruit"),
    Shot("IMG_1822.png", "essence-cherry"),
    # --- eco straws: the matte black sleeve --------------------------------
    Shot("IMG_1823.png", "eco-straw-sugar-cane", box=(0.065, 0.062, 0.900, 0.952)),
    Shot("IMG_1824.png", "eco-straw-coffee", box=(0.020, 0.070, 0.910, 1.000)),
]


# ---------------------------------------------------------------------- room
def _coarse_mask(a: np.ndarray) -> np.ndarray:
    """Rough 'this is product' mask — only tells the room model where not to look."""
    h, w, _ = a.shape
    m = max(6, int(w * 0.10))
    sides = np.concatenate([a[:, :m], a[:, w - m :]], axis=1)
    room = np.median(sides, axis=1)
    room = ndi.gaussian_filter1d(room, sigma=max(1.0, h / 240.0), axis=0, mode="nearest")

    # |difference| and not difference: the straw sleeve is *darker* than the table
    # it stands on, the bottles are lighter — one rule has to cut both
    delta = np.abs(a - room[:, None, :]).max(axis=2)
    mask = ndi.gaussian_filter(delta, 1.0) > 8
    mask = ndi.binary_closing(mask, np.ones((25, 25)))
    mask = ndi.binary_fill_holes(mask)

    labels, count = ndi.label(mask)
    if count == 0:
        return np.ones((h, w), bool)
    # the room is what touches the frame edge; the pack is the largest body that does not
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    sizes = ndi.sum(mask, labels, range(1, count + 1))
    best, best_size = 0, -1.0
    for i in range(1, count + 1):
        if i in edge:
            continue
        if sizes[i - 1] > best_size:
            best, best_size = i, float(sizes[i - 1])
    return labels == best if best else np.ones((h, w), bool)


def _room_field(a: np.ndarray, mask: np.ndarray, sigma: float) -> np.ndarray:
    """Smooth field of the room light, measured only outside the pack."""
    weight = (~mask).astype(np.float32)
    num = ndi.gaussian_filter(a * weight[..., None], (sigma, sigma, 0), mode="nearest")
    den = ndi.gaussian_filter(weight, sigma, mode="nearest")[..., None]
    return num / np.maximum(den, 1e-3)


def stage(img: Image.Image, lift: float = LIFT) -> tuple[Image.Image, np.ndarray]:
    """Subtract the room and stand the pack on true black."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    mask = _coarse_mask(a)
    room = _room_field(a, mask, sigma=max(8.0, ROOM_SIGMA * a.shape[0]))
    sub = np.clip(a - room, 0, 255) * lift
    sub = np.clip(sub - FLOOR, 0, 255)

    # whatever is left of the studio *outside* the pack goes to exact black, so a
    # faint grey rectangle can never appear around the piece on the page
    near = ndi.binary_dilation(mask, np.ones((5, 5)))
    falloff = ndi.gaussian_filter(near.astype(np.float32), sigma=max(4.0, a.shape[0] * 0.012))
    falloff = np.clip(falloff * 2.2, 0, 1)
    sub *= falloff[..., None]

    sub[sub.max(axis=2) < 1.0] = 0
    return Image.fromarray(np.clip(sub, 0, 255).astype(np.uint8), "RGB"), mask


def _silhouette(img: Image.Image, box: tuple | None) -> tuple[int, int, int, int]:
    a = np.asarray(img).astype(np.float32).max(axis=2)
    h, w = a.shape
    if box:
        x0, y0, x1, y1 = box
        return int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
    lit = ndi.gaussian_filter(a, 1.0) > 6
    lit = ndi.binary_closing(lit, np.ones((9, 9)))
    lit = ndi.binary_fill_holes(lit)
    labels, count = ndi.label(lit)
    if count:
        sizes = ndi.sum(lit, labels, range(1, count + 1))
        lit = labels == (int(np.argmax(sizes)) + 1)
    ys = np.where(lit.any(axis=1))[0]
    xs = np.where(lit.any(axis=0))[0]
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


# --------------------------------------------------------------------- frame
def compose(img: Image.Image, box: tuple | None = None) -> Image.Image:
    a = np.asarray(img).astype(np.float32)
    x0, y0, x1, y1 = _silhouette(img, box)

    pad_x = max(8, int((x1 - x0) * 0.06))
    pad_y = max(8, int((y1 - y0) * 0.03))
    tail = int((y1 - y0) * 0.30)
    crop_box = (max(0, x0 - pad_x), max(0, y0 - pad_y),
                min(a.shape[1], x1 + pad_x), min(a.shape[0], y1 + pad_y + tail))
    crop = Image.fromarray(np.clip(a[crop_box[1]:crop_box[3], crop_box[0]:crop_box[2]], 0, 255).astype(np.uint8), "RGB")

    scale = (PIECE_H * TARGET[1]) / max(1.0, (y1 - y0))
    size = (max(1, int(round(crop.width * scale))), max(1, int(round(crop.height * scale))))
    pack = crop.resize(size, Image.LANCZOS)
    body_h = int(round((y1 - y0) * scale))

    canvas = Image.new("RGB", TARGET, (0, 0, 0))
    ox = int(round(0.5 * TARGET[0] - ((x0 - crop_box[0]) + (x1 - x0) / 2.0) * scale))
    oy = int(round(BASE_Y * TARGET[1] - (y1 - crop_box[1]) * scale))

    # mirrored reflection under the contact line — shaped by the pack's own
    # silhouette, so no rectangle of studio grey can ever come back with it
    refl_h = int(body_h * 0.55)
    base = pack.crop((0, 0, pack.width, min(pack.height, body_h + 6)))
    lum = np.asarray(base.convert("L")).astype(np.float32)
    alpha = ndi.gaussian_filter((lum > 3).astype(np.float32), 1.6)
    alpha = np.clip((alpha - 0.35) / 0.5, 0, 1)
    refl = base.transpose(Image.FLIP_TOP_BOTTOM).crop((0, max(0, base.height - refl_h), base.width, base.height))
    a_flip = alpha[::-1][: refl.height][:, : refl.width]
    if refl.height:
        weights = np.linspace(1.0, 0.0, refl.height, dtype=np.float32)[:, None] ** 1.6
        mask = np.clip(a_flip * weights * REFLECTION * 0.6, 0, 1)
        layered = np.asarray(refl.convert("RGB")).astype(np.float32) * mask[..., None]
        refl = Image.fromarray(np.clip(layered, 0, 255).astype(np.uint8), "RGB").filter(ImageFilter.GaussianBlur(2.4))
        canvas.paste(refl, (ox, oy + body_h), Image.fromarray(np.clip(mask * 255, 0, 255).astype(np.uint8), "L"))

    canvas.paste(pack, (ox, oy))
    return canvas


def add_glow(img: Image.Image, strength: float = GLOW) -> Image.Image:
    """Silver bloom made only from light already in the frame."""
    a = np.asarray(img).astype(np.float32)
    lum = a.max(axis=2)
    peak = float(lum.max())
    if peak < 1.0:
        return img
    step = max(2, int(round(a.shape[1] / 400)))
    small = lum[::step, ::step]
    src = np.clip((small - 0.30 * peak) / max(1.0, 0.70 * peak), 0, 1) ** 1.8
    halo_small = ndi.gaussian_filter(src, sigma=max(2.0, 0.075 * small.shape[1])) * strength
    halo = np.asarray(
        Image.fromarray(halo_small.astype(np.float32), mode="F").resize(
            (a.shape[1], a.shape[0]), Image.BILINEAR
        )
    )
    halo = np.clip(halo, 0, 0.55)[..., None] * np.array([236.0, 240.0, 248.0], np.float32) / 255.0
    out = 255.0 - (255.0 - a) * (255.0 - halo * 255.0) / 255.0
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def build(shot: Shot) -> Image.Image:
    src = SRC / shot.src
    if not src.is_file():
        src = ROOT / shot.src
    tune = SLUG_TUNING.get(shot.slug, {})
    plate, _ = stage(Image.open(src), tune.get("lift", LIFT))
    plate = compose(plate, shot.box)
    return add_glow(plate, tune.get("glow", GLOW))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="contact sheet in /tmp, write nothing")
    ap.add_argument("--sheet", default="/tmp/pack-preview.png")
    args = ap.parse_args()

    made = []
    for shot in SHOTS:
        plate = build(shot)
        made.append((shot, plate))
        if args.preview:
            continue
        dest = PACK / shot.slug
        dest.mkdir(parents=True, exist_ok=True)
        plate.save(dest / "photo.webp", "WEBP", quality=92, method=6)
        staged = SRC / "staged"
        staged.mkdir(parents=True, exist_ok=True)
        plate.save(staged / f"{shot.src.rsplit('.', 1)[0]}-stage.png", "PNG", optimize=True)
        ASSETS.mkdir(parents=True, exist_ok=True)
        stem = {"eco-straw-sugar-cane": "sleeve-sugarcane", "eco-straw-coffee": "sleeve-coffee"}.get(
            shot.slug, shot.slug
        )
        plate.save(ASSETS / f"{stem}.webp", "WEBP", quality=92, method=6)
        plate.resize((700, 875), Image.LANCZOS).save(ASSETS / f"{stem}-sm.webp", "WEBP", quality=90, method=6)

    if args.preview:
        cols = 4
        tw, th = 300, 375
        rows = (len(made) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, rows * th), (0, 0, 0))
        for i, (shot, plate) in enumerate(made):
            sheet.paste(plate.resize((tw, th), Image.LANCZOS), ((i % cols) * tw, (i // cols) * th))
        sheet.save(args.sheet)
        print(f"preview → {args.sheet} ({len(made)} plates)")
    else:
        print(f"wrote {len(made)} packaging plates")


if __name__ == "__main__":
    main()
