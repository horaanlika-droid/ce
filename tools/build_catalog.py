"""Rebuild data/content.json + server/seed.json from the trade price list.

Source: brand-source/cocktail-embassy-catalog.webarchive (Google Sheet, two tabs)
  tab 1 "Glassware"        — collections, COD, capacity / height / diameter, AED+USD
  tab 2 "Acids and Other"  — straws, enzymes, acids, natural flavour essences

Currency: AED (the owner's decision). USD is kept in `priceUsd` so the sheet stays
auditable and a future switch needs no re-entry.

The storefront already sold ten house pieces (studio photography in assets/products).
Those keep their slugs, copy, specs and prices; the price list is layered on top so
every printed collection is a normal, priced product.
"""
from __future__ import annotations

import json
import shutil
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ------------------------------------------------------------------ house range
# slug -> (name, subtitle, description, cover, [pieces])
HOUSE = OrderedDict([
    ("levitating", (
        "Levitating", "Cocktail Collection",
        "Ultra-light crystal with a pulled stem, suspended for a unique experience.",
        "assets/scenes/cover-levitating.webp", [
            dict(slug="levitating-martini", name="Levitating Martini",
                 subtitle="Hand-Blown Crystal · 210 ml", price=42, badge="Signature",
                 image="assets/products/martini.webp",
                 desc="An ultra-delicate, elongated martini glass designed for minimal elegance. "
                      "The pulled stem replicates classic proportions while keeping the piece almost "
                      "weightless in the hand.",
                 specs={"Capacity": "210 ml", "Material": "Lead-free hand-blown crystal",
                        "Height": "185 mm", "Care": "Hand wash", "Origin": "Hand-blown in China"}),
            dict(slug="champagne-saucer", name="Champagne Saucer",
                 subtitle="Wide Bowl Saucer · 250 ml", price=32, badge=None,
                 image="assets/products/saucer.webp",
                 desc="The classic saucer, re-proportioned for aroma. A wide surface and thin rim make "
                      "it the glass we reach for at the end of the night.",
                 specs={"Capacity": "250 ml", "Material": "Hand-blown crystal",
                        "Height": "110 mm", "Care": "Hand wash", "Packing": "6 per case"}),
            dict(slug="stemmed-tumbler", name="Stemmed Tumbler",
                 subtitle="Footed Tumbler · 330 ml", price=36, badge="New",
                 image="assets/products/footed.webp",
                 desc="A tumbler lifted onto a low foot — the silhouette of a wine glass with the ease "
                      "of a rocks. Our quiet favourite.",
                 specs={"Capacity": "330 ml", "Material": "Hand-blown crystal",
                        "Height": "120 mm", "Care": "Hand wash", "Packing": "6 per case"}),
        ])),
    ("noir", (
        "Noir", "Dark Service",
        "Deep shadows, wide bowls, low light. Designed for after-dinner service.",
        "assets/scenes/cover-noir.webp", [
            dict(slug="saucer-coupe", name="Saucer Coupe",
                 subtitle="Double-Wall Coupe · 220 ml", price=34, badge=None,
                 image="assets/products/coupe.webp",
                 desc="A stepped coupe with an inner volume ring so the bowl reads fuller than it is. "
                      "Tuned for champagne, sours and clarified milk punches.",
                 specs={"Capacity": "220 ml", "Material": "Hand-blown crystal",
                        "Height": "135 mm", "Care": "Hand wash", "Packing": "6 per case"}),
        ])),
    ("signature", (
        "Signature", "House Editions",
        "The Embassy house cuts — etched, engraved and numbered by hand.",
        "assets/scenes/cover-signature.webp", [
            dict(slug="embassy-goblet", name="Embassy Goblet",
                 subtitle="Burgundy Goblet · 400 ml", price=38, badge=None,
                 image="assets/products/goblet.webp",
                 desc="A generous all-purpose goblet with a slim shoulder and a wide, stable foot. Our "
                      "most requested piece for wine service and large-format stirred drinks.",
                 specs={"Capacity": "400 ml", "Material": "Hand-blown crystal",
                        "Height": "150 mm", "Care": "Hand wash", "Packing": "6 per case"}),
            dict(slug="etched-highball", name="Etched Highball",
                 subtitle="Etched Edition · 350 ml", price=28, badge="Etched",
                 image="assets/products/highball.webp",
                 desc="A tall, slender highball decorated with a hand-etched constellation. Keeps "
                      "carbonation alive and reads beautifully under bar light.",
                 specs={"Capacity": "350 ml", "Material": "Etched crystal",
                        "Height": "155 mm", "Care": "Hand wash", "Packing": "6 per case"}),
            dict(slug="column-tumbler", name="Column Tumbler",
                 subtitle="Etched Column · 300 ml", price=28, badge=None,
                 image="assets/products/cylinder.webp",
                 desc="A clean cylinder with a hand-etched chevron. Designed to disappear into the table "
                      "and hold the light.",
                 specs={"Capacity": "300 ml", "Material": "Etched crystal",
                        "Height": "100 mm", "Care": "Hand wash", "Packing": "6 per case"}),
        ])),
    ("raw", (
        "Raw", "Studio Series",
        "Unfinished textures, sandblasted surfaces and single-piece vessels.",
        "assets/scenes/cover-raw.webp", [
            dict(slug="basalt-rocks", name="Basalt Rocks",
                 subtitle="Heavy Base Rocks · 320 ml", price=30, badge=None,
                 image="assets/products/rocks.webp",
                 desc="A thick-bottomed rocks glass with a straight wall and a hint of weight. Built for "
                      "spirit-forward serves and slow ice.",
                 specs={"Capacity": "320 ml", "Material": "Pressed crystal",
                        "Height": "95 mm", "Care": "Dishwasher safe", "Packing": "6 per case"}),
            dict(slug="slope-tumbler", name="Slope Tumbler",
                 subtitle="Stacking Tumbler · 300 ml", price=26, badge=None,
                 image="assets/products/tumbler.webp",
                 desc="A taper that stacks in the cupboard and reads clean on the table. The everyday "
                      "workhorse of the Embassy range.",
                 specs={"Capacity": "300 ml", "Material": "Pressed crystal",
                        "Height": "100 mm", "Care": "Dishwasher safe", "Packing": "6 per case"}),
            dict(slug="cylinder-hurricane", name="Cylinder Hurricane",
                 subtitle="Candle Hurricane · 380 ml", price=34, badge=None,
                 image="assets/products/hurricane.webp",
                 desc="A straight-sided hurricane that holds a pillar candle or a tall floral centre. "
                      "Blown thick at the foot so it stands level.",
                 specs={"Capacity": "380 ml", "Material": "Hand-blown crystal",
                        "Height": "170 mm", "Care": "Hand wash"}),
        ])),
])

# --------------------------------------------------------------- trade price list
# collection -> (name, subtitle, description, [pieces])
# piece: (cod, name, capacity, height, diameter, material, aed, usd)
PRICED = OrderedDict([
    ("retro-asia", ("Retro Asia", "Classic series",
                    "The house classic: fine walls, a straight taper and a foot that finds the table by itself.", [
        ("AG0015", "Cocktail Glass", "140 ml", "115 mm", "73 mm", "Lead-free crystal", 30, 8.2),
        ("AG0016", "Rocks Glass", "270 ml", "80 mm", "73 mm", "Lead-free crystal", 25, 6.8),
        ("AG0017", "Highball Glass", "310 ml", "110 mm", "70 mm", "Lead-free crystal", 25, 6.8),
        ("AG0018", "Shot Glass", "60 ml", "73 mm", "30 mm", "Lead-free crystal", 10, 2.8),
    ])),
    ("retro-asia-engraved", ("Retro Asia Engraved", "Engraved series",
                             "Retro Asia, engraved by hand — the dots read as frost under bar light.", [
        ("AG0011", "Cocktail Glass", "140 ml", "115 mm", "73 mm", "Lead-free crystal, engraved", 35, 10.9),
        ("AG0012", "Rocks Glass", "270 ml", "80 mm", "73 mm", "Lead-free crystal, engraved", 30, 8.2),
        ("AG0013", "Highball Glass", "310 ml", "110 mm", "70 mm", "Lead-free crystal, engraved", 30, 8.2),
    ])),
    ("bullet", ("Bullet", "Chalet series",
                "Tall-sided chalet shapes, weighted at the base for a low centre of gravity.", [
        ("AG0008", "Chalet Glass", "210 ml", "145 mm", "97 mm", "Lead-free crystal", 30, 8.2),
        ("AG0010", "Rocks Glass", "390 ml", "75 mm", "85 mm", "Lead-free crystal", 25, 6.8),
        ("AG0009", "Highball Glass", "410 ml", "133 mm", "74 mm", "Lead-free crystal", 25, 6.8),
    ])),
    ("flowers", ("Flowers", "Floral series",
                 "A flared bowl that opens like a petal; built for aromatic, floral serves.", [
        ("AG0002", "Cocktail Glass", "150 ml", "190 mm", "85 mm", "Lead-free crystal", 30, 8.2),
        ("AG0003", "Rocks Glass", "330 ml", "85 mm", "95 mm", "Lead-free crystal", 25, 6.8),
        ("AG0001", "Highball Glass", "370 ml", "110 mm", "85 mm", "Lead-free crystal", 25, 6.8),
    ])),
    ("coupethini", ("Coupethini", "Coupe series",
                    "A coupe and a martini in one profile — the widest serve in the collection.", [
        ("AG0006", "Coupethini", "145 ml", "170 mm", "80 mm", "Lead-free crystal", 30, 8.2),
    ])),
    ("replicate", ("Replicate", "Borosilicate series",
                   "Borosilicate, blown thin and left raw. Light and nearly unbreakable in service.", [
        ("AG0004", "Rocks Glass", "330 ml", "80 mm", "75 mm", "Borosilicate", 28, 8.0),
    ])),
    ("shorties", ("Shorties", "Miniature series",
                  "Small-format glasses for tasting flights and miniature serves.", [
        ("AG0023", "Mini Martini", "150 ml", None, None, "Lead-free crystal", 30, 8.2),
        ("AG0024", "Daisy Coupe", "150 ml", None, None, "Lead-free crystal", 30, 8.2),
        ("AG0026", "Lil' Nora", "160 ml", None, None, "Lead-free crystal", 30, 8.2),
        ("AG0025", "Modern Margo", "200 ml", None, None, "Lead-free crystal", 30, 8.2),
    ])),
    ("soon-teapot", ("Teapot", "First series",
                     "Crystal and wood, held by a magnetic system. In development — ask for the first series.", [
        ("AG0027", "Teapot", "500 ml", None, None, "Crystal and wood, magnetic system", 145, None),
    ])),
    ("two-sips", ("Two Sips", "First series",
                  "A two-sip cocktail glass. In development — ask for the first series.", [
        ("AG0019", "Cocktail Glass", "85 ml", "150 mm", "90 mm", "Lead-free crystal", None, None),
    ])),
])

# the pieces of the list that belong to a house collection rather than a new one
MERGE_INTO = {"levitating": [
    ("AG0020", "Super Pony", "140 ml", "208 mm", "70 mm", "Lead-free crystal", 30, 8.2),
    ("AG0021", "Rocks Glass", "300 ml", "100 mm", "76 mm", "Lead-free crystal", 30, 8.2),
    ("AG0022", "Highball Glass", "390 ml", "180 mm", "58 mm", "Lead-free crystal", 30, 8.2),
]}

COMING_SOON = {"soon-teapot", "two-sips"}

ACIDS = OrderedDict([
    ("straws", ("Straws", "Bar essentials",
                "Plant-based drinking straws for high-volume service.", [
        ("ST0003", "Eco Straw · Sugar Cane", "210 mm · ⌀ 5 mm", 125, None),
        ("ST0002", "Eco Straw · Coffee", "210 mm · ⌀ 5 mm", 125, None),
    ])),
    ("acids", ("Acids", "Cocktail acids",
               "Cocktail acids by the kilo, food grade, for calibration and shelf-stable balance.", [
        ("AC0003", "Malic Acid", "1000 g · food grade", 100, 40.1),
        ("AC0001", "Citric Acid", "1000 g · food grade", 80, 32.7),
        ("AC0005", "Ascorbic Acid", "1000 g · food grade", 140, 40.1),
        ("AC0002", "Tartaric Acid", "1000 g · food grade", 100, 38.1),
    ])),
    ("hydrocolloids", ("Hydrocolloids", "Clarification",
                       "Enzymes and gelling agents for clarification and texture work.", [
        ("PC0001", "Pectinase", "300 ml · clarification", 475, None),
        ("AG0001", "Agar Agar", "1000 g · clarification", 400, 109),
    ])),
    ("essences", ("Flavour essences", "Natural",
                  "Natural flavour essences, 100 ml, dosed by the drop.", [
        ("FE0001", "Strawberry", "100 ml · natural", 100, 28),
        ("FE0002", "Raspberry", "100 ml · natural", 100, 28),
        ("FE0003", "Grapefruit", "100 ml · natural", 100, 28),
        ("FE0004", "Peach", "100 ml · natural", 100, 28),
        ("FE0005", "Vanilla", "100 ml · natural", 100, 28),
        ("FE0006", "Cherry", "100 ml · natural", 100, 28),
        ("FE0007", "Green Apple", "100 ml · natural", 100, 28),
        ("FE0008", "Mango", "100 ml · natural", 100, 28),
        ("FE0009", "Banana", "100 ml · natural", 100, 28),
        ("FE0010", "Blackcurrant", "100 ml · natural", 100, 28),
    ])),
])

GLASS_ART = {
    cod: "assets/archive/%s.webp" % cod
    for cod in ("AG0020", "AG0021", "AG0022", "AG0015", "AG0016", "AG0017", "AG0018",
                "AG0011", "AG0012", "AG0013", "AG0008", "AG0010", "AG0009", "AG0002",
                "AG0003", "AG0001", "AG0006", "AG0004", "AG0023", "AG0024", "AG0026",
                "AG0025", "AG0027", "AG0019")
}

ACID_ART = {
    "ST0003": "assets/packaging/sleeve-sugarcane.webp",
    "ST0002": "assets/packaging/sleeve-coffee.webp",
    "AC0003": "assets/packaging/jar-malic.webp",
    "AC0001": "assets/packaging/jar-citric.webp",
    "AC0005": "assets/packaging/jar-ascorbic.webp",
    "AC0002": "assets/packaging/jar-tartaric.webp",
    "PC0001": "assets/packaging/bottle-pectinase.webp",
    "AG0001": "assets/packaging/jar-agar.webp",
    "FE0001": "assets/packaging/essence-strawberry.webp",
    "FE0002": "assets/packaging/essence-raspberry.webp",
    "FE0003": "assets/packaging/essence-grapefruit.webp",
    "FE0004": "assets/packaging/essence-peach.webp",
    "FE0005": "assets/packaging/essence-vanilla.webp",
    "FE0006": "assets/packaging/essence-cherry.webp",
    "FE0007": "assets/packaging/essence-green-apple.webp",
    "FE0008": "assets/packaging/essence-mango.webp",
    "FE0009": "assets/packaging/essence-banana.webp",
    "FE0010": "assets/packaging/essence-blackcurrant.webp",
}

ACID_SLUGS = {
    "ST0003": "eco-straw-sugar-cane", "ST0002": "eco-straw-coffee",
    "AC0003": "malic-acid", "AC0001": "citric-acid",
    "AC0005": "ascorbic-acid", "AC0002": "tartaric-acid",
    "PC0001": "pectinase", "AG0001": "agar-agar",
    "FE0001": "essence-strawberry", "FE0002": "essence-raspberry",
    "FE0003": "essence-grapefruit", "FE0004": "essence-peach",
    "FE0005": "essence-vanilla", "FE0006": "essence-cherry",
    "FE0007": "essence-green-apple", "FE0008": "essence-mango",
    "FE0009": "essence-banana", "FE0010": "essence-blackcurrant",
}

FEATURED = ("levitating-martini", "levitating-super-pony", "saucer-coupe", "basalt-rocks")

NET = "Hand blowing"

HERO = [
    {"productSlug": "levitating-martini", "kicker": "The Levitating Series", "title": "Levitating",
     "copy": "Hand-blown crystal that defies gravity. Ultra-light, perfectly balanced, unforgettable "
             "in the hand."},
    {"productSlug": "etched-highball", "kicker": "Etched Editions", "title": "Etched",
     "copy": "A slender highball with a hand-etched constellation. Built for long, cold, "
             "precise serves."},
    {"productSlug": "champagne-saucer", "kicker": "Noir Series", "title": "Noir",
     "copy": "A wide, shallow bowl tuned for aroma. The silhouette that started the Embassy."},
]


def slugify(text: str) -> str:
    out = []
    for ch in text.lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in " -_" or ch == "'":
            out.append("-" if ch != "'" else "")
    slug = "".join(out)
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


def priced_specs(cod, cap, height, diameter, material):
    specs = {"Capacity": cap, "Material": material}
    if "ood" not in material:
        specs["Craft"] = NET
    if height:
        specs["Height"] = height
    if diameter:
        specs["Diameter"] = diameter
    specs["Code"] = cod
    return specs


def acid_specs(cod, name, spec):
    label = spec.partition(" · ")[0]
    if cod.startswith("ST"):
        specs = {"Length": label, "Diameter": "5 mm",
                 "Material": "Sugar cane" if "Sugar" in name else "Coffee", "Code": cod}
    elif cod.startswith("AC"):
        specs = {"Weight": label, "Grade": "Food grade", "Code": cod}
    elif cod.startswith("PC"):
        specs = {"Volume": label, "Grade": "Food grade", "Code": cod}
    elif cod.startswith("FE"):
        specs = {"Volume": label, "Grade": "Natural", "Code": cod}
    elif cod.startswith("AG"):
        specs = {"Weight": label, "Grade": "Food grade", "Code": cod}
    return specs


def full_name(collection, piece):
    if piece.lower().startswith(collection.lower()) or collection.lower() in piece.lower():
        return piece
    return "%s %s" % (collection, piece)


def build() -> dict:
    data = json.loads((ROOT / "data/content.json").read_text())

    data["settings"]["currency"] = "AED"
    data["settings"]["locale"] = "en-AE"
    data["settings"]["priceNote"] = "Prices per piece, AED, exclude VAT & shipping"
    data["settings"]["announcement"] = "Trade catalogue · AED per piece · Worldwide delivery from Dubai"

    collections, products = [], []

    def add_collection(slug, name, subtitle, description, image, coming_soon=False):
        entry = {"slug": slug, "name": name, "subtitle": subtitle,
                 "description": description, "image": image, "sort": len(collections) + 1}
        if coming_soon:
            entry["comingSoon"] = True
        collections.append(entry)

    def add_product(**p):
        p["id"] = "p%02d" % (len(products) + 1)
        p["sort"] = len(products) + 1
        p.setdefault("badge", None)
        p.setdefault("featured", False)
        p.setdefault("priceUsd", None)
        p.setdefault("comingSoon", False)
        p["inStock"] = bool(p.get("price")) and not p["comingSoon"]
        if p["badge"] is None:
            p.pop("badge")
        products.append(p)

    cover_for = {slug: meta[3] for slug, meta in HOUSE.items()}

    # --- house collections, then the pieces the price list adds to them
    for slug, (name, subtitle, description, cover, pieces) in HOUSE.items():
        add_collection(slug, name, subtitle, description, cover)
        for piece in pieces:
            add_product(
                slug=piece["slug"], name=piece["name"], subtitle=piece["subtitle"],
                categorySlug="glassware", collectionSlugs=[slug],
                price=piece["price"], priceUsd=None, volume=piece["specs"].get("Capacity"),
                images=[piece["image"]], description=piece["desc"], specs=piece["specs"],
                badge=piece["badge"], featured=piece["slug"] in FEATURED,
            )
        for cod, pname, cap, height, diameter, material, aed, usd in MERGE_INTO.get(slug, []):
            add_product(
                slug=slugify("%s %s" % (name, pname)), cod=cod,
                name=full_name(name, pname),
                subtitle="%s · %s" % (name, cap), categorySlug="glassware",
                collectionSlugs=[slug], price=aed, priceUsd=usd, volume=cap,
                images=[GLASS_ART[cod]], description=description,
                specs=priced_specs(cod, cap, height, diameter, material),
                badge="New" if cod == "AG0020" else None,
                featured="%s-%s" % (slug, slugify(pname)) in FEATURED,
            )

    # --- the priced collections of the list
    for slug, (name, subtitle, description, pieces) in PRICED.items():
        add_collection(slug, name, subtitle, description,
                       "assets/archive/covers/%s.webp" % slug, slug in COMING_SOON)
        for cod, pname, cap, height, diameter, material, aed, usd in pieces:
            add_product(
                slug=slugify("%s %s" % (name, pname)), cod=cod,
                name=full_name(name, pname),
                subtitle="%s · %s" % (name, cap), categorySlug="glassware",
                collectionSlugs=[slug], price=aed or 0, priceUsd=usd, volume=cap,
                images=[GLASS_ART[cod]], description=description,
                specs=priced_specs(cod, cap, height, diameter, material),
                comingSoon=slug in COMING_SOON,
            )

    # --- page two of the list
    for slug, (name, subtitle, description, pieces) in ACIDS.items():
        add_collection(slug, name, subtitle, description, ACID_ART[pieces[0][0]])
        for cod, pname, spec, aed, usd in pieces:
            add_product(
                slug=ACID_SLUGS[cod], cod=cod, name=pname,
                subtitle="%s · %s" % (name, spec), categorySlug="acids",
                collectionSlugs=[slug], price=aed or 0, priceUsd=usd, volume=spec,
                images=[ACID_ART[cod]], description=description,
                specs=acid_specs(cod, pname, spec),
            )

    data["collections"] = collections
    data["products"] = products
    data["categories"] = [
        {"slug": "glassware", "name": "Glassware",
         "blurb": "Hand-blown crystal for every serve", "sort": 1},
        {"slug": "acids", "name": "Acids & Other",
         "blurb": "Acids, essences, straws and enzymes", "sort": 2},
    ]

    # --- hero: the three house slides, plus the Levitating series
    by_slug = {p["slug"]: p for p in products}
    hero = [dict(slide) for slide in HERO]
    if not any(s.get("productSlug") == "levitating-super-pony" for s in hero):
        hero.append({
            "productSlug": "levitating-super-pony",
            "kicker": "The Levitating Series", "title": "Super Pony",
            "copy": "140 ml of crystal hanging off a pulled stem. The piece the trade orders by the case.",
        })
    for slide in hero:
        prod = by_slug[slide["productSlug"]]
        slide["name"] = prod["name"]
        slide["subtitle"] = prod["subtitle"].split(" · ")[0]
    data["settings"]["hero"] = hero

    return data


def main() -> None:
    data = build()
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    (ROOT / "data/content.json").write_text(text)
    shutil.copyfile(ROOT / "data/content.json", ROOT / "server/seed.json")

    print("collections: %d   products: %d" % (len(data["collections"]), len(data["products"])))
    missing = [p["images"][0] for p in data["products"] if not (ROOT / p["images"][0]).exists()]
    print("missing art:", missing or "none")
    unpriced = [p["slug"] for p in data["products"] if not p["price"]]
    print("unpriced:", unpriced or "none")
    for c in data["collections"]:
        n = sum(1 for p in data["products"] if c["slug"] in p["collectionSlugs"])
        print("  %-22s %2d%s" % (c["slug"], n, "  (first series)" if c.get("comingSoon") else ""))


if __name__ == "__main__":
    main()
