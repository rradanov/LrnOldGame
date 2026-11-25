#!/usr/bin/env node
// Генерира ТЕСТОВИТЕ (фиктивни, но шахматно валидни) курсове в data/fixtures/
// за приложението (T-019/T-021), докато няма истински данни от T-017.
// Ходовете са ръчно избрани; p, cp и end са измислени. Не са резултат от lichess/Stockfish.
//
//   node tools/validate-data/make-sample.js          — записва файловете
//   node tools/validate-data/make-sample.js --check  — само сравнява (изход 1 при разлика)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgnToSans, lineId, START_FEN } from '../../src/chess/position.js';
import { loadOpenings, deepestName } from './openings.js';
import { parseStrictPgn } from './validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SAMPLE_DIR = join(ROOT, 'data', 'fixtures');
export const DATA_VERSION = '2026-11-25.0';
const BUILT = '2026-11-25T00:00:00Z';

// Линии: [ходове, p, end, cp, транспозиция към (ходовете на целевата линия) | null, коментари | null]
const SAMPLE = {
  italian: [
    ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. h3', 0.21, 'depth', 38, null,
      { 2: 'Развива коня и напада e5', 4: 'Офицерът гледа към f7', 6: 'Подготвя d4' }],
    ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Be7 5. O-O O-O 6. Re1 d6 7. c3', 0.09, 'depth', 31, null, null],
    ['1. e4 e5 2. Nf3 d6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3', 0.07, 'adv', 104, null, null],
    ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Bc5 5. c3', 0.06, 'transpose', 35,
      '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d3 d6 6. O-O O-O 7. h3', null],
    ['1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4 5. d4', 0.05, 'data', 42, null, null],
    ['1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Qe7 5. d4 Bb6 6. O-O', 0.02, 'adv', 112, null, null],
  ],
  'caro-kann': [
    ['1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5', 0.18, 'depth', -12, null,
      { 1: 'Подготвя d5', 3: 'Удря центъра', 5: 'Офицерът излиза преди e6' }],
    ['1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6', 0.12, 'depth', -25, null, null],
    ['1. e4 c6 2. d4 d5 3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6', 0.08, 'data', -8, null, null],
    ['1. e4 c6 2. Nc3 d5 3. d4 dxe4', 0.05, 'transpose', -25,
      '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6', null],
    ['1. e4 c6 2. Nf3 d5 3. Nc3 Bg4 4. h3 Bxf3 5. Qxf3 e6', 0.04, 'data', -20, null, null],
    ['1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nc3 e6 5. g4 Bg6 6. Nge2 c5', 0.03, 'data', -5, null, null],
  ],
  'vs-nf3': [
    ['1. Nf3 d5 2. g3 Nf6 3. Bg2 c6 4. O-O Bg4 5. d3 Nbd7 6. Nbd2 e5', 0.16, 'adv', -62, null, null],
    ['1. Nf3 d5 2. d4 Nf6 3. c4 c6', 0.14, 'data', -15, null, null],
    ['1. Nf3 d5 2. c4 c6 3. b3 Nf6 4. Bb2 Bf5', 0.09, 'data', -10, null, null],
    ['1. Nf3 d5 2. g3 Nf6 3. Bg2 c6 4. d3 Bg4 5. O-O Nbd7', 0.05, 'transpose', -30,
      '1. Nf3 d5 2. g3 Nf6 3. Bg2 c6 4. O-O Bg4 5. d3 Nbd7 6. Nbd2 e5', null],
    ['1. Nf3 d5 2. e3 Nf6 3. c4 c6', 0.04, 'data', -12, null, null],
  ],
};

const strictSans = (text) => pgnToSans(parseStrictPgn(text).join(' '), START_FEN, { strict: true });

function stringifyCourse(course) {
  const head = Object.entries(course).filter(([k]) => k !== 'lines')
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const lines = course.lines.map((l) => `    ${JSON.stringify(l)}`).join(',\n');
  return `{\n${head.join(',\n')},\n  "lines": [\n${lines}\n  ]\n}\n`;
}

/** Строи файловете в памет: Map(относителен път → съдържание). */
export function buildSample() {
  const openings = loadOpenings();
  const catalog = JSON.parse(readFileSync(join(ROOT, 'data', 'catalog.json'), 'utf8'));
  const files = new Map();
  const entries = [];
  for (const [id, defs] of Object.entries(SAMPLE)) {
    const cat = catalog.courses.find((c) => c.id === id);
    if (!cat) throw new Error(`курсът ${id} го няма в каталога`);
    const lines = defs.map(([pgn, p, end, cp, toPgn, comments]) => {
      const m = strictSans(pgn);
      const line = { id: lineId(id, m), n: 0, m, p, end };
      if (toPgn) line.to = lineId(id, strictSans(toPgn));
      line.cp = cp;
      const nm = deepestName(openings, m);
      if (nm) { line.eco = nm.eco; line.name = nm.name; }
      line.c = comments ? m.map((_, i) => comments[i] ?? null) : null;
      return line;
    });
    lines.sort((a, b) => b.p - a.p || a.m.join(' ').localeCompare(b.m.join(' ')));
    lines.forEach((l, i) => { l.n = i + 1; });
    const course = {
      v: 1, id, side: cat.side, dataVersion: DATA_VERSION, sample: true,
      start: strictSans(cat.start), lines,
    };
    const text = stringifyCourse(course);
    files.set(`courses/${id}.json`, text);
    entries.push({
      id, file: `courses/${id}.json`,
      sha256: createHash('sha256').update(text).digest('hex'),
      lines: lines.length,
      coverage: Math.round(lines.reduce((s, l) => s + l.p, 0) * 1e4) / 1e4,
    });
  }
  const manifest = {
    v: 1,
    sample: true,
    note: 'ТЕСТОВИ ДАННИ за разработка и e2e: ходовете са ръчно избрани, p/cp/end са измислени. Не са от lichess/Stockfish.',
    dataVersion: DATA_VERSION,
    built: BUILT,
    generator: { tool: 'tools/validate-data/make-sample.js' },
    engine: { name: 'none' },
    source: { kind: 'hand-written' },
    params: {},
    courses: entries,
  };
  files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return files;
}

/** Сравнява с файловете на диска; връща списък с разлики. */
export function diffSample(dir = SAMPLE_DIR) {
  const out = [];
  for (const [rel, text] of buildSample()) {
    const p = join(dir, rel);
    if (!existsSync(p)) out.push(`${rel}: липсва`);
    else if (readFileSync(p, 'utf8') !== text) out.push(`${rel}: различава се`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const d = diffSample();
    for (const x of d) process.stderr.write(`✗ data/fixtures/${x}\n`);
    process.exit(d.length ? 1 : 0);
  }
  for (const [rel, text] of buildSample()) {
    const p = join(SAMPLE_DIR, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    process.stdout.write(`записан data/fixtures/${rel}\n`);
  }
}
