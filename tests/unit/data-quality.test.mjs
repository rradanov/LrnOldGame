// T-018 (тестер): проверки на генерираните data/courses/*.json, които валидаторът не прави —
// book ходовете от каталога и праговете за край на линия от manifest.params.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySans, START_FEN } from '../../src/chess/position.js';
import { parseStrictPgn } from '../../tools/validate-data/validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const HAS_DATA = existsSync(join(ROOT, 'data/manifest.json'));
const CATALOG = readJson('data/catalog.json');
// T-022: book проверките имат смисъл само за данни, генерирани със същия каталог
// (manifest.generator.catalogSha256). След промяна в каталога и преди ново генериране — skip.
const CATALOG_SHA = createHash('sha256').update(readFileSync(join(ROOT, 'data/catalog.json'))).digest('hex');
const BOOK_SKIP = !HAS_DATA ? 'няма data/manifest.json'
  : readJson('data/manifest.json').generator?.catalogSha256 !== CATALOG_SHA ? 'данните са генерирани с друг каталог (catalogSha256)' : false;

function load() {
  const manifest = readJson('data/manifest.json');
  const courses = manifest.courses.map((c) => readJson(join('data', c.file)));
  return { manifest, courses };
}

/** Праговете на курса след сливането (manifest.params.lines + params.courses[id]). */
function paramsOf(manifest, id) {
  return { ...manifest.params.lines, ...(manifest.params.courses?.[id] ?? {}) };
}

test('всеки курс с book следва главния book ред до първия ми ход (регресия: kings-gambit = копие на italian)',
  { skip: BOOK_SKIP }, () => {
    const { courses } = load();
    const bad = [];
    for (const course of courses) {
      const cat = CATALOG.courses.find((c) => c.id === course.id);
      const start = cat.start ? parseStrictPgn(cat.start) : [];
      // T-022: първият book ред (главният вариант) трябва да е в курса до първия ми ход вкл.;
      // за останалите (отклонения на противника) — само ако курсът изобщо стига до позицията.
      cat.book.forEach((b, bi) => {
        const sans = applySans(parseStrictPgn(b), START_FEN).sans;
        let i = start.length;
        while (i < sans.length && (i % 2 === 0 ? 'w' : 'b') !== course.side) i++;
        if (i >= sans.length) return;
        const has = (n) => course.lines.some((l) => l.m.length >= n && sans.slice(0, n).every((x, j) => l.m[j] === x));
        if ((bi === 0 || has(i)) && !has(i + 1)) bad.push(`${course.id}: никоя линия не следва book ${sans.slice(0, i + 1).join(' ')}`);
      });
    }
    assert.deepEqual(bad, []);
  });

/** T-030: моята страна е рокирала в ходовете на линията. */
const castled = (m, side) => m.some((s, i) => (i % 2 === 0 ? 'w' : 'b') === side && s.startsWith('O-O'));

test('end/cp са в съгласие с праговете: adv ⇒ cp ≥ advCp (според рокадата, T-030); data/depth ⇒ cp < advCp',
  { skip: !HAS_DATA && 'няма data/manifest.json' }, () => {
    const { manifest, courses } = load();
    const bad = [];
    for (const course of courses) {
      const P = paramsOf(manifest, course.id);
      const advC = course.side === 'w' ? P.advCpWhite : P.advCpBlack;
      const advN = (course.side === 'w' ? P.advCpWhiteNoCastle : P.advCpBlackNoCastle) || advC; // стари данни: няма
      const N = P.linesPerCourse;
      const maxT = Math.floor(P.maxTransposeShare * N);
      const weakCp = course.side === 'w' ? P.weakCpWhite : P.weakCpBlack;
      const nT = course.lines.filter((l) => l.end === 'transpose').length;
      const counted = course.lines.length - nT + Math.min(nT, maxT);
      for (const l of course.lines) {
        const isC = castled(l.m, course.side);
        const adv = isC ? advC : advN;
        if (l.end === 'adv' && l.cp < adv) bad.push(`${course.id} n=${l.n}: adv при cp ${l.cp} < ${adv} (рокада: ${isC})`);
        // T-022 (D-026): equal — само черни, cp ≥ equalCpBlack, не по-рано от minPlyBlack; T-030 — с рокада
        if (l.end === 'equal' && (course.side !== 'b' || l.cp < P.equalCpBlack || l.m.length < P.minPlyBlack || (P.equalNeedsCastle && !isC))) {
          bad.push(`${course.id} n=${l.n}: equal при cp ${l.cp}, ${l.m.length} полухода, рокада: ${isC}`);
        }
        // T-030: слаба линия остава само ако няма с какво да се замени (курсът не надхвърля linesPerCourse)
        if (P.rejectWeak && (l.end === 'data' || l.end === 'depth') && l.cp < weakCp && counted > N) {
          bad.push(`${course.id} n=${l.n}: слаба линия (cp ${l.cp} < ${weakCp}) при ${counted} > ${N} линии`);
        }
        if ((l.end === 'data' || l.end === 'depth') && l.cp >= adv) bad.push(`${course.id} n=${l.n}: ${l.end} при cp ${l.cp} ≥ ${adv}`);
        if (l.m.length > P.maxPly) bad.push(`${course.id} n=${l.n}: ${l.m.length} полухода > maxPly ${P.maxPly}`);
      }
    }
    assert.deepEqual(bad, []);
  });

test('в позициите от book линиите, до които курсът стига, моят ход е book ходът',
  { skip: BOOK_SKIP }, () => {
    const { courses } = load();
    const bad = [];
    for (const course of courses) {
      const cat = CATALOG.courses.find((c) => c.id === course.id);
      const startLen = cat.start ? parseStrictPgn(cat.start).length : 0;
      // EPD → моят ход в курса
      const mine = new Map();
      for (const l of course.lines) {
        const { keys } = applySans(l.m, START_FEN);
        for (let i = startLen; i < l.m.length; i++) {
          const mover = i % 2 === 0 ? 'w' : 'b';
          if (mover !== course.side) continue;
          const k = i === 0 ? 'start' : keys[i - 1];
          mine.set(k, l.m[i]);
        }
      }
      for (const b of cat.book) {
        const { sans, keys } = applySans(parseStrictPgn(b), START_FEN);
        for (let i = startLen; i < sans.length; i++) {
          if ((i % 2 === 0 ? 'w' : 'b') !== course.side) continue;
          const k = i === 0 ? 'start' : keys[i - 1];
          if (mine.has(k) && mine.get(k) !== sans[i]) bad.push(`${course.id}: след [${sans.slice(0, i).join(' ')}] е ${mine.get(k)}, а book е ${sans[i]}`);
        }
      }
    }
    assert.deepEqual(bad, []);
  });

// T-023 (тестер): опашката от двигателя (D-027) — проверки, които валидаторът не прави.
test('опашка (D-027): depth/data са в съгласие с tailMaxPly; линия с tail не свършва с data; опашката не се разклонява',
  { skip: !HAS_DATA && 'няма data/manifest.json' }, () => {
    const { manifest, courses } = load();
    const bad = [];
    for (const course of courses) {
      const P = paramsOf(manifest, course.id);
      if (!(P.tailMaxPly > 0)) continue; // стари данни / опашката е изключена
      const tailOpp = new Map(); // EPD (противникът на ход) в опашка → множество от ходовете му
      for (const l of course.lines) {
        const n = l.m.length;
        const id = `${course.id} n=${l.n}`;
        const hasTail = Number.isInteger(l.tail);
        // depth: или maxPly, или опашка, чийто следващ мой ход би минал tailMaxPly
        if (l.end === 'depth' && !(n >= P.maxPly || (hasTail && n + 2 > P.tailMaxPly))) {
          bad.push(`${id}: depth на ${n} полухода (tail ${l.tail ?? '—'}, tailMaxPly ${P.tailMaxPly})`);
        }
        // data: само когато опашката вече не може да започне (следващият мой ход > tailMaxPly)
        if (l.end === 'data' && n + 2 <= P.tailMaxPly) bad.push(`${id}: data на ${n} полухода, а опашката е до ${P.tailMaxPly}`);
        if (l.end === 'data' && hasTail) bad.push(`${id}: линия с tail свършва с data`);
        if (!hasTail) continue;
        const { keys } = applySans(l.m, START_FEN);
        for (let i = l.tail; i < n; i += 2) { // m[tail] е ход на противника (валидаторът)
          const k = keys[i - 1];
          if (!tailOpp.has(k)) tailOpp.set(k, new Set());
          tailOpp.get(k).add(l.m[i]);
        }
      }
      for (const [k, s] of tailOpp) if (s.size > 1) bad.push(`${course.id}: опашката се разклонява в ${k}: ${[...s].join(', ')}`);
    }
    assert.deepEqual(bad, []);
  });
