#!/usr/bin/env python3
"""
Финишная обработка фото товаров под стиль бренд-референса IMG_1440.png
(«как на 1440»). Идемпотентно: мастер лежит в st-<COD>.jpg, результат пишется
в <COD>.jpg.

Порядок шагов (раунд 4 — «на глянце, как на референсе»):
  1. --bg-blur    боке: всё, где нет резких граней (фон, дымка), размывается;
                  стекло остаётся резким;
  2. --bg-ref     низкочастотный слой кадра целиком заменяется ровным световым
                  полем референса (вес 1.0): без прожектора, чёрной виньетки и
                  резких краёв. Знако-точная сборка — блики стекла не «съедаются»;
  3. --bg-smooth  зона вокруг предмета (прямоугольник bbox из силуэта прайса)
                  защищена, весь остальной фон дополнительно размывается —
                  убирает любые остатки генератора (тени, поверхности);
  4. --surface    глянцевая поверхность: ниже горизонта (основание предмета)
                  низкочастотный слой плавно (без шва) затемняется + световая
                  полоса блика глянца под горизонтом;
  5. --refl       зеркальное отражение предмета на глянце: перевёрнутые стенки
                  и блики предмета под основанием, вертикально размытые,
                  с затуханием вниз;
  6. --shadow     контактная тень у основания (предмет стоит, а не парит);
  7. --near/--wide/--rim  футуристичный холодный bloom по хайлайтам (голубой
                  ореол) + холодное rim-glow по контуру предмета.

  pip install pillow
  python3 scripts/build_photos.py                        # дефолт раунда 4
  python3 scripts/build_photos.py --only AG0001,AG0004  # точечно
  python3 scripts/build_photos.py --no-surface           # парение без глянца
"""
import argparse
import os
import shutil

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIR = os.path.join(ROOT, 'webapp', 'assets', 'products')
SHAPE_DIR = os.path.join(ROOT, '.arena', 'shape')


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
    """Ровное световое поле референса: та же оптика фона, без стекла и деталей."""
    im = Image.open(path).convert('RGB')
    if box:
        im = im.crop(box)
    im = im.filter(ImageFilter.GaussianBlur(radius))
    im = im.resize(size, Image.LANCZOS)
    return im


def _apply_low(im, new_low, radius=90):
    """Знако-точная замена низкочастотного слоя (gain/loss), детали не трогает."""
    low = im.filter(ImageFilter.GaussianBlur(radius))
    gain = ImageChops.subtract(new_low, low)
    loss = ImageChops.subtract(low, new_low)
    return ImageChops.subtract(ImageChops.add(im, gain), loss)


def match_bg(im, field, weight=1.0, radius=90):
    """Низкочастотный слой кадра приводится к световому полю референса: без
    прожектора, стола, шва горизонта, отражений и чёрной виньетки. При
    weight=1.0 крупные структуры фона полностью уходят в ровное поле."""
    low = im.filter(ImageFilter.GaussianBlur(radius))
    new_low = Image.blend(low, field, weight)
    return _apply_low(im, new_low, radius)


def vgrad(W, H, stops):
    """Вертикальный градиент: stops = [(y, value), ...] с линейными переходами."""
    col = Image.new('L', (1, H))
    data = []
    stops = sorted(stops)
    for y in range(H):
        v = stops[0][1]
        for (y0, v0), (y1, v1) in zip(stops, stops[1:]):
            if y0 <= y <= y1:
                t = 0 if y1 == y0 else (y - y0) / (y1 - y0)
                v = int(v0 + (v1 - v0) * t)
                break
        else:
            v = stops[-1][1]
        if y < stops[0][0]:
            v = stops[0][1]
        elif y > stops[-1][0]:
            v = stops[-1][1]
        data.append(v)
    col.putdata(data)
    return col.resize((W, H), Image.BILINEAR)


def _protect_mask(size, bbox, blur=48):
    W, H = size
    mx = max(16, int(W * 0.10))
    my = max(16, int(H * 0.08))
    x0, y0, x1, y1 = bbox
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).rectangle(
        (max(0, x0 - mx), max(0, y0 - my), min(W, x1 + mx), min(H, y1 + my)), fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur))


def shape_geometry(cod, size):
    """Геометрия предмета из силуэта прайса (белый фон, предмет не белый).
    Возвращает (protect_mask, obj_mask, bbox) или (None, None, None)."""
    p = os.path.join(SHAPE_DIR, f'shape-{cod}.png')
    if not os.path.exists(p):
        return None, None, None
    sh = Image.open(p).convert('RGB')
    if sh.size != size:
        sh = sh.resize(size, Image.LANCZOS)
    r, g, b = (ImageChops.invert(ch) for ch in sh.split())
    dev = ImageChops.lighter(ImageChops.lighter(r, g), b)  # отклонение от белого
    binm = dev.point(lambda v: 255 if v > 6 else 0).filter(ImageFilter.MaxFilter(3))
    bbox = binm.getbbox()
    if not bbox:
        return None, None, None
    obj = binm.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(8))
    return _protect_mask(size, bbox), obj, bbox


def master_geometry(im, cod):
    """Геометрия предмета по самому кадру мастера: на ровном тёмном фоне предмет
    — это яркие блики (hi) и контуры. Основание (y1) — самый нижний ряд, где
    яркие блики занимают заметную ширину (тень под предметом отсекается).
    Возвращает (protect_mask, obj_mask, bbox). Если бликов нет, фон «грязный»
    (диск/поверхность — старые мастера) или геометрия неправдоподобна —
    фолбэк на силуэт прайса."""
    W, H = im.size
    L = im.convert('L')
    hi = L.point(lambda v: 255 if v > 205 else 0).filter(ImageFilter.MaxFilter(5))
    zone = Image.new('L', (W, H), 0)
    ImageDraw.Draw(zone).rectangle(
        (int(W * 0.15), int(H * 0.04), int(W * 0.85), H), fill=255)
    hi = ImageChops.multiply(hi, zone)
    total = sum(hi.histogram()[1:])
    if total < 300:  # нет ярких бликов — фолбэк
        return shape_geometry(cod, (W, H))
    rowfrac = [v / 255 for v in hi.resize((1, H), Image.BILINEAR).getdata()]
    ys = [y for y, f in enumerate(rowfrac) if f > 0.01]
    if not ys:
        return shape_geometry(cod, (W, H))
    y0, y1 = min(ys), max(ys)
    # ширина предмета — по контурам (края ловят стенки точнее бликов)
    e0 = L.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 22 else 0)
    cap = Image.new('L', (W, H), 0)
    ImageDraw.Draw(cap).rectangle((0, max(0, y0 - 4), W, min(H, y1 + 6)), fill=255)
    ez = ImageChops.multiply(e0, ImageChops.multiply(zone, cap))
    colfrac = [v / 255 for v in ez.resize((W, 1), Image.BILINEAR).getdata()]
    xs = [x for x, f in enumerate(colfrac) if f > 0.01]
    if not xs:
        colfrac = [v / 255 for v in hi.resize((W, 1), Image.BILINEAR).getdata()]
        xs = [x for x, f in enumerate(colfrac) if f > 0.005]
    if not xs:
        return shape_geometry(cod, (W, H))
    x0, x1 = min(xs), max(xs)
    w, h = x1 - x0, y1 - y0
    ok = (0.15 * W < w < 0.9 * W and 0.25 * H < h < 0.95 * H
          and y1 < 0.985 * H and y0 > 0.01 * H)
    if ok:
        inside = sum(hi.crop((x0, y0, x1, y1)).histogram()[1:])
        if inside / total < 0.9:  # заметная часть бликов вне предмета — грязный фон
            ok = False
    if not ok:
        return shape_geometry(cod, (W, H))
    # маска предмета: блики + контуры, обрезаны по основанию (тень не попадает)
    e = L.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 22 else 0)
    cand = ImageChops.lighter(hi, e).filter(ImageFilter.MaxFilter(7))
    cap = Image.new('L', (W, H), 0)
    ImageDraw.Draw(cap).rectangle((0, 0, W, y1 + 6), fill=255)
    cand = ImageChops.multiply(ImageChops.multiply(cand, zone), cap)
    obj = cand.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(10))
    return _protect_mask((W, H), (x0, y0, x1, y1)), obj, (x0, y0, x1, y1)


def smooth_bg(im, protect_mask, radius=40):
    """Сильно размывает фон вне защищённой зоны предмета
    (внутри protect_mask — оригинал, снаружи — размытый фон)."""
    if protect_mask is None:
        return im.filter(ImageFilter.GaussianBlur(radius // 2))
    return Image.composite(im, im.filter(ImageFilter.GaussianBlur(radius)), protect_mask)


def add_surface(im, bbox, darken=0.55, band=26, band_gain=0.35, fade=70):
    """Глянцевая поверхность ниже основания предмета: плавное (без шва)
    затемнение низкочастотного слоя + световая полоса блика глянца."""
    if bbox is None:
        return im
    W, H = im.size
    y1 = bbox[3]
    low = im.filter(ImageFilter.GaussianBlur(70))
    base = low.crop((0, max(0, y1 - 10), W, min(H, y1 + 10))).resize((1, 1), Image.LANCZOS).getpixel((0, 0))
    dark = tuple(int(c * darken) for c in base)
    grad = vgrad(W, H, [(y1 - fade, 0), (y1 + fade, 255)]).filter(ImageFilter.GaussianBlur(8))
    new_low = Image.composite(Image.new('RGB', (W, H), dark), low, grad)
    # световая полоса блика глянца под горизонтом
    hi = Image.new('RGB', (W, H), (0, 0, 0))
    ImageDraw.Draw(hi).rectangle(
        (0, y1 + 4, W, y1 + 4 + band),
        fill=tuple(min(255, int(c * (1 + band_gain))) for c in base))
    hi = hi.filter(ImageFilter.GaussianBlur(18))
    band_mask = vgrad(W, H, [(y1 - band, 0), (y1 + 8, 255), (y1 + 4 + 2 * band, 0)])
    new_low = ImageChops.screen(new_low, ImageChops.multiply(hi, band_mask.convert('RGB')))
    return _apply_low(im, new_low, 90)


def add_reflection(im, obj_mask, bbox, strength=0.55, fade=0.65):
    """Зеркальное отражение на глянце: перевёрнутые стенки/блики предмета под
    основанием, вертикально размытые, с затуханием вниз (screen)."""
    if bbox is None or obj_mask is None:
        return im
    W, H = im.size
    x0, y0, x1, y1 = bbox
    h_obj = max(1, y1 - y0)
    flipped = im.transpose(Image.FLIP_TOP_BOTTOM)
    fmask = obj_mask.transpose(Image.FLIP_TOP_BOTTOM)
    refl = flipped.crop((x0, H - y1, x1, H - y0))
    fmask = fmask.crop((x0, H - y1, x1, H - y0))
    refl = ImageChops.multiply(refl, fmask.convert('RGB'))
    w, h = refl.size
    refl = refl.resize((w, max(1, h // 7)), Image.LANCZOS).resize((w, h), Image.LANCZOS)
    refl = refl.filter(ImageFilter.GaussianBlur(2))
    refl = refl.point(lambda v: min(255, int(v * 0.85 + 35)))
    layer = Image.new('RGB', (W, H), (0, 0, 0))
    layer.paste(refl, (x0, y1))
    full_mask = Image.new('L', (W, H), 0)
    full_mask.paste(fmask, (x0, y1))
    fade_h = max(8, int(h_obj * fade))
    alpha = ImageChops.multiply(
        full_mask,
        vgrad(W, H, [(y1, 255), (y1 + fade_h, 0)]).filter(ImageFilter.GaussianBlur(6)))
    alpha = alpha.point(lambda v: int(v * strength))
    return ImageChops.screen(im, ImageChops.multiply(layer, alpha.convert('RGB')))


def contact_shadow(im, bbox, strength=0.45, color=(5, 10, 22)):
    """Контактная тень у основания: предмет стоит на глянце."""
    if bbox is None:
        return im
    W, H = im.size
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) // 2
    rx = int(max(8, (x1 - x0) * 0.30))
    ry = max(4, int(H * 0.018))
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).ellipse((cx - rx, y1 - ry // 2, cx + rx, y1 + ry + ry // 2), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(10))
    m = m.point(lambda v: int(v * strength))
    return Image.composite(Image.new('RGB', (W, H), color), im, m)


def fut_bloom(im, near=0.55, wide=0.30):
    """Футуристичный холодный bloom: голубой ореол по хайлайтам."""
    W, H = im.size
    mask = smooth_mask(im.convert('L'))
    hi = ImageChops.multiply(im, mask.convert('RGB'))
    c_near = (int(0.55 * near * 255), int(0.75 * near * 255), int(near * 255))
    c_wide = (int(0.35 * wide * 255), int(0.55 * wide * 255), int(0.95 * wide * 255))
    b1 = ImageChops.multiply(hi.filter(ImageFilter.GaussianBlur(max(W, H) // 30)),
                             Image.new('RGB', (W, H), c_near))
    b2 = ImageChops.multiply(hi.filter(ImageFilter.GaussianBlur(max(W, H) // 9)),
                             Image.new('RGB', (W, H), c_wide))
    return ImageChops.screen(ImageChops.screen(im, b1), b2)


def rim_glow(im, obj_mask, strength=0.5, color=(70, 130, 230), blur=18):
    """Холодное свечение по контуру предмета (футуристичный край)."""
    if obj_mask is None:
        return im
    body = obj_mask.filter(ImageFilter.MinFilter(5))
    edge = ImageChops.subtract(obj_mask, body)
    edge = edge.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(v * strength))
    glow = Image.new('RGB', im.size, color)
    return ImageChops.screen(im, ImageChops.multiply(glow, edge.convert('RGB')))


def glow(path, out, near=0.55, wide=0.30, bg_blur=18, edge=14,
         bg_ref=None, bg_box=None, bg_w=1.0, bg_r=90, field_r=120,
         bg_smooth=40, surface=True, refl=0.55, shadow=0.45, rim=0.4, cod=None):
    im = Image.open(path).convert('RGB')
    protect, obj_mask, bbox = master_geometry(im, cod) if cod else (None, None, None)
    if bg_blur:
        im = bokeh(im, bg_blur, edge)
    if bg_ref and os.path.exists(bg_ref):
        im = match_bg(im, ref_field(bg_ref, bg_box, im.size, field_r), bg_w, bg_r)
    if bg_smooth:
        im = smooth_bg(im, protect, bg_smooth)
    if surface:
        im = add_surface(im, bbox)
    if refl:
        im = add_reflection(im, obj_mask, bbox, refl)
    if shadow:
        im = contact_shadow(im, bbox, shadow)
    im = fut_bloom(im, near, wide)
    if rim:
        im = rim_glow(im, obj_mask, rim)
    im.save(out, quality=90)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--near', type=float, default=0.55)
    ap.add_argument('--wide', type=float, default=0.30)
    ap.add_argument('--rim', type=float, default=0.5, help='сила холодного свечения по контуру, 0 — выключено')
    ap.add_argument('--bg-blur', type=float, default=18, help='0 — выключено')
    ap.add_argument('--edge', type=int, default=14)
    ap.add_argument('--bg-ref', default='IMG_1440.png',
                    help='референс, с которого берётся световое поле фона (пусто — выключено)')
    ap.add_argument('--bg-box', default='430,100,948,478', help='кроп референса: left,top,right,bottom')
    ap.add_argument('--bg-w', type=float, default=1.0, help='сила приведения фона, 0..1')
    ap.add_argument('--bg-r', type=int, default=90, help='радиус низкочастотного слоя кадра, px')
    ap.add_argument('--field-r', type=int, default=120, help='радиус размытия поля референса, px')
    ap.add_argument('--bg-smooth', type=float, default=40, help='доп. размытие фона вне предмета, 0 — выключено')
    ap.add_argument('--no-surface', action='store_true', help='без глянца (парение)')
    ap.add_argument('--refl', type=float, default=0.55, help='сила зеркального отражения, 0 — выключено')
    ap.add_argument('--shadow', type=float, default=0.45, help='сила контактной тени, 0 — выключено')
    ap.add_argument('--only', default='', help='список кодов через запятую, например AG0001,AG0004')
    args = ap.parse_args()

    only = {c.strip() for c in args.only.split(',') if c.strip()}
    n = 0
    for f in sorted(os.listdir(DIR)):
        if not f.startswith('st-AG') or not f.endswith('.jpg'):
            continue
        cod = f[3:-4]
        if only and cod not in only:
            continue
        master = os.path.join(DIR, f)
        cur = os.path.join(DIR, f'{cod}.jpg')
        box = tuple(int(v) for v in args.bg_box.split(',')) if args.bg_ref and args.bg_box else None
        ref = args.bg_ref if os.path.isabs(args.bg_ref) else os.path.join(ROOT, args.bg_ref)
        if not os.path.exists(ref):
            ref = os.path.join(ROOT, args.bg_ref)
        glow(master, cur, args.near, args.wide, args.bg_blur, args.edge,
             args.bg_ref and ref, box, args.bg_w, args.bg_r, args.field_r,
             args.bg_smooth, not args.no_surface, args.refl, args.shadow, args.rim, cod)
        n += 1
    print(f'[photos] раунд 4 (глянец, как на 1440) применён к {n} фото')


if __name__ == '__main__':
    main()
