// T-028: фигурна нотация (D-036) и оценка на позицията (D-035) — чисти функции без DOM (тестват се в Node).

/**
 * SAN → части за фигурна нотация: буквата на фигурата (K, Q, R, B, N) в началото и след „=“ (промоция)
 * става {piece: 'n'}; останалото е текст. Пешките и рокадата са без фигурка (както в стандартната фигурна нотация).
 * sanTokens('Nxe5+') → [{piece:'n'}, 'xe5+']; sanTokens('e8=Q') → ['e8=', {piece:'q'}]; sanTokens('O-O') → ['O-O'].
 */
export function sanTokens(san) {
  const s = String(san ?? '');
  const out = [];
  let rest = s;
  const lead = /^[KQRBN]/.exec(rest);
  if (lead) { out.push({ piece: lead[0].toLowerCase(), letter: lead[0] }); rest = rest.slice(1); }
  const promo = /=([QRBN])/.exec(rest);
  if (promo) {
    out.push(rest.slice(0, promo.index + 1));
    out.push({ piece: promo[1].toLowerCase(), letter: promo[1] });
    rest = rest.slice(promo.index + 2);
  }
  if (rest) out.push(rest);
  return out;
}

/** Цветът на хода при даден полуход от началната позиция. */
export const moverAt = (ply) => (ply % 2 === 0 ? 'w' : 'b');

/**
 * Ходовете като поредица за показване (както formatMoves): [{ply, num, san, color}],
 * num = '1.' за ход на белите, '3...' за първия показан ход на черните, иначе ''.
 * `more` = true, ако има още ходове след max.
 */
export function moveItems(sans, { from = 0, max = Infinity } = {}) {
  const items = [];
  const end = Math.min(sans.length, from + max);
  for (let i = from; i < end; i++) {
    let num = '';
    if (i % 2 === 0) num = `${i / 2 + 1}.`;
    else if (i === from) num = `${(i + 1) / 2}...`;
    items.push({ ply: i, num, san: sans[i], color: moverAt(i) });
  }
  return { items, more: end < sans.length };
}

/**
 * D-035: валидно поле `ev` на линия — масив с дължината на ходовете; елементите са цяло число (сантипешки,
 * от гледна точка на белите), низ „#n“/„#-n“ (мат) или null. Иначе null (полето липсва или е повредено).
 */
export function normalizeEv(ev, len) {
  if (!Array.isArray(ev) || ev.length !== len) return null;
  return ev.map((v) => (Number.isFinite(v) ? Math.round(v) : (typeof v === 'string' && /^#-?\d+$/.test(v) ? v : null)));
}

/** Оценката след `ply` изиграни полухода (ev[ply − 1]); преди първия ход — null. */
export function evalAt(ev, ply) {
  if (!ev || ply < 1 || ply > ev.length) return null;
  return ev[ply - 1] ?? null;
}

const MINUS = '−';

/**
 * Текст на оценката от гледна точка на белите, със знак и десетична запетая:
 * 80 → '+0,8', −35 → '−0,4' (U+2212), 0 → '0,0', 1234 → '+12' (≥ 10 пешки — без десетични),
 * '#3' → '#3', '#-3' → '#−3'; null → ''.
 */
export function formatEval(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    const m = /^#(-?)(\d+)$/.exec(v);
    return m ? `#${m[1] ? MINUS : ''}${m[2]}` : '';
  }
  if (!Number.isFinite(v)) return '';
  const p = v / 100;
  const digits = Math.abs(p) >= 10 ? 0 : 1;
  const r = Number(Math.abs(p).toFixed(digits));
  if (r === 0) return digits ? '0,0' : '0';
  const body = r.toLocaleString('bg-BG', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
  return `${p > 0 ? '+' : MINUS}${body}`;
}

/** Коя страна е по-добре: 'w' | 'b' | '' (за цвета на етикета). */
export function evalLeader(v) {
  if (typeof v === 'string') return /^#-/.test(v) ? 'b' : (/^#\d/.test(v) ? 'w' : '');
  if (!Number.isFinite(v) || Math.abs(v) < 5) return '';
  return v > 0 ? 'w' : 'b';
}
