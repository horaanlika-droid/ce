#!/usr/bin/env python3
"""Cut the 10 glass silhouettes out of the price-list packshots
(brand-source/IMG_1661..IMG_1670.png, seamless white) and compose one
lineup collage on the house navy stage.

No generation: every alpha pixel is derived from the original photo, so
silhouettes stay 1:1 with the price list.

Glass-on-white extraction ("unmultiply from white"):
  1. Flat-field the shot against a per-row background estimated from the
     left/right edge strips -> kills the wall/floor gradient.
  2. Darkness D = 255 - flat luminance. Glass interior is near-white, so
     D carries exactly the glass drawing: rim, walls, stem, etching.
  3. Suppress the soft floor shadow (low frequency) with an unsharp term:
     alpha = D*0.55 + max(D - blur(D), 0)*1.5, then a global gain.
  4. Tight bbox from alpha rows/cols; bottom anchored on strong rows so
     residual shadow under the foot is trimmed.

Outputs:
  brand-source/cutouts/<name>.png          RGBA cutout per glass
  brand-source/cutouts/lineup-transparent.png  lineup on transparency
  assets/scenes/glasses-lineup-pricelist.png   lineup on navy (master)
  assets/scenes/glasses-lineup-pricelist.webp  web copy, q82

Usage: python3 tools/cut_silhouettes.py [--preview]
  --preview writes /tmp/cut-preview.png (labelled contact sheet) only.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = {
    "IMG_1661": "goblet",
    "IMG_1662": "coupe",
    "IMG_1663": "highball",
    "IMG_1664": "tumbler",
    "IMG_1665": "martini",
    "IMG_1666": "saucer",
    "IMG_1668": "footed",
    "IMG_1670": "cylinder",
    # IMG_1667 / IMG_1669 are hurricane & rocks: resolved by measured
    # bbox aspect at runtime (hurricane is the taller, narrower serve).
}
ORDER = ["martini", "goblet", "coupe", "highball", "saucer",
         "rocks", "tumbler", "footed", "hurricane", "cylinder"]

# Overall heights from the price list (data/content.json specs). The
# packshots were NOT shot from one distance, so native pixel height is
# not a truthful relative scale. The collage rescales each silhouette
# uniformly to spec height; individual cutouts stay native.
HEIGHT_MM = {"martini": 185, "goblet": 150, "coupe": 135, "highball": 155,
             "saucer": 110, "rocks": 95, "tumbler": 100, "footed": 120,
             "hurricane": 170, "cylinder": 100}
PX_PER_MM = 8.0

GAIN = 2.0          # alpha gain after unsharp mix
GLASS_RGB = (238, 244, 255)
NAVY_TOP = np.array([16, 27, 46], dtype=np.float32)     # #101B2E
NAVY_BOT = np.array([10, 18, 32], dtype=np.float32)     # #0A1220
GLOW_RGB = np.array([120, 170, 255], dtype=np.float32)


def flat_field(lum: np.ndarray) -> np.ndarray:
    """Divide out the seamless-backdrop gradient.

    Background per row = 90th percentile of the outer 5% columns on both
    sides (glass never reaches that far), smoothed over ~61 rows.
    """
    h, w = lum.shape
    strip = max(8, int(w * 0.05))
    edges = np.concatenate([lum[:, :strip], lum[:, -strip:]], axis=1)
    bg = np.percentile(edges, 90, axis=1)
    k = 61
    bg = np.convolve(np.pad(bg, k // 2, mode="edge"),
                     np.ones(k) / k, mode="valid")
    flat = lum / np.maximum(bg, 1.0)[:, None] * 255.0
    return np.clip(flat, 0, 255)


def glass_alpha(path: str) -> np.ndarray:
    lum = np.asarray(Image.open(path).convert("L"), dtype=np.float32)
    d = 255.0 - flat_field(lum)
    d_img = Image.fromarray(np.clip(d, 0, 255).astype(np.uint8))
    blur = np.asarray(d_img.filter(ImageFilter.GaussianBlur(35)),
                      dtype=np.float32)
    alpha = d * 0.55 + np.clip(d - blur, 0, None) * 1.5
    alpha = np.clip(alpha * GAIN, 0, 255)
    return alpha


def tight_bbox(alpha: np.ndarray, strong: float = 45, margin: int = 30):
    # Strong rows/cols only: faint flat-field haze spans the full frame
    # and would otherwise inflate the bbox to the whole packshot.
    rows = np.where((alpha > strong).any(axis=1))[0]
    cols = np.where((alpha > strong).any(axis=0))[0]
    top = max(0, rows.min() - margin)
    left = max(0, cols.min() - margin)
    right = min(alpha.shape[1], cols.max() + 1 + margin)
    # bottom on strong rows -> also trims the soft shadow under the foot
    bottom = min(alpha.shape[0], rows.max() + 1 + margin // 2)
    return top, bottom, left, right


def suppress_connected_background(a: np.ndarray, barrier: float = 55.0,
                                  keep: float = 0.12) -> np.ndarray:
    """Magic-wand the floor shadow away — bottom band only.

    The soft shadow in the packshot is one low-alpha blob connected to
    the crop borders; the glass interior is fenced off by its own strong
    edge lines. Flood-fill from the borders through sub-barrier pixels
    (on a 3x downscale for speed) and crush everything reached — but
    only in the bottom ~22% of the crop, where the floor lives. Higher
    up the fill can leak through faint rim lines and eat the etched
    dots and interior shading, which are legitimate glass signal.
    """
    ds = 3
    small = np.asarray(Image.fromarray(a.astype(np.uint8)).resize(
        (a.shape[1] // ds, a.shape[0] // ds), Image.BILINEAR), dtype=np.float32)
    h, w = small.shape
    blocked = small > barrier
    seen = np.zeros((h, w), dtype=bool)
    stack = [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)] + \
            [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]
    stack = [(y, x) for y, x in stack if not blocked[y, x]]
    for y, x in stack:
        seen[y, x] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] \
                    and not blocked[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    mask = Image.fromarray((seen * 255).astype(np.uint8)).resize(
        (a.shape[1], a.shape[0]), Image.BILINEAR).filter(
        ImageFilter.GaussianBlur(5))
    m = np.asarray(mask, dtype=np.float32) / 255.0
    # vertical band: 0 above the bottom 22% of the crop, 1 at the base
    H = a.shape[0]
    band = np.clip((np.arange(H, dtype=np.float32) - H * 0.78) / (H * 0.18),
                   0, 1)[:, None]
    return a * (1.0 - (1.0 - keep) * m * band * (a < barrier + 25))


def cutout(path: str) -> Image.Image:
    alpha = glass_alpha(path)
    t, b, l, r = tight_bbox(alpha)
    # Kill residual haze: subtract the pedestal measured on the crop's
    # own border (adaptive per shot), then feather alpha to zero at the
    # border so the crop rectangle can never show on the navy stage.
    a = alpha[t:b, l:r].copy()
    frame = np.concatenate([a[:6].ravel(), a[-6:].ravel(),
                            a[:, :6].ravel(), a[:, -6:].ravel()])
    pedestal = float(np.median(frame)) + 6.0
    a = np.clip((a - pedestal) * 1.12, 0, 255)
    a = suppress_connected_background(a)
    f = 12
    ramp = np.clip(np.minimum.outer(
        np.minimum(np.arange(a.shape[0]), a.shape[0] - 1 - np.arange(a.shape[0])),
        np.minimum(np.arange(a.shape[1]), a.shape[1] - 1 - np.arange(a.shape[1]))
    ) / f, 0, 1).astype(np.float32)
    a = (a * ramp).astype(np.uint8)
    h, w = a.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = GLASS_RGB
    rgba[..., 3] = a
    return Image.fromarray(rgba, "RGBA")


def resolve_pair() -> dict:
    """IMG_1667 vs IMG_1669 -> taller aspect = hurricane, wider = rocks."""
    ars = {}
    for stem in ("IMG_1667", "IMG_1669"):
        alpha = glass_alpha(f"brand-source/{stem}.png")
        t, b, l, r = tight_bbox(alpha)
        ars[stem] = (b - t) / (r - l)
        print(f"{stem}: clean bbox aspect h/w = {ars[stem]:.2f}")
    tall = max(ars, key=ars.get)
    wide = min(ars, key=ars.get)
    return {tall: "hurricane", wide: "rocks"}


def load_all() -> dict:
    names = dict(SRC)
    names.update(resolve_pair())
    cuts = {}
    for stem, name in names.items():
        print(f"cutting {stem} -> {name}")
        cuts[name] = cutout(f"brand-source/{stem}.png")
    return cuts


def scaled_to_spec(cuts: dict) -> dict:
    out = {}
    for name, im in cuts.items():
        target = int(HEIGHT_MM[name] * PX_PER_MM)
        f = target / im.height
        print(f"{name}: {im.height}px -> {target}px (x{f:.2f}, "
              f"{HEIGHT_MM[name]} mm)")
        out[name] = im.resize((max(1, int(im.width * f)), target),
                              Image.LANCZOS)
    return out


def layout(cuts: dict, gap: int = 110, pad_x: int = 180, pad_top: int = 170,
           pad_bot: int = 420):
    """Baseline-aligned single-row lineup, native 1:1 relative scale."""
    items = [(n, cuts[n]) for n in ORDER]
    max_h = max(im.height for _, im in items)
    width = pad_x * 2 + sum(im.width for _, im in items) + gap * (len(items) - 1)
    height = pad_top + max_h + pad_bot
    baseline = pad_top + max_h
    spots, x = [], pad_x
    for name, im in items:
        spots.append((name, im, x, baseline - im.height))
        x += im.width + gap
    return (width, height), baseline, spots


def glow_sprite(w: int, h: int, strength: float = 0.55) -> Image.Image:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d2 = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    a = np.clip(1.0 - d2, 0, 1) ** 1.6 * strength
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = GLOW_RGB.astype(np.uint8)
    rgba[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA").filter(ImageFilter.GaussianBlur(30))


def compose(cuts: dict) -> Image.Image:
    (W, H), baseline, spots = layout(cuts)
    # navy vertical gradient
    t = (np.arange(H, dtype=np.float32) / max(H - 1, 1))[:, None, None]
    bg = (NAVY_TOP[None, None, :] * (1 - t) + NAVY_BOT[None, None, :] * t)
    canvas = Image.fromarray(
        np.repeat(bg, W, axis=1).astype(np.uint8)).convert("RGBA")

    # per-glass radial glow halo
    for _, im, x, y in spots:
        gw, gh = int(im.width * 1.5), int(im.height * 1.25)
        canvas.alpha_composite(
            glow_sprite(gw, gh),
            (x + im.width // 2 - gw // 2, y + im.height // 2 - gh // 2))

    # floor sheen + soft elliptical shadow under each foot
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.rectangle([0, baseline, W, baseline + 3], fill=(140, 180, 255, 46))
    for _, im, x, y in spots:
        cx, rx = x + im.width // 2, int(im.width * 0.34)
        sd.ellipse([cx - rx, baseline - 14, cx + rx, baseline + 26],
                   fill=(0, 0, 0, 85))
    canvas.alpha_composite(sheen.filter(ImageFilter.GaussianBlur(14)))

    # faded mirror reflection, then the glasses themselves
    for _, im, x, y in spots:
        rh = min(int(im.height * 0.30), 300)
        refl = im.transpose(Image.FLIP_TOP_BOTTOM).crop(
            (0, im.height - rh, im.width, im.height))
        ra = np.array(refl.split()[3], dtype=np.float32)
        fade = (1 - np.arange(rh, dtype=np.float32)[:, None] / rh) * 0.28
        refl.putalpha(Image.fromarray((ra * fade).astype(np.uint8)))
        canvas.alpha_composite(
            refl.filter(ImageFilter.GaussianBlur(3)), (x, baseline + 6))
    for _, im, x, y in spots:
        canvas.alpha_composite(im, (x, y))
    return canvas


def main():
    cuts = load_all()
    stage = scaled_to_spec(cuts)
    if "--preview" in sys.argv:
        comp = compose(stage)
        comp.convert("RGB").save("/tmp/cut-preview.png")
        print("preview -> /tmp/cut-preview.png", comp.size)
        # labelled close-up sheet for QC at readable size
        th = 560
        cols = 5
        rows = (len(ORDER) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * 380, rows * (th + 26)), (13, 22, 40))
        d = ImageDraw.Draw(sheet)
        for i, name in enumerate(ORDER):
            im = cuts[name].copy()
            im.thumbnail((372, th))
            x, y = (i % cols) * 380, (i // cols) * (th + 26)
            sheet.paste(im, (x + 4, y + 4), im)
            d.text((x + 8, y + th + 4), f"{name}  {cuts[name].size}",
                   fill=(255, 220, 120))
        sheet.save("/tmp/cut-sheet.png")
        print("sheet -> /tmp/cut-sheet.png")
        return

    os.makedirs("brand-source/cutouts", exist_ok=True)
    for name, im in cuts.items():  # native pixels, unscaled
        im.save(f"brand-source/cutouts/{name}.png")

    (W, H), baseline, spots = layout(stage)
    transparent = Image.new("RGBA", (W, baseline + 60), (0, 0, 0, 0))
    for _, im, x, y in spots:
        transparent.alpha_composite(im, (x, y))
    transparent.save("brand-source/cutouts/lineup-transparent.png")

    comp = compose(stage)
    comp.save("assets/scenes/glasses-lineup-pricelist.png")
    comp.convert("RGB").save("assets/scenes/glasses-lineup-pricelist.webp",
                             quality=82)
    print("done:", comp.size)


if __name__ == "__main__":
    main()
