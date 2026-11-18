# Cocktail Embassy

A production-ready catalogue web app for **Cocktail Embassy** — hand-blown glassware
and cocktail acids for bars, hotels and studios.

Live site: **https://horaanlika-droid.github.io/ce/**

---

## Папки с фото бокалов и обложек (меняешь фото в папке — оно само меняется на сайте)

Все фотографии каталога и обложек лежат прямо в корне репозитория по папкам:

| Раздел | Папка в репозитории | Принцип |
| --- | --- | --- |
| **Бокалы (34 папки)** | [**`glasses/`**](./glasses/) | **1 папка = 1 бокал** (`glasses/levitating-martini/`, `glasses/champagne-saucer/`, …). Полная таблица соответствия — внутри [`glasses/README.md`](./glasses/README.md). |
| **Обложки сайта (14 папок)** | [**`covers/`**](./covers/) | **1 папка = 1 обложка**: 4 слайда главного экрана (`hero-*`), 6 обложек категорий (`category-*`) и обложки разделов (`home-craft`, `info-banner`, `info-story`, `og-share`). Список — внутри [`covers/README.md`](./covers/README.md). |
| **Кислоты, трубочки, эссенции (18 папок)** | [**`packaging/`**](./packaging/) | **1 папка = 1 позиция** (`packaging/citric-acid/`, `packaging/essence-mango/`, …). Список — внутри [`packaging/README.md`](./packaging/README.md). |

### Как заменить фото (с компьютера или телефона в GitHub):
1. Откройте нужную папку (например, `glasses/levitating-martini/` или `covers/hero-levitating-martini/`).
2. Загрузите новое фото (`.webp`, `.png`, `.jpg` или `.jpeg` — **подходит любой формат и любое имя файла**):
   - можно заменить `photo.webp` / `cover.webp` файлом с тем же именем, **или**
   - просто загрузить свой файл (даже `IMG_1234.jpg` без удаления стандартного `photo.webp` — сайт автоматически увидит новый файл и поставит его главным; но старый при желании лучше удалить, чтобы в папке был порядок).
3. Если в папку бокала загрузить **несколько ваших фото** (`1.jpg`, `2.jpg`, `3.jpg`), на странице этого бокала автоматически появится галерея ракурсов.
4. Для главных обложек (`covers/hero-*`): если загрузить **одно** новое фото, оно сразу встанет и на компьютере, и на телефоне.
5. Нажмите **Commit changes** — сайт сам подхватит новое фото и сбросит кэш браузера.

---

| Part | Where it runs | What it does |
| --- | --- | --- |
| **Storefront** (`index.html`, `css/`, `js/`, `glasses/`, `covers/`, `packaging/`, `data/`) | GitHub Pages | iOS-style catalogue: hero carousel, shop with search/filters, product pages, categories, request form |
| **Web Back Office** (`#/admin`) | Web browser | Панель управления каталогом, текстами, баннерами, фото и публикацией прямо на GitHub или через API |
| **Back office** (`server/`) | BotHost / Docker | REST API (FastAPI) + Telegram admin bot + SQLite |
| **Node.js runtime** (`src/`) | Node.js | Express API + Telegram bot (GrammY) + proforma invoice + checkout |

---

## Design reference — 1697–1702 (master)

> **Everything is matte black, app included, in a Tesla-like key.**
> The interface is a flat black room: no gradients, no glows, no drop shadows.
> Depth comes from three surface steps (`#0b0b0b` → `#141414` → `#1c1c1c`) and
> 1 px hairlines; corners are 2–8 px, labels are wide-tracked uppercase 10.5 px,
> the primary action is solid white on black, and the accent is silver — no blue
> anywhere in the UI.
>
> **The photography stage is DEEP MATTE BLACK too.** Lighting law
> unchanged: page background `#000000`, hairlines and light neutral, one cold
> silver accent. Plates are finished WebP/PNG: the deep-black stage, its light
> and the piece are already in the file. Shape, engraving, wall
> and base thickness stay 100 % those of the price list — checked by edge
> correlation (≥ 0.98).

`IMG_1697.png … IMG_1702.png` в корне репозитория —
**главные референсы по дизайну и съёмке стекла**. Любая визуальная работа сверяется с ними:
свет, тени, отражение, текстура стекла, глубина чёрного, посадка предмета на поверхность.
Подробный разбор — в [`docs/design-reference.md`](./docs/design-reference.md) и [`docs/audit-navy.md`](./docs/audit-navy.md).

---

## The storefront

Plain static files — no build step, no dependencies. Hash routing (`#/shop`, `#/product/…`, `#/admin`)
means it works identically on GitHub Pages, BotHost, or from a local folder.

* **Design** — a black room with the product photography as the only picture. The
  hero shows the piece's own catalogue plate (`assets/products/*.webp`), whole and
  never cropped, so its black edges dissolve into the page. Chrome wordmark, oversized negative
  tracking typography.
  iOS-native details: bottom tab bar, safe-area insets, sheet dialogs (drag them down
  to dismiss), spring easing, 44 px touch targets.
* **Catalogue** — six categories (Highball & Collins, Rocks & Tumblers, Cocktail &
  Martini, Wine & Serve, Acids & Essentials, Essences). Every piece lives in exactly one category.
  Search covers names, copy, categories and article numbers; sort by featured, price,
  name, volume or newest; filters for new pieces, stock and a price ceiling, all kept
  in the URL so a filtered view can be shared. Every piece carries an article number
  (AG/AC/PC/FE/ST + four digits) printed on the card and the product page.
* **Mechanics**:
  * **Opening curtain** — the chrome lockup and a single hairline progress bar,
    with `app by @stonym0ntana` set at the bottom.
  * **iOS screen motion** — a piece *pushes* in from the right, going back *pops* in from the left, tab switches cross-fade.
  * **Bar** — the current piece name fades into the top bar as you scroll, and a back chevron appears on deep screens.
  * **Running line** — ticker under the bar carries trade announcements and contact lines across the top; kinetic display band on the home page.
  * **Press states** — tactile spring answers to touch, like a native list.
* **Responsive** — single column + tab bar on phones, split hero and 4-up grid on desktop, sticky product stage at ≥ 900 px.
* **Catalogue** — 52 pieces in six categories, generated from the trade price list.
* **Requests, not checkout** — pieces are added to a request and submitted with contact details; shop owner receives it in Telegram / email.
* **Data flow** — `API → local admin edits → data/content.json → recent localStorage cache → recovery snapshot`. With no API configured the site is a fully working static catalogue. If the JSON request fails on a first visit (including private mode), `js/content-snapshot.js` supplies the complete catalogue without a JSON fetch. Live/published data and recent cached prices always take priority.

---

## Web Admin Panel (`#/admin`)

Веб-панель управления встроена прямо в витрину по адресу `#/admin`.
Вход защищён паролем (`embassy2026` по умолчанию, настраивается в панели).

В админке доступно:
* **Товары** — редактирование цен, описаний, характеристик, артикулов, фото, статусов наличия.
* **Категории** — редактирование описаний и обложек.
* **Слайды главного экрана** — выбор товаров, заголовков и фонов.
* **Бегущие строки** — оперативное редактирование текста анонсов и тикеров.
* **Контакты и тексты сайта** — условия доставки, реквизиты, телефоны, email.
* **Публикация на GitHub** — сохранение правок напрямую в репозиторий через GitHub Personal Access Token без поднятия сервера!

---

## Local development

### Static storefront:
```bash
python3 -m http.server 4173
# open http://localhost:4173
```

After manually editing `data/content.json`, regenerate the committed recovery copy:
```bash
npm run content:snapshot
npm run content:snapshot -- --check  # verify it is up to date
node --test test/storefront*.test.mjs
```
The GitHub Pages workflow regenerates this snapshot automatically before every deployment,
including catalogue changes published from the web admin panel. The JSON file remains the source of truth.

### Python backend (FastAPI + Telegram bot):
```bash
cd server
python3 main.py
# API on :8080, bot polling in the same process
```

### Node.js backend (Express + Grammy bot):
```bash
npm install
npm test       # run test suite
npm start      # starts Express on :3000
```

---

## Repository layout

```
index.html              storefront entry (GitHub Pages root)
manifest.webmanifest    PWA manifest
sw.js                   offline shell
css/app.css             design tokens + all components (matte black)
js/                     config, api, store, views, router, icons, admin
glasses/                per-item photo folders (34 glassware SKUs)
covers/                 hero, category, and site covers (14 folders)
packaging/              acids, essences, and straws folders (18 SKUs)
assets/                 whole-scene webp plates, brand marks, scenes, archive
data/                   content.json (seed catalogue), defaults, audit
docs/                   design reference docs, photography audits
server/                 FastAPI API + Telegram admin bot + SQLite
src/                    Node.js Express + Grammy server
tools/                  Python catalog & image processing tools
```
