// Валидатор на данните tools/validate-data (T-015) + каталогът и тестовите курсове.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lineId } from '../../src/chess/position.js';
import {
  parseStrictPgn, validateCatalog, validateCourse, validateManifest, validateAll,
} from '../../tools/validate-data/validate.js';
import { loadOpenings, deepestName } from '../../tools/validate-data/openings.js';
import { diffSample } from '../../tools/validate-data/make-sample.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const clone = (x) => structuredClone(x);
const openings = loadOpenings();
const CATALOG = readJson('data/catalog.json');
const catalogCourses = validateCatalog(CATALOG, { openings }).courses;

/** Има поне една грешка, която съвпада с re. */
function hasErr(errors, re) {
  assert.ok(errors.some((e) => re.test(e)), `очаква се грешка ${re}, а има:\n  ${errors.join('\n  ') || '(няма грешки)'}`);
}

// ---- Каталог ----

test('data/catalog.json: 31 курса по ARCH_T-014 §7, 9 ★ (5 бели + 4 черни), валиден', () => {
  const { errors } = validateCatalog(CATALOG, { openings });
  assert.deepEqual(errors, []);
  const ids = CATALOG.courses.map((c) => c.id);
  assert.deepEqual(ids, [
    'italian', 'ruy-lopez', 'scotch', 'vienna', 'kings-gambit', 'alapin', 'smith-morra', 'french-advance',
    'caro-advance', 'vs-scandinavian', 'pirc-austrian', 'london-d5', 'london-nf6', 'queens-gambit', 'english',
    'najdorf', 'accel-dragon', 'caro-kann', 'french', 'scandinavian', 'open-e5', 'petrov', 'pirc', 'alekhine',
    'slav', 'qgd', 'kid', 'nimzo', 'grunfeld', 'vs-english', 'vs-nf3',
  ]);
  const def = CATALOG.courses.filter((c) => c.default);
  assert.deepEqual(def.map((c) => c.id), [
    'italian', 'alapin', 'french-advance', 'caro-advance', 'vs-scandinavian', 'caro-kann', 'slav', 'vs-english', 'vs-nf3',
  ]);
  assert.equal(def.filter((c) => c.side === 'w').length, 5);
  assert.equal(CATALOG.courses.filter((c) => c.side === 'w').length, 15);
  const eco = Object.fromEntries(CATALOG.courses.map((c) => [c.id, c.eco]));
  assert.equal(eco.kid, 'E61');
  assert.equal(eco['accel-dragon'], 'B32');
  assert.equal(eco.pirc, 'B07');
  assert.equal(CATALOG.courses.find((c) => c.id === 'petrov').name.en, "Petrov's Defense");
  assert.equal(CATALOG.courses.find((c) => c.id === 'english').start, '');
  for (const c of CATALOG.courses) assert.deepEqual(c.params, {});
});

test('parseStrictPgn: форматът на lichess „1. e4 e5 2. Nf3“', () => {
  assert.deepEqual(parseStrictPgn(''), []);
  assert.deepEqual(parseStrictPgn('1. d4'), ['d4']);
  assert.deepEqual(parseStrictPgn('1. e4 e5 2. Nf3'), ['e4', 'e5', 'Nf3']);
  for (const bad of ['1.e4 e5', '1. e4  e5', ' 1. e4', '2. e4', '1. e4 e5 3. Nf3', '1. e4 2. d4', '1.', 'e4 e5', '1. e4 e5 2...Nf3']) {
    assert.throws(() => parseStrictPgn(bad), Error, bad);
  }
});

function catalogWith(mutate) {
  const c = clone(CATALOG);
  mutate(c);
  return validateCatalog(c, { openings }).errors;
}
const course = (c, id) => c.courses.find((x) => x.id === id);

test('каталог: счупени записи дават ясни грешки', () => {
  const cases = [
    [(c) => { c.courses[1].id = 'italian'; }, /курс „italian“: повторено id/],
    [(c) => { course(c, 'italian').start = '1. e4 e6 2. Ke3'; }, /start .*Невалиден ход 2\.Ke3/],
    [(c) => { course(c, 'italian').book = ['1. e4 e5 2. Ng1f3']; }, /Неканоничен запис 2\.Ng1f3.*„Nf3“/],
    [(c) => { course(c, 'ruy-lopez').book = ['1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. 0-0']; }, /Неканоничен запис 5\.0-0.*„O-O“/],
    [(c) => { course(c, 'italian').start = '1.e4 e5'; }, /start „1\.e4 e5“: очаква се „1\.“/],
    [(c) => { course(c, 'italian').book = ['1. d4 d5 2. c4']; }, /трябва да започва със start/],
    [(c) => { course(c, 'italian').book = ['1. e4 e5 2. Nf3 Nc6']; }, /трябва да завършва с ход на белите/],
    [(c) => { course(c, 'italian').book = ['1. e4 e5 2. Nf3 Nc6 3. Bc4', '1. e4 e5 2. Bc4']; }, /противоречи на друг book ред.*„Nf3“ и „Bc4“/],
    [(c) => { course(c, 'italian').eco = 'C51'; }, /\(eco „C51“, name\.en „Italian Game“\) го няма.*ECO C50/],
    [(c) => { course(c, 'italian').name.en = 'Italian Opening'; }, /name\.en „Italian Opening“\) го няма/],
    [(c) => { course(c, 'italian').eco = 'C60'; course(c, 'italian').name.en = 'Ruy Lopez'; }, /не е по пътя на start\/book/],
    [(c) => { course(c, 'italian').group = 'nope'; }, /групата „nope“ я няма в groups/],
    [(c) => { c.groups.push(['unused', 'Нищо']); }, /групата „unused“ не се ползва/],
    [(c) => { c.groups.push(['e4-e5', 'Пак']); }, /повторена група „e4-e5“/],
    [(c) => { course(c, 'italian').colour = 'w'; }, /непознато поле „colour“/],
    [(c) => { delete course(c, 'italian').default; }, /липсва поле „default“/],
    [(c) => { course(c, 'italian').side = 'x'; }, /side: „x“ не е от w \| b/],
    [(c) => { course(c, 'italian').id = 'Italian Game'; }, /id: невалиден формат/],
    [(c) => { course(c, 'italian').eco = 'F00'; }, /eco: невалиден формат/],
    [(c) => { course(c, 'italian').params = { linesPerCourse: 100 }; }, /params\.linesPerCourse: 100 > 60/],
    [(c) => { course(c, 'italian').params = { advCp: 50 }; }, /непознато поле „advCp“/],
    [(c) => { course(c, 'scotch').name.bg = 'Италианска партия'; }, /повторено българско име/],
    [(c) => { c.v = 2; }, /catalog\.v: очаква се 1/],
  ];
  for (const [mutate, re] of cases) hasErr(catalogWith(mutate), re);
});

// ---- Курсове ----

const FX = readJson('data/fixtures/manifest.json');
const fxCourse = (id) => readJson(`data/fixtures/courses/${id}.json`);
function courseErrors(c, extra = {}) {
  return validateCourse(c, {
    file: `courses/${c.id}.json`, expectedId: extra.expectedId ?? c.id,
    catalogCourse: catalogCourses.get(c.id), dataVersion: FX.dataVersion, sample: true, openings, ...extra,
  }).errors;
}
/** Сменя ходовете на линия и преизчислява id (за да се тества само другата грешка). */
function setMoves(c, n, m) {
  const l = c.lines.find((x) => x.n === n);
  const old = l.id;
  l.m = m;
  l.id = lineId(c.id, m);
  if (Array.isArray(l.c)) l.c = m.map(() => null);
  for (const x of c.lines) if (x.to === old) x.to = l.id;
  return l;
}

test('тестовите курсове са валидни, маркирани sample и възпроизводими от make-sample', () => {
  assert.equal(FX.sample, true);
  assert.match(FX.note, /ТЕСТОВИ ДАННИ/);
  assert.ok(FX.courses.length >= 2);
  const sides = new Set();
  for (const e of FX.courses) {
    const c = fxCourse(e.id);
    assert.equal(c.sample, true);
    assert.deepEqual(courseErrors(c), []);
    assert.ok(c.lines.length >= 5);
    assert.ok(c.lines.some((l) => l.end === 'transpose'), `${e.id}: има транспозиция`);
    sides.add(c.side);
  }
  assert.deepEqual([...sides].sort(), ['b', 'w']);
  assert.deepEqual(diffSample(), [], 'data/fixtures/ е генерирано от tools/validate-data/make-sample.js');
  const r = validateManifest(join(ROOT, 'data/fixtures/manifest.json'), { root: ROOT, catalogCourses, openings, expectSample: true });
  assert.deepEqual(r.errors, []);
});

test('deepestName: най-дълбокото име по ходовете', () => {
  assert.deepEqual(deepestName(openings, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']), { eco: 'C50', name: 'Italian Game' });
  assert.equal(deepestName(openings, []), null);
});

test('курс: счупени линии дават ясни грешки', () => {
  const it = () => fxCourse('italian');
  const ck = () => fxCourse('caro-kann');
  const cases = [
    [() => { const c = it(); c.lines[0].id = 'deadbeef'; return c; }, /линия 1 \(deadbeef\): id не съвпада.*очаква се/],
    [() => { const c = it(); setMoves(c, 1, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'Ke3']); return c; }, /линия 1 .*Невалиден ход 5\.Ke3 \(полуход 9\)/],
    [() => { const c = it(); setMoves(c, 1, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', '0-0']); return c; }, /Неканоничен запис 6\.0-0.*„O-O“/],
    [() => { const c = it(); setMoves(c, 1, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6']); return c; }, /трябва да завършва с ход на белите/],
    [() => { const c = it(); setMoves(c, 3, ['d4', 'd5', 'c4']); return c; }, /трябва да започват със start \[e4 e5\]/],
    [() => { const c = it(); c.lines.find((l) => l.end === 'transpose').to = '00000000'; return c; }, /„to“ сочи несъществуваща линия „00000000“/],
    [() => { const c = it(); const t = c.lines.find((l) => l.end === 'transpose'); t.to = c.lines.find((l) => l.n === 2).id; return c; }, /крайната позиция я няма в линията „to“/],
    [() => { const c = it(); const t = c.lines.find((l) => l.end === 'transpose'); t.to = t.id; return c; }, /„to“ сочи самата линия/],
    [() => { const c = it(); delete c.lines.find((l) => l.end === 'transpose').to; return c; }, /end „transpose“ изисква поле „to“/],
    [() => { const c = it(); c.lines[1].to = c.lines[0].id; return c; }, /поле „to“ е позволено само при end „transpose“/],
    [() => { const c = it(); c.lines[1].c = [null, 'x']; return c; }, /c \(коментари\) има 2 елемента, а ходовете са 13/],
    [() => { const c = it(); c.lines[1].c = c.lines[1].m.map(() => ' '); return c; }, /празен коментар/],
    [() => { const c = it(); c.lines[2].n = 9; return c; }, /липсва линия с n=3/],
    [() => { const c = it(); c.lines[1].n = 1; return c; }, /повторен номер n=1/],
    [() => { const c = it(); c.lines[2].p = 0.5; return c; }, /подредени по p низходящо: n=3/],
    [() => { const c = it(); c.lines.forEach((l) => { l.p = 0.3; }); return c; }, /сумата на p е 1\.8000 > 1/],
    [() => { const c = it(); c.lines[0].p = 0; return c; }, /\.p: трябва да е > 0/],
    [() => { const c = it(); setMoves(c, 2, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3']); return c; }, /е префикс на линия 1/],
    [() => { const c = it(); setMoves(c, 2, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3']); return c; }, /моят ход е „d3“, а в линия 1 .* — „c3“/],
    [() => { const c = it(); c.lines[0].end = 'mate'; return c; }, /end „mate“, а крайната позиция не е мат/],
    [() => { const c = it(); c.lines[0].end = 'win'; return c; }, /end: „win“ не е от/],
    [() => { const c = it(); c.lines[0].name = 'Italian Game: Nonsense'; return c; }, /name „Italian Game: Nonsense“\) го няма в lichess/],
    [() => { const c = it(); delete c.lines[0].name; return c; }, /eco и name вървят заедно/],
    [() => { const c = it(); c.lines[0].extra = 1; return c; }, /непознато поле „extra“/],
    [() => { const c = it(); c.lines[0].cp = 1.5; return c; }, /\.cp: очаква се цяло число/],
    [() => { const c = it(); c.side = 'b'; return c; }, /side „b“, а в каталога е „w“/],
    [() => { const c = it(); c.start = ['e4']; return c; }, /start \[e4\] не съвпада с каталога \[e4 e5\]/],
    [() => { const c = it(); c.dataVersion = '2026-12-01.1'; return c; }, /dataVersion „2026-12-01\.1“ ≠ manifest/],
    [() => { const c = it(); delete c.sample; return c; }, /тестовите курсове трябва да имат "sample": true/],
    [() => { const c = ck(); setMoves(c, 4, ['e4', 'c6', 'Nc3', 'd5', 'd4', 'dxe4', 'Nxe4', 'Bf5', 'Ng3', 'Bg6', 'h4', 'h6']); return c; }, /същите ходове|свършва в същата позиция|повторено id/],
  ];
  for (const [make, re] of cases) hasErr(courseErrors(make()), re);
  hasErr(courseErrors(fxCourse('italian'), { expectedId: 'italian2' }), /не съвпада с името на файла/);
});

test('курс: транспозиция към линия, която свършва в същата позиция, е грешка', () => {
  const c = fxCourse('vs-nf3');
  // целевата линия 1 се скъсява до позицията на транспозицията → не я „продължава“
  setMoves(c, 1, ['Nf3', 'd5', 'g3', 'Nf6', 'Bg2', 'c6', 'O-O', 'Bg4', 'd3', 'Nbd7']);
  hasErr(courseErrors(c), /свършва в същата позиция и не я продължава/);
});

// ---- Manifest и CLI ----

function tmpRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'lrn-validate-'));
  mkdirSync(join(dir, 'data'));
  cpSync(join(ROOT, 'data', 'catalog.json'), join(dir, 'data', 'catalog.json'));
  cpSync(join(ROOT, 'data', 'fixtures'), join(dir, 'data', 'fixtures'), { recursive: true });
  return dir;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
function editJson(path, fn) {
  const j = JSON.parse(readFileSync(path, 'utf8'));
  fn(j);
  writeFileSync(path, `${JSON.stringify(j, null, 2)}\n`);
}

test('manifest: sha256, брой линии, coverage, липсващи и излишни файлове, sample', () => {
  const cases = [
    [(d) => { const p = join(d, 'data/fixtures/courses/italian.json'); writeFileSync(p, readFileSync(p, 'utf8').replace('"cp":38', '"cp":39')); }, /„italian“: sha256 не съвпада/],
    [(d) => editJson(join(d, 'data/fixtures/manifest.json'), (m) => { m.courses[0].lines = 7; }), /lines 7, а във файла са 6/],
    [(d) => editJson(join(d, 'data/fixtures/manifest.json'), (m) => { m.courses[0].coverage = 0.9; }), /coverage 0\.9, а сумата на p е/],
    [(d) => rmSync(join(d, 'data/fixtures/courses/vs-nf3.json')), /courses\/vs-nf3\.json: файлът липсва/],
    [(d) => writeFileSync(join(d, 'data/fixtures/courses/extra.json'), '{}'), /extra\.json: файлът не е в manifest/],
    [(d) => editJson(join(d, 'data/fixtures/manifest.json'), (m) => { delete m.sample; }), /тестовите данни трябва да имат "sample": true/],
    [(d) => editJson(join(d, 'data/fixtures/manifest.json'), (m) => { m.courses[0].file = 'italian.json'; }), /file трябва да е „courses\/italian\.json“/],
    [(d) => editJson(join(d, 'data/fixtures/manifest.json'), (m) => { m.courses.push({ ...m.courses[0] }); }), /„italian“: повторено id/],
    [(d) => editJson(join(d, 'data/fixtures/manifest.json'), (m) => { m.built = 'вчера'; }), /built: невалиден формат/],
    [(d) => editJson(join(d, 'data/catalog.json'), (c) => { c.courses = c.courses.filter((x) => x.id !== 'vs-nf3'); }), /„vs-nf3“: курсът го няма в data\/catalog\.json/],
    [(d) => writeFileSync(join(d, 'data/fixtures/manifest.json'), '{ "v": 1,'), /manifest\.json: невалиден JSON/],
    [(d) => { const p = join(d, 'data/fixtures/courses/italian.json'); const t = readFileSync(p, 'utf8').replace('\n}', `,\n  "pad": "${'x'.repeat(110 * 1024)}"\n}`); writeFileSync(p, t); }, /italian\.json: \d+ B > лимита 102400 B/],
    // истински данни (data/manifest.json) не могат да са sample и трябва да имат engine/source/…
    [(d) => { cpSync(join(d, 'data/fixtures/manifest.json'), join(d, 'data/manifest.json')); cpSync(join(d, 'data/fixtures/courses'), join(d, 'data/courses'), { recursive: true }); }, /data\/manifest\.json: "sample": true е позволено само за тестови данни/],
    [(d) => mkdirSync(join(d, 'data/courses')), /data\/courses\/ съществува без data\/manifest\.json/],
  ];
  for (const [mutate, re] of cases) {
    const d = tmpRoot();
    try {
      mutate(d);
      hasErr(validateAll({ root: d, openings }).errors, re);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test('manifest: истински данни (без sample) с правилни sha256 минават; без engine — грешка', () => {
  const d = tmpRoot();
  try {
    cpSync(join(d, 'data/fixtures/courses'), join(d, 'data/courses'), { recursive: true });
    editJson(join(d, 'data/fixtures/manifest.json'), () => {});
    const m = JSON.parse(readFileSync(join(d, 'data/fixtures/manifest.json'), 'utf8'));
    delete m.sample;
    delete m.note;
    m.dataVersion = '2026-12-01.1';
    m.engine = { name: 'Stockfish', version: '19' };
    for (const e of m.courses) {
      const p = join(d, 'data', e.file);
      editJson(p, (c) => { delete c.sample; c.dataVersion = m.dataVersion; });
      e.sha256 = sha(readFileSync(p));
    }
    writeFileSync(join(d, 'data/manifest.json'), JSON.stringify(m));
    const ok = validateAll({ root: d, openings });
    assert.deepEqual(ok.errors, []);
    delete m.engine;
    writeFileSync(join(d, 'data/manifest.json'), JSON.stringify(m));
    hasErr(validateAll({ root: d, openings }).errors, /липсва поле „engine“/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('CLI: 0 при валидни данни, 1 с грешки на български, 2 при грешна опция', () => {
  const cli = join(ROOT, 'tools', 'validate-data', 'index.js');
  const ok = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /data\/catalog\.json: 31 курса/);
  assert.match(ok.stdout, /ТЕСТОВИ ДАННИ/);
  assert.match(ok.stdout, /✓ Данните са валидни/);

  const d = tmpRoot();
  try {
    editJson(join(d, 'data/catalog.json'), (c) => { c.courses[0].start = '1. e4 e5 2. Ke2 Ke7 3. Kf9'; });
    const bad = spawnSync(process.execPath, [cli, '--root', d], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /✗ data\/catalog\.json: курс „italian“: start .*Невалиден ход 3\.Kf9/);
    assert.match(bad.stderr, /Данните НЕ са валидни: \d+ грешк/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  const usage = spawnSync(process.execPath, [cli, '--nope'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /непозната опция „--nope“/);
});
