// Помощни функции за тестовете на tools/build-courses: синтетично дърво и фалшив двигател.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Position, tokenizeMoves } from '../../../src/chess/position.js';
import { writeTree } from '../../../tools/build-tree/tree-file.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FAKE_UCI = join(ROOT, 'tests', 'fixtures', 'fake-uci.mjs');

/**
 * Дърво (Map EPD → {n, moves:[[san, c]]}) от „партии“: [["e4 e5 Nf3", брой], …].
 * Както в T-004: n = партии, стигнали до позицията; ходовете — с брой, сортирани ↓, SAN ↑.
 */
export function treeFromGames(games) {
  const acc = new Map(); // epd → {n, moves: Map}
  for (const [text, count] of games) {
    const pos = new Position();
    const sans = typeof text === 'string' ? tokenizeMoves(text) : text;
    for (const san of sans) {
      const k = pos.key();
      if (!acc.has(k)) acc.set(k, { n: 0, moves: new Map() });
      const e = acc.get(k);
      e.n += count;
      const s = pos.playSan(san).san;
      e.moves.set(s, (e.moves.get(s) ?? 0) + count);
    }
    const k = pos.key();
    if (!acc.has(k)) acc.set(k, { n: 0, moves: new Map() });
    acc.get(k).n += count;
  }
  const tree = new Map();
  for (const [k, e] of [...acc].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    tree.set(k, { n: e.n, moves: [...e.moves].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)) });
  }
  return tree;
}

/** Записва дървото във формата на T-004 (за CLI тестовете). */
export async function writeTreeFile(path, tree, params = { maxPly: 28 }) {
  await writeTree(path, { source: { month: '2026-10' }, params, paramsHash: 'test', stats: { gamesRead: 0, gamesAccepted: 0, stoppedBy: 'eof' } },
    [...tree].map(([k, v]) => [k, v.n, v.moves.flat()]));
}

/** Таблица за фалшивия двигател: {"ходове до позицията": [[san, cp], …]} → файл по EPD. */
export function writeFakeTable(path, rows) {
  const t = {};
  for (const [moves, list] of Object.entries(rows)) {
    const pos = new Position();
    for (const san of tokenizeMoves(moves)) pos.playSan(san);
    t[pos.key()] = list;
  }
  writeFileSync(path, JSON.stringify(t));
  return path;
}

/**
 * Фалшив evaluator в паметта (без процеси): table {"ходове": [[san, cp], …]}; за
 * непознати позиции — първите 3 хода от дървото (ако е дадено) с cp 0, −5, −10, иначе
 * първите 3 легални хода с cp 0, −1, −2. Пази заявките в `calls`; `delay()` → ms закъснение.
 */
export function memoryEvaluator(rows = {}, { tree = null, delay = null } = {}) {
  const t = new Map();
  for (const [moves, list] of Object.entries(rows)) {
    const pos = new Position();
    for (const san of tokenizeMoves(moves)) pos.playSan(san);
    t.set(pos.key(), list);
  }
  const ev = {
    calls: [],
    async analyse(epd, { searchmove = null } = {}) {
      ev.calls.push(searchmove ? `${epd}|sm:${searchmove}` : epd);
      const pos = new Position(epd);
      if (delay) await new Promise((r) => setTimeout(r, delay()));
      let list = t.get(epd);
      if (!list && tree?.get(epd)?.moves.length) list = tree.get(epd).moves.slice(0, 3).map(([s], i) => [s, -5 * i]);
      if (!list) list = pos.legalSans().slice(0, 3).map((s, i) => [s, -i]);
      let out = list.map(([san, cp]) => ({ uci: pos.findSan(san).uci, san: pos.findSan(san).san, cp, mate: null }));
      if (searchmove) {
        out = out.filter((x) => x.uci === searchmove);
        if (!out.length) out = [{ uci: searchmove, san: pos.findUci(searchmove).san, cp: -500, mate: null }];
      }
      return out.slice(0, 3);
    },
  };
  return ev;
}

/** Параметри с ниски прагове за малки дървета. */
export const TEST_PARAMS = {
  linesPerCourse: 20, advCpWhite: 100, advCpBlack: 60, maxPly: 24, oppMinShare: 0.1, oppMinMoveGames: 1,
  oppMinGames: 1, minLineProb: 0, myMoveToleranceCp: 25, myMoveMinGames: 1, bookToleranceCp: 60,
  maxTransposeShare: 0.3, maxEvalsPerCourse: 600,
  // T-022: опашка, довършване и край equal са изключени тук; тестват се отделно
  equalCpBlack: 0, minPlyBlack: 40, tailMaxPly: 0, quietMaxPly: 0,
};
