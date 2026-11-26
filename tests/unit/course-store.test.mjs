// Зареждане на данните (src/data/courseStore.js) и прогрес (src/data/progress.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCourseStore, catalogView, normalizeCourse, startToSans, formatMoves, fullMoves, dataSummary, DataError,
} from '../../src/data/courseStore.js';
import { courseProgress, lineStatus, nextToLearn } from '../../src/data/progress.js';
import { lineFrames } from '../../src/ui/screens/train.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** fetch над файловете в репото; брои заявките. */
function diskFetch(root = ROOT, { fail = new Set() } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (fail.has(url)) throw new TypeError('Failed to fetch');
    try {
      const buf = await readFile(join(root, url));
      return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')) };
    } catch {
      return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    }
  };
  f.calls = calls;
  return f;
}

test('истинските данни: всички 31 курса от каталога имат файл в manifest', async () => {
  const store = createCourseStore({ fetch: diskFetch() });
  const { manifest, view } = await store.loadView();
  assert.equal(view.courses.length, 31);
  assert.ok(view.courses.every((c) => c.available), 'няма „не е генериран“');
  const defaults = view.courses.filter((c) => c.default).map((c) => c.id);
  assert.deepEqual(defaults, ['italian', 'alapin', 'french-advance', 'caro-advance', 'vs-scandinavian', 'caro-kann', 'slav', 'vs-english', 'vs-nf3']);
  assert.equal(view.courses.filter((c) => c.side === 'w').length, 15);
  assert.equal(view.courses.filter((c) => c.side === 'b').length, 16);
  const s = dataSummary(manifest);
  assert.equal(s.courses, 31);
  assert.equal(s.lines, manifest.courses.reduce((a, c) => a + c.lines, 0));
  assert.equal(s.sample, false);
  assert.ok(s.params.lines.linesPerCourse);
  // всяка група се показва поне за една страна
  for (const g of view.groups) assert.ok(g.sides.length >= 1, g.id);
  assert.deepEqual(view.groups.find((g) => g.id === 'vs-e4').sides, ['b']);
});

test('loadCourse: нормализира, кешира в паметта и всички курсове се зареждат', async () => {
  const f = diskFetch();
  const store = createCourseStore({ fetch: f });
  const { view } = await store.loadView();
  for (const c of view.courses) {
    const course = await store.loadCourse(c.id);
    assert.equal(course.lines.length, c.lines, c.id);
    assert.deepEqual(course.lines.map((l) => l.n), course.lines.map((_, i) => i + 1));
    for (const l of course.lines) {
      assert.equal(l.moves.length, l.sans.length);
      assert.deepEqual(l.sans.slice(0, course.startPly), course.start);
      if (l.end === 'transpose') assert.ok(Number.isInteger(l.toN), `${c.id} ${l.id} → toN`);
      // дъската може да изиграе всяка линия
      assert.equal(lineFrames(l.sans).length, l.sans.length + 1);
    }
  }
  const n = f.calls.length;
  await store.loadCourse('italian');
  await store.loadView();
  assert.equal(f.calls.length, n, 'втори път от паметта');
  await assert.rejects(store.loadCourse('nope'), DataError);
});

test('fixtures: коментарите стават moves[i].comment, транспозицията получава toN', async () => {
  const raw = JSON.parse(await readFile(join(ROOT, 'data/fixtures/courses/italian.json'), 'utf8'));
  const c = normalizeCourse(raw);
  const withC = raw.lines.find((l) => Array.isArray(l.c));
  const nl = c.byId.get(withC.id);
  withC.c.forEach((txt, i) => assert.equal(nl.moves[i].comment, txt || null));
  const tr = c.lines.find((l) => l.end === 'transpose');
  assert.equal(tr.toN, c.byId.get(tr.to).n);
  assert.equal(c.lines.find((l) => l.end !== 'transpose').toN, null);
  assert.throws(() => normalizeCourse({}), DataError);
});

test('catalogView: курс без файл в manifest е „не е генериран“', () => {
  const catalog = {
    courses: [
      { id: 'a', side: 'w', group: 'g1', name: { bg: 'А', en: 'A' }, eco: 'C50', start: '1. e4 e5', default: true },
      { id: 'b', side: 'b', group: 'g2', name: { bg: 'Б', en: 'B' }, eco: 'B10', start: '', default: false },
    ],
    groups: [['g1', 'Група 1'], ['g2', 'Група 2']],
  };
  const v = catalogView(catalog, { courses: [{ id: 'a', lines: 7, coverage: 0.3 }] });
  assert.equal(v.byId.get('a').available, true);
  assert.equal(v.byId.get('a').lines, 7);
  assert.deepEqual(v.byId.get('a').start, ['e4', 'e5']);
  assert.equal(v.byId.get('b').available, false);
  assert.deepEqual(v.byId.get('b').start, []);
  assert.deepEqual(v.groups.map((g) => g.sides), [['w'], ['b']]);
});

test('грешки при зареждане: без мрежа, 404; повторен опит след грешка', async () => {
  const fail = new Set(['data/manifest.json']);
  const f = diskFetch(ROOT, { fail });
  const store = createCourseStore({ fetch: f });
  await assert.rejects(store.loadManifest(), /Няма връзка/);
  fail.clear();
  const m = await store.loadManifest();
  assert.ok(m.dataVersion, 'след грешка не остава кеширан отказ');
  const bad = createCourseStore({ fetch: diskFetch(ROOT), base: 'nope/' });
  await assert.rejects(bad.loadCatalog(), /HTTP 404/);
});

test('помощни: startToSans, formatMoves, fullMoves', () => {
  assert.deepEqual(startToSans('1. e4 e5 2. Nf3'), ['e4', 'e5', 'Nf3']);
  assert.deepEqual(startToSans(''), []);
  assert.equal(formatMoves(['e4', 'e5', 'Nf3', 'Nc6']), '1.e4 e5 2.Nf3 Nc6');
  assert.equal(formatMoves(['e4', 'e5', 'Nf3', 'Nc6'], { from: 1 }), '1...e5 2.Nf3 Nc6');
  assert.equal(formatMoves(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], { from: 2, max: 2 }), '2.Nf3 Nc6 …');
  assert.equal(fullMoves(11), 6);
  assert.equal(fullMoves(12), 6);
});

test('прогрес: линии без ред са нови, orphan не се брои', () => {
  assert.equal(lineStatus(undefined), 'new');
  assert.equal(lineStatus({ status: 'orphan' }), 'new');
  assert.equal(lineStatus({ status: 'learning' }), 'learning');
  const rows = [
    { lineId: 'a', status: 'learned' }, { lineId: 'b', status: 'learning' },
    { lineId: 'c', status: 'orphan' }, { lineId: 'z', status: 'learned' },
  ];
  assert.deepEqual(courseProgress(20, []), { total: 20, learned: 0, learning: 0, fresh: 20 });
  assert.deepEqual(courseProgress(5, rows), { total: 5, learned: 2, learning: 1, fresh: 2 });
  assert.deepEqual(courseProgress(5, rows, new Set(['a', 'b', 'c'])), { total: 5, learned: 1, learning: 1, fresh: 3 });
  const lines = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  const byId = new Map(rows.map((r) => [r.lineId, r]));
  assert.equal(nextToLearn(lines, byId).id, 'b');
  assert.equal(nextToLearn([{ id: 'a' }], byId), null);
});
