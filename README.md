# LrnOldGame

Лично PWA за учене на шахматни дебюти — за телефон с Android и Chrome.
Работи и без интернет след първото отваряне.

**Отвори:** https://rradanov.github.io/LrnOldGame/ (в Chrome: меню → „Добавяне към началния екран“).

## Състояние

Версия 0.2.0 — четири раздела (Курсове · Преговор · Каталог · Настройки): каталог с 31 курса,
избор на курсове (9 предложени при първо пускане), списък на линиите и преглед ход по ход.
Данните на потребителя са в IndexedDB (бекъп в „Настройки“); всички курсове работят офлайн.
Тренировката и преговорът идват в следващите версии.

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
`gh workflow run build-courses.yml -f publish=main`). Подразбиране: 4 млн. партии, `publish=main`.
Празните входове вземат стойностите от конфига; `overrides` е JSON за останалото
(`{"tree":{…},"lines":{…},"engine":{nodes,multiPV,…},"cache":{…}}`; пътищата и идентичността на
двигателя не се задават оттам). Резултатът отива направо в `main` → CI → deploy (`publish=main`,
job-ът чака и двете), като PR от клон `data/update-<run>` (`publish=pr`; ако PR е забранен в
настройките, job-ът пада и оставя клона — без commit в `main`) или само като артефакт
(`publish=none`). Кешовете на дървото, оценките и Stockfish са в `actions/cache`, затова повторно
пускане с близки параметри отнема минути.

**Край на линия (D-026, D-027):** бели — предимство `advCpWhite` (80); черни — `advCpBlack` (40)
или „равно“ (`equal`: cp ≥ `equalCpBlack` 0 след ≥ `minPlyBlack` 14 полухода и при предишния
мой ход). Предимство/равенство не спира насред размяна или шах (до `quietMaxPly` 4 полухода
довършване). Когато дървото свърши, линията продължава с най-добрите ходове на Stockfish до
`tailMaxPly` 18 (край `depth`); тези ходове са маркирани с `tail` (индекс в `m`).

Деплой: всеки push в `main` минава през CI, а след успех — към GitHub Pages.

## Лиценз

MIT (вж. `LICENSE`). Чуждите компоненти и лицензите им са в `THIRD_PARTY.md`.
