// T-027 (D-035): поле `ev` в линиите — оценка след всеки ход, от гледна точка на белите.
// Генератор (нормализация на знака, мат, кеш с фалшивия двигател) и валидатор.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySans, tokenizeMoves } from '../../src/chess/position.js';
import { normalizeEv, formatEval } from '../../src/chess/notation.js';
import { loadOpenings } from '../../tools/validate-data/openings.js';
import { validateCourse } from '../../tools/validate-data/validate.js';
import { check, MANIFEST_SCHEMA } from '../../tools/validate-data/schema.js';
import { generateCourse, evValue } from '../../tools/build-courses/generate.js';
import { buildNameIndex } from '../../tools/build-courses/names.js';
import { EnginePool } from '../../tools/build-courses/pool.js';
import { EvalCache, cachePrefix } from '../../tools/build-courses/eval-cache.js';
import { Evaluator } from '../../tools/build-courses/evaluator.js';
import {
  FAKE_UCI, treeFromGames, writeFakeTable, memoryEvaluator, TEST_PARAMS,
} from './helpers/courses-helpers.mjs';

const openings = loadOpenings();
const names = buildNameIndex(openings);
const S = (t) => tokenizeMoves(t);
const tmp = () => mkdtempSync(join(tmpdir(), 'lrn-t027-'));

const gen = ({ side = 'w', start = '', tree, evaluator, params = {} }) => generateCourse({
  courseId: 'test', side, startSans: S(start), bookLines: [], params: { ...TEST_PARAMS, ...params }, tree, evaluator, names,
});

test('evValue: знак към белите, мат "#n"/"#-n" (ходове по UCI), null', () => {
  assert.equal(evValue({ cp: 30, mate: null }, 'w'), 30);
  assert.equal(evValue({ cp: 30, mate: null }, 'b'), -30);
  assert.equal(evValue({ cp: -12.6, mate: null }, 'w'), -13);
  assert.ok(Object.is(evValue({ cp: 0, mate: null }, 'b'), 0)); // не −0
  // мат: mate > 0 — страната на ход матира
  assert.equal(evValue({ cp: 29997, mate: 3 }, 'w'), '#3');
  assert.equal(evValue({ cp: 29997, mate: 3 }, 'b'), '#-3');
  assert.equal(evValue({ cp: -29998, mate: -2 }, 'w'), '#-2');
  assert.equal(evValue({ cp: -29998, mate: -2 }, 'b'), '#2');
  assert.equal(evValue({ cp: -30000, mate: 0 }, 'w'), '#-0'); // белите са матирани
  assert.equal(evValue({ cp: -30000, mate: 0 }, 'b'), '#0');
  assert.equal(evValue(undefined, 'w'), null);
  assert.equal(evValue({ cp: null, mate: null }, 'w'), null);
  // UI (T-028) приема и показва тези стойности
  assert.deepEqual(normalizeEv([30, '#3', '#-2', null], 4), [30, '#3', '#-2', null]);
  assert.equal(formatEval('#-2'), '#−2');
});

test('генератор: ev за всеки ход, от гледна точка на белите (бели и черни курсове), мат в края', async () => {
  // бели: позиции с черните на ход → знакът се обръща
  let tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4', 50]]);
  let ev = memoryEvaluator({
    e4: [['e5', 15]], 'e4 e5': [['Nf3', 40]], 'e4 e5 Nf3': [['Nc6', -20]], 'e4 e5 Nf3 Nc6': [['Bc4', 25]],
    'e4 e5 Nf3 Nc6 Bc4': [['Nf6', -30]],
  }, { tree });
  let r = await gen({ start: 'e4 e5', tree, evaluator: ev });
  assert.deepEqual(r.lines[0].m, S('e4 e5 Nf3 Nc6 Bc4'));
  assert.deepEqual(r.lines[0].ev, [-15, 40, 20, 25, 30]);
  assert.equal(r.stats.evPositions, 5);
  assert.equal(r.stats.evNulls, 0);
  assert.equal(r.stats.evals, 2); // ev не влиза в бюджета maxEvalsPerCourse
  // черни, с мат накрая (белите са матирани → "#-0", без двигател)
  tree = treeFromGames([['f3 e5 g4 Qh4#', 10]]);
  ev = memoryEvaluator({ f3: [['e5', 10]], 'f3 e5': [['g4', -500]], 'f3 e5 g4': [['Qh4#', 29999]] }, { tree });
  r = await gen({ side: 'b', start: 'f3', tree, evaluator: ev });
  assert.equal(r.lines[0].end, 'mate');
  assert.deepEqual(r.lines[0].ev, [-10, -500, -29999, '#-0']);
  const mated = applySans(S('f3 e5 g4 Qh4#')).key;
  assert.ok(!ev.calls.includes(mated));
  const course = { v: 1, id: 'test', side: 'b', dataVersion: '2026-11-26.1', start: S('f3'), lines: r.lines };
  assert.deepEqual(validateCourse(course, { openings }).errors, []);
});

test('генератор + фалшив двигател: мат от гледна точка на страната на ход → белите; кеш за следващо пускане', async () => {
  const dir = tmp();
  const table = writeFakeTable(join(dir, 'table.json'), {
    e4: [['e5', 15]],
    'e4 e5': [['Nf3', 40]],
    'e4 e5 Nf3': [['Nc6', { mate: 4 }]], // черните (на ход) матират след 4 хода
    'e4 e5 Nf3 Nc6': [['Bc4', 25]],
    'e4 e5 Nf3 Nc6 Bc4': [['Nf6', { mate: -3 }]], // черните (на ход) са матирани след 3 хода
  });
  const log = join(dir, 'go.log');
  const engine = { name: 'FakeFish', version: '1', nodes: 1000, multiPV: 3, hashMb: 16 };
  const prefix = cachePrefix(engine);
  let pool = null;
  const getPool = () => (pool ??= new EnginePool({
    path: process.execPath, args: [FAKE_UCI], env: { FAKE_UCI_TABLE: table, FAKE_UCI_LOG: log },
    workers: 2, threads: 1, hashMb: 16, multiPV: 3, nodes: 1000, timeoutMs: 10_000, retries: 1, expectId: 'FakeFish 1',
  }));
  const tree = treeFromGames([['e4 e5 Nf3 Nc6 Bc4', 50]]);
  const cache = await new EvalCache(dir, prefix).load();
  const r = await gen({ start: 'e4 e5', tree, evaluator: new Evaluator({ cache, getPool }) });
  cache.save();
  await pool.close();
  const want = [-15, 40, '#-4', 25, '#3'];
  assert.deepEqual(r.lines[0].ev, want);
  // кешът пази оценката от гледна точка на страната на ход (mate 4 за черните)
  const k3 = cache.key(applySans(S('e4 e5 Nf3')).key);
  assert.equal(cache.get(k3)[0][3], 4);
  // всяка позиция е изчислена точно веднъж (моите позиции — и за избора на ход, и за ev)
  const goes = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(goes.length, new Set(goes).size);
  assert.equal(goes.length, 5);
  // второ пускане: само от кеша, двигателят не се вика
  const c2 = await new EvalCache(dir, prefix).load();
  assert.equal(c2.loaded, 5);
  const r2 = await gen({
    start: 'e4 e5', tree, evaluator: new Evaluator({ cache: c2, getPool: () => { throw new Error('двигателят не трябва да се вика'); } }),
  });
  assert.deepEqual(r2.lines, r.lines);
});

test('валидатор: ev — дължина, тип, диапазон; null е предупреждение; features "ev" изисква ev', () => {
  const m = S('e4 e5 Nf3');
  const base = (ev) => ({
    v: 1, id: 'test', side: 'w', dataVersion: '2026-11-26.1', start: [],
    lines: [{ id: 'f4a2c6f1', n: 1, m, p: 0.5, end: 'data', cp: 30, c: null, ...(ev === undefined ? {} : { ev }) }],
  });
  const run = (ev, ctx = {}) => {
    const c = base(ev);
    // id по правилото sha1(courseId|ходове) — взимаме очакваното от грешката, ако има
    const first = validateCourse(c, { openings });
    const idErr = first.errors.find((e) => e.includes('очаква се „'));
    if (idErr) c.lines[0].id = /очаква се „([0-9a-f]{8})“/.exec(idErr)[1];
    return validateCourse(c, { openings, ...ctx });
  };
  assert.deepEqual(run([10, -20, 35]).errors, []);
  assert.deepEqual(run([10, '#-3', '#0']).errors, []);
  assert.deepEqual(run(undefined).errors, []); // старите данни — без ev
  const ok = run([10, null, 35]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.warnings.length, 1);
  assert.match(ok.warnings[0], /1 от 3 оценки са null/);
  assert.match(run([10, 20]).errors.join('\n'), /ev има 2 елемента, а ходовете са 3/);
  assert.match(run([10, 20.5, 3]).errors.join('\n'), /ev\[1\]/);
  assert.match(run([10, 200000, 3]).errors.join('\n'), /ev\[1\]: 200000 > 100000/);
  assert.match(run([10, '#x', 3]).errors.join('\n'), /ev\[1\]: невалиден формат/);
  assert.match(run([10, '+30', 3]).errors.join('\n'), /ev\[1\]/);
  assert.match(run([10, true, 3]).errors.join('\n'), /ev\[1\]/);
  assert.match(run(undefined, { requireEv: true }).errors.join('\n'), /липсва поле „ev“/);
  // manifest.features
  const man = (features) => {
    const e = [];
    check(MANIFEST_SCHEMA, { v: 1, dataVersion: '2026-11-26.1', built: '2026-11-26T10:00:00Z', courses: [], features }, 'manifest', e);
    return e;
  };
  assert.deepEqual(man(['ev']), []);
  assert.match(man(['xyz']).join('\n'), /features\[0\]/);
});
