#!/usr/bin/env python3
"""Stage the remaining archive renders on the master stage.

The last pieces of the catalogue still sit on the old navy backdrop
(`assets/archive/AG00xx.webp`). This lifts each one into `brand-source/black/`
pixel for pixel — same silhouette, same engraving, same wall and base — so the
master stage (`tools/master_stage.py`) can turn the room behind it to deep black
for every piece in one identical pass.

Nothing is redrawn, nothing is cut out, nothing is composited over a new photo.

    python3 tools/stage_archive.py            # write brand-source/black/*.png
    python3 tools/stage_archive.py --force    # redo plates that already exist
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from master_stage import BLACK, ROOT  # noqa: E402

ARCHIVE = ROOT / "assets" / "archive"

# master name (brand-source/black/<name>.png)  →  archive render
STAGE = {
    "flowers-cocktail": "AG0002.webp",
    "flowers-rocks": "AG0003.webp",
    "flowers-highball": "AG0001.webp",
    "coupethini": "AG0006.webp",
    "replicate-rocks": "AG0004.webp",
    "shorties-mini-martini": "AG0023.webp",
    "shorties-daisy-coupe": "AG0024.webp",
    "shorties-modern-margo": "AG0025.webp",
    "shorties-lil-nora": "AG0026.webp",
    "teapot": "AG0027.webp",
    "two-sips": "AG0019.webp",
    "bullet-chalet": "AG0008.webp",
    "bullet-highball": "AG0009.webp",
    "levitating-super-pony": "AG0020.webp",
    "levitating-rocks": "AG0021.webp",
    "levitating-highball": "AG0022.webp",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    for name, src in STAGE.items():
        dst = BLACK / f"{name}.png"
        if dst.exists() and not args.force:
            print(f"skip    {name} (exists)")
            continue
        source = ARCHIVE / src
        if not source.exists():
            print(f"missing {source}")
            continue
        img = Image.open(source).convert("RGB")
        img.save(dst, "PNG", optimize=True)
        print(f"lifted  {name}  ← {src}  {img.size}")


if __name__ == "__main__":
    main()
