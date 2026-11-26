// T-021: тренировка на линия (learn) — Pixel 7, истинските данни.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { lineFrames } from '../../src/train/session.js';

const MANIFEST = JSON.parse(readFileSync(new URL('../../data/manifest.json', import.meta.url), 'utf8'));
const LINES = Object.fromEntries(MANIFEST.courses.map((c) => [c.id, c.lines]));
const course = (id) => JSON.parse(readFileSync(new URL(`../../data/courses/${id}.json`, import.meta.url), 'utf8'));
const ITALIAN = course('italian');
const CARO = course('caro-kann');
const L1 = ITALIAN.lines.find((l) => l.n === 1);
const L2 = ITALIAN.lines.find((l) => l.n === 2);

async function open(page, hash = '') {
  await page.goto(`./${hash}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
}

async function waitForSW(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
}

/** Бързи настройки за тестовете (без пауза и анимация); само в паметта на текущата страница. */
async function fast(page, extra = {}) {
  await page.evaluate((o) => { for (const [k, v] of Object.entries(o)) globalThis.__lrn.settings.set(k, v); },
    { opponentDelayMs: 0, animationMs: 0, wrongMoveMs: 100, ...extra });
}

async function center(page, sq) {
  const b = await page.locator(`.board-wrap rect[data-square="${sq}"]`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Ход с тап-тап (how = 'tap') или с плъзгане (how = 'drag'). */
async function move(page, from, to, how = 'tap') {
  const a = await center(page, from);
  const b = await center(page, to);
  if (how === 'drag') {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  } else {
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
  }
}

/** 'user@4' — фаза и полуход на тренировката. */
const turn = (page) => page.evaluate(() => {
  const s = globalThis.__lrn.train?.session;
  return s ? `${s.phase()}@${s.ply}` : null;
});

/** Изиграва линията докрай (моите ходове) и чака панела за край. */
async function playLine(page, line, side, how = 'tap') {
  const frames = lineFrames(line.m);
  const mine = side === 'w' ? 0 : 1;
  for (let i = mine; i < line.m.length; i += 2) {
    // чакаме приложението да е готово за моя ход (след хода на противника)
    await expect.poll(() => turn(page)).toBe(`user@${i}`);
    const f = frames[i + 1].last;
    await move(page, f.from, f.to, how);
  }
  await expect(page.locator('#train-done')).toBeVisible();
}

test('изиграване чисто ×3 → „научена“; прогресът се вижда в Курс и Курсове и след презареждане', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '#/course/italian');
  await fast(page);
  await expect(page.locator('#course-learned')).toHaveText(`научени 0/${LINES.italian}`);
  await page.locator('#learn-next').click();
  await expect(page.locator('h1.screen-title')).toHaveText(`Италианска партия · линия 1/${LINES.italian}`);
  await expect(page.locator('#streak')).toHaveAttribute('data-streak', '0');
  await expect(page.locator('#streak .streak-n')).toHaveText('0/3');
  await expect(page.locator('#screen')).not.toContainText('null');

  await playLine(page, L1, 'w', 'drag');
  await expect(page.locator('#done-text')).toHaveText('Линията е изиграна ✓ (1/3)');
  await expect(page.locator('#streak')).toContainText('●○○');
  await expect(page.locator('#next-line-btn')).toHaveText('Следваща линия (2)');
  await expect(page.locator('#played .mv')).toHaveCount(L1.m.length);
  await expect(page.locator('#screen')).not.toContainText('null');

  await page.locator('#again-btn').click();
  await expect(page.locator('#train-done')).toBeHidden();
  await playLine(page, L1, 'w');
  await expect(page.locator('#done-text')).toHaveText('Линията е изиграна ✓ (2/3)');
  await page.locator('#again-btn').click();
  await playLine(page, L1, 'w');
  await expect(page.locator('#done-text')).toHaveText('Научена! ✓ (3/3)');
  await expect(page.locator('#streak')).toHaveAttribute('data-status', 'learned');

  const row = await page.evaluate((id) => globalThis.__lrn.userDb.getLine('italian', id), L1.id);
  expect(row.status).toBe('learned');
  expect(row.streak).toBe(3);
  expect(row.learnedAt).toBeGreaterThan(0);
  expect(row.fsrs.reps).toBe(0);
  const atts = await page.evaluate((id) => globalThis.__lrn.userDb.attemptsFor('italian', id), L1.id);
  expect(atts.map((a) => a.ok)).toEqual([true, true, true]);
  const daily = await page.evaluate(() => globalThis.__lrn.userDb.db.getAll('daily'));
  expect(daily[0].newLearned).toBe(1);
  expect(daily[0].plays).toBe(3);

  // „Следваща линия“ → линия 2
  await page.locator('#next-line-btn').click();
  await expect(page.locator('h1.screen-title')).toHaveText(`Италианска партия · линия 2/${LINES.italian}`);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.goto('./#/course/italian');
  await expect(page.locator('#course-learned')).toHaveText(`научени 1/${LINES.italian}`);
  await expect(page.locator(`.line-row[data-line="${L1.id}"]`)).toHaveAttribute('data-status', 'learned');
  await expect(page.locator(`.line-row[data-line="${L1.id}"]`)).toContainText('научена');
  await expect(page.locator('#learn-next')).toHaveText('Учи следващата (2)');
  await page.goto('./#/courses');
  await expect(page.locator('.course-card[data-course="italian"]')).toContainText(`научени 1/${LINES.italian}`);
  expect(errors).toEqual([]);
});

test('грешка → брояч 0, червен маркер, стрелка с верния ход; верният ход продължава линията', async ({ page }) => {
  await open(page, '#/course/italian');
  // Тук с подразбиращата се пауза на противника (400 ms) и анимация.
  await page.goto(`./#/train/italian/${L1.id}?mode=learn`);
  await playLine(page, L1, 'w');
  await expect(page.locator('#done-text')).toHaveText('Линията е изиграна ✓ (1/3)');
  await page.locator('#again-btn').click();
  await expect(page.locator('#streak')).toHaveAttribute('data-streak', '1');

  // 1.d4 вместо 1.e4
  await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'turn');
  await move(page, 'd2', 'd4');
  await expect(page.locator('#train-msg')).toHaveText('Грешка. Верният ход е e4');
  await expect(page.locator('#streak')).toHaveAttribute('data-streak', '0');
  await expect(page.locator('.board-wrap .marker.marker-bad')).toHaveCount(1);
  await expect(page.locator('.board-wrap .arrows .arrow')).toHaveCount(1);
  await expect(page.locator('#train-msg')).toHaveText('Изиграй верния ход e4');
  // фигурата е върната
  await expect(page.locator('.board-wrap g[data-piece="wp"][data-square="d2"]')).toHaveCount(1);
  await move(page, 'e2', 'e4');
  await expect(page.locator('.board-wrap .arrows .arrow')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => globalThis.__lrn.train.session.ply)).toBeGreaterThanOrEqual(1);
  // довършва линията (от хода на черните нататък)
  const frames = lineFrames(L1.m);
  for (let i = 2; i < L1.m.length; i += 2) {
    await expect.poll(() => turn(page)).toBe(`user@${i}`);
    await move(page, frames[i + 1].last.from, frames[i + 1].last.to);
  }
  await expect(page.locator('#done-text')).toHaveText('Линията е изиграна с грешки (0/3)');
  await expect(page.locator('#train-done')).toContainText('1.d4 → e4');
  const row = await page.evaluate((id) => globalThis.__lrn.userDb.getLine('italian', id), L1.id);
  expect(row.streak).toBe(0);
  expect(row.status).toBe('learning');
  expect(row.errors).toBe(1);
  await page.goto('./#/course/italian');
  await expect(page.locator(`.line-row[data-line="${L1.id}"]`)).toContainText('учи се 0/3');
});

test('„Отначало“ след грешка не заобикаля нулирането; onError=restart рестартира сам', async ({ page }) => {
  await open(page, `#/course/italian`);
  await fast(page);
  await page.goto(`./#/train/italian/${L2.id}?mode=learn`);
  await playLine(page, L2, 'w');
  await expect(page.locator('#done-text')).toHaveText('Линията е изиграна ✓ (1/3)');
  await page.locator('#again-btn').click();
  await move(page, 'a2', 'a3');
  await expect(page.locator('#streak')).toHaveAttribute('data-streak', '0');
  await page.locator('#restart-btn').click();
  await expect.poll(() => page.evaluate((id) => globalThis.__lrn.userDb.getLine('italian', id).then((r) => r.streak), L2.id)).toBe(0);

  await fast(page, { onError: 'restart', errorPauseMs: 200 });
  await page.goto(`./#/train/italian/${L1.id}?mode=learn`);
  await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'turn');
  await move(page, 'e2', 'e4');
  await expect.poll(() => page.evaluate(() => globalThis.__lrn.train.session.ply)).toBe(2);
  await move(page, 'b1', 'c3');
  await expect(page.locator('#train-msg')).toContainText('започваме отначало');
  await expect.poll(() => page.evaluate(() => globalThis.__lrn.train.session.attempt)).toBe(2);
  await expect.poll(() => page.evaluate(() => globalThis.__lrn.train.session.ply)).toBe(0);
  const atts = await page.evaluate((id) => globalThis.__lrn.userDb.attemptsFor('italian', id), L1.id);
  expect(atts.map((a) => [a.ok, a.done])).toEqual([[false, false]]);
});

test('офлайн: черен курс (противникът играе пръв), подсказка, прогресът се пази', async ({ page, context }) => {
  await open(page);
  await waitForSW(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await fast(page);
  const line = CARO.lines.find((l) => l.n === 1);
  await page.goto(`./#/train/caro-kann/${line.id}?mode=learn`);
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  // черните са долу
  // (по полетата, не по фигурите: те се прерисуват след хода на противника)
  const a1 = await page.locator('.board-wrap rect[data-square="a1"]').boundingBox();
  const a8 = await page.locator('.board-wrap rect[data-square="a8"]').boundingBox();
  expect(a8.y).toBeGreaterThan(a1.y);
  await expect.poll(() => page.evaluate(() => globalThis.__lrn.train.session.ply)).toBe(1);
  // подсказка → стрелка; при hintResetsStreak опитът не е чист
  await page.locator('#hint-btn').click();
  await expect(page.locator('#train-msg')).toHaveText(`Подсказка: ${line.m[1]}`);
  await expect(page.locator('.board-wrap .arrows .arrow')).toHaveCount(1);
  await playLine(page, line, 'b');
  await expect(page.locator('#done-text')).toHaveText('Линията е изиграна с грешки (0/3)');
  await page.locator('#again-btn').click();
  await playLine(page, line, 'b');
  await expect(page.locator('#done-text')).toHaveText('Линията е изиграна ✓ (1/3)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.goto('./#/course/caro-kann');
  await expect(page.locator(`.line-row[data-line="${line.id}"]`)).toContainText('учи се 1/3');
  await context.setOffline(false);
});
