// Оркестрация на build-courses (T-016): дърво + каталог + двигател → data/courses/<id>.json,
// data/manifest.json и отчет. Курсовете се генерират паралелно (общ пул и общ кеш);
// резултатът на всеки курс не зависи от другите и от реда на изчисленията.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTree } from '../build-tree/tree-file.js';
import { loadOpenings } from '../validate-data/openings.js';
import { validateCatalog, validateManifest } from '../validate-data/validate.js';
import { courseParams, effectiveWorkers, effectiveTimeout } from './config.js';
import { EvalCache, cachePrefix } from './eval-cache.js';
import { Evaluator } from './evaluator.js';
import { EnginePool } from './pool.js';
import { buildNameIndex } from './names.js';
import { generateCourse } from './generate.js';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Курсът във формата на make-sample (един ред на линия — четим diff в PR). */
export function stringifyCourse(course) {
  const head = Object.entries(course).filter(([k]) => k !== 'lines')
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const lines = course.lines.map((l) => `    ${JSON.stringify(l)}`).join(',\n');
  return `{\n${head.join(',\n')},\n  "lines": [\n${lines}\n  ]\n}\n`;
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
}

function readJsonIf(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
}

/** dataVersion: днешната дата (по built) + .N, като N расте спрямо стария manifest. */
export function nextDataVersion(built, prev) {
  const day = built.slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(prev ?? '');
  return `${day}.${m && m[1] === day ? Number(m[2]) + 1 : 1}`;
}

/**
 * Пуска генерирането. opts: {config (resolveConfig), catalogPath, dataVersion, built, log, signal}.
 * Връща {manifest, report, results, errors (от валидатора)}.
 */
export async function buildCourses(opts) {
  const cfg = opts.config;
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const outDir = resolve(cfg.output.dir);
  const catalogPath = resolve(opts.catalogPath ?? join(REPO_ROOT, 'data', 'catalog.json'));

  // ---- каталог ----
  const openings = loadOpenings();
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const vc = validateCatalog(catalog, { openings, file: catalogPath });
  if (vc.errors.length) throw new Error(`каталогът не е валиден:\n  ${vc.errors.join('\n  ')}`);
  const wanted = cfg.lines.courses === 'all' ? catalog.courses.map((c) => c.id) : cfg.lines.courses;
  const unknown = wanted.filter((id) => !vc.courses.has(id));
  if (unknown.length) throw new Error(`непознати курсове: ${unknown.join(', ')}`);

  // ---- дърво ----
  const treePath = resolve(cfg.output.tree);
  const tt = Date.now();
  const { manifest: treeManifest, nodes: tree } = await readTree(treePath);
  log(`дърво: ${tree.size} позиции (${((Date.now() - tt) / 1000).toFixed(1)} s)`);
  const warnings = [];
  const treeMaxPly = treeManifest.params?.maxPly;
  if (treeMaxPly && cfg.lines.maxPly > treeMaxPly) warnings.push(`lines.maxPly ${cfg.lines.maxPly} > tree.maxPly ${treeMaxPly}`);

  // ---- двигател и кеш ----
  const engine = cfg.engine;
  const workers = effectiveWorkers(engine);
  const prefix = cachePrefix(engine);
  const cache = await new EvalCache(cfg.cache.dir ? resolve(cfg.cache.dir) : null, prefix, { flushEvery: cfg.cache.flushEvery }).load();
  log(`кеш: ${cache.loaded} оценки (${prefix})${cfg.cache.use ? '' : ' — НЕ се чете (cache.use=false)'}`);
  let pool = null;
  const getPool = () => {
    if (!pool) {
      pool = new EnginePool({
        path: engine.path, args: engine.args, workers, threads: 1, hashMb: engine.hashMb, multiPV: engine.multiPV,
        nodes: engine.nodes, timeoutMs: effectiveTimeout(engine), retries: engine.retries,
        expectId: `${engine.name} ${engine.version}`, log,
      });
      log(`двигател: ${engine.path} × ${workers} процеса, ${engine.nodes} възли, MultiPV ${engine.multiPV}`);
    }
    return pool;
  };
  const evaluator = new Evaluator({ cache, getPool, useCache: cfg.cache.use });
  const names = buildNameIndex(openings);
  const onSignal = () => { log('прекъсване — записвам кеша и спирам двигателите'); pool?.close(); };
  opts.signal?.addEventListener('abort', onSignal);

  // ---- курсове ----
  const progress = setInterval(() => {
    const s = evaluator.stats;
    log(`… оценки ${s.requests} (кеш ${s.hits}, двигател ${s.misses})`);
  }, 30_000);
  progress.unref();
  let results;
  try {
    results = await Promise.all(wanted.map(async (id) => {
      const cat = vc.courses.get(id);
      const params = courseParams(cfg, cat.entry.params);
      const r = await generateCourse({
        courseId: id, side: cat.side, startSans: cat.start, bookLines: cat.book, params, tree, evaluator, names,
      });
      log(`✓ ${id}: ${r.lines.length} линии, покритие ${r.stats.coverage}, ${r.stats.evals} оценки, ${(r.stats.ms / 1000).toFixed(1)} s`);
      return { id, cat, params, ...r };
    }));
  } finally {
    clearInterval(progress);
    opts.signal?.removeEventListener('abort', onSignal);
    cache.save();
    await pool?.close();
  }

  // ---- запис ----
  const built = opts.built ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const manifestPath = join(outDir, 'manifest.json');
  const prevManifest = readJsonIf(manifestPath);
  const prevCourses = new Map();
  for (const e of prevManifest?.courses ?? []) {
    const c = readJsonIf(join(outDir, e.file));
    if (c) prevCourses.set(e.id, c);
  }
  const dataVersion = opts.dataVersion ?? nextDataVersion(built, prevManifest?.dataVersion);
  mkdirSync(join(outDir, 'courses'), { recursive: true });
  const entries = [];
  const skipped = results.filter((r) => !r.lines.length).map((r) => r.id);
  if (skipped.length) warnings.push(`курсове без линии (не са записани): ${skipped.join(', ')}`);
  results = results.filter((r) => r.lines.length);
  for (const r of results) {
    const course = { v: 1, id: r.id, side: r.cat.side, dataVersion, start: r.cat.start, lines: r.lines };
    const text = stringifyCourse(course);
    writeFileSync(join(outDir, 'courses', `${r.id}.json`), text);
    entries.push({
      id: r.id, file: `courses/${r.id}.json`, sha256: createHash('sha256').update(text).digest('hex'),
      lines: r.lines.length, coverage: r.stats.coverage,
    });
  }
  const keep = new Set(results.map((r) => `${r.id}.json`));
  const removed = [];
  for (const f of readdirSync(join(outDir, 'courses'))) {
    if (f.endsWith('.json') && !keep.has(f)) { unlinkSync(join(outDir, 'courses', f)); removed.push(f); }
  }
  const perCourse = {};
  for (const r of results) {
    const diff = Object.fromEntries(Object.entries(r.params).filter(([k, v]) => cfg.lines[k] !== v));
    if (Object.keys(diff).length) perCourse[r.id] = diff;
  }
  const s = treeManifest.stats ?? {};
  const tp = treeManifest.params ?? {};
  const manifest = {
    v: 1,
    dataVersion,
    built,
    generator: { tool: 'tools/build-courses', commit: gitCommit(), node: process.version },
    engine: {
      name: engine.name, version: engine.version, id: pool?.idName ?? null, url: engine.url, sha256: engine.sha256,
      nodes: engine.nodes, multiPV: engine.multiPV, hashMb: engine.hashMb, threads: 1, workers,
      nps: pool && pool.nps() ? pool.nps() : null,
    },
    source: {
      month: treeManifest.source?.month ?? null,
      gamesRead: s.gamesRead ?? null, gamesAccepted: s.gamesAccepted ?? null, stoppedBy: s.stoppedBy ?? null,
      positions: tree.size, treeParamsHash: treeManifest.paramsHash ?? null,
      filters: {
        minElo: tp.minElo, maxElo: tp.maxElo, minBaseSec: tp.minBaseSec, maxBaseSec: tp.maxBaseSec,
        ratedOnly: tp.ratedOnly, maxPly: tp.maxPly, minGames: tp.minGames,
      },
    },
    params: {
      lines: { ...cfg.lines },
      courses: perCourse,
      engine: { nodes: engine.nodes, multiPV: engine.multiPV, hashMb: engine.hashMb, workers, timeoutMs: effectiveTimeout(engine) },
      cache: { use: cfg.cache.use, prefix },
    },
    courses: entries,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // ---- самопроверка с валидатора (T-015) ----
  const vm = validateManifest(manifestPath, { root: dirname(outDir), catalogCourses: vc.courses, openings, expectSample: false });

  const totals = {
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    evals: evaluator.stats, cacheLoaded: cache.loaded, cacheSize: cache.map.size,
    pool: pool ? { ...pool.stats, nps: pool.nps(), id: pool.idName } : null,
    workers, removed, warnings,
  };
  const report = renderReport({ manifest, results, prevCourses, totals, errors: vm.errors });
  if (cfg.output.report) {
    mkdirSync(dirname(resolve(cfg.output.report)), { recursive: true });
    writeFileSync(resolve(cfg.output.report), report);
  }
  return { manifest, report, results, totals, errors: vm.errors };
}

function renderReport({ manifest, results, prevCourses, totals, errors }) {
  const L = [];
  const e = manifest.engine;
  const src = manifest.source;
  L.push(`# Генериране на курсове — ${manifest.dataVersion}`, '');
  L.push(`- Построено: ${manifest.built}, commit ${manifest.generator.commit ?? '?'}, Node ${manifest.generator.node}`);
  L.push(`- Дърво: ${src.month ?? '?'}, приети партии ${src.gamesAccepted ?? '?'} (прочетени ${src.gamesRead ?? '?'}), позиции ${src.positions}`);
  L.push(`- Двигател: ${e.id ?? `${e.name} ${e.version} (не е стартиран — всичко от кеша)`}, ${e.nodes} възли, MultiPV ${e.multiPV}, Hash ${e.hashMb} MB, ${e.workers} × 1 нишка`);
  const ev = totals.evals;
  L.push(`- Оценки: ${ev.requests} заявки, от кеша ${ev.hits}, от двигателя ${ev.misses}; кеш ${totals.cacheLoaded} → ${totals.cacheSize} записа`);
  if (totals.pool) {
    const p = totals.pool;
    L.push(`- Двигател: ${p.analyses} изчисления, ${p.nps} nps на процес, рестарти ${p.restarts} (таймаути ${p.timeouts}, сривове ${p.crashes})`);
  }
  L.push(`- Общо време: ${totals.seconds} s`, '');
  L.push('| Курс | Линии | adv | depth | data | transpose | mate/draw | Покритие Σp | Ср. полуходове | Оценки | book/попул./двиг. | Време s | Нови / махнати / същите |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const st = r.stats;
    const en = (k) => st.ends[k] ?? 0;
    const prev = prevCourses.get(r.id);
    let diff = '—';
    if (prev) {
      const a = new Set(prev.lines.map((l) => l.id));
      const b = new Set(r.lines.map((l) => l.id));
      diff = `+${[...b].filter((x) => !a.has(x)).length} / −${[...a].filter((x) => !b.has(x)).length} / ${[...b].filter((x) => a.has(x)).length}`;
    }
    L.push(`| ${r.id} | ${st.lines} | ${en('adv')} | ${en('depth')} | ${en('data')} | ${en('transpose')} | ${en('mate') + en('draw')} | ${st.coverage} | ${st.avgPly} | ${st.evals} | ${st.myMoves.book}/${st.myMoves.popular}/${st.myMoves.engine} | ${(st.ms / 1000).toFixed(1)} | ${diff} |`);
  }
  const warn = [...totals.warnings, ...results.flatMap((r) => r.stats.warnings.map((w) => `${r.id}: ${w}`))];
  if (totals.removed.length) warn.push(`махнати стари файлове: ${totals.removed.join(', ')}`);
  if (warn.length) { L.push('', '## Предупреждения', ''); for (const w of warn) L.push(`- ${w}`); }
  if (errors.length) { L.push('', '## Грешки на валидатора', ''); for (const x of errors) L.push(`- ${x}`); }
  L.push('');
  return L.join('\n');
}
