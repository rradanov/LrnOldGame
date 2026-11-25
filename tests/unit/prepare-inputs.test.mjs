// T-017: входове на build-courses.yml → конфиг на дървото и --inputs на build-courses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare } from '../../tools/ci/prepare-inputs.js';

const DEFAULTS = {
  month: '', maxGames: '2000000', minElo: '1200', maxElo: '1800', minBaseSec: '180', treeMaxPly: '28',
  courses: '', linesPerCourse: '', advCpWhite: '', advCpBlack: '', maxPly: '', oppMinShare: '', engineNodes: '',
  overrides: '{}', publish: 'pr',
};

test('prepare: подразбиране на workflow-а → конфиг на дървото и празни входове за курсовете', () => {
  const { treeConfig, coursesInputs, info } = prepare(DEFAULTS, '2026-10');
  assert.equal(treeConfig.source.month, '2026-10');
  assert.equal(treeConfig.tree.maxGames, 2_000_000);
  assert.equal(treeConfig.tree.minElo, 1200);
  assert.equal(treeConfig.tree.maxElo, 1800);
  assert.equal(treeConfig.tree.maxPly, 28);
  assert.deepEqual(coursesInputs, {});
  assert.equal(info.nodes, 500_000);
  assert.equal(info.multipv, 3);
  assert.match(info.tree_hash, /^[0-9a-f]{16}$/);
});

test('prepare: overrides се делят на tree и останалото; хешът зависи само от дървото', () => {
  const a = prepare({ ...DEFAULTS, linesPerCourse: '10', overrides: '{"tree":{"minGames":5},"engine":{"multiPV":4}}' }, '2026-10');
  assert.equal(a.treeConfig.tree.minGames, 5);
  assert.deepEqual(a.coursesInputs, { linesPerCourse: '10', overrides: { engine: { multiPV: 4 } } });
  assert.equal(a.info.multipv, 4);
  const b = prepare({ ...DEFAULTS, overrides: '{"tree":{"minGames":5}}' }, '2026-10');
  assert.equal(a.info.tree_hash, b.info.tree_hash);
  const c = prepare(DEFAULTS, '2026-09');
  assert.notEqual(c.info.tree_hash, prepare(DEFAULTS, '2026-10').info.tree_hash);
});

test('prepare: грешките се хващат преди тежките стъпки', () => {
  assert.throws(() => prepare(DEFAULTS, '2026-1'), /MONTH/);
  assert.throws(() => prepare({ ...DEFAULTS, maxGames: 'много' }), /MONTH|maxGames/);
  assert.throws(() => prepare({ ...DEFAULTS, maxGames: 'много' }, '2026-10'), /maxGames/);
  assert.throws(() => prepare({ ...DEFAULTS, overrides: '{bad' }, '2026-10'), /overrides/);
  assert.throws(() => prepare({ ...DEFAULTS, overrides: '{"tree":{"foo":1}}' }, '2026-10'), /tree\.foo/);
  assert.throws(() => prepare({ ...DEFAULTS, overrides: '{"bogus":{}}' }, '2026-10'), /bogus/);
  assert.throws(() => prepare({ ...DEFAULTS, linesPerCourse: '999' }, '2026-10'), /linesPerCourse/);
  assert.throws(() => prepare({ ...DEFAULTS, treeMaxPly: '20' }, '2026-10'), /по-плитко/);
  assert.throws(() => prepare({ ...DEFAULTS, minElo: '1900' }, '2026-10'), /maxElo/);
  assert.throws(() => prepare({ ...DEFAULTS, extra: '1' }, '2026-10'), /непознат вход/);
});
