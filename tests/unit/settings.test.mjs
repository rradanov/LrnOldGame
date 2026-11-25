import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_SCHEMA, SETTINGS_GROUPS, defaults, getDef, normalize,
  createSettings, memoryStorage, localStorageBackend,
} from '../../src/settings.js';

test('схемата е пълна и подразбиранията са в границите', () => {
  const keys = new Set();
  const groups = new Set(SETTINGS_GROUPS.map(([g]) => g));
  for (const d of SETTINGS_SCHEMA) {
    assert.ok(d.key && !keys.has(d.key), `уникален ключ ${d.key}`);
    keys.add(d.key);
    assert.ok(['int', 'number', 'enum', 'bool'].includes(d.type), `тип на ${d.key}`);
    assert.ok(typeof d.label === 'string' && /[а-яА-Я]/.test(d.label), `БГ етикет на ${d.key}`);
    assert.ok(groups.has(d.group), `група на ${d.key}`);
    if (d.type === 'int' || d.type === 'number') {
      assert.ok(Number.isFinite(d.min) && Number.isFinite(d.max) && d.min < d.max, `граници на ${d.key}`);
      assert.ok(d.default >= d.min && d.default <= d.max, `подразбиране в границите: ${d.key}`);
    }
    if (d.type === 'int') assert.ok(Number.isInteger(d.default));
    if (d.type === 'enum') assert.ok(d.options.some(([v]) => v === d.default));
    assert.equal(normalize(d, d.default), d.default, `подразбирането е нормализирано: ${d.key}`);
  }
});

test('подразбиращи се стойности от ARCH', () => {
  const d = defaults();
  assert.equal(d.newPerDay, 10);
  assert.equal(d.retention, 0.9);
  assert.equal(d.opponentMinShare, 5);
  assert.equal(d.hardAfterSec, 15);
  assert.equal(d.backupReminderDays, 14);
  assert.equal(d.boardOrientation, 'auto');
});

test('нов обект с настройки връща подразбиранията', () => {
  const s = createSettings(memoryStorage());
  assert.deepEqual(s.getAll(), defaults());
  assert.equal(s.get('newPerDay'), 10);
});

test('числата се притискат до границите', () => {
  const s = createSettings(memoryStorage());
  const def = getDef('newPerDay');
  assert.equal(s.set('newPerDay', 1000), def.max);
  assert.equal(s.set('newPerDay', -5), def.min);
  assert.equal(s.set('retention', 2), 0.99);
  assert.equal(s.set('retention', 0.1), 0.7);
  assert.equal(s.set('hardAfterSec', 1), 3);
});

test('закръгляне: int към цяло, number по стъпката', () => {
  const s = createSettings(memoryStorage());
  assert.equal(s.set('newPerDay', 12.6), 13);
  assert.equal(s.set('newPerDay', '7'), 7);
  assert.equal(s.set('retention', 0.876), 0.88);
  assert.equal(s.set('retention', '0,85'), 0.85);
  assert.equal(s.set('animationMs', 330), 350);
});

test('невалидни стойности дават подразбирането', () => {
  const s = createSettings(memoryStorage());
  assert.equal(s.set('newPerDay', 'абв'), 10);
  assert.equal(s.set('newPerDay', ''), 10);
  assert.equal(s.set('newPerDay', null), 10);
  assert.equal(s.set('retention', NaN), 0.9);
  assert.equal(s.set('boardOrientation', 'sideways'), 'auto');
  assert.equal(s.set('boardOrientation', 'black'), 'black');
});

test('непознат ключ хвърля грешка', () => {
  const s = createSettings(memoryStorage());
  assert.throws(() => s.get('nope'), RangeError);
  assert.throws(() => s.set('nope', 1), RangeError);
});

test('записът оцелява в хранилището и се нормализира при четене', () => {
  const store = memoryStorage();
  const a = createSettings(store);
  a.set('newPerDay', 25);
  a.set('boardOrientation', 'white');
  assert.deepEqual(store.load(), { newPerDay: 25, boardOrientation: 'white' });
  const b = createSettings(store);
  assert.equal(b.get('newPerDay'), 25);
  assert.equal(b.get('boardOrientation'), 'white');

  // Повредени/извън границите данни в хранилището → нормализирани, непознати ключове се пренебрегват.
  const c = createSettings(memoryStorage({ newPerDay: 9999, retention: 'x', junk: 1 }));
  assert.equal(c.get('newPerDay'), 100);
  assert.equal(c.get('retention'), 0.9);
  assert.equal('junk' in c.getAll(), false);
});

test('reset връща подразбиранията и изчиства хранилището', () => {
  const store = memoryStorage();
  const s = createSettings(store);
  s.set('newPerDay', 30);
  s.set('retention', 0.8);
  s.reset('retention');
  assert.equal(s.get('retention'), 0.9);
  assert.deepEqual(store.load(), { newPerDay: 30 });
  s.reset();
  assert.deepEqual(s.getAll(), defaults());
  assert.deepEqual(store.load(), {});
});

test('onChange се вика само при реална промяна', () => {
  const s = createSettings(memoryStorage());
  const calls = [];
  const off = s.onChange((k, v) => calls.push([k, v]));
  s.set('newPerDay', 10); // същата стойност
  s.set('newPerDay', 11);
  off();
  s.set('newPerDay', 12);
  assert.deepEqual(calls, [['newPerDay', 11]]);
});

test('localStorageBackend понася повреден JSON и липсващо хранилище', () => {
  const fake = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  fake.data.x = '{не е json';
  assert.deepEqual(localStorageBackend('x', fake).load(), {});
  const be = localStorageBackend('y', fake);
  be.save({ newPerDay: 3 });
  assert.deepEqual(be.load(), { newPerDay: 3 });
  assert.deepEqual(localStorageBackend('z', undefined).load(), {});
});
