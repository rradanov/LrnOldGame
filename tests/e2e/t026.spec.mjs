// T-026 (D-031): лента с иконки „стрелки“ (Tabler Icons, вариант Б) под дъската — Назад, Напред | Пак, Следваща.
// Pixel 7, истинските данни. Снимки: T026_SCREENS=/home/claude/t026 npx playwright test t026
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { lineId } from '../../src/chess/position.js';
import { course, lineN, open, fast, playLine, iconBar, againBtn, nextBtn, checks, doneKind, backBtn, fwdBtn, boardSpan } from './helpers.mjs';

const ITALIAN = course('italian');
const I1 = lineN(ITALIAN, 1);
const SHOTS = process.env.T026_SCREENS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const disabled = (loc) => expect(loc).toHaveAttribute('aria-disabled', 'true');
const enabled = (loc) => expect(loc).toHaveAttribute('aria-disabled', 'false');

async function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    globalThis.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => globalThis.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return errors;
}

test('лента: 4 иконки с подписи и aria-label; Пак винаги активна (T-028); Назад/Напред и Следваща — в края на линията', async ({ page }) => {
  const errors = await watch(page);
  await open(page);
  await fast(page);
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  const bar = iconBar(page);
  await expect(bar.getByRole('button')).toHaveCount(4);
  await expect(bar.locator('.ico-cap')).toHaveText(['Назад', 'Напред', 'Пак', 'Следваща']);
  await expect(bar.locator('.icon-sep')).toHaveCount(1);
  for (const b of await bar.getByRole('button').all()) {
    const box = await b.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // иконката е маска от vendor/tabler/ и е ~28 px
    const ico = await b.locator('.ico').evaluate((e) => {
      const cs = getComputedStyle(e);
      return { w: e.getBoundingClientRect().width, mask: cs.maskImage || cs.webkitMaskImage };
    });
    expect(ico.w).toBe(28);
    expect(ico.mask).toMatch(/vendor\/tabler\/(arrow-left|arrow-right|arrow-back-up|arrow-bar-to-right)\.svg/);
  }
  // по време на опита: Назад/Напред/Следваща неактивни, но видими; Пак — активна (D-033)
  for (const b of [backBtn(page), fwdBtn(page), nextBtn(page)]) { await expect(b).toBeVisible(); await disabled(b); }
  await enabled(againBtn(page));
  await expect(nextBtn(page)).toHaveAccessibleName('Следваща линия');
  await expect(page.getByRole('button', { name: 'Отначало' })).toHaveCount(0);
  // тап върху неактивна иконка не прави нищо
  const url = page.url();
  await nextBtn(page).click({ force: true });
  expect(page.url()).toBe(url);

  await playLine(page, I1, 'w');
  await doneKind(page, 'clean'); await checks(page, 1, 3);
  await enabled(againBtn(page));
  await enabled(nextBtn(page));
  await enabled(backBtn(page));
  await disabled(fwdBtn(page));
  await expect(nextBtn(page)).toHaveAccessibleName('Следваща линия (2)');
  // Пак → нов опит
  await againBtn(page).click();
  await expect(page.locator('#train-done')).toBeHidden();
  await enabled(againBtn(page));
  await disabled(nextBtn(page));
  await disabled(backBtn(page));
  await playLine(page, I1, 'w');
  await nextBtn(page).click();
  await expect(page).toHaveURL(new RegExp(`#/train/italian/${lineN(ITALIAN, 2).id}\\?mode=learn$`));
  await expect(page.locator('h1.screen-title')).toContainText('линия 2/');
  expect(await page.evaluate(() => globalThis.__csp)).toEqual([]);
  expect(errors).toEqual([]);
});

test('„Настройки → Дъска → Подписи под иконките“ (по подразбиране да) скрива подписите', async ({ page }) => {
  await open(page, '#/settings');
  const field = page.locator('[data-key="iconLabels"]');
  await expect(field).toContainText('Подписи под иконките');
  await expect(field).toContainText('По подразбиране: да.');
  await expect(page.locator('#set-iconLabels')).toBeChecked();
  await field.locator('.check-text').click();
  await expect(page.locator('#set-iconLabels')).not.toBeChecked();
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await expect(iconBar(page)).toHaveClass(/no-labels/);
  await expect(iconBar(page).locator('.ico-cap').first()).toBeHidden();
  const box = await againBtn(page).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(againBtn(page)).toHaveAccessibleName('Пак — повтори линията');
});

for (const [name, w, h] of [['320x568', 320, 568], ['360x640', 360, 640], ['pixel7', 0, 0]]) {
  test(`малък екран ${name}: лентата е над долната лента по време на опита и в края на линията`, async ({ page }) => {
    if (w) await page.setViewportSize({ width: w, height: h });
    await open(page);
    await fast(page);
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    const tabsTop = await page.locator('#tabs').evaluate((e) => e.getBoundingClientRect().top);
    const barBox = await iconBar(page).boundingBox();
    const board = await page.locator('.board-wrap').boundingBox();
    console.log(name, 'board', board.width, 'bar bottom', barBox.y + barBox.height, 'tabs', tabsTop);
    expect(await boardSpan(page)).toBeGreaterThanOrEqual(280); // дъската + колоната с оценката (D-035)
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabsTop);
    await playLine(page, I1, 'w');
    await expect.poll(async () => {
      const b = await iconBar(page).boundingBox();
      const d = await page.locator('#done-text').boundingBox();
      return b.y >= 0 && b.y + b.height <= tabsTop && d.y + d.height <= tabsTop;
    }).toBe(true);
    if (SHOTS && name === '320x568') await page.emulateMedia({ colorScheme: 'dark' });
    if (SHOTS && name === '320x568') await page.screenshot({ path: `${SHOTS}/t026-320x568-dark-done.png`, animations: 'disabled' });
  });
}

// T-030: линиите на истинските данни се сменят при всяко генериране — тестът за взетите фигури
// ползва фиксирана линия с размяна на d4 (italian, през page.route; без SW).
const CAP_M = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'h6', 'd4', 'exd4', 'Nxd4', 'Nxd4', 'Qxd4'];
const CAP = {
  id: lineId('italian', CAP_M), n: 1, m: CAP_M, p: 0.5, end: 'adv', cp: 131, c: null,
  ev: [27, 39, 30, 27, 15, 56, 66, 68, 62, 122, 131],
};
const CAP_COURSE = { ...ITALIAN, lines: [CAP] };

test.describe('D-032 (фиксирана линия)', () => {
  test.use({ serviceWorkers: 'block' });
test('D-032: взети фигури и „+N“ (Италианска, линия с вземания на d4); изключване от „Настройки“', async ({ page }) => {
  const errors = await watch(page);
  await page.route('**/data/courses/italian.json', (r) => r.fulfill({ body: JSON.stringify(CAP_COURSE), contentType: 'application/json' }));
  const I1 = CAP;
  await open(page);
  await fast(page);
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  const top = page.locator('#captured-top'); // черните са горе (курсът е за белите)
  const bottom = page.locator('#captured-bottom');
  await expect(top).toHaveAttribute('data-side', 'b');
  await expect(bottom).toHaveAttribute('data-side', 'w');
  await expect(top).toHaveAttribute('data-captured', '');
  await expect(top.locator('.cap-diff')).toHaveCount(0);
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 h6 4.d4 exd4 5.Nxd4 Nxd4 — ред на белите за 6.Qxd4: черните са с кон напред
  await playLine(page, I1, 'w', { stopAt: 10 });
  await expect(top).toHaveAttribute('data-captured', 'p1n1');
  await expect(bottom).toHaveAttribute('data-captured', 'p1');
  await expect(top).toHaveAttribute('data-diff', '3');
  await expect(top.locator('.cap-diff')).toHaveText('+3');
  await expect(bottom.locator('.cap-diff')).toHaveCount(0);
  await expect(top.locator('.cap-group[data-type="n"] svg.cap-piece use')).toHaveAttribute('href', '#wn');
  await expect(top).toHaveAttribute('aria-label', 'Взети от черните: пешка ×1, кон ×1 · +3');
  const w = await top.locator('svg.cap-piece').first().evaluate((e) => e.getBoundingClientRect().width);
  expect(w).toBeGreaterThanOrEqual(16);
  // 6.Qxd4 — размяната е изравнена: разлика 0 → няма „+N“
  await playLine(page, I1, 'w', { from: 10 });
  await expect(bottom).toHaveAttribute('data-captured', 'p1n1');
  await expect(top).toHaveAttribute('data-captured', 'p1n1');
  await expect(page.locator('.cap-diff')).toHaveCount(0);
  // Пак → начална позиция, нищо взето
  await againBtn(page).click();
  await expect(bottom).toHaveAttribute('data-captured', '');
  // стойностите са параметри: кон = 4 → „+4“
  await fast(page, { valueKnight: 4 });
  await open(page, '#/courses');
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await playLine(page, I1, 'w', { stopAt: 10 });
  await expect(page.locator('#captured-top .cap-diff')).toHaveText('+4');
  // „Показвай взетите фигури“ = не → редовете ги няма
  await open(page, '#/settings');
  await expect(page.locator('[data-key="showCaptured"]')).toContainText('Показвай взетите фигури');
  await expect(page.locator('[data-key="valueQueen"]')).toContainText('Стойност на дама');
  await page.locator('[data-key="showCaptured"] .check-text').click();
  await expect(page.locator('#set-showCaptured')).not.toBeChecked();
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await expect(page.locator('.captured')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__csp)).toEqual([]);
  expect(errors).toEqual([]);
});
});

test('снимки: светла и тъмна тема (Pixel 7), позиция с взети фигури и „+N“', async ({ page }) => {
  test.skip(!SHOTS, 'само с T026_SCREENS');
  const L9 = lineN(ITALIAN, 9); // ... 6.Bxf7+ Kf8 7.Nxc6 bxc6 8.Bb3 → белите +1
  await open(page);
  await fast(page);
  await open(page, `#/train/italian/${L9.id}?mode=learn`);
  await playLine(page, L9, 'w', { stopAt: 12 }); // след 6.Bxf7+ Kf8: белите са взели 2 пешки, черните 1 → „+1“
  await expect(page.locator('#captured-bottom .cap-diff')).toHaveText('+1');
  await page.screenshot({ path: `${SHOTS}/t026-pixel7-light-play.png`, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await playLine(page, L9, 'w', { from: 12 });
  await expect(page.locator('#train-done')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/t026-pixel7-dark-done.png`, animations: 'disabled' });
});
