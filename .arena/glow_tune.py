"""Подбор альф постоянного glow под плотность света референса IMG_1441.

Эмулирует слои CSS (radial-gradient у .pshot .rim + box-shadow у .rim::before)
поверх реального товарного кадра. Для тёмной сцены screen-смешивание ≈
обычное наложение с той же альфой, поэтому считается нормальным blend.

Ориентир с мокапа: mean ≈ 40…44, доля пикселей >128 ≈ 6…9%.
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter
import statistics

W, H = 480, 640
CFG = {
    "A": dict(pool_t=.30, pool_w=.16, haze=.07, halo_w=.16, halo_t=.22),   # как в css сейчас
    "B": dict(pool_t=.24, pool_w=.12, haze=.05, halo_w=.12, halo_t=.16),
    "C": dict(pool_t=.20, pool_w=.10, haze=.04, halo_w=.09, halo_t=.13),
    "D": dict(pool_t=.16, pool_w=.08, haze=.03, halo_w=.07, halo_t=.10),
}


def grad_alpha(w, h, cx, cy, rx, ry, a0, stop=.78, blur=0):
    """radial-gradient(rx ry at cx cy, rgba(color, a0), transparent stop%)."""
    m = Image.new("L", (w, h), 0)
    px = m.load()
    for y in range(h):
        fy = (y / h - cy) / (ry)
        for x in range(w):
            fx = (x / w - cx) / rx
            d = (fx * fx + fy * fy) ** .5
            t = 1. - d / stop
            if t > 0:
                px[x, y] = int(255 * a0 * min(1., t))
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return m


def ring_alpha(w, h, blur, spread, a0, inset=(.09, .07, .09, .11)):
    """box-shadow гало: свет снаружи эллипса, внутри — ноль."""
    box = [int(w * inset[0]) - spread, int(h * inset[1]) - spread,
           w - int(w * inset[2]) + spread, h - int(h * inset[3]) + spread]
    inner = [int(w * inset[0]), int(h * inset[1]), w - int(w * inset[2]), h - int(h * inset[3])]
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).ellipse(box, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(blur))
    hole = Image.new("L", (w, h), 0)
    ImageDraw.Draw(hole).ellipse(inner, fill=255)
    hole = hole.filter(ImageFilter.GaussianBlur(blur / 2))
    m = ImageChops.subtract(m, hole).point(lambda v: int(v * a0))
    return m


def over(base, color, mask):
    return Image.composite(Image.new("RGB", base.size, color), base, mask)


def stats(im):
    g = im.convert("L")
    hist = g.histogram()
    return round(statistics.mean(list(g.getdata())), 1), sum(hist[128:]) / sum(hist)


base = Image.open("webapp/assets/products/AG0015-card.jpg").convert("RGB").resize((W, H), Image.LANCZOS)
ref = Image.open("IMG_1441.png").convert("RGB")
for n, box in [("ref stage", (385, 800, 625, 1050)), ("ref row", (78, 1218, 178, 1318))]:
    m, s = stats(ref.crop(box))
    print(f"{n:11} mean={m:6} share>128={s:.1%}")
m, s = stats(base)
print(f"{'card raw':11} mean={m:6} share>128={s:.1%}\n")

tiles = [("ref stage", ref.crop((385, 800, 625, 1050)).resize((W, H))), ("raw", base)]
for name, c in CFG.items():
    cur = base.copy()
    cur = over(cur, (214, 234, 255), grad_alpha(W, H, .5, .84, .30, .09, c["pool_t"], blur=6))
    cur = over(cur, (150, 196, 255), grad_alpha(W, H, .5, .86, .52, .20, c["pool_w"], blur=14))
    cur = over(cur, (130, 178, 255), grad_alpha(W, H, .5, .40, .60, .42, c["haze"], blur=20))
    cur = over(cur, (132, 184, 255), ring_alpha(W, H, 30, 13, c["halo_w"]))
    cur = over(cur, (206, 232, 255), ring_alpha(W, H, 9, 3, c["halo_t"]))
    m, s = stats(cur)
    print(f"{name:11} mean={m:6} share>128={s:.1%}")
    tiles.append((name, cur))

strip = Image.new("RGB", (W * len(tiles), H), (8, 11, 18))
for i, (n, im) in enumerate(tiles):
    strip.paste(im, (i * W, 0))
strip.save(".arena/glow_tune.png")
print("\nsaved .arena/glow_tune.png:", " | ".join(n for n, _ in tiles))
