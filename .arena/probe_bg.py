#!/usr/bin/env python3
"""Замер однородности фона в финальных кадрах.

Для каждого кадра берём полосы фона слева/справа/сверху/снизу от bbox предмета и
меряем:
  grad  — средняя энергия градиента (|dx|+|dy|): у однородного поля < 1.2,
          читуемые грани/швы поднимают её выше 2;
  R     — среднее по красному каналу (норма бренда 14…82);
  seam  — перепад яркости на строке горизонта (y1): не больше ~6.

Использование: python3 .arena/probe_bg.py [AG0015 AG0003 ...]
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
DIR = os.path.join(ROOT, 'webapp', 'assets', 'products')


def edge_energy(im, box):
    crop = im.convert('L').crop(box).filter(ImageFilter.FIND_EDGES)
    return ImageStat.Stat(crop).mean[0]


def probe(path, obj_box=None):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    x0, y0, x1, y1 = obj_box or (int(W * 0.28), int(H * 0.22), int(W * 0.72), int(H * 0.82))
    bands = [
        (0, 0, max(1, x0 - int(W * 0.04)), H),                 # слева
        (min(W, x1 + int(W * 0.04)), 0, W, H),                 # справа
        (0, 0, W, max(1, y0 - int(H * 0.03))),                  # сверху
        (0, min(H, y1 + int(H * 0.02)), W, H),                  # снизу (пол и отражение)
    ]
    grads = [edge_energy(im, b) for b in bands if b[2] > b[0] and b[3] > b[1]]
    rs = [ImageStat.Stat(im.getchannel('R').crop(b)).mean[0] for b in bands if b[2] > b[0] and b[3] > b[1]]
    row = im.convert('L').crop((0, max(0, y1 - 3), W, min(H, y1 + 4)))
    seam = ImageStat.Stat(ImageChops.subtract(row, row.filter(ImageFilter.GaussianBlur(3)))).mean[0]
    return dict(size=f'{W}x{H}', grad=round(sum(grads) / len(grads), 2),
                r_lo=round(min(rs), 1), r_hi=round(max(rs), 1), seam=round(seam, 2))


def main():
    args = sys.argv[1:]
    box = None
    if '--box' in args:                              # доли кадра: x0,y0,x1,y1
        i = args.index('--box')
        box = tuple(float(v) for v in args[i + 1].split(','))
        args = args[:i] + args[i + 2:]
    codes = args or sorted({f[:-4] for f in os.listdir(DIR)
                            if f.startswith('AG') and f.endswith('.jpg')})
    for cod in codes:
        paths = []
        if os.path.exists(cod):                      # раунд 7: прямые пути к кадрам
            paths = [cod]
        else:
            paths = [os.path.join(DIR, f'{cod}{s}.jpg') for s in ('', '-card')
                     if os.path.exists(os.path.join(DIR, f'{cod}{s}.jpg'))]
        for p in paths:
            im = Image.open(p)
            ob = None
            if box:
                ob = (int(box[0] * im.width), int(box[1] * im.height),
                      int(box[2] * im.width), int(box[3] * im.height))
            st = probe(p, ob)
            flag = '  ⚠ гранями' if st['grad'] > 1.9 else ''
            print(f'{os.path.basename(p):24} {st["size"]:>10}  grad {st["grad"]:<5} '
                  f'R {st["r_lo"]}…{st["r_hi"]:<5} seam {st["seam"]}{flag}')


if __name__ == '__main__':
    main()
