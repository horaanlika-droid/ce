#!/usr/bin/env python3
"""Cocktail Embassy — packaging renders.

Boxes and pouches are geometry, not photography: they are drawn here, so the
lockup, the matte paper, the foil and the light are *exactly* the same on every
packaging shot, and they inherit the same room as the catalogue (no floor, no
shadow, no reflection, background melting into #060c18).

Every render is produced at 2× and delivered as webp over the existing
filenames, so nothing in the data layer has to change.

    python3 tools/render_packaging.py            # write assets/packaging
    python3 tools/render_packaging.py --dry DIR  # preview only
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BRAND = ASSETS / "brand"
PKG = ASSETS / "packaging"

APP_BG = (6, 12, 24)
SS = 2                      # supersample factor
W, H = 1200, 1500           # delivered master (4:5)


# --------------------------------------------------------------- the room
def room(w: int, h: int) -> np.ndarray:
    """Same room as tools/harmonize_images.py: cool glow, no floor, app-colour edge."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    bg = np.array(APP_BG, np.float32)
    cx, cy = w * 0.5, h * 0.46
    r = np.sqrt(((xx - cx) / (w * 0.42)) ** 2 + ((yy - cy) / (h * 0.48)) ** 2)
    g = np.exp(-((r * 1.5) ** 2))
    core = np.exp(-((r * 3.3) ** 2))
    haze = np.exp(-((r * 0.78) ** 2))
    col = bg + (np.array([24.0, 52.0, 90.0]) - bg) * g[..., None]
    col += (np.array([64.0, 110.0, 164.0]) - bg) * (core * 0.8)[..., None]
    col += (np.array([11.0, 24.0, 46.0]) - bg) * (haze * 0.7)[..., None]
    win = np.clip((1.36 - r) / 0.5, 0, 1)
    win = win * win * (3 - 2 * win)
    col = bg + (col - bg) * win[..., None]
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8), "RGB")


def vertical_gradient(size: tuple[int, int], stops: list[tuple[float, tuple[int, int, int]]]) -> Image.Image:
    """Linear vertical gradient from (position, colour) stops."""
    w, h = size
    ys = np.arange(h, dtype=np.float32) / max(1, h - 1)
    out = np.zeros((h, 3), np.float32)
    for i in range(3):
        out[:, i] = np.interp(ys, [s[0] for s in stops], [s[1][i] for s in stops])
    img = np.repeat(out[:, None, :], w, axis=1)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")


def mask_from(size: tuple[int, int], polygon: list[tuple[int, int]], blur: float = 0.0) -> Image.Image:
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon(polygon, fill=255)
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return m


def grain(size: tuple[int, int], amount: float = 5.0, seed: int = 7) -> np.ndarray:
    """Fine paper/film grain: what separates matte card from flat vector black."""
    rng = np.random.default_rng(seed)
    n = rng.normal(0.0, amount, (size[1], size[0], 1)).astype(np.float32)
    n = ndi.gaussian_filter(n, 0.6)
    return n


def paste_masked(base: Image.Image, layer: Image.Image, mask: Image.Image) -> Image.Image:
    out = base.copy()
    out.paste(layer, (0, 0), mask)
    return out


# ------------------------------------------------------------------ logo
def chrome_mark(width: int, opacity: float = 1.0) -> Image.Image:
    """The CE arches with a chrome gradient through them."""
    mark = Image.open(BRAND / "mark-dark.png").convert("L")
    ratio = mark.height / mark.width
    hh = max(2, int(width * ratio))
    alpha = mark.resize((width, hh), Image.LANCZOS)
    grad = vertical_gradient(
        (width, hh),
        [(0.0, (255, 255, 255)), (0.30, (214, 224, 238)), (0.52, (250, 253, 255)),
         (0.72, (176, 188, 206)), (1.0, (232, 240, 250))],
    ).convert("RGB")
    if opacity < 1.0:
        alpha = alpha.point(lambda v: int(v * opacity))
    return Image.merge("RGBA", (*grad.split(), alpha))


_GLYPHS = {
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "\u2019": ["01000", "00100", "00000", "00000", "00000", "00000", "00000"],
    " ": ["00000"] * 7,
}


def text_mark(text: str, width: int, color: tuple[int, int, int] = (232, 238, 246),
              spacing: float = 0.30) -> Image.Image:
    """Any short label, letterspaced, in the same drawn face as the wordmark."""
    G = _GLYPHS
    n = max(1, len(text))
    # width = n*5*cell + (n-1)*spacing*5*cell
    cell = max(1, int(width / (n * 5 + (n - 1) * spacing * 5)))
    gw, gap = int(cell * 5), int(cell * spacing * 5)
    total_w = n * gw + (n - 1) * gap
    img = Image.new("L", (max(1, total_w), cell * 7), 0)
    d = ImageDraw.Draw(img)
    x = 0
    for ch in text.upper():
        glyph = G.get(ch, G[" "])
        for ry, row in enumerate(glyph):
            for rx, bit in enumerate(row):
                if bit == "1":
                    d.rectangle([x + rx * cell, ry * cell, x + rx * cell + cell - 1, ry * cell + cell - 1], fill=255)
        x += gw + gap
    layer = Image.new("RGB", img.size, color)
    return Image.merge("RGBA", (*layer.split(), img))


def wordmark(width: int, color: tuple[int, int, int] = (232, 238, 246), spacing: float = 0.30) -> Image.Image:
    """C O C K T A I L   E M B A S S Y — letterspaced caps, drawn by hand."""
    G = _GLYPHS
    text = "COCKTAIL EMBASSY"
    n = len(text)
    cell = max(1, int(width / (n * 5 + (n - 1) * spacing * 5)))
    gw = int(cell * 5)
    gap = int(cell * spacing * 5)
    total_w = len(text) * gw + (len(text) - 1) * gap
    img = Image.new("L", (max(1, total_w), cell * 7), 0)
    d = ImageDraw.Draw(img)
    x = 0
    for ch in text:
        glyph = G.get(ch, G[" "])
        for ry, row in enumerate(glyph):
            for rx, bit in enumerate(row):
                if bit == "1":
                    d.rectangle([x + rx * cell, ry * cell, x + rx * cell + cell - 1, ry * cell + cell - 1], fill=255)
        x += gw + gap
    img = img.resize((max(1, int(img.width * (width / max(1, img.width)))), max(1, int(img.height * (width / max(1, img.width))))), Image.LANCZOS)
    layer = Image.new("RGB", img.size, color)
    return Image.merge("RGBA", (*layer.split(), img))


# ------------------------------------------------------------------ boxes
def _quad(img: Image.Image, mask: Image.Image, poly, fill: Image.Image) -> tuple[Image.Image, Image.Image]:
    m = mask_from(img.size, poly)
    img = paste_masked(img, fill, m)
    return img, Image.composite(Image.new("L", img.size, 255), mask, m)


def mask_array(mask: Image.Image) -> np.ndarray:
    m = np.asarray(mask, np.float32) / 255.0
    return m[..., None]


def _edges(img: Image.Image, poly, color, width: int, alpha: int) -> Image.Image:
    """A rim light along a face's silhouette: what makes matte black read."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.line(list(poly) + [poly[0]], fill=(*color, alpha), width=width, joint="curve")
    core = layer.filter(ImageFilter.GaussianBlur(width * 0.8))
    return Image.alpha_composite(img.convert("RGBA"), core).convert("RGB")


def _box(size, w, h, dx, dy, front_light, side_light, top_light,
         logo: str, logo_scale: float, label: str = "",
         body_from: float = 0.30, seam: float = 0.20) -> tuple[Image.Image, Image.Image]:
    """A rigid box, standing, three-quarter view. Faces are flat fills + gradients."""
    cw, ch = size
    cx = cw * 0.5
    base = int(ch * 0.795)
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = base - h, base

    front = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    side = [(x1, y0), (x1 + dx, y0 - dy), (x1 + dx, y1 - dy), (x1, y1)]
    top = [(x0, y0), (x0 + dx, y0 - dy), (x1 + dx, y0 - dy), (x1, y0)]

    img = Image.new("RGB", size, APP_BG)
    mask = Image.new("L", size, 0)

    # top, then side, then front — painter's order
    img, mask = _quad(img, mask, top, vertical_gradient(size, [(0.0, top_light), (1.0, tuple(int(c * 0.82) for c in top_light))]))
    img, mask = _quad(img, mask, side, vertical_gradient(size, [(0.0, side_light), (1.0, tuple(int(c * 0.55) for c in side_light))]))

    fy0 = int(y0)
    fh = max(1, int(y1 - y0))
    fg = Image.new("RGB", size, front_light)
    yy = np.arange(size[1], dtype=np.float32)[:, None]
    ratio = np.clip((yy - fy0) / fh, 0, 1)
    ramp = (1.0 - 0.55 * ratio)[..., None]
    fg = Image.fromarray(np.clip(np.asarray(fg, np.float32) * ramp, 0, 255).astype(np.uint8), "RGB")
    img, mask = _quad(img, mask, front, fg)

    # paper grain
    img = Image.fromarray(np.clip(np.asarray(img, np.float32) + grain(size, 4.0) * (mask_array(mask)), 0, 255).astype(np.uint8), "RGB")

    # rim light: front edges catch the key, side edge catches the fill
    img = _edges(img, front, (128, 146, 170), max(2, int(w * 0.008)), 78)
    img = _edges(img, side, (92, 108, 130), max(2, int(h * 0.0035)), 64)
    img = _edges(img, top, (108, 126, 150), max(2, int(h * 0.0028)), 52)

    # the lid seam across the front, near the top
    sy = int(y0 + h * seam)
    seam_img = Image.new("L", size, 0)
    ImageDraw.Draw(seam_img).line([(x0 + 2, sy), (x1 - 2, sy)], fill=110, width=max(2, int(h * 0.004)))
    img = paste_masked(img, Image.new("RGB", size, (96, 110, 128)),
                       seam_img.filter(ImageFilter.GaussianBlur(max(1.0, h * 0.003))))

    # a soft sheen sweeping the front, as light does on lacquer
    sheen = Image.new("L", size, 0)
    ImageDraw.Draw(sheen).polygon([(x0, y0 + h * 0.05), (x0 + w * 0.55, y0),
                                   (x0 + w * 0.75, y0), (x0 + w * 0.20, y1),
                                   (x0, y1)], fill=26)
    img = paste_masked(img, Image.new("RGB", size, (120, 140, 168)),
                       sheen.filter(ImageFilter.GaussianBlur(w * 0.06)))

    # the lockup on the front face
    logo_w = int(w * logo_scale)
    if logo == "mark":
        art = chrome_mark(logo_w)
    elif logo == "both":
        art = chrome_mark(int(logo_w * 0.62))
        lab = text_mark("COCKTAIL EMBASSY", logo_w, (226, 232, 242))
        combo = Image.new("RGBA", (logo_w, art.height + lab.height + int(logo_w * 0.12)), (0, 0, 0, 0))
        combo.paste(art, (int((logo_w - art.width) / 2), 0), art.split()[3])
        combo.paste(lab, (0, art.height + int(logo_w * 0.12)), lab.split()[3])
        art = combo
    else:
        art = text_mark("COCKTAIL EMBASSY", logo_w, (226, 232, 242))
    ax = int(cx - art.width / 2)
    ay = int(y0 + (y1 - y0) * (0.44 if label else 0.5) - art.height * 0.5)
    img.paste(art, (ax, ay), art.split()[3])

    if label:
        sub = text_mark(label, int(w * 0.46), (168, 182, 202))
        img.paste(sub, (int(cx - sub.width / 2), int(ay + art.height + h * 0.05)), sub.split()[3])
    return img, mask


def rigid_box(w: int, h: int, depth: float, size: tuple[int, int],
              logo: str = "both", label: str = "") -> tuple[Image.Image, Image.Image]:
    return _box(size, w, h, depth * 0.62, depth * 0.36,
                (46, 53, 68), (66, 76, 94), (86, 98, 118),
                logo, 0.76, label, seam=0.16)


def long_box(size: tuple[int, int], label: str = "BAR SPOON") -> tuple[Image.Image, Image.Image]:
    """Slim presentation case for a bar spoon: tall, narrow, foil-stamped."""
    cw, ch = size
    return _box(size, int(cw * 0.220), int(ch * 0.62), int(cw * 0.044), int(ch * 0.022),
                (46, 53, 68), (66, 76, 94), (86, 98, 118),
                "mark", 0.80, label, seam=0.09)


def pouch(size: tuple[int, int], label: str) -> tuple[Image.Image, Image.Image]:
    """Stand-up zip pouch: opaque matte film, zip line, clean label panel."""
    cw, ch = size
    w = int(cw * 0.40)
    h = int(ch * 0.60)
    cx = cw * 0.5
    base = int(ch * 0.795)
    top = base - h
    r = int(w * 0.035)

    poly = [(cx - w / 2 + r, top), (cx + w / 2 - r, top),
            (cx + w / 2, top + r), (cx + w / 2, base - r),
            (cx + w / 2 - r, base), (cx - w / 2 + r, base),
            (cx - w / 2, base - r), (cx - w / 2, top + r)]

    img = Image.new("RGB", size, APP_BG)
    mask = Image.new("L", size, 0)
    m = mask_from(size, poly)

    film = vertical_gradient(size, [(0.0, (34, 40, 50)), (0.35, (24, 29, 38)),
                                    (0.80, (17, 21, 28)), (1.0, (22, 26, 34))])
    # a soft vertical highlight down the left of the film
    hl = Image.new("L", size, 0)
    x = cx - w * 0.30
    for i in range(int(w * 0.22)):
        v = int(34 * (1 - i / max(1.0, w * 0.22)) ** 1.6)
        ImageDraw.Draw(hl).line([(x + i, top + r), (x + i, base - r)], fill=v)
    film = paste_masked(film, Image.new("RGB", size, (150, 172, 200)),
                        hl.filter(ImageFilter.GaussianBlur(w * 0.03)))
    img = paste_masked(img, film, m)
    mask = Image.composite(Image.new("L", size, 255), mask, m)
    img = Image.fromarray(np.clip(np.asarray(img, np.float32) + grain(size, 4.5, 11) * mask_array(mask), 0, 255).astype(np.uint8), "RGB")
    img = _edges(img, poly, (112, 128, 150), max(2, int(w * 0.006)), 82)

    # zip lock
    zip_y = top + int(h * 0.050)
    z = Image.new("L", size, 0)
    ImageDraw.Draw(z).line([(cx - w / 2 + r + 3, zip_y), (cx + w / 2 - r - 3, zip_y)],
                           fill=150, width=max(2, int(h * 0.005)))
    img = paste_masked(img, Image.new("RGB", size, (140, 154, 174)), z.filter(ImageFilter.GaussianBlur(0.7)))

    # label panel — a hairline plate, then the lockup and the grade
    lw, lh = int(w * 0.80), int(h * 0.34)
    lx0, ly0 = int(cx - lw / 2), int(top + h * 0.26)
    panel = Image.new("L", size, 0)
    ImageDraw.Draw(panel).rectangle([lx0, ly0, lx0 + lw, ly0 + lh], outline=70, width=max(1, int(h * 0.0025)))
    img = paste_masked(img, Image.new("RGB", size, (110, 124, 142)), panel)

    mark = chrome_mark(int(lw * 0.34))
    img.paste(mark, (int(cx - mark.width / 2), int(ly0 + lh * 0.10)), mark.split()[3])

    name = label.split(" ")[0]
    grade = label.split(" ")[-1]
    a = text_mark(name, int(lw * 0.58), (234, 240, 248))
    img.paste(a, (int(cx - a.width / 2), int(ly0 + lh * 0.44)), a.split()[3])
    b = text_mark(grade, int(lw * 0.26), (150, 164, 184))
    img.paste(b, (int(cx - b.width / 2), int(ly0 + lh * 0.67)), b.split()[3])
    c = text_mark("FOOD GRADE 250 ML", int(lw * 0.44), (104, 118, 136))
    img.paste(c, (int(cx - c.width / 2), int(ly0 + lh * 0.84)), c.split()[3])
    return img, mask


def place(piece: tuple[Image.Image, Image.Image], size: tuple[int, int]) -> Image.Image:
    """Float the object on the room; its glow follows its own silhouette."""
    img, mask = piece
    base = room(*size).convert("RGB")

    small = mask.resize((size[0] // 8, size[1] // 8), Image.LANCZOS)
    glow = small.filter(ImageFilter.GaussianBlur(6)).resize(size, Image.BILINEAR)
    halo = np.asarray(glow, np.float32)[..., None] / 255.0
    arr = np.asarray(base, np.float32) + halo * np.array([70.0, 118.0, 176.0], np.float32) * 0.45
    base = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    return Image.composite(img, base, mask)


def save(img: Image.Image, path: Path, quality: int = 88) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=quality, method=6)
    sm = img.resize((700, int(round(700 * img.height / img.width))), Image.LANCZOS)
    sm.save(path.with_name(path.stem + "-sm.webp"), quality=quality, method=6)


ESSENCES = ["STRAWBERRY", "RASPBERRY", "GRAPEFRUIT", "PEACH", "VANILLA",
            "CHERRY", "GREEN APPLE", "MANGO", "BANANA", "BLACKCURRANT"]


def build_jobs(size: tuple[int, int]) -> dict:
    jobs = {
        # acids and other: the second page of the price list
        "jar-citric.webp": jar(size, "CITRIC", "ACID", "1000 G"),
        "jar-malic.webp": jar(size, "MALIC", "ACID", "1000 G"),
        "jar-ascorbic.webp": jar(size, "ASCORBIC", "ACID", "1000 G"),
        "jar-tartaric.webp": jar(size, "TARTARIC", "ACID", "1000 G"),
        "jar-agar.webp": jar(size, "AGAR", "AGAR", "1000 G", scale=1.06),
        "bottle-pectinase.webp": bottle(size, "PECTINASE", "CLARIFICATION", "300 ML"),
        "sleeve-sugarcane.webp": sleeve(size, "STRAWS", "SUGAR CANE"),
        "sleeve-coffee.webp": sleeve(size, "STRAWS", "COFFEE"),
    }
    for flavour in ESSENCES:
        slug = flavour.lower().replace(" ", "-")
        jobs["essence-%s.webp" % slug] = bottle(size, flavour, "ESSENCE", "100 ML")
    return jobs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", default="")
    ap.add_argument("--only", default="", help="substring filter on filenames")
    args = ap.parse_args()
    out = Path(args.dry) if args.dry else PKG

    size = (W * SS, H * SS)
    jobs = build_jobs(size)
    if args.only:
        jobs = {k: v for k, v in jobs.items() if args.only in k}
    for name, piece in jobs.items():
        img = place(piece, size).resize((W, H), Image.LANCZOS)
        save(img, out / name)
        print("  %-28s %dx%d" % (name, W, H))
    return 0




# ------------------------------------------------------- jars, bottles, sleeves
def _rrect(cx: float, y0: float, y1: float, w: float, r: float, steps: int = 10):
    """Rounded-rectangle polygon (chamfered corners, fine enough at 2x SS)."""
    x0, x1 = cx - w / 2, cx + w / 2
    pts = []
    for (x, y, a0) in ((x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270),
                       (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90)):
        for i in range(steps + 1):
            a = np.deg2rad(a0 + 90 * i / steps)
            pts.append((x + r * np.cos(a), y + r * np.sin(a)))
    return pts


def _shade(size, poly, top=(36, 42, 52), bottom=(17, 21, 28), lip=(24, 29, 38)):
    """Matte navy film on a cylinder: vertical gradient, soft left highlight.

    The same material as the stand-up pouches — no chrome, no gloss. The object
    is only found by its hairline edges and by the room's glow behind it.
    """
    cw, ch = size
    m = mask_from(size, poly)
    ys, xs = np.nonzero(np.asarray(m) > 8)
    if not ys.size:
        return Image.new("RGB", size, APP_BG), m
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    span = max(1, x1 - x0)
    xx = np.clip((np.arange(x0, x1 + 1) - x0) / span, 0, 1)
    yy = np.clip((np.arange(y0, y1 + 1) - y0) / max(1, y1 - y0), 0, 1)

    # across the cylinder: edges fall away, a soft sheen sits left of centre
    across = 0.55 + 0.45 * np.sin(np.pi * np.clip(xx * 0.94 + 0.03, 0, 1)) ** 1.2
    sheen = 0.20 * np.exp(-(((xx - 0.30) / 0.11) ** 2))

    # down the body: lit at the shoulder, settling into the base
    down = (np.array(bottom, np.float32)[None, :] * (1 - yy[:, None])
            + np.array(top, np.float32)[None, :] * yy[:, None])
    lift = (np.array(lip, np.float32) - np.array(bottom, np.float32)) * 0.5

    patch = down[:, None, :] * across[None, :, None] + lift[None, None, :] * sheen[None, :, None]
    band = np.zeros((ch, cw, 3), np.float32)
    band[y0:y1 + 1, x0:x1 + 1] = patch
    img = Image.fromarray(np.clip(band, 0, 255).astype(np.uint8), "RGB")

    alpha = np.asarray(m, np.float32)[..., None] / 255.0
    bg = np.array(APP_BG, np.float32)
    out = bg + (np.asarray(img, np.float32) - bg) * alpha
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB"), m


def _label(img, size, cx, y, w, h, name, grade, note):
    panel = Image.new("L", size, 0)
    ImageDraw.Draw(panel).rectangle([cx - w / 2, y, cx + w / 2, y + h], outline=64,
                                    width=max(1, int(h * 0.012)))
    img = paste_masked(img, Image.new("RGB", size, (118, 132, 150)), panel)

    mark = chrome_mark(int(w * 0.26))
    img.paste(mark, (int(cx - mark.width / 2), int(y + h * 0.10)), mark.split()[3])
    a = text_mark(name, int(w * 0.80), (238, 243, 251))
    img.paste(a, (int(cx - a.width / 2), int(y + h * 0.40)), a.split()[3])
    b = text_mark(grade, int(w * 0.42), (150, 164, 184))
    img.paste(b, (int(cx - b.width / 2), int(y + h * 0.68)), b.split()[3])
    c = text_mark(note, int(w * 0.60), (104, 118, 136))
    img.paste(c, (int(cx - c.width / 2), int(y + h * 0.83)), c.split()[3])
    return img


def jar(size, name, grade, note, scale: float = 1.0):
    """Matte cylindrical jar with a screw lid - acids and powders."""
    cw, ch = size
    w = int(cw * 0.40 * scale)
    h = int(ch * 0.50 * scale)
    cx = cw * 0.5
    base = int(ch * 0.800)
    top = base - h
    lid_h = int(h * 0.16)

    body_poly = _rrect(cx, top + lid_h, base, w, w * 0.06)
    img, m_body = _shade(size, body_poly, top=(32, 38, 48), bottom=(15, 19, 26))
    lid_poly = _rrect(cx, top, top + lid_h, w * 1.045, w * 0.05)
    lid, m_lid = _shade(size, lid_poly, top=(44, 51, 63), bottom=(30, 36, 46))
    img = Image.composite(lid, img, m_lid)

    img = _edges(img, body_poly, (112, 128, 150), max(1, int(w * 0.006)), 82)
    img = _edges(img, lid_poly, (128, 146, 170), max(1, int(w * 0.006)), 96)
    seam = Image.new("L", size, 0)
    ImageDraw.Draw(seam).line([(cx - w * 0.50, top + lid_h), (cx + w * 0.50, top + lid_h)],
                              fill=96, width=max(1, int(h * 0.003)))
    img = paste_masked(img, Image.new("RGB", size, (140, 156, 178)),
                       seam.filter(ImageFilter.GaussianBlur(0.6)))

    lw, lh = int(w * 0.78), int(h * 0.52)
    img = _label(img, size, cx, int(top + lid_h + h * 0.20), lw, lh, name, grade, note)

    alpha = np.asarray(m_body, np.float32) / 255.0
    img = Image.fromarray(np.clip(np.asarray(img, np.float32)
                                  + grain(size, 4.0, 7) * alpha[..., None], 0, 255).astype(np.uint8), "RGB")
    return img, m_body


def bottle(size, name, grade, note, scale: float = 1.0):
    """Reagent bottle: straight body, drawn shoulder, slim neck, brushed cap."""
    cw, ch = size
    w = int(cw * 0.27 * scale)
    h = int(ch * 0.60 * scale)
    cx = cw * 0.5
    base = int(ch * 0.800)
    top = base - h

    nw = w * 0.30
    cap_bottom = top + h * 0.085
    shoulder = top + h * 0.300

    left_body, right_body = cx - w / 2, cx + w / 2
    left_neck, right_neck = cx - nw / 2, cx + nw / 2
    poly = [
        (left_body, base - w * 0.04),
        (left_body, shoulder),
        (left_neck - w * 0.10, shoulder - h * 0.045),
        (left_neck, shoulder - h * 0.090),
        (left_neck, cap_bottom),
        (right_neck, cap_bottom),
        (right_neck, shoulder - h * 0.090),
        (right_neck + w * 0.10, shoulder - h * 0.045),
        (right_body, shoulder),
        (right_body, base - w * 0.04),
    ]
    img, m_body = _shade(size, poly, top=(36, 43, 55), bottom=(14, 18, 25))

    # the neck and the cap carry their own light so the silhouette reads in a grid
    neck_poly = [(left_neck, cap_bottom), (right_neck, cap_bottom),
                 (right_neck, shoulder - h * 0.090), (left_neck, shoulder - h * 0.090)]
    neck, m_neck = _shade(size, neck_poly, top=(44, 52, 65), bottom=(26, 32, 42))
    img = Image.composite(neck, img, m_neck)

    cap_poly = _rrect(cx, top, cap_bottom + h * 0.006, nw * 1.55, nw * 0.20)
    cap, m_cap = _shade(size, cap_poly, top=(120, 133, 152), bottom=(70, 81, 98))
    img = Image.composite(cap, img, m_cap)

    img = _edges(img, poly, (106, 122, 144), max(1, int(w * 0.009)), 92)
    img = _edges(img, cap_poly, (150, 168, 192), max(1, int(w * 0.009)), 130)
    img = _edges(img, [(left_neck - nw * 0.28, cap_bottom), (right_neck + nw * 0.28, cap_bottom)],
                 (96, 110, 130), max(1, int(w * 0.006)), 110)

    lw, lh = int(w * 0.82), int(h * 0.30)
    img = _label(img, size, cx, int(shoulder + h * 0.22), lw, lh, name, grade, note)

    alpha = np.asarray(m_body, np.float32) / 255.0
    img = Image.fromarray(np.clip(np.asarray(img, np.float32)
                                  + grain(size, 4.0, 7) * alpha[..., None], 0, 255).astype(np.uint8), "RGB")
    return img, m_body


def sleeve(size, name, note, scale: float = 1.0):
    """Long kraft sleeve of cocktail straws - a tall, thin pack."""
    cw, ch = size
    w = int(cw * 0.22 * scale)
    h = int(ch * 0.64 * scale)
    cx = cw * 0.5
    base = int(ch * 0.800)
    top = base - h

    poly = _rrect(cx, top + h * 0.03, base, w, w * 0.05)
    img, m = _shade(size, poly, top=(38, 43, 50), bottom=(20, 24, 30))
    img = _edges(img, poly, (110, 124, 142), max(1, int(w * 0.010)), 96)

    band = Image.new("L", size, 0)
    ImageDraw.Draw(band).rectangle([cx - w / 2, top + h * 0.30, cx + w / 2, top + h * 0.52], fill=90)
    img = paste_masked(img, Image.new("RGB", size, (18, 22, 30)), band)

    a = text_mark(name, int(w * 0.80), (238, 243, 251))
    img.paste(a, (int(cx - a.width / 2), int(top + h * 0.36)), a.split()[3])
    b = text_mark(note, int(w * 0.62), (150, 164, 184))
    img.paste(b, (int(cx - b.width / 2), int(top + h * 0.44)), b.split()[3])
    mark = chrome_mark(int(w * 0.24))
    img.paste(mark, (int(cx - mark.width / 2), int(base + ch * 0.02)), mark.split()[3])

    alpha = np.asarray(m, np.float32) / 255.0
    img = Image.fromarray(np.clip(np.asarray(img, np.float32)
                                  + grain(size, 4.0, 7) * alpha[..., None], 0, 255).astype(np.uint8), "RGB")
    return img, m

if __name__ == "__main__":
    raise SystemExit(main())
