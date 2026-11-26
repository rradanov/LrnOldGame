// T-010 + T-020: FSRS на ниво линия, „Преговор“, значка, Курс/Курсове — Pixel 7, истинските данни.
// Времето се мести с Playwright clock (setFixedTime) или със скрития параметър ?now= (отделно копие на данните).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { lineFrames } from '../../src/train/session.js';

const course = (id) => JSON.parse(readFileSync(new URL(`../../data/courses/${id}.json`, import.meta.url), 'utf8'));
const ITALIAN = course('italian');
const CARO = course('caro-kann');
const L1 = ITALIAN.lines.find((l) => l.n === 1);
const L2 = ITALIAN.lines.find((l) => l.n === 2);
const C1 = CARO.lines.find((l) => l.n === 1);

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 26, 12, 0, 0); // 26.11.2026 12:00 местно време
const at = (days) => new Date(T0.getTime() + days * DAY);

async function open(page, hash = '', search = '') {
  await page.goto(`./${search}${hash}`);
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

/** Бързи настройки (записват се и в IDB, затова важат и след презареждане). */
async function fast(page, extra = {}) {
  await page.evaluate(async (o) => {
    for (const [k, v] of Object.entries(o)) globalThis.__lrn.settings.set(k, v);
    await globalThis.__lrn.userDb.flush();
  }, { opponentDelayMs: 0, animationMs: 0, wrongMoveMs: 100, learnStreak: 1, ...extra });
}

async function center(page, sq) {
  const b = await page.locator(`.board-wrap rect[data-square="${sq}"]`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function move(page, from, to) {
  const a = await center(page, from);
  const b = await center(page, to);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
}
const turn = (page) => page.evaluate(() => {
  const s = globalThis.__lrn.train?.session;
  return s ? `${s.phase()}@${s.ply}` : null;
});

/** Изиграва линията; wrongAt = индекс на мой полуход, където първо се играе грешен ход. */
async function playLine(page, line, side, { wrongAt = -1, wrong = null } = {}) {
  const frames = lineFrames(line.m);
  for (let i = side === 'w' ? 0 : 1; i < line.m.length; i += 2) {
    await expect.poll(() => turn(page)).toBe(`user@${i}`);
    if (i === wrongAt) {
      await move(page, wrong[0], wrong[1]);
      await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct');
    }
    const f = frames[i + 1].last;
    await move(page, f.from, f.to);
  }
  await expect(page.locator('#train-done')).toBeVisible();
}

const row = (page, c, id) => page.evaluate(([cc, ii]) => globalThis.__lrn.userDb.getLine(cc, ii), [c, id]);

/** Научава линия (learnStreak = 1) в режим learn. */
async function learn(page, courseId, line, side) {
  await open(page, `#/train/${courseId}/${line.id}?mode=learn`);
  await playLine(page, line, side);
  await expect(page.locator('#done-text')).toHaveText('Научена! ✓ (1/1)');
}

test('научена линия → карта; след 3 дни е в „Преговор“ (значка, Курсове, Курс); Good → нова дата', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(T0);
  await open(page, '#/review');
  await expect(page.locator('#review-empty')).toContainText('Нищо за преговор днес.');
  await expect(page.locator('#review-empty')).toContainText('Още няма научени линии');
  await fast(page);
  await learn(page, 'italian', L1, 'w');
  const r0 = await row(page, 'italian', L1.id);
  expect(r0.fsrs.reps).toBe(1);
  expect(r0.fsrs.lastReview).toBe(T0.getTime());
  expect(r0.due).toBe(new Date(2026, 10, 29, 4).getTime()); // 3 дни, в 04:00 (dayStartHour)

  // същия ден: празно, със следваща дата; значката я няма
  await open(page, '#/review');
  await expect(page.locator('#review-next')).toHaveText(/Следващ преговор: след 3 дни \(29 ноем\.\)/);
  await expect(page.locator('#review-badge')).toBeHidden();
  await open(page, '#/course/italian');
  await expect(page.locator('#course-due')).toHaveText('За преговор днес: 0');
  await expect(page.locator(`.line-row[data-line="${L1.id}"]`)).toContainText('научена · преговор след 3 дни');
  await expect(page.locator('#today-line')).toHaveCount(0);
  await open(page, '#/courses');
  await expect(page.locator('#today-line')).toHaveText('Днес: 0 за преговор · до 4 нови');
  await expect(page.locator('.course-card[data-course="italian"] .cc-next')).toContainText('следващ преговор след 3 дни');

  // 29.11 в 03:59 е още 28-ми (новият ден започва в 04:00)
  await page.clock.setFixedTime(new Date(2026, 10, 29, 3, 59));
  await open(page, '#/review');
  await expect(page.locator('#review-empty')).toBeVisible();
  await expect(page.locator('#review-next')).toContainText('утре');

  await page.clock.setFixedTime(at(3));
  await open(page, '#/courses');
  await expect(page.locator('#review-badge')).toHaveText('1');
  await expect(page.locator('#today-line')).toHaveText('Днес: 1 за преговор · до 5 нови');
  await expect(page.locator('.course-card[data-course="italian"] .cc-due')).toContainText('за преговор днес: 1');
  await open(page, '#/course/italian');
  await expect(page.locator('#course-due')).toHaveText('За преговор днес: 1');
  await expect(page.locator(`.line-row[data-line="${L1.id}"]`)).toHaveAttribute('data-due', 'today');
  await expect(page.locator(`.line-row[data-line="${L1.id}"]`)).toContainText('научена · преговор днес');

  await page.locator('#course-review-btn').click();
  await expect(page.locator('#review-count')).toHaveText('За преговор днес: 1');
  await expect(page.locator('#review-list .line-row')).toHaveCount(1);
  await page.locator('#review-start').click();
  await expect(page.locator('h1.screen-title')).toHaveText('Италианска партия · линия 1 · преговор');
  await expect(page.locator('#streak')).toHaveAttribute('data-mode', 'review');
  await expect(page.locator('#streak')).toHaveText('Преговор · остават 1');
  await playLine(page, L1, 'w');
  await expect(page.locator('#done-text')).toHaveText(/^Оценка: Добре · следващ преговор след \d+ дни/);
  await expect(page.locator('#train-done')).toHaveAttribute('data-grade', 'good');
  await expect(page.locator('#again-btn')).toHaveCount(0); // един опит на линия
  await expect(page.locator('#next-review-btn')).toHaveText('Към „Преговор“');
  await expect(page.locator('#review-all-done')).toBeVisible();
  await expect(page.locator('#review-badge')).toBeHidden();

  const r1 = await row(page, 'italian', L1.id);
  expect(r1.fsrs.reps).toBe(2);
  expect(r1.fsrs.lapses).toBe(0);
  expect(r1.due).toBeGreaterThan(at(3 + 5).getTime());
  const atts = await page.evaluate((id) => globalThis.__lrn.userDb.attemptsFor('italian', id), L1.id);
  expect(atts.map((a) => [a.mode, a.grade ?? null])).toEqual([['learn', null], ['review', 'good']]);
  const daily = await page.evaluate(() => globalThis.__lrn.userDb.db.getAll('daily'));
  expect(daily.find((d) => d.reviews)).toMatchObject({ day: '2026-11-29', reviews: 1, reviewErrors: 0 });

  await page.locator('#next-review-btn').click();
  await expect(page.locator('#review-empty')).toContainText('Преговорът за днес е готов ✓');
  await expect(page.locator('#review-today')).toHaveText('Днес: 1 преговора · 0 с „Отново“');
  await expect(page.locator('#review-next')).toBeVisible();
  // повторно отваряне в режим review в същия ден → упражнение без оценка
  await open(page, `#/train/italian/${L1.id}?mode=review`);
  await expect(page.locator('#practice-note')).toBeVisible();
  await expect(page.locator('#screen')).not.toContainText('null');
  expect(errors).toEqual([]);
});

test('грешка при преговор → Отново (lapse), повторение веднага; две линии една след друга', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await open(page, '#/courses');
  await fast(page);
  await learn(page, 'italian', L1, 'w');
  await learn(page, 'italian', L2, 'w');
  await page.clock.setFixedTime(at(3));
  await open(page, '#/review');
  await expect(page.locator('#review-badge')).toHaveText('2');
  await expect(page.locator('#review-list .line-row')).toHaveCount(2);
  await expect(page.locator('#review-list .line-row').first()).toHaveAttribute('data-line', L1.id);
  await page.locator('#review-start').click();
  await expect(page.locator('#streak')).toHaveText('Преговор · остават 2');

  // линия 1: грешка на първия ход (d4 вместо e4), после довършване
  await playLine(page, L1, 'w', { wrongAt: 0, wrong: ['d2', 'd4'] });
  await expect(page.locator('#done-text')).toHaveText('Оценка: Отново · изиграй линията още 1 път(и) без грешка');
  await expect(page.locator('#train-done')).toHaveAttribute('data-grade', 'again');
  let r = await row(page, 'italian', L1.id);
  expect(r.fsrs.lapses).toBe(1);
  expect(r.fsrs.state).toBe('relearning');
  expect(r.relearnLeft).toBe(1);
  expect(r.due).toBe(new Date(2026, 10, 30, 4).getTime()); // утре
  await expect(page.locator('#streak')).toHaveText('Повторение след грешка · остават 1 чисти пробега');
  // повторението: чисто → готово, картата не се пипа
  await page.locator('#again-btn').click();
  await playLine(page, L1, 'w');
  await expect(page.locator('#done-text')).toHaveText(/^Повторението е готово ✓ · следващ преговор утре/);
  const r2 = await row(page, 'italian', L1.id);
  expect(r2.fsrs).toEqual(r.fsrs);
  expect(r2.relearnLeft).toBe(0);

  // следващата в опашката — линия 2
  await expect(page.locator('#next-review-btn')).toHaveText('Следваща за преговор (1)');
  await page.locator('#next-review-btn').click();
  await expect(page.locator('h1.screen-title')).toHaveText('Италианска партия · линия 2 · преговор');
  // подсказка → Трудно
  await expect.poll(() => turn(page)).toBe('user@0');
  await page.locator('#hint-btn').click();
  await playLine(page, L2, 'w');
  await expect(page.locator('#done-text')).toHaveText(/^Оценка: Трудно · следващ преговор/);
  await expect(page.locator('#next-review-btn')).toHaveText('Към „Преговор“');

  const atts = await page.evaluate(() => globalThis.__lrn.userDb.db.getAll('attempts'));
  expect(atts.filter((a) => a.mode === 'review').map((a) => [a.grade ?? null, !!a.relearn])).toEqual([['again', false], [null, true], ['hard', false]]);
  const daily = await page.evaluate(() => globalThis.__lrn.userDb.db.getAll('daily'));
  expect(daily.find((d) => d.reviews)).toMatchObject({ reviews: 2, reviewErrors: 1, grades: { again: 1, hard: 1 } });

  // на следващия ден линия 1 отново е за преговор
  await page.clock.setFixedTime(at(4));
  await open(page, '#/review');
  await expect(page.locator('#review-list .line-row')).toHaveCount(1);
  await expect(page.locator('#review-list .line-row')).toHaveAttribute('data-line', L1.id);
});

test('лимит „Макс. преговори на ден“ и миграция на научена линия без карта (0.3.0)', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await open(page, '#/courses');
  await fast(page, { maxReviewsPerDay: 1 });
  // ред, както го е записала 0.3.0: научена, без карта
  await page.evaluate(async ([id1, id2]) => {
    const db = globalThis.__lrn.userDb.db;
    const base = (lineId, n) => ({
      key: `italian/${lineId}`, courseId: 'italian', lineId, n, status: 'learned', streak: 3, bestStreak: 3, plays: 3, cleanPlays: 3,
      errors: 0, hints: 0, firstSeen: Date.now() - 1000, lastPlayed: Date.now(), learnedAt: Date.now() - 5 * 86_400_000, due: null,
      fsrs: { stability: null, difficulty: null, reps: 0, lapses: 0, state: 'new', lastReview: null },
    });
    await db.put('lineProgress', base(id1, 1));
    await db.put('lineProgress', base(id2, 2));
  }, [L1.id, L2.id]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  const r = await row(page, 'italian', L1.id);
  expect(r.fsrs.reps).toBe(1);
  expect(r.fsrs.lastReview).toBe(T0.getTime() - 5 * DAY);
  // научени преди 5 дни → due беше преди 2 дни → днес са за преговор, но лимитът е 1
  await open(page, '#/review');
  await expect(page.locator('#review-list .line-row')).toHaveCount(1);
  await expect(page.locator('#screen')).toContainText('Показани са 1 от 2');
  await expect(page.locator('#review-list')).toContainText('просрочена с 2 дни');
  await expect(page.locator('#review-badge')).toHaveText('1');
  await page.locator('#review-start').click();
  await playLine(page, L1, 'w');
  await page.locator('#next-review-btn').click();
  await expect(page.locator('#review-empty')).toContainText('Достигнат е лимитът за днес (1 преговора)');
  // Курсът показва 1 за преговор (без лимита)
  await open(page, '#/course/italian');
  await expect(page.locator('#course-due')).toHaveText('За преговор днес: 1');
});

test('скрит ?now=+3d: отделно копие на данните — истинският прогрес не се пипа', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await open(page, '#/courses');
  await fast(page);
  await learn(page, 'caro-kann', C1, 'b');
  await open(page, '#/review', '?now=%2B3d');
  await expect(page.locator('#sim-bar')).toContainText('Симулирано време');
  await expect(page.locator('#review-count')).toHaveText('За преговор днес: 1');
  await page.locator('#review-start').click();
  await playLine(page, C1, 'b');
  await expect(page.locator('#done-text')).toHaveText(/^Оценка: Добре/);
  const sim = await row(page, 'caro-kann', C1.id);
  expect(sim.fsrs.reps).toBe(2);
  // истинската база: картата е непокътната
  await open(page, '#/review');
  await expect(page.locator('#sim-bar')).toHaveCount(0);
  const real = await row(page, 'caro-kann', C1.id);
  expect(real.fsrs.reps).toBe(1);
  // копието се пази между отварянията; &simreset=1 го копира наново
  await open(page, '#/review', '?now=%2B3d');
  await expect(page.locator('#review-empty')).toBeVisible();
  await open(page, '#/review', '?now=%2B3d&simreset=1');
  await expect(page.locator('#review-count')).toHaveText('За преговор днес: 1');
  await page.locator('#sim-exit').click();
  await expect(page).toHaveURL(/\/LrnOldGame\/#\/review$/);
});

test('офлайн: преговор след 3 дни без мрежа', async ({ page, context }) => {
  await page.clock.setFixedTime(T0);
  await open(page, '#/courses');
  await waitForSW(page);
  await fast(page);
  await learn(page, 'italian', L1, 'w');
  await context.setOffline(true);
  await page.clock.setFixedTime(at(3));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await open(page, '#/review');
  await expect(page.locator('#review-badge')).toHaveText('1');
  await page.locator('#review-start').click();
  await playLine(page, L1, 'w');
  await expect(page.locator('#done-text')).toHaveText(/^Оценка: Добре/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await open(page, '#/review');
  await expect(page.locator('#review-empty')).toContainText('Преговорът за днес е готов');
  await context.setOffline(false);
});

test('D-030: „Първи преговор след (дни)“ = 5 → научената линия идва за преговор след 5 дни', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await open(page, '#/settings');
  const inp = page.locator('#set-firstReviewDays');
  await expect(inp).toHaveValue('3');
  await expect(page.locator('.field[data-key="firstReviewDays"]')).toContainText('Първи преговор след (дни)');
  await inp.fill('5');
  await inp.blur();
  await expect.poll(() => page.evaluate(async () => (await globalThis.__lrn.userDb.loadSettings()).firstReviewDays)).toBe(5);
  await fast(page);
  await learn(page, 'italian', L1, 'w');
  const r0 = await row(page, 'italian', L1.id);
  expect(r0.due).toBe(new Date(2026, 11, 1, 4).getTime()); // 26.11 + 5 = 01.12, 04:00
  expect(r0.fsrs.scheduledDays).toBe(5);
  await open(page, '#/course/italian');
  await expect(page.locator(`.line-row[data-line="${L1.id}"]`)).toContainText('научена · преговор след 5 дни (1 дек.)');
  await page.clock.setFixedTime(at(4));
  await open(page, '#/review');
  await expect(page.locator('#review-badge')).toBeHidden();
  await page.clock.setFixedTime(at(5));
  await open(page, '#/courses');
  await expect(page.locator('#review-badge')).toHaveText('1');
  await expect(page.locator('#today-line')).toContainText('Днес: 1 за преговор');
});
