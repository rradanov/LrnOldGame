// IndexedDB слой (src/db/*) върху fake-indexeddb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openDb } from '../../src/db/idb.js';
import { MIGRATIONS, STORES, SCHEMA_VERSION, DB_NAME, lineKey } from '../../src/db/schema.js';
import { openUserDb, checkBackup, BackupError, LEGACY_SETTINGS_KEY } from '../../src/db/userdb.js';
import { createSettings } from '../../src/settings.js';

const fresh = () => new IDBFactory();
let clock = 1_000;
const now = () => ++clock;

function fakeLs(init = {}) {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } };
}

test('схема v1: всички store-ове и индекси от ARCH §4', async () => {
  const idb = fresh();
  const db = await openDb({ name: DB_NAME, migrations: MIGRATIONS, indexedDB: idb });
  assert.equal(db.version, SCHEMA_VERSION);
  assert.deepEqual(db.stores.sort(), [...STORES].sort());
  await db.put('lineProgress', { key: lineKey('italian', 'aaaa0001'), courseId: 'italian', lineId: 'aaaa0001', status: 'learned', due: 5 });
  await db.put('lineProgress', { key: lineKey('italian', 'aaaa0002'), courseId: 'italian', lineId: 'aaaa0002', status: 'new', due: null });
  await db.put('lineProgress', { key: lineKey('slav', 'bbbb0001'), courseId: 'slav', lineId: 'bbbb0001', status: 'learned', due: 9 });
  assert.equal((await db.getAllByIndex('lineProgress', 'courseId', 'italian')).length, 2);
  assert.equal((await db.getAllByIndex('lineProgress', 'status', 'learned')).length, 2);
  const id = await db.put('attempts', { lineKey: 'italian/aaaa0001', ts: 1, mode: 'learn', ok: true });
  assert.equal(typeof id, 'number', 'attempts е с autoIncrement');
  db.close();
});

test('миграциите вървят последователно от старата версия', async () => {
  const idb = fresh();
  const calls = [];
  const m1 = { 1: (db) => { calls.push(1); db.createObjectStore('a', { keyPath: 'k' }); } };
  (await openDb({ name: 'x', migrations: m1, indexedDB: idb })).close();
  const m2 = { ...m1, 2: (db) => { calls.push(2); db.createObjectStore('b', { keyPath: 'k' }); } };
  const db = await openDb({ name: 'x', migrations: m2, indexedDB: idb });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(db.stores.sort(), ['a', 'b']);
  db.close();
  await assert.rejects(openDb({ name: 'y', migrations: { 2: () => {} }, indexedDB: fresh() }), /Липсва миграция към версия 1/);
});

test('tx: грешка в fn прекъсва цялата транзакция', async () => {
  const db = await openDb({ name: DB_NAME, migrations: MIGRATIONS, indexedDB: fresh() });
  await assert.rejects(db.tx(['meta', 'settings'], 'readwrite', (t) => {
    t.store('meta').put({ key: 'a', value: 1 });
    t.store('settings').put({ key: 'b', value: 2 });
    throw new Error('бум');
  }), /бум/);
  assert.equal(await db.count('meta'), 0);
  assert.equal(await db.count('settings'), 0);
  db.close();
});

test('първо пускане: ★ курсовете се избират веднъж (D-017)', async () => {
  const u = await openUserDb({ indexedDB: fresh(), now });
  assert.equal(await u.applyFirstRun(['italian', 'alapin', 'slav']), true);
  assert.deepEqual([...(await u.selectedIds())], ['italian', 'alapin', 'slav']);
  assert.equal(await u.getMeta('suggestedBanner'), true);
  await u.setSelected('alapin', false);
  assert.equal(await u.applyFirstRun(['italian', 'alapin', 'slav']), false, 'второ пускане не връща махнатия курс');
  assert.deepEqual([...(await u.selectedIds())], ['italian', 'slav']);
  u.close();
});

test('избор/махане: махането скрива, повторното добавяне връща реда', async () => {
  const u = await openUserDb({ indexedDB: fresh(), now });
  await u.setSelected('italian', true);
  await u.setSelected('slav', true);
  const before = (await u.listMyCourses()).find((r) => r.courseId === 'italian');
  await u.setSelected('italian', false);
  let rows = await u.listMyCourses();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.courseId === 'italian').hidden, true);
  assert.deepEqual([...(await u.selectedIds())], ['slav']);
  await u.setSelected('italian', true);
  rows = await u.listMyCourses();
  const back = rows.find((r) => r.courseId === 'italian');
  assert.equal(back.hidden, false);
  assert.equal(back.order, before.order);
  assert.equal(back.addedAt, before.addedAt);
  assert.deepEqual(rows.map((r) => r.courseId), ['italian', 'slav']);
  // идемпотентно
  await u.setSelected('slav', true);
  await u.setSelected('nope', false);
  assert.equal((await u.listMyCourses()).length, 2);
  u.close();
});

test('настройки: еднократна миграция от localStorage без загуба', async () => {
  const idb = fresh();
  const ls = fakeLs({ [LEGACY_SETTINGS_KEY]: JSON.stringify({ retention: 0.85, boardOrientation: 'black', newPerDay: 20 }) });
  let u = await openUserDb({ indexedDB: idb, now });
  assert.equal(await u.migrateLegacySettings(ls), 3);
  assert.equal(ls.data[LEGACY_SETTINGS_KEY], undefined, 'старият ключ е изтрит');
  const s = createSettings({ load: () => ({}), save: () => {} });
  const stored = await u.loadSettings();
  const settings = createSettings({ load: () => stored, save: (o) => u.saveSettings(o) });
  assert.equal(settings.get('retention'), 0.85);
  assert.equal(settings.get('boardOrientation'), 'black');
  assert.equal(s.get('retention'), 0.9);
  // запис → ново отваряне
  settings.set('learnStreak', 5);
  settings.set('retention', 0.9); // обратно към подразбирането → не се пази
  await u.flush();
  u.close();
  u = await openUserDb({ indexedDB: idb, now });
  assert.equal(await u.migrateLegacySettings(fakeLs({ [LEGACY_SETTINGS_KEY]: '{"retention":0.7}' })), null, 'само веднъж');
  const again = createSettings({ load: () => ({}), save: () => {} });
  const st2 = await u.loadSettings();
  // отпадналият newPerDay (§6.1) не се пренася при първия запис; retention е по подразбиране
  assert.deepEqual(st2, { boardOrientation: 'black', learnStreak: 5 });
  const s2 = createSettings({ load: () => st2, save: () => {} });
  assert.equal(s2.get('learnStreak'), 5);
  assert.equal(s2.get('boardOrientation'), 'black');
  assert.equal(s2.get('retention'), 0.9);
  assert.equal(again.get('learnStreak'), 3);
  u.close();
});

test('миграция: повреден localStorage и вече записани настройки в IDB', async () => {
  const idb = fresh();
  let u = await openUserDb({ indexedDB: idb, now });
  assert.equal(await u.migrateLegacySettings(fakeLs({ [LEGACY_SETTINGS_KEY]: '{не е json' })), 0);
  u.close();
  const idb2 = fresh();
  u = await openUserDb({ indexedDB: idb2, now });
  await u.saveSettings({ learnStreak: 4 });
  assert.equal(await u.migrateLegacySettings(fakeLs({ [LEGACY_SETTINGS_KEY]: '{"learnStreak":9}' })), 0, 'IDB печели');
  assert.deepEqual(await u.loadSettings(), { learnStreak: 4 });
  assert.equal(await u.migrateLegacySettings(undefined), null);
  u.close();
});

test('бекъп: износ → внос в празна база (round-trip)', async () => {
  const a = await openUserDb({ indexedDB: fresh(), now });
  await a.applyFirstRun(['italian', 'slav']);
  await a.setSelected('slav', false);
  await a.saveSettings({ learnStreak: 4 });
  await a.db.put('lineProgress', { key: 'italian/aaaa0001', courseId: 'italian', lineId: 'aaaa0001', n: 1, status: 'learned', due: 123 });
  await a.db.put('attempts', { lineKey: 'italian/aaaa0001', ts: 5, mode: 'learn', ok: true });
  await a.db.put('daily', { day: '2026-11-26', newLearned: 1, reviews: 0, reviewErrors: 0, plays: 3 });
  const b = JSON.parse(JSON.stringify(await a.exportBackup({ appVersion: '0.2.0', dataVersion: '2026-11-26.1' })));
  assert.equal(b.schemaVersion, SCHEMA_VERSION);
  assert.equal(b.app, 'lrnoldgame');
  assert.equal(b.dataVersion, '2026-11-26.1');
  assert.ok(await a.getMeta('lastBackup'));
  assert.deepEqual(Object.keys(b.stores).sort(), [...STORES].sort());

  const c = await openUserDb({ indexedDB: fresh(), now });
  await c.applyFirstRun(['vs-nf3']);
  const counts = await c.importBackup(b);
  assert.equal(counts.myCourses, 2);
  assert.deepEqual([...(await c.selectedIds())], ['italian']);
  assert.deepEqual(await c.loadSettings(), { learnStreak: 4 });
  assert.equal((await c.progressByCourse('italian'))[0].due, 123);
  assert.equal(await c.db.count('attempts'), 1);
  assert.equal(await c.db.count('daily'), 1);
  assert.equal(await c.applyFirstRun(['vs-nf3']), false);
  const noAtt = await a.exportBackup({ withAttempts: false });
  assert.deepEqual(noAtt.stores.attempts, []);
  a.close(); c.close();
});

test('бекъп: проверки на файла (schemaVersion, формат)', async () => {
  const ok = { app: 'lrnoldgame', kind: 'backup', schemaVersion: 1, stores: { meta: [] } };
  assert.deepEqual(checkBackup(ok), { meta: 0 });
  const bad = [
    null, [], {}, { ...ok, app: 'other' },
    { ...ok, schemaVersion: 0 }, { ...ok, schemaVersion: '1' }, { ...ok, schemaVersion: SCHEMA_VERSION + 1 },
    { ...ok, stores: null }, { ...ok, stores: { junk: [] } }, { ...ok, stores: { meta: {} } },
    { ...ok, stores: { myCourses: [{ addedAt: 1 }] } }, { ...ok, stores: { settings: [null] } },
  ];
  for (const b of bad) assert.throws(() => checkBackup(b), BackupError, JSON.stringify(b));
  assert.throws(() => checkBackup({ ...ok, schemaVersion: 99 }), /по-нова версия/);
  // неуспешен внос не пипа данните
  const u = await openUserDb({ indexedDB: fresh(), now });
  await u.setSelected('italian', true);
  await assert.rejects(u.importBackup({ ...ok, stores: { myCourses: [{}] } }), BackupError);
  assert.deepEqual([...(await u.selectedIds())], ['italian']);
  u.close();
});
