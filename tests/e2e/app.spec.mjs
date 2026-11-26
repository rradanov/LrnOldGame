import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// E2E върху истинските данни от data/ (приложението не зарежда data/fixtures).
const MANIFEST = JSON.parse(readFileSync(new URL('../../data/manifest.json', import.meta.url), 'utf8'));
const CATALOG = JSON.parse(readFileSync(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
const DEFAULTS = CATALOG.courses.filter((c) => c.default).map((c) => c.id);
const LINES = Object.fromEntries(MANIFEST.courses.map((c) => [c.id, c.lines]));

const TABS = [
  ['courses', 'Моите курсове'],
  ['review', 'Преговор днес'],
  ['catalog', 'Каталог'],
  ['settings', 'Настройки'],
];

/** Чака Service Worker-ът да поеме контрола над страницата. */
async function waitForSW(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
}

async function open(page, hash = '') {
  await page.goto(`./${hash}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
}

const cards = (page) => page.locator('.course-card');
const rows = (page) => page.locator('.catalog-row');

test('първо пускане: „Моите курсове“ с 9-те ★ курса и 4 раздела, без JS грешки', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.locator('h1.screen-title')).toHaveText('Моите курсове');
  await expect(page.locator('nav#tabs a.tab')).toHaveCount(4);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bg');
  await expect(cards(page)).toHaveCount(9);
  expect(await cards(page).evaluateAll((els) => els.map((e) => e.dataset.course))).toEqual(DEFAULTS);
  await expect(cards(page).first()).toContainText('научени 0/');
  await expect(page.locator('#today-line')).toHaveText('Днес: 0 за преговор · до 5 нови');
  expect(errors).toEqual([]);
});

test('навигация между четирите раздела и бутон „Назад“', async ({ page }) => {
  await open(page);
  for (const [route, label] of TABS) {
    await page.locator(`nav#tabs a[data-route="${route}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.locator('h1.screen-title')).toHaveText(label);
    await expect(page.locator(`nav#tabs a[data-route="${route}"]`)).toHaveAttribute('aria-current', 'page');
  }
  await page.goBack();
  await expect(page.locator('h1.screen-title')).toHaveText('Каталог');
});

test('„Преговор“: празно състояние', async ({ page }) => {
  await open(page, '#/review');
  await expect(page.locator('.empty-big')).toHaveText('Нищо за преговор днес.');
});

test('каталог: банер, филтри Бели/Черни и групи, ★ отметнати', async ({ page }) => {
  await open(page, '#/catalog');
  await expect(page.locator('.notice.suggested')).toContainText('Предложени курсове');
  await expect(rows(page)).toHaveCount(15);
  await expect(page.locator('.catalog-row input.pick:checked')).toHaveCount(5);
  const it = page.locator('.catalog-row[data-course="italian"]');
  await expect(it).toContainText('Италианска партия');
  await expect(it).toContainText('Italian Game');
  await expect(it).toContainText('C50');
  await expect(it).toContainText(`${LINES.italian} линии`);

  await page.locator('[data-filter="side"] button[data-value="b"]').click();
  await expect(rows(page)).toHaveCount(16);
  await expect(page.locator('.catalog-row input.pick:checked')).toHaveCount(4);
  await expect(page.locator('[data-filter="group"] button')).toHaveCount(4); // Всички + 3 групи за черните
  await page.locator('[data-filter="group"] button[data-value="vs-d4"]').click();
  const vsD4 = CATALOG.courses.filter((c) => c.side === 'b' && c.group === 'vs-d4').length;
  await expect(rows(page)).toHaveCount(vsD4);
  await page.locator('[data-filter="group"] button[data-value="all"]').click();
  await expect(rows(page)).toHaveCount(16);

  await page.getByRole('button', { name: 'Разбрах' }).click();
  await expect(page.locator('.notice.suggested')).toHaveCount(0);
  // T-024: банерът се маха веднага, а записът в IndexedDB завършва след това — без изчакване
  // бързият runner в CI презарежда преди commit на транзакцията (2 поредни провала на 2026-11-26.2).
  await expect.poll(() => page.evaluate(() => globalThis.__lrn.userDb.getMeta('suggestedBanner', true))).toBe(false);
  await page.reload();
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator('.notice.suggested')).toHaveCount(0);
});

test('избор и махане на курс → „Моите курсове“; изборът оцелява при презареждане', async ({ page }) => {
  await open(page, '#/catalog');
  await page.locator('#pick-ruy-lopez').check();
  await page.locator('#pick-italian').uncheck();
  await expect(page.locator('#catalog-count')).toHaveText('Избрани: 9');
  await page.locator('nav#tabs a[data-route="courses"]').click();
  await expect(cards(page)).toHaveCount(9);
  await expect(page.locator('.course-card[data-course="ruy-lopez"]')).toBeVisible();
  await expect(page.locator('.course-card[data-course="italian"]')).toHaveCount(0);
  await page.reload();
  await expect(cards(page)).toHaveCount(9);
  await expect(page.locator('.course-card[data-course="ruy-lopez"]')).toBeVisible();
  // Махам всичко → празно състояние с връзка към каталога.
  await page.goto('./#/catalog');
  for (const side of ['w', 'b']) {
    await page.locator(`[data-filter="side"] button[data-value="${side}"]`).click();
    const checked = page.locator('.catalog-row input.pick:checked');
    while (await checked.count()) await checked.first().uncheck();
  }
  await page.locator('nav#tabs a[data-route="courses"]').click();
  await expect(page.locator('.empty-state')).toContainText('Още не си избрал курс.');
  await page.getByRole('link', { name: 'Към каталога' }).click();
  await expect(page.locator('h1.screen-title')).toHaveText('Каталог');
});

test('курс → линии (всички нови) → преглед на линия ход по ход', async ({ page }) => {
  await open(page);
  await page.locator('.course-card[data-course="italian"] a').click();
  await expect(page).toHaveURL(/#\/course\/italian$/);
  await expect(page.locator('h1.screen-title')).toHaveText('Италианска партия');
  await expect(page.locator('.line-row')).toHaveCount(LINES.italian);
  await expect(page.locator('.line-row[data-status="new"]')).toHaveCount(LINES.italian);
  await expect(page.locator('#learn-next')).toHaveText('Учи следващата (1)');
  await expect(page.locator('.line-row').first()).toContainText('нова');

  await page.locator('#learn-next').click();
  await expect(page).toHaveURL(/#\/train\/italian\/[0-9a-f]{8}\?mode=learn$/);
  await expect(page.locator('h1.screen-title')).toHaveText(`Италианска партия · линия 1/${LINES.italian}`);
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  await expect(page.locator('#ply-counter')).toHaveText('Начална позиция');
  await expect(page.locator('#nav-prev')).toBeDisabled();
  await page.locator('#nav-next').click();
  await page.locator('#nav-next').click();
  await expect(page.locator('#ply-counter')).toContainText('Ход 2 от');
  await expect(page.locator('.mv[aria-current]')).toHaveText('e5');
  await page.locator('#nav-last').click();
  await expect(page.locator('#nav-next')).toBeDisabled();
  // дъската се побира в ширината на телефона
  const box = await page.locator('.board-wrap').boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
  // назад към курса
  await page.locator('a.back').click();
  await expect(page).toHaveURL(/#\/course\/italian$/);
  // черен курс: дъската е обърната (черните долу)
  await page.goto('./#/course/caro-kann');
  await page.locator('.line-row a').first().click();
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  const bk = await page.locator('.board-wrap g[data-piece="bk"]').boundingBox();
  const wk = await page.locator('.board-wrap g[data-piece="wk"]').boundingBox();
  expect(bk.y).toBeGreaterThan(wk.y);
});

test('работи офлайн след първото зареждане (вкл. курс, който не е отварян)', async ({ page, context }) => {
  await open(page);
  await waitForSW(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(cards(page)).toHaveCount(9);
  await page.goto('./#/course/najdorf');
  await expect(page.locator('.line-row')).toHaveCount(LINES.najdorf);
  await page.locator('.line-row a').nth(2).click();
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  await page.goto('./#/settings');
  await expect(page.locator('#data-version')).toHaveText(MANIFEST.dataVersion);
  await context.setOffline(false);
});

test('настройка се пази в IndexedDB след презареждане и се притиска до границите', async ({ page }) => {
  await open(page, '#/settings');
  const input = page.locator('#set-newLinesPerDay');
  await expect(input).toHaveValue('5');
  await input.fill('8');
  await input.blur();
  await expect(page.locator('.saved').first()).toHaveText('Запазено');
  await expect.poll(() => page.evaluate(async () => (await globalThis.__lrn.userDb.loadSettings()).newLinesPerDay)).toBe(8);
  await page.reload();
  await expect(page.locator('#set-newLinesPerDay')).toHaveValue('8');
  await page.locator('nav#tabs a[data-route="courses"]').click();
  await expect(page.locator('#today-line')).toHaveText('Днес: 0 за преговор · до 8 нови');
  await page.locator('nav#tabs a[data-route="settings"]').click();

  await page.locator('#set-newLinesPerDay').fill('500');
  await page.locator('#set-newLinesPerDay').blur();
  await expect(page.locator('#set-newLinesPerDay')).toHaveValue('50');

  await page.locator('#set-boardOrientation').selectOption('black');
  await page.locator('#set-autoPlayStart').check();
  await expect.poll(() => page.evaluate(async () => (await globalThis.__lrn.userDb.loadSettings()).autoPlayStart)).toBe(true);
  await page.reload();
  await expect(page.locator('#set-boardOrientation')).toHaveValue('black');
  await expect(page.locator('#set-autoPlayStart')).toBeChecked();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Върни стойностите по подразбиране' }).click();
  await expect(page.locator('#set-newLinesPerDay')).toHaveValue('5');
  await expect(page.locator('#set-boardOrientation')).toHaveValue('auto');
});

test('настройките от 0.1.0 (localStorage) се пренасят в IndexedDB', async ({ page }) => {
  // Страница от същия произход, без да пускаме приложението.
  await page.goto('./manifest.webmanifest');
  await page.evaluate(() => localStorage.setItem('lrnoldgame.settings.v1',
    JSON.stringify({ retention: 0.85, boardOrientation: 'black', animationMs: 150, newPerDay: 25 })));
  await open(page, '#/settings');
  await expect(page.locator('#set-retention')).toHaveValue('0.85');
  await expect(page.locator('#set-boardOrientation')).toHaveValue('black');
  await expect(page.locator('#set-animationMs')).toHaveValue('150');
  expect(await page.evaluate(() => localStorage.getItem('lrnoldgame.settings.v1'))).toBeNull();
  await page.reload();
  await expect(page.locator('#set-retention')).toHaveValue('0.85');
});

test('„Настройки → Данни“: версия, параметри, брой курсове/линии', async ({ page }) => {
  await open(page, '#/settings');
  await expect(page.locator('#data-version')).toHaveText(MANIFEST.dataVersion);
  const lines = MANIFEST.courses.reduce((s, c) => s + c.lines, 0);
  await expect(page.locator('#data-counts')).toHaveText(`Курсове: ${MANIFEST.courses.length} · линии: ${lines}`);
  await expect(page.locator('#data-info')).toContainText(MANIFEST.source.month);
  await expect(page.locator('#data-info')).toContainText('Stockfish 19');
  await page.locator('.gen-params summary').click();
  await expect(page.locator('.gen-params')).toContainText('Брой линии на курс');
  await expect(page.locator('#data-info')).not.toContainText('ТЕСТОВИ');
  await expect(page.locator('#data-info')).not.toContainText('null');
  await expect(page.locator('#app-version')).toHaveText('0.2.0');
});

test('бекъп: изтегляне и зареждане (schemaVersion)', async ({ page }) => {
  await open(page, '#/catalog');
  await page.locator('#pick-scotch').check();
  await page.goto('./#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#backup-export').click()]);
  expect(dl.suggestedFilename()).toMatch(/^lrnoldgame-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  expect(backup.schemaVersion).toBe(1);
  expect(backup.dataVersion).toBe(MANIFEST.dataVersion);
  expect(backup.stores.myCourses.filter((r) => !r.hidden).map((r) => r.courseId)).toContain('scotch');
  await expect(page.locator('#last-backup')).not.toContainText('никога');

  // Файл от по-нова схема се отказва и нищо не се променя.
  await page.locator('#backup-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup, schemaVersion: 99 })) });
  await expect(page.locator('#backup-msg')).toContainText('по-нова версия');

  // Бекъп само с „Испанска“ → след зареждане е единственият курс.
  const only = { ...backup, stores: { ...backup.stores, myCourses: [{ courseId: 'ruy-lopez', addedAt: 1, order: 0, hidden: false }] } };
  page.once('dialog', (d) => d.accept());
  await Promise.all([
    page.waitForEvent('load'),
    page.locator('#backup-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(only)) }),
  ]);
  await page.goto('./#/courses');
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('.course-card[data-course="ruy-lopez"]')).toBeVisible();
});

test('manifest на PWA е достъпен и коректен', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(href);
  expect(res.ok()).toBeTruthy();
  const man = await res.json();
  expect(man.name).toBe('LrnOldGame');
  expect(man.orientation).toBe('portrait');
  for (const icon of man.icons) {
    expect((await request.get(icon.src)).ok(), icon.src).toBeTruthy();
  }
});

test.describe('обновяване', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterEach(async ({ request }) => {
    await request.get('/__test/sw-build?b=');
    await request.get('/__test/data-version?v=');
  });

  test('нова версия на SW показва „Обнови“ и я активира', async ({ page, request }) => {
    await open(page, '#/settings');
    await waitForSW(page);
    // Симулираме нов деплой: сървърът връща sw.js с друг BUILD.
    await request.get('/__test/sw-build?b=e2e2');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const bar = page.locator('#update-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Има нова версия');
    await Promise.all([
      page.waitForEvent('load'),
      bar.getByRole('button', { name: 'Обнови' }).click(),
    ]);
    await expect(page.locator('h1.screen-title')).toHaveText('Настройки');
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['lrnoldgame-shell-0.2.0-e2e2']);
  });

  test('нови данни (нов manifest) запазват избора и настройките', async ({ page, request }) => {
    await open(page, '#/catalog');
    await waitForSW(page);
    await page.locator('#pick-ruy-lopez').check();
    await page.locator('[data-filter="side"] button[data-value="b"]').click();
    await page.locator('#pick-slav').uncheck();
    await page.goto('./#/settings');
    await page.locator('#set-learnStreak').fill('4');
    await page.locator('#set-learnStreak').blur();
    await expect.poll(() => page.evaluate(async () => (await globalThis.__lrn.userDb.loadSettings()).learnStreak)).toBe(4);

    await request.get('/__test/data-version?v=2099-01-01.1');
    await request.get('/__test/sw-build?b=data2');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const bar = page.locator('#update-bar');
    await expect(bar).toBeVisible();
    await Promise.all([page.waitForEvent('load'), bar.getByRole('button', { name: 'Обнови' }).click()]);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect(page.locator('#data-version')).toHaveText('2099-01-01.1');
    await expect(page.locator('#set-learnStreak')).toHaveValue('4');
    await page.goto('./#/courses');
    await expect(page.locator('.notice')).toContainText('обновени');
    await expect(cards(page)).toHaveCount(9);
    await expect(page.locator('.course-card[data-course="ruy-lopez"]')).toBeVisible();
    await expect(page.locator('.course-card[data-course="slav"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['lrnoldgame-shell-0.2.0-data2']);
  });
});
