#!/usr/bin/env python3
"""
Cocktail Embassy — генератор каталога из прайса (Google Sheets → PDF).

Собирает data/catalog.json и раскладывает ассеты:
  webapp/assets/products/src-<COD>.png  — исходные фото товаров из PDF
  webapp/assets/brand/hero-NN.jpg       — лайфстайл-кроки из скриншотов Instagram бренда

Использование:
  pip install pymupdf pillow
  python3 scripts/build_catalog.py ["COCKTAIL EMBASSY - Google Диск.pdf"]

Повторный запуск безопасен: catalog.json пересобирается целиком,
ручные правки админа живут отдельно в data/db.json и не затираются.
"""
import io
import json
import os
import re
import sys

import fitz  # pymupdf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "COCKTAIL EMBASSY - Google Диск.pdf")
PRODUCTS_DIR = os.path.join(ROOT, "webapp", "assets", "products")
BRAND_DIR = os.path.join(ROOT, "webapp", "assets", "brand")

# ────────────────────────────────────────────────────────────────
# Справочник коллекций и описаний (редактируется здесь)
# ────────────────────────────────────────────────────────────────
COLLECTIONS = [
    {"id": "retro-asia", "key": "RETRO ASIA without engraving", "title": "Retro Asia",
     "subtitle": "Timeless classics with a modern touch", "group": "cocktail",
     "blurb": "A collection inspired by the elegance of Asian bar culture and timeless classics."},
    {"id": "retro-asia-engraved", "key": "RETRO ASIA engraving", "title": "Retro Asia · Engraved",
     "subtitle": "Hand-engraved crystal, same silhouettes", "group": "cocktail",
     "blurb": "The Retro Asia silhouettes, finished with a hand-engraved facet that catches the bar light."},
    {"id": "bullet", "key": "BULLET", "title": "Bullet",
     "subtitle": "Bold. Minimal. Iconic.", "group": "bar",
     "blurb": "Straight walls, honest volume, zero decoration. The workhorse line for modern menus."},
    {"id": "flowers", "key": "FLOWERS", "title": "Flowers",
     "subtitle": "Delicate details for special moments", "group": "cocktail",
     "blurb": "Petal-thin bowls on tall stems — glassware for serves that open an evening."},
    {"id": "coupethini", "key": "COUPETHINI", "title": "Coupethini",
     "subtitle": "The art of balance", "group": "cocktail",
     "blurb": "Half coupe, half martini: a hybrid bowl for aromatic serves poured without ice."},
    {"id": "replicate", "key": "REPLICATE", "title": "Replicate",
     "subtitle": "Borosilicate clarity, everyday strength", "group": "bar",
     "blurb": "Borosilicate glass that shrugs off thermal shock and busy shifts without losing clarity."},
    {"id": "levitating", "key": "LEVITATING", "title": "Levitating",
     "subtitle": "Ultra-light. Timeless. Unforgettable.", "group": "cocktail",
     "blurb": "Hand-blown crystal glasses that defy gravity. Ultra-light, timeless, unforgettable."},
    {"id": "shorties", "key": "SHORTIES", "title": "Shorties",
     "subtitle": "Small stature. Big presence.", "group": "cocktail",
     "blurb": "Short-stemmed icons in miniature — serves designed for two sips and a long memory."},
    {"id": "soon-teapot", "key": "SOON", "title": "Soon Teapot",
     "subtitle": "The ritual, elevated.", "group": "accessories",
     "blurb": "Crystal and wood in magnetic balance — the brewing ritual as table theatre."},
    {"id": "two-sips", "key": "TWO SIPS SOON", "title": "Two Sips Soon",
     "subtitle": "Two sips of perfection.", "group": "cocktail",
     "blurb": "A duo-serve glass for tasting flights, welcome pours and pairing menus."},
]

TYPE_DESC = {
    "cocktail": "A poised bowl for serves built on aroma — martinis, dashes and clarified classics. Thin hand-cut lip, balanced stem.",
    "rocks": "A weighted base and wide opening for spirits over ice, stirred cocktails and generous garnish.",
    "highball": "Tall, straight and cool — long drinks, sodas and builds that stay cold to the last sip.",
    "shot": "A precise pour in one confident measure. Stacks well, reads well, serves fast.",
    "accessory": "A statement piece for the table — crafted to be kept in sight.",
}
NAME_DESC = {
    "CHALET GLASS": "An alpine silhouette with a wide bowl — aromatics first, everything else second.",
    "COUPETHINI": "Between a coupe and a martini: the art of balance for aromatic serves without ice.",
    "SUPER PONY": "A long-stemmed icon that floats above the bar top — for serves meant to be held up to the light.",
    "MINI MARTINI": "The martini distilled to its essence — a short-stemmed icon for chilled, undiluted serves.",
    "DAISY COUPE": "A shallow bowl for daisies and fizzes — foam-friendly and photograph-ready.",
    "LIL’ NORA": "A gentle bowl on a whisper of a stem — small serves, big presence.",
    "LIL' NORA": "A gentle bowl on a whisper of a stem — small serves, big presence.",
    "MODERN MARGO": "A modern rim for the margarita — salt-ready, lime-forward.",
    "TEAPOT": "Crystal and walnut in magnetic balance — a brewing ritual elevated to table theatre.",
}

GROUP_OF_TYPE = {"cocktail": "cocktail", "rocks": "bar", "highball": "bar", "shot": "bar", "accessory": "accessories"}

# USD-цена проставляется из AED по фиксированному курсу, если в прайсе её нет
AED_USD = 3.6725


def parse_products(text):
    """Разбирает текстовый слой прайса на блоки товаров."""
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    products = []
    current_coll = None
    block = None

    def flush():
        nonlocal block
        if block and block.get("cod"):
            products.append(block)
        block = None

    keys = ("COLLECTION OF GLASSWARE", "DESCRIPTION", "PRICE PER PC", "PICTURE",
            "TEA POT", "Glassware", "Acids and Other", ">", "<")
    for ln in lines:
        if ln in keys:
            continue
        if ln == "HAND BLOWING":
            if block:
                block["craft"] = True
            continue
        m = re.match(r"^COD:\s*(AG\d+)$", ln)
        if m:
            if block:
                block["cod"] = m.group(1)
            continue
        if ln.startswith("Capacity:"):
            if block:
                v = re.sub(r"[^0-9]", "", ln.split(":", 1)[1])
                block["volumeMl"] = int(v) if v else None
            continue
        if ln.startswith("High:"):
            if block:
                v = re.sub(r"[^0-9]", "", ln.split(":", 1)[1])
                block["heightMm"] = int(v) if v else None
            continue
        if ln.startswith("Ф:") or ln.startswith("Φ:"):
            if block:
                v = re.sub(r"[^0-9]", "", ln.split(":", 1)[1])
                block["diameterMm"] = int(v) if v else None
            continue
        if ln.startswith("Matherial:") or ln.startswith("Material:"):
            if block:
                block["material"] = ln.split(":", 1)[1].strip()
            continue
        if ln == "and wood" and block and block.get("material"):
            block["material"] += " and wood"
            continue
        if ln == "Magnetic System" and block:
            block["note"] = "Magnetic system"
            continue
        if ln == "AED" and block is not None:
            block["_expect"] = "aed"
            continue
        if ln == "USD" and block is not None:
            block["_expect"] = "usd"
            continue
        if re.match(r"^\d+([.,]\d+)?$", ln) and block is not None and block.get("_expect"):
            val = float(ln.replace(",", "."))
            block["priceAed" if block["_expect"] == "aed" else "priceUsd"] = val
            block["_expect"] = None
            continue
        # всё остальное — имена коллекций и товаров
        coll = next((c for c in COLLECTIONS if c["key"].lower() == ln.lower()), None)
        if coll and (current_coll is None or current_coll["id"] != coll["id"] or block is not None):
            flush()
            current_coll = coll
            continue
        if re.match(r"^[A-Z][A-Za-z’'’.&\- ]{2,}$", ln) and current_coll:
            flush()
            block = {"name": ln.title().replace("Lil’ Nora", "Lil’ NORA"),
                     "collection": current_coll["id"], "_expect": None}
            block["type"] = guess_type(ln, block["name"])
            continue
    flush()
    return products


def guess_type(raw, name):
    r = raw.upper()
    if "TEAPOT" in r or "TEA POT" in r:
        return "accessory"
    if "ROCKS" in r:
        return "rocks"
    if "HIGHBALL" in r:
        return "highball"
    if "SHOT" in r:
        return "shot"
    return "cocktail"


def main():
    doc = fitz.open(PDF)
    page = doc[0]
    text = page.get_text()
    products = parse_products(text)
    assert products, "не удалось разобрать ни одного товара"

    # фото: порядок картинок по вертикали == порядку товаров в тексте
    imgs = []
    for im in page.get_images(full=True):
        xref = im[0]
        rects = page.get_image_rects(xref)
        if not rects:
            continue
        r = rects[0]
        if r.width < 8 or r.height < 8:      # декоративные мелкие картинки
            continue
        if r.x0 > 100:                          # колонка PICTURE
            imgs.append((r.y0, xref))
    imgs.sort()
    assert len(imgs) == len(products), f"фото {len(imgs)} != товаров {len(products)}"

    os.makedirs(PRODUCTS_DIR, exist_ok=True)
    out_products = []
    for (y0, xref), p in zip(imgs, products):
        pix = fitz.Pixmap(doc, xref)
        if pix.n > 3:
            pix = fitz.Pixmap(fitz.csRGB, pix)
        cod = p["cod"]
        fname = f"src-{cod}.png"
        with open(os.path.join(PRODUCTS_DIR, fname), "wb") as f:
            f.write(pix.tobytes("png"))
        coll = next(c for c in COLLECTIONS if c["id"] == p["collection"])
        ptype = p.get("type", "cocktail")
        aed = p.get("priceAed")
        usd = p.get("priceUsd")
        if aed and not usd:
            usd = round(aed / AED_USD, 1)
        desc = NAME_DESC.get(p["name"].upper(), NAME_DESC.get(p["name"], TYPE_DESC[ptype]))
        out_products.append({
            "id": cod,
            "article": cod,
            "name": p["name"],
            "collection": coll["id"],
            "group": GROUP_OF_TYPE[ptype],
            "type": ptype,
            "priceAed": aed,
            "priceUsd": usd,
            "volumeMl": p.get("volumeMl"),
            "heightMm": p.get("heightMm"),
            "diameterMm": p.get("diameterMm"),
            "material": (p.get("material") or "lead free crystal glass").replace("leed", "lead"),
            "craft": "HAND BLOWING" if p.get("craft") else None,
            "note": p.get("note"),
            "image": f"assets/products/{cod}.jpg",
            "srcImage": f"assets/products/src-{cod}.png",
            "description": desc,
            "isNew": coll["id"] in ("levitating", "two-sips", "soon-teapot"),
            "isHit": cod in ("AG0015", "AG0006", "AG0021", "AG0008"),
        })

    catalog = {
        "brand": {
            "name": "Cocktail Embassy",
            "title": "Cocktail Embassy",
            "tagline": "Premium glassware for modern bars",
            "subtitle": "Hand-blown crystal glassware for those who appreciate detail, balance and atmosphere.",
            "instagram": "cocktail_embassy_dxb",
            "telegram": "",
            "whatsapp": "+971562388262",
            "phone": "+971 56 238 8262",
            "email": "",
            "location": "Dubai, UAE",
            "managers": [
                {"region": "Worldwide", "whatsapp": "+971562388262", "phone": "+971 56 238 8262"},
            ],
        },
        "delivery": {
            "note": "Orders are packed and dispatched from Dubai within 1–2 business days after payment. "
                    "Free delivery across the UAE from AED 1,500. Worldwide shipping via DHL and Aramex.",
            "freeFromAed": 1500,
            "regions": ["Dubai pickup", "UAE courier", "Worldwide"],
        },
        "categories": [
            {"id": c["id"], "title": c["title"], "subtitle": c["subtitle"], "blurb": c["blurb"], "group": c["group"]}
            for c in COLLECTIONS
        ],
        "products": out_products,
        "source": os.path.basename(PDF),
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)
    print(f"[catalog] товаров: {len(out_products)}, коллекций: {len(COLLECTIONS)}")

    # ── hero-кроки из скриншотов Instagram бренда ────────────────
    os.makedirs(BRAND_DIR, exist_ok=True)
    crops = [
        ("IMG_1421.png", [(1, 98, 195, 360), (197, 98, 391, 360), (393, 98, 589, 360),
                          (1, 365, 195, 628), (197, 365, 391, 628), (393, 365, 589, 628),
                          (1, 632, 195, 895), (197, 632, 391, 895), (393, 632, 589, 895)]),
        ("IMG_1420.png", [(1, 447, 195, 705), (197, 447, 391, 705), (393, 447, 589, 705)]),
    ]
    n = 0
    for fname, boxes in crops:
        src = os.path.join(ROOT, fname)
        if not os.path.exists(src):
            continue
        im = Image.open(src).convert("RGB")
        fx, fy = im.width / 591.0, im.height / 900.0
        for (x0, y0, x1, y1) in boxes:
            box = (int(x0 * fx), int(y0 * fy), int(x1 * fx), int(y1 * fy))
            tile = im.crop(box)
            s = min(tile.size)
            tile = tile.crop(((tile.width - s) // 2, (tile.height - s) // 2,
                              (tile.width - s) // 2 + s, (tile.height - s) // 2 + s))
            tile = tile.resize((720, 720), Image.LANCZOS)
            n += 1
            tile.save(os.path.join(BRAND_DIR, f"hero-{n:02d}.jpg"), quality=84)
    print(f"[brand] hero-кроков: {n}")


if __name__ == "__main__":
    main()
