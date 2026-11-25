#!/usr/bin/env node
// T-017: превръща входовете на workflow-а build-courses.yml в конфиг за build-tree и
// --inputs за build-courses. Проверява всичко ПРЕДИ тежките стъпки (сваляне, двигател).
//
//   INPUTS='<toJSON(inputs)>' MONTH=2026-10 node tools/ci/prepare-inputs.js [--out-dir build]
//
// Пише:
//   <out>/tree-config.json     {source, tree} за `node tools/build-tree --config …`
//   <out>/courses-inputs.json  {courses, linesPerCourse, …, overrides} за `--inputs`
// Печата key=value (и в $GITHUB_OUTPUT, ако го има): month, tree_hash, nodes, multipv,
// max_games, lines_max_ply, tree_max_ply.
//
// Входове на build-tree: month, maxGames, minElo, maxElo, minBaseSec, treeMaxPly и
// overrides.tree.* (всеки ключ от секцията tree на tools/build-tree/config.json).
// Входове на build-courses: courses, linesPerCourse, advCpWhite, advCpBlack, maxPly,
// oppMinShare, engineNodes и overrides.{lines,engine,cache}. Празен низ = подразбиране.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfigFile as loadTreeConfig, resolveParams } from '../build-tree/config.js';
import { loadConfigFile as loadCoursesConfig, inputsToOverrides, resolveConfig } from '../build-courses/config.js';

const TREE_INPUT_MAP = { maxGames: 'maxGames', minElo: 'minElo', maxElo: 'maxElo', minBaseSec: 'minBaseSec', treeMaxPly: 'maxPly' };
const COURSE_INPUTS = ['courses', 'linesPerCourse', 'advCpWhite', 'advCpBlack', 'maxPly', 'oppMinShare', 'engineNodes'];
const IGNORED = new Set(['publish', 'month']);

const blank = (v) => v === '' || v === null || v === undefined;

function toInt(name, v) {
  const s = String(v).replace(/_/g, '').trim();
  if (!/^\d+$/.test(s)) throw new Error(`вход ${name}: очаква се цяло число, а не „${v}“`);
  return Number(s);
}

/** Чиста функция: {inputs, month} → {treeConfig, coursesInputs, info}. Хвърля Error при грешка. */
export function prepare(inputs, month) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('INPUTS: очаква се JSON обект');
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new Error(`MONTH: очаква се YYYY-MM, а не „${month}“`);
  for (const k of Object.keys(inputs)) {
    if (!(k in TREE_INPUT_MAP) && !COURSE_INPUTS.includes(k) && k !== 'overrides' && !IGNORED.has(k)) {
      throw new Error(`непознат вход „${k}“`);
    }
  }
  let overrides = {};
  if (!blank(inputs.overrides)) {
    try {
      overrides = typeof inputs.overrides === 'string' ? JSON.parse(inputs.overrides) : inputs.overrides;
    } catch (e) {
      throw new Error(`вход overrides: невалиден JSON (${e.message})`);
    }
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('вход overrides: очаква се JSON обект');
  }
  const { tree: treeOverrides = {}, ...courseOverrides } = overrides;
  if (typeof treeOverrides !== 'object' || Array.isArray(treeOverrides)) throw new Error('overrides.tree: очаква се обект');

  // --- дърво
  const base = loadTreeConfig();
  const tree = { ...base.tree };
  for (const [k, v] of Object.entries(treeOverrides)) {
    if (!(k in base.tree)) throw new Error(`overrides.tree.${k}: непознат параметър (позволени: ${Object.keys(base.tree).join(', ')})`);
    tree[k] = v;
  }
  for (const [inp, key] of Object.entries(TREE_INPUT_MAP)) {
    if (!blank(inputs[inp])) tree[key] = toInt(inp, inputs[inp]);
  }
  const treeConfig = { source: { ...base.source, month }, tree: resolveParams(tree) };

  // --- курсове (същата проверка, която прави build-courses)
  const coursesInputs = {};
  for (const k of COURSE_INPUTS) if (!blank(inputs[k])) coursesInputs[k] = String(inputs[k]).trim();
  if (Object.keys(courseOverrides).length) coursesInputs.overrides = courseOverrides;
  const cfg = resolveConfig(loadCoursesConfig(), inputsToOverrides(coursesInputs));
  if (treeConfig.tree.maxPly < cfg.lines.maxPly + 2) {
    throw new Error(`дървото е по-плитко от линиите: tree.maxPly ${treeConfig.tree.maxPly} < lines.maxPly ${cfg.lines.maxPly} + 2`);
  }

  const treeHash = createHash('sha256').update(JSON.stringify(treeConfig)).digest('hex').slice(0, 16);
  const info = {
    month,
    tree_hash: treeHash,
    nodes: cfg.engine.nodes,
    multipv: cfg.engine.multiPV,
    max_games: treeConfig.tree.maxGames,
    tree_max_ply: treeConfig.tree.maxPly,
    lines_max_ply: cfg.lines.maxPly,
  };
  return { treeConfig, coursesInputs, info };
}

async function main() {
  const { values } = parseArgs({ options: { 'out-dir': { type: 'string' } }, strict: true });
  const outDir = resolve(values['out-dir'] ?? 'build');
  let inputs;
  try {
    inputs = JSON.parse(process.env.INPUTS || '{}');
  } catch (e) {
    throw new Error(`INPUTS: невалиден JSON (${e.message})`);
  }
  const { treeConfig, coursesInputs, info } = prepare(inputs, process.env.MONTH);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'tree-config.json'), JSON.stringify(treeConfig, null, 2) + '\n');
  writeFileSync(join(outDir, 'courses-inputs.json'), JSON.stringify(coursesInputs) + '\n');
  const lines = Object.entries(info).map(([k, v]) => `${k}=${v}`);
  process.stdout.write(lines.join('\n') + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`prepare-inputs: ${e.message}\n`);
    process.exit(2);
  });
}
