// T-025: поправки след приемането на MVP (T013-D1, D3, D4, D6, D7, D8, D9). Pixel 7, истинските данни.
import { test, expect } from '@playwright/test';
import { course, lineN, open, fast, move, playLine, row, waitForSW, againBtn, checks, doneKind, hintBtn } from './helpers.mjs';

const ITALIAN = course('italian');
const I1 = lineN(ITALIAN, 1);

/** Събира нарушенията на CSP и JS грешките още от зареждането на страницата. */
async function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    globalThis.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => globalThis.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return errors;
}

test('D1: подсказка в преговор → презареждане → чисто изиграване дава „Трудно“, не „Добре“', async ({ page }) => {
  await open(page);
  await fast(page, { learnStreak: 1 });
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await playLine(page, I1, 'w');
  await open(page, `#/train/italian/${I1.id}?mode=review`, '?now=+3d');
  await fast(page, { learnStreak: 1 });
  await playLine(page, I1, 'w', { stopAt: 2 });
  await hintBtn(page).click();
  await expect.poll(async () => (await row(page, 'italian', I1.id))?.pending?.hints).toBe(1);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('#resumed-note')).toBeVisible();
  await playLine(page, I1, 'w');
  await expect(page.locator('#train-done')).toHaveAttribute('data-grade', 'hard');
  expect((await row(page, 'italian', I1.id)).pending).toBeUndefined();
  // D9: преговорът свети под „Преговор“
  await expect(page.locator('a.tab[data-route="review"]')).toHaveAttribute('aria-current', 'page');
});

test('D1: грешка в учене → презареждане → брояч 0, бележка, после 1/3; опитът е в журнала', async ({ page }) => {
  await open(page);
  await fast(page);
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await playLine(page, I1, 'w');
  await againBtn(page).click();
  await playLine(page, I1, 'w', { stopAt: 2 });
  await move(page, 'a2', 'a3');
  await expect.poll(async () => (await row(page, 'italian', I1.id)).streak).toBe(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('#resumed-note')).toBeVisible();
  await expect(page.locator('#streak')).toHaveAttribute('data-streak', '0');
  await playLine(page, I1, 'w');
  await doneKind(page, 'clean'); await checks(page, 1, 3);
  const atts = await page.evaluate((id) => globalThis.__lrn.userDb.attemptsFor('italian', id), I1.id);
  expect(atts.map((a) => a.ok)).toEqual([true, false, true]);
});

for (const [w, h] of [[360, 640], [320, 568]]) {
  test(`D4: ${w}×${h} — бутоните и панелът в края на линията са над долната лента`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    await fast(page);
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    const tabsTop = await page.locator('#tabs').evaluate((e) => e.getBoundingClientRect().top);
    const btn = await hintBtn(page).boundingBox();
    expect(btn.y + btn.height).toBeLessThanOrEqual(tabsTop);
    await playLine(page, I1, 'w');
    await expect.poll(async () => {
      const b = await againBtn(page).boundingBox();
      return b.y >= 0 && b.y + b.height <= tabsTop;
    }).toBe(true);
  });
}

test('D6: отметките в „Настройки“ са ≥ 24 px, редът е ≥ 44 px и целият ред е докосваем', async ({ page }) => {
  await open(page, '#/settings');
  for (const key of ['hintResetsStreak', 'autoPlayStart', 'reviewFuzz']) {
    const box = await page.locator(`#set-${key}`).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    const rowBox = await page.locator(`[data-key="${key}"] label`).boundingBox();
    expect(rowBox.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('[data-key="autoPlayStart"] .check-text').click();
  await expect(page.locator('#set-autoPlayStart')).toBeChecked();
  await expect(page.locator('[data-key="autoPlayStart"]')).toContainText('По подразбиране: не.');
});

test('D7: повредена IndexedDB → „Изтегли каквото може“ и „Нулирай данните“ → приложението работи и бекъпът се внася', async ({ page }) => {
  await open(page);
  await fast(page, { learnStreak: 1 });
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await playLine(page, I1, 'w');
  // „бъдеща“ версия 99 на базата с данните от 0.5.1 + чужд store
  await page.evaluate(async () => {
    globalThis.__lrn.userDb.close();
    await new Promise((r) => { const q = indexedDB.open('lrnoldgame', 99); q.onupgradeneeded = () => q.result.createObjectStore('junk'); q.onsuccess = () => { q.result.close(); r(); }; });
  });
  await page.evaluate(() => { location.hash = '#/courses'; });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('#db-recover')).toContainText('Хранилището на браузъра (IndexedDB) не е достъпно');
  await expect(page.locator('#db-error-reason')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#db-rescue').click()]);
  expect(dl.suggestedFilename()).toMatch(/^lrnoldgame-rescue-\d{4}-\d{2}-\d{2}\.json$/);
  const rescued = JSON.parse(await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')));
  expect(rescued.rescue.dbVersion).toBe(99);
  expect(rescued.stores.lineProgress.some((r) => r.lineId === I1.id && r.status === 'learned')).toBe(true);
  await expect(page.locator('#db-recover-msg')).toContainText('Изтеглен е файл');
  // отказ на потвърждението → нищо не се трие
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#db-reset').click();
  await expect(page.locator('#db-recover')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await Promise.all([page.waitForEvent('load'), page.locator('#db-reset').click()]);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('#db-recover')).toHaveCount(0);
  await expect(page.locator('.course-card')).toHaveCount(9);
  // данните от спасителния файл се внасят, ако схемата е позната (тук: файлът е с версия 1)
  const v1 = { ...rescued, schemaVersion: 1 };
  await open(page, '#/settings');
  page.once('dialog', (d) => d.accept());
  await Promise.all([
    page.waitForEvent('load'),
    page.locator('#backup-file').setInputFiles({ name: 'r.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) }),
  ]);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  expect((await row(page, 'italian', I1.id)).status).toBe('learned');
});

test('D8: CSP — meta, без нарушения при учене (плъзгане), преговор, бекъп, SW', async ({ page }) => {
  const errors = await watch(page);
  await open(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  await waitForSW(page);
  await fast(page, { learnStreak: 1 });
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await playLine(page, I1, 'w', { how: 'drag' });
  await expect(page.locator('#done-text')).toContainText('Научена');
  await expect(page.locator('.board-wrap use.piece').first()).toBeAttached(); // спрайтът на фигурите
  await open(page, '#/courses');
  await expect(page.locator('.progress-fill').first()).toHaveAttribute('style', /width/);
  await open(page, '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#backup-export').click()]);
  expect(dl.suggestedFilename()).toMatch(/^lrnoldgame-backup-/);
  await open(page, '#/review', '?now=+3d');
  await expect(page.locator('#review-count')).toBeVisible();
  expect(await page.evaluate(() => globalThis.__csp)).toEqual([]);
  expect(errors).toEqual([]);
});

test('D9: manifest start_url води до „Курсове“', async ({ page, request }) => {
  const man = await (await request.get('manifest.webmanifest')).json();
  expect(man.start_url).toBe('./#/courses');
  await open(page, man.start_url.replace(/^\.\//, ''));
  await expect(page.locator('a.tab[data-route="courses"]')).toHaveAttribute('aria-current', 'page');
});
