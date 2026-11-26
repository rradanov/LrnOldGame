# Разлики между кода (0.5.0) и ARCH_T-014

Към 2026-11-26 (T-012). Тук е само това, което е **различно** от ARCH_T-014 или липсва в него.
Решенията D-025…D-029 са взети след ARCH. Подробности: [lines.md](lines.md),
[review.md](review.md), [data-update.md](data-update.md).

## §1, §6.3 Генериране в CI
- **Node 24** е във всички workflow-и (`ci.yml`, `build-courses.yml`; ARCH казва 22). Причината е,
  че ts-fsrs ≥ 6 (devDependency за сверка на FSRS) иска Node ≥ 24. `package.json`: `engines.node >= 24`.
- Конфигът е разделен на `tools/build-tree/config.json` и `tools/build-courses/config.json`, а не е
  един `tools/generate/config.json`.
- `build-courses.yml` има **15 входа**:
  - `month`, `maxGames` (4 000 000), `minElo` (1200), `maxElo` (1800), `minBaseSec` (180), `treeMaxPly`;
  - `courses`, `linesPerCourse`, `advCpWhite`, `advCpBlack`, `maxPly`, `oppMinShare`, `engineNodes`;
  - `overrides` (JSON);
  - `publish` = `main` (подразбиране) / `pr` / `none`.
- Job-ът `build` е само с права за четене. Отделен job `publish` проверява наново данните
  (валидатор и `data-quality` тестове, T023-D5.1), прави commit в `main` и сам пуска CI → deploy
  (`workflow_dispatch`).
- Ключът на кеша на оценките е `evals-sf19-<run_id>` (restore по префикс `evals-sf19-`). Той **не
  зависи** от версията на `evaluator.js` (T018-D8.6, отложено). При промяна в оценяването кешът
  трябва да се изчисти ръчно или да се смени префиксът.
- `deploy.yml` има два job-а (build → deploy), според шаблона на Pages. Ръчен deploy
  (`workflow_dispatch`) е разрешен **само от `main`** (T023-D5.3).

## §2.4 Край на линията (D-026, D-027, D-029)
- Праговете за предимство са `advCpWhite` **80** и `advCpBlack` **40** (ARCH: 100/60).
- Нов край **`equal`** — само за черните: cp ≥ `equalCpBlack` (**−25**, D-029) при ply ≥
  `minPlyBlack` (14), и „стабилно“ (предишният мой ход също е ≥ прага).
- **Довършване до спокойна позиция:** `adv`/`equal` не спират насред размяна или шах. Линията
  продължава до `quietMaxPly` (4) полухода с най-добрите ходове.
- **Опашка от двигателя (D-027):** когато дървото не дава ход на противника, линията продължава
  без разклоняване с най-добрия ход на Stockfish за противника. Продължава до `tailMaxPly` (18;
  край `depth`) или до край по D-026. `data` остава само ако данните свършат след `tailMaxPly`.
- Нови параметри в §6.2: `equalCpBlack`, `minPlyBlack`, `tailMaxPly` (0 = без опашка),
  `quietMaxPly` (0 = без довършване). Подразбирането на `oppMinGames` е 12, а на
  `oppMinMoveGames` е 6 (ARCH: 20/10).

## §3.2 Файл на курс
- `end` има и стойност `equal`.
- Ново незадължително поле **`tail`**: индексът в `m` на първия ход без данни от партии. Винаги
  сочи ход на противника. Приложението показва тези ходове в курсив.

## §3.3 manifest.json
- `generator`: `{tool, commit, node, catalogSha256}`. `publish` пада, ако каталогът в `main` е
  различен от `catalogSha256`.
- `engine`: и `id` (напр. „Stockfish 19“), `threads`, `npsSource` (`bench`).
- `source`: `stoppedBy`, `positions`, `treeParamsHash`, `lossy` (оценка на подброяването при
  изрязване на дървото).

## §4 IndexedDB (схема 1, без промяна на store-овете)
- Нови полета в `lineProgress`:
  - `lastPlayed`;
  - `relearnLeft`, `relearnDay` (повторение след „Отново“);
  - `fsrs.scheduledDays`;
  - **`info = {m, name, eco}`** (T-012) — ходовете на линията, за да се покаже, ако изчезне;
  - **`orphan = {prevStatus, at, dataVersion, fromVersion, n}`** (T-012).
- Нови ключове в `meta`:
  - `lineIds` (снимка на линиите по курс) и `dataUpdate` (резюме на последното обновяване) — T-012;
  - `suggestedBanner`, `legacySettingsMigrated`, `lastBackup`;
  - `simCopiedAt` (само в базата за симулация `lrnoldgame-sim`).
- `attempts`: и `done`, `plies`, `total`, `userMoves`, `maxMoveMs`, `streakAfter`, `relearn`,
  `relearnLeft`, `interval`, `dueAfter`. `daily`: и `grades: {again, hard, good}`.
- **Orphan редовете не се трият** (ARCH: пазят се 90 дни). Не се броят, не влизат в преговора и се
  връщат, ако линията се появи отново.
- „+X нови“ се изчислява от снимката `meta.lineIds`. Без снимка (първото стартиране на 0.5.0)
  „нови“ не се броят.

## §4 FSRS и оценка
- FSRS-6 (21 тежести на ts-fsrs 6.0.1), само дългосрочен режим. Първият интервал е **3 дни**, а
  не 2, заради монотонността Hard < Good, както е в ts-fsrs.
- Нов параметър `reviewErrorsForAgain` (1). При 2 една грешка дава „Трудно“, а две дават „Отново“.
- След „Отново“ линията **остава научена** (`fsrs.state = relearning`). Повтаря се веднага до
  `relearnStreak` чисти пробега, а следващият ѝ преговор е утре.
- Нови параметри в „Преговор“: `maxIntervalDays` (3650) и `reviewFuzz` (изключено).

## §5 Екрани
- **Край на линия в режим learn** (T-021): вместо автоматичен рестарт има панел „Линията е
  изиграна ✓ (2/3)“ с „Пак“ и „Следваща линия“. При `onError = restart` грешката рестартира
  автоматично.
- Нови runtime параметри (§6.1): `hintAfterSec` (0 = изключено), `wrongMoveMs` (500),
  `reviewErrorsForAgain`, `maxIntervalDays` и `reviewFuzz`.
- **Скрито симулирано време:** `?now=+3d` (и `&simreset=1`) с отделна база `lrnoldgame-sim`.
- **„Курсове“:**
  - резюме след обновяване на данните (+X/−Y), до „Разбрах“ или 14 дни;
  - напомняне за бекъп, ако има научени линии, а бекъпът е по-стар от `backupReminderDays`
    или липсва.
- **„Курс“:**
  - бележка „Обновен …“;
  - знак „ново“ на новите линии;
  - сгънат раздел „Вече не са в курса (Y)“.
- **„Настройки → За приложението“:** версия и BUILD, версия на данните, офлайн състояние,
  лиценз MIT и линк към репото. Лицензите и атрибуциите са с линкове: lichess database CC0,
  chess-openings CC0, chess.js BSD-2-Clause, cm-chessboard MIT, фигури CC BY-SA 3.0 от Cburnett и
  Rfc1394. Има и бележка, че Stockfish 19 (GPL-3.0) е ползван само при генерирането.
- Първо отваряне без мрежа до данните: съобщение „Няма връзка с интернет…“ и сам повторен опит
  при `online`. ★ курсовете се отмятат при първото **успешно** зареждане, а не само при първото
  стартиране.

## §8 Тестове
- E2E върви върху **истинските данни** в `data/`, а не върху fixtures. Fixtures остават за unit
  тестовете.
- Тестовите куки на сървъра (само с `--test`): `/__test/sw-build?b=`,
  `/__test/data-version?v=…[&retire=<курс>:<n>]`.
