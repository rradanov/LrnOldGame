// Филтри на партии по хедърите (D-013). Чисти функции, без зависимости.

/**
 * TimeControl на lichess: "180+2" → {base: 180, inc: 2}; "-" → кореспондентна
 * (без часовник) → {base: Infinity, inc: 0, correspondence: true}; иначе null.
 */
export function parseTimeControl(tc) {
  if (tc === '-') return { base: Infinity, inc: 0, correspondence: true };
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc ?? '');
  if (!m) return null;
  return { base: Number(m[1]), inc: Number(m[2] ?? 0), correspondence: false };
}

function elo(v) {
  if (!v || !/^\d+$/.test(v)) return null;
  return Number(v);
}

/** Има ли поне един ход в текста (без коментари, номера и резултат). */
export function hasMoves(moves) {
  const s = moves.replace(/\{[^}]*\}/g, ' ').replace(/\b(1-0|0-1|1\/2-1\/2)\b|\*/g, ' ').replace(/\d+\.+/g, ' ');
  return /[a-hKQRBNO]/.test(s);
}

/**
 * Причина за отхвърляне на партията или null, ако е приета.
 * Рейтинг: **и двамата** играчи трябва да са в [minElo, maxElo] (maxElo 0 = без
 * горна граница). Средното би пуснало партии 2400 срещу 1200, в които ходовете
 * на едната страна не отговарят на целевото ниво; дървото моделира ходовете на
 * противника и на „мен“ от двете страни, затова и двете страни са в диапазона.
 * @param {{headers: object, moves: string, bad: boolean}} game
 * @param {object} p параметрите на `tree`
 */
export function rejectReason(game, p) {
  const h = game.headers;
  if (game.bad) return 'bad-header';
  if (h.Variant && h.Variant !== 'Standard') return 'variant';
  if (h.SetUp === '1' || h.FEN) return 'from-position';
  if (p.ratedOnly && !/\bRated\b/i.test(h.Event ?? '')) return 'casual';
  if (h.Termination && p.excludeTerminations.includes(h.Termination)) return 'termination';
  const we = elo(h.WhiteElo);
  const be = elo(h.BlackElo);
  if (we === null || be === null) return 'elo';
  const lo = p.minElo;
  const hi = p.maxElo > 0 ? p.maxElo : Infinity;
  if (we < lo || be < lo || we > hi || be > hi) return 'elo';
  const tc = parseTimeControl(h.TimeControl);
  if (!tc) return 'time-control';
  if (tc.correspondence) {
    if (!p.includeCorrespondence) return 'time-control';
  } else {
    if (tc.base < p.minBaseSec) return 'time-control';
    if (p.maxBaseSec > 0 && tc.base > p.maxBaseSec) return 'time-control';
  }
  if (!hasMoves(game.moves)) return 'no-moves';
  return null;
}
