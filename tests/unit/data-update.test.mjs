// T-012: обновяване на данните без загуба на прогрес (src/data/dataUpdate.js + userDb.applyDataUpdate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { planDataUpdate, summarize, updateIsRecent, lineInfo, UPDATE_NOTE_DAYS } from '../../src/data/dataUpdate.js';
import { openUserDb } from '../../src/db/userdb.js';
import { reviewQueue } from '../../src/srs/queue.js';
import { courseProgress, lineStatus } from '../../src/data/progress.js';
import { createCard } from '../../src/srs/review.js';
import { newLineRow } from '../../src/data/progress.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 26, 12);
const L = (id, n, sans = ['e4', 'e5', 'Nf3', String(n)]) => ({ id, n, sans, name: `Line ${id}`, eco: 'C50' });
const course = (id, lines) => ({ id, lines });

function learned(courseId, lineId, n, at = T0) {
  const r = { ...newLineRow({ courseId, lineId, n }, at), status: 'learned', streak: 3, plays: 3, cleanPlays: 3, learnedAt: at };
  return createCard(r, at, { dayStartHour: 4 });
}
const learning = (courseId, lineId, n) => ({ ...newLineRow({ courseId, lineId, n }, T0), status: 'learning', streak: 1, plays: 1 });

test('план: запазени, оттеглени (orphan), нови и върнати линии; номерът n се обновява', () => {
  const rows = [learned('italian', 'a', 1), learning('italian', 'b', 2), learned('italian', 'c', 3), learned('slav', 's1', 1)];
  const courses = [course('italian', [L('a', 2), L('c', 1), L('d', 3), L('e', 4)]), course('slav', [L('s1', 1)])];
  const prevLineIds = { italian: ['a', 'b', 'c'], slav: ['s1'] };
  const plan = planDataUpdate({ courses, rows, prevLineIds, dataVersion: 'v2', prevDataVersion: 'v1', now: T0 + DAY });
  const byId = new Map(plan.puts.map((r) => [r.lineId, r]));
  // a и c: същият id → прогресът и картата остават, n е новият
  assert.equal(byId.get('a').status, 'learned');
  assert.equal(byId.get('a').n, 2);
  assert.deepEqual(byId.get('a').fsrs, rows[0].fsrs);
  assert.equal(byId.get('a').due, rows[0].due);
  assert.equal(byId.get('c').n, 1);
  // b изчезна → orphan, със стария статус
  assert.equal(byId.get('b').status, 'orphan');
  assert.deepEqual(byId.get('b').orphan, { prevStatus: 'learning', at: T0 + DAY, dataVersion: 'v2', fromVersion: 'v1', n: 2 });
  assert.equal(byId.get('b').streak, 1, 'броячът не се губи');
  // резюме
  assert.deepEqual(plan.courses.italian, { added: 2, addedIds: ['d', 'e'], removed: 1, orphaned: 1, restored: 0 });
  assert.deepEqual(plan.courses.slav, { added: 0, addedIds: [], removed: 0, orphaned: 0, restored: 0 });
  assert.deepEqual(plan.lineIds, { italian: ['a', 'c', 'd', 'e'], slav: ['s1'] });
  // s1 е непроменена, но получава info (ходове) — за да се покаже, ако изчезне по-късно
  assert.deepEqual(byId.get('s1').info, lineInfo(L('s1', 1)));

  // Втори пуск със същите данни: нищо за писане.
  const after = rows.map((r) => byId.get(r.lineId) || r);
  const again = planDataUpdate({ courses, rows: after, prevLineIds: plan.lineIds, dataVersion: 'v2', prevDataVersion: 'v2', now: T0 + 2 * DAY });
  assert.equal(again.puts.length, 0);
  assert.equal(again.courses.italian.added, 0);

  // b се връща в v3 → статусът е възстановен, orphan полето е махнато
  const v3 = [course('italian', [L('a', 1), L('b', 2)])];
  const back = planDataUpdate({ courses: v3, rows: after, prevLineIds: plan.lineIds, dataVersion: 'v3', prevDataVersion: 'v2', now: T0 + 3 * DAY });
  const b = back.puts.find((r) => r.lineId === 'b');
  assert.equal(b.status, 'learning');
  assert.equal('orphan' in b, false);
  assert.equal(b.streak, 1);
  assert.equal(back.courses.italian.restored, 1);
  assert.equal(back.courses.italian.added, 1, 'b не е в снимката на v2 → брои се като нова');
  assert.equal(back.courses.italian.removed, 3, 'c, d, e');
  assert.equal(back.puts.find((r) => r.lineId === 'c').status, 'orphan');
});

test('план: без снимка (надграждане от 0.4.0) — нови не са известни, оттеглени = линиите с прогрес; курс извън manifest не се пипа', () => {
  const rows = [learned('italian', 'a', 1), learned('italian', 'gone', 2), learned('old-course', 'x', 1)];
  const plan = planDataUpdate({ courses: [course('italian', [L('a', 1), L('b', 2)])], rows, prevLineIds: null, dataVersion: 'v2', prevDataVersion: 'v2', now: T0 });
  assert.equal(plan.courses.italian.added, null);
  assert.equal(plan.courses.italian.removed, 1);
  assert.equal(plan.puts.find((r) => r.lineId === 'gone').status, 'orphan');
  assert.equal(plan.puts.some((r) => r.courseId === 'old-course'), false);
  assert.equal('old-course' in plan.courses, false);
});

test('orphan линиите не се броят в прогреса и не влизат в „Преговор“', () => {
  const rows = [learned('italian', 'a', 1), learned('italian', 'gone', 2)];
  const plan = planDataUpdate({ courses: [course('italian', [L('a', 1)])], rows, prevLineIds: { italian: ['a', 'gone'] }, dataVersion: 'v2', prevDataVersion: 'v1', now: T0 });
  const after = rows.map((r) => plan.puts.find((p) => p.lineId === r.lineId) || r);
  assert.equal(lineStatus(after[1]), 'new');
  assert.equal(courseProgress(1, after).learned, 1);
  // и без lineIds (опашката разчита на статуса)
  const q = reviewQueue({ courses: [{ courseId: 'italian', lineIds: null }], rows: after, now: T0 + 10 * DAY, dayStartHour: 4 });
  assert.deepEqual(q.items.map((r) => r.lineId), ['a']);
});

test('резюме върху видимите курсове и срок на бележката', () => {
  const upd = { at: T0, courses: { italian: { added: 2, removed: 1 }, slav: { added: null, removed: 3 }, hidden: { added: 5, removed: 5 } } };
  assert.deepEqual(summarize(upd, new Set(['italian', 'slav'])), { added: 2, removed: 4, changed: true });
  assert.deepEqual(summarize({ courses: { italian: { added: 0, removed: 0 } } }, new Set(['italian'])), { added: 0, removed: 0, changed: false });
  assert.equal(updateIsRecent(upd, T0 + (UPDATE_NOTE_DAYS - 1) * DAY), true);
  assert.equal(updateIsRecent(upd, T0 + UPDATE_NOTE_DAYS * DAY), false);
  assert.equal(updateIsRecent(null, T0), false);
});

test('IndexedDB: applyDataUpdate — една транзакция, meta (dataVersion, lineIds, dataUpdate), бекъп носи всичко', async () => {
  let clock = T0;
  const idb = new IDBFactory();
  const udb = await openUserDb({ indexedDB: idb, now: () => clock });
  const v1 = [course('italian', [L('a', 1), L('b', 2)])];
  // Първо пускане: само снимка, без резюме.
  const first = await udb.applyDataUpdate({ dataVersion: 'v1', courses: v1 });
  assert.equal(first.prev, null);
  assert.equal(first.update, null);
  assert.deepEqual(await udb.getMeta('lineIds'), { italian: ['a', 'b'] });
  assert.equal(await udb.getMeta('dataVersion'), 'v1');

  await udb.touchLine('italian', 'a', 1, lineInfo(L('a', 1)));
  await udb.touchLine('italian', 'b', 2, lineInfo(L('b', 2)));
  const res = { clean: true, done: true, errors: [], hints: 0, ms: 1000, plies: 4, total: 4, userMoves: 2, maxMoveMs: 500 };
  await udb.recordAttempt({ courseId: 'italian', lineId: 'b', n: 2, result: res, learnStreak: 1, dayStartHour: 4 });
  assert.equal((await udb.getLine('italian', 'b')).status, 'learned');
  assert.equal((await udb.learnedRows()).length, 1);

  clock += DAY;
  const v2 = [course('italian', [L('a', 1), L('c', 2), L('d', 3)]), course('slav', [L('s1', 1)])];
  const out = await udb.applyDataUpdate({ dataVersion: 'v2', courses: v2 });
  assert.equal(out.prev, 'v1');
  assert.deepEqual(out.update.courses.italian, { added: 2, addedIds: ['c', 'd'], removed: 1, orphaned: 1, restored: 0 });
  assert.equal(out.update.seen, false);
  assert.deepEqual(await udb.getMeta('dataUpdate'), out.update);
  const b = await udb.getLine('italian', 'b');
  assert.equal(b.status, 'orphan');
  assert.equal(b.orphan.prevStatus, 'learned');
  assert.ok(b.fsrs.reps > 0, 'картата е запазена');
  assert.deepEqual(b.info.m, L('b', 2).sans, 'ходовете на изчезналата линия са в реда');
  assert.equal((await udb.learnedRows()).length, 0, 'orphan не е в индекса status=learned → не е в „Преговор“');
  assert.deepEqual((await udb.orphanRows('italian')).map((r) => r.lineId), ['b']);
  assert.deepEqual(await udb.getMeta('lineIds'), { italian: ['a', 'c', 'd'], slav: ['s1'] });

  // Бекъп round-trip пази orphan реда и снимката.
  const bk = await udb.exportBackup({ appVersion: '0.5.0' });
  const udb2 = await openUserDb({ indexedDB: new IDBFactory(), now: () => clock });
  await udb2.importBackup(bk);
  assert.equal((await udb2.getLine('italian', 'b')).status, 'orphan');
  assert.deepEqual(await udb2.getMeta('lineIds'), { italian: ['a', 'c', 'd'], slav: ['s1'] });

  // Линията се връща → научена, с картата си, отново в индекса.
  clock += DAY;
  const v3 = [course('italian', [L('a', 1), L('b', 2)])];
  const back = await udb.applyDataUpdate({ dataVersion: 'v3', courses: v3 });
  assert.equal(back.update.courses.italian.restored, 1);
  const b3 = await udb.getLine('italian', 'b');
  assert.equal(b3.status, 'learned');
  assert.equal(b3.orphan, undefined);
  assert.equal((await udb.learnedRows()).length, 1);
  // Снимката пази и курса, който липсва сега (slav), за следващо сравнение.
  assert.deepEqual(await udb.getMeta('lineIds'), { italian: ['a', 'b'], slav: ['s1'] });
  udb.close();
  udb2.close();
});

test('touchLine пази info на линията; стар ред без info го получава при следващо отваряне', async () => {
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => T0 });
  const r0 = await udb.touchLine('italian', 'a', 1);
  assert.equal(r0.info, undefined);
  const r1 = await udb.touchLine('italian', 'a', 1, lineInfo(L('a', 1)));
  assert.deepEqual(r1.info, lineInfo(L('a', 1)));
  assert.equal(r1.firstSeen, r0.firstSeen);
  udb.close();
});
