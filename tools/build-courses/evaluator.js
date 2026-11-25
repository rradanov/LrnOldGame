// Оценки на позиции: кеш → (при липса) пул от двигатели. Обединява еднакви
// заявки „в полет“ (няколко курса искат една и съща позиция едновременно).
// Интерфейс към алгоритъма: analyse(epd, {searchmove}) → [{uci, san, cp, mate}],
// подредени по multipv; cp е от гледна точка на страната на ход, а мат е
// превърнат в голямо cp (scoreCp), за да се сравнява.
import { keyToFen, uciToSan } from '../../src/chess/position.js';

/** cp-еквивалент на мат: мат след n хода → ±(MATE_CP − |n|). */
export const MATE_CP = 30000;

export function scoreCp(cp, mate) {
  if (mate !== null && mate !== undefined) return mate > 0 ? MATE_CP - mate : -MATE_CP - mate;
  return cp;
}

export class Evaluator {
  /**
   * cache: EvalCache; getPool: () → EnginePool (вика се мързеливо, при първата липса в кеша);
   * useCache: false → не чете от кеша (но пак записва в него).
   */
  constructor({ cache, getPool, useCache = true }) {
    this.cache = cache;
    this.getPool = getPool;
    this.useCache = useCache;
    this.inflight = new Map();
    this.stats = { requests: 0, hits: 0, misses: 0 };
  }

  async analyse(epd, { searchmove = null } = {}) {
    this.stats.requests++;
    const k = this.cache.key(epd, searchmove);
    let raw = this.useCache ? this.cache.get(k) : undefined;
    if (raw) this.stats.hits++;
    else if (this.inflight.has(k)) { this.stats.hits++; raw = await this.inflight.get(k); }
    else {
      this.stats.misses++;
      const p = this._compute(epd, searchmove);
      this.inflight.set(k, p);
      try { raw = await p; } finally { this.inflight.delete(k); }
      this.cache.set(k, raw);
    }
    return raw.map(([uci, san, cp, mate]) => ({ uci, san, cp: scoreCp(cp, mate), mate }));
  }

  async _compute(epd, searchmove) {
    const fen = keyToFen(epd);
    const r = await this.getPool().analyse(fen, { searchmoves: searchmove ? [searchmove] : null });
    const out = [];
    const seen = new Set();
    for (const l of r.lines) {
      if (!l.uci || seen.has(l.uci)) continue;
      seen.add(l.uci);
      if (l.cp === null && l.mate === null) continue;
      out.push([l.uci, uciToSan(fen, l.uci), l.cp, l.mate]);
    }
    return out;
  }
}
