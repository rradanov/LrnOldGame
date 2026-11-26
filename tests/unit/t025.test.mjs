// T-025: поправки след приемането на MVP (T013-D1, D3, D5, D7, D9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openUserDb, checkBackup, BackupError } from '../../src/db/userdb.js';
import { rescueDump, resetDb } from '../../src/db/rescue.js';
import { DB_NAME } from '../../src/db/schema.js';
import { mergeCarry } from '../../src/train/session.js';
import { fmt, plural, decimal, T } from '../../src/i18n/bg.js';
import { parseHash } from '../../src/router.js';
import { SETTINGS_SCHEMA } from '../../src/settings.js';

const T0 = Date.UTC(2026, 10, 26, 9);
const DAY = 86_400_000;
const OK = { done: true, clean: true, errors: [], hints: 0, plies: 6, total: 6, userMoves: 3, ms: 3000, maxMoveMs: 1000 };
const SRS = { retention: 0.9, relearnStreak: 1, hardAfterSec: 15, reviewErrorsForAgain: 1, maxIntervalDays: 3650 };

test('D1: markDirty в learn нулира брояча веднага; recordAttempt маха pending', async () => {
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => T0 });
  const base = { courseId: 'italian', lineId: 'l1', n: 1, learnStreak: 3, dayStartHour: 4, srs: SRS };
  await udb.touchLine('italian', 'l1', 1);
  await udb.recordAttempt({ ...base, result: OK });
  await udb.recordAttempt({ ...base, result: OK });
  assert.equal((await udb.getLine('italian', 'l1')).streak, 2);
  const err = [{ ply: 2, played: 'a3', expected: 'Nf3' }];
  await udb.markDirty({ courseId: 'italian', lineId: 'l1', mode: 'learn', errors: err, hints: 0 });
  let row = await udb.getLine('italian', 'l1');
  assert.equal(row.streak, 0, 'броячът е 0 още преди края на опита');
  assert.equal(row.bestStreak, 2);
  assert.deepEqual(row.pending.errors, err);
  // следващото отваряне приключва прекъснатия опит като неуспешен, после чисто → 1
  await udb.recordAttempt({ ...base, result: { ...OK, done: false, clean: false, errors: err } });
  row = await udb.getLine('italian', 'l1');
  assert.equal(row.pending, undefined);
  assert.equal(row.streak, 0);
  await udb.recordAttempt({ ...base, result: OK });
  assert.equal((await udb.getLine('italian', 'l1')).streak, 1);
  assert.equal(await udb.markDirty({ courseId: 'italian', lineId: 'none', mode: 'learn' }), null);
  udb.close();
});

test('D1: pending в review не пипа брояча и картата; оценката е по реалните грешки (mergeCarry)', async () => {
  let clock = T0;
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => clock });
  const base = { courseId: 'italian', lineId: 'l1', n: 1, learnStreak: 1, dayStartHour: 4 };
  await udb.touchLine('italian', 'l1', 1);
  await udb.recordAttempt({ ...base, srs: SRS, result: OK });
  clock = T0 + 3 * DAY;
  const err = [{ ply: 2, played: 'a3', expected: 'Nf3' }];
  const before = await udb.getLine('italian', 'l1');
  await udb.markDirty({ courseId: 'italian', lineId: 'l1', mode: 'review', errors: err, hints: 1 });
  const row = await udb.getLine('italian', 'l1');
  assert.deepEqual(row.fsrs, before.fsrs);
  assert.equal(row.due, before.due);
  assert.equal(row.streak, before.streak);
  // learn опит (упражнение) не маха pending от review
  await udb.recordAttempt({ ...base, srs: SRS, result: OK });
  assert.equal((await udb.getLine('italian', 'l1')).pending.mode, 'review');
  // след презареждане: чисто изиграване + пренесената грешка
  const merged = mergeCarry(OK, row.pending);
  assert.equal(merged.clean, false);
  assert.equal(merged.errors.length, 1);
  assert.equal(merged.hints, 1);
  // reviewErrorsForAgain = 2 → една грешка = „Трудно“ (по реалните грешки, не „Отново“ заради прекъсването)
  const out = await udb.recordAttempt({ ...base, mode: 'review', srs: { ...SRS, reviewErrorsForAgain: 2 }, result: merged });
  assert.equal(out.review.gradeName, 'hard');
  assert.equal(out.row.pending, undefined);
  assert.equal(mergeCarry(OK, null), OK);
  udb.close();
});

test('D3: форми за число и десетична запетая', () => {
  assert.equal(plural(1, 'ден', 'дни'), 'ден');
  assert.equal(plural(2, 'ден', 'дни'), 'дни');
  assert.equal(plural(0, 'ден', 'дни'), 'дни');
  assert.equal(fmt(T.train.relearnLabel, { k: 1 }), 'Повторение след грешка: остава 1 чист пробег');
  assert.equal(fmt(T.train.relearnLabel, { k: 2 }), 'Повторение след грешка: остават 2 чисти пробега');
  // T-028 (D-034): резултатът е до 2 думи; формата за число остава в aria-label и в „N грешки“.
  assert.equal(fmt(T.train.doneErrors, { n: 1 }), '1 грешка');
  assert.equal(fmt(T.train.doneErrors, { n: 3 }), '3 грешки');
  assert.equal(fmt(T.review.dueIn, { n: 1 }), 'просрочена с 1 ден');
  assert.equal(fmt(T.when.inDays, { n: 2, date: 'x' }), 'след 2 дни (x)');
  assert.equal(fmt(T.review.doneToday, { reviews: 1, again: 0 }), 'Днес: 1 преговор · 0 с „Отново“');
  assert.equal(fmt(T.course.moves, { n: 1 }), '1 ход');
  assert.equal(fmt('{x|a|b}', {}), '{x|a|b}', 'липсваща променлива остава');
  assert.equal(decimal(1.22, 2), '1,22');
  assert.equal(decimal(-0.5, 2), '-0,50');
});

test('D5: етикетите не повтарят единицата; единиците са на български', () => {
  for (const d of SETTINGS_SCHEMA) {
    if (d.unit) assert.ok(!d.label.includes(`(${d.unit})`), `${d.key}: единицата е два пъти`);
    assert.ok(!/^(ms|sec|s|h|days)$/.test(d.unit || ''), `${d.key}: ${d.unit}`);
  }
});

test('D7: rescueDump спасява наличните store-ове от база с непозната по-нова версия; resetDb я изтрива', async () => {
  const idb = new IDBFactory();
  const udb = await openUserDb({ indexedDB: idb, now: () => T0 });
  await udb.touchLine('italian', 'l1', 1);
  await udb.setSelected('italian', true);
  udb.close();
  // „бъдеща“ версия 99 с допълнителен store
  await new Promise((res, rej) => {
    const r = idb.open(DB_NAME, 99);
    r.onupgradeneeded = () => r.result.createObjectStore('junk');
    r.onsuccess = () => { r.result.close(); res(); };
    r.onerror = () => rej(r.error);
  });
  await assert.rejects(openUserDb({ indexedDB: idb }));
  const b = await rescueDump({ indexedDB: idb, appVersion: 'x', now: () => T0 });
  assert.equal(b.rescue.dbVersion, 99);
  assert.equal(b.stores.lineProgress.length, 1);
  assert.equal(b.stores.myCourses.length, 1);
  assert.ok(!('junk' in b.stores));
  // бекъп от по-нова схема не се внася в това приложение
  assert.throws(() => checkBackup(b), BackupError);
  await resetDb({ indexedDB: idb });
  const fresh = await openUserDb({ indexedDB: idb });
  assert.equal((await fresh.listMyCourses()).length, 0);
  fresh.close();
  // няма база → нищо за спасяване (и не се създава празна)
  assert.equal(await rescueDump({ indexedDB: new IDBFactory() }), null);
});

test('D7: база v1 без store-ове → празен спасителен бекъп, който се внася', async () => {
  const idb = new IDBFactory();
  await new Promise((res) => { const r = idb.open(DB_NAME, 1); r.onsuccess = () => { r.result.close(); res(); }; });
  const b = await rescueDump({ indexedDB: idb });
  assert.equal(b.rescue.rows, 0);
  assert.doesNotThrow(() => checkBackup(b));
});

test('D9: преговорът свети под „Преговор“, ученето — под „Курсове“', () => {
  assert.equal(parseHash('#/train/italian/x?mode=review').tab, 'review');
  assert.equal(parseHash('#/train/italian/x?mode=learn').tab, 'courses');
  assert.equal(parseHash('#/course/italian').tab, 'courses');
});
