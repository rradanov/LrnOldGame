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

Структура: `src/` (код), `vendor/` (chess.js, cm-chessboard), `data/` (дърво на дебютите),
`tools/` (генератор и помощни скриптове), `tests/unit`, `tests/e2e`.

Деплой: всеки push в `main` минава през CI, а след успех — към GitHub Pages.

## Лиценз

MIT (вж. `LICENSE`). Чуждите компоненти и лицензите им са в `THIRD_PARTY.md`.
