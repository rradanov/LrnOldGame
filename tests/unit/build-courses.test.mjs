// T-016: генератор на линии tools/build-courses — алгоритъм (фалшив evaluator в паметта),
// UCI клиент и пул (фалшив двигател като дъщерен процес), кеш, конфиг, CLI → валидатор.
// Интеграционният тест с истински Stockfish се пуска само ако е зададен STOCKFISH_PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applySans, tokenizeMoves, lineId } from '../../src/chess/position.js';
import { loadOpenings, deepestName } from '../../tools/validate-data/openings.js';
import { validateCatalog, validateCourse, validateManifest } from '../../tools/validate-data/validate.js';
import { generateCourse } from '../../tools/build-courses/generate.js';
import { buildNameIndex, lineName } from '../../tools/build-courses/names.js';
import { parseInfo, UciEngine } from '../../tools/build-courses/uci.js';
import { EnginePool } from '../../tools/build-courses/pool.js';
import { EvalCache, cachePrefix, cacheFileName } from '../../tools/build-courses/eval-cache.js';
import { Evaluator, scoreCp } from '../../tools/build-courses/evaluator.js';
import {
  loadConfigFile, resolveConfig, inputsToOverrides, courseParams, parseCli,
} from '../../tools/build-courses/config.js';
import { nextDataVersion } from '../../tools/build-courses/build.js';
import {
  ROOT, FAKE_UCI, treeFromGames, writeTreeFile, writeFakeTable, memoryEvaluator, TEST_PARAMS,
} from './helpers/courses-helpers.mjs';

const openings = loadOpenings();
const names = buildNameIndex(openings);
const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'catalog.json'), 'utf8'));
const catalogCourses = validateCatalog(catalog, { openings }).courses;
const tmp = () => mkdtempSync(join(tmpdir(), 'lrn-t016-'));
const S = (text) => tokenizeMoves(text);

/** Синтетично „lichess“ дърво от редовете на chess-openings (детерминирани тегла). */
function tsvTree() {
  let h = 7;
  return treeFromGames(openings.rows.map((r) => { h = (h * 1103515245 + 12345) >>> 0; return [r.sans, 20 + (h % 300)]; }));
}
let TSV_TREE = null;
const getTsvTree = () => (TSV_TREE ??= tsvTree());

async function gen({ id = 'test', side = 'w', start = '', book = [], params = {}, tree, evaluator }) {
  return generateCourse({
    courseId: id, side, startSans: S(start), bookLines: book.map(S),
    params: { ...TEST_PARAMS, ...params }, tree, evaluator: evaluator ?? memoryEvaluator({}, { tree }), names,
  });
}

function asCourse(id, side, start, lines) {
  return { v: 1, id, side, dataVersion: '2026-11-25.1', start: S(start), lines };
}

function checkValid(id, side, start, lines, catalogCourse) {
  const res = validateCourse(asCourse(id, side, start, lines), { openings, catalogCourse });
  assert.deepEqual(res.errors, []);
}

// ---------------------------------------------------------------------------
// Алгоритъм
// ---------------------------------------------------------------------------

test('best-first: точно top-N линии по вероятност, без излишни оценки', async () => {
  const tree = treeFromGames([
    ['e4 e5 Nf3 Nc6 Bc4', 40], ['e4 e5 Nf3 Nf6 Nxe5', 20], ['e4 c5 Nf3', 30], ['e4 e6 d4', 10],
  ]);
  const ev = memoryEvaluator({}, { tree });
  const r = await gen({ tree, evaluator: ev, params: { linesPerCourse: 3 } });
  assert.deepEqual(r.lines.map((l) => l.m.join(' ')), ['e4 e5 Nf3 Nc6 Bc4', 'e4 c5 Nf3', 'e4 e5 Nf3 Nf6 Nxe5']);
  assert.deepEqual(r.lines.map((l) => l.p), [0.4, 0.3, 0.2]);
  assert.deepEqual(r.lines.map((l) => l.n), [1, 2, 3]);
  assert.ok(r.lines.every((l) => l.end === 'data' && l.c === null));
  // позицията след 1.e4 e6 (p = 0,1) изобщо не е изчислявана
  const e6 = applySans(S('e4 e6')).key;
  assert.ok(!ev.calls.includes(e6));
  assert.equal(r.stats.evals, 5);
  assert.equal(r.stats.stoppedBy, 'lines');
  checkValid('test', 'w', '', r.lines);
});

test('best-first: първите N линии са префикс (по p) на пълния набор', async () => {
  const tree = getTsvTree();
  const cat = catalogCourses.get('italian');
  const run = (N) => generateCourse({
    courseId: 'italian', side: 'w', startSans: cat.start, bookLines: cat.book,
    params: { ...TEST_PARAMS, oppMinShare: 0.05, oppMinGames: 20, oppMinMoveGames: 10, myMoveMinGames: 50, minLineProb: 0.002, linesPerCourse: N, maxTransposeShare: 1 },
    tree, evaluator: memoryEvaluator({}, { tree }), names,
  });
  const small = await run(8);
  const big = await run(40);
  assert.ok(big.lines.length >= 20, `линии: ${big.lines.length}`);
  const key = (l) => `${l.m.join(' ')}|${l.p}`;
  assert.deepEqual(small.lines.slice(0, 8).map(key), big.lines.slice(0, 8).map(key));
  for (const r of [small, big]) checkValid('italian', 'w', '1. e4 e5', r.lines, cat);
  // p намалява; Σp ≤ 1
  assert.ok(big.lines.every((l, i) => i === 0 || l.p <= big.lines[i - 1].p));
  assert.ok(big.stats.coverage <= 1);
});

test('моят ход: най-популярният в рамките на myMoveToleranceCp; 0 = чист двигател; myMoveMinGames', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6', 100], ['e4 e5 Bc4 Nf6', 10], ['e4 e5 d4 exd4', 5]]);
  const table = { 'e4 e5': [['Bc4', 30], ['Nf3', 10], ['d4', 0]] };
  const third = async (params) => (await gen({ start: 'e4 e5', tree, evaluator: memoryEvaluator(table, { tree }), params: { linesPerCourse: 1, ...params } })).lines[0].m[2];
  assert.equal(await third({ myMoveToleranceCp: 25 }), 'Nf3'); // 20 cp по-слаб, но популярен
  assert.equal(await third({ myMoveToleranceCp: 15 }), 'Bc4'); // Nf3 е извън допуска; Bc4 (10 партии) > d4
  assert.equal(await third({ myMoveToleranceCp: 0 }), 'Bc4'); // чист двигател
  assert.equal(await third({ myMoveToleranceCp: 25, myMoveMinGames: 101 }), 'Bc4'); // недостатъчно партии → най-добрият
  const r = await gen({ start: 'e4 e5', tree, evaluator: memoryEvaluator(table, { tree }), params: { linesPerCourse: 1, maxPly: 3 } });
  assert.deepEqual([r.lines[0].m.join(' '), r.lines[0].end], ['e4 e5 Nf3', 'depth']);
  assert.equal(r.lines[0].cp, 10); // cp е оценката на избрания ход
  assert.equal(r.stats.myMoves.popular, 1);
});

test('book: предпочетен в рамките на bookToleranceCp (и извън MultiPV — searchmoves), по EPD', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6 Bb5 a6', 80], ['e4 e5 Nf3 Nc6 Bc4 Bc5', 20]]);
  const table = { 'e4 e5 Nf3 Nc6': [['Bb5', 30], ['d4', 25], ['Nc3', 20], ['Bc4', -10]] };
  const run = (params) => gen({ start: 'e4 e5', book: ['e4 e5 Nf3 Nc6 Bc4'], tree, evaluator: memoryEvaluator(table, { tree }), params: { linesPerCourse: 1, ...params } });
  let r = await run({});
  assert.equal(r.lines[0].m[4], 'Bc4');
  assert.equal(r.stats.myMoves.book, 2); // 2.Nf3 и 3.Bc4 — и двата са от book реда
  r = await run({ bookToleranceCp: 30 }); // 40 cp загуба > 30 → не се ползва
  assert.equal(r.lines[0].m[4], 'Bb5');
  assert.match(r.stats.warnings.join('\n'), /book ход Bc4/);
  // book по EPD: същата позиция по друг ред на ходовете (2.Nf3 Nc6 преди 1.e4 e5)
  const tree2 = treeFromGames([['Nf3 Nc6 e4 e5 Bb5', 50]]);
  const r2 = await gen({ start: '', book: ['e4 e5 Nf3 Nc6 Bc4'], tree: tree2, evaluator: memoryEvaluator(table, { tree: tree2 }), params: { linesPerCourse: 1 } });
  assert.deepEqual(r2.lines[0].m, S('Nf3 Nc6 e4 e5 Bc4'));
});

test('край: adv (бели/черни праг), depth, data, mate', async () => {
  // adv за белите: 100
  let tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4', 50]]);
  let r = await gen({ start: 'e4 e5', tree, evaluator: memoryEvaluator({ 'e4 e5': [['Nf3', 120]] }, { tree }) });
  assert.equal(r.lines[0].end, 'adv');
  assert.equal(r.lines[0].cp, 120);
  // adv за черните: 60 (70 стига, 50 — не)
  tree = treeFromGames([['e4 e5 Nf3 Nc6', 50]]);
  r = await gen({ side: 'b', start: 'e4', tree, evaluator: memoryEvaluator({ e4: [['e5', 70]] }, { tree }) });
  assert.equal(r.lines[0].end, 'adv');
  r = await gen({ side: 'b', start: 'e4', tree, evaluator: memoryEvaluator({ e4: [['e5', 50]] }, { tree }) });
  assert.notEqual(r.lines[0].end, 'adv');
  // depth: maxPly
  tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3', 50]]);
  r = await gen({ start: 'e4 e5', tree, params: { maxPly: 6 } });
  assert.equal(r.lines[0].end, 'depth');
  assert.equal(r.lines[0].m.length, 7);
  // data: позицията след моя ход има < oppMinGames партии
  r = await gen({ start: 'e4 e5', tree, params: { oppMinGames: 51 } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [3, 'data']);
  // data: противникът няма ход над oppMinShare
  tree = treeFromGames([['e4 e5 Nf3 Nc6', 5], ['e4 e5 Nf3 d6', 5], ['e4 e5 Nf3 Nf6', 5]]);
  r = await gen({ start: 'e4 e5', tree, params: { oppMinShare: 0.4 } });
  assert.deepEqual([r.lines[0].m.join(' '), r.lines[0].end], ['e4 e5 Nf3', 'data']);
  // mate
  tree = treeFromGames([['f3 e5 g4 Qh4#', 10]]);
  r = await gen({ side: 'b', start: 'f3', tree, evaluator: memoryEvaluator({ 'f3 e5 g4': [['Qh4#', 29999]] }, { tree }) });
  assert.deepEqual([r.lines[0].m.join(' '), r.lines[0].end], ['f3 e5 g4 Qh4#', 'mate']);
  checkValid('test', 'b', 'f3', r.lines);
});

test('T-022 опашка (D-027): без данни → най-добрите ходове на двигателя до tailMaxPly; tail в линията; причини', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6', 50]]);
  // без опашка: край data, причина „няма позиция“
  let r = await gen({ start: 'e4 e5', tree, params: { linesPerCourse: 1 } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end, 'tail' in r.lines[0]], [5, 'data', false]);
  assert.equal(r.stats.dataEnds.noPos, 1);
  // с опашка до 10 полухода: бели свършват на 9 (следващият ми ход би бил 11 > 10)
  const ev = memoryEvaluator({}, { tree });
  r = await gen({ start: 'e4 e5', tree, evaluator: ev, params: { linesPerCourse: 1, tailMaxPly: 10 } });
  const l = r.lines[0];
  assert.deepEqual([l.m.length, l.end, l.tail], [9, 'depth', 5]);
  assert.deepEqual(l.m.slice(0, 5), S('e4 e5 Nf3 Nc6'.concat(' ', l.m[4])));
  assert.equal(r.stats.tailStarts.noPos, 1);
  assert.deepEqual([r.stats.tailLines, r.stats.tailPlies], [1, 4]);
  checkValid('test', 'w', '1. e4 e5', r.lines);
  // опашка, когато ходът на противника е под oppMinGames → причина fewGames; черни до 10 точно
  const tree2 = treeFromGames([['e4 e5 Nf3 Nc6', 5]]);
  r = await gen({ side: 'b', start: 'e4', tree: tree2, params: { linesPerCourse: 1, tailMaxPly: 10, oppMinGames: 6 } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end, r.lines[0].tail], [10, 'depth', 2]);
  assert.equal(r.stats.tailStarts.fewGames, 1);
  checkValid('test', 'b', '1. e4', r.lines);
  // данните свършват след tailMaxPly → обикновен край data
  r = await gen({ start: 'e4 e5', tree, params: { linesPerCourse: 1, tailMaxPly: 6 } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [5, 'data']);
});

test('T-022 довършване до спокойна позиция (D-026): adv не спира насред размяна; изчезнало предимство → продължава', async () => {
  const tree = treeFromGames([['e4 d5 exd5 Qxd5', 50]]);
  const table = {
    'e4 d5': [['exd5', 120]],
    'e4 d5 exd5': [['Qxd5', -120]], // най-добрият отговор е взимане → не е спокойно
    'e4 d5 exd5 Qxd5': [['Nc3', 110]],
    'e4 d5 exd5 Qxd5 Nc3': [['Qa5', -110]], // спокойно
  };
  let r = await gen({ start: 'e4 d5', tree, evaluator: memoryEvaluator(table, { tree }), params: { linesPerCourse: 1, quietMaxPly: 4 } });
  let l = r.lines[0];
  assert.deepEqual([l.m.join(' '), l.end, l.cp, 'tail' in l], ['e4 d5 exd5 Qxd5 Nc3', 'adv', 110, false]); // Qxd5 е от партиите
  assert.equal(r.stats.quietLines, 1);
  checkValid('test', 'w', '1. e4 d5', r.lines);
  // без довършване — старото поведение
  r = await gen({ start: 'e4 d5', tree, evaluator: memoryEvaluator(table, { tree }), params: { linesPerCourse: 1, quietMaxPly: 0 } });
  assert.deepEqual([r.lines[0].m.join(' '), r.lines[0].end], ['e4 d5 exd5', 'adv']);
  // шах също не е спокоен; бюджетът 2 полухода стига само за един отговор
  const t2 = { ...table, 'e4 d5 exd5 Qxd5 Nc3': [['Qe5+', -110]] };
  r = await gen({ start: 'e4 d5', tree, evaluator: memoryEvaluator(t2, { tree }), params: { linesPerCourse: 1, quietMaxPly: 2 } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [5, 'adv']);
  assert.equal(r.stats.unquiet, 1);
  // предимството изчезва при довършването → линията продължава нормално (тук: data)
  const t3 = { ...table, 'e4 d5 exd5 Qxd5': [['Nc3', 50]] };
  r = await gen({ start: 'e4 d5', tree, evaluator: memoryEvaluator(t3, { tree }), params: { linesPerCourse: 1, quietMaxPly: 4 } });
  assert.deepEqual([r.lines[0].m.join(' '), r.lines[0].end, r.lines[0].cp], ['e4 d5 exd5 Qxd5 Nc3', 'data', 50]);
  // без данни за отговора → ходът е от двигателя и е маркиран като опашка
  const tree3 = treeFromGames([['e4 d5 exd5', 50]]);
  r = await gen({ start: 'e4 d5', tree: tree3, evaluator: memoryEvaluator(table, { tree: tree3 }), params: { linesPerCourse: 1, quietMaxPly: 4 } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end, r.lines[0].tail], [5, 'adv', 3]);
  checkValid('test', 'w', '1. e4 d5', r.lines);
});

test('T-022 край equal за черните (D-026): cp ≥ equalCpBlack, ply ≥ minPlyBlack, стабилно; не и за белите', async () => {
  const tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3', 50]]);
  const P = { linesPerCourse: 1, minPlyBlack: 4, equalCpBlack: 0 };
  let r = await gen({ side: 'b', start: 'e4', tree, evaluator: memoryEvaluator({ e4: [['e5', 10]], 'e4 e5 Nf3': [['Nc6', 5]] }, { tree }), params: P });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end, r.lines[0].cp], [4, 'equal', 5]);
  checkValid('test', 'b', '1. e4', r.lines);
  // не е стабилно (предишният ход < 0) → продължава до следващия мой ход ≥ 0 с предишен ≥ 0
  const t2 = { e4: [['e5', 10]], 'e4 e5 Nf3': [['Nc6', -5]], 'e4 e5 Nf3 Nc6 Bc4': [['Bc5', 0]], 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3': [['Nf6', 3]] };
  r = await gen({ side: 'b', start: 'e4', tree, evaluator: memoryEvaluator(t2, { tree }), params: P });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [8, 'equal']);
  // преди minPlyBlack — не
  r = await gen({ side: 'b', start: 'e4', tree, evaluator: memoryEvaluator(t2, { tree }), params: { ...P, minPlyBlack: 12, maxPly: 10 } });
  assert.notEqual(r.lines[0].end, 'equal');
  // advCpBlack по-рано: 1...e5 с 45 ≥ 40
  r = await gen({ side: 'b', start: 'e4', tree, evaluator: memoryEvaluator({ e4: [['e5', 45]] }, { tree }), params: { ...P, advCpBlack: 40 } });
  assert.deepEqual([r.lines[0].m.length, r.lines[0].end], [2, 'adv']);
  // белите нямат край equal
  r = await gen({ side: 'w', start: 'e4 e5', tree, params: { ...P, maxPly: 9 } });
  assert.equal(r.lines[0].end, 'depth');
});

test('T-022 валидатор: поле tail (незадължително) — в границите и сочи ход на противника; end equal', () => {
  const m = S('e4 e5 Nf3 Nc6 Bc4');
  const line = (extra) => ({ id: lineId('test', m), n: 1, m, p: 0.5, end: 'depth', cp: 10, c: null, ...extra });
  const errs = (l) => validateCourse(asCourse('test', 'w', '1. e4 e5', [l]), { openings }).errors.join('\n');
  assert.equal(errs(line({ tail: 3 })), '');
  assert.equal(errs(line({ end: 'equal' })), '');
  assert.match(errs(line({ tail: 4 })), /ход на противника/);
  assert.match(errs(line({ tail: 5 })), /извън/);
  assert.match(errs(line({ tail: 1 })), /извън/);
  assert.match(errs(line({ tail: 'x' })), /tail/);
});

test('транспозиция: линията се затваря с „to“ към линията, която продължава; един мой ход на позиция', async () => {
  const tree = treeFromGames([
    ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3', 60],
    ['e4 c6 Nc3 d5 d4 dxe4 Nxe4 Bf5 Ng3', 40],
  ]);
  const r = await gen({ side: 'b', start: 'e4', tree });
  const byId = new Map(r.lines.map((l) => [l.id, l]));
  const t = r.lines.find((l) => l.end === 'transpose');
  assert.ok(t, 'има линия с транспозиция');
  assert.deepEqual(t.m, S('e4 c6 Nc3 d5 d4 dxe4'));
  assert.deepEqual(byId.get(t.to).m.slice(0, 8), S('e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5'));
  checkValid('test', 'b', 'e4', r.lines);
  assert.equal(r.stats.ends.transpose, 1);
});

test('транспозиция без продължение в top-N: допълва се с линия, иначе се маха', async () => {
  // Пътят 2.d4 (p 0,6) разгръща позицията след 4...Bf5 и се разклонява (Ng3 0,36, Nc5/Bd3 0,12);
  // транспозицията по 2.Nc3 (p 0,4) се затваря първа. С N = 1 целта не би влязла —
  // генераторът допълва с линия през позицията.
  const tree = treeFromGames([
    ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4', 20], ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Nc5', 20],
    ['e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Bd3', 20], ['e4 c6 Nc3 d5 d4 dxe4 Nxe4 Bf5 Ng3 Bg6 h4', 40],
  ]);
  const r = await gen({ side: 'b', start: 'e4', tree, params: { linesPerCourse: 1, maxTransposeShare: 1 } });
  assert.equal(r.lines[0].end, 'transpose');
  assert.ok(r.lines.length >= 2 && r.stats.extensionLines >= 1);
  checkValid('test', 'b', 'e4', r.lines);
  // без бюджет за допълване — транспозицията се маха (няма висяща препратка)
  const r2 = await gen({ side: 'b', start: 'e4', tree, params: { linesPerCourse: 1, maxTransposeShare: 1, maxEvalsPerCourse: 6 } });
  assert.ok(r2.lines.every((l) => l.end !== 'transpose'));
  assert.equal(r2.stats.droppedTransposes, 1);
});

test('maxEvalsPerCourse и minLineProb', async () => {
  const tree = getTsvTree();
  const cat = catalogCourses.get('caro-kann');
  const base = { courseId: 'caro-kann', side: 'b', startSans: cat.start, bookLines: cat.book, tree, names };
  const r = await generateCourse({ ...base, params: { ...TEST_PARAMS, maxEvalsPerCourse: 3 }, evaluator: memoryEvaluator({}, { tree }) });
  assert.equal(r.stats.stoppedBy, 'maxEvals');
  assert.ok(r.stats.evals <= 4);
  assert.match(r.stats.warnings.join('\n'), /maxEvalsPerCourse/);
  const r2 = await generateCourse({ ...base, params: { ...TEST_PARAMS, minLineProb: 0.05 }, evaluator: memoryEvaluator({}, { tree }) });
  assert.ok(r2.lines.every((l) => l.p >= 0.05));
});

test('детерминизъм: еднакъв изход при различен ред/закъснение на оценките', async () => {
  const tree = getTsvTree();
  const cat = catalogCourses.get('caro-kann');
  let seed = 1;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed % 5; };
  const run = (delay) => generateCourse({
    courseId: 'caro-kann', side: 'b', startSans: cat.start, bookLines: cat.book,
    params: { ...TEST_PARAMS, oppMinShare: 0.05, oppMinGames: 20, oppMinMoveGames: 10, myMoveMinGames: 50, minLineProb: 0.002 },
    tree, evaluator: memoryEvaluator({}, { tree, delay }), names,
  });
  const [a, b] = await Promise.all([run(null), run(rnd)]);
  assert.equal(JSON.stringify(a.lines), JSON.stringify(b.lines));
  assert.equal(a.lines.length, 20);
  checkValid('caro-kann', 'b', '1. e4 c6', a.lines, cat);
});

test('име на линия — по позиция (EPD), не само по реда на ходовете', () => {
  const sans = S('e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5');
  const { keys } = applySans(sans);
  assert.equal(deepestName(openings, sans).name, 'Caro-Kann Defense'); // по реда (T-015)
  assert.deepEqual(lineName(names, sans, keys), { eco: 'B18', name: 'Caro-Kann Defense: Classical Variation' });
  const it = S('e4 e5 Nf3 Nc6 Bc4 Bc5');
  assert.equal(lineName(names, it, applySans(it).keys).name, 'Italian Game: Giuoco Piano');
});

// ---------------------------------------------------------------------------
// UCI клиент, пул, кеш
// ---------------------------------------------------------------------------

test('parseInfo: cp, mate, граници, pv; редове без оценка се пропускат', () => {
  const i = parseInfo('info depth 14 seldepth 23 multipv 2 score cp -12 upperbound nodes 200199 nps 914150 hashfull 60 tbhits 0 time 219 pv b1c3 b8c6');
  assert.deepEqual(i, { multipv: 2, depth: 14, nodes: 200199, nps: 914150, cp: -12, mate: null, bound: 'upperbound', pv: ['b1c3', 'b8c6'] });
  assert.equal(parseInfo('info depth 5 multipv 1 score mate -3 nodes 10 pv e2e4').mate, -3);
  assert.equal(parseInfo('info string NNUE evaluation using nn-xyz.nnue'), null);
  assert.equal(parseInfo('info depth 10 currmove e2e4 currmovenumber 1'), null);
  assert.equal(scoreCp(null, 3), 29997);
  assert.equal(scoreCp(null, -2), -29998);
  assert.equal(scoreCp(15, null), 15);
});

const fakeOpts = (env = {}, extra = {}) => ({
  path: process.execPath, args: [FAKE_UCI], env, workers: 2, hashMb: 16, multiPV: 3, nodes: 1000,
  timeoutMs: 3000, retries: 2, expectId: 'FakeFish 1', ...extra,
});

test('UciEngine: uci/isready/ucinewgame/position/go nodes, MultiPV, searchmoves, чисто затваряне', async () => {
  const dir = tmp();
  const table = writeFakeTable(join(dir, 't.json'), { 'e4 e5': [['Nf3', 30], ['Bc4', { mate: 4 }], ['d4', -5]] });
  const e = new UciEngine({ path: process.execPath, args: [FAKE_UCI], env: { FAKE_UCI_TABLE: table }, multiPV: 3 });
  await e.start();
  assert.equal(e.idName, 'FakeFish 1');
  const fen = applySans(S('e4 e5')).fen;
  const r = await e.analyse(fen, { nodes: 5000 });
  assert.deepEqual(r.lines.map((l) => [l.uci, l.cp, l.mate]), [['f1c4', null, 4], ['g1f3', 30, null], ['d2d4', -5, null]]);
  assert.equal(r.bestmove, 'f1c4');
  assert.equal(r.nodes, 5000);
  const s = await e.analyse(fen, { nodes: 5000, searchmoves: ['d2d4'] });
  assert.deepEqual(s.lines.map((l) => l.uci), ['d2d4']);
  await e.close();
  assert.ok(e.dead);
});

test('EnginePool: мързелив старт, W процеса, рестарт при срив и при таймаут, проверка на id', async () => {
  const dir = tmp();
  const fen = applySans(S('e4')).fen;
  // мързелив: без заявки няма процеси
  const idle = new EnginePool(fakeOpts());
  await idle.close();
  assert.equal(idle.stats.started, 0);
  // срив при първото go → рестарт и успех
  const crash = new EnginePool(fakeOpts({ FAKE_UCI_CRASH_ONCE: join(dir, 'crash') }, { workers: 1 }));
  const r = await crash.analyse(fen);
  assert.equal(r.lines.length, 3);
  assert.equal(crash.stats.crashes, 1);
  assert.equal(crash.stats.restarts, 1);
  await crash.close();
  // увисване → таймаут → рестарт
  const hang = new EnginePool(fakeOpts({ FAKE_UCI_HANG_ONCE: join(dir, 'hang') }, { workers: 1, timeoutMs: 400 }));
  const r2 = await hang.analyse(fen);
  assert.equal(r2.lines.length, 3);
  assert.equal(hang.stats.timeouts, 1);
  await hang.close();
  // паралелно: 6 заявки на 2 процеса
  const log = join(dir, 'go.log');
  const par = new EnginePool(fakeOpts({ FAKE_UCI_LOG: log }));
  const fens = ['e4', 'd4', 'c4', 'Nf3', 'e4 e5', 'd4 d5'].map((m) => applySans(S(m)).fen);
  const rs = await Promise.all(fens.map((f) => par.analyse(f)));
  assert.equal(rs.length, 6);
  assert.equal(par.stats.started, 2);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 6);
  await par.close();
  // грешен двигател
  const wrong = new EnginePool(fakeOpts({ FAKE_UCI_ID: 'Stockfish 18' }, { expectId: 'Stockfish 19' }));
  await assert.rejects(wrong.analyse(fen), /Stockfish 18/);
  await wrong.close();
  // несъществуващ binary
  const none = new EnginePool(fakeOpts({}, { path: join(dir, 'no-such-engine'), args: [] }));
  await assert.rejects(none.analyse(fen), /не може да се стартира/);
  await none.close();
});

test('кеш на оценките: попадения, запис/четене, префикс по версия и параметри, заявки „в полет“', async () => {
  const dir = tmp();
  const engine = { name: 'Stockfish', version: '19', nodes: 500000, multiPV: 3, hashMb: 64 };
  const prefix = cachePrefix(engine);
  assert.equal(prefix, 'stockfish-19|n500000|m3|h64');
  assert.equal(cacheFileName(prefix), 'evals-stockfish-19-n500000-m3-h64.jsonl.gz');
  const log = join(dir, 'go.log');
  let pool = null;
  const getPool = () => (pool ??= new EnginePool(fakeOpts({ FAKE_UCI_LOG: log })));
  const cache = await new EvalCache(dir, prefix).load();
  const ev = new Evaluator({ cache, getPool });
  const k = applySans(S('e4 e5')).key;
  const [a, b] = await Promise.all([ev.analyse(k), ev.analyse(k)]); // една заявка към двигателя
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.ok(a.every((x) => typeof x.san === 'string' && Number.isInteger(x.cp)));
  await ev.analyse(k);
  assert.deepEqual(ev.stats, { requests: 3, hits: 2, misses: 1 });
  assert.ok(cache.save());
  await pool.close();
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
  // ново четене: без двигател
  const c2 = await new EvalCache(dir, prefix).load();
  assert.equal(c2.loaded, 1);
  const ev2 = new Evaluator({ cache: c2, getPool: () => { throw new Error('не трябва да вика двигателя'); } });
  assert.deepEqual(await ev2.analyse(k), a);
  // друг брой възли → друг префикс/файл → празен кеш
  const c3 = await new EvalCache(dir, cachePrefix({ ...engine, nodes: 1000000 })).load();
  assert.equal(c3.loaded, 0);
  // useCache=false: не чете, но обновява
  let calls = 0;
  const ev4 = new Evaluator({ cache: c2, useCache: false, getPool: () => ({ analyse: async () => { calls++; return { lines: [{ uci: 'g1f3', cp: 1, mate: null }] }; } }) });
  await ev4.analyse(k);
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// Конфиг
// ---------------------------------------------------------------------------

test('конфиг: подразбиране по §6.2, входове на workflow, overrides, ред на сливане, грешки', () => {
  const base = loadConfigFile();
  const cfg = resolveConfig(base);
  assert.equal(cfg.lines.linesPerCourse, 20);
  assert.equal(cfg.lines.advCpWhite, 80); // D-026
  assert.equal(cfg.lines.advCpBlack, 40);
  assert.deepEqual([cfg.lines.equalCpBlack, cfg.lines.minPlyBlack, cfg.lines.tailMaxPly, cfg.lines.quietMaxPly], [0, 14, 18, 4]);
  assert.deepEqual([cfg.lines.oppMinGames, cfg.lines.oppMinMoveGames], [12, 6]);
  assert.equal(cfg.lines.myMoveToleranceCp, 25);
  assert.equal(cfg.engine.nodes, 500000);
  assert.equal(cfg.engine.multiPV, 3);
  assert.equal(cfg.engine.version, '19');
  assert.match(cfg.engine.sha256, /^[0-9a-f]{64}$/);
  const forced = inputsToOverrides({
    month: '2026-10', maxGames: '2000000', courses: 'italian, slav', linesPerCourse: '12', advCpWhite: '',
    engineNodes: '300000', overrides: '{"engine":{"multiPV":4},"cache":{"use":false},"lines":{"bookToleranceCp":40}}',
  });
  const c2 = resolveConfig(base, forced);
  assert.deepEqual(c2.lines.courses, ['italian', 'slav']);
  assert.equal(c2.lines.linesPerCourse, 12);
  assert.equal(c2.lines.advCpWhite, 80); // празен вход = подразбиране
  assert.equal(c2.engine.nodes, 300000);
  assert.equal(c2.engine.multiPV, 4);
  assert.equal(c2.cache.use, false);
  // входовете надделяват над catalog.params, а catalog.params — над config.json
  assert.deepEqual(
    [courseParams(c2, { linesPerCourse: 30, advCpBlack: 40 }).linesPerCourse, courseParams(c2, { advCpBlack: 40 }).advCpBlack],
    [12, 40],
  );
  assert.throws(() => resolveConfig(base, inputsToOverrides({ linesPerCourse: '500' })), /linesPerCourse/);
  assert.throws(() => resolveConfig(base, inputsToOverrides({ overrides: { lines: { foo: 1 } } })), /непознат параметър/);
  assert.throws(() => inputsToOverrides({ bogus: 1 }), /непознат вход/);
  const cli = parseCli(['--courses', 'italian', '--engine-nodes', '1000', '--workers', '3', '--no-cache', '--data-version', '2026-12-01.2']);
  assert.deepEqual(cli.config.lines.courses, ['italian']);
  assert.equal(cli.config.engine.workers, 3);
  assert.equal(cli.config.cache.use, false);
  assert.equal(cli.dataVersion, '2026-12-01.2');
  assert.throws(() => parseCli(['--data-version', '2026-12-01']), /YYYY-MM-DD\.N/);
  assert.equal(nextDataVersion('2026-12-01T10:00:00Z', '2026-12-01.3'), '2026-12-01.4');
  assert.equal(nextDataVersion('2026-12-02T10:00:00Z', '2026-12-01.3'), '2026-12-02.1');
});

// ---------------------------------------------------------------------------
// CLI от край до край (фалшив двигател) → валидатор
// ---------------------------------------------------------------------------

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [join(ROOT, 'tools', 'build-courses'), ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000,
  });
}

test('CLI: дърво → курсове + manifest (минава валидатора), параметри в manifest, кеш, детерминизъм', async () => {
  const dir = tmp();
  const treePath = join(dir, 'tree.jsonl.gz');
  await writeTreeFile(treePath, getTsvTree());
  const log = join(dir, 'go.log');
  const common = [
    '--tree', treePath, '--cache-dir', join(dir, 'cache'), '--engine-path', process.execPath, '--workers', '2',
    '--courses', 'italian,caro-kann,vs-nf3', '--lines-per-course', '8', '--opp-min-share', '0.05', '--built', '2026-11-25T12:00:00Z', '--quiet',
    '--overrides', JSON.stringify({ engine: { name: 'FakeFish', version: '1', args: [FAKE_UCI], nodes: 1000, hashMb: 16 } }),
  ];
  const out1 = join(dir, 'a', 'data');
  const r1 = runCli([...common, '--out', out1, '--report', join(dir, 'a', 'report.md'), '--data-version', '2026-11-25.1'], { FAKE_UCI_LOG: log });
  assert.equal(r1.status, 0, r1.stderr);
  const goCalls = readFileSync(log, 'utf8').trim().split('\n').length;
  assert.ok(goCalls > 10);
  const manifest = JSON.parse(readFileSync(join(out1, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.courses.map((c) => c.id), ['italian', 'caro-kann', 'vs-nf3']);
  assert.equal(manifest.params.lines.linesPerCourse, 8);
  assert.deepEqual(manifest.params.lines.courses, ['italian', 'caro-kann', 'vs-nf3']);
  assert.equal(manifest.params.engine.nodes, 1000);
  assert.equal(manifest.engine.id, 'FakeFish 1');
  assert.equal(manifest.source.positions, getTsvTree().size);
  assert.ok(manifest.courses.every((c) => c.lines >= 3 && c.lines <= 8), JSON.stringify(manifest.courses));
  // валидаторът на T-015 (истински, не sample)
  const vm = validateManifest(join(out1, 'manifest.json'), { root: dir, catalogCourses, openings, expectSample: false });
  assert.deepEqual(vm.errors, []);
  const cli = spawnSync(process.execPath, [join(ROOT, 'tools', 'validate-data'), '--quiet', '--manifest', join(out1, 'manifest.json')], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const report = readFileSync(join(dir, 'a', 'report.md'), 'utf8');
  assert.match(report, /\| italian \| \d+ \|/);
  // втори пуск с кеша: двигателят не се стартира, изходът е байт по байт същият
  const out2 = join(dir, 'b', 'data');
  const r2 = runCli([...common, '--out', out2, '--report', join(dir, 'b', 'report.md'), '--data-version', '2026-11-25.1',
    '--engine-path', join(dir, 'no-such-engine')], { FAKE_UCI_LOG: log });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, goCalls);
  for (const f of readdirSync(join(out1, 'courses'))) {
    assert.equal(readFileSync(join(out2, 'courses', f), 'utf8'), readFileSync(join(out1, 'courses', f), 'utf8'));
  }
  const m2 = JSON.parse(readFileSync(join(out2, 'manifest.json'), 'utf8'));
  assert.equal(m2.engine.id, 'FakeFish 1'); // T018-D5: и при топъл кеш
  assert.deepEqual(m2.courses, manifest.courses);
  // трети пуск в същата папка само с един курс: старите файлове се махат, dataVersion расте, отчетът има разлика
  const r3 = runCli([...common, '--courses', 'italian', '--out', out1, '--report', join(dir, 'a', 'report3.md')], { FAKE_UCI_LOG: log });
  assert.equal(r3.status, 0, r3.stderr);
  assert.deepEqual(readdirSync(join(out1, 'courses')), ['italian.json']);
  assert.equal(JSON.parse(readFileSync(join(out1, 'manifest.json'), 'utf8')).dataVersion, '2026-11-25.2');
  assert.match(readFileSync(join(dir, 'a', 'report3.md'), 'utf8'), /\| italian \| (\d+) \|.*\| \+0 \/ −0 \/ \1 \|/);
});

test('CLI: грешна употреба → 2; непознат курс → 1', () => {
  assert.equal(runCli(['--lines-per-course', 'x']).status, 2);
  assert.equal(runCli(['--bogus']).status, 2);
  const dir = tmp();
  const r = runCli(['--courses', 'no-such', '--tree', join(dir, 'missing.gz'), '--out', join(dir, 'd'), '--quiet']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /непознати курсове: no-such/);
});

// ---------------------------------------------------------------------------
// Интеграция с истински Stockfish (само ако STOCKFISH_PATH е зададен)
// ---------------------------------------------------------------------------

const SF = process.env.STOCKFISH_PATH;
test('интеграция: Stockfish 19, 1 курс, малко възли', { skip: !SF || !existsSync(SF) ? 'няма STOCKFISH_PATH' : false, timeout: 300_000 }, async () => {
  const dir = tmp();
  const treePath = join(dir, 'tree.jsonl.gz');
  await writeTreeFile(treePath, getTsvTree());
  const args = ['--tree', treePath, '--cache-dir', join(dir, 'cache'), '--engine-path', SF, '--workers', '2',
    '--courses', 'italian', '--lines-per-course', '5', '--engine-nodes', '50000', '--out', join(dir, 'data'),
    '--report', join(dir, 'report.md'), '--quiet'];
  const t0 = Date.now();
  const r = runCli(args);
  assert.equal(r.status, 0, r.stderr);
  const ms1 = Date.now() - t0;
  const m = JSON.parse(readFileSync(join(dir, 'data', 'manifest.json'), 'utf8'));
  assert.equal(m.engine.id, 'Stockfish 19');
  assert.ok(m.engine.nps > 0);
  const course = JSON.parse(readFileSync(join(dir, 'data', 'courses', 'italian.json'), 'utf8'));
  assert.equal(course.lines.length, 5);
  // втори пуск — от кеша, същият резултат
  const r2 = runCli([...args, '--out', join(dir, 'data2')]);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(readFileSync(join(dir, 'data2', 'courses', 'italian.json'), 'utf8'), readFileSync(join(dir, 'data', 'courses', 'italian.json'), 'utf8'));
  process.stderr.write(`# Stockfish интеграция: първи пуск ${ms1} ms, ${m.engine.nps} nps\n`);
});
