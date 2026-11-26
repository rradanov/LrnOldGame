// FSRS-6 (src/srs/fsrs.js) срещу ts-fsrs 6.0.1 (devDependency) — ARCH_T-001 §5, T-010.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultScheduler, Rating } from 'ts-fsrs';
import {
  next, nextMemory, nextInterval, forgettingCurve, scheduleDays, fuzzRange, dayNumber, dayStart, endOfDay,
  retrievability, GRADE, W,
} from '../../src/srs/fsrs.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

async function reference(retention) {
  return DefaultScheduler({ version: 'FSRS-6', desiredRetention: retention, enableShortTerm: false, enableFuzz: false, maximumInterval: 36500 });
}

/** Изпълнява поредица [grade, закъснение в дни спрямо due] в двете реализации. */
async function compare(seq, retention = 0.9) {
  const ref = await reference(retention);
  let now = T0;
  let rc = ref.newCard({ now: new Date(now) });
  let mine = null;
  const out = [];
  for (const [g, late = 0] of seq) {
    const rr = ref.review({ card: rc, grade: g, now: new Date(now) });
    rc = rr.card;
    const m = next(mine, g, now, { retention, dayStartHour: 0 });
    mine = m.card;
    assert.ok(Math.abs(mine.stability - rc.stability) < 1e-6, `S ${mine.stability} vs ${rc.stability} (${JSON.stringify(seq)})`);
    assert.ok(Math.abs(mine.difficulty - rc.difficulty) < 1e-6, `D ${mine.difficulty} vs ${rc.difficulty}`);
    assert.equal(m.interval, rc.scheduledDays, `интервал (${JSON.stringify(seq)})`);
    assert.equal(m.due, new Date(rc.dueAt).getTime(), 'due');
    assert.equal(mine.reps, rc.reps);
    assert.equal(mine.lapses, rc.lapses);
    out.push(m.interval);
    now = m.due + late * DAY;
  }
  return out;
}

const { again: A, hard: H, good: G, easy: E } = GRADE;
const SCENARIOS = [
  [[G]], [[A]], [[H]], [[E]],
  [[G], [G], [G], [G], [G], [G]],
  [[G], [H], [H], [H]],
  [[G], [A], [G], [G], [G]],
  [[G], [G], [A], [A], [G], [G]],
  [[G], [G], [G], [A], [H], [G], [G]],
  [[G, 3], [G, 5], [G, 10], [G]],
  [[G, -1], [G, -1], [G]],
  [[A], [A], [A], [G], [G]],
  [[H], [G], [E], [G]],
  [[G], [E], [E], [E]],
  [[G], [G, 30], [A], [G, 2], [G]],
  [[G], [H, 4], [A, 1], [H], [G]],
  [[G], [G], [G], [G], [G], [G], [G], [G], [G], [G]],
  [[E], [A], [G], [H], [G]],
  [[G, 100], [A], [G]],
  [[G], [A], [A], [A], [A], [G], [G], [G]],
];

test('FSRS-6: 20 поредици съвпадат с ts-fsrs (S, D ±1e-6, интервал, due, reps, lapses)', async () => {
  assert.equal(SCENARIOS.length, 20);
  for (const sc of SCENARIOS) await compare(sc);
});

test('FSRS-6: други желани успеваемости (0.8, 0.95) съвпадат с ts-fsrs', async () => {
  for (const r of [0.8, 0.95, 0.7, 0.99]) {
    await compare([[G], [G], [A], [G], [H], [G]], r);
  }
});

test('по-висока желана успеваемост → по-къси интервали', () => {
  const m = nextMemory(nextMemory(null, 0, G), 3, G);
  assert.ok(nextInterval(m.stability, 0.95) < nextInterval(m.stability, 0.9));
  assert.ok(nextInterval(m.stability, 0.8) > nextInterval(m.stability, 0.9));
  // при retention 0.9 интервалът ≈ стабилността
  assert.equal(nextInterval(10, 0.9), 10);
  assert.equal(forgettingCurve(10, 10), 0.9);
});

test('първа карта (научена = Good): S = w2, интервал 3 дни (монотонно спрямо Hard)', () => {
  const r = next(null, G, T0, { retention: 0.9 });
  assert.equal(r.card.stability, W[2]);
  assert.equal(r.interval, 3);
  assert.equal(r.card.reps, 1);
  assert.equal(r.card.state, 'review');
  assert.equal(r.due, T0 + 3 * DAY);
});

test('Again → lapse, state relearning; Good след това → review', () => {
  const a = next(null, G, T0).card;
  const b = next(a, A, T0 + 3 * DAY);
  assert.equal(b.card.lapses, 1);
  assert.equal(b.card.state, 'relearning');
  assert.equal(b.interval, 1);
  assert.ok(b.card.stability < a.stability);
  const c = next(b.card, G, b.due);
  assert.equal(c.card.state, 'review');
  assert.equal(c.card.lapses, 1);
});

test('Hard < Good по интервал; Good < Easy', () => {
  const c = next(null, G, T0).card;
  const at = T0 + 3 * DAY;
  const [ih, ig, ie] = [H, G, E].map((g) => next(c, g, at).interval);
  assert.ok(ih < ig && ig < ie, `${ih} ${ig} ${ie}`);
});

test('размиване: детерминирано, в обхвата, не пипа интервали < 2.5', () => {
  const mem = nextMemory(nextMemory(nextMemory(null, 0, G), 3, G), 10, G);
  const plain = scheduleDays(mem, 20, G);
  const a = scheduleDays(mem, 20, G, { fuzzSeed: 'italian/abc|3' });
  const b = scheduleDays(mem, 20, G, { fuzzSeed: 'italian/abc|3' });
  assert.equal(a, b);
  const { min, max } = fuzzRange(plain, 20);
  assert.ok(a >= min && a <= max, `${a} ∉ [${min}, ${max}]`);
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(scheduleDays(mem, 20, G, { fuzzSeed: `x${i}` }));
  assert.ok(seen.size > 1, 'семето трябва да променя интервала');
  assert.equal(scheduleDays(null, 0, H, { fuzzSeed: 's' }), scheduleDays(null, 0, H));
});

test('дни на приложението: dayStartHour', () => {
  const at0359 = new Date(2026, 10, 26, 3, 59).getTime();
  const at0400 = new Date(2026, 10, 26, 4, 0).getTime();
  assert.equal(dayNumber(at0400, 4) - dayNumber(at0359, 4), 1);
  assert.equal(dayStart(dayNumber(at0400, 4), 4), at0400);
  assert.equal(endOfDay(at0359, 4), at0400);
  // карта, научена в 03:59 — денят е предишният; due е в 04:00
  const r = next(null, G, at0359, { dayStartHour: 4 });
  assert.equal(r.due, new Date(2026, 10, 28, 4, 0).getTime());
});

test('retrievability спада с времето', () => {
  const c = next(null, G, T0).card;
  assert.equal(retrievability(null, T0), null);
  assert.equal(retrievability(c, T0), 1);
  const r3 = retrievability(c, T0 + 3 * DAY);
  const r10 = retrievability(c, T0 + 10 * DAY);
  assert.ok(r3 < 1 && r10 < r3);
});

test('невалидни входове', () => {
  assert.throws(() => nextInterval(1, 0));
  assert.throws(() => nextMemory(null, 0, 5));
});
