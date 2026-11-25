// Имена на линиите от lichess chess-openings — ПО ПОЗИЦИЯ (EPD), не само по реда
// на ходовете (бележка от T-015). Пример: 1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Bf5 е
// записан в TSV с 3.Nd2; по реда на ходовете би получил само „Caro-Kann Defense“,
// а по позиция — „Caro-Kann Defense: Classical Variation“.
import { Position, START_FEN } from '../../src/chess/position.js';
import { isPrefix } from '../validate-data/openings.js';

/** Индекс EPD → [{eco, name, sans}] (в реда на TSV файловете). */
export function buildNameIndex(openings) {
  const byKey = new Map();
  // Редовете споделят префикси — пазим FEN/ключ на всеки префикс (иначе ~2 s с chess.js).
  const memo = new Map([['', { fen: START_FEN, key: null }]]);
  const keyOf = (sans) => {
    let i = sans.length;
    while (i > 0 && !memo.has(sans.slice(0, i).join(' '))) i--;
    let { fen, key } = memo.get(sans.slice(0, i).join(' '));
    if (i < sans.length) {
      const pos = new Position(fen);
      for (; i < sans.length; i++) {
        pos.playSan(sans[i]);
        fen = pos.fen();
        key = pos.key();
        memo.set(sans.slice(0, i + 1).join(' '), { fen, key });
      }
    }
    return key;
  };
  for (const r of openings.rows) {
    if (!r.sans.length) continue;
    let k;
    try { k = keyOf(r.sans); } catch { continue; }
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  return byKey;
}

/**
 * Името на линията: най-дълбоката позиция по пътя (`keys[i]` = след полуход i),
 * която има име. Ако за позицията има няколко реда, предпочита този, чиито ходове
 * са префикс на линията (същия ред на ходовете), иначе първия в TSV.
 * Връща {eco, name} или null.
 */
export function lineName(index, sans, keys) {
  for (let i = keys.length - 1; i >= 0; i--) {
    const rows = index.get(keys[i]);
    if (!rows) continue;
    const exact = rows.find((r) => r.sans.length === i + 1 && isPrefix(r.sans, sans));
    const r = exact ?? rows[0];
    return { eco: r.eco, name: r.name };
  }
  return null;
}
