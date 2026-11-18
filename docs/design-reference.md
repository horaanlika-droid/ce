# Design reference — 1697–1702 (master)

> **Update 31 Oct 2026 — background is now DEEP MATTE BLACK.**
> The lighting law from 1697–1702 still stands (diffuse backlight, two asymmetric
> edge strips, top panel on the rim, black flags, thin silver-white contour, soft
> contact shadow, one continuous falloff, no horizon). What changed is the stage:
> the navy backdrop is retired. Every plate sits on **true black `#000000`,
> at most `#0e0e0e` of neutral haze directly behind the piece** — matte, no blue,
> no navy, no cyan anywhere in the frame, no blue cast inside the glass.
>
> **Fidelity is absolute.** Shape, engraving, wall thickness and base thickness
> must be 100 % those of the pieces in the price list and in `brand-source/`.
> Plates are therefore **not re-rendered**: each accepted navy master is taken
> through an image *edit* whose only job is to swap the backdrop and neutralise
> the blue cast. The glass is untouched — verified by edge correlation between
> the master and the result (≥ 0.98). Output stage: `brand-source/black/`.
> A fresh text-to-image render is only allowed for a shape that has no master at
> all, and that render then becomes the master for every later edit.

> **Правило дома.** Кадры `IMG_1697.png … IMG_1702.png` в корне репозитория —
> **главный референс по дизайну**. Любая визуальная работа (фото предмета,
> обложка коллекции, упаковка, лендинг, баннер, соцсеть) сверяется с ними
> в первую очередь. Это не «один из вариантов» — это эталон.

## Что именно задают 1697–1702

| Файл | Что в нём эталонного |
| --- | --- |
| `IMG_1697.png` | групповая постановка: три бокала в одной линии, общий свет, общий масштаб — эталон для любых «вместе» |
| `IMG_1698.png` | мартини: широкий неглубокий конус, тонкая ножка, тонкая стопа |
| `IMG_1699.png` | footed: прямостенный стакан на короткой стопе |
| `IMG_1700.png` | цилиндр с гравировкой точками: как читается фрост на тёмном стекле |
| `IMG_1701.png` | купе: глубокая полусфера, короткая ножка |
| `IMG_1702.png` | гоблет: U-образная чаша, короткая стойка |

## Параметры, которые берутся только отсюда

1. **Фон.** Глубокий нави, один непрерывный градиент. Нет линии горизонта, нет шва стола,
   нет полосы внизу кадра. Углы ≈ `#0d2340`, светлое пятно за стеклом ≈ `#21436f`.
2. **Свет.** Диффузный контр-свет за предметом, два асимметричных стрипа по краям,
   верхняя панель на венец, минимум фронтального заполнения, нижний акцент на дно,
   чёрные флаги для объёма. Сами панели в кадре не видны — они живут только в отражениях.
3. **Стекло.** Прозрачное, водянистое, тело — нави на просвет (`#27486e…#3c6488`).
   Без молочности, без белой заливки, без чёрной массы; самые тёмные зоны ≈ `#17324f`.
   Яркое на предмете — только тонкие серебристо-белые контурные блики по реальной геометрии.
4. **Толщина.** Тонкая стенка, тонкое дно и стопа. Никаких массивных блоков.
5. **Тень и посадка.** Мягкая контактная тень + размытое зеркальное отражение,
   растворяющееся в фоне. Предмет стоит, не парит.
6. **Кадр.** Один предмет по центру, вертикаль 2:3, ~45–60 % высоты кадра.
   Для «вместе» — обложки 14:9 с диагональным или три-четверти ракурсом.
7. **Материал съёмки.** Фотография, а не 3D-рендер: без CG-гладкости, без неона,
   без пересветов, без искусственных обводок.

## Чего в этом стиле не бывает

- линии горизонта и «пола» как отдельной плоскости;
- молочного, матового или тонированного стекла;
- плотной чёрной массы внутри предмета;
- светящихся неоновых кромок и широкого блюма;
- видимых софтбоксов, панелей и стен;
- текста, логотипов и вотермарков в самом кадре;
- изменения формы предмета ради красоты кадра.

## Как это применяется в репозитории

- Мастера: `brand-source/navy/*.png` (предметы, обложки, упаковка).
- Форма предмета никогда не выдумывается: источник — `assets/scenes/glasses-lineup-pricelist.png`
  и alpha-каты `brand-source/cutouts/*.png`; стиль — готовый кадр сета или 1697–1702.
- Упаковка: чистые мастера `pack-*-blank.png` + типографика кодом (`tools/pack_labels.py`).
- Каталог: `tools/navy_to_catalog.py` (2:3 → 4:5 без ресемпла предмета).
- Аудит соответствия: `docs/audit-navy.md`.
