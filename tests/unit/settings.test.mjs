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

test('подразбиращи се стойности от ARCH_T-014 §6.1', () => {
  assert.deepEqual(defaults(), {
    learnStreak: 3, newLinesPerDay: 5, onError: 'continue', errorPauseMs: 1200,
    hintResetsStreak: true, autoPlayStart: false, hintAfterSec: 0,
    retention: 0.9, maxReviewsPerDay: 50, relearnStreak: 1, hardAfterSec: 15, dayStartHour: 4,
    opponentDelayMs: 400, wrongMoveMs: 500, boardOrientation: 'auto', animationMs: 300,
    backupReminderDays: 14,
  });
  assert.deepEqual(SETTINGS_GROUPS.map(([g]) => g), ['learn', 'review', 'board', 'data']);
  // Отпаднали (§6.1): без миграция.
  assert.equal(getDef('newPerDay'), undefined);
  assert.equal(getDef('opponentMinShare'), undefined);
});

test('bool и стъпка 100', () => {
  const s = createSettings(memoryStorage());
  assert.equal(s.set('autoPlayStart', 'true'), true);
  assert.equal(s.set('hintResetsStreak', false), false);
  assert.equal(s.set('hintResetsStreak', 'x'), true);
  assert.equal(s.set('errorPauseMs', 1234), 1200);
  assert.equal(s.set('opponentDelayMs', 99999), 3000);
  assert.equal(s.set('onError', 'restart'), 'restart');
});

test('нов обект с настройки връща подразбиранията', () => {
  const s = createSettings(memoryStorage());
  assert.deepEqual(s.getAll(), defaults());
  assert.equal(s.get('newLinesPerDay'), 5);
});

test('числата се притискат до границите', () => {
  const s = createSettings(memoryStorage());
  const def = getDef('newLinesPerDay');
  assert.equal(s.set('newLinesPerDay', 1000), def.max);
  assert.equal(s.set('newLinesPerDay', -5), def.min);
  assert.equal(s.set('retention', 2), 0.99);
  assert.equal(s.set('retention', 0.1), 0.7);
  assert.equal(s.set('hardAfterSec', 1), 3);
});

test('закръгляне: int към цяло, number по стъпката', () => {
  const s = createSettings(memoryStorage());
  assert.equal(s.set('newLinesPerDay', 12.6), 13);
  assert.equal(s.set('newLinesPerDay', '7'), 7);
  assert.equal(s.set('retention', 0.876), 0.88);
  assert.equal(s.set('retention', '0,85'), 0.85);
  assert.equal(s.set('animationMs', 330), 350);
});

test('невалидни стойности дават подразбирането', () => {
  const s = createSettings(memoryStorage());
  assert.equal(s.set('newLinesPerDay', 'абв'), 5);
  assert.equal(s.set('newLinesPerDay', ''), 5);
  assert.equal(s.set('newLinesPerDay', null), 5);
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
  a.set('newLinesPerDay', 25);
  a.set('boardOrientation', 'white');
  assert.deepEqual(store.load(), { newLinesPerDay: 25, boardOrientation: 'white' });
  const b = createSettings(store);
  assert.equal(b.get('newLinesPerDay'), 25);
  assert.equal(b.get('boardOrientation'), 'white');

  // Повредени/извън границите данни в хранилището → нормализирани, непознати ключове се пренебрегват.
  const c = createSettings(memoryStorage({ newLinesPerDay: 9999, retention: 'x', junk: 1 }));
  assert.equal(c.get('newLinesPerDay'), 50);
  assert.equal(c.get('retention'), 0.9);
  assert.equal('junk' in c.getAll(), false);
});

test('reset връща подразбиранията и изчиства хранилището', () => {
  const store = memoryStorage();
  const s = createSettings(store);
  s.set('newLinesPerDay', 30);
  s.set('retention', 0.8);
  s.reset('retention');
  assert.equal(s.get('retention'), 0.9);
  assert.deepEqual(store.load(), { newLinesPerDay: 30 });
  s.reset();
  assert.deepEqual(s.getAll(), defaults());
  assert.deepEqual(store.load(), {});
});

test('onChange се вика само при реална промяна', () => {
  const s = createSettings(memoryStorage());
  const calls = [];
  const off = s.onChange((k, v) => calls.push([k, v]));
  s.set('newLinesPerDay', 5); // същата стойност
  s.set('newLinesPerDay', 11);
  off();
  s.set('newLinesPerDay', 12);
  assert.deepEqual(calls, [['newLinesPerDay', 11]]);
});

test('localStorageBackend понася повреден JSON и липсващо хранилище', () => {
  const fake = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  fake.data.x = '{не е json';
  assert.deepEqual(localStorageBackend('x', fake).load(), {});
  const be = localStorageBackend('y', fake);
  be.save({ newLinesPerDay: 3 });
  assert.deepEqual(be.load(), { newLinesPerDay: 3 });
  assert.deepEqual(localStorageBackend('z', undefined).load(), {});
});
