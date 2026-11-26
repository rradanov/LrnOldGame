// T-026 / D-032: взети фигури и материално предимство — src/chess/material.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { material, countPieces, DEFAULT_VALUES } from '../../src/chess/material.js';
import { START_FEN, applySans } from '../../src/chess/position.js';
import { defaults, getDef } from '../../src/settings.js';

const none = { p: 0, n: 0, b: 0, r: 0, q: 0 };
const fenAfter = (sans) => applySans(sans).fen;

test('начална позиция: нищо не е взето, разлика 0 → няма „+N“', () => {
  const m = material(START_FEN);
  assert.deepEqual(m.captured, { w: none, b: none });
  assert.deepEqual(m.score, { w: 39, b: 39 });
  assert.equal(m.diff, 0);
  assert.equal(m.leader, null);
  assert.equal(m.plus, 0);
});

test('размяна (пешка срещу пешка) → и двете страни са взели по пешка, разлика 0', () => {
  // 1.e4 d5 2.exd5 Qxd5
  const m = material(fenAfter(['e4', 'd5', 'exd5', 'Qxd5']));
  assert.deepEqual(m.captured.w, { ...none, p: 1 });
  assert.deepEqual(m.captured.b, { ...none, p: 1 });
  assert.equal(m.diff, 0);
  assert.equal(m.leader, null);
});

test('спечелена фигура: белите са взели кон → +3 за белите', () => {
  const m = material('rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.deepEqual(m.captured.w, { ...none, n: 1 });
  assert.deepEqual(m.captured.b, none);
  assert.equal(m.leader, 'w');
  assert.equal(m.plus, 3);
});

test('черните напред: взели топ и пешка срещу кон → +3 за черните', () => {
  // белите: без топ a1 и пешка a2; черните: без кон b8
  const m = material('r1bqkbnr/pppppppp/8/8/8/8/1PPPPPPP/1NBQKBNR w Kkq - 0 1');
  assert.deepEqual(m.captured.b, { ...none, p: 1, r: 1 });
  assert.deepEqual(m.captured.w, { ...none, n: 1 });
  assert.equal(m.diff, 3 - 6);
  assert.equal(m.leader, 'b');
  assert.equal(m.plus, 3);
});

test('промоция: пешката изчезва, новата фигура се брои; пешката не е „взета“', () => {
  // белите: 7 пешки и 2 дами (a-пешката стана дама на a8); черните: без кон b8 и без a-пешка
  const fen = 'Q1bqkbnr/rppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w - - 0 1';
  const c = countPieces(fen);
  assert.equal(c.w.q, 2);
  assert.equal(c.w.p, 7);
  const m = material(fen);
  assert.deepEqual(m.captured.w, { ...none, p: 1, n: 1 });
  // черните не са взели нищо: липсващата бяла пешка е станала дама
  assert.deepEqual(m.captured.b, none);
  assert.equal(m.score.w, 7 + 6 + 6 + 10 + 18);
  assert.equal(m.score.b, 7 + 3 + 6 + 10 + 9);
  assert.equal(m.leader, 'w');
  assert.equal(m.plus, 12);
});

test('промоция в кон (слаба промоция) и взета промотирана фигура', () => {
  // черните: 7 пешки + 3 коня (промоция в кон); белите: всичко на място
  let m = material('rnbqkbnr/ppppppp1/8/8/8/8/PPPPPPPP/RNBQKBnR w - - 0 1');
  // на g1 стои черен кон (белият кон g1 е взет при промоцията)
  assert.deepEqual(m.captured.b, { ...none, n: 1 });
  assert.deepEqual(m.captured.w, none);
  assert.equal(m.score.b, 39 - 1 + 3);
  // белите вземат промотирания кон: черните остават с 7 пешки и 2 коня → липсва една пешка (взета)
  m = material('rnbqkbnr/ppppppp1/8/8/8/8/PPPPPPPP/RNBQKB1R w - - 0 1');
  assert.deepEqual(m.captured.w, { ...none, p: 1 });
});

test('стойностите идват от параметрите; всички 0 → разлика 0', () => {
  const fen = 'rnbqkb1r/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(material(fen, { p: 1, n: 4, b: 3, r: 5, q: 8 }).plus, 4);
  const zero = material(fen, { p: 0, n: 0, b: 0, r: 0, q: 0 });
  assert.equal(zero.plus, 0);
  assert.equal(zero.leader, null);
  assert.deepEqual(zero.captured.w, { ...none, n: 1 }); // взетите фигури се показват и без разлика
});

test('позиция по-късно в линия: след вземане и обратно връщане (стъпка назад) резултатът следва позицията', () => {
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6'];
  assert.equal(material(fenAfter(sans.slice(0, 7))).leader, 'w');
  assert.equal(material(fenAfter(sans.slice(0, 7))).plus, 3);
  assert.equal(material(fenAfter(sans)).plus, 0);
  assert.deepEqual(material(fenAfter(sans)).captured, { w: { ...none, n: 1 }, b: { ...none, b: 1 } });
  assert.equal(material(fenAfter(sans.slice(0, 6))).plus, 0);
});

test('параметри в „Настройки → Дъска“: стойности 1/3/3/5/9 (0–20) и „Показвай взетите фигури“', () => {
  const d = defaults();
  assert.deepEqual([d.valuePawn, d.valueKnight, d.valueBishop, d.valueRook, d.valueQueen], [1, 3, 3, 5, 9]);
  assert.deepEqual(DEFAULT_VALUES, { p: 1, n: 3, b: 3, r: 5, q: 9 });
  for (const k of ['valuePawn', 'valueKnight', 'valueBishop', 'valueRook', 'valueQueen']) {
    const def = getDef(k);
    assert.equal(def.group, 'board');
    assert.equal(def.min, 0);
    assert.equal(def.max, 20);
  }
  assert.equal(d.showCaptured, true);
  assert.equal(getDef('showCaptured').group, 'board');
});
