// T-030 (D-038, вариант F): рокада и предимство в генератора на линии — с фалшивия двигател
// (memoryEvaluator) и синтетично дърво. Таблицата на двигателя е {"ходове": [[san, cp], …]};
// cp е от гледна точка на страната на ход; първите 3 реда са MultiPV, останалите се виждат само
// при търсене със searchmove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeMoves } from '../../src/chess/position.js';
import { loadOpenings } from '../../tools/validate-data/openings.js';
import { validateCourse } from '../../tools/validate-data/validate.js';
import { generateCourse, hasCastled } from '../../tools/build-courses/generate.js';
import { buildNameIndex } from '../../tools/build-courses/names.js';
import { loadConfigFile, resolveConfig, inputsToOverrides } from '../../tools/build-courses/config.js';
import { treeFromGames, memoryEvaluator, TEST_PARAMS } from './helpers/courses-helpers.mjs';

const openings = loadOpenings();
const names = buildNameIndex(openings);
const S = (text) => tokenizeMoves(text);

async function gen({ side = 'w', start = '', book = [], params = {}, tree, table = {} }) {
  const evaluator = memoryEvaluator(table, { tree });
  const r = await generateCourse({
    courseId: 'test', side, startSans: S(start), bookLines: book.map(S),
    params: { ...TEST_PARAMS, ...params }, tree, evaluator, names,
  });
  return { ...r, evaluator };
}

function checkValid(side, start, lines) {
  const res = validateCourse({ v: 1, id: 'test', side, dataVersion: '2026-11-27.1', start: S(start), lines }, { openings });
  assert.deepEqual(res.errors, []);
  for (const l of lines) {
    assert.equal(l.ev.length, l.m.length, `ev за всеки ход (n=${l.n})`);
    assert.ok(l.ev.every((v) => v !== null), `ev без null (n=${l.n})`);
  }
}

const sm = (calls) => calls.filter((c) => c.includes('|sm:'));

test('hasCastled: само рокада на моята страна', () => {
  const m = S('e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6');
  assert.equal(hasCastled(m, 'w'), true);
  assert.equal(hasCastled(m, 'b'), false);
  assert.equal(hasCastled(S('e4 e5 Nf3 Nc6 Bc4 Bc5 d3 O-O'), 'b'), true);
  assert.equal(hasCastled(S('d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Qc2 c5 O-O-O'), 'w'), true);
});

test('рокада в рамките на castleBonusCp: извън MultiPV → searchmove; над толеранса — не; 0 — изключено; book е с приоритет', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6', 50], ['e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6', 30]]);
  const before = 'e4 e5 Nf3 Nc6 Bc4 Bc5';
  const P = { linesPerCourse: 1, maxPly: 8, castleBonusCp: 50 };
  // O-O е 4-ти ред (не е в MultiPV): 30 − (−15) = 45 ≤ 50 → рокада
  let r = await gen({ start: 'e4 e5', tree, params: P, table: { [before]: [['c3', 30], ['d3', 20], ['Nc3', 10], ['O-O', -15]] } });
  let l = r.lines[0];
  assert.equal(l.m[6], 'O-O');
  assert.equal(r.stats.myMoves.castle, 1);
  assert.equal(r.stats.castleEvals, 1);
  assert.equal(sm(r.evaluator.calls).length, 1);
  assert.equal(r.stats.castledLines, 1);
  checkValid('w', '1. e4 e5', r.lines);
  // 30 − (−25) = 55 > 50 → популярният ход от дървото (c3)
  r = await gen({ start: 'e4 e5', tree, params: P, table: { [before]: [['c3', 30], ['d3', 20], ['Nc3', 10], ['O-O', -25]] } });
  assert.equal(r.lines[0].m[6], 'c3');
  assert.equal(r.stats.myMoves.castle, 0);
  // рокадата е в MultiPV → без допълнително търсене; предпочетена пред по-популярния c3
  r = await gen({ start: 'e4 e5', tree, params: P, table: { [before]: [['c3', 30], ['O-O', 25], ['d3', 20]] } });
  assert.equal(r.lines[0].m[6], 'O-O');
  assert.equal(r.stats.castleEvals, 0);
  assert.equal(sm(r.evaluator.calls).length, 0);
  // castleBonusCp 0 → старото поведение
  r = await gen({ start: 'e4 e5', tree, params: { ...P, castleBonusCp: 0 }, table: { [before]: [['c3', 30], ['O-O', 25], ['d3', 20]] } });
  assert.equal(r.lines[0].m[6], 'c3');
  // book ходът е преди рокадата
  r = await gen({ start: 'e4 e5', tree, book: ['e4 e5 Nf3 Nc6 Bc4 Bc5 d3'], params: P, table: { [before]: [['c3', 30], ['O-O', 25], ['d3', 20]] } });
  assert.equal(r.lines[0].m[6], 'd3');
  assert.equal(r.stats.myMoves.castle, 0);
});

test('край на белите според рокадата: advCpWhite след рокада, advCpWhiteNoCastle без', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 d6 c3 a6', 50]]);
  const P = { linesPerCourse: 1, advCpWhite: 150, advCpWhiteNoCastle: 220 };
  const t = { 'e4 e5': [['Nf3', 160]], 'e4 e5 Nf3 Nc6': [['Bc4', 160]], 'e4 e5 Nf3 Nc6 Bc4 Bc5': [['O-O', 160]] };
  // 160 без рокада < 220 → продължава; след 4.O-O 160 ≥ 150 → adv
  let r = await gen({ start: 'e4 e5', tree, params: P, table: t });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].m[6], r.lines[0].end, r.lines[0].cp], [7, 'O-O', 'adv', 160]);
  checkValid('w', '1. e4 e5', r.lines);
  // 230 без рокада ≥ 220 → adv още на 2.Nf3
  r = await gen({ start: 'e4 e5', tree, params: P, table: { ...t, 'e4 e5': [['Nf3', 230]] } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [3, 'adv']);
  // advCpWhiteNoCastle 0 = като advCpWhite → 160 ≥ 150 спира на 2.Nf3
  r = await gen({ start: 'e4 e5', tree, params: { ...P, advCpWhiteNoCastle: 0 }, table: t });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [3, 'adv']);
  // след рокада, но под 150 → не е adv
  r = await gen({ start: 'e4 e5', tree, params: { ...P, maxPly: 9 }, table: { ...t, 'e4 e5 Nf3 Nc6 Bc4 Bc5': [['O-O', 140]] } });
  assert.equal(r.lines[0].end, 'depth');
});

test('край на черните според рокадата: equal (≥ 0 стабилно) и adv ≥ 60 само след рокада; без рокада adv ≥ 150', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 O-O O-O d6 h3 a6', 50]]);
  const P = { linesPerCourse: 1, advCpBlack: 60, advCpBlackNoCastle: 150, equalCpBlack: 0, minPlyBlack: 4, equalNeedsCastle: true };
  // всичко 10 (стабилно ≥ 0) — без рокада не е equal; след 5...O-O (10 полухода) → equal
  const eq = { e4: [['e5', 10]], 'e4 e5 Nf3': [['Nc6', 10]], 'e4 e5 Nf3 Nc6 Bc4': [['Bc5', 10]], 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3': [['Nf6', 10]], 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3': [['O-O', 10]] };
  let r = await gen({ side: 'b', start: 'e4', tree, params: P, table: eq });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].m[9], r.lines[0].end], [10, 'O-O', 'equal']);
  checkValid('b', '1. e4', r.lines);
  // equalNeedsCastle false → старото правило: equal на 4-ия полуход
  r = await gen({ side: 'b', start: 'e4', tree, params: { ...P, equalNeedsCastle: false }, table: eq });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [4, 'equal']);
  // 70 без рокада < 150 → продължава; след рокадата 70 ≥ 60 → adv (преди equal)
  const t70 = Object.fromEntries(Object.entries(eq).map(([k, v]) => [k, [[v[0][0], 70]]]));
  r = await gen({ side: 'b', start: 'e4', tree, params: P, table: t70 });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end, r.lines[0].cp], [10, 'adv', 70]);
  // 160 без рокада ≥ 150 → adv още на 1...e5
  r = await gen({ side: 'b', start: 'e4', tree, params: P, table: { ...eq, e4: [['e5', 160]] } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [2, 'adv']);
  // рокада, но не стабилно (предишният ми ход < 0) → не е equal веднага
  r = await gen({ side: 'b', start: 'e4', tree, params: { ...P, maxPly: 12 }, table: { ...eq, 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3': [['Nf6', -10]] } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [12, 'equal']);
});

test('опашка: противникът играе типичния ход от дървото, ако губи ≤ tailOppMaxLossCp; иначе най-добрия; tail и ev', async () => {
  // след 3.Bc4 позицията има 5 партии (< oppMinGames 6) → опашка; най-честият ход там е 3...Nf6 (3)
  const tree = treeFromGames([['e4 e5 Nf3 Nc6', 50], ['e4 e5 Nf3 Nc6 Bc4 Nf6', 3], ['e4 e5 Nf3 Nc6 Bc4 Bc5', 2]]);
  const pos = 'e4 e5 Nf3 Nc6 Bc4';
  const P = { linesPerCourse: 1, oppMinGames: 6, tailMaxPly: 8, tailOppMinGames: 4, tailOppMaxLossCp: 100 };
  // 3...Nf6 губи 40 ≤ 100 → Nf6 (типичен, ≠ най-добрия)
  let r = await gen({ start: 'e4 e5', tree, params: P, table: { 'e4 e5 Nf3 Nc6': [['Bc4', 20]], [pos]: [['Bc5', 0], ['d6', -20], ['h6', -30], ['Nf6', -40]] } });
  let l = r.lines[0];
  assert.deepEqual([l.m[5], l.tail, l.end, l.m.length], ['Nf6', 5, 'depth', 7]);
  assert.equal(r.stats.typicalEvals, 1);
  assert.deepEqual([r.stats.tailOppPlies, r.stats.tailTypicalPlies, r.stats.tailTypicalSwaps], [1, 1, 1]);
  checkValid('w', '1. e4 e5', r.lines);
  // 3...Nf6 губи 150 > 100 → най-добрият 3...Bc5
  r = await gen({ start: 'e4 e5', tree, params: P, table: { 'e4 e5 Nf3 Nc6': [['Bc4', 20]], [pos]: [['Bc5', 0], ['d6', -20], ['h6', -30], ['Nf6', -150]] } });
  l = r.lines[0];
  assert.deepEqual([l.m[5], l.tail], ['Bc5', 5]);
  assert.deepEqual([r.stats.tailOppPlies, r.stats.tailTypicalPlies, r.stats.tailTypicalSwaps], [1, 0, 0]);
  checkValid('w', '1. e4 e5', r.lines);
  // типичният е и най-добрият → без допълнително търсене, броим го като типичен
  r = await gen({ start: 'e4 e5', tree, params: P, table: { 'e4 e5 Nf3 Nc6': [['Bc4', 20]], [pos]: [['Nf6', 0], ['Bc5', -5]] } });
  assert.deepEqual([r.lines[0].m[5], r.stats.typicalEvals, r.stats.tailTypicalPlies, r.stats.tailTypicalSwaps], ['Nf6', 0, 1, 0]);
  // позиция под tailOppMinGames (5 < 6) → най-добрият; tailOppMinGames 0 → изключено
  for (const tailOppMinGames of [6, 0]) {
    r = await gen({ start: 'e4 e5', tree, params: { ...P, tailOppMinGames }, table: { 'e4 e5 Nf3 Nc6': [['Bc4', 20]], [pos]: [['Bc5', 0], ['Nf6', -40]] } });
    assert.equal(r.lines[0].m[5], 'Bc5');
    assert.equal(r.stats.typicalEvals, 0);
  }
});

test('слабите линии (depth/data под weakCp) се заменят със следващите по вероятност; допълване от резерва', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6 Bb5', 60], ['e4 e5 Nf3 d6 d4', 30], ['e4 e5 Nf3 Nf6 Nxe5', 10]]);
  const table = { 'e4 e5 Nf3 Nc6': [['Bb5', 10]], 'e4 e5 Nf3 d6': [['d4', 90]], 'e4 e5 Nf3 Nf6': [['Nxe5', 95]] };
  const P = { maxPly: 4, rejectWeak: true, weakCpWhite: 80 };
  const ends = (r) => r.lines.map((l) => `${l.m[3]}:${l.end}:${l.cp}`);
  // 2 линии: Nc6 (p 0,6, cp 10 < 80) отива в резерв → d6 и Nf6
  let r = await gen({ start: 'e4 e5', tree, table, params: { ...P, linesPerCourse: 2 } });
  assert.deepEqual(ends(r), ['d6:depth:90', 'Nf6:depth:95']);
  assert.deepEqual([r.stats.rejected, r.stats.refilled], [1, 0]);
  assert.deepEqual(r.lines.map((l) => l.n), [1, 2]);
  checkValid('w', '1. e4 e5', r.lines);
  // 3 линии: заместител няма → слабата се връща от резерва; редът е по p (n=1 е Nc6)
  r = await gen({ start: 'e4 e5', tree, table, params: { ...P, linesPerCourse: 3 } });
  assert.deepEqual(ends(r), ['Nc6:depth:10', 'd6:depth:90', 'Nf6:depth:95']);
  assert.deepEqual([r.stats.rejected, r.stats.refilled], [1, 1]);
  assert.match(r.stats.warnings.join('\n'), /под прага за слаба линия/);
  checkValid('w', '1. e4 e5', r.lines);
  // rejectWeak false → старото поведение (най-вероятните)
  r = await gen({ start: 'e4 e5', tree, table, params: { ...P, rejectWeak: false, linesPerCourse: 2 } });
  assert.deepEqual(ends(r), ['Nc6:depth:10', 'd6:depth:90']);
  // черни: праг weakCpBlack (−25) — −30 се заменя, −20 остава
  const tb = treeFromGames([['e4 e5 Nf3 Nc6', 60], ['e4 e5 Bc4 Nf6', 40]]);
  r = await gen({
    side: 'b', start: 'e4', tree: tb, params: { maxPly: 3, rejectWeak: true, weakCpBlack: -25, linesPerCourse: 1 },
    table: { 'e4 e5 Nf3': [['Nc6', -30]], 'e4 e5 Bc4': [['Nf6', -20]] },
  });
  assert.deepEqual(r.lines.map((l) => `${l.m[3]}:${l.cp}`), ['Nf6:-20']);
  checkValid('b', '1. e4', r.lines);
});

test('конфиг и схема: новите параметри се проверяват и минават през overrides', () => {
  const base = loadConfigFile();
  const c = resolveConfig(base, inputsToOverrides({ overrides: { lines: { castleBonusCp: 0, rejectWeak: false, tailOppMinGames: 0 } } }));
  assert.deepEqual([c.lines.castleBonusCp, c.lines.rejectWeak, c.lines.tailOppMinGames], [0, false, 0]);
  assert.throws(() => resolveConfig(base, inputsToOverrides({ overrides: { lines: { castleBonusCp: 500 } } })), /castleBonusCp/);
  assert.throws(() => resolveConfig(base, inputsToOverrides({ overrides: { lines: { equalNeedsCastle: 1 } } })), /equalNeedsCastle/);
  // липсващ нов параметър в config.json е грешка (всички са задължителни)
  const partial = { ...base, lines: { ...base.lines } };
  delete partial.lines.tailOppMaxLossCp;
  assert.throws(() => resolveConfig(partial), /tailOppMaxLossCp: липсва/);
});
