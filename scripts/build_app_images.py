#!/usr/bin/env python3
"""Application art is NOT product photography.
Keep the studio field in scene masters; do not run product clear/fade again.
The silhouettes come from the existing supplier-matched masters, the light
from IMG_1440. No UI/text is baked into images. Products are never overwritten.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageEnhance, ImageFilter
import build_photos as bp
import compose_masters as cm
import scenes

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'webapp/assets'
OUT = ASSETS / 'app'

def scene_art(source):
    im = source.convert('RGB') if isinstance(source, Image.Image) else Image.open(source).convert('RGB')
    # Lower only the broad field. Keep the thin highlight detail at full energy.
    low = im.filter(ImageFilter.GaussianBlur(32))
    dark = ImageEnhance.Brightness(low).enhance(.48)
    detail = ImageChops.subtract(im, low)
    loss = ImageChops.subtract(low, im)
    return ImageChops.subtract(ImageChops.add(dark, ImageEnhance.Brightness(detail).enhance(2.4)), loss)

def save(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bp.save_jpeg(im, str(path), 90)
    bp.save_derivatives(str(path), avif=True, webp=True)

def main():
    for i in range(1, 6):
        for suffix in ('', '-m'):
            name = f'hero-{i:02}{suffix}.jpg'
            sc = dict(next(s for s in scenes.SCENES if s['id'] == name[:-4]))
            if suffix:
                sc['baseline'] = .49  # upper half: leave the caption zone empty
            else:
                sc['center'] = .72
                sc['objs'] = [(cod, height * .85) for cod, height in sc['objs']]
                sc['gap'] = .025
            save(scene_art(cm.compose(sc)), OUT / name)
    for source in (ASSETS / 'covers').glob('st-*.jpg'):
        save(scene_art(source), source.with_name(source.name[3:]))
    save(scene_art(ASSETS / 'brand/st-hero-03.jpg'), OUT / 'collections.jpg')
    # Independent page background without dishes, broad soft reference light.
    field = bp.ref_field(str(ROOT / 'IMG_1440.png'), (430, 100, 948, 478), (1600, 1000), 120)
    save(ImageEnhance.Brightness(field).enhance(.32), OUT / 'background.jpg')
    print('[app art] 10 hero + 10 covers + catalog banner + page background; products unchanged')

if __name__ == '__main__':
    main()
