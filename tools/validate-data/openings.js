// lichess-org/chess-openings (CC0): a.tsv…e.tsv с колони eco, name, pgn.
// Копие е в tools/chess-openings/ (източник и commit — THIRD_PARTY.md).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizeMoves } from '../../src/chess/position.js';

export const OPENINGS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'chess-openings');
const FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];

/**
 * Зарежда TSV файловете. Връща {rows: [{eco, name, sans}], byPair: Map("eco\tname" → [sans…])}.
 * `sans` са токените от колоната pgn (lichess ги пише в каноничен SAN).
 */
export function loadOpenings(dir = OPENINGS_DIR) {
  const rows = [];
  for (const f of FILES) {
    const path = join(dir, f);
    if (!existsSync(path)) throw new Error(`липсва ${path} (lichess chess-openings)`);
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    if (lines[0] !== 'eco\tname\tpgn') throw new Error(`${path}: неочакван заглавен ред „${lines[0]}“`);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const cols = lines[i].split('\t');
      if (cols.length !== 3) throw new Error(`${path}:${i + 1}: очакват се 3 колони`);
      const [eco, name, pgn] = cols;
      rows.push({ eco, name, sans: tokenizeMoves(pgn) });
    }
  }
  const byPair = new Map();
  for (const r of rows) {
    const k = `${r.eco}\t${r.name}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(r.sans);
  }
  return { rows, byPair };
}

/** Дали `a` е префикс на `b` (масиви от низове). */
export function isPrefix(a, b) {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Най-дълбокото име по пътя `sans` (ред от TSV, чиито ходове са префикс): {eco, name} или null. */
export function deepestName(openings, sans) {
  let best = null;
  for (const r of openings.rows) {
    if (r.sans.length && isPrefix(r.sans, sans) && (!best || r.sans.length > best.sans.length)) best = r;
  }
  return best && { eco: best.eco, name: best.name };
}
