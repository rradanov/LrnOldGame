// Взети фигури и материално предимство (T-026 / D-032). Чиста функция, без DOM.
// Изчислението е само от позицията (FEN): фигурите на дъската спрямо началния комплект —
// затова е вярно при стъпки напред/назад, „Отначало“ и транспозиции, без история на ходовете.

export const CAPTURE_TYPES = Object.freeze(['p', 'n', 'b', 'r', 'q']);
const INITIAL = Object.freeze({ p: 8, n: 2, b: 2, r: 2, q: 1 });
export const DEFAULT_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9 });

/** Броят на фигурите по цвят и вид от първото поле на FEN. */
export function countPieces(fen) {
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
  const board = String(fen || '').trim().split(/\s+/)[0] || '';
  for (const ch of board) {
    const t = ch.toLowerCase();
    if (!(t in counts.w)) continue;
    counts[ch === t ? 'b' : 'w'][t] += 1;
  }
  return counts;
}

/**
 * Липсващите (взети) фигури на един цвят. Промоция: всяка фигура над началния брой (напр. втора дама)
 * е от пешка, затова пешката не се брои за взета (липсващи пешки = 8 − пешки − промотирани).
 */
function missing(c) {
  const promoted = ['n', 'b', 'r', 'q'].reduce((s, t) => s + Math.max(0, c[t] - INITIAL[t]), 0);
  return {
    p: Math.max(0, INITIAL.p - c.p - promoted),
    n: Math.max(0, INITIAL.n - c.n),
    b: Math.max(0, INITIAL.b - c.b),
    r: Math.max(0, INITIAL.r - c.r),
    q: Math.max(0, INITIAL.q - c.q),
  };
}

/**
 * @param {string} fen
 * @param {{p:number,n:number,b:number,r:number,q:number}} [values] стойности (D-032, „Настройки → Дъска“)
 * @returns {{
 *   captured: {w: Record<string, number>, b: Record<string, number>}, // фигурите, които тази страна е ВЗЕЛА
 *   score: {w: number, b: number},                                    // материал на дъската
 *   diff: number,                                                      // score.w − score.b
 *   leader: 'w'|'b'|null, plus: number                                 // кой е напред и с колко (0 → няма)
 * }}
 */
export function material(fen, values = DEFAULT_VALUES) {
  const v = { ...DEFAULT_VALUES, ...values };
  const c = countPieces(fen);
  const score = (side) => CAPTURE_TYPES.reduce((s, t) => s + c[side][t] * v[t], 0);
  const sw = score('w');
  const sb = score('b');
  const diff = sw - sb;
  return {
    // белите са взели липсващите черни фигури и обратно
    captured: { w: missing(c.b), b: missing(c.w) },
    score: { w: sw, b: sb },
    diff,
    leader: diff > 0 ? 'w' : diff < 0 ? 'b' : null,
    plus: Math.abs(diff),
  };
}
