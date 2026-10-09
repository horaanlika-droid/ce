#!/usr/bin/env python3
"""Раунд 7 — таблица сцен hero / обложек коллекций / og:image.

Каждая сцена собирается из готовых мастеров товаров (st-<COD>.jpg): кадры уже
в одном свете, поэтому композит = те же предметы на общем световом поле, без
генератора. Раскладка: предметы в ряд на общей базовой линии, группа центруется
на `center` (доля ширины), высота предмета — доля высоты кадра (`h`).

Поля сцены:
  id        — идентификатор для --only (hero-01, hero-01-m, covers/<id>, og);
  out       — путь финального файла относительно webapp/;
  size      — (W, H) финала, мастер собирается в этом же размере;
  max_kb    — потолок веса JPEG (hero ≤ 350, -m ≤ 250, обложка/og ≤ 200);
  objs      — [(COD, h), ...] слева направо;
  center    — центр группы по X (доля W);
  baseline  — низ предметов (доля H);
  gap       — зазор между предметами (доля W);
  zone_x    — окна детекции геометрии в пайплайне (широким группам — шире).
"""

SCENES = [
    # ── hero, десктоп 1920×1080: стекло справа, левая половина — под заголовок
    dict(id='hero-01', out='assets/brand/hero-01.jpg', size=(1920, 1080), max_kb=350,
         objs=[('AG0008', .52), ('AG0021', .36), ('AG0009', .46)],
         center=.61, baseline=.80, gap=.035, zone_x=(0.06, 0.94)),
    dict(id='hero-02', out='assets/brand/hero-02.jpg', size=(1920, 1080), max_kb=350,
         objs=[('AG0002', .58), ('AG0006', .52)],
         center=.62, baseline=.80, gap=.05, zone_x=(0.06, 0.94)),
    dict(id='hero-03', out='assets/brand/hero-03.jpg', size=(1920, 1080), max_kb=350,
         objs=[('AG0015', .52), ('AG0016', .38), ('AG0012', .44)],
         center=.61, baseline=.80, gap=.04, zone_x=(0.06, 0.94)),
    dict(id='hero-04', out='assets/brand/hero-04.jpg', size=(1920, 1080), max_kb=350,
         objs=[('AG0020', .50), ('AG0022', .54)],
         center=.62, baseline=.80, gap=.05, zone_x=(0.06, 0.94)),
    dict(id='hero-05', out='assets/brand/hero-05.jpg', size=(1920, 1080), max_kb=350,
         objs=[('AG0027', .60)], center=.64, baseline=.80, gap=.05, zone_x=(0.06, 0.94)),
    # ── hero, мобильный 1080×1350: группа по центру, низ — под подпись
    dict(id='hero-01-m', out='assets/brand/hero-01-m.jpg', size=(1080, 1350), max_kb=250,
         objs=[('AG0008', .34), ('AG0021', .24), ('AG0009', .30)],
         center=.51, baseline=.70, gap=.04, zone_x=(0.05, 0.95)),
    dict(id='hero-02-m', out='assets/brand/hero-02-m.jpg', size=(1080, 1350), max_kb=250,
         objs=[('AG0002', .44), ('AG0006', .38)],
         center=.52, baseline=.70, gap=.05, zone_x=(0.05, 0.95)),
    dict(id='hero-03-m', out='assets/brand/hero-03-m.jpg', size=(1080, 1350), max_kb=250,
         objs=[('AG0015', .34), ('AG0016', .25), ('AG0012', .29)],
         center=.51, baseline=.70, gap=.045, zone_x=(0.05, 0.95)),
    dict(id='hero-04-m', out='assets/brand/hero-04-m.jpg', size=(1080, 1350), max_kb=250,
         objs=[('AG0020', .36), ('AG0022', .40)],
         center=.52, baseline=.70, gap=.05, zone_x=(0.05, 0.95)),
    dict(id='hero-05-m', out='assets/brand/hero-05-m.jpg', size=(1080, 1350), max_kb=250,
         objs=[('AG0027', .46)], center=.50, baseline=.68, gap=.05, zone_x=(0.05, 0.95)),
    # ── обложки коллекций 1280×720: флагман + сосед
    dict(id='covers/retro-asia', out='assets/covers/retro-asia.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0015', .60), ('AG0016', .44)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/retro-asia-engraved', out='assets/covers/retro-asia-engraved.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0011', .60), ('AG0012', .44)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/bullet', out='assets/covers/bullet.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0008', .58), ('AG0009', .52)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/flowers', out='assets/covers/flowers.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0002', .60), ('AG0001', .54)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/coupethini', out='assets/covers/coupethini.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0006', .64)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/replicate', out='assets/covers/replicate.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0004', .60)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/levitating', out='assets/covers/levitating.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0021', .48), ('AG0020', .56)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/shorties', out='assets/covers/shorties.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0023', .50), ('AG0024', .48)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/soon-teapot', out='assets/covers/soon-teapot.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0027', .66)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    dict(id='covers/two-sips', out='assets/covers/two-sips.jpg', size=(1280, 720), max_kb=200,
         objs=[('AG0019', .62)], center=.50, baseline=.78, gap=.06, zone_x=(0.08, 0.92), fade_start=.40),
    # ── og:image 1200×630: стекло справа, слева чистое место под заголовок
    dict(id='og', out='assets/brand/og.jpg', size=(1200, 630), max_kb=200,
         objs=[('AG0015', .52), ('AG0008', .44), ('AG0009', .48)],
         center=.68, baseline=.82, gap=.03, zone_x=(0.30, 0.97), fade_start=.48),
]


def master_path(scene, root_webapp):
    """Мастер сцены лежит рядом с финальным файлом: st-<имя>.jpg."""
    import os
    out = os.path.join(root_webapp, scene['out'])
    d, name = os.path.split(out)
    return os.path.join(d, f'st-{name}')
