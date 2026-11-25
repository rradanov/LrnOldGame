# Чужди компоненти и лицензи

| Компонент | Версия | Лиценз | Източник |
|---|---|---|---|
| chess.js | 1.4.0 | BSD-2-Clause, © 2025 Jeff Hlywa | https://github.com/jhlywa/chess.js — `vendor/chess.js/LICENSE` |
| cm-chessboard | 8.15.8 | MIT, © 2017 Stefan Haack | https://github.com/shaack/cm-chessboard — `vendor/cm-chessboard/LICENSE` |
| Шахматни фигури „standard“ (спрайт в cm-chessboard) | — | CC BY-SA 3.0, автори от Wikimedia Commons | https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces |

Данни:
- **lichess-org/chess-openings** (CC0) — `tools/chess-openings/a.tsv`…`e.tsv`, копие от https://github.com/lichess-org/chess-openings (master, commit `48a8c0e733facfdc9a3723fe882e51ec28014074`, свалено 2026-11-25). Ползва се от валидатора на данните (имена и ECO в `data/catalog.json`) и от генератора на линии.
- Дъмповете на партиите от lichess.org (https://database.lichess.org/) са CC0; използват се само в CI и не влизат в сайта.

Иконките в `icons/` са създадени за този проект и са под MIT като останалия код.
