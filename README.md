# LrnOldGame

Лично PWA за учене на шахматни дебюти — за телефон с Android и Chrome.
Работи и без интернет след първото отваряне.

**Отвори:** https://rradanov.github.io/LrnOldGame/ · **Код:** https://github.com/rradanov/LrnOldGame

## Инсталиране на телефона (Android, Chrome)

1. Отвори https://rradanov.github.io/LrnOldGame/ в Chrome, докато имаш интернет. При първото
   отваряне се изтеглят приложението и всички курсове (около 200 KB с компресия).
2. Меню ⋮ → **„Инсталиране на приложението“** (или „Добавяне към началния екран“ → „Инсталиране“).
3. Отваряй го от иконата LrnOldGame. Работи и в самолетен режим.
4. Когато излезе нова версия, долу се появява „Има нова версия. **Обнови**“. Изборът на курсове,
   прогресът и настройките се запазват (вж. [docs/data-update.md](docs/data-update.md)).
5. Прогресът е само на това устройство. Пази го с **Настройки → Бекъп → Изтегли бекъп**.
   Приложението напомня, ако бекъпът е по-стар от `backupReminderDays` (14 дни).

## Как се ползва

- **Каталог.** Избираш курсове с отметка „Уча го“. Курсът е дебют за една страна с около 20 линии.
  При първо пускане са избрани 9 предложени курса.
- **Курсове → курс → „Учи следващата“.** Играеш своите ходове, а приложението играе противника.
  Грешка показва верния ход и нулира брояча. Линията е **научена** след 3 изигравания подред без
  грешка (`learnStreak`).
- **Преговор.** Научените линии идват за преговор по FSRS. Оценката „Добре / Трудно / Отново“ е
  автоматична: зависи от грешките, подсказките и бавните ходове. Червеното число на раздела
  показва колко линии чакат днес.
- **Настройки.** Всички параметри на ученето и преговора (с граници и стойност по подразбиране),
  данните на курсовете, бекъп и „За приложението“ (версия, лицензи).

Правилата са описани в `docs/`:
- [lines.md](docs/lines.md) — как се строи линията и кога свършва (D-026, D-029), опашката `tail` (D-027);
- [review.md](docs/review.md) — учене, FSRS и автоматичната оценка;
- [data-update.md](docs/data-update.md) — обновяване на данните без загуба на прогрес;
- [ARCH_NOTES.md](docs/ARCH_NOTES.md) — разлики спрямо архитектурата ARCH_T-014.

Проверка на преговора без чакане: `…/LrnOldGame/?now=+3d#/review`. Приложението работи с
отделно копие на данните (`lrnoldgame-sim`) и истинският прогрес не се променя.

## Състояние

Версия 0.5.2 (T-026). Има:
- каталог с 31 курса;
- тренировка на линия: лента с иконки под дъската (Tabler Icons) и взети фигури с материално предимство „+N“;
- преговор по FSRS на ниво линия;
- обновяване на данните без загуба на прогрес;
- офлайн режим, бекъп и екран „За приложението“.

Приложението следва системната тъмна тема.

## Разработка

Без framework и без bundler: чисти ES модули. npm е само за тестовете. Изисква **Node 24**,
защото ts-fsrs го иска. На него вървят и CI, и генерирането.

```sh
npm ci
npm run serve        # http://localhost:4173/LrnOldGame/
npm run test:unit    # node --test
npx playwright install chromium
npm run test:e2e     # Playwright, профил Pixel 7
```

Структура: `src/` (код), `vendor/` (chess.js, cm-chessboard, 4 иконки от Tabler Icons), `data/` (каталог `catalog.json`,
генерирани курсове, тестови курсове в `data/fixtures/`), `tools/` (генератори, валидатор
`npm run validate-data`), `tests/unit`, `tests/e2e`.

Данни (само в CI, T-017): `npm run build-tree` строи дърво от lichess (`build/tree.jsonl.gz`),
`npm run build-courses` строи линиите със Stockfish → `data/courses/*.json` + `data/manifest.json`
(параметри: `tools/build-courses/config.json`, `node tools/build-courses --help`). Stockfish не е в
репото; интеграционният тест се пуска с `STOCKFISH_PATH=<binary> npm run test:unit`.

**Ново генериране:** Actions → **Build courses** → Run workflow, или от командния ред:

```sh
gh workflow run build-courses.yml -f publish=main
# например само два курса, 25 линии, по-строг праг за белите, без кеша на оценките:
gh workflow run build-courses.yml -f courses=italian,caro-kann -f linesPerCourse=25 \
  -f advCpWhite=100 -f overrides='{"cache":{"use":false}}' -f publish=pr
```

Входове: `month` (празно = последният наличен), `maxGames` (4 000 000), `minElo`/`maxElo`
(1200/1800), `minBaseSec` (180), `treeMaxPly` (28), `courses` (all), `linesPerCourse` (20),
`advCpWhite` (80), `advCpBlack` (40), `maxPly` (24), `oppMinShare` (0.1), `engineNodes` (500 000),
`overrides`, `publish`. Подразбиране: 4 млн. партии, `publish=main`.
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
