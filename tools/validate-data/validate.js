// Валидатор на данните на приложението (T-015, ARCH_T-014 §3):
// data/catalog.json, data/manifest.json, data/courses/<id>.json и тестовите
// данни в data/fixtures/. Функциите не хвърлят при грешни данни — връщат
// списък с грешки на български (`<файл>: <къде>: <какво>`).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, basename } from 'node:path';
import {
  START_FEN, Position, ChessError, applySans, key as posKey, lineId,
} from '../../src/chess/position.js';
import {
  check, LIMITS, CATALOG_SCHEMA, COURSE_SCHEMA, MANIFEST_SCHEMA,
} from './schema.js';
import { isPrefix } from './openings.js';

const START_KEY = posKey(START_FEN);
const SIDE_BG = { w: 'белите', b: 'черните' };

/** Кой е на ход след `ply` полухода от началната позиция. */
const moverAt = (ply) => (ply % 2 === 0 ? 'w' : 'b');

/**
 * Строг PGN запис във формата на lichess chess-openings: „1. e4 e5 2. Nf3 Nc6“.
 * Номерата трябва да са поредни, с „. “ след тях; празен низ = началната позиция.
 * Връща SAN токените (без проверка на легалност) или хвърля Error с обяснение.
 */
export function parseStrictPgn(text) {
  if (typeof text !== 'string') throw new Error('очаква се низ');
  if (text === '') return [];
  if (text !== text.trim() || /\s{2,}|[\t\n]/.test(text)) {
    throw new Error('излишни интервали (форматът е „1. e4 e5 2. Nf3“)');
  }
  const tokens = text.split(' ');
  const NUM = /^\d+\.+$/;
  const sans = [];
  let moveNo = 1;
  for (let i = 0; i < tokens.length;) {
    if (tokens[i] !== `${moveNo}.`) {
      throw new Error(`очаква се „${moveNo}.“ на позиция ${i + 1}, а е „${tokens[i]}“ (форматът е „1. e4 e5 2. Nf3“)`);
    }
    const w = tokens[i + 1];
    if (w === undefined || NUM.test(w)) throw new Error(`липсва ход на белите след „${moveNo}.“`);
    sans.push(w);
    i += 2;
    if (i < tokens.length) {
      if (NUM.test(tokens[i])) throw new Error(`липсва ход на черните след „${moveNo}. ${w}“`);
      sans.push(tokens[i]);
      i++;
    }
    moveNo++;
  }
  return sans;
}

/** Прилага ходовете строго; връща {sans, keys, fen} или {error}. */
function playStrict(sans) {
  try {
    return applySans(sans, START_FEN, { strict: true });
  } catch (e) {
    if (e instanceof ChessError) return { error: e.message };
    throw e;
  }
}

/** Ключът на позицията преди полуход `ply` (0 = началната). */
const keyBefore = (keys, ply) => (ply === 0 ? START_KEY : keys[ply - 1]);

// ---------------------------------------------------------------------------
// catalog.json
// ---------------------------------------------------------------------------

/**
 * Проверява каталога. `openings` — от loadOpenings().
 * Връща {errors, courses: Map(id → {side, start: [san], book: [[san]]})}.
 */
export function validateCatalog(catalog, { openings, file = 'data/catalog.json' } = {}) {
  const errors = [];
  const courses = new Map();
  const schemaErrors = [];
  check(CATALOG_SCHEMA, catalog, 'catalog', schemaErrors);
  errors.push(...schemaErrors.map((e) => `${file}: ${e}`));
  if (!catalog || !Array.isArray(catalog.courses) || !Array.isArray(catalog.groups)) return { errors, courses };

  // групи
  const groupIds = new Set();
  catalog.groups.forEach((g, i) => {
    if (!Array.isArray(g) || typeof g[0] !== 'string') return;
    if (groupIds.has(g[0])) errors.push(`${file}: groups[${i}]: повторена група „${g[0]}“`);
    groupIds.add(g[0]);
  });
  const usedGroups = new Set();
  const names = new Set();

  catalog.courses.forEach((c, i) => {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') return;
    const where = `${file}: курс „${c.id}“`;
    const err = (msg) => errors.push(`${where}: ${msg}`);
    if (courses.has(c.id)) { err(`повторено id (courses[${i}])`); return; }
    if (typeof c.group === 'string') {
      usedGroups.add(c.group);
      if (!groupIds.has(c.group)) err(`групата „${c.group}“ я няма в groups`);
    }
    const nameKey = `${c.side}|${c.name?.bg}`;
    if (names.has(nameKey)) err(`повторено българско име „${c.name?.bg}“ за ${SIDE_BG[c.side] || c.side}`);
    names.add(nameKey);

    // start
    let startSans = null;
    try {
      const toks = parseStrictPgn(c.start);
      const r = playStrict(toks);
      if (r.error) err(`start „${c.start}“: ${r.error}`);
      else startSans = r.sans;
    } catch (e) {
      err(`start „${c.start}“: ${e.message}`);
    }

    // book
    const books = [];
    let bookFailed = false;
    const bookMove = new Map(); // ключ преди моя ход → san
    (Array.isArray(c.book) ? c.book : []).forEach((text, bi) => {
      const berr = (msg) => err(`book[${bi}] „${text}“: ${msg}`);
      let toks;
      try { toks = parseStrictPgn(text); } catch (e) { berr(e.message); bookFailed = true; return; }
      const r = playStrict(toks);
      if (r.error) { berr(r.error); bookFailed = true; return; }
      if (startSans && !(isPrefix(startSans, r.sans) && r.sans.length > startSans.length)) {
        berr(`трябва да започва със start „${c.start}“ и да го продължава`);
        return;
      }
      if (moverAt(r.sans.length - 1) !== c.side) {
        berr(`трябва да завършва с ход на ${SIDE_BG[c.side]} (моята страна)`);
      }
      for (let ply = startSans ? startSans.length : 0; ply < r.sans.length; ply++) {
        if (moverAt(ply) !== c.side) continue;
        const k = keyBefore(r.keys, ply);
        const prev = bookMove.get(k);
        if (prev && prev !== r.sans[ply]) {
          berr(`противоречи на друг book ред: в една и съща позиция „${prev}“ и „${r.sans[ply]}“`);
        }
        bookMove.set(k, r.sans[ply]);
      }
      books.push(r.sans);
    });

    // ECO и английско име срещу lichess chess-openings
    if (openings && typeof c.eco === 'string' && typeof c.name?.en === 'string') {
      const paths = openings.byPair.get(`${c.eco}\t${c.name.en}`);
      if (!paths) {
        const sameName = [...openings.byPair.keys()].filter((k) => k.endsWith(`\t${c.name.en}`)).map((k) => k.split('\t')[0]);
        err(`(eco „${c.eco}“, name.en „${c.name.en}“) го няма в lichess chess-openings`
          + (sameName.length ? `; това име е с ECO ${[...new Set(sameName)].join(', ')}` : ''));
      } else if (startSans && !bookFailed) {
        const coursePaths = [startSans, ...books];
        const ok = paths.some((p) => coursePaths.some((cp) => isPrefix(p, cp)));
        if (!ok) {
          err(`ECO „${c.eco} ${c.name.en}“ (${paths.map((p) => p.join(' ')).join(' | ')}) не е по пътя на start/book на курса`);
        }
      }
    }

    courses.set(c.id, { side: c.side, start: startSans || [], book: books, entry: c });
  });

  for (const g of groupIds) {
    if (!usedGroups.has(g)) errors.push(`${file}: групата „${g}“ не се ползва от нито един курс`);
  }
  return { errors, courses };
}

// ---------------------------------------------------------------------------
// courses/<id>.json
// ---------------------------------------------------------------------------

/**
 * Проверява един курс. `ctx`: {file, catalogCourse ({side, start}), dataVersion, sample, openings}.
 * Връща {errors, coverage (Σp), lines (брой)}.
 */
export function validateCourse(course, ctx = {}) {
  const file = ctx.file || 'course';
  const errors = [];
  const schemaErrors = [];
  check(COURSE_SCHEMA, course, 'course', schemaErrors);
  errors.push(...schemaErrors.map((e) => `${file}: ${e}`));
  const out = { errors, coverage: 0, lines: 0 };
  if (!course || typeof course !== 'object' || !Array.isArray(course.lines)) return out;
  const err = (msg) => errors.push(`${file}: ${msg}`);
  const id = course.id;

  if (ctx.expectedId !== undefined && id !== ctx.expectedId) err(`id „${id}“ не съвпада с името на файла / manifest („${ctx.expectedId}“)`);
  const cat = ctx.catalogCourse;
  if (ctx.catalogCourse === null) err(`курсът „${id}“ го няма в data/catalog.json`);
  if (cat) {
    if (course.side !== cat.side) err(`side „${course.side}“, а в каталога е „${cat.side}“`);
    if (Array.isArray(course.start) && course.start.join(' ') !== cat.start.join(' ')) {
      err(`start [${course.start.join(' ')}] не съвпада с каталога [${cat.start.join(' ')}]`);
    }
  }
  if (ctx.dataVersion !== undefined && course.dataVersion !== ctx.dataVersion) {
    err(`dataVersion „${course.dataVersion}“ ≠ manifest „${ctx.dataVersion}“`);
  }
  if (ctx.sample !== undefined && (course.sample === true) !== ctx.sample) {
    err(ctx.sample ? 'тестовите курсове трябва да имат "sample": true' : 'истински курс не може да е "sample": true');
  }
  const side = course.side;
  const start = Array.isArray(course.start) ? course.start : [];

  // ---- всяка линия поотделно ----
  const played = new Map(); // line.id → {line, keys, fen}
  const byN = new Map();
  const seenMoves = new Map();
  let sumP = 0;
  course.lines.forEach((line, i) => {
    if (!line || typeof line !== 'object' || !Array.isArray(line.m)) return;
    const where = `линия ${line.n ?? '?'} (${line.id ?? `lines[${i}]`})`;
    const lerr = (msg) => err(`${where}: ${msg}`);
    if (typeof line.p === 'number') sumP += line.p;

    if (typeof line.id === 'string') {
      if (played.has(line.id)) lerr('повторено id');
      if (typeof id === 'string' && line.m.every((s) => typeof s === 'string')) {
        const expect = lineId(id, line.m);
        if (line.id !== expect) lerr(`id не съвпада с sha1(courseId|ходове)[:8]: очаква се „${expect}“`);
      }
    }
    if (Number.isInteger(line.n)) {
      if (byN.has(line.n)) lerr(`повторен номер n=${line.n}`);
      byN.set(line.n, line);
    }
    const mKey = line.m.join(' ');
    if (seenMoves.has(mKey)) lerr(`същите ходове като линия ${seenMoves.get(mKey)}`);
    seenMoves.set(mKey, line.n);

    if (!line.m.every((s) => typeof s === 'string')) return;
    if (!(isPrefix(start, line.m) && line.m.length > start.length)) {
      lerr(`ходовете трябва да започват със start [${start.join(' ')}] и да го продължават`);
    }
    const r = playStrict(line.m);
    if (r.error) { lerr(r.error); return; }
    if (side === 'w' || side === 'b') {
      if (moverAt(line.m.length - 1) !== side) lerr(`линията трябва да завършва с ход на ${SIDE_BG[side]} (моята страна)`);
    }
    const final = new Position(r.fen);
    if (line.end === 'mate' && !final.isCheckmate()) lerr('end „mate“, а крайната позиция не е мат');
    if (line.end !== 'mate' && final.isCheckmate()) lerr(`крайната позиция е мат, а end е „${line.end}“`);
    if (line.end === 'draw' && final.isCheckmate()) lerr('end „draw“ при мат');
    if (line.end === 'transpose') {
      if (typeof line.to !== 'string') lerr('end „transpose“ изисква поле „to“');
    } else if ('to' in line) {
      lerr(`поле „to“ е позволено само при end „transpose“ (тук е „${line.end}“)`);
    }
    if (Number.isInteger(line.tail)) {
      if (line.tail < start.length || line.tail >= line.m.length) {
        lerr(`tail ${line.tail} е извън ходовете след start (${start.length}…${line.m.length - 1})`);
      } else if ((side === 'w' || side === 'b') && moverAt(line.tail) === side) {
        lerr(`tail ${line.tail} трябва да сочи ход на противника (опашката почва с неговия ход)`);
      }
    }
    if (Array.isArray(line.c) && line.c.length !== line.m.length) {
      lerr(`c (коментари) има ${line.c.length} елемента, а ходовете са ${line.m.length}`);
    }
    if (Array.isArray(line.c)) {
      line.c.forEach((t, ci) => { if (typeof t === 'string' && !t.trim()) lerr(`c[${ci}]: празен коментар (ползвай null)`); });
    }
    if (('eco' in line) !== ('name' in line)) lerr('eco и name вървят заедно (или и двете, или нито едно)');
    else if (ctx.openings && typeof line.eco === 'string' && typeof line.name === 'string'
      && !ctx.openings.byPair.has(`${line.eco}\t${line.name}`)) {
      lerr(`(eco „${line.eco}“, name „${line.name}“) го няма в lichess chess-openings`);
    }
    played.set(line.id, { line, keys: r.keys, where });
  });
  out.coverage = sumP;
  out.lines = course.lines.length;

  // ---- номерация и вероятности ----
  const N = course.lines.length;
  for (let n = 1; n <= N; n++) if (!byN.has(n)) err(`липсва линия с n=${n} (номерата трябва да са 1..${N})`);
  for (const n of byN.keys()) if (n > N) err(`n=${n} е извън 1..${N}`);
  for (let n = 2; n <= N; n++) {
    const a = byN.get(n - 1);
    const b = byN.get(n);
    if (a && b && typeof a.p === 'number' && typeof b.p === 'number' && b.p > a.p + 1e-12) {
      err(`линиите трябва да са подредени по p низходящо: n=${n} (${b.p}) > n=${n - 1} (${a.p})`);
    }
  }
  if (sumP > 1 + 1e-6) err(`сумата на p е ${sumP.toFixed(4)} > 1`);

  // ---- линия не е префикс на друга ----
  const all = [...played.values()];
  for (const A of all) {
    for (const B of all) {
      if (A !== B && A.line.m.length < B.line.m.length && isPrefix(A.line.m, B.line.m)) {
        err(`${A.where}: е префикс на ${B.where}`);
      }
    }
  }

  // ---- един и същ мой ход в една и съща позиция ----
  const myMove = new Map(); // key → {san, where}
  for (const P of all) {
    for (let ply = start.length; ply < P.line.m.length; ply++) {
      if (moverAt(ply) !== side) continue;
      const k = keyBefore(P.keys, ply);
      const san = P.line.m[ply];
      const prev = myMove.get(k);
      if (prev && prev.san !== san) {
        err(`${P.where}: в позицията след [${P.line.m.slice(0, ply).join(' ')}] моят ход е „${san}“, а в ${prev.where} — „${prev.san}“ (трябва да е един и същ)`);
      } else if (!prev) myMove.set(k, { san, where: P.where });
    }
  }

  // ---- транспозиции ----
  for (const P of all) {
    if (P.line.end !== 'transpose' || typeof P.line.to !== 'string') continue;
    const T = played.get(P.line.to);
    if (!T) {
      const exists = course.lines.some((l) => l && l.id === P.line.to);
      err(`${P.where}: „to“ сочи ${exists ? 'невалидна' : 'несъществуваща'} линия „${P.line.to}“`);
      continue;
    }
    if (T === P) { err(`${P.where}: „to“ сочи самата линия`); continue; }
    const endKey = P.keys[P.keys.length - 1];
    const k = T.keys.indexOf(endKey);
    if (k < 0) err(`${P.where}: крайната позиция я няма в линията „to“ (${T.where})`);
    else if (k >= T.keys.length - 1) err(`${P.where}: линията „to“ (${T.where}) свършва в същата позиция и не я продължава`);
  }
  // цикли по „to“
  for (const P of all) {
    const seen = new Set();
    let cur = P;
    while (cur && cur.line.end === 'transpose') {
      if (seen.has(cur.line.id)) { err(`${P.where}: цикъл от препратки „to“`); break; }
      seen.add(cur.line.id);
      cur = played.get(cur.line.to);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// manifest.json + файловете на курсовете
// ---------------------------------------------------------------------------

function readJson(path, maxBytes, errors, label) {
  if (!existsSync(path)) { errors.push(`${label}: файлът липсва`); return null; }
  const buf = readFileSync(path);
  if (buf.length > maxBytes) errors.push(`${label}: ${buf.length} B > лимита ${maxBytes} B`);
  try {
    return { json: JSON.parse(buf.toString('utf8')), buf };
  } catch (e) {
    errors.push(`${label}: невалиден JSON (${e.message})`);
    return null;
  }
}

/**
 * Проверява manifest и всички курсове в него.
 * opts: {root (за относителни пътища в съобщенията), catalogCourses (Map от validateCatalog),
 *        openings, expectSample (true за data/fixtures/, false за data/)}.
 */
export function validateManifest(manifestPath, opts) {
  const { root = process.cwd(), catalogCourses, openings, expectSample } = opts;
  const rel = (p) => relative(root, p).split('\\').join('/') || p;
  const errors = [];
  const label = rel(manifestPath);
  const r = readJson(manifestPath, LIMITS.manifestBytes, errors, label);
  const summary = { courses: 0, lines: 0, bytes: 0, sample: null };
  if (!r) return { errors, summary };
  const m = r.json;
  const schemaErrors = [];
  check(MANIFEST_SCHEMA, m, 'manifest', schemaErrors);
  errors.push(...schemaErrors.map((e) => `${label}: ${e}`));
  if (!m || typeof m !== 'object' || !Array.isArray(m.courses)) return { errors, summary };
  const sample = m.sample === true;
  summary.sample = sample;
  if (expectSample === true && !sample) errors.push(`${label}: тестовите данни трябва да имат "sample": true`);
  if (expectSample === false && sample) errors.push(`${label}: "sample": true е позволено само за тестови данни (data/fixtures/)`);
  if (!sample) {
    for (const k of ['generator', 'engine', 'source', 'params']) {
      if (!(k in m)) errors.push(`${label}: липсва поле „${k}“ (задължително за генерирани данни)`);
    }
  }

  const dir = join(manifestPath, '..');
  const ids = new Set();
  const listed = new Set();
  for (const [i, e] of m.courses.entries()) {
    if (!e || typeof e.id !== 'string' || typeof e.file !== 'string') continue;
    const where = `${label}: courses[${i}] „${e.id}“`;
    if (ids.has(e.id)) { errors.push(`${where}: повторено id`); continue; }
    ids.add(e.id);
    const catalogCourse = catalogCourses ? (catalogCourses.get(e.id) ?? null) : undefined;
    if (catalogCourse === null) errors.push(`${where}: курсът го няма в data/catalog.json`);
    if (e.file !== `courses/${e.id}.json`) {
      errors.push(`${where}: file трябва да е „courses/${e.id}.json“, а е „${e.file}“`);
      continue;
    }
    const path = join(dir, e.file);
    listed.add(basename(path));
    const cr = readJson(path, LIMITS.courseBytes, errors, rel(path));
    if (!cr) continue;
    summary.bytes += cr.buf.length;
    const sha = createHash('sha256').update(cr.buf).digest('hex');
    if (typeof e.sha256 === 'string' && sha !== e.sha256) {
      errors.push(`${where}: sha256 не съвпада с файла (файлът е ${sha})`);
    }
    const res = validateCourse(cr.json, {
      file: rel(path), expectedId: e.id, catalogCourse: catalogCourse ?? undefined,
      dataVersion: m.dataVersion, sample, openings,
    });
    errors.push(...res.errors);
    if (Number.isInteger(e.lines) && e.lines !== res.lines) {
      errors.push(`${where}: lines ${e.lines}, а във файла са ${res.lines}`);
    }
    if (typeof e.coverage === 'number' && Math.abs(e.coverage - res.coverage) > 0.001) {
      errors.push(`${where}: coverage ${e.coverage}, а сумата на p е ${res.coverage.toFixed(4)}`);
    }
    summary.courses++;
    summary.lines += res.lines;
  }
  if (summary.bytes > LIMITS.totalCourseBytes) {
    errors.push(`${label}: общият размер на курсовете ${summary.bytes} B > ${LIMITS.totalCourseBytes} B`);
  }
  const cdir = join(dir, 'courses');
  if (existsSync(cdir) && statSync(cdir).isDirectory()) {
    for (const f of readdirSync(cdir).sort()) {
      if (!listed.has(f)) errors.push(`${rel(join(cdir, f))}: файлът не е в manifest (излишен или забравен)`);
    }
  }
  return { errors, summary };
}

/**
 * Проверява всичко под `root`: data/catalog.json, data/manifest.json (ако има генерирани
 * данни) и data/fixtures/manifest.json (тестови). Връща {errors, info: [низове]}.
 */
export function validateAll({ root, openings, catalogPath, manifests } = {}) {
  const errors = [];
  const info = [];
  const rel = (p) => relative(root, p).split('\\').join('/');
  catalogPath ||= join(root, 'data', 'catalog.json');
  const cr = readJson(catalogPath, LIMITS.catalogBytes, errors, rel(catalogPath));
  let catalogCourses;
  if (cr) {
    const res = validateCatalog(cr.json, { openings, file: rel(catalogPath) });
    errors.push(...res.errors);
    catalogCourses = res.courses;
    const list = Array.isArray(cr.json?.courses) ? cr.json.courses : [];
    const by = (s) => list.filter((c) => c?.side === s).length;
    info.push(`${rel(catalogPath)}: ${list.length} курса (бели ${by('w')}, черни ${by('b')}), по подразбиране ${list.filter((c) => c?.default === true).length}`);
  }
  if (!manifests) {
    manifests = [];
    const real = join(root, 'data', 'manifest.json');
    if (existsSync(real)) manifests.push({ path: real, expectSample: false });
    else {
      info.push('data/manifest.json липсва — още няма генерирани курсове (T-017), пропуска се');
      if (existsSync(join(root, 'data', 'courses'))) errors.push('data/courses/ съществува без data/manifest.json');
    }
    const fx = join(root, 'data', 'fixtures', 'manifest.json');
    if (existsSync(fx)) manifests.push({ path: fx, expectSample: true });
  }
  for (const { path, expectSample } of manifests) {
    const res = validateManifest(path, { root, catalogCourses, openings, expectSample });
    errors.push(...res.errors);
    const s = res.summary;
    info.push(`${rel(path)}: ${s.courses} курса, ${s.lines} линии, ${(s.bytes / 1024).toFixed(1)} KB${s.sample ? ' (ТЕСТОВИ ДАННИ)' : ''}`);
  }
  return { errors, info };
}
