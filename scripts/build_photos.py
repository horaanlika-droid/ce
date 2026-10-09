#!/usr/bin/env python3
"""
Финишная обработка фото товаров под стиль бренд-референсов. Идемпотентно:
мастер лежит в st-<COD>.jpg, результат пишется в <COD>.jpg.

Порядок шагов (раунд 2 — «футуристичный флер»):
  1. --bg-blur   боке: всё, где нет резких граней (фон, дымка, пол),
                 дополнительно размывается; стекло остаётся резким;
  2. --bg-ref    световое поле фона приводится к референсу: ровная
                 сталь-синяя среда вместо прожектора, шва горизонта,
                 светового диска и чёрной виньетки (знаковая правка
                 низкочастотного слоя, детали стекла возвращаются);
  3. --near/--wide  bloom по хайлайтам (ближний и широкий ореол).

  pip install pillow
  python3 scripts/build_photos.py                        # дефолт раунда 2
  python3 scripts/build_photos.py --near 0.45 --wide 0.18 --bg-blur 0 --bg-ref ''
"""
import argparse
import os
import shutil

from PIL import Image, ImageChops, ImageFilter, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIR = os.path.join(ROOT, 'webapp', 'assets', 'products')


def smooth_mask(luma, t0=105, t1=225):
    return luma.point(lambda p: 0 if p <= t0 else (255 if p >= t1 else int((p - t0) * 255 / (t1 - t0))))


def bokeh(im, radius=18, edge=14):
    """Размывает фон по маске граней: стекло остаётся резким."""
    gray = im.convert('L')
    sharp = (gray.filter(ImageFilter.FIND_EDGES)
                 .filter(ImageFilter.MaxFilter(5))
                 .point(lambda p: 255 if p > edge else 0)
                 .filter(ImageFilter.MaxFilter(13))
                 .filter(ImageFilter.GaussianBlur(5)))
    bg = im.filter(ImageFilter.GaussianBlur(radius))
    return Image.composite(im, bg, sharp)


def ref_field(path, box, size, radius):
    """Мягкое световое поле референса: та же оптика фона, без стекла и деталей."""
    im = Image.open(path).convert('RGB')
    if box:
        im = im.crop(box)
    im = im.filter(ImageFilter.GaussianBlur(radius))
    im = im.resize(size, Image.LANCZOS)
    return im


def match_bg(im, field, weight=0.8, radius=55):
    """Фон кадра приводится к световому полю референса: без прожектора, без шва
    горизонта, без светового диска и чёрной виньетки. Правка знако-точная
    (gain/loss по низкочастотному слою), поэтому стеклянные грани, блики и
    отражение не «съедаются», как это было бы при detail = im − low."""
    low = im.filter(ImageFilter.GaussianBlur(radius))
    new_low = Image.blend(low, field, weight)
    gain = ImageChops.subtract(new_low, low)
    loss = ImageChops.subtract(low, new_low)
    return ImageChops.subtract(ImageChops.add(im, gain), loss)


def glow(path, out, near=0.5, wide=0.24, bg_blur=10, edge=14,
         bg_ref=None, bg_box=None, bg_w=0.8, bg_r=55):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    if bg_blur:
        im = bokeh(im, bg_blur, edge)
    if bg_ref and os.path.exists(bg_ref):
        im = match_bg(im, ref_field(bg_ref, bg_box, im.size, 70), bg_w, bg_r)
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
    ap.add_argument('--near', type=float, default=0.5)
    ap.add_argument('--wide', type=float, default=0.24)
    ap.add_argument('--bg-blur', type=float, default=10, help='0 — выключено')
    ap.add_argument('--edge', type=int, default=14)
    ap.add_argument('--bg-ref', default='IMG_1440.png',
                    help='референс, с которого берётся световое поле фона (пусто — выключено)')
    ap.add_argument('--bg-box', default='430,100,948,478', help='кроп референса: left,top,right,bottom')
    ap.add_argument('--bg-w', type=float, default=0.8, help='сила приведения фона, 0..1')
    ap.add_argument('--bg-r', type=int, default=55, help='радиус низкочастотного слоя кадра, px')
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
        box = tuple(int(v) for v in args.bg_box.split(',')) if args.bg_ref and args.bg_box else None
        ref = args.bg_ref if os.path.isabs(args.bg_ref) else os.path.join(ROOT, args.bg_ref)
        if ref == args.bg_ref and not os.path.exists(ref):
            ref = os.path.join(ROOT, args.bg_ref)
        glow(master, cur, args.near, args.wide, args.bg_blur, args.edge,
             args.bg_ref and ref, box, args.bg_w, args.bg_r)
        n += 1
    print(f'[photos] glow применён к {n} фото')


if __name__ == '__main__':
    main()
