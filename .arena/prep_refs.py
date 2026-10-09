#!/usr/bin/env python3
"""Готовит референсы для генератора:
   .arena/refs/ref_*.png        — кропы бренд-референсов (цвет, свет, блики)
   .arena/shape/shape-<COD>.png — силуэт из прайса (форма, пропорции, толщина стенок)

Силуэт делается нейтрально-серым на белом поле: генератор должен взять из него
ТОЛЬКО геометрию, а весь свет и цвет — из референсов стиля.
"""
import os, glob, json
from PIL import Image, ImageOps, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARENA = os.path.join(ROOT, '.arena')
REFS = os.path.join(ARENA, 'refs'); SHAPE = os.path.join(ARENA, 'shape')
os.makedirs(REFS, exist_ok=True); os.makedirs(SHAPE, exist_ok=True)

crops = {
    'ref_desktop_hero.png': ('IMG_1440.png', (422, 92, 960, 490)),
    'ref_mobile_home.png': ('IMG_1441.png', (560, 200, 880, 440)),
    'ref_levitating.png': ('IMG_1431.jpeg', (180, 395, 740, 1000)),
}
for out, (src, box) in crops.items():
    p = os.path.join(REFS, out)
    if not os.path.exists(p):
        Image.open(os.path.join(ROOT, src)).convert('RGB').crop(box).save(p)

# позиции, где важно сохранить реальные материалы/цвета (не только геометрию)
KEEP_COLOR = {'AG0027'}
# исходники на тёмном/пёстром фоне: кадрируем вручную, фон в промте — игнорировать
MANUAL_CROP = {'AG0004': (46, 44, 100, 104), 'AG0019': (18, 8, 128, 130)}
DARK_BG = {'AG0004', 'AG0019'}
W2, H2 = 848, 1264  # 2:3

def content_bbox(im):
    """Границы предмета по энергии граней — работает и на пёстром фоне."""
    g = im.convert('L').filter(ImageFilter.GaussianBlur(0.6))
    e = g.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(1.2))
    m = e.point(lambda p: 255 if p > 22 else 0).filter(ImageFilter.MaxFilter(9))
    b = m.getbbox()
    if not b:
        return (0, 0, im.width, im.height)
    return b

def prep(src_path, out_path, keep_color=False):
    im = Image.open(src_path).convert('RGB')
    cod = os.path.basename(src_path)[4:-4]
    if cod in MANUAL_CROP:
        b = MANUAL_CROP[cod]
    else:
        b = content_bbox(im)
    w, h = b[2] - b[0], b[3] - b[1]
    pad = int(max(w, h) * 0.06)
    b = (max(0, b[0] - pad), max(0, b[1] - pad),
         min(im.width, b[2] + pad), min(im.height, b[3] + pad))
    cut = im.crop(b)
    if keep_color:
        work = cut
    else:
        work = ImageOps.autocontrast(cut.convert('L'), cutoff=0.5).convert('RGB')
    scale = min((W2 * 0.80) / work.width, (H2 * 0.86) / work.height)
    big = work.resize((max(1, int(work.width * scale)), max(1, int(work.height * scale))), Image.LANCZOS)
    big = big.filter(ImageFilter.UnsharpMask(radius=2.0, percent=110, threshold=2))
    canvas = Image.new('RGB', (W2, H2), (255, 255, 255))
    canvas.paste(big, ((W2 - big.width) // 2, (H2 - big.height) // 2))
    canvas.save(out_path)
    return canvas.size

meta = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'webapp/assets/products/src-*.png'))):
    cod = os.path.basename(f)[4:-4]
    src = Image.open(f)
    meta[cod] = {'src_w': src.width, 'src_h': src.height,
                 'ar': round(src.height / src.width, 3),
                 'dark_bg': cod in DARK_BG}
    prep(f, os.path.join(SHAPE, f'shape-{cod}.png'), keep_color=cod in KEEP_COLOR)

# пропорции из каталога (высота/диаметр) — для самопроверки силуэта
cat = json.load(open(os.path.join(ROOT, 'data/catalog.json')))
for p in cat['products']:
    m = meta.get(p['id'])
    if m and p.get('heightMm') and p.get('diameterMm'):
        m['pdf_ar'] = round(p['heightMm'] / p['diameterMm'], 3)
with open(os.path.join(ARENA, 'shape_meta.json'), 'w') as f:
    json.dump(meta, f, indent=1, sort_keys=True)
for k, v in sorted(meta.items()):
    print(k, v)
