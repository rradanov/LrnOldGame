# LrnOldGame

Лично PWA за учене на шахматни дебюти — за телефон с Android и Chrome.
Работи и без интернет след първото отваряне.

**Отвори:** https://rradanov.github.io/LrnOldGame/ (в Chrome: меню → „Добавяне към началния екран“).

## Състояние

Версия 0.4.0 — четири раздела (Курсове · Преговор · Каталог · Настройки): каталог с 31 курса,
избор на курсове (9 предложени при първо пускане), списък на линиите и **тренировка на линия**
(D-015: играеш своите ходове, приложението — противника; линията е научена след `learnStreak`
поредни изигравания без грешка; грешка нулира брояча и показва верния ход). Логиката е в
`src/train/session.js` (без DOM), прогресът — в IndexedDB (`lineProgress`, `attempts`, `daily`).
**Преговор по FSRS на ниво линия** (D-008, T-010/T-020): научената линия получава карта
(`src/srs/fsrs.js`, FSRS-6, сверено с ts-fsrs); раздел „Преговор“ показва опашката за днес
(`src/srs/queue.js`), а оценката Добре/Трудно/Отново е автоматична (`src/srs/review.js`).
Данните на потребителя са в IndexedDB (бекъп в „Настройки“); всички курсове работят офлайн.

Проверка на преговора без чакане: `…/LrnOldGame/?now=+3d#/review` — приложението работи с
отделно копие на данните (`lrnoldgame-sim`), истинският прогрес не се променя.

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
(`publish=none`). Преди commit и след rebase върху `main` job-ът `publish` пуска наново валидатора и
`tests/unit/data-quality.test.mjs` и пада, ако `data/catalog.json` се различава от каталога на
генерирането (`manifest.generator.catalogSha256`). Кешовете на дървото, оценките и Stockfish са в `actions/cache`, затова повторно
пускане с близки параметри отнема минути.

**Край на линия (D-026, D-027):** бели — предимство `advCpWhite` (80); черни — `advCpBlack` (40)
или „равно“ (`equal`: cp ≥ `equalCpBlack` −25, D-029, след ≥ `minPlyBlack` 14 полухода и при предишния
мой ход). Предимство/равенство не спира насред размяна или шах (до `quietMaxPly` 4 полухода
довършване). Когато дървото свърши, линията продължава с най-добрите ходове на Stockfish до
`tailMaxPly` 18 (край `depth`); тези ходове са маркирани с `tail` (индекс в `m`).

Деплой: всеки push в `main` минава през CI, а след успех — към GitHub Pages.

## Лиценз

MIT (вж. `LICENSE`). Чуждите компоненти и лицензите им са в `THIRD_PARTY.md`.
