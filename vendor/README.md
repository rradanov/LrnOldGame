# vendor/

Външни библиотеки, копирани без промени от npm пакетите (`npm pack`, 2026-11-25).
Импортират се с относителни пътища; без bundler и без import map (ARCH §2).

| Папка | Пакет | Версия | Лиценз | Какво е копирано |
|---|---|---|---|---|
| `chess.js/` | [chess.js](https://github.com/jhlywa/chess.js) | 1.4.0 | BSD-2-Clause | `dist/esm/chess.js` → `chess.js`, `LICENSE` |
| `cm-chessboard/` | [cm-chessboard](https://github.com/shaack/cm-chessboard) | 8.15.8 | MIT (код) | `src/**/*.js` (без README файловете), `assets/chessboard.css`, `assets/pieces/standard.svg`, CSS/SVG на разширенията markers, arrows, promotion-dialog, `LICENSE` |
| `tabler/` | [@tabler/icons](https://github.com/tabler/tabler-icons) | 3.53.0 | MIT | `icons/outline/{arrow-left,arrow-right,arrow-back-up,arrow-bar-to-right}.svg`, `LICENSE` (2026-11-26, T-026; без webfont и без другите иконки) |

Фигурите `assets/pieces/standard.svg` са от Wikimedia Commons, лиценз CC BY-SA 3.0
(вж. `THIRD_PARTY.md`). Наборът „staunty“ (CC BY-NC-SA) нарочно не е копиран (D-003).

Файлът `VERSION` във всяка папка пази версията. Коментарите `sourceMappingURL`
са оставени, но `.map` файловете не са копирани (DevTools показва 404 — безвредно).

Обновяване: `npm pack <пакет>@<версия>`, разархивиране и копиране на същите файлове;
след това се обновяват `VERSION`, тази таблица и списъкът `SHELL` в `sw.js`
(unit тестът `tests/unit/sw.test.mjs` подсказва липсващите файлове).
