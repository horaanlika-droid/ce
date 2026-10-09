#!/usr/bin/env python3
"""Проверка «растворения» кадра в фоне витрины.

Логика простая: витрина кладёт кадр целиком (contain) в контейнер с фоном
--bg #05070d и слегка приближает его (--zoom). Если кромка самого кадра
равна цвету фона — прямоугольника фотографии не видно НИ ПРИ КАКОЙ
геометрии, ни на карточке, ни в сцене товара. Поэтому меряем:

  dev   — максимальное отклонение внешних 22 px кадра от BG (0…3 — норм,
          >8 — покупатель увидит край);
  grad  — энергия граней в этой полосе (однородный тон → < 1.5);
  corner— то же для четырёх углов по 40×40 (там спад максимален).

Мок-карточки (то, что реально увидит браузер: контейнер + блюр-подложка +
contain + zoom) складываются в /tmp/blend_cards.png.

  python3 .arena/probe_blend.py AG0015 AG0010 AG0027
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'webapp', 'assets', 'products')
BG = (5, 7, 13)          # --bg #05070d
CSS_W, CSS_H, ZOOM = 420, 560, 1.16


def frame_metrics(path, band=22, corner=40):
    im = Image.open(path).convert('RGB')
    W, H = im.size
    strips = [im.crop((0, 0, W, band)), im.crop((0, H - band, W, H)),
              im.crop((0, 0, band, H)), im.crop((W - band, 0, W, H))]
    dev = max(max(ImageStat.Stat(ImageChops.difference(sp, Image.new('RGB', sp.size, BG))).mean) for sp in strips)
    l = im.convert('L')
    grads = [ImageStat.Stat(sp.convert('L').filter(ImageFilter.FIND_EDGES)).mean[0] for sp in strips]
    cs = [im.crop(b) for b in ((0, 0, corner, corner), (W - corner, 0, W, corner),
                               (0, H - corner, corner, H), (W - corner, H - corner, W, H))]
    cdev = max(max(ImageStat.Stat(ImageChops.difference(c, Image.new('RGB', c.size, BG))).mean) for c in cs)
    return dict(dev=round(dev, 1), grad=round(sum(grads) / len(grads), 2), corner=round(cdev, 1))


def mock_card(path, out_size=(CSS_W, CSS_H), zoom=ZOOM):
    """Приближённо то, что рисует CSS: фон контейнера, блюр-подложка из этой же
    картинки, кадр целиком (contain) с padding 3.5%/2% и --zoom; всё, что
    вылезло, отсекает overflow: hidden."""
    W, H = out_size
    shot = Image.open(path).convert('RGB')
    s = max(W / shot.width, H / shot.height) * 1.24
    big = shot.resize((max(1, int(shot.width * s)), max(1, int(shot.height * s))), Image.LANCZOS)
    iw, ih = int(W * 0.96), int(H * 0.93)
    k = min(iw / shot.width, ih / shot.height) * zoom
    fit = shot.resize((max(1, round(shot.width * k)), max(1, round(shot.height * k))), Image.LANCZOS)
    cw, ch = max(W, fit.width), max(H, fit.height)
    full = Image.new('RGB', (cw, ch), BG)
    layer = Image.new('RGB', (cw, ch), BG)
    layer.paste(big, ((cw - big.width) // 2, (ch - big.height) // 2))
    full.paste(layer.filter(ImageFilter.GaussianBlur(13)), (0, 0))
    full.paste(fit, ((cw - fit.width) // 2, (ch - fit.height) // 2))
    return full.crop(((cw - W) // 2, (ch - H) // 2, (cw - W) // 2 + W, (ch - H) // 2 + H))


def main():
    codes = sys.argv[1:] or ['AG0015']
    tiles = []
    for cod in codes:
        if os.path.exists(cod):                      # раунд 7: прямой путь к кадру
            p = cod
        else:
            p = os.path.join(DIR, f'{cod}-card.jpg')
            if not os.path.exists(p):
                p = os.path.join(DIR, f'{cod}.jpg')
        if not os.path.exists(p):
            print('нет файла', cod)
            continue
        m = frame_metrics(p)
        mark = '  ⚠ виден край' if m['dev'] > 8 or m['grad'] > 2.2 else ''
        print(f'{cod}: отклонение кромки от --bg {m["dev"]:<5} углы {m["corner"]:<5} '
              f'грани в полосе {m["grad"]}{mark}')
        tiles.append((cod, mock_card(p)))
    if tiles:
        w, h = tiles[0][1].size
        sheet = Image.new('RGB', (len(tiles) * (w + 16) + 16, h + 16), (26, 26, 32))
        for i, (_, t) in enumerate(tiles):
            sheet.paste(t, (16 + i * (w + 16), 8))
        sheet.save('/tmp/blend_cards.png')
        print('моки карточек → /tmp/blend_cards.png')


if __name__ == '__main__':
    main()
