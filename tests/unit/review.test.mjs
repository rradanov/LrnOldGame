// Преговор (T-010 + T-020): оценяване, опашка, лимити, повторение след Again, миграция на картите,
// запис в IndexedDB, часовник ?now=, времето на хода в сесията.
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { gradeAttempt, applyReview, createCard, hasCard, isDueToday, inRelearn } from '../../src/srs/review.js';
import { reviewQueue, newQueue, newLeftToday, nextReviewAt, daysUntil, dueCountByCourse } from '../../src/srs/queue.js';
import { GRADE, dayNumber, dayStart, next } from '../../src/srs/fsrs.js';
import { newLineRow, applyAttempt } from '../../src/data/progress.js';
import { openUserDb } from '../../src/db/userdb.js';
import { parseNowParam, createClock } from '../../src/clock.js';
import { createSession } from '../../src/train/session.js';

const DAY = 86_400_000;
const H4 = 4 * 3_600_000;
const T0 = Date.UTC(2026, 10, 26, 12); // 26.11.2026 12:00
const OK = { done: true, clean: true, errors: [], hints: 0, maxMoveMs: 2000 };
const ERR1 = { done: true, clean: false, errors: [{ ply: 2, played: 'd4', expected: 'Nf3' }], hints: 0, maxMoveMs: 2000 };
const ERR2 = { ...ERR1, errors: [ERR1.errors[0], { ply: 4, played: 'a3', expected: 'Bc4' }] };
const HINT = { done: true, clean: false, errors: [], hints: 1, maxMoveMs: 2000 };
const SLOW = { ...OK, maxMoveMs: 16_000 };
const FAIL = { done: false, clean: false, errors: [ERR1.errors[0]], hints: 0, maxMoveMs: 0 };

function learnedRow(courseId, lineId, n, at = T0, opts = { dayStartHour: 4 }) {
  const r = { ...newLineRow({ courseId, lineId, n }, at), status: 'learned', learnedAt: at, streak: 3 };
  return createCard(r, at, opts);
}

test('оценка: Good / Hard (подсказка, бавен ход) / Again (грешка, незавършен)', () => {
  assert.equal(gradeAttempt(OK), GRADE.good);
  assert.equal(gradeAttempt(HINT), GRADE.hard);
  assert.equal(gradeAttempt(SLOW, { hardAfterSec: 15 }), GRADE.hard);
  assert.equal(gradeAttempt(SLOW, { hardAfterSec: 20 }), GRADE.good);
  assert.equal(gradeAttempt(ERR1), GRADE.again);
  assert.equal(gradeAttempt(FAIL), GRADE.again);
  // reviewErrorsForAgain = 2: една грешка → Hard, две → Again; незавършен → Again винаги
  assert.equal(gradeAttempt(ERR1, { reviewErrorsForAgain: 2 }), GRADE.hard);
  assert.equal(gradeAttempt(ERR2, { reviewErrorsForAgain: 2 }), GRADE.again);
  assert.equal(gradeAttempt({ ...FAIL, errors: [] }, { reviewErrorsForAgain: 2 }), GRADE.again);
});

test('createCard: първи преглед Good в learnedAt, due след 3 дни в 04:00; не презаписва съществуваща карта', () => {
  const r = learnedRow('italian', 'a', 1);
  assert.ok(hasCard(r));
  assert.equal(r.fsrs.reps, 1);
  assert.equal(r.fsrs.lastReview, T0);
  assert.equal(r.due, Date.UTC(2026, 10, 29, 4));
  assert.equal(createCard(r, T0 + DAY), r);
  assert.equal(hasCard({ ...r, status: 'learning' }), false);
});

test('applyReview: Good → нова дата, reps+1; Again → relearn същия ден, после повторения не пипат картата', () => {
  const r = learnedRow('italian', 'a', 1);
  const at = r.due + 3_600_000; // денят на преговора, 05:00
  assert.ok(isDueToday(r, at, 4));
  assert.equal(isDueToday(r, at - DAY, 4), false);

  const g = applyReview(r, OK, { now: at, dayStartHour: 4 });
  assert.equal(g.grade, GRADE.good);
  assert.equal(g.row.fsrs.reps, 2);
  assert.ok(g.row.due > r.due + 5 * DAY, 'Good дава по-дълъг интервал');
  assert.equal(isDueToday(g.row, at, 4), false);

  const a = applyReview(r, ERR1, { now: at, dayStartHour: 4, relearnStreak: 2 });
  assert.equal(a.gradeName, 'again');
  assert.equal(a.row.fsrs.lapses, 1);
  assert.equal(a.row.fsrs.state, 'relearning');
  assert.equal(a.row.relearnLeft, 2);
  assert.equal(a.interval, 1);
  assert.ok(inRelearn(a.row, at, 4));
  assert.ok(isDueToday(a.row, at, 4), 'в повторение е в опашката днес');
  // повторение: чисто → 1, мръсно → пак 2, чисто ×2 → 0; картата е същата
  const p1 = applyReview(a.row, OK, { now: at + 60_000, dayStartHour: 4, relearnStreak: 2 });
  assert.equal(p1.relearn, true);
  assert.equal(p1.grade, null);
  assert.equal(p1.row.relearnLeft, 1);
  assert.deepEqual(p1.row.fsrs, a.row.fsrs);
  const p2 = applyReview(p1.row, ERR1, { now: at + 120_000, dayStartHour: 4, relearnStreak: 2 });
  assert.equal(p2.row.relearnLeft, 2);
  const p3 = applyReview(applyReview(p2.row, OK, { now: at + 180_000, dayStartHour: 4, relearnStreak: 2 }).row, OK, { now: at + 240_000, dayStartHour: 4, relearnStreak: 2 });
  assert.equal(p3.row.relearnLeft, 0);
  assert.equal(inRelearn(p3.row, at, 4), false);
  assert.equal(isDueToday(p3.row, at, 4), false, 'след повторението — утре');
  assert.ok(isDueToday(p3.row, at + DAY, 4));
  // недовършено повторение вчера → днес е нормален преговор с оценка
  const tomorrow = applyReview(a.row, OK, { now: at + DAY, dayStartHour: 4, relearnStreak: 2 });
  assert.equal(tomorrow.relearn, false);
  assert.equal(tomorrow.gradeName, 'good');
  assert.equal(tomorrow.row.relearnLeft, 0);
});

test('applyReview: Hard < Good по интервал; размиването е детерминирано', () => {
  const r = learnedRow('italian', 'a', 1);
  const at = r.due + 3_600_000;
  const h = applyReview(r, HINT, { now: at, dayStartHour: 4 });
  const g = applyReview(r, OK, { now: at, dayStartHour: 4 });
  assert.ok(h.interval < g.interval);
  const f1 = applyReview(r, OK, { now: at, dayStartHour: 4, reviewFuzz: true });
  const f2 = applyReview(r, OK, { now: at, dayStartHour: 4, reviewFuzz: true });
  assert.equal(f1.interval, f2.interval);
  const m = applyReview(r, OK, { now: at, dayStartHour: 4, maxIntervalDays: 7 });
  assert.ok(m.interval <= 7);
});

test('опашка: due ≤ днес, по курс (реда на „Моите курсове“) и по n; orphan и скрити курсове не влизат', () => {
  const rows = [
    learnedRow('caro-kann', 'c2', 2),
    learnedRow('italian', 'i3', 3),
    learnedRow('italian', 'i1', 1),
    learnedRow('italian', 'gone', 4),
    learnedRow('hidden', 'h1', 1),
    learnedRow('italian', 'late', 5, T0 + 2 * DAY), // научена по-късно → due по-късно
  ];
  const at = Date.UTC(2026, 10, 29, 10);
  const courses = [
    { courseId: 'italian', lineIds: new Set(['i1', 'i3', 'late']) },
    { courseId: 'caro-kann', lineIds: null },
  ];
  const q = reviewQueue({ courses, rows, now: at, dayStartHour: 4 });
  assert.deepEqual(q.items.map((r) => r.lineId), ['i1', 'i3', 'c2']);
  assert.equal(q.dueTotal, 3);
  assert.equal(q.limited, false);
  // преди 04:00 на 29-ти още е 28-ми → нищо
  assert.equal(reviewQueue({ courses, rows, now: Date.UTC(2026, 10, 29, 3, 59), dayStartHour: 4 }).items.length, 0);
  assert.equal(reviewQueue({ courses, rows, now: Date.UTC(2026, 10, 29, 3, 59), dayStartHour: 0 }).items.length, 3);
  // лимит: 2 на ден, 1 вече направен → 1
  const l = reviewQueue({ courses, rows, now: at, dayStartHour: 4, maxReviewsPerDay: 2, reviewsDoneToday: 1 });
  assert.deepEqual(l.items.map((r) => r.lineId), ['i1']);
  assert.equal(l.limited, true);
  assert.equal(l.left, 1);
  assert.equal(reviewQueue({ courses, rows, now: at, dayStartHour: 4, maxReviewsPerDay: 2, reviewsDoneToday: 5 }).items.length, 0);
  assert.equal(reviewQueue({ courses, rows, now: at, dayStartHour: 4, maxReviewsPerDay: 0, reviewsDoneToday: 500 }).items.length, 3, '0 = без лимит');
  // повторение след Again е винаги в опашката (първо), дори при изчерпан лимит
  const again = applyReview(rows[2], ERR1, { now: at, dayStartHour: 4 }).row;
  const q2 = reviewQueue({ courses, rows: [again, ...rows.slice(0, 2)], now: at + 1000, dayStartHour: 4, maxReviewsPerDay: 1, reviewsDoneToday: 1 });
  assert.deepEqual(q2.items.map((r) => r.lineId), ['i1']);
  // брой по курс, следваща дата, дни до
  assert.equal(dueCountByCourse(rows, at, 4).get('italian'), 3); // вкл. 'gone' (филтрира се по-горе)
  assert.equal(nextReviewAt(rows, at, 4), Date.UTC(2026, 11, 1, 4));
  assert.equal(nextReviewAt([], at, 4), null);
  assert.equal(daysUntil(rows[5], at, 4), 2);
  assert.equal(daysUntil(rows[0], at, 4), 0);
});

test('нови линии: лимит newLinesPerDay минус научените днес, в реда на линиите', () => {
  assert.equal(newLeftToday(5, 2), 3);
  assert.equal(newLeftToday(5, 9), 0);
  const rowsByKey = new Map([['italian/a', { status: 'learned' }], ['italian/b', { status: 'learning' }]]);
  const q = newQueue({ courses: [{ courseId: 'italian', lines: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }] }, { courseId: 'caro', lines: [{ id: 'x', n: 1 }] }], rowsByKey, left: 3 });
  assert.deepEqual(q.map((x) => x.lineId), ['b', 'c', 'x']);
});

test('IndexedDB: научаване създава карта; преговор пише attempts (grade) и daily (reviews, reviewErrors)', async () => {
  let clock = T0;
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => clock });
  const srs = { retention: 0.9, relearnStreak: 1, hardAfterSec: 15, reviewErrorsForAgain: 1, maxIntervalDays: 3650 };
  const base = { courseId: 'italian', lineId: 'l1', n: 1, learnStreak: 2, dayStartHour: 4, srs };
  await udb.touchLine('italian', 'l1', 1);
  await udb.recordAttempt({ ...base, result: OK });
  let out = await udb.recordAttempt({ ...base, result: OK });
  assert.equal(out.becameLearned, true);
  assert.equal(out.row.fsrs.reps, 1);
  assert.equal(out.row.due, Date.UTC(2026, 10, 29, 4));
  // review преди картата да е due пак се записва като преговор (екранът не го допуска; API-то — да)
  clock = Date.UTC(2026, 10, 29, 9);
  out = await udb.recordAttempt({ ...base, mode: 'review', result: ERR1 });
  assert.equal(out.review.gradeName, 'again');
  assert.equal(out.row.relearnLeft, 1);
  clock += 60_000;
  out = await udb.recordAttempt({ ...base, mode: 'review', result: OK });
  assert.equal(out.review.relearn, true);
  assert.equal(out.row.relearnLeft, 0);
  const att = await udb.attemptsFor('italian', 'l1');
  assert.deepEqual(att.map((a) => [a.mode, a.grade ?? null, a.relearn ?? null]), [['learn', null, null], ['learn', null, null], ['review', 'again', false], ['review', null, true]]);
  assert.equal(att[2].interval, 1);
  const d = await udb.dayStats(clock, 4);
  assert.equal(d.reviews, 1);
  assert.equal(d.reviewErrors, 1);
  assert.equal(d.plays, 2);
  assert.deepEqual(d.grades, { again: 1 });
  const first = await udb.dayStats(T0, 4);
  assert.equal(first.newLearned, 1);
  // review на линия без карта → записва се като learn (не чупи)
  out = await udb.recordAttempt({ ...base, lineId: 'l2', mode: 'review', result: OK });
  assert.equal(out.review, null);
  assert.equal(out.row.status, 'learning');
  udb.close();
});

test('миграция: научени линии от 0.3.0 без карта получават карта от learnedAt; бекъп от 0.3.0 се внася', async () => {
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => T0 + 10 * DAY });
  const learnedAt = T0;
  // ред, както го пише 0.3.0 (fsrs.reps = 0, due = null)
  const old = { ...newLineRow({ courseId: 'italian', lineId: 'old', n: 1 }, learnedAt), status: 'learned', learnedAt, streak: 3 };
  const learning = { ...newLineRow({ courseId: 'italian', lineId: 'lrn', n: 2 }, learnedAt), status: 'learning', streak: 1 };
  const backup = {
    app: 'lrnoldgame', kind: 'backup', schemaVersion: 1, appVersion: '0.3.0', dataVersion: 'x', exportedAt: new Date(T0).toISOString(),
    stores: { myCourses: [{ courseId: 'italian', addedAt: T0, order: 0, hidden: false }], lineProgress: [old, learning], attempts: [], daily: [], settings: [], meta: [] },
  };
  await udb.importBackup(backup);
  assert.equal(await udb.ensureCards({ dayStartHour: 4 }), 1);
  assert.equal(await udb.ensureCards({ dayStartHour: 4 }), 0, 'втори път — нищо');
  const r = await udb.getLine('italian', 'old');
  assert.equal(r.fsrs.reps, 1);
  assert.equal(r.fsrs.lastReview, learnedAt);
  assert.equal(r.due, Date.UTC(2026, 10, 29, 4));
  assert.equal((await udb.getLine('italian', 'lrn')).fsrs.reps, 0);
  // научена без learnedAt → от lastPlayed
  // нов бекъп носи картата (round-trip)
  const exp = await udb.exportBackup({ appVersion: '0.4.0' });
  const r2 = exp.stores.lineProgress.find((x) => x.lineId === 'old');
  assert.equal(r2.fsrs.reps, 1);
  assert.equal(r2.due, r.due);
  udb.close();
});

test('бекъп без докосване на lastBackup (за копието при симулирано време)', async () => {
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => T0 });
  await udb.exportBackup({ touch: false });
  assert.equal(await udb.getMeta('lastBackup'), undefined);
  await udb.exportBackup({});
  assert.equal(await udb.getMeta('lastBackup'), T0);
  udb.close();
});

test('часовник ?now=: +Nd, дата, ISO, невалидно', () => {
  const real = Date.UTC(2026, 10, 26, 10, 30);
  assert.equal(parseNowParam('+3d', real), 3 * DAY);
  assert.equal(parseNowParam('-1d', real), -DAY);
  assert.equal(parseNowParam('2026-11-30', real), 4 * DAY);
  assert.equal(parseNowParam('2026-11-27T05:00:00Z', real), Date.UTC(2026, 10, 27, 5) - real);
  assert.equal(parseNowParam('xyz', real), 0);
  assert.equal(parseNowParam(null, real), 0);
  const c = createClock(DAY, () => real);
  assert.equal(c.now(), real + DAY);
  assert.equal(c.simulated, true);
  assert.equal(createClock(0).simulated, false);
});

test('сесия: maxMoveMs е най-бавният мой ход (от хода на противника до моя)', () => {
  let t = 0;
  const s = createSession({ sans: ['e4', 'e5', 'Nf3', 'Nc6'], side: 'w', now: () => t });
  t = 3000; s.userMove('e4');
  t = 3500; s.playAuto();
  t = 23_500; s.userMove('Nf3');
  t = 24_000; s.playAuto();
  const r = s.result();
  assert.equal(r.done, true);
  assert.equal(r.maxMoveMs, 20_000);
  assert.equal(gradeAttempt(r, { hardAfterSec: 15 }), GRADE.hard);
  s.restart();
  assert.equal(s.result().maxMoveMs, 0);
});

test('applyAttempt (learn) за научена линия не пипа картата', () => {
  const r = learnedRow('italian', 'a', 1);
  const { row } = applyAttempt(r, ERR1, { courseId: 'italian', lineId: 'a', n: 1, learnStreak: 3, now: T0 + DAY });
  assert.deepEqual(row.fsrs, r.fsrs);
  assert.equal(row.due, r.due);
  assert.equal(row.status, 'learned');
});

test('dayNumber/dayStart са обратни при dayStartHour', () => {
  const n = dayNumber(T0, 4);
  assert.equal(dayNumber(dayStart(n, 4), 4), n);
  assert.equal(dayStart(n, 4), Date.UTC(2026, 10, 26) + H4);
  assert.ok(next(null, GRADE.good, T0, { dayStartHour: 4 }).due > T0);
});

test('D-030: firstReviewDays — първият преговор след N дни; паметта е тази на FSRS; ensureCards го ползва', async () => {
  const base = { ...newLineRow({ courseId: 'italian', lineId: 'f1', n: 1 }, T0), status: 'learned', learnedAt: T0 };
  const plain = createCard(base, T0, { dayStartHour: 4 });
  for (const fd of [1, 3, 7, 14]) {
    const c = createCard(base, T0, { dayStartHour: 4, firstReviewDays: fd });
    assert.equal(c.due, dayStart(dayNumber(T0, 4) + fd, 4), `due след ${fd} дни`);
    assert.equal(c.fsrs.scheduledDays, fd);
    assert.equal(c.fsrs.stability, plain.fsrs.stability, 'стабилността не се пипа');
    assert.equal(c.fsrs.difficulty, plain.fsrs.difficulty);
    assert.equal(c.fsrs.reps, 1);
  }
  // 3 дни = досегашното поведение (FSRS при retention 0,9)
  assert.equal(createCard(base, T0, { dayStartHour: 4, firstReviewDays: 3 }).due, plain.due);
  // ограничено от maxIntervalDays
  assert.equal(createCard(base, T0, { dayStartHour: 0, firstReviewDays: 14, maxIntervalDays: 7 }).fsrs.scheduledDays, 7);
  // следващият преговор (Good) смята с реално изминалите дни: ранен първи преговор → по-малка нова стабилност
  const early = createCard(base, T0, { dayStartHour: 0, firstReviewDays: 1 });
  const late = createCard(base, T0, { dayStartHour: 0, firstReviewDays: 7 });
  const OKR = { clean: true, done: true, errors: [], hints: 0, maxMoveMs: 1000 };
  const e = applyReview(early, OKR, { now: early.due + 3600_000, dayStartHour: 0 });
  const l = applyReview(late, OKR, { now: late.due + 3600_000, dayStartHour: 0 });
  assert.ok(e.row.fsrs.stability < l.row.fsrs.stability);
  assert.equal(e.gradeName, 'good');

  // Миграция: научена линия без карта получава due = learnedAt + firstReviewDays.
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => T0 + 10 * DAY });
  await udb.db.put('lineProgress', { ...base, key: 'italian/f1' });
  assert.equal(await udb.ensureCards({ dayStartHour: 4, firstReviewDays: 5 }), 1);
  assert.equal((await udb.getLine('italian', 'f1')).due, dayStart(dayNumber(T0, 4) + 5, 4));
  udb.close();
});
