#!/usr/bin/env python3
"""Раунд 7 — композитные мастера hero / обложек / og из мастеров товаров.

Каждый предмет вырезается из своего мастера st-<COD>.jpg мягкой маской
силуэта после предочистки фона (боке + приведение низких частот + одно
размытое поле, как в пайплайне) и ставится на общее световое поле референса
по раскладке scripts/scenes.py: группа на общей базовой линии, авто-раскладка
слева направо с зазором `gap`. Фон с обеих сторон кромки маски — одно и то же
поле, поэтому шва склейки нет.

Результат — st-<имя>.jpg рядом с целевым файлом (идемпотентно): дальше
`build_photos.py --only hero,covers,og` прогоняет его через ту же оптику
(bg-smooth, clear, bloom, rim, fade), что и товары.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_photos as bp
import scenes

DIR = os.path.join(ROOT, 'webapp', 'assets', 'products')
WEBAPP = os.path.join(ROOT, 'webapp')
REF = os.path.join(ROOT, 'IMG_1440.png')
BOX = (430, 100, 948, 478)

_cache = {}


def clean_master(cod):
    """Мастер с фоном, приведённым к стандартному световому полю: вырезанный
    предмет вклеивается в композит без шва (с обеих сторон маски — то же поле)."""
    if cod in _cache:
        return _cache[cod]
    path = os.path.join(DIR, f'st-{cod}.jpg')
    im = Image.open(path).convert('RGB')
    bp.set_scale(max(im.size))
    im = bp.bokeh(im, 18, 14)
    _, obj, bbox = bp.frame_geometry(im, cod)
    if obj is None:
        raise SystemExit(f'{cod}: не найдена геометрия предмета в мастере')
    field = bp.ref_field(REF, BOX, im.size, 120)
    im = bp.match_bg(im, field, 1.0, 90)
    bg, keep, _ = bp.field_bg(im, obj, field, 150, 26, 34, 0.92, 26)
    if keep is not None:
        im = Image.composite(im, bg, keep)
    _cache[cod] = (im, obj, bbox)
    return im, obj, bbox


def extract(cod, margin=0.14):
    """Кроп предмета с мягкой маской: bbox + поля под ореол."""
    im, obj, bbox = clean_master(cod)
    x0, y0, x1, y1 = bbox
    mx = int((x1 - x0) * margin)
    my = int((y1 - y0) * margin)
    box = (max(0, x0 - mx), max(0, y0 - my), min(im.width, x1 + mx), min(im.height, y1 + my))
    return im.crop(box), obj.crop(box), bbox, box


def compose(scene):
    W, H = scene['size']
    bp.set_scale(max(W, H))
    canvas = bp.ref_field(REF, BOX, (W, H), 120)

    parts = []
    for cod, h_frac in scene['objs']:
        crop, mask, bbox, box = extract(cod)
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        aspect = bw / max(1, bh)
        th = h_frac * H
        parts.append(dict(cod=cod, crop=crop, mask=mask, bbox=bbox, box=box,
                          th=th, tw=th * aspect))
    gap = scene.get('gap', 0.04) * W
    total = sum(p['tw'] for p in parts) + gap * (len(parts) - 1)
    x = scene.get('center', 0.5) * W - total / 2
    base = scene.get('baseline', 0.80) * H
    for p in parts:
        k = p['th'] / (p['bbox'][3] - p['bbox'][1])
        cw = max(1, int(round(p['crop'].width * k)))
        ch = max(1, int(round(p['crop'].height * k)))
        crop = p['crop'].resize((cw, ch), Image.LANCZOS)
        mask = p['mask'].resize((cw, ch), Image.BILINEAR)
        # центр bbox предмета — в x + tw/2; низ bbox — на базовой линии
        bx = (p['bbox'][0] - p['box'][0]) * k
        by = (p['bbox'][3] - p['box'][1]) * k          # низ bbox внутри кропа
        bcx = bx + (p['bbox'][2] - p['bbox'][0]) * k / 2
        px0 = int(round(x + p['tw'] / 2 - bcx))
        py0 = int(round(base - by))
        # мягкая вклейка: вне маски остаётся поле канвы
        layer = Image.new('RGB', (W, H), (0, 0, 0))
        lm = Image.new('L', (W, H), 0)
        lx, ty = px0, py0
        if lx < 0:
            crop = crop.crop((-lx, 0, cw, ch)); mask = mask.crop((-lx, 0, cw, ch)); lx = 0
        if ty < 0:
            crop = crop.crop((0, -ty, cw, ch)); mask = mask.crop((0, -ty, cw, ch)); ty = 0
        if lx + crop.width > W:
            w2 = W - lx; crop = crop.crop((0, 0, w2, crop.height)); mask = mask.crop((0, 0, w2, mask.height))
        if ty + crop.height > H:
            h2 = H - ty; crop = crop.crop((0, 0, crop.width, h2)); mask = mask.crop((0, 0, mask.width, h2))
        layer.paste(crop, (lx, ty))
        lm.paste(mask, (lx, ty))
        canvas = Image.composite(layer, canvas, lm)
        x += p['tw'] + gap
    return canvas


def main():
    n = 0
    for sc in scenes.SCENES:
        out = scenes.master_path(sc, WEBAPP)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        canvas = compose(sc)
        bp.save_jpeg(canvas, out, 95)
        n += 1
        print(f'[compose] {sc["id"]:>24}  {sc["size"][0]}x{sc["size"][1]}  → {os.path.relpath(out, ROOT)}')
    print(f'[compose] мастеров: {n}')


if __name__ == '__main__':
    main()
