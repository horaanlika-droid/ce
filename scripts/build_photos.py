#!/usr/bin/env python3
"""
Финишная обработка фото товаров: лёгкий цветной glow (bloom по хайлайтам),
как в бренд-референсах. Идемпотентно: мастер хранится в st-<COD>.jpg,
результат пишется в <COD>.jpg.

  pip install pillow
  python3 scripts/build_photos.py [--near 0.45] [--wide 0.18]
"""
import argparse
import os
import shutil

from PIL import Image, ImageChops, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(os.path.dirname(HERE), 'webapp', 'assets', 'products')


def smooth_mask(luma, t0=105, t1=225):
    return luma.point(lambda p: 0 if p <= t0 else (255 if p >= t1 else int((p - t0) * 255 / (t1 - t0))))


def glow(path, out, near=0.45, wide=0.18):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    mask = smooth_mask(im.convert('L'))
    hi = ImageChops.multiply(im, mask.convert('RGB'))
    b1 = ImageChops.multiply(hi.filter(ImageFilter.GaussianBlur(max(W, H) // 30)),
                             Image.new('RGB', (W, H), (int(near * 255),) * 3))
    b2 = ImageChops.multiply(hi.filter(ImageFilter.GaussianBlur(max(W, H) // 9)),
                             Image.new('RGB', (W, H), (int(wide * 255),) * 3))
    out_im = ImageChops.screen(ImageChops.screen(im, b1), b2)
    out_im.save(out, quality=90)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--near', type=float, default=0.45)
    ap.add_argument('--wide', type=float, default=0.18)
    args = ap.parse_args()

    n = 0
    for f in sorted(os.listdir(DIR)):
        if not f.startswith('AG') or not f.endswith('.jpg'):
            continue
        cod = f[:-4]
        master = os.path.join(DIR, f'st-{cod}.jpg')
        cur = os.path.join(DIR, f)
        if not os.path.exists(master):
            shutil.copy2(cur, master)
        glow(master, cur, args.near, args.wide)
        n += 1
    print(f'[photos] glow применён к {n} фото')


if __name__ == '__main__':
    main()
