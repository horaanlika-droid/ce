# Обложки сайта (`covers/`) — одна папка = одна обложка

Каждая папка управляет одной обложкой на сайте. Достаточно заменить файл внутри папки (или загрузить любую картинку `.webp`, `.png`, `.jpg`, `.jpeg`), и обложка обновится на сайте автоматически.

## 1. Главный экран (Hero-слайдер на главной)
- Если загрузить в папку **одно фото** (`cover.webp` или файл с любым именем), оно сразу встанет и на компьютере, и на телефоне.
- Если нужен отдельный вертикальный кадр для телефона — положите второй файл со словом `portrait` в имени (например `portrait.webp` или `portrait.jpg`).

| Папка | Слайд на главной |
| --- | --- |
| [`hero-levitating-martini/`](./hero-levitating-martini/) | Levitating Martini |
| [`hero-etched-highball/`](./hero-etched-highball/) | Etched Highball |
| [`hero-champagne-saucer/`](./hero-champagne-saucer/) | Champagne Saucer |
| [`hero-levitating-super-pony/`](./hero-levitating-super-pony/) | Levitating Super Pony |

## 2. Обложки категорий на главной («Six ways to serve»)

| Папка | Категория |
| --- | --- |
| [`category-highball/`](./category-highball/) | Highball & Collins |
| [`category-rocks/`](./category-rocks/) | Rocks & Tumblers |
| [`category-cocktail/`](./category-cocktail/) | Cocktail & Martini |
| [`category-wine/`](./category-wine/) | Wine & Serve |
| [`category-acids/`](./category-acids/) | Acids & Essentials |
| [`category-essences/`](./category-essences/) | Essences |

## 3. Обложки разделов и страниц

| Папка | Где отображается |
| --- | --- |
| [`home-craft/`](./home-craft/) | Главная страница — блок «The craft · Hand-blown, never manufactured» |
| [`info-banner/`](./info-banner/) | Страница «The Embassy» (`#/info`) — верхний широкий баннер |
| [`info-story/`](./info-story/) | Страница «The Embassy» (`#/info`) — фото блока «Since 2024» |
| [`og-share/`](./og-share/) | Превью ссылки при отправке сайта в Telegram / WhatsApp |
| [`announcement/`](./announcement/) | Картинка объявления — в бегущей строке сверху (также можно загрузить из админки: Настройки → «Картинка к объявлению») |
