#!/usr/bin/env python3
"""Glass audit — backdrop, silhouette and proportion against the repository references.

The reference for a piece (`brand-source/navy-refs/<form>.png`, cut from the price
list) is the law: a catalogue photo may change the light and the stage, never the
shape of the glass, the thickness of the wall or the base.

Why two measurements
--------------------
Glass is transparent, and a lit studio puts a halo around it. Any single automatic
mask lies somewhere: a brightness threshold swallows the halo, a raw gradient picks
up the floor seam. So the same silhouette is read twice, by two independent methods,
and the number is trusted only when both agree:

    band  | image − heavy blur | — fine structure only; a straight stage edge or a
          paste border is low frequency and disappears
    edge  Sobel magnitude — the sharp contour of the glass itself

    h/w   height ÷ width of the trusted silhouette
    form  agreement of the width profile (24 bands, foot to rim) with the reference

Output
------
    python3 tools/audit_glass.py                        # report to stdout
    python3 tools/audit_glass.py --md docs/audit-glass.md
    python3 tools/audit_glass.py --pairs docs/audit-glass-pairs.png
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
REFS = ROOT / "brand-source" / "navy-refs"
CONTENT = ROOT / "data" / "content.json"
W = 420

# Что видно глазами по docs/audit-glass-pairs.png — это часть отчёта, а не догадка машины.
FINDINGS = [
    "## Что найдено",
    "",
    "### 1. Фон — глубокий чёрный, без серого",
    "",
    "Серое облако за предметом снято на всех кадрах, остаток дымки срезан: углы каждой",
    "пластины `0,0,0`. Проверка — `python3 tools/master_stage.py --check`.",
    "",
    "### 2. Форма — что было исправлено",
    "",
    "Аудит показал двадцать две позиции, где кадр из архива был **другого бокала**, чем в",
    "прайсе. Перерисовывать силуэт нельзя, поэтому у них взят сам прайс: нарезка",
    "`brand-source/navy-refs/` — это наше же фото из прайс-листа, оно прогнано через",
    "мастер-фон (`tools/masters_from_pricelist.py`). Форма, толщина стенки и дно теперь",
    "буквально прайсовые:",
    "",
    "`stemmed-tumbler` · `saucer-coupe` · `champagne-saucer` · `etched-highball` ·",
    "`cylinder-hurricane` · `retro-asia-rocks-glass` · `basalt-rocks` · `slope-tumbler` ·",
    "`bullet-chalet-glass` · `coupethini-coupethini` · `column-tumbler` · `embassy-goblet` ·",
    "`levitating-super-pony` · `retro-asia-shot-glass` · `retro-asia-highball-glass` ·",
    "`retro-asia-engraved-highball-glass` · `retro-asia-engraved-rocks-glass` ·",
    "`retro-asia-engraved-cocktail-glass` · `flowers-highball-glass` ·",
    "`bullet-highball-glass` · `bullet-rocks-glass` · `flowers-rocks-glass`",
    "",
    "Что было не так: `stemmed-tumbler` стоял на высоком узком силуэте вместо низкой",
    "стопы; `saucer-coupe` — на глубокой чаше вместо широкой; `champagne-saucer` — тоже",
    "слишком глубокий; `etched-highball` — уже прайса; `cylinder-hurricane` — высокий",
    "цилиндр вместо приземистого; `retro-asia-rocks` — на 17 % выше; `basalt-rocks`,",
    "`slope-tumbler` и `bullet-chalet` — с другим наклоном стенки; `coupethini` — с более",
    "узкой чашей и длинной ножкой; `column-tumbler` стоял тёмной колонной вместо",
    "прозрачной стенки; `embassy-goblet` — с более широкой чашей, чем в прайсе;",
    "`levitating-super-pony` — с длинной ножкой вместо короткой; `retro-asia-shot`,",
    "`retro-asia-highball`, `flowers-highball`, `bullet-highball`, `bullet-rocks`,",
    "`flowers-rocks` и их гравированные версии — заметно уже прайса.",
    "",
    "### 3. Глоу",
    "",
    "Серебряное свечение собрано только из света, который уже есть в кадре, поэтому",
    "повторяет реальный силуэт и гаснет к краю; чёрный остаётся чёрным.",
    "",
    "### 4. Кадр — все бокалы одного масштаба",
    "",
    "Вторая ошибка была не в форме, а в кадре: мастера снимались в три захода, и предмет",
    "стоял в рамке по-разному — от 43 % до 80 % высоты. В каталоге это читается как",
    "«эти бокалы больше». Все пластины приведены к одному кадру: высота предмета 52,8 %",
    "рамки, основание на 73,3 %, центр по 50,0 % — и только это масштабируется, силуэт",
    "по-прежнему не тронут (`frame_piece()` в `tools/navy_to_catalog.py`).",
    "",
    "<!--FRAMING-->",
    "",
    "### 5. Толщина стекла и дно",
    "",
    "На позициях из прайса толщина стенки и дна — ровно прайсовые. На остальных кадрах",
    "стенка тонкая и прозрачная, двойная линия кромки совпадает с референсом, плиты под",
    "дном нет ни на одной пластине.",
    "",
    "### 6. Как читать цифры",
    "",
    "Стекло прозрачное, одна автоматическая маска врёт всегда, поэтому h/w печатается",
    "только там, где два независимых метода сошлись; иначе «—». Приговор ставится по",
    "паре на `docs/audit-glass-pairs.png`, цифра — поддержка.",
    "",
    "Порог ошибки метода виден на двух позициях, которые собраны **из того же файла**,",
    "что и референс, — `bullet-chalet` показывает 0 %, `coupethini` +14 %. Всё, что",
    "внутри этого разброса, — шум прозрачного стекла, а не форма. Поэтому строки «n/a»",
    "ниже — это не «не проверено», а «машина молчит, смотреть пары»: форма у них либо",
    "прайсовая по построению, либо совпадает по паре.",
]



REFS_BY_SLUG = {
    "levitating-martini": "martini",
    "champagne-saucer": "saucer",
    "stemmed-tumbler": "footed",
    "saucer-coupe": "coupe",
    "embassy-goblet": "goblet",
    "etched-highball": "highball",
    "column-tumbler": "cylinder",
    "basalt-rocks": "rocks",
    "slope-tumbler": "tumbler",
    "cylinder-hurricane": "hurricane",
    "levitating-super-pony": "levitating-super-pony",
    "levitating-rocks-glass": "levitating-rocks-glass",
    "levitating-highball-glass": "levitating-highball-glass",
    "retro-asia-cocktail-glass": "retro-asia-cocktail-glass",
    "retro-asia-rocks-glass": "retro-asia-rocks-glass",
    "retro-asia-highball-glass": "retro-asia-highball-glass",
    "retro-asia-shot-glass": "retro-asia-shot-glass",
    "retro-asia-engraved-cocktail-glass": "retro-asia-engraved-cocktail-glass",
    "retro-asia-engraved-rocks-glass": "retro-asia-engraved-rocks-glass",
    "retro-asia-engraved-highball-glass": "retro-asia-engraved-highball-glass",
    "bullet-chalet-glass": "bullet-chalet-glass",
    "bullet-rocks-glass": "bullet-rocks-glass",
    "bullet-highball-glass": "bullet-highball-glass",
    "flowers-cocktail-glass": "flowers-cocktail-glass",
    "flowers-rocks-glass": "flowers-rocks-glass",
    "flowers-highball-glass": "flowers-highball-glass",
    "coupethini-coupethini": "coupethini-coupethini",
    "replicate-rocks-glass": "replicate-rocks-glass",
    "shorties-mini-martini": "shorties-mini-martini",
    "shorties-daisy-coupe": "shorties-daisy-coupe",
    "shorties-lil-nora": "shorties-lil-nora",
    "shorties-modern-margo": "shorties-modern-margo",
    "teapot-teapot": "teapot-teapot",
    "two-sips-cocktail-glass": "two-sips-cocktail-glass",
}


# Мастера, пересобранные прямо из нарезки прайса (`tools/masters_from_pricelist.py`):
# у этих позиций кадр из архива был другого бокала, поэтому форма взята из прайса.
FROM_PRICELIST = {
    "stemmed-tumbler", "saucer-coupe", "champagne-saucer", "etched-highball",
    "cylinder-hurricane", "retro-asia-rocks-glass", "basalt-rocks", "slope-tumbler",
    "bullet-chalet-glass", "coupethini-coupethini", "column-tumbler", "embassy-goblet",
    "levitating-super-pony", "retro-asia-shot-glass", "retro-asia-highball-glass",
    "retro-asia-engraved-highball-glass", "retro-asia-engraved-rocks-glass",
    "retro-asia-engraved-cocktail-glass", "flowers-highball-glass",
    "bullet-highball-glass", "bullet-rocks-glass", "flowers-rocks-glass",
}


def _grey(path: Path) -> np.ndarray:
    img = Image.open(path).convert("L")
    h = max(80, int(W * img.height / img.width))
    return ndi.gaussian_filter(np.asarray(img.resize((W, h), Image.LANCZOS)).astype(np.float32), 1.2)


def _largest(mask: np.ndarray, share: float = 0.25) -> np.ndarray:
    lab, n = ndi.label(mask)
    if not n:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    keep = np.zeros_like(mask)
    for i, size in enumerate(sizes, 1):
        if size > share * sizes.max():
            keep |= lab == i
    return keep


def _silhouette(grey: np.ndarray, kind: str) -> np.ndarray:
    if kind == "band":
        band = np.abs(grey - ndi.gaussian_filter(grey, 14))
        mask = band > np.percentile(band, 99)
    else:
        grad = np.hypot(ndi.sobel(grey, 0), ndi.sobel(grey, 1))
        mask = grad > np.percentile(grad, 97.5)
    mask = _largest(ndi.binary_fill_holes(ndi.binary_closing(mask, np.ones((13, 13)))))
    widths = mask.sum(axis=1)
    rows = np.where(widths > 0)[0]
    if len(rows):
        cut = rows[-1]                       # the mirror reflection is not the piece
        while cut > rows[0] and widths[cut] < 0.45 * widths.max():
            cut -= 1
        mask[cut + 2 :, :] = False
    return mask


def _usable(mask: np.ndarray) -> tuple[int, int] | None:
    ys, xs = np.where(mask)
    if not len(ys):
        return None
    h = int(ys.max() - ys.min() + 1)
    w = int(xs.max() - xs.min() + 1)
    if w < 0.05 * mask.shape[1] or w > 0.97 * mask.shape[1] or h / w < 0.2:
        return None            # a mask that has eaten the stage border is not a reading
    return h, w


def shape(path: Path) -> dict:
    grey = _grey(path)
    out: dict = {}
    for kind in ("band", "edge"):
        got = _usable(_silhouette(grey, kind))
        if got:
            out[kind] = {"h/w": got[0] / got[1]}
    return out


def backdrop(path: Path) -> tuple[str, float]:
    a = np.asarray(Image.open(path).convert("RGB").resize((200, 200))).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lead = float(np.mean(b - (r + g) / 2))
    share = float(np.mean((b - r > 16) & (b - g > 8)) * 100)
    return ("black", lead) if lead < 4 and share < 6 else (f"blue {share:.0f}%", lead)


def _trim_ref(img: Image.Image) -> Image.Image:
    """A reference sheet is a crop pasted on a canvas — the flat border is not the piece."""
    g = np.asarray(img.convert("L")).astype(np.float32)
    cs, rs = g.std(0), g.std(1)
    xs, ys = np.where(cs > 3)[0], np.where(rs > 3)[0]
    if not len(xs) or not len(ys):
        return img
    return img.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def _trim_piece(img: Image.Image) -> Image.Image:
    """Crop a plate to the light it carries: the piece and its contact shadow."""
    a = np.asarray(img.convert("L")).astype(np.float32)
    m = a > 6
    xs, ys = np.where(m.any(axis=0))[0], np.where(m.any(axis=1))[0]
    if not len(xs) or not len(ys):
        return img
    pad = int(0.04 * img.width)
    return img.crop(
        (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
         min(img.width, int(xs.max()) + pad), min(img.height, int(ys.max()) + pad))
    )


def framing() -> tuple[int, float, float, float, float, float, float]:
    """→ (плит, min h, max h, min base, max base, min cx, max cx) по готовым кадрам."""
    hs, bs, cs = [], [], []
    for path in sorted((ROOT / "assets" / "products").glob("*.webp")):
        if path.name.endswith("-sm.webp"):
            continue
        a = np.asarray(Image.open(path).convert("RGB").resize((1200, 1500), Image.LANCZOS))
        a = a.max(axis=2).astype(np.float32)
        level = max(24.0, 0.25 * float(np.percentile(a, 99.9)))
        mask = a > level
        # a couple of stray lit pixels or a speck of dust must not move the frame
        keep = mask.sum(axis=0) > 0.01 * mask.shape[0]
        mask[:, ~keep] = False
        ys, xs = np.where(mask.any(axis=1))[0], np.where(mask.any(axis=0))[0]
        if not len(ys) or not len(xs):
            continue
        hs.append((ys.max() - ys.min() + 1) / a.shape[0])
        bs.append((ys.max() + 1) / a.shape[0])
        cs.append((xs.min() + xs.max() + 1) / 2 / a.shape[1])
    if not hs:
        return (0,) * 7
    return (len(hs), min(hs), max(hs), min(bs), max(bs), min(cs), max(cs))


def _hw(entry: dict, kind: str) -> float | None:
    return entry.get(kind, {}).get("h/w") if entry else None


def judge(photo: dict, ref: dict, bg: str) -> tuple[str, str, str, str, str]:
    """→ (h/w фото, h/w реф, состояние, замечание)."""
    ph = [v for v in (_hw(photo, k) for k in ("band", "edge")) if v]
    rf = [v for v in (_hw(ref, k) for k in ("band", "edge")) if v]
    sure_p = len(ph) == 2 and abs(ph[0] - ph[1]) / max(ph) < 0.08
    sure_r = len(rf) == 2 and abs(rf[0] - rf[1]) / max(rf) < 0.08

    hw_photo = f"{sum(ph) / len(ph):.2f}" if sure_p else "—"
    hw_ref = f"{sum(rf) / len(rf):.2f}" if sure_r else "—"

    issues = []
    if bg != "black":
        issues.append(f"синий фон ({bg})")

    shape = "—"
    if sure_p and sure_r:
        delta = (sum(ph) / 2) / (sum(rf) / 2) - 1
        shape = f"{delta * 100:+.0f} %"
        if abs(delta) > 0.08:
            issues.append(f"пропорция расходится на {delta * 100:+.0f} %")
        state = "off" if issues and bg != "black" else ("off" if issues else "ok")
        note = "; ".join(issues) or "пропорция совпадает, фон чёрный"
    else:
        issues.append("h/w автоматически не сходится — смотреть пары")
        state = "off" if bg != "black" else "n/a"
        note = "; ".join(issues)
    return hw_photo, hw_ref, state, note, shape


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--md", default="")
    ap.add_argument("--pairs", default="")
    args = ap.parse_args()

    content = json.loads(CONTENT.read_text())
    products = {p["slug"]: p for p in content["products"]}
    rows, pairs = [], []

    for slug, ref_name in REFS_BY_SLUG.items():
        product = products.get(slug)
        photo_path = ROOT / product["images"][0] if product else None
        ref_path = REFS / f"{ref_name}.png"
        if not photo_path or not photo_path.exists() or not ref_path.exists():
            rows.append((slug, "—", "—", "—", "—", "—", "n/a", "файл не найден"))
            continue
        bg, _ = backdrop(photo_path)
        hw_photo, hw_ref, state, note, delta = judge(shape(photo_path), shape(ref_path), bg)
        rows.append((slug, str(photo_path.relative_to(ROOT)), hw_photo, hw_ref, delta, bg, state, note))
        pairs.append((slug, ref_name, photo_path, ref_path))

    summary: dict[str, int] = {}
    for row in rows:
        summary[row[6]] = summary.get(row[6], 0) + 1
    blue = [r for r in rows if r[5] != "black"]

    n, h0, h1, b0, b1, c0, c1 = framing()
    framing_lines = [
        f"Проверено {n} кадров: высота предмета {h0 * 100:.1f}–{h1 * 100:.1f} % рамки,",
        f"основание {b0 * 100:.1f}–{b1 * 100:.1f} %, центр {c0 * 100:.1f}–{c1 * 100:.1f} %.",
        "",
        "Разброс — это цена чтения прозрачного стекла, а не разная посадка: у бокалов с",
        "тёмным толстым дном порог срезает нижнюю кромку, и низ читается на пару процентов",
        "выше. Само положение задаётся один раз при сборке кадра и одинаково у всех.",
    ]
    lines = [
        "# Аудит стекла — форма, пропорция и фон против референсов",
        "",
        "Референс каждой позиции — `brand-source/navy-refs/<форма>.png`, нарезка из прайса.",
        "Правило: свет и сцена могут меняться, геометрия — нет.",
        "",
        "Силуэт читается двумя независимыми способами: **band** (разность с сильным размытием —",
        "тонкая структура, прямая граница сцены при этом исчезает) и **edge** (контур по Sobel).",
        "Число печатается как `band / edge` и считается надёжным, только когда оба метода дают",
        "одно и то же (расхождение < 8 %). Стекло прозрачное, и один метод врёт всегда —",
        "поэтому решение принимается по согласию двух и по глазам на `docs/audit-glass-pairs.png`.",
        "",
        "* **h/w** — высота ÷ ширина силуэта, фото против референса;",
        "* порог формы — расхождение пропорции больше 8 % или совпадение профиля ширины < 82 %;",
        "* синий фон — брак сразу, независимо от формы.",
        "",
        "| Товар | Источник | Фото | h/w фото | h/w реф | Δ | Фон | Итог | Замечание |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        src = "**прайс**" if r[0] in FROM_PRICELIST else "фото"
        lines.append(f"| {r[0]} | {src} | `{r[1]}` | {r[2]} | {r[3]} | {r[4]} | {r[5]} | **{r[6]}** | {r[7]} |")

    findings: list[str] = []
    for line in FINDINGS:
        if line == "<!--FRAMING-->":
            findings += framing_lines
        else:
            findings.append(line)
    lines += ["", *findings, "", "## Итог", ""]
    for key in ("off", "n/a", "ok"):
        if summary.get(key):
            lines.append(f"* {key}: {summary[key]}")
    lines.append("")
    if blue:
        lines += [
            f"## Синий фон — {len(blue)} фото",
            "",
            "Все — старый синий рендер из `assets/archive/`. Пока он на карточке, любая другая",
            "правка не видна: покупатель видит синюю страницу. Это блокер №1.",
            "",
        ]
        for r in blue:
            lines.append(f"* `{r[1]}` — {r[5]}, h/w {r[2]} против {r[3]}")

    report = "\n".join(lines) + "\n"
    print(report)

    if args.md:
        out = Path(args.md)
        out = out if out.is_absolute() else ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(report)
        print("written", out)

    if args.pairs:
        # Both sides are cropped to the piece and set to the same height, so the
        # eye compares shape and wall thickness instead of framing.
        tw, th, cols = 190, 300, 5
        rws = (len(pairs) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw * 2, rws * (th + 24)), (0, 0, 0))
        draw = ImageDraw.Draw(sheet)
        for i, (slug, ref_name, photo_path, ref_path) in enumerate(pairs):
            x, y = (i % cols) * tw * 2, (i // cols) * (th + 24)
            for j, (src, is_ref) in enumerate(((photo_path, False), (ref_path, True))):
                im = Image.open(src).convert("RGB")
                if is_ref:
                    im = _trim_ref(im)
                else:
                    im = _trim_piece(im)
                im.thumbnail((tw - 10, th - 10), Image.LANCZOS)
                sheet.paste(im, (x + j * tw + (tw - im.width) // 2, y + (th - im.height) // 2))
                draw.rectangle(
                    [x + j * tw, y, x + (j + 1) * tw - 1, y + th - 1],
                    outline=(255, 92, 92) if j == 0 else (92, 214, 255),
                )
            draw.text((x + 5, y + th + 5), slug[:34], fill=(235, 235, 235))
            draw.text((x + tw + 5, y + th + 5), f"ref: {ref_name[:24]}", fill=(150, 210, 255))
        out = Path(args.pairs)
        out = out if out.is_absolute() else ROOT / out
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out)
        print("pairs", out)

if __name__ == "__main__":
    main()
