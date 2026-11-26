// T-028: фигурна нотация (D-036), оценка на позицията (D-035) и полето ev в данните.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanTokens, moveItems, normalizeEv, evalAt, formatEval, evalLeader } from '../../src/chess/notation.js';
import { normalizeCourse } from '../../src/data/courseStore.js';
import { SETTINGS_SCHEMA, getDef } from '../../src/settings.js';

const FIX = JSON.parse(readFileSync(new URL('../fixtures/ev-italian.json', import.meta.url), 'utf8'));

test('sanTokens: фигура в началото и при промоция; пешки и рокада без фигурка', () => {
  assert.deepEqual(sanTokens('Nf3'), [{ piece: 'n', letter: 'N' }, 'f3']);
  assert.deepEqual(sanTokens('Qxd4+'), [{ piece: 'q', letter: 'Q' }, 'xd4+']);
  assert.deepEqual(sanTokens('Kg1'), [{ piece: 'k', letter: 'K' }, 'g1']);
  assert.deepEqual(sanTokens('Rae1'), [{ piece: 'r', letter: 'R' }, 'ae1']);
  assert.deepEqual(sanTokens('Bb5#'), [{ piece: 'b', letter: 'B' }, 'b5#']);
  assert.deepEqual(sanTokens('e4'), ['e4']);
  assert.deepEqual(sanTokens('exd5'), ['exd5']);
  assert.deepEqual(sanTokens('O-O'), ['O-O']);
  assert.deepEqual(sanTokens('O-O-O+'), ['O-O-O+']);
  assert.deepEqual(sanTokens('e8=Q'), ['e8=', { piece: 'q', letter: 'Q' }]);
  assert.deepEqual(sanTokens('bxa1=N+'), ['bxa1=', { piece: 'n', letter: 'N' }, '+']);
  // текстът се запазва (буквата е в letter)
  for (const s of ['Nf3', 'e8=Q', 'bxa1=N+', 'O-O']) {
    assert.equal(sanTokens(s).map((t) => (typeof t === 'string' ? t : t.letter)).join(''), s);
  }
});

test('moveItems: номера като formatMoves, цвят по полухода', () => {
  const { items, more } = moveItems(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], { from: 1, max: 3 });
  assert.deepEqual(items.map((i) => `${i.num}${i.san}:${i.color}`), ['1...e5:b', '2.Nf3:w', 'Nc6:b']);
  assert.equal(more, true);
  assert.equal(moveItems(['e4']).more, false);
});

test('formatEval: от гледна точка на белите, със знак и запетая; мат „#n“', () => {
  assert.equal(formatEval(80), '+0,8');
  assert.equal(formatEval(-36), '−0,4');
  assert.equal(formatEval(0), '0,0');
  assert.equal(formatEval(4), '0,0');
  assert.equal(formatEval(-4), '0,0');
  assert.equal(formatEval(122), '+1,2');
  assert.equal(formatEval(1234), '+12');
  assert.equal(formatEval(-1000), '−10');
  assert.equal(formatEval('#3'), '#3');
  assert.equal(formatEval('#-2'), '#−2');
  assert.equal(formatEval(null), '');
  assert.equal(formatEval(undefined), '');
  assert.equal(formatEval('abc'), '');
  assert.equal(evalLeader(80), 'w');
  assert.equal(evalLeader(-80), 'b');
  assert.equal(evalLeader(2), '');
  assert.equal(evalLeader('#-1'), 'b');
  assert.equal(evalLeader('#4'), 'w');
  assert.equal(evalLeader(null), '');
});

test('ev: валиден масив с дължината на ходовете; иначе null (без грешка)', () => {
  assert.deepEqual(normalizeEv([20, -15, null, '#3', '#-2'], 5), [20, -15, null, '#3', '#-2']);
  assert.deepEqual(normalizeEv([20.4, 'x', {}], 3), [20, null, null]);
  assert.equal(normalizeEv([1, 2], 3), null, 'грешна дължина');
  assert.equal(normalizeEv(undefined, 3), null, 'липсва');
  assert.equal(normalizeEv('20', 1), null);
  const ev = [10, 20, 30];
  assert.equal(evalAt(ev, 0), null, 'преди първия ход');
  assert.equal(evalAt(ev, 1), 10);
  assert.equal(evalAt(ev, 3), 30);
  assert.equal(evalAt(ev, 4), null);
  assert.equal(evalAt(null, 2), null);
});

test('fixture tests/fixtures/ev-italian.json: ev има дължината на m за всяка линия; normalizeCourse го пази', () => {
  assert.ok(FIX.lines.length > 0);
  for (const l of FIX.lines) assert.equal(l.ev.length, l.m.length, l.id);
  const c = normalizeCourse(FIX);
  for (const l of c.lines) assert.ok(Array.isArray(l.ev), l.id);
  assert.ok(c.lines.some((l) => l.ev.some((v) => typeof v === 'string')), 'има и мат/низ или поне една стойност #n');
  // без ev — null
  const real = JSON.parse(readFileSync(new URL('../../data/courses/italian.json', import.meta.url), 'utf8'));
  const stripped = { ...real, lines: real.lines.map(({ ev, ...l }) => l) };
  for (const l of normalizeCourse(stripped).lines) assert.equal(l.ev, null);
});

test('параметър showEval в „Настройки → Дъска“ (да/не, подразбиране да)', () => {
  const d = getDef('showEval');
  assert.equal(d.type, 'bool');
  assert.equal(d.default, true);
  assert.equal(d.group, 'board');
  assert.equal(d.label, 'Показвай оценката');
  assert.ok(SETTINGS_SCHEMA.includes(d));
});
