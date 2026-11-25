// Параметри на build-courses (D-013, ARCH_T-014 §6.2):
//   config.json (или --config) → catalog.params на курса → входове (--inputs / --overrides) → CLI флагове.
// Входовете на workflow-а надделяват над catalog.params (ARCH §6.2), затова се пазят
// отделно като `forced` и се прилагат последни за всеки курс.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, COURSE_PARAMS } from '../validate-data/schema.js';

export const DEFAULT_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'config.json');

/** Граници на engine.* (ARCH §6.2; nodes отдолу е 1000 заради смоук тестове). */
const ENGINE_SPEC = {
  name: { type: 'string', min: 1 },
  version: { type: 'string', min: 1 },
  url: { type: 'string' },
  sha256: { type: 'string' },
  binary: { type: 'string' },
  path: { type: 'string', min: 1 },
  args: { type: 'array', items: { type: 'string' } },
  nodes: { type: 'int', min: 1000, max: 10_000_000 },
  multiPV: { type: 'int', min: 1, max: 5 },
  workers: { type: 'int', min: 0, max: 32 },
  hashMb: { type: 'int', min: 1, max: 1024 },
  timeoutMs: { type: 'int', min: 0, max: 3_600_000 },
  retries: { type: 'int', min: 0, max: 10 },
};
const LINES_SPEC = {
  courses: { anyOf: [{ const: 'all' }, { type: 'array', min: 1, items: { type: 'string', min: 1 } }], label: '"all" или списък с id' },
  ...COURSE_PARAMS,
};
const CACHE_SPEC = {
  use: { type: 'bool' },
  dir: { type: 'string', min: 1 },
  flushEvery: { type: 'int', min: 1, max: 1_000_000 },
};
const OUTPUT_SPEC = { tree: { type: 'string', min: 1 }, dir: { type: 'string', min: 1 }, report: { type: 'string', min: 1 } };
const SECTIONS = { lines: LINES_SPEC, engine: ENGINE_SPEC, cache: CACHE_SPEC, output: OUTPUT_SPEC };

/** Входове на workflow-а (ARCH §6.2) → секция.ключ. month/maxGames са на build-tree и се пропускат. */
const INPUT_MAP = {
  courses: ['lines', 'courses'],
  linesPerCourse: ['lines', 'linesPerCourse'],
  advCpWhite: ['lines', 'advCpWhite'],
  advCpBlack: ['lines', 'advCpBlack'],
  maxPly: ['lines', 'maxPly'],
  oppMinShare: ['lines', 'oppMinShare'],
  engineNodes: ['engine', 'nodes'],
};
const TREE_INPUTS = new Set(['month', 'maxGames']);

/** CLI флаг → вход. */
const FLAG_INPUTS = {
  courses: 'courses', 'lines-per-course': 'linesPerCourse', 'adv-cp-white': 'advCpWhite',
  'adv-cp-black': 'advCpBlack', 'max-ply': 'maxPly', 'opp-min-share': 'oppMinShare', 'engine-nodes': 'engineNodes',
};

export const USAGE = `Употреба: node tools/build-courses [опции]
Генерира data/courses/<id>.json и data/manifest.json от дървото (build-tree) и каталога.

  --tree <път>              дърво (по подразбиране build/tree.jsonl.gz)
  --catalog <път>           каталог (по подразбиране data/catalog.json)
  --out <папка>             изходна папка за manifest.json и courses/ (по подразбиране data)
  --report <път>            отчет в Markdown (по подразбиране build/report.md)
  --config <път>            JSON конфиг (по подразбиране tools/build-courses/config.json)
  --inputs '<JSON>'         входове на workflow-а: {"courses","linesPerCourse","advCpWhite",
                            "advCpBlack","maxPly","oppMinShare","engineNodes","overrides"};
                            празни низове = подразбиране; "courses": "all" или "a,b"
  --overrides '<JSON>'      всичко останало, напр. {"engine":{"multiPV":4},"cache":{"use":false}}
  --courses a,b | all       кои курсове
  --lines-per-course N  --adv-cp-white N  --adv-cp-black N  --max-ply N
  --opp-min-share X  --engine-nodes N
  --engine-path <път>       binary на Stockfish (по подразбиране engine.path = "stockfish" от PATH)
  --workers N               процеси на двигателя (0 = брой CPU)
  --cache-dir <папка>       кеш на оценките (по подразбиране build/cache)
  --no-cache                не чети кеша (но го обнови)
  --data-version V          YYYY-MM-DD.N (по подразбиране днес.N, N расте спрямо стария manifest)
  --built ISO               време на генериране (по подразбиране сега)
  --quiet                   без прогрес в stderr
  --help`;

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadConfigFile(path = DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const cfg = {};
  for (const s of Object.keys(SECTIONS)) cfg[s] = { ...(raw[s] ?? {}) };
  return cfg;
}

function coerce(spec, v) {
  if (typeof v !== 'string') return v;
  const t = spec?.type;
  if ((t === 'int' || t === 'number') && /^-?\d+(\.\d+)?$/.test(v.replace(/_/g, ''))) return Number(v.replace(/_/g, ''));
  if (t === 'bool' && (v === 'true' || v === 'false')) return v === 'true';
  return v;
}

function normCourses(v) {
  if (typeof v !== 'string') return v;
  if (v.trim() === 'all') return 'all';
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Проверява секция; хвърля Error с всички грешки. */
function checkSection(name, obj, { partial = false } = {}) {
  const spec = SECTIONS[name];
  const errors = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$comment') continue;
    if (!spec[k]) errors.push(`${name}.${k}: непознат параметър`);
    else check(spec[k], v, `${name}.${k}`, errors);
  }
  if (!partial) for (const k of Object.keys(spec)) if (!(k in obj)) errors.push(`${name}.${k}: липсва`);
  if (errors.length) throw new Error(`Грешни параметри:\n  ${errors.join('\n  ')}`);
}

/**
 * Превръща входовете на workflow-а в частичен конфиг {lines, engine, cache, output}.
 * Празни низове и null означават „по подразбиране“.
 */
export function inputsToOverrides(inputs) {
  const out = { lines: {}, engine: {}, cache: {}, output: {} };
  if (!inputs) return out;
  if (typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('--inputs: очаква се JSON обект');
  for (const [k, v0] of Object.entries(inputs)) {
    if (v0 === '' || v0 === null || v0 === undefined) continue;
    if (k === 'overrides') {
      const o = typeof v0 === 'string' ? JSON.parse(v0) : v0;
      for (const [s, vals] of Object.entries(o)) {
        if (!SECTIONS[s]) throw new Error(`overrides.${s}: непозната секция (позволени: ${Object.keys(SECTIONS).join(', ')})`);
        Object.assign(out[s], vals);
      }
      continue;
    }
    if (TREE_INPUTS.has(k)) continue;
    const map = INPUT_MAP[k];
    if (!map) throw new Error(`--inputs: непознат вход „${k}“`);
    const [s, key] = map;
    out[s][key] = key === 'courses' ? normCourses(v0) : coerce(SECTIONS[s][key], v0);
  }
  for (const s of Object.keys(out)) {
    for (const [k, v] of Object.entries(out[s])) out[s][k] = k === 'courses' ? normCourses(v) : coerce(SECTIONS[s][k], v);
  }
  return out;
}

/**
 * Пълният разрешен конфиг. `forced` (частичен) е от входовете/CLI — прилага се над
 * всичко; за секция lines се пази и отделно, за да надделее над catalog.params.
 */
export function resolveConfig(base, forced = { lines: {}, engine: {}, cache: {}, output: {} }) {
  for (const s of Object.keys(SECTIONS)) checkSection(s, forced[s] ?? {}, { partial: true });
  const merged = deepMerge(base, forced);
  for (const s of Object.keys(SECTIONS)) {
    delete merged[s].$comment;
    checkSection(s, merged[s]);
  }
  const forcedLines = { ...(forced.lines ?? {}) };
  delete forcedLines.courses;
  return { ...merged, forcedLines };
}

/** Параметрите на един курс: lines ← catalog.params ← forcedLines. */
export function courseParams(cfg, catalogParams = {}) {
  const p = { ...cfg.lines, ...catalogParams, ...cfg.forcedLines };
  delete p.courses;
  return p;
}

/** Брой процеси: 0 → брой CPU (най-много 8). */
export function effectiveWorkers(engine) {
  return engine.workers > 0 ? engine.workers : Math.min(8, availableParallelism());
}

/** Таймаут на едно изчисление: 0 → 10 s + nodes/20 ms. */
export function effectiveTimeout(engine) {
  return engine.timeoutMs > 0 ? engine.timeoutMs : 10_000 + Math.ceil(engine.nodes / 20);
}

/** Разбира argv: {help, quiet, tree, catalog, outDir, report, dataVersion, built, config}. */
export function parseCli(argv) {
  const options = {
    help: { type: 'boolean' }, quiet: { type: 'boolean' }, 'no-cache': { type: 'boolean' },
    config: { type: 'string' }, tree: { type: 'string' }, catalog: { type: 'string' }, out: { type: 'string' },
    report: { type: 'string' }, inputs: { type: 'string' }, overrides: { type: 'string' },
    'engine-path': { type: 'string' }, workers: { type: 'string' }, 'cache-dir': { type: 'string' },
    'data-version': { type: 'string' }, built: { type: 'string' },
  };
  for (const f of Object.keys(FLAG_INPUTS)) options[f] = { type: 'string' };
  const { values } = parseArgs({ args: argv, options, allowPositionals: false, strict: true });
  if (values.help) return { help: true };
  const base = loadConfigFile(values.config ?? DEFAULT_CONFIG_PATH);

  const parseJson = (flag, s) => {
    try { return JSON.parse(s); } catch (e) { throw new Error(`--${flag}: невалиден JSON (${e.message})`); }
  };
  const inputs = values.inputs ? parseJson('inputs', values.inputs) : {};
  if (values.overrides) inputs.overrides = parseJson('overrides', values.overrides);
  for (const [flag, k] of Object.entries(FLAG_INPUTS)) if (values[flag] !== undefined) inputs[k] = values[flag];
  const forced = inputsToOverrides(inputs);
  if (values['engine-path']) forced.engine.path = values['engine-path'];
  if (values.workers !== undefined) forced.engine.workers = coerce(ENGINE_SPEC.workers, values.workers);
  if (values['cache-dir']) forced.cache.dir = values['cache-dir'];
  if (values['no-cache']) forced.cache.use = false;
  if (values.tree) forced.output.tree = values.tree;
  if (values.out) forced.output.dir = values.out;
  if (values.report) forced.output.report = values.report;
  const cfg = resolveConfig(base, forced);

  if (values['data-version'] && !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(values['data-version'])) {
    throw new Error('--data-version: очаква се YYYY-MM-DD.N');
  }
  if (values.built && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(values.built)) {
    throw new Error('--built: очаква се ISO UTC без милисекунди, напр. 2026-12-01T10:12:00Z');
  }
  return {
    help: false,
    quiet: !!values.quiet,
    catalog: values.catalog ?? null,
    dataVersion: values['data-version'] ?? null,
    built: values.built ?? null,
    config: cfg,
  };
}
