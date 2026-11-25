import { test, expect } from '@playwright/test';

const TABS = [
  ['today', 'Днес'],
  ['explore', 'Изследвай'],
  ['repertoire', 'Репертоар'],
  ['train', 'Тренировка'],
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

test('зарежда се с екран „Днес“ и пет раздела', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('h1.screen-title')).toHaveText('Днес');
  await expect(page.locator('nav#tabs a.tab')).toHaveCount(5);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bg');
  expect(errors).toEqual([]);
});

test('навигация между петте екрана и бутон „Назад“', async ({ page }) => {
  await page.goto('./');
  for (const [route, label] of TABS) {
    await page.locator(`nav#tabs a[data-route="${route}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect(page.locator('h1.screen-title')).toHaveText(label);
    await expect(page.locator(`nav#tabs a[data-route="${route}"]`)).toHaveAttribute('aria-current', 'page');
  }
  await page.goBack();
  await expect(page.locator('h1.screen-title')).toHaveText('Тренировка');
});

test('„Изследвай“ показва дъска в началната позиция (32 фигури)', async ({ page }) => {
  await page.goto('./#/explore');
  const board = page.locator('.board-wrap svg.cm-chessboard');
  await expect(board).toBeVisible();
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  await expect(page.locator('.board-wrap g[data-piece="wk"]')).toHaveCount(1);
  // Спрайтът с фигурите е зареден (cm-chessboard го вгражда в документа).
  await expect(page.locator('svg symbol#wk, svg g#wk, [id="wk"]').first()).toBeAttached();
});

test('дъската се побира в ширината на телефона в портрет', async ({ page }) => {
  await page.goto('./#/explore');
  const box = await page.locator('.board-wrap').boundingBox();
  const vw = page.viewportSize().width;
  expect(box.width).toBeLessThanOrEqual(vw);
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
});

test('работи офлайн след първото зареждане', async ({ page, context }) => {
  await page.goto('./');
  await waitForSW(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1.screen-title')).toHaveText('Днес');
  await page.locator('nav#tabs a[data-route="explore"]').click();
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  // Нова навигация (не само reload) също идва от кеша.
  await page.goto('./#/settings');
  await expect(page.locator('h1.screen-title')).toHaveText('Настройки');
  await context.setOffline(false);
});

test('настройка се запазва след презареждане и се притиска до границите', async ({ page }) => {
  await page.goto('./#/settings');
  const input = page.locator('#set-newPerDay');
  await expect(input).toHaveValue('10');
  await input.fill('25');
  await input.press('Enter');
  await input.blur();
  await expect(page.locator('.saved')).toHaveText('Запазено');
  await page.reload();
  await expect(page.locator('#set-newPerDay')).toHaveValue('25');

  await page.locator('#set-newPerDay').fill('500');
  await page.locator('#set-newPerDay').blur();
  await expect(page.locator('#set-newPerDay')).toHaveValue('100');

  await page.locator('#set-boardOrientation').selectOption('black');
  await page.reload();
  await expect(page.locator('#set-boardOrientation')).toHaveValue('black');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Върни стойностите по подразбиране' }).click();
  await expect(page.locator('#set-newPerDay')).toHaveValue('10');
  await expect(page.locator('#set-boardOrientation')).toHaveValue('auto');
});

test('manifest е достъпен и коректен', async ({ page, request }) => {
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
  test.afterEach(async ({ request }) => { await request.get('/__test/sw-build?b='); });

  test('нова версия на SW показва „Обнови“ и я активира', async ({ page, request }) => {
    await page.goto('./#/settings');
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
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['lrnoldgame-shell-0.1.0-e2e2']);
  });
});
