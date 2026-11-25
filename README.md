# LrnOldGame

Лично PWA за учене на шахматни дебюти — за телефон с Android и Chrome.
Работи и без интернет след първото отваряне.

**Отвори:** https://rradanov.github.io/LrnOldGame/ (в Chrome: меню → „Добавяне към началния екран“).

## Състояние

Версия 0.1.0 — скелет: пет екрана (Днес, Изследвай, Репертоар, Тренировка, Настройки),
офлайн режим и настройки. Дървото на дебютите и тренировката идват в следващите версии.

## Разработка

Без framework и без bundler: чисти ES модули. npm е само за тестовете.

```sh
npm ci
npm run serve        # http://localhost:4173/LrnOldGame/
npm run test:unit    # node --test
npx playwright install chromium
npm run test:e2e     # Playwright, профил Pixel 7
```

Структура: `src/` (код), `vendor/` (chess.js, cm-chessboard), `data/` (каталог `catalog.json`,
генерирани курсове, тестови курсове в `data/fixtures/`), `tools/` (генератори, валидатор
`npm run validate-data`), `tests/unit`, `tests/e2e`.

Данни (само в CI, T-017): `npm run build-tree` строи дърво от lichess (`build/tree.jsonl.gz`),
`npm run build-courses` строи линиите със Stockfish → `data/courses/*.json` + `data/manifest.json`
(параметри: `tools/build-courses/config.json`, `node tools/build-courses --help`). Stockfish не е в
репото; интеграционният тест се пуска с `STOCKFISH_PATH=<binary> npm run test:unit`.

**Ново генериране:** Actions → **Build courses** → Run workflow (или
`gh workflow run build-courses.yml -f maxGames=2000000`). Празните входове вземат стойностите от
конфига; `overrides` е JSON за останалото (`{"tree":{…},"lines":{…},"engine":{…},"cache":{…}}`).
Резултатът идва като PR от клон `data/update-<run>` (`publish=pr`), направо в `main`
(`publish=main`) или само като артефакт (`publish=none`). Кешовете на дървото, оценките и Stockfish
са в `actions/cache`, затова повторно пускане с близки параметри отнема минути.

Деплой: всеки push в `main` минава през CI, а след успех — към GitHub Pages.

## Лиценз

MIT (вж. `LICENSE`). Чуждите компоненти и лицензите им са в `THIRD_PARTY.md`.
