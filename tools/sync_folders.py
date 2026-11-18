#!/usr/bin/env python3
"""
Organizes and syncs repository media folders (`glasses/`, `covers/`, `packaging/`)
with `data/content.json`, `server/seed.json`, and `data/folder-defaults.json`.

Usage:
    python3 tools/sync_folders.py --init   # initial migration from assets/ into folders
    python3 tools/sync_folders.py          # scan folders and update data/content.json + server/seed.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT_PATH = ROOT / "data" / "content.json"
SEED_PATH = ROOT / "server" / "seed.json"
DEFAULTS_PATH = ROOT / "data" / "folder-defaults.json"

IMAGE_EXTS = {".webp", ".png", ".jpg", ".jpeg", ".avif", ".gif"}
PACKAGING_CATS = {"acids", "essences"}

CATEGORY_INITIAL_SOURCES = {
    "highball": "assets/products/levitating-highball-glass.webp",
    "rocks": "assets/products/footed.webp",
    "cocktail": "assets/products/martini.webp",
    "wine": "assets/products/saucer.webp",
    "acids": "assets/categories/acids.webp",
    "essences": "assets/categories/essences.webp",
}

SITE_COVER_FOLDERS = {
    "homeCraft": ("covers/home-craft", "assets/products/goblet.webp", "cover.webp"),
    "infoBanner": ("covers/info-banner", "assets/scenes/banner-signature.webp", "cover.webp"),
    "infoStory": ("covers/info-story", "assets/products/coupe.webp", "cover.webp"),
    "ogShare": ("covers/og-share", "assets/brand/og-cover.jpg", "cover.jpg"),
    "announcementImage": ("covers/announcement", "", "announcement.webp"),
}


def git_blob_sha(path: Path) -> str:
    raw = path.read_bytes()
    header = f"blob {len(raw)}\0".encode("utf-8")
    return hashlib.sha1(header + raw).hexdigest()


def natural_key(name: str) -> tuple:
    low = name.lower()
    stem = Path(low).stem
    priority = 1
    if stem in ("photo", "cover", "main", "1", "01", "wide"):
        priority = 0
    parts = [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", low)]
    return (priority, parts)


def list_folder_images(folder: Path, defaults: dict[str, str] | None = None) -> list[Path]:
    if not folder.is_dir():
        return []
    files = [
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
    ]
    files.sort(key=lambda p: natural_key(p.name))
    if defaults and len(files) > 1:
        custom = [
            p for p in files
            if defaults.get(p.relative_to(ROOT).as_posix()) != git_blob_sha(p)
        ]
        if custom:
            return custom
    return files


def resolve_hero_folder(folder: Path, defaults: dict[str, str] | None = None) -> tuple[str, str]:
    if not folder.is_dir():
        return ("", "")
    files = [
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith(".")
    ]
    if not files:
        return ("", "")

    def is_portrait(p: Path) -> bool:
        s = p.stem.lower()
        return "portrait" in s or "mobile" in s or "tall" in s

    portraits = sorted([p for p in files if is_portrait(p)], key=lambda p: natural_key(p.name))
    mains = sorted([p for p in files if not is_portrait(p)], key=lambda p: natural_key(p.name))

    if defaults and len(mains) > 1:
        custom_mains = [
            p for p in mains
            if defaults.get(p.relative_to(ROOT).as_posix()) != git_blob_sha(p)
        ]
        if custom_mains:
            mains = custom_mains

    if not mains:
        # Only a portrait-named file exists; use it everywhere
        rel = portraits[0].relative_to(ROOT).as_posix()
        return (rel, "")

    main_file = mains[0]
    main_rel = main_file.relative_to(ROOT).as_posix()

    if not portraits:
        return (main_rel, "")

    if defaults and len(portraits) > 1:
        custom_portraits = [
            p for p in portraits
            if defaults.get(p.relative_to(ROOT).as_posix()) != git_blob_sha(p)
        ]
        if custom_portraits:
            portraits = custom_portraits

    portrait_file = portraits[0]
    portrait_rel = portrait_file.relative_to(ROOT).as_posix()

    if defaults:
        main_changed = defaults.get(main_rel) != git_blob_sha(main_file)
        portrait_changed = defaults.get(portrait_rel) != git_blob_sha(portrait_file)
        if main_changed and not portrait_changed:
            return (main_rel, "")

    return (main_rel, portrait_rel)


def init_folders(data: dict) -> dict[str, str]:
    defaults: dict[str, str] = {}

    # 1. Products -> glasses/<slug>/photo.webp or packaging/<slug>/photo.webp
    for product in data.get("products", []):
        slug = product["slug"]
        cat = product.get("categorySlug", "")
        top = "packaging" if cat in PACKAGING_CATS else "glasses"
        folder = ROOT / top / slug
        folder.mkdir(parents=True, exist_ok=True)

        srcs = product.get("images") or []
        if srcs:
            src_path = ROOT / srcs[0].split("?")[0]
            if src_path.is_file():
                ext = src_path.suffix.lower() or ".webp"
                dest = folder / f"photo{ext}"
                if src_path.resolve() != dest.resolve():
                    shutil.copy2(src_path, dest)
                rel = dest.relative_to(ROOT).as_posix()
                defaults[rel] = git_blob_sha(dest)

    # 2. Categories -> covers/category-<slug>/cover.webp
    for cat in data.get("categories", []):
        slug = cat["slug"]
        folder = ROOT / "covers" / f"category-{slug}"
        folder.mkdir(parents=True, exist_ok=True)
        src_rel = cat.get("cover") or CATEGORY_INITIAL_SOURCES.get(slug, "")
        if src_rel:
            src_path = ROOT / src_rel.split("?")[0]
            if src_path.is_file():
                ext = src_path.suffix.lower() or ".webp"
                dest = folder / f"cover{ext}"
                if src_path.resolve() != dest.resolve():
                    shutil.copy2(src_path, dest)
                rel = dest.relative_to(ROOT).as_posix()
                defaults[rel] = git_blob_sha(dest)

    # 3. Hero slides -> covers/hero-<slug>/cover.webp + portrait.webp
    settings = data.setdefault("settings", {})
    for slide in settings.get("hero", []):
        slug = slide.get("productSlug", "")
        if not slug:
            continue
        folder = ROOT / "covers" / f"hero-{slug}"
        folder.mkdir(parents=True, exist_ok=True)
        wide_src = ROOT / "assets" / "scenes" / f"hero-{slug}.webp"
        port_src = ROOT / "assets" / "scenes" / f"hero-{slug}-portrait.webp"
        if wide_src.is_file():
            dest = folder / "cover.webp"
            if wide_src.resolve() != dest.resolve():
                shutil.copy2(wide_src, dest)
            defaults[dest.relative_to(ROOT).as_posix()] = git_blob_sha(dest)
        if port_src.is_file():
            dest_p = folder / "portrait.webp"
            if port_src.resolve() != dest_p.resolve():
                shutil.copy2(port_src, dest_p)
            defaults[dest_p.relative_to(ROOT).as_posix()] = git_blob_sha(dest_p)

    # 4. Editorial / site covers -> covers/<name>/cover.<ext>
    for _, (folder_rel, src_rel, dest_name) in SITE_COVER_FOLDERS.items():
        folder = ROOT / folder_rel
        folder.mkdir(parents=True, exist_ok=True)
        src_path = ROOT / src_rel
        if src_path.is_file():
            dest = folder / dest_name
            if src_path.resolve() != dest.resolve():
                shutil.copy2(src_path, dest)
            defaults[dest.relative_to(ROOT).as_posix()] = git_blob_sha(dest)

    return defaults


def sync_content(data: dict, defaults: dict[str, str]) -> dict:
    for product in data.get("products", []):
        slug = product["slug"]
        cat = product.get("categorySlug", "")
        top = "packaging" if cat in PACKAGING_CATS else "glasses"
        folder = ROOT / top / slug
        imgs = list_folder_images(folder, defaults)
        if imgs:
            product["images"] = [p.relative_to(ROOT).as_posix() for p in imgs]

    for cat in data.get("categories", []):
        slug = cat["slug"]
        folder = ROOT / "covers" / f"category-{slug}"
        imgs = list_folder_images(folder, defaults)
        if imgs:
            cat["cover"] = imgs[0].relative_to(ROOT).as_posix()
        else:
            cat.pop("cover", None)

    settings = data.setdefault("settings", {})
    for slide in settings.get("hero", []):
        slug = slide.get("productSlug", "")
        if not slug:
            continue
        folder = ROOT / "covers" / f"hero-{slug}"
        cover, portrait = resolve_hero_folder(folder, defaults)
        if cover:
            slide["cover"] = cover
        else:
            slide.pop("cover", None)
        if portrait:
            slide["portraitCover"] = portrait
        else:
            slide.pop("portraitCover", None)

    covers_map = dict(settings.get("covers") or {})
    for key, (folder_rel, _, _) in SITE_COVER_FOLDERS.items():
        imgs = list_folder_images(ROOT / folder_rel, defaults)
        if imgs:
            covers_map[key] = imgs[0].relative_to(ROOT).as_posix()
    settings["covers"] = covers_map
    return data


def write_readmes(data: dict) -> None:
    products = sorted(data.get("products", []), key=lambda p: p["slug"])
    glasses = [p for p in products if p.get("categorySlug") not in PACKAGING_CATS]
    packs = [p for p in products if p.get("categorySlug") in PACKAGING_CATS]
    categories = sorted(data.get("categories", []), key=lambda c: c.get("sort", 0))
    heroes = data.get("settings", {}).get("hero", [])

    glasses_lines = [
        "# Бокалы (`glasses/`) — одна папка = один бокал",
        "",
        "Каждая папка соответствует одному бокалу на сайте.",
        "",
        "### Как поменять фото бокала",
        "1. Откройте нужную папку из списка ниже.",
        "2. Замените файл `photo.webp` (или загрузите новый файл `.webp`, `.png`, `.jpg`, `.jpeg` с **любым именем** — даже если вы не удалите старый стандартный `photo.webp`, ваше новое фото автоматически станет главным).",
        "3. Если загрузить в папку **несколько ваших фото** (например `1.jpg`, `2.jpg`, `3.jpg`), на странице товара автоматически появится галерея ракурсов.",
        "4. Нажмите **Commit changes** — фото само обновится на сайте (в карточке каталога и на странице бокала).",
        "",
        "| Папка | Название на сайте | Артикул | Категория |",
        "| --- | --- | --- | --- |",
    ]
    for g in glasses:
        code = (g.get("specs") or {}).get("Code", "")
        glasses_lines.append(
            f"| [`{g['slug']}/`](./{g['slug']}/) | {g['name']} | `{code}` | `{g.get('categorySlug', '')}` |"
        )
    (ROOT / "glasses" / "README.md").write_text("\n".join(glasses_lines) + "\n", encoding="utf-8")

    covers_lines = [
        "# Обложки сайта (`covers/`) — одна папка = одна обложка",
        "",
        "Каждая папка управляет одной обложкой на сайте. Достаточно заменить файл внутри папки (или загрузить любую картинку `.webp`, `.png`, `.jpg`, `.jpeg`), и обложка обновится на сайте автоматически.",
        "",
        "## 1. Главный экран (Hero-слайдер на главной)",
        "- Если загрузить в папку **одно фото** (`cover.webp` или файл с любым именем), оно сразу встанет и на компьютере, и на телефоне.",
        "- Если нужен отдельный вертикальный кадр для телефона — положите второй файл со словом `portrait` в имени (например `portrait.webp` или `portrait.jpg`).",
        "",
        "| Папка | Слайд на главной |",
        "| --- | --- |",
    ]
    for h in heroes:
        slug = h.get("productSlug", "")
        covers_lines.append(f"| [`hero-{slug}/`](./hero-{slug}/) | {h.get('name') or slug} |")

    covers_lines += [
        "",
        "## 2. Обложки категорий на главной («Six ways to serve»)",
        "",
        "| Папка | Категория |",
        "| --- | --- |",
    ]
    for c in categories:
        covers_lines.append(f"| [`category-{c['slug']}/`](./category-{c['slug']}/) | {c['name']} |")

    covers_lines += [
        "",
        "## 3. Обложки разделов и страниц",
        "",
        "| Папка | Где отображается |",
        "| --- | --- |",
        "| [`home-craft/`](./home-craft/) | Главная страница — блок «The craft · Hand-blown, never manufactured» |",
        "| [`info-banner/`](./info-banner/) | Страница «The Embassy» (`#/info`) — верхний широкий баннер |",
        "| [`info-story/`](./info-story/) | Страница «The Embassy» (`#/info`) — фото блока «Since 2024» |",
        "| [`og-share/`](./og-share/) | Превью ссылки при отправке сайта в Telegram / WhatsApp |",
        "| [`announcement/`](./announcement/) | Картинка объявления — в бегущей строке сверху (или из админки: Настройки → «Картинка к объявлению») |",
    ]
    (ROOT / "covers" / "README.md").write_text("\n".join(covers_lines) + "\n", encoding="utf-8")

    pack_lines = [
        "# Кислоты, трубочки и эссенции (`packaging/`) — одна папка = одна позиция",
        "",
        "Работает точно так же, как `glasses/`: замените фото внутри папки позиции (`.webp`, `.png`, `.jpg`, `.jpeg`), и оно автоматически обновится на сайте.",
        "",
        "| Папка | Название на сайте | Артикул | Категория |",
        "| --- | --- | --- | --- |",
    ]
    for p in packs:
        code = (p.get("specs") or {}).get("Code", "")
        pack_lines.append(
            f"| [`{p['slug']}/`](./{p['slug']}/) | {p['name']} | `{code}` | `{p.get('categorySlug', '')}` |"
        )
    (ROOT / "packaging" / "README.md").write_text("\n".join(pack_lines) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--init", action="store_true", help="Populate folders from existing assets/")
    args = ap.parse_args()

    data = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    if args.init:
        defaults = init_folders(data)
        DEFAULTS_PATH.write_text(json.dumps(defaults, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    else:
        defaults = (
            json.loads(DEFAULTS_PATH.read_text(encoding="utf-8"))
            if DEFAULTS_PATH.is_file()
            else {}
        )

    data = sync_content(data, defaults)
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    CONTENT_PATH.write_text(serialized, encoding="utf-8")
    SEED_PATH.write_text(serialized, encoding="utf-8")
    write_readmes(data)
    print(
        f"Synced {len(data.get('products', []))} products, "
        f"{len(data.get('categories', []))} categories, "
        f"{len(data.get('settings', {}).get('hero', []))} hero slides."
    )


if __name__ == "__main__":
    main()
