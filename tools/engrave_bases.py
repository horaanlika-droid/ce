#!/usr/bin/env python3
"""Cocktail Embassy — the house mark engraved in the base of every piece.

On the owner's glasses (`assets/scenes/glasses-lineup-pricelist.png`) the mark is
etched into the *top face of the base*: small cursive, lying at an angle, reading
as a thin frost line that only catches light where the etching cuts the glass. It
is not printed, not white, and never on the wall of the piece.

This pass adds that mark to the catalogue plates (`glasses/*/photo.webp`):

    1. geometry  the base line and the widest row above it are measured from the
                 plate itself, so the mark lands inside the base of every shape —
                 stemmed foot, thick-bottomed tumbler, coupe or shot
    2. plane     the text is laid on the persistent plane of that base (a shallow
                 tray, foreshortened top and bottom, skewed), then tilted, so it
                 reads like the engraving in the price list
    3. ink       the mark is *frost*, not paint: it lifts the glass a touch, gets a
                 hairline bright edge on the lower side of every stroke and fades
                 into the local tone. From arm's length the base looks clean; open
                 the card full size and the cursive is there

    python3 tools/engrave_bases.py                 # rewrite glasses/*/photo.webp
    python3 tools/engrave_bases.py --preview        # contact sheet, writes nothing
    python3 tools/engrave_bases.py --only a,b       # just these slugs
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
GLASSES = ROOT / "glasses"
FONT = ROOT / "tools" / "fonts" / "PinyonScript-Regular.ttf"

TEXT = "Art Glass"
MARK_W = 0.26         # mark width, fraction of the base's width
MARK_DX = 0.20        # shift to the right of the base centre (as on the price list)

BASE_Y = 0.716        # row of the top face of the base, as a fraction of the frame
CONTACT_Y = 0.733     # where the piece meets the stage on every plate
FALLBACK_W = 0.30     # base width used when the foot is too faint to read
MARK_UP = 0.018       # lift off the contact line onto the face of the base (x frame h)
TILT = -14.0          # degrees: the base is seen from above, the mark follows it
INK = 0.30            # how much the frost lifts the glass
GLINT = 0.55          # hairline highlight along the cut

# plates that are not one piece on its own foot: set shots, the levitating piece
# photographed in the air, and the teapot (no foot to engrave)
SKIP = {
    "coupethini-coupethini",
    "teapot-teapot",
    "two-sips-cocktail-glass",
    "levitating-super-pony",
}


def base_geometry(a: np.ndarray) -> tuple[int, int, int, int, int]:
    """Contact line, the row that carries the base, the base's ends and width.

    The stage under a piece glows and its reflection runs down into the black, so
    whole-frame brightness walks past the foot. The base is read from ONE row
    instead, just above the contact line (`CONTACT_Y`), where the top face of
    every piece is widest: the longest lit run on that row, ignoring the wall of a
    tall tumbler further out. Plates whose foot is too faint or too narrow to read
    (a thin stem only) fall back to a share of the frame width.
    """
    h, w = a.shape
    row_y = int(round(h * BASE_Y))
    row = ndi.gaussian_filter1d(a[row_y], 1.0)
    thr = max(22.0, 0.10 * float(np.percentile(a, 99.9)))
    lit = row > thr
    lit[: int(w * 0.22)] = False
    lit[int(w * 0.78):] = False

    idx = np.where(lit)[0]
    x0 = x1 = 0
    if len(idx):
        runs = np.split(idx, np.where(np.diff(idx) > 12)[0] + 1)
        run = max(runs, key=len)
        x0, x1 = int(run[0]), int(run[-1])

    foot_w = x1 - x0 if x1 - x0 >= 0.12 * w else int(FALLBACK_W * w)
    if foot_w != x1 - x0:
        x1, x0 = int(w / 2 + foot_w / 2), int(w / 2 - foot_w / 2)
    return int(round(h * CONTACT_Y)), row_y, x0, x1, foot_w


def mark_layer(mark_w: int) -> Image.Image:
    """The mark as a clean alpha plate: one line of cursive, trimmed to its ink."""
    size = max(24, int(mark_w * 0.62))
    font = ImageFont.truetype(str(FONT), size)
    pad = size
    box = font.getbbox(TEXT)
    layer = Image.new("L", (box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2), 0)
    ImageDraw.Draw(layer).text((pad - box[0], pad - box[1]), TEXT, font=font, fill=255)
    layer = layer.crop(layer.getbbox())

    # scale so the ink is exactly mark_w wide whatever the face's bearings are
    scale = mark_w / max(1, layer.width)
    if abs(scale - 1.0) > 0.02:
        layer = layer.resize((max(1, int(layer.width * scale)),
                              max(1, int(layer.height * scale))), Image.LANCZOS)
    return layer


def _homography(dst: list[tuple[float, float]], src: list[tuple[float, float]]) -> tuple[float, ...]:
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return tuple(np.linalg.solve(np.asarray(A, np.float64), np.asarray(b, np.float64)))


def _warp(layer: Image.Image, quad: list[tuple[float, float]], size: tuple[int, int]) -> Image.Image:
    src = [(0, 0), (layer.width, 0), (layer.width, layer.height), (0, layer.height)]
    coeffs = _homography(quad, src)
    out = Image.new("L", size, 0)
    out.paste(layer.transform(size, Image.PERSPECTIVE, coeffs, Image.BICUBIC))
    return out


def engrave(img: Image.Image) -> Image.Image:
    rgb = img.convert("RGB")
    a = np.asarray(rgb.convert("L")).astype(np.float32)
    h, w = a.shape

    base, row_y, x0, x1, foot_w = base_geometry(a)
    foot_w = max(40, foot_w)
    cx = (x0 + x1) / 2.0

    mark_w = int(foot_w * MARK_W)
    layer = mark_layer(mark_w)

    # the top face of the base: an ellipse whose middle is the widest row. The
    # mark sits in the right half of that face, a little above the middle — the
    # same place it holds on the price list.
    centre_y = row_y - h * MARK_UP
    centre_x = cx + foot_w * MARK_DX
    half_w, half_h = mark_w / 2.0, layer.height / 2.0

    quad = [
        (centre_x - half_w * 1.02, centre_y + half_h * 0.86),
        (centre_x + half_w * 1.02, centre_y + half_h * 0.62),
        (centre_x + half_w * 0.98, centre_y - half_h * 0.62),
        (centre_x - half_w * 0.98, centre_y - half_h * 0.86),
    ]
    alpha = _warp(layer, quad, (w, h))
    alpha = alpha.rotate(TILT, resample=Image.BICUBIC, center=(centre_x, centre_y))
    alpha = alpha.filter(ImageFilter.GaussianBlur(max(0.6, w * 0.0006)))
    ink = np.asarray(alpha).astype(np.float32) / 255.0
    if ink.max() <= 0.01:
        return rgb

    # frost: the glass inside the stroke lifts a little and picks up a hairline of
    # light where the cut edge catches the rim light — no printed white, no shadow
    body = ndi.gaussian_filter(ink, max(0.8, w * 0.0009))
    glow = ndi.gaussian_filter(ink, max(1.6, w * 0.0022))
    glint = np.clip(ndi.shift(glow, (1.8, 0.8)) - glow, 0, 1)
    local = ndi.gaussian_filter(a, max(3.0, w * 0.006))

    lifted = a + body * np.clip(local * 0.55 + 26.0, 0, 255) * INK
    lifted = lifted + glint * np.clip(local * 0.6 + 30.0, 0, 255) * GLINT
    lifted = np.clip(lifted, 0, 255)

    # keep the stage exactly as shot: only lit glass is allowed to change
    keep = (a > 2.0).astype(np.float32)
    gain = np.where(a > 1e-3, lifted / np.maximum(a, 1e-3), 1.0)
    gain = np.clip(gain, 0.7, 2.4)[..., None] * keep[..., None] + (1.0 - keep[..., None])
    out = np.clip(np.asarray(rgb).astype(np.float32) * gain, 0, 255)
    return Image.fromarray(out.astype(np.uint8), "RGB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="contact sheet, write nothing")
    ap.add_argument("--sheet", default="/tmp/engrave-preview.png")
    ap.add_argument("--only", default="", help="comma-separated slugs")
    args = ap.parse_args()

    slugs = sorted(p.name for p in GLASSES.iterdir() if p.is_dir() and p.name not in SKIP)
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        slugs = [s for s in slugs if s in wanted]

    made = []
    for slug in slugs:
        path = GLASSES / slug / "photo.webp"
        if not path.is_file():
            continue
        before = Image.open(path)
        after = engrave(before)
        made.append((slug, before, after))
        if not args.preview:
            after.save(path, "WEBP", quality=92, method=6)

    if args.preview:
        cols, tw, th = 3, 420, 420
        rows = (len(made) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, rows * th), (0, 0, 0))
        for i, (slug, before, after) in enumerate(made):
            hh, ww = after.height, after.width
            diff = np.abs(np.asarray(after, np.int16) - np.asarray(before, np.int16)).max(2)
            ys, xs = np.where(diff > 6)
            if len(xs) == 0:
                continue
            pad = int(ww * 0.035)
            crop = after.crop((max(0, xs.min() - pad), max(0, ys.min() - pad),
                               min(ww, xs.max() + pad), min(hh, ys.max() + pad)))
            crop = crop.resize((tw, int(tw * crop.height / crop.width)), Image.LANCZOS)
            sheet.paste(crop.point(lambda v: min(255, int(v * 3.0))), ((i % cols) * tw, (i // cols) * th))
        sheet.save(args.sheet)
        print(f"preview → {args.sheet} ({len(made)} plates)")
    else:
        print(f"engraved {len(made)} plates")


if __name__ == "__main__":
    main()
