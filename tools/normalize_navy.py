#!/usr/bin/env python3
"""Cocktail Embassy — one stage for every plate.

The navy set has to read as a single photo session: the piece at the same scale,
on the same centre line, with its foot on the same contact line. Generation
drifts, so the stage is measured from the finished plate and, when asked to
apply, put back where it belongs.

The stage is read off the brightness profile, not off a silhouette mask: the
glass is transparent and mirrored, so a mask catches the reflection and the
halo. What is unambiguous is the two sharp horizontal transitions every plate
has —

  * the rim, where the dark backdrop turns into the lit rim (first strong
    brightening going down),
  * the contact line, where the bright foot meets its shadow (strongest
    darkening in the lower half).

Canonical stage, as a fraction of the 2:3 frame:

    centre x     0.500
    contact y    0.795      (foot on the table)
    rim y        0.275      (top of the piece)  →  piece height 0.520

    python3 tools/normalize_navy.py                 # measure every master
    python3 tools/normalize_navy.py --apply          # scale/translate in place
    python3 tools/normalize_navy.py --sheet docs/stage.png
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand-source" / "navy"

CENTRE_X = 0.500                 # the plates are composed centred; scale about it
CONTACT_Y = 0.795
RIM_Y = 0.275
PIECE_H = CONTACT_Y - RIM_Y

SKIP = ("pack-", "cover-")     # packaging masters and the multi-glass covers
TOLERANCE = 0.012                # ±1.2 % of the frame is on-stage


def profile(img: Image.Image) -> np.ndarray:
    """Row-by-row vertical brightness slope, central 70 % of the width."""
    small = img.convert("L").resize((400, 500), Image.LANCZOS)
    a = np.asarray(small).astype(np.float32)
    band = a[:, 60:340]
    prof = np.diff(band, axis=0).mean(axis=1)
    return np.convolve(prof, np.ones(3) / 3, mode="same")


def measure(img: Image.Image, frac: float = 0.55) -> tuple[float, float]:
    """(contact y, rim y) as fractions of the frame height."""
    small = img.convert("L").resize((400, 500), Image.LANCZOS)
    a = np.asarray(small).astype(np.float32)[:, 60:340]
    h = 500
    down = np.convolve(np.diff(a, axis=0).mean(axis=1), np.ones(3) / 3, mode="same")
    up = np.convolve(np.diff(a, axis=0).max(axis=1), np.ones(3) / 3, mode="same")
    lo, hi = int(0.55 * h), int(0.95 * h)
    contact = (lo + int(np.argmin(down[lo:hi]))) / h
    hits = np.where(up[: max(1, int(contact * h) - 30)] > frac * up.max())[0]
    rim = (float(hits[0]) if len(hits) else 0.2 * h) / h
    return round(contact, 3), round(rim, 3)


def place(path: Path) -> dict:
    """Scale + translate one master onto the canonical stage."""
    img = Image.open(path).convert("RGB")
    w, h = img.size
    contact, rim = measure(img)
    scale = PIECE_H / max(0.08, contact - rim)
    scale = max(0.60, min(1.60, scale))          # never scale a plate into mush
    nw, nh = int(round(w * scale)), int(round(h * scale))
    plate = img.resize((nw, nh), Image.LANCZOS)

    # close the frame with a blurred blow-up of the plate itself — no visible seam
    canvas = plate.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(90))
    off_x = int(round((1 - scale) * w / 2))      # scale about the centre line
    off_y = int(round(CONTACT_Y * h - contact * scale * h))
    canvas.paste(plate, (off_x, off_y))
    return {"image": canvas, "scale": round(scale, 3), "before": (contact, rim)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="rewrite the masters")
    ap.add_argument("--sheet", default="", help="contact sheet with the stage drawn")
    args = ap.parse_args()

    paths = [p for p in sorted(SRC.glob("*.png")) if not p.stem.startswith(SKIP)]
    rows = []
    for path in paths:
        img = Image.open(path)
        contact, rim = measure(img)
        rows.append(
            {
                "name": path.stem,
                "contact": contact,
                "rim": rim,
                "height": round(contact - rim, 3),
                "on_stage": abs(contact - CONTACT_Y) <= TOLERANCE and abs(rim - RIM_Y) <= TOLERANCE,
            }
        )
        if args.apply:
            placed = place(path)
            placed["image"].save(path, "PNG", optimize=True, compress_level=9)

    for r in rows:
        flag = "ok " if r["on_stage"] else "off"
        print(
            f"{flag} {r['name']:32s} contact {r['contact']:.3f}  rim {r['rim']:.3f}  "
            f"height {r['height']:.3f}"
        )
    heights = np.array([r["height"] for r in rows])
    off = [r["name"] for r in rows if not r["on_stage"]]
    print(f"\nplates {len(rows)} · on stage {len(rows) - len(off)} · off {len(off)}")
    print(f"height  min {heights.min():.3f}  max {heights.max():.3f}  spread {heights.max() - heights.min():.3f}")
    if off:
        print("off stage:", ", ".join(off))

    if args.sheet:
        cols, cw, ch = 6, 240, 330
        sheet = Image.new("RGB", (cols * cw, ((len(rows) + cols - 1) // cols) * (ch + 22)), (6, 8, 14))
        draw = ImageDraw.Draw(sheet)
        for i, r in enumerate(rows):
            im = Image.open(SRC / f"{r['name']}.png").convert("RGB")
            im.thumbnail((cw - 12, ch - 12))
            x, y = (i % cols) * cw + 6, (i // cols) * (ch + 22) + 6
            sheet.paste(im, (x, y))
            draw.line([(x, y + im.height * CONTACT_Y), (x + im.width, y + im.height * CONTACT_Y)],
                      fill=(90, 210, 255), width=1)
            draw.line([(x, y + im.height * RIM_Y), (x + im.width, y + im.height * RIM_Y)],
                      fill=(255, 110, 110), width=1)
            draw.text((x, y + im.height + 4), f"{r['name'][:28]} h{r['height']:.2f}", fill=(240, 240, 240))
        out = Path(args.sheet)
        out = out if out.is_absolute() else ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out)
        print("sheet", out)


if __name__ == "__main__":
    main()
