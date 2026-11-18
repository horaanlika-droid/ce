#!/usr/bin/env python3
"""Rebuild a master from the price list itself.

For the pieces whose catalogue photograph is of a *different glass* than the one
in our price list (`docs/audit-glass.md`), the honest fix is not to reshape the
photograph — it is to use the price-list shot of the real piece and put it on the
same master stage as everything else.

The crop comes from `brand-source/navy-refs/<form>.png`, which is a cut-out of
our own price-list photograph, so the silhouette, wall thickness and base are the
catalogue's by definition. The stage is then rebuilt exactly like
`tools/master_stage.py` does for every other plate:

    silver   the navy light is neutralised to the house silver
    room     the pool of light behind the piece is lifted, the haze clipped to black
    glow     a silver halo bloomed from the piece's own highlights

    python3 tools/masters_from_pricelist.py --preview   # contact sheet only
    python3 tools/masters_from_pricelist.py             # write brand-source/black/*.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
from master_stage import (  # noqa: E402
    BLACK,
    HAZE_FLOOR,
    ROOT,
    add_glow,
    flatten_ambient,
    neutralise,
    to_master,
    to_silver,
)

REFS = ROOT / "brand-source" / "navy-refs"
CANVAS = (848, 1264)          # same canvas as every other master
LIFT_HP = 0.05       # share of the frame width: the high pass that keeps rims
LIFT_GAIN = 1.9      # rims and engraving lifted
LIFT_SOFT = 40       # px of the soft pool of light that is measured
LIFT_SOFT_CAP = 16   # ...and the cap it can never exceed — no grey cloud
LIFT_BODY = 0.20     # share of that pool kept, so the body still reads as glass
PIECE_H = 0.74                # glass height as a share of the frame
CONTACT = 0.955               # where the base meets the stage
SHARP = 1.6                   # unsharp amount for the enlargement

# catalogue slug  →  reference cut from the price list
FROM_PRICELIST = {
    "footed": "footed",
    "coupe": "coupe",
    "saucer": "saucer",
    "hurricane": "hurricane",
    "retro-asia-rocks": "retro-asia-rocks-glass",
    "rocks": "rocks",
    "tumbler": "tumbler",
    "highball": "highball",
    "bullet-chalet": "bullet-chalet-glass",
    "coupethini": "coupethini-coupethini",
    "cylinder": "cylinder",              # прозрачная стенка вместо тёмной колонны
    "goblet": "goblet",                  # чаша уже и выше, как в прайсе
    "levitating-super-pony": "levitating-super-pony",   # узкая чаша на короткой ножке
    "retro-asia-shot": "retro-asia-shot-glass",
    "retro-asia-highball": "retro-asia-highball-glass",
    "retro-asia-engraved-highball": "retro-asia-engraved-highball-glass",
    "retro-asia-engraved-rocks": "retro-asia-engraved-rocks-glass",
    "retro-asia-engraved-cocktail": "retro-asia-engraved-cocktail-glass",
    "flowers-highball": "flowers-highball-glass",
    "bullet-highball": "bullet-highball-glass",
    "bullet-rocks": "bullet-rocks-glass",
    "flowers-rocks": "flowers-rocks-glass",
}


def crop_piece(path: Path) -> Image.Image:
    """Cut the piece out of the reference sheet: no paste border, no empty canvas."""
    img = Image.open(path).convert("RGB")
    g = np.asarray(img.convert("L")).astype(np.float32)
    cs, rs = g.std(axis=0), g.std(axis=1)
    xs, ys = np.where(cs > 3)[0], np.where(rs > 3)[0]
    if len(xs) and len(ys):
        img = img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    a = np.asarray(img.convert("L")).astype(np.float32)
    m = a > np.percentile(a, 55) + 16
    m[:3, :] = m[-3:, :] = m[:, :3] = m[:, -3:] = False
    ys, xs = np.where(m)
    if not len(ys):
        return img
    pad_x, pad_y = int(0.03 * img.width), int(0.02 * img.height)
    return img.crop(
        (max(0, int(xs.min()) - pad_x), max(0, int(ys.min()) - pad_y),
         min(img.width, int(xs.max()) + pad_x), min(img.height, int(ys.max()) + pad_y))
    )


def keyed(img: Image.Image) -> Image.Image:
    """Lift the piece off whatever is left of the navy field.

    A rectangular crop would print its corners as a faint box. Instead the frame
    is turned into coverage: bright glass keeps full alpha, the remnants of the
    field fall to zero, and the transition is smooth — so the piece is the only
    thing on the master black.
    """
    a = np.asarray(img).astype(np.float32)
    lum = a.max(axis=2)
    alpha = np.clip((lum - 10.0) / 34.0, 0, 1) ** 0.85
    alpha = ndi.gaussian_filter(alpha, sigma=1.2)[..., None]
    return Image.fromarray(np.clip(a * alpha, 0, 255).astype(np.uint8))


def feathered(img: Image.Image, ramp: float = 0.06) -> Image.Image:
    """An alpha ramp on the crop's border.

    The crop is cut out of a navy field, so its last pixels are brighter than the
    master black. Without the ramp that edge would print as a faint rectangle
    around the piece; with it, the plate melts into the room.
    """
    w, h = img.size
    mask = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(mask)
    rx, ry = max(2, int(ramp * w)), max(2, int(ramp * h))
    # a smooth ellipse-ish falloff: draw a smaller white box and blur it
    draw.rectangle([rx, ry, w - rx, h - ry], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(max(6, int(0.035 * min(w, h)))))
    out = Image.new("RGB", (w, h), (0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def _paste_rect(g: np.ndarray) -> tuple[int, int, int, int]:
    """The photo is pasted onto a flat canvas — find the actual photograph."""
    cs, rs = g.std(axis=0), g.std(axis=1)
    xs, ys = np.where(cs > 3)[0], np.where(rs > 3)[0]
    if not len(xs) or not len(ys):
        return 0, 0, g.shape[1], g.shape[0]
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def lift(img: Image.Image) -> Image.Image:
    """Rebuild the stage of a price-list crop.

    The crop is our own photograph of the piece, so nothing is redrawn — only the
    light changes. Photometric steps only:

    * the navy studio light is neutralised to the house silver (`to_silver`);
    * the field is measured on the ring of the actual photograph and taken out as
      a level, so it cannot print as a pale box around the piece;
    * everything broad and soft — the lamp pool behind the glass, the veil inside
      it — is separated from the rims with a high pass. The rims, the wall and the
      engraving are kept and lifted; the pool is capped at `LIFT_SOFT_CAP`, which
      is why no grey cloud can survive behind the glass;
    * coverage comes from the finished luminance, which removes the rectangle.

    The cap is the point: whatever is done afterwards, the widest thing left
    behind the glass is a few levels, and the room stays at `0,0,0`.
    """
    a = to_silver(np.asarray(img).astype(np.float32))
    lum = a.max(axis=2)
    x0, y0, x1, y1 = _paste_rect(np.asarray(img.convert("L")).astype(np.float32))
    band = max(4, int(0.08 * min(x1 - x0, y1 - y0)))
    ring = np.concatenate(
        [
            lum[y0 : y0 + band, x0:x1].ravel(),
            lum[y1 - band : y1, x0:x1].ravel(),
            lum[y0:y1, x0 : x0 + band].ravel(),
            lum[y0:y1, x1 - band : x1].ravel(),
        ]
    )
    field = float(np.median(ring))
    peak = float(lum[y0:y1, x0:x1].max())
    d = np.clip(a - field, 0.0, None)
    flat = d.max(axis=2)
    span = max(x1 - x0, y1 - y0)
    edges = np.clip(flat - ndi.gaussian_filter(flat, max(6.0, LIFT_HP * span)), 0.0, None)
    soft = np.minimum(ndi.gaussian_filter(flat, LIFT_SOFT), LIFT_SOFT_CAP) * LIFT_BODY

    lit = np.minimum(255.0, edges * LIFT_GAIN + soft)
    ratio = np.where(flat > 1e-3, lit / np.maximum(flat, 1e-3), 0.0)[..., None]
    a = np.clip(d * ratio, 0, 255)
    lum = a.max(axis=2)
    alpha = ndi.gaussian_filter(np.clip((lum - 6.0) / 26.0, 0, 1) ** 0.9, 1.0)[..., None]
    return Image.fromarray(np.clip(a * alpha, 0, 255).astype(np.uint8))


def stage(img: Image.Image) -> Image.Image:
    """Place the piece on the master canvas at the house scale and contact line."""
    img = lift(img)
    w, h = CANVAS
    target = int(PIECE_H * h)
    # never let a wide piece overflow the frame: height leads, width caps it
    scale = min(target / img.height, (0.88 * w) / img.width)
    piece = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)
    piece = piece.filter(ImageFilter.UnsharpMask(radius=2.2, percent=int(SHARP * 100), threshold=2))

    canvas = Image.new("RGB", CANVAS, (0, 0, 0))
    top = int(CONTACT * h) - piece.height
    canvas.paste(piece, ((w - piece.width) // 2, max(0, top)))
    return canvas


def pass_stage(img: Image.Image) -> Image.Image:
    """The stage is already rebuilt by `lift`; here the piece only gets its halo."""
    a = np.asarray(img).astype(np.float32)
    a[a.max(axis=2) < 6.0] = 0          # the room is black, not almost-black
    a = add_glow(a, strength=0.55, radius=0.10)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    thumbs = []
    for name, ref in FROM_PRICELIST.items():
        src = REFS / f"{ref}.png"
        if not src.exists():
            print("missing", src)
            continue
        out = pass_stage(stage(crop_piece(src)))
        if not args.preview:
            out.save(BLACK / f"{name}.png", "PNG", optimize=True)
        thumbs.append((name, ref, out))
        print(("preview " if args.preview else "wrote   ") + f"black/{name}.png  ← refs/{ref}.png  {out.size}")

    cols, tw, th = 5, 200, 300
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * (th + 22)), (0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    for i, (name, ref, out) in enumerate(thumbs):
        x, y = (i % cols) * tw, (i // cols) * (th + 22)
        t = out.copy()
        t.thumbnail((tw - 8, th - 8), Image.LANCZOS)
        sheet.paste(t, (x + (tw - t.width) // 2, y + (th - t.height)))
        draw.text((x + 4, y + th + 5), f"{name} ← {ref}"[:32], fill=(230, 230, 230))
    target = ROOT / ("docs/pricelist-masters.png" if not args.preview else "../tmp/pricelist-masters.png")
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target)
    print("sheet", target)


if __name__ == "__main__":
    main()
