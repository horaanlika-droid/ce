#!/usr/bin/env python3
"""Draw the detected contact line / bbox / matte on each source — QC for the harmoniser."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harmonize_images as H  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/diag")
out.mkdir(parents=True, exist_ok=True)
files = sorted(p for p in H.ASSETS.joinpath(*sys.argv[2].split("/")).glob("*.webp") if "-sm" not in p.name)
for p in files:
    src = Image.open(p).convert("RGB")
    a = np.asarray(src, dtype=np.float32)
    det = H.find_piece(a)
    piece, contact, (x0, x1, y0, y1) = det["matte"], det["contact"], det["bbox"]
    vis = src.copy()
    d = ImageDraw.Draw(vis)
    d.line([(0, contact), (vis.width, contact)], fill=(255, 60, 60), width=3)
    d.rectangle([x0, y0, x1, y1], outline=(60, 255, 120), width=3)
    d.text((8, max(0, contact - 18)), f"contact={contact}", fill=(255, 200, 60))
    # matte overlay
    ov = Image.new("RGB", vis.size, (0, 0, 0))
    ov.paste((255, 0, 255), mask=Image.fromarray((piece * 255).astype(np.uint8), "L"))
    vis = Image.blend(vis, Image.blend(vis, ov, 0.5), 0.55)
    vis.thumbnail((420, 620))
    vis.save(out / f"{p.stem}.png")
print("wrote", out)
