// Броене на ходове по позиция с ограничена памет (T-004).
// Два вида записи в една таблица: позиция „EPD“ (брой партии, стигнали до нея)
// и ребро „EPD SAN“ (брой партии с хода SAN от нея). Позицията се брои отделно,
// а не като сума на ребрата, за да не се надуват дяловете, когато редки ходове
// бъдат изрязани.
//
// Памет: lossy counting (Manku & Motwani, 2002) по партии. Ширина на кофа
// w = pruneEveryGames. Нов запис получава delta = (текуща кофа − 1); в края на
// всяка кофа b се трият записите с count + delta ≤ b. Гаранция: всяко ребро е
// подброено с най-много ⌊N/w⌋ партии (N = партиите на този брояч), а ребро с
// реален брой > N/w никога не изчезва. Докато N < w, броенето е точно.
import { Position, START_FEN, key as fenKey, tokenizeMoves } from '../../src/chess/position.js';

export const START_KEY = fenKey(START_FEN);

export class EdgeCounter {
  /** @param {{window?: number}} [opts] */
  constructor({ window = 100000 } = {}) {
    this.window = window;
    this.map = new Map(); // ребро → индекс в масивите
    this.count = new Int32Array(1 << 16);
    this.delta = new Int32Array(1 << 16);
    this.free = [];
    this.next = 0;
    this.games = 0; // партии, подадени на брояча
    this.pruned = 0; // изтрити записи (общо)
    this.peakEntries = 0;
  }

  get size() { return this.map.size; }

  _alloc() {
    if (this.free.length) return this.free.pop();
    if (this.next === this.count.length) {
      const n = this.count.length * 2;
      const c = new Int32Array(n); c.set(this.count); this.count = c;
      const d = new Int32Array(n); d.set(this.delta); this.delta = d;
    }
    return this.next++;
  }

  /** Добавя записите на една партия (масив от „EPD“ и „EPD SAN“). */
  addGame(edges) {
    this.games++;
    const bucket = Math.ceil(this.games / this.window);
    for (const e of edges) {
      const i = this.map.get(e);
      if (i !== undefined) {
        this.count[i]++;
      } else {
        const j = this._alloc();
        this.count[j] = 1;
        this.delta[j] = bucket - 1;
        this.map.set(e, j);
      }
    }
    if (this.map.size > this.peakEntries) this.peakEntries = this.map.size;
    if (this.games % this.window === 0) this._prune(bucket);
  }

  /**
   * Финално изрязване в края на потока (като край на кофа). Прави се само ако
   * броячът вече е в режим lossy (≥ 1 пълна кофа), за да остане броенето на
   * малки входове точно. Маха единичните записи от последната непълна кофа.
   */
  finalPrune() {
    if (this.games >= this.window) this._prune(Math.ceil(this.games / this.window));
  }

  _prune(bucket) {
    for (const [e, i] of this.map) {
      if (this.count[i] + this.delta[i] <= bucket) {
        this.map.delete(e);
        this.free.push(i);
        this.pruned++;
      }
    }
  }

  /** Горна граница на подброяването (партии) за всяко ребро. */
  get maxUndercount() {
    return this.games >= this.window ? Math.ceil(this.games / this.window) : 0;
  }

  /** [ребро, брой] за всички записи. */
  *entries() {
    for (const [e, i] of this.map) yield [e, this.count[i]];
  }
}

/**
 * Записите на една партия до maxPly полухода: за всяка позиция на полуход
 * 0…maxPly−1 — „EPD“ и „EPD SAN“ (каноничен SAN на изиграния ход); ако
 * партията свършва преди maxPly — и „EPD“ на крайната позиция (без ход).
 * Позиция, която се повтаря в същата партия, се брои веднъж (първото посещение).
 * Връща null при невалиден ход (цялата партия се отхвърля) и [] без ходове.
 */
export function gameEdges(movetext, maxPly) {
  let tokens;
  try {
    tokens = tokenizeMoves(movetext);
  } catch {
    return null;
  }
  if (tokens.length === 0) return [];
  const plies = Math.min(tokens.length, maxPly);
  const pos = new Position();
  const seen = [];
  const edges = [];
  let k = START_KEY;
  for (let i = 0; i < plies; i++) {
    let san;
    try {
      san = pos.playSan(tokens[i]).san;
    } catch {
      return null;
    }
    if (!seen.includes(k)) {
      seen.push(k);
      edges.push(k, k + ' ' + san);
    }
    k = pos.key();
  }
  if (tokens.length < maxPly && !seen.includes(k)) edges.push(k);
  return edges;
}
