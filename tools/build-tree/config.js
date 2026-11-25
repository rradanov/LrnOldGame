// Параметри на build-tree: подразбиране → config.json → CLI флагове.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), 'config.json');

/** Граници на числовите параметри (ARCH_T-014 §6.2). */
const LIMITS = {
  maxGames: [1, 50_000_000],
  minElo: [0, 4000],
  maxElo: [0, 4000],
  minBaseSec: [0, 10_800],
  maxBaseSec: [0, 10_800],
  maxPly: [1, 60],
  minGames: [1, 1_000_000],
  minGamesPerMove: [1, 1_000_000],
  workers: [0, 32],
  pruneEveryGames: [100, 50_000_000],
  batchSize: [1, 100_000],
};

/** CLI флаг → ключ в tree (числа). */
const NUM_FLAGS = {
  'max-games': 'maxGames', 'min-elo': 'minElo', 'max-elo': 'maxElo',
  'min-base-sec': 'minBaseSec', 'max-base-sec': 'maxBaseSec', 'max-ply': 'maxPly',
  'min-games': 'minGames', 'min-games-per-move': 'minGamesPerMove', workers: 'workers',
  'prune-every-games': 'pruneEveryGames', 'batch-size': 'batchSize',
};

export const USAGE = `Употреба: node tools/build-tree [опции] [--input файл.pgn | < поток]
  --out <път>               изходен файл (по подразбиране build/tree.jsonl.gz)
  --config <път>            JSON конфиг (по подразбиране tools/build-tree/config.json)
  --input <път|->           PGN файл; „-“ или без флаг = stdin
  --month <YYYY-MM>         месец на архива (само за manifest)
  --max-games N             спиране след N приети партии (D-014)
  --min-elo N --max-elo N   и двамата играчи в [min, max]; max 0 = без граница
  --min-base-sec N --max-base-sec N   базово време (сек.); max 0 = без граница
  --include-casual          и нерейтингови партии
  --include-correspondence  и кореспондентни („-“)
  --exclude-terminations a,b  Termination стойности за отхвърляне
  --max-ply N  --min-games N  --min-games-per-move N
  --workers N (0 = CPU)  --prune-every-games N  --batch-size N
  --quiet                   без прогрес в stderr
  --help`;

export function loadConfigFile(path = DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return { source: { ...(raw.source ?? {}) }, tree: { ...(raw.tree ?? {}) } };
}

/** Проверява и допълва параметрите; хвърля Error с ясен текст. */
export function resolveParams(tree) {
  const p = { ...tree };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = p[k];
    if (!Number.isInteger(v) || v < lo || v > hi) {
      throw new Error(`Параметър ${k}=${JSON.stringify(v)}: очаква се цяло число в [${lo}, ${hi}]`);
    }
  }
  if (p.maxElo > 0 && p.maxElo < p.minElo) throw new Error(`maxElo (${p.maxElo}) < minElo (${p.minElo})`);
  if (p.maxBaseSec > 0 && p.maxBaseSec < p.minBaseSec) throw new Error(`maxBaseSec < minBaseSec`);
  for (const k of ['ratedOnly', 'includeCorrespondence']) {
    if (typeof p[k] !== 'boolean') throw new Error(`Параметър ${k}: очаква се true/false`);
  }
  if (!Array.isArray(p.excludeTerminations) || !p.excludeTerminations.every((x) => typeof x === 'string')) {
    throw new Error('Параметър excludeTerminations: очаква се масив от низове');
  }
  return p;
}

/** Брой нишки: workers 0 → брой CPU (най-много 8). */
export function effectiveWorkers(p) {
  return p.workers > 0 ? p.workers : Math.min(8, availableParallelism());
}

/** Разбира argv; връща {help, quiet, input, out, source, tree}. */
export function parseCli(argv) {
  const options = {
    help: { type: 'boolean' }, quiet: { type: 'boolean' },
    config: { type: 'string' }, input: { type: 'string' }, out: { type: 'string' },
    month: { type: 'string' },
    'include-casual': { type: 'boolean' }, 'include-correspondence': { type: 'boolean' },
    'exclude-terminations': { type: 'string' },
  };
  for (const f of Object.keys(NUM_FLAGS)) options[f] = { type: 'string' };
  const { values } = parseArgs({ args: argv, options, allowPositionals: false, strict: true });
  const cfg = loadConfigFile(values.config ?? DEFAULT_CONFIG_PATH);
  const tree = cfg.tree;
  for (const [flag, k] of Object.entries(NUM_FLAGS)) {
    if (values[flag] === undefined) continue;
    const s = values[flag].replace(/_/g, '');
    if (!/^\d+$/.test(s)) throw new Error(`--${flag}: очаква се цяло число, а не „${values[flag]}“`);
    tree[k] = Number(s);
  }
  if (values['include-casual']) tree.ratedOnly = false;
  if (values['include-correspondence']) tree.includeCorrespondence = true;
  if (values['exclude-terminations'] !== undefined) {
    tree.excludeTerminations = values['exclude-terminations'].split(',').map((s) => s.trim()).filter(Boolean);
  }
  const source = cfg.source;
  if (values.month) {
    if (!/^\d{4}-\d{2}$/.test(values.month)) throw new Error('--month: очаква се YYYY-MM');
    source.month = values.month;
  }
  return {
    help: !!values.help,
    quiet: !!values.quiet,
    input: values.input && values.input !== '-' ? values.input : null,
    out: values.out ?? 'build/tree.jsonl.gz',
    source,
    tree: resolveParams(tree),
  };
}
