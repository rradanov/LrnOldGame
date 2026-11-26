# Чужди компоненти и лицензи

| Компонент | Версия | Лиценз | Източник |
|---|---|---|---|
| chess.js | 1.4.0 | BSD-2-Clause, © 2025 Jeff Hlywa | https://github.com/jhlywa/chess.js — `vendor/chess.js/LICENSE` |
| cm-chessboard | 8.15.8 | MIT, © 2017 Stefan Haack | https://github.com/shaack/cm-chessboard — `vendor/cm-chessboard/LICENSE` |
| Tabler Icons (`@tabler/icons`, само `arrow-left`, `arrow-right`, `arrow-back-up`, `arrow-bar-to-right`, `bulb`, `player-play`, `check`, `eye` от `icons/outline/`) | 3.53.0 | MIT, © 2020-2026 Paweł Kuna | https://tabler.io/icons, https://github.com/tabler/tabler-icons — `vendor/tabler/LICENSE` |
| Шахматни фигури „standard“ (спрайт в cm-chessboard) | — | CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/); автори Cburnett (https://en.wikipedia.org/wiki/User:Cburnett) и Rfc1394 (https://en.wikipedia.org/wiki/User:Rfc1394); адаптирани от shaack за cm-chessboard | https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces/Standard — бележката е и в `vendor/cm-chessboard/assets/pieces/standard.svg` |

Само за тестовете (devDependencies, не влизат в сайта):
- **ts-fsrs** 6.0.1 (MIT, © open-spaced-repetition) с `@open-spaced-repetition/srs-kit` 1.0.1 (BSD-3-Clause) — референция за `src/srs/fsrs.js` в `tests/unit/fsrs.test.mjs`. Тежестите на FSRS-6 по подразбиране в `src/srs/fsrs.js` са взети от него.
- **fake-indexeddb** (Apache-2.0) — IndexedDB в Node за unit тестовете.

Данни:
- **lichess-org/chess-openings** (CC0) — `tools/chess-openings/a.tsv`…`e.tsv`, копие от https://github.com/lichess-org/chess-openings (master, commit `48a8c0e733facfdc9a3723fe882e51ec28014074`, свалено 2026-11-25). Ползва се от валидатора на данните (имена и ECO в `data/catalog.json`) и от генератора на линии.
- **Stockfish 19** (GPL-3.0, https://stockfishchess.org/) — линиите в `data/courses/` са изчислени с него. Двигателят се сваля и пуска само в CI (официален binary `sf_19`, sha256 в `tools/build-courses/config.json`), не е част от репото и от приложението; оценките и ходовете, които дава, не са производно произведение.
- Дъмповете на партиите от lichess.org (https://database.lichess.org/) са CC0; използват се само в CI и не влизат в сайта.

Иконките в `icons/` са създадени за този проект и са под MIT като останалия код.

Същите атрибуции, с линкове, са в приложението: **Настройки → За приложението**.
