#!/usr/bin/env python3
"""
Финишная обработка фото товаров под стиль бренд-референса IMG_1440.png
(«как на 1440»). Идемпотентно: мастер лежит в st-<COD>.jpg, результат пишется
в <COD>.jpg (4K) и <COD>-card.jpg (размер карточки витрины).

Разрешение (раунд 5 — «4K»):
  Все радиусы, фильтры и толщины в скрипте подобраны под кадр 848×1264
  (длинная сторона REF_LONG = 1264). При выходе в 4K мастер сначала
  апскейлится LANCZOS-ом шагами не более ×2 (меньше ringing на гранях),
  а каждый пиксельный параметр умножается на S = long_side / REF_LONG —
  то есть оптика кадра масштабируется вместе с разрешением и кадр выглядит
  ровно так же, только крупнее. Итог: <COD>.jpg с длинной стороной 3840
  (2576×3840 при 2:3), качество 95, 4:4:4, progressive.

Порядок шагов (раунд 6 — «парение в фоне витрины»):
  1. --bg-blur    боке: всё, где нет резких граней (фон, дымка), размывается;
                  стекло остаётся резким;
  2. --bg-ref     низкочастотный слой кадра целиком заменяется ровным световым
                  полем референса (вес 1.0): без прожектора, чёрной виньетки и
                  резких краёв. Знако-точная сборка — блики стекла не «съедаются»;
  3. --bg-smooth  фон приводится к ОДНОМУ однородному размытому полю: резким
                  остаётся только предмет (маска силуэта закрыта морфологией,
                  раздута на --bg-grow и растворена на --bg-feather), всё
                  остальное — один и тот же радиус боке, подмешанный к полю
                  референса на --bg-mix. Поэтому в фоне нет ни границы зоны
                  размытия, ни шва горизонта, ни граней генератора;
  3b. --clear     посуда прозрачная: сквозь чашу, дно и стенки видно то же
                  поле фона (частотное разделение: тон — из фона, деталь —
                  своя; --refract даёт лёгкую рефракцию) вместо молочно-синей
                  заливки мастера. Пристенные полосы, ободок и блики --bg-wall
                  остаются резкими, иначе посуда превращается в контурный
                  рисунок без объёма;
  4. --surface / --refl / --shadow  ПОЛ, ЗЕРКАЛЬНОЕ ОТРАЖЕНИЕ И КОНТАКТНАЯ
                  ТЕНЬ ПО УМОЛЧАНИЮ ВЫКЛЮЧЕНЫ. Они и давали ту самую грань:
                  горизонт читаем как линию, а отражение — как световой
                  прямоугольник под предметом. Пока кадр должен незаметно
                  вшиваться в фон приложения, посуда парит (референс
                  Levitating, IMG_1341). Флаги оставлены: --surface --refl .55
                  --shadow .45 возвращают глянец для печатных/баннерных кадров;
  5. --near/--wide/--rim  футуристичный холодный bloom по хайлайтам (голубой
                  ореол) + rim-glow по контуру предмета. Порог маски ореола
                  поднимается сам, когда предмет сам по себе яркий: иначе
                  bloom набирается от всего тела и вокруг предмета читается
                  кольцо с краем;
  6. --fade       КРАЙ КАДРА = ЦВЕТ ФОНА ПРИЛОЖЕНИЯ (--bg #05070d). Витрина
                  кладёт кадр целиком (contain) в контейнер с var(--bg): если
                  по кромке лежит любой другой тон, покупатель видит
                  прямоугольник фотографии и никакого «парения» не выходит.
                  Спад считается по двум осям smoothstep-ом и складывается
                  экраном (не максимумом — максимум рисует ромб по диагоналям),
                  маска не размывается (блюр снимает максимум ровно на границе)
                  и заранее доходит до предела, так что последние ~10% кадра —
                  чистый цвет фона. Проверка: .arena/probe_blend.py;
  7. --card       производный кадр для карточек/миниатюр — витрине не нужен
                  4K на превью в 400 px, а 25 тяжёлых файлов в ленте
                  разорвали бы мобильный трафик.

  pip install pillow
  python3 scripts/build_photos.py                        # дефолт раунда 5 (4K)
  python3 scripts/build_photos.py --only AG0001,AG0004  # точечно
  python3 scripts/build_photos.py --no-surface           # парение без глянца
  python3 scripts/build_photos.py --clear 0 --bg-smooth 0  # только блики, фон и стекло как в мастере
  python3 scripts/build_photos.py --long 1264 --card 0   # старый режим, без 4K
"""
import argparse
import fnmatch
import json
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter, features

try:  # AVIF в Pillow даёт плагин pillow-avif-plugin (или нативный libavif в ≥ 11.3)
    import pillow_avif  # noqa: F401
except ImportError:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DIR = os.path.join(ROOT, 'webapp', 'assets', 'products')
SHAPE_DIR = os.path.join(ROOT, '.arena', 'shape')

# ── масштаб: все пиксельные констаны ниже подобраны под этот референс ───────
REF_LONG = 1264          # длинная сторона кадра, на котором всё настраивалось
_S = 1.0


def set_scale(long_side):
    """Готовит модуль к работе в другом разрешении (S = long / REF_LONG)."""
    global _S
    _S = (float(long_side) / REF_LONG) if long_side else 1.0


def px(v, minimum=1):
    """Пиксельная величина (толщина полосы, отступ) в текущем разрешении."""
    return max(minimum, int(round(v * _S)))


def blur(v, minimum=0.2):
    """Радиус GaussianBlur в текущем разрешении."""
    return max(minimum, float(v) * _S)


def ref_copy(im):
    """Копия кадра в референсном разрешении — для морфологии масок. MaxFilter у
    Pillow — квадратичный по размеру окна, и на 4K дилатация радиусом 63 px
    считалась бы минутами; маска же мягкая, поэтому вычислить её в 848×1264 и
    растянуть на кадр — то же самое, только быстрее."""
    if abs(_S - 1.0) < 1e-3:
        return im
    w = max(1, int(round(im.width / _S)))
    h = max(1, int(round(im.height / _S)))
    return im.resize((w, h), Image.LANCZOS)


def to_full(mask, size):
    """Мягкая маска из референсного разрешения — во весь кадр."""
    return mask if mask.size == tuple(size) else mask.resize(size, Image.BILINEAR)


def upscale(im, size):
    """Апскейл мастера: LANCZOS шагами не более ×2 + мягкий micro-contrast,
    который возвращает резкость тонким граням стекла. Уменьшение — одним
    LANCZOS (он же даёт производный кадр карточки)."""
    W, H = im.size
    tw, th = int(size[0]), int(size[1])
    if (W, H) == (tw, th):
        return im
    if W >= tw or H >= th:
        return im.resize((tw, th), Image.LANCZOS)
    cur = im
    while cur.width * 2 < tw or cur.height * 2 < th:
        cur = cur.resize((min(tw, cur.width * 2), min(th, cur.height * 2)), Image.LANCZOS)
    cur = cur.resize((tw, th), Image.LANCZOS)
    return cur.filter(ImageFilter.UnsharpMask(radius=blur(1.6, 1.2), percent=58, threshold=2))


def save_jpeg(im, path, quality):
    temp = f'{path}.{os.getpid()}.tmp'
    try:
        im.save(temp, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling=0)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)


# ── раунд 8: производные форматы ─────────────────────────────────────────────
# JPEG остаётся каноном (оптика, веса, пробы раундов 5–7 — всё на нём), а рядом
# кладутся .avif и .webp из ТОГО ЖЕ записанного кадра: открываем готовый JPEG и
# перекодируем его пиксели. Поэтому производные совпадают с финалом пиксель в
# пиксель (кромка = --bg сохраняется, пробы зелёные), а весят в 2–4 раза меньше.
# Витрина отдаёт их через <picture><source type=…>, JPEG — фолбэк для WebView
# Telegram и старых браузеров.
DERIV = dict(avif=True, webp=True, avif_q=55, webp_q=70, avif_speed=6)


def _sibling(jpeg_path, ext):
    base, _ = os.path.splitext(jpeg_path)
    return f'{base}.{ext}'


def save_derivatives(jpeg_path, *, avif=None, webp=None,
                     avif_q=None, webp_q=None, avif_speed=None):
    """Пишет <имя>.avif и <имя>.webp рядом с финальным JPEG.

    Возвращает список записанных путей. Молча пропускает формат, для которого
    в Pillow нет кодека (тогда витрина просто отдаст JPEG)."""
    d = DERIV
    avif = d['avif'] if avif is None else avif
    webp = d['webp'] if webp is None else webp
    avif_q = d['avif_q'] if avif_q is None else avif_q
    webp_q = d['webp_q'] if webp_q is None else webp_q
    avif_speed = d['avif_speed'] if avif_speed is None else avif_speed
    if not os.path.exists(jpeg_path):
        return []
    im = Image.open(jpeg_path).convert('RGB')
    out = []
    if avif and features.check('avif'):
        p = _sibling(jpeg_path, 'avif')
        # speed 6 — компромисс: 4K-кадр кодируется секунды, вес почти как у speed 0
        temp = f'{p}.{os.getpid()}.tmp'
        im.save(temp, 'AVIF', quality=int(avif_q), speed=int(avif_speed))
        os.replace(temp, p)
        out.append(p)
    if webp and features.check('webp'):
        p = _sibling(jpeg_path, 'webp')
        temp = f'{p}.{os.getpid()}.tmp'
        im.save(temp, 'WEBP', quality=int(webp_q), method=4)
        os.replace(temp, p)
        out.append(p)
    return out


def smooth_mask(luma, t0=105, t1=225):
    return luma.point(lambda p: 0 if p <= t0 else (255 if p >= t1 else int((p - t0) * 255 / (t1 - t0))))


def bokeh(im, radius=18, edge=14):
    """Размывает фон по маске граней: стекло остаётся резким. Маска строится в
    референсном разрешении (см. ref_copy), размытие — уже во всём кадре."""
    gray = ref_copy(im.convert('L'))
    sharp = (gray.filter(ImageFilter.FIND_EDGES)
                 .filter(ImageFilter.MaxFilter(5))
                 .point(lambda p: 255 if p > edge else 0)
                 .filter(ImageFilter.MaxFilter(13))
                 .filter(ImageFilter.GaussianBlur(5)))
    sharp = to_full(sharp, im.size).filter(ImageFilter.GaussianBlur(blur(5)))
    bg = im.filter(ImageFilter.GaussianBlur(blur(radius)))
    return Image.composite(im, bg, sharp)


def ref_field(path, box_crop, size, radius):
    """Ровное световое поле референса: та же оптика фона, без стекла и деталей.
    Радиус размытия НЕ масштабируется под кадр: он задан для кропа референса
    (518×378 у IMG_1440) и в его же разрешении и применяется — иначе на 4K
    размытие съедает вертикальный градиент света и кадр уходит в черноту."""
    im = Image.open(path).convert('RGB')
    if box_crop:
        im = im.crop(box_crop)
    im = im.filter(ImageFilter.GaussianBlur(max(0.2, float(radius))))
    im = im.resize(size, Image.LANCZOS)
    return im


def _apply_low(im, new_low, radius=90):
    """Знако-точная замена низкочастотного слоя (gain/loss), детали не трогает."""
    low = im.filter(ImageFilter.GaussianBlur(blur(radius)))
    gain = ImageChops.subtract(new_low, low)
    loss = ImageChops.subtract(low, new_low)
    return ImageChops.subtract(ImageChops.add(im, gain), loss)


def match_bg(im, field, weight=1.0, radius=90):
    """Низкочастотный слой кадра приводится к световому полю референса: без
    прожектора, стола, шва горизонта, отражений и чёрной виньетки. При
    weight=1.0 крупные структуры фона полностью уходят в ровное поле."""
    low = im.filter(ImageFilter.GaussianBlur(blur(radius)))
    new_low = Image.blend(low, field, weight)
    return _apply_low(im, new_low, radius)


def vgrad(W, H, stops):
    """Вертикальный градиент: stops = [(y, value), ...] с линейными переходами.
    Остановки приходят уже в пикселях текущего разрешения."""
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


def _protect_mask(size, bbox, blur_r=48):
    W, H = size
    mx = max(16, int(W * 0.10))
    my = max(16, int(H * 0.08))
    x0, y0, x1, y1 = bbox
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).rectangle(
        (max(0, x0 - mx), max(0, y0 - my), min(W, x1 + mx), min(H, y1 + my)), fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur_r))


def shape_geometry(cod, size):
    """Геометрия предмета из силуэта прайса (белый фон, предмет не белый).
    Возвращает (protect_mask, obj_mask, bbox) или (None, None, None)."""
    p = os.path.join(SHAPE_DIR, f'shape-{cod}.png')
    if not os.path.exists(p):
        return None, None, None
    sh = Image.open(p).convert('RGB')
    if sh.size != tuple(size):
        sh = sh.resize(size, Image.LANCZOS)
    r, g, b = (ImageChops.invert(ch) for ch in sh.split())
    dev = ImageChops.lighter(ImageChops.lighter(r, g), b)  # отклонение от белого
    binm = dev.point(lambda v: 255 if v > 6 else 0).filter(ImageFilter.MaxFilter(3))
    bbox = binm.getbbox()
    if not bbox:
        return None, None, None
    obj = binm.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(8))
    return _protect_mask(size, bbox), obj, bbox


def master_geometry(im, cod, zone_x=(0.15, 0.85)):
    """Геометрия предмета по самому кадру мастера: на ровном тёмном фоне предмет
    — это яркие блики (hi) и контуры. Основание (y1) — самый нижний ряд, где
    яркие блики занимают заметную ширину (тень под предметом отсекается).
    Возвращает (protect_mask, obj_mask, bbox). Если бликов нет, фон «грязный»
    (диск/поверхность — старые мастера) или геометрия неправдоподобна —
    фолбэк на силуэт прайса.

    zone_x — окна по X, в которых ищутся блики/контуры: для одиночного предмета
    это 15% полей по краям, для сцен раунда 7 (группа стекла со сдвигом вправо,
    og:image) — шире, иначе правый предмет обрезается детекцией."""
    W, H = im.size
    L = im.convert('L')
    hi = L.point(lambda v: 255 if v > 205 else 0).filter(ImageFilter.MaxFilter(5))
    zone = Image.new('L', (W, H), 0)
    ImageDraw.Draw(zone).rectangle(
        (int(W * zone_x[0]), int(H * 0.04), int(W * zone_x[1]), H), fill=255)
    hi = ImageChops.multiply(hi, zone)
    total = sum(hi.histogram()[1:])
    if total < 300:  # нет ярких бликов — фолбэк
        return shape_geometry(cod, (W, H))
    rowfrac = [v / 255 for v in hi.resize((1, H), Image.BILINEAR).tobytes()]
    ys = [y for y, f in enumerate(rowfrac) if f > 0.01]
    if not ys:
        return shape_geometry(cod, (W, H))
    y0, y1 = min(ys), max(ys)
    # ширина предмета — по контурам (края ловят стенки точнее бликов)
    e0 = L.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 22 else 0)
    cap = Image.new('L', (W, H), 0)
    ImageDraw.Draw(cap).rectangle((0, max(0, y0 - 4), W, min(H, y1 + 6)), fill=255)
    ez = ImageChops.multiply(e0, ImageChops.multiply(zone, cap))
    colfrac = [v / 255 for v in ez.resize((W, 1), Image.BILINEAR).tobytes()]
    xs = [x for x, f in enumerate(colfrac) if f > 0.01]
    if not xs:
        colfrac = [v / 255 for v in hi.resize((W, 1), Image.BILINEAR).tobytes()]
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


def frame_geometry(im, cod, zone_x=(0.15, 0.85)):
    """Геометрия кадра в целевом разрешении: морфология считается в референсном
    размере (см. ref_copy), мягкие маски и bbox растягиваются во весь кадр."""
    protect, obj, bbox = master_geometry(ref_copy(im), cod, zone_x)
    if bbox is None:
        return None, None, None
    if abs(_S - 1.0) > 1e-3:
        protect = to_full(protect, im.size)
        obj = to_full(obj, im.size)
        bbox = tuple(int(round(v * _S)) for v in bbox)
    return protect, obj, bbox


def field_bg(im, obj_mask, field=None, radius=150, grow=26, feather=34,
             mix=0.35, wall=26, fallback=None):
    """Однородное световое поле кадра и маски предмета.

    Возвращает (bg, keep, inner):
      bg    — фон, до которого зачищается всё вне предмета: ОДНА большая
              гауссова копия кадра (текстура, дымка, следы генератора и шов
              горизонта уходят целиком) + световое поле референса;
      keep  — мягкая маска предмета: внутри неё остаётся резкий оригинал;
      inner — «нутро» предмета: closed-маска минус пристенная полоса wall px
              (для шага прозрачности).

    Заменять только низкие частоты (match_bg) мало: «волокно» и дымка лежат в
    средних частотах и переживают такую правку, а по краю защищённого
    прямоугольника читается граница зоны. Поэтому фон пересобирается целиком,
    а маска строится по силуэту, а не по bbox. Маска закрывается морфологией
    (Max→Min), чтобы внутри чаши не оставалось «окошек» с резким фоном."""
    if obj_mask is None:
        obj_mask = fallback
    if obj_mask is None:
        bg = im.filter(ImageFilter.GaussianBlur(blur(radius)))
        if field is not None and mix:
            bg = Image.blend(bg, field, mix)
        return bg, None, None
    m = ref_copy(obj_mask)
    kg = max(3, grow | 1)                        # нечётный диаметр окна, ref-пиксели
    closed = m.filter(ImageFilter.MaxFilter(kg)).filter(ImageFilter.MinFilter(kg))
    kw = max(3, wall | 1)
    band = ImageChops.subtract(closed, closed.filter(ImageFilter.MinFilter(kw)))
    inner = ImageChops.subtract(closed, band)
    soft = closed.filter(ImageFilter.GaussianBlur(max(0.5, feather)))
    bg = im.filter(ImageFilter.GaussianBlur(blur(radius)))
    if field is not None and mix:
        bg = Image.blend(bg, field, mix)
    return bg, to_full(soft, im.size), to_full(inner.filter(ImageFilter.GaussianBlur(6)), im.size)


def clear_crystal(im, bg, inner, strength=0.72, refract=1.05, hi_keep=168, detail=0.92):
    """Хрусталь прозрачный: сквозь чашу, дно и стенки видно то же фоновое поле,
    а не молочно-синюю заливку мастера — но стекло при этом остаётся ВИДНЫМ.

    Частотное разделение: из нутра предмета берём только деталь (тонкие стенки,
    ободок, каустика, блики), а низкочастотный тон заменяем полем фона с лёгким
    увеличением refract — это и есть рефракция. Если вместо этого просто
    залить нутро полем, посуда превращается в контурный рисунок без объёма;
    если оставить тон мастера — в мутный стакан. detail<1 слегка приглушает
    собственную дымку стекла, >1 — усиливает.

    Резкость дополнительно держим на пристенных полосах и ярких бликах
    (hi_keep вычитается из inner), strength=0 выключает шаг."""
    if inner is None or not strength:
        return im
    L = ref_copy(im.convert('L'))
    hi = (L.point(lambda v: 255 if v > hi_keep else 0)
             .filter(ImageFilter.MaxFilter(5))
             .filter(ImageFilter.GaussianBlur(3)))
    alpha = ImageChops.subtract(inner, to_full(hi, inner.size))
    W, H = im.size
    z = max(1.0, float(refract))
    cx, cy = int(W * (z - 1) / 2 / z), int(H * (z - 1) / 2 / z)
    refr = bg.crop((cx, cy, max(cx + 1, W - cx), max(cy + 1, H - cy))).resize((W, H), Image.LANCZOS)
    # тон внутрь — поле, деталь — своя: знако-точная пересадка низких частот
    seen = _apply_low(im, refr, blur(26, 1))
    if detail != 1.0:
        seen = Image.blend(refr, seen, detail)
    alpha = alpha.filter(ImageFilter.GaussianBlur(blur(3))).point(lambda v: int(v * strength))
    return Image.composite(seen, im, alpha)


def add_surface(im, bbox, darken=0.55, band=30, band_gain=0.22, fade=170, soft=70):
    """Глянцевая поверхность ниже основания предмета: плавное (без шва)
    затемнение низкочастотного слоя + световая полоса блика глянца.
    Полоса намеренно широкая и слабая (fade больше половины высоты предмета,
    размытие soft) — иначе под основанием читается горизонт-«грани»."""
    if bbox is None:
        return im
    W, H = im.size
    band, fade = px(band), px(fade)   # толщины заданы в px референса
    y1 = bbox[3]
    low = im.filter(ImageFilter.GaussianBlur(blur(70)))
    base = low.crop((0, max(0, y1 - px(10)), W, min(H, y1 + px(10)))).resize((1, 1), Image.LANCZOS).getpixel((0, 0))
    dark = tuple(int(c * darken) for c in base)
    grad = vgrad(W, H, [(y1 - fade, 0), (y1 + fade, 255)]).filter(ImageFilter.GaussianBlur(blur(8)))
    new_low = Image.composite(Image.new('RGB', (W, H), dark), low, grad)
    # световая полоса блика глянца под горизонтом
    hi = Image.new('RGB', (W, H), (0, 0, 0))
    ImageDraw.Draw(hi).rectangle(
        (0, y1 + px(4), W, y1 + px(4) + band),
        fill=tuple(min(255, int(c * (1 + band_gain))) for c in base))
    hi = hi.filter(ImageFilter.GaussianBlur(blur(soft)))
    # полоса размазана широко (6·band вверх и вниз) и поднимается плавно:
    # иначе на границе блика читается горизонт-«линия»
    band_mask = vgrad(W, H, [(y1 - 6 * band, 0), (y1 + 2 * band, 255), (y1 + 8 * band, 0)])
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
    refl = refl.filter(ImageFilter.GaussianBlur(blur(2)))
    refl = refl.point(lambda v: min(255, int(v * 0.85 + 35)))
    layer = Image.new('RGB', (W, H), (0, 0, 0))
    layer.paste(refl, (x0, y1))
    full_mask = Image.new('L', (W, H), 0)
    full_mask.paste(fmask, (x0, y1))
    fade_h = max(px(8), int(h_obj * fade))
    alpha = ImageChops.multiply(
        full_mask,
        vgrad(W, H, [(y1, 255), (y1 + fade_h, 0)]).filter(ImageFilter.GaussianBlur(blur(6))))
    # верхняя кромка отражения растворена, иначе отзеркаленный блик основания
    # даёт на горизонте яркую линию
    alpha = alpha.filter(ImageFilter.GaussianBlur(blur(7)))
    alpha = alpha.point(lambda v: int(v * strength))
    return ImageChops.screen(im, ImageChops.multiply(layer, alpha.convert('RGB')))


def contact_shadow(im, bbox, strength=0.45, color=(5, 10, 22)):
    """Контактная тень у основания: предмет стоит на глянце."""
    if bbox is None:
        return im
    W, H = im.size
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) // 2
    rx = int(max(px(8), (x1 - x0) * 0.30))
    ry = max(px(4), int(H * 0.018))
    m = Image.new('L', (W, H), 0)
    ImageDraw.Draw(m).ellipse((cx - rx, y1 - ry // 2, cx + rx, y1 + ry + ry // 2), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(blur(10)))
    m = m.point(lambda v: int(v * strength))
    return Image.composite(Image.new('RGB', (W, H), color), im, m)


def _axis_ramp(n, start=0.30, over=1.15):
    """Спад к краю по одной оси: 0 в центре, 255 у границы.

    smoothstep (t²·(3−2t)) вместо степени: нулевая производная и на старте, и
    на финише — поэтому у начала спада и у кромки нет излома, который глаз
    читает как «грань». over > 1 добирает маску до предела заранее: последние
    ~10% кадра идут уже чистым цветом фона, и JPEG не успевает оставить на
    границе полосу в пару единиц."""
    d = []
    half = (n - 1) / 2 or 1
    for i in range(n):
        t = abs(i - half) / half
        t = 0.0 if t <= start else (t - start) / (1 - start)
        t = min(1.0, t * over)
        d.append(int(round(255 * t * t * (3 - 2 * t))))
    return d


def fade_to_bg(im, color=(5, 7, 13), start=0.30, over=1.15, strength=1.0):
    """Край кадра = цвет фона приложения (--bg #05070d).

    Витрина кладёт кадр целиком (contain) в контейнер с фоном var(--bg) и
    слегка приближает его (--zoom). Если по кромке кадра лежит любой другой
    тон — даже на 3 единицы светлее — покупатель видит прямоугольник
    фотографии, «грань», и стекло перестаёт пареть в интерфейсе. Поэтому
    последние ~30% полуоси плавно сводятся к цвету фона.

    Две осевые ramps складываются ЭКРАНОМ (screen), а не максимумом:
    максимум даёт излом на диагоналях и по кромке видно ромб — ту же грань,
    только мягче. Screen (`1−(1−a)(1−b)`) плавен везде, при этом достигает 1 на
    любом из четырёх краёв, включая середины сторон. Маску НЕ размываем:
    блюр снимает максимум ровно на границе и возвращает видимый край.

    Побочный эффект, который нам нужен: размытая подложка карточки (тот же
    кадр, cover) по краям даёт ровно тот же цвет, что и контейнер, — шва
    «картинка / интерфейс» нет ни в сетке, ни в сцене товара, ни в миниатюрах."""
    W, H = im.size
    hx = Image.new('L', (W, 1)); hx.putdata(_axis_ramp(W, start, over))
    vy = Image.new('L', (1, H)); vy.putdata(_axis_ramp(H, start, over))
    m = ImageChops.screen(hx.resize((W, H), Image.BILINEAR), vy.resize((W, H), Image.BILINEAR))
    if strength < 1:
        m = m.point(lambda v: int(v * strength))
    return Image.composite(Image.new('RGB', im.size, color), im, m)


def fut_bloom(im, near=0.55, wide=0.30, t0=105, t1=225, near_r=30, wide_r=9):
    """Футуристичный холодный bloom: голубой ореол по хайлайтам.

    Порог маски (t0/t1) поднимается, когда предмет сам по себе яркий: иначе
    ореол набирается от всего тела стекла и превращается в читаемое кольцо с
    краем вокруг предмета — фон должен оставаться однородным полем.
    wide_r больше → ореол шире и мягче."""
    W, H = im.size
    mask = smooth_mask(im.convert('L'), t0, t1)
    hi = ImageChops.multiply(im, mask.convert('RGB'))
    c_near = (int(0.55 * near * 255), int(0.75 * near * 255), int(near * 255))
    c_wide = (int(0.35 * wide * 255), int(0.55 * wide * 255), int(0.95 * wide * 255))
    b1 = ImageChops.multiply(hi.filter(ImageFilter.GaussianBlur(max(W, H) // near_r)),
                             Image.new('RGB', (W, H), c_near))
    b2 = ImageChops.multiply(hi.filter(ImageFilter.GaussianBlur(max(W, H) // wide_r)),
                             Image.new('RGB', (W, H), c_wide))
    return ImageChops.screen(ImageChops.screen(im, b1), b2)


def rim_glow(im, obj_mask, strength=0.5, color=(70, 130, 230), blur_r=18):
    """Холодное свечение по контуру предмета (футуристичный край)."""
    if obj_mask is None:
        return im
    m = ref_copy(obj_mask)                       # дилатация/эрозия — в ref-размере
    body = m.filter(ImageFilter.MinFilter(5))
    edge = to_full(ImageChops.subtract(m, body), im.size)
    edge = edge.filter(ImageFilter.GaussianBlur(blur(blur_r))).point(lambda v: int(v * strength))
    glow = Image.new('RGB', im.size, color)
    return ImageChops.screen(im, ImageChops.multiply(glow, edge.convert('RGB')))


def save_fit(im, path, q, max_kb=None):
    """JPEG с потолком веса (раунд 7: hero ≤ 350 КБ, обложки/og ≤ 200 КБ):
    сначала снижаем качество, потом — размер. Поле фона гладкое, поэтому
    качество падает незаметно."""
    if not max_kb:
        save_jpeg(im, path, q)
        return q
    limit = int(max_kb) * 1024
    cur = im
    for qq in range(q, 66, -4):
        save_jpeg(cur, path, qq)
        if os.path.getsize(path) <= limit:
            return qq
    k = 0.94
    while os.path.getsize(path) > limit and k > 0.72:
        cur = cur.resize((max(1, int(cur.width * k)), max(1, int(cur.height * k))),
                         Image.LANCZOS)
        save_jpeg(cur, path, 80)
        k *= 0.94
    return 80


def glow(path, out, *, near=0.55, wide=0.30, bg_blur=18, edge=14,
         bg_ref=None, bg_box=None, bg_w=1.0, bg_r=90, field_r=120,
         bg_smooth=150, bg_grow=26, bg_feather=34, bg_mix=0.92, bg_wall=26,
         clear=0.72, refract=1.05, clear_detail=0.92, surface=False, refl=0.0,
         shadow=0.0, rim=0.4, cod=None, band_gain=0.22, surface_fade=170,
         fade=True, fade_color=(5, 7, 13), fade_start=0.30, fade_over=1.15,
         long_side=None, card=None, q=95, qc=88, qpath=None,
         max_kb=None, zone_x=(0.15, 0.85)):
    """Мастер → финальный кадр (и, если задано, производный кадр карточки).
    Все шаги считаются в целевом разрешении: set_scale() подгоняет оптику."""
    im = Image.open(path).convert('RGB')
    if long_side:
        k = float(long_side) / max(im.size)
        if k > 1.001:
            size = (int(round(im.width * k)), int(round(im.height * k)))
            im = upscale(im, size)
    protect, obj_mask, bbox = frame_geometry(im, cod, zone_x) if cod else (None, None, None)
    field = ref_field(bg_ref, bg_box, im.size, field_r) if bg_ref and os.path.exists(bg_ref) else None
    if bg_blur:
        im = bokeh(im, bg_blur, edge)
    if field is not None:
        im = match_bg(im, field, bg_w, bg_r)
    bg, keep, inner = field_bg(im, obj_mask, field, bg_smooth, bg_grow,
                               bg_feather, bg_mix, bg_wall, protect)
    if bg_smooth and keep is not None:
        im = Image.composite(im, bg, keep)
    if clear:
        im = clear_crystal(im, bg, inner, clear, refract, detail=clear_detail)
    if surface:
        im = add_surface(im, bbox, band_gain=band_gain, fade=surface_fade)
    if refl:
        im = add_reflection(im, obj_mask, bbox, refl)
    if shadow:
        im = contact_shadow(im, bbox, shadow)
    # чем больше в кадре яркого тела (а не только бликов), тем выше порог
    # маски ореола и тем шире и слабее сам ореол — иначе вокруг светлого
    # предмета (чайник с чаем) bloom читается кольцом с краем
    L = im.convert('L')
    bright = sum(L.histogram()[150:]) / (im.width * im.height)
    t0 = 105 + min(120, int(bright * 900))
    im = fut_bloom(im, near, wide * (1.0 - min(0.45, bright * 4)),
                   t0=t0, t1=250, near_r=34, wide_r=6)
    if rim:
        im = rim_glow(im, obj_mask, rim)
    if fade:
        im = fade_to_bg(im, fade_color, fade_start, fade_over)
    save_fit(im, out, q, max_kb)
    derive_from_final(out)
    if card:
        scale = float(card) / max(im.size)
        if scale < 0.999:
            small = im.resize((max(1, int(round(im.width * scale))),
                               max(1, int(round(im.height * scale)))), Image.LANCZOS)
            card_path = qpath or out.replace('.jpg', '-card.jpg')
            save_jpeg(small, card_path, qc)
            derive_from_final(card_path)


def derive_from_final(jpeg_path):
    """Производные .avif/.webp для уже записанного финального кадра (раунд 8)."""
    return save_derivatives(jpeg_path)


OVERRIDES_PATH = os.path.join(ROOT, 'data', 'photo_overrides.json')

# ключи реестра data/photo_overrides.json, которые могут переопределять дефолт
PARAM_KEYS = ('near', 'wide', 'rim', 'bg_blur', 'edge', 'bg_w', 'bg_r', 'field_r',
              'bg_smooth', 'bg_grow', 'bg_feather', 'bg_mix', 'bg_wall', 'clear',
              'refract', 'clear_detail', 'surface', 'refl', 'shadow', 'band_gain',
              'surface_fade', 'fade', 'fade_start', 'fade_over', 'q', 'qc')


def load_overrides():
    """Точечные отклонения от дефолтов по позициям/сценам (раунд 7): у чайника
    --clear съедает деревянную ручку, у шотов и гравировок блики узора
    пропадают — реестр правит это без новых флагов."""
    try:
        with open(OVERRIDES_PATH, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def match_only(token, jid):
    """Маски --only: AG* (товары), hero-*, covers/*, og; сокращения hero/covers."""
    t = token.strip()
    if t == 'hero':
        t = 'hero-*'
    if t == 'covers':
        t = 'covers/*'
    return fnmatch.fnmatchcase(jid, t) or jid == t


def derive_jobs(only):
    """Раунд 8, режим --derive-only: список уже готовых финальных JPEG, которым
    нужны производные. Оптика не пересчитывается — кадры берутся как есть,
    поэтому JPEG (и его вес, и пробы раундов 5–7) не меняются вовсе.

    og.jpg пропускаем намеренно: валидаторам соцсетей нужен именно JPEG."""
    webapp = os.path.join(ROOT, 'webapp')
    # (каталог, префикс id для --only, с чего начинаются файлы, которые не трогаем)
    plans = [
        (DIR, '', ('st-', 'fb-')),                                       # товары: AG0001, AG0001-card
        (os.path.join(webapp, 'assets', 'brand'), '', ('st-', 'og')),     # hero-01, hero-01-m
        (os.path.join(webapp, 'assets', 'covers'), 'covers/', ('st-',)),  # covers/bullet
    ]
    jobs = []
    for folder, prefix, skip in plans:
        if not os.path.isdir(folder):
            continue
        for f in sorted(os.listdir(folder)):
            if not f.endswith('.jpg') or f.startswith(skip):
                continue
            jid = f'{prefix}{f[:-4]}'
            if only and not any(match_only(t, jid) for t in only):
                continue
            jobs.append((jid, os.path.join(folder, f)))
    return jobs


def main():
    import scenes
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true',
                    help='напечатать эффективные параметры по каждой позиции/сцене и ничего не писать')
    ap.add_argument('--long', type=int, default=3840,
                    help='длинная сторона финального кадра, px (3840 = 4K); 0 — оставить размер мастера')
    ap.add_argument('--card', type=int, default=1280,
                    help='длинная сторона кадра для карточек (<COD>-card.jpg), px; 0 — не делать')
    ap.add_argument('--q', type=int, default=95, help='качество JPEG финального кадра')
    ap.add_argument('--qc', type=int, default=88, help='качество JPEG кадра карточки')
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
    ap.add_argument('--bg-smooth', type=float, default=150,
                    help='радиус, до которого вычищается фон вне предмета, 0 — выключено')
    ap.add_argument('--bg-mix', type=float, default=0.6,
                    help='доля светового поля референса в фоне: выше — меньше световых «тарелок» мастера')
    ap.add_argument('--bg-wall', type=int, default=26, help='ширина пристенной полосы, где стекло остаётся резким, px')
    ap.add_argument('--clear', type=float, default=0.72,
                    help='прозрачность стекла: доля фона, видимая сквозь чашу/дно, 0 — выключено')
    ap.add_argument('--refract', type=float, default=1.05, help='увеличение фона под стеклом (рефракция)')
    ap.add_argument('--clear-detail', type=float, default=0.92,
                    help='сколько собственной детали стекла оставлять под полем фона')
    ap.add_argument('--bg-grow', type=int, default=26, help='насколько маска предмета раздута в фон')
    ap.add_argument('--bg-feather', type=int, default=34, help='мягкость перехода резкости, px')
    ap.add_argument('--band-gain', type=float, default=0.22, help='яркость полосы глянца под горизонтом')
    ap.add_argument('--surface-fade', type=int, default=170, help='растяжка затемнения под основанием, px')
    ap.add_argument('--surface', action='store_true',
                    help='глянцевый пол с горизонтом; по умолчанию ВЫКЛЮЧЕН — пол и есть та самая «грань»')
    ap.add_argument('--no-surface', action='store_true', help='устарело: глянец и так выключен')
    ap.add_argument('--refl', type=float, default=0.0, help='зеркальное отражение на глянце, 0 — выключено (по умолчанию)')
    ap.add_argument('--shadow', type=float, default=0.0, help='контактная тень у основания, 0 — выключено (по умолчанию)')
    ap.add_argument('--fade', type=float, default=1.0,
                    help='растворение края кадра в --bg (0 — выключено)')
    ap.add_argument('--fade-color', default='5,7,13', help='цвет фона приложения: r,g,b')
    ap.add_argument('--fade-start', type=float, default=0.30, help='доля полуоси без спада')
    ap.add_argument('--fade-over', type=float, default=1.15,
                    help='запас кривой спада: при 1.15 последние ~10% кадра = ровно --bg')
    ap.add_argument('--only', default='', help='список кодов через запятую, например AG0001,AG0004')
    # ── раунд 8: производные AVIF/WebP (по умолчанию включены) ──
    ap.add_argument('--avif', dest='avif', action='store_true', default=True,
                    help='писать <имя>.avif рядом с финалом (по умолчанию вкл)')
    ap.add_argument('--no-avif', dest='avif', action='store_false', help='не писать .avif')
    ap.add_argument('--webp', dest='webp', action='store_true', default=True,
                    help='писать <имя>.webp рядом с финалом (по умолчанию вкл)')
    ap.add_argument('--no-webp', dest='webp', action='store_false', help='не писать .webp')
    ap.add_argument('--avif-q', type=int, default=55, help='качество AVIF производных (дефолт 55)')
    ap.add_argument('--webp-q', type=int, default=70, help='качество WebP производных (дефолт 70)')
    ap.add_argument('--avif-speed', type=int, default=6, help='скорость кодера AVIF 0…10 (дефолт 6)')
    ap.add_argument('--derive-only', action='store_true',
                    help='не считать оптику: только дописать .avif/.webp к уже готовым финалам')
    args = ap.parse_args()

    DERIV.update(avif=args.avif, webp=args.webp, avif_q=args.avif_q,
                 webp_q=args.webp_q, avif_speed=args.avif_speed)
    if args.avif and not features.check('avif'):
        print('[photos] AVIF недоступен в этом Pillow — .avif пропущен '
              '(pip install pillow-avif-plugin)')
    if args.webp and not features.check('webp'):
        print('[photos] WebP недоступен в этом Pillow — .webp пропущен')

    only = [t.strip() for t in args.only.split(',') if t.strip()]

    if args.derive_only:
        jobs = derive_jobs(only)
        written = 0
        for jid, path in jobs:
            made = derive_from_final(path)
            if not made:
                continue
            kb = '  '.join(f'{os.path.splitext(p)[1][1:]} {os.path.getsize(p) / 1024:.0f} КБ'
                           for p in made)
            src = os.path.getsize(path) / 1024
            print(f'[derive] {jid:<18} jpg {src:>6.0f} КБ → {kb}')
            written += len(made)
        print(f'[derive] {written} производных от {len(jobs)} финалов '
              f'(avif q{args.avif_q} speed{args.avif_speed}, webp q{args.webp_q})')
        return

    box = tuple(int(v) for v in args.bg_box.split(',')) if args.bg_ref and args.bg_box else None
    ref = args.bg_ref if os.path.isabs(args.bg_ref) else os.path.join(ROOT, args.bg_ref)
    if args.bg_ref and not os.path.exists(ref):
        ref = os.path.join(ROOT, args.bg_ref)

    # ── задания: товары (4K + карточка) и сцены раунда 7 (hero/обложки/og) ──
    jobs = []
    for f in sorted(os.listdir(DIR)):
        if not f.startswith('st-AG') or not f.endswith('.jpg'):
            continue
        cod = f[3:-4]
        jobs.append(dict(id=cod, master=os.path.join(DIR, f),
                         out=os.path.join(DIR, f'{cod}.jpg'),
                         qpath=os.path.join(DIR, f'{cod}-card.jpg'),
                         scale=args.long, long_side=args.long, card=args.card,
                         q=args.q, qc=args.qc, max_kb=None, zone_x=(0.15, 0.85)))
    webapp = os.path.join(ROOT, 'webapp')
    for sc in scenes.SCENES:
        if not os.path.exists(scenes.master_path(sc, webapp)):
            continue  # мастер ещё не собран — compose_masters.py
        jobs.append(dict(id=sc['id'], master=scenes.master_path(sc, webapp),
                         out=os.path.join(webapp, sc['out']), qpath=None,
                         scale=max(sc['size']), long_side=None, card=None,
                         q=sc.get('q', 92), qc=88, max_kb=sc.get('max_kb'),
                         zone_x=sc.get('zone_x', (0.15, 0.85)),
                         # правила кадра раунда 7: фон — одно поле референса;
                         # у товаров свой исторический дефолт 0.6 (идемпотентность).
                         # fade_start позже: в широком кадре группа стекла доходит
                         # до 0.8W — при товарном 0.30 правое стекло темнеет
                         sdef=dict(bg_mix=0.92, fade_start=sc.get('fade_start', 0.55),
                                 fade_over=sc.get('fade_over', 1.15))))

    if only:
        jobs = [j for j in jobs if any(match_only(t, j['id']) for t in only)]

    overrides = load_overrides()
    n = 0
    for j in jobs:
        kw = dict(near=args.near, wide=args.wide, bg_blur=args.bg_blur, edge=args.edge,
                  bg_ref=args.bg_ref and ref, bg_box=box, bg_w=args.bg_w, bg_r=args.bg_r,
                  fade_color=tuple(int(v) for v in args.fade_color.split(',')),
                  fade=args.fade > 0, fade_start=args.fade_start, fade_over=args.fade_over,
                  field_r=args.field_r, bg_smooth=args.bg_smooth, bg_grow=args.bg_grow,
                  bg_mix=args.bg_mix, bg_wall=args.bg_wall, clear=args.clear,
                  refract=args.refract, clear_detail=args.clear_detail,
                  bg_feather=args.bg_feather, surface=args.surface, refl=args.refl,
                  shadow=args.shadow, rim=args.rim,
                  band_gain=args.band_gain, surface_fade=args.surface_fade)
        kw.update(j.get('sdef', {}))
        ov = {k: v for k, v in overrides.get(j['id'], {}).items() if k in PARAM_KEYS}
        kw.update(ov)
        if args.dry:
            eff = '  '.join(f'{k}={kw[k]}' for k in
                            ('clear', 'near', 'wide', 'rim', 'bg_mix', 'clear_detail', 'fade'))
            note = f'  ← реестр: {", ".join(ov)}' if ov else ''
            print(f"{j['id']:>24}  {eff}{note}")
            continue
        set_scale(j['scale'])
        if not os.path.exists(j['master']):
            print(f"[photos] {j['id']}: нет мастера {j['master']} — пропуск")
            continue
        glow(j['master'], j['out'],
             long_side=j['long_side'], card=j['card'], q=j['q'], qc=j['qc'],
             qpath=j['qpath'], max_kb=j['max_kb'], zone_x=j['zone_x'],
             cod=j['id'], **kw)
        n += 1
    if args.dry:
        print(f'[photos] --dry: {len(jobs)} заданий, ничего не записано')
        return
    size = f'{args.long} px (4K)' if args.long >= 3000 else (f'{args.long} px' if args.long else 'размер мастера')
    print(f'[photos] раунд 7: {n} кадров (товары в {size}'
          + (f' + карточки {args.card} px' if args.card else '')
          + f', качество JPEG {args.q}/{args.qc})')


if __name__ == '__main__':
    main()
