// Алгоритъм на генератора на линии (ARCH_T-014 §2, D-020, D-021).
// Best-first по вероятността на линията: max-heap по p (при равенство — по SAN
// записа, за детерминизъм). Вероятността само намалява надолу, затова първите N
// затворени линии са точно N-те най-вероятни (без слабите линии в резерва — T-030).
//   • моя ход: §2.2 (book в рамките на bookToleranceCp; иначе най-популярният от
//     MultiPV кандидатите в рамките на myMoveToleranceCp; иначе най-добрият). Помни
//     се по EPD → една позиция има един и същ мой ход в целия курс.
//   • ход на противника: от дървото, дял ≥ oppMinShare и брой ≥ oppMinMoveGames;
//     дяловете НЕ се пренормират (Σp = покритие).
//   • край (§2.4, D-026) след мой ход: mate / draw / adv / equal / depth / data / transpose.
//     adv — cp ≥ advCpWhite/advCpBlack; equal — само за черните: cp ≥ equalCpBlack при
//     ply ≥ minPlyBlack и предишният мой ход също ≥ equalCpBlack („стабилно“).
//     adv/equal не спира насред размяна/шах: ако позицията след моя ход не е „спокойна“
//     (шах на противника или най-добрият му отговор е взимане/шах/промоция), линията
//     продължава до quietMaxPly полухода: най-добрият ход на противника + моят ход по
//     правилото. Ако междувременно оценката падне под прага — линията продължава нормално.
//   • опашка (D-027): когато дървото няма данни за противника (няма позиция, < oppMinGames,
//     няма ход над прага или всички са под minLineProb), линията продължава с най-добрия ход
//     на двигателя за противника и моя ход по правилото до tailMaxPly (край depth) или до
//     край по D-026. Индексът на първия ход без данни се записва в линията като `tail`.
//   • рокада и предимство (T-030, D-038; параметри по D-013):
//     – моя ход: ако няма book ход, рокада (O-O/O-O-O) в рамките на castleBonusCp от най-добрия
//       се предпочита пред популярния/най-добрия (извън MultiPV — отделно търсене със searchmove);
//     – край adv/equal зависи от това дали моята страна е рокирала: advCpWhite/advCpBlack при
//       рокада, advCpWhiteNoCastle/advCpBlackNoCastle без (0 = същият праг); equalNeedsCastle —
//       край equal само при рокада;
//     – в опашката (и при довършване) противникът играе типичния ход от дървото (най-честия в
//       позицията, ако тя има ≥ tailOppMinGames партии), когато губи ≤ tailOppMaxLossCp спрямо
//       най-добрия; иначе най-добрия;
//     – rejectWeak: линия с край depth/data и cp под weakCpWhite/weakCpBlack отива в резерв и
//       best-first продължава към следващите по вероятност; ако накрая линиите са под
//       linesPerCourse, курсът се допълва от резерва (най-вероятните първо). Резервът не е цел
//       на транспозиции.
//   • ev (T-027, D-035): за всяка линия ev[i] = оценката на позицията след m[i] от гледна точка
//     на белите (cp или "#n"/"#-n"). Взима се най-добрият ред на същото търсене (кеш → двигател):
//     позициите, в които съм на ход, вече са изчислени; липсват обикновено тези след моя ход.
import { Position, applySan, applySans, sanToUci, legalSans, lineId, START_FEN } from '../../src/chess/position.js';
import { lineName } from './names.js';

/**
 * Стойност за `ev` от най-добрия ред на двигателя ({cp, mate} от гледна точка на страната на
 * ход `turn`) → от гледна точка на белите: цяло cp или "#n" / "#-n" (n — ходове, както UCI
 * `mate`; „+“ = белите матират). Без ред → null.
 */
export function evValue(top, turn) {
  if (!top) return null;
  const s = turn === 'b' ? -1 : 1;
  if (top.mate !== null && top.mate !== undefined) {
    // mate 0 = страната на ход е матирана
    const whiteWins = top.mate === 0 ? s < 0 : s * top.mate > 0;
    return `#${whiteWins ? '' : '-'}${Math.abs(top.mate)}`;
  }
  if (!Number.isFinite(top.cp)) return null;
  return Math.round(s * top.cp) || 0;
}

/** Максимум линии в курс (валидаторът: LIMITS.maxLines). */
export const MAX_LINES = 100;

/** Max-heap по p; при равенство — по-малкият SAN низ първи. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  static before(x, y) { return x.p > y.p || (x.p === y.p && x.str < y.str); }
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (!Heap.before(a[i], a[j])) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && Heap.before(a[l], a[m])) m = l;
        if (r < a.length && Heap.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

const moverAt = (ply) => (ply % 2 === 0 ? 'w' : 'b');
const isCastle = (san) => san.startsWith('O-O');

/** T-030: страната `side` е рокирала в ходовете `sans` (от началната позиция). */
export function hasCastled(sans, side) {
  return sans.some((s, i) => moverAt(i) === side && isCastle(s));
}

/** book редове (канонични SAN) → Map(EPD преди моя ход → san). */
export function bookMap(bookLines, startLen, side) {
  const map = new Map();
  for (const sans of bookLines) {
    const { keys } = applySans(sans, START_FEN);
    for (let ply = startLen; ply < sans.length; ply++) {
      if (moverAt(ply) !== side) continue;
      const k = ply === 0 ? new Position().key() : keys[ply - 1];
      map.set(k, sans[ply]);
    }
  }
  return map;
}

/** EPD на позицията на възела. */
const lastKey = (node) => (node.keys.length ? node.keys[node.keys.length - 1] : new Position(node.fen).key());

function makeNode(sans, keys, fen, p, cp) {
  return { sans, keys, fen, p, cp, str: sans.join(' ') };
}

function child(node, san, p, cp) {
  const r = applySan(node.fen, san);
  return makeNode([...node.sans, r.move.san], [...node.keys, r.key], r.fen, p, cp);
}

/**
 * Генерира един курс.
 * args: {courseId, side, startSans, bookLines (масив от SAN масиви), params, tree (Map), evaluator, names}
 * Връща {lines (готови за JSON), stats}.
 */
export async function generateCourse({ courseId, side, startSans, bookLines = [], params, tree, evaluator, names }) {
  const P = params;
  const N = P.linesPerCourse;
  // T-030 (D-038): прагове според рокадата; 0 / липсващ праг без рокада = същият като с рокада
  const advCpCastled = side === 'w' ? P.advCpWhite : P.advCpBlack;
  const advCpNoCastle = (side === 'w' ? P.advCpWhiteNoCastle : P.advCpBlackNoCastle) || advCpCastled;
  const weakCp = side === 'w' ? P.weakCpWhite : P.weakCpBlack;
  const rejectWeak = !!P.rejectWeak && Number.isFinite(weakCp);
  const book = bookMap(bookLines, startSans.length, side);
  const t0 = Date.now();
  const stats = {
    evals: 0, myMoves: { book: 0, popular: 0, engine: 0, castle: 0 }, warnings: [], stoppedBy: null,
    droppedNodes: 0, extensionLines: 0, droppedTransposes: 0, ends: {},
    // T018-D6: причина „няма данни“ — при начало на опашка и при край data
    tailStarts: { noPos: 0, fewGames: 0, noMoves: 0, minLineProb: 0 },
    dataEnds: { noPos: 0, fewGames: 0, noMoves: 0, minLineProb: 0 },
    tailLines: 0, tailPlies: 0, quietLines: 0, unquiet: 0, oppEvals: 0,
    // T-030: допълнителни търсения за рокада / типичен ход; отхвърлени (резерв) и допълнени линии;
    // ходове на противника в опашката на изходните линии: всички / типични / типични ≠ най-добрия
    castleEvals: 0, typicalEvals: 0, rejected: 0, refilled: 0,
    tailOppPlies: 0, tailTypicalPlies: 0, tailTypicalSwaps: 0, castledLines: 0,
  };
  const minLineProbOk = (p) => p > 0 && p >= P.minLineProb;
  const myMove = new Map(); // EPD → {san, cp, reason}
  const oppMove = new Map(); // EPD → най-добрият ход на противника {san, cp} (опашка, спокойствие)
  const tailMove = new Map(); // EPD → ход на противника в опашката {san, cp, typical, swap} (T-030)
  const expanded = new Set(); // EPD на позициите (противникът на ход), разгънати по някой път
  const heap = new Heap();
  const lines = [];

  const oppKids = (tn) => (tn ? tn.moves.filter(([, c]) => c >= P.oppMinMoveGames && c / tn.n >= P.oppMinShare) : []);

  async function chooseMyMove(node) {
    const k = lastKey(node);
    if (myMove.has(k)) return myMove.get(k);
    stats.evals++;
    const cands = await evaluator.analyse(k);
    if (!cands.length) throw new Error(`${courseId}: двигателят не върна ход за ${k}`);
    const best = cands[0].cp;
    let pick = null;
    const bookSan = book.get(k);
    if (bookSan) {
      let c = cands.find((x) => x.san === bookSan);
      if (!c) {
        stats.evals++;
        const r = await evaluator.analyse(k, { searchmove: sanToUci(node.fen, bookSan) });
        c = r[0] ? { ...r[0], san: bookSan } : null;
      }
      if (c && best - c.cp <= P.bookToleranceCp) pick = { san: bookSan, cp: c.cp, reason: 'book' };
      else {
        stats.warnings.push(`book ход ${bookSan} след [${node.sans.join(' ')}] е ${c ? best - c.cp : '?'} cp под най-добрия (${cands[0].san}) > bookToleranceCp ${P.bookToleranceCp} — не е ползван`);
      }
    }
    if (!pick && P.castleBonusCp > 0) pick = await castleMove(node, k, cands, best);
    if (!pick) {
      let c = cands[0];
      let reason = 'engine';
      if (P.myMoveToleranceCp > 0) {
        const tn = tree.get(k);
        const count = (san) => (tn ? (tn.moves.find(([s]) => s === san)?.[1] ?? 0) : 0);
        let top = null;
        for (const x of cands) {
          if (best - x.cp > P.myMoveToleranceCp) continue;
          if (!top || count(x.san) > count(top.san)) top = x;
        }
        if (top && count(top.san) >= P.myMoveMinGames && count(top.san) > 0) {
          c = top;
          reason = top === cands[0] ? 'engine' : 'popular';
        }
      }
      pick = { san: c.san, cp: c.cp, reason };
    }
    stats.myMoves[pick.reason]++;
    myMove.set(k, pick);
    return pick;
  }

  /**
   * T-030: рокада в рамките на castleBonusCp от най-добрия (при две — по-добрата) или null.
   * Рокада извън MultiPV кандидатите се оценява отделно (searchmove).
   */
  async function castleMove(node, k, cands, best) {
    let pick = null;
    for (const san of legalSans(node.fen).filter(isCastle)) {
      let c = cands.find((x) => x.san === san);
      if (!c) {
        stats.evals++;
        stats.castleEvals++;
        const r = await evaluator.analyse(k, { searchmove: sanToUci(node.fen, san) });
        c = r[0] ? { ...r[0], san } : null;
      }
      if (c && best - c.cp <= P.castleBonusCp && (!pick || c.cp > pick.cp)) pick = { san, cp: c.cp, reason: 'castle' };
    }
    return pick;
  }

  /**
   * T-030: ход на противника без разклоняване (опашка или довършване). Типичният ход (най-честият
   * в дървото, ако позицията има ≥ tailOppMinGames партии), когато губи ≤ tailOppMaxLossCp спрямо
   * най-добрия; иначе най-добрият. Зависи само от позицията (помни се по EPD), затова опашката не
   * се разклонява, когато една позиция е достигната и при довършване, и в опашка.
   */
  async function engineOppMove(node, tn) {
    const best = await oppBest(node);
    if (!(P.tailOppMinGames > 0) || !tn || tn.n < P.tailOppMinGames || !tn.moves.length) {
      return { ...best, typical: false, swap: false };
    }
    const k = lastKey(node);
    if (tailMove.has(k)) return tailMove.get(k);
    const top = tn.moves[0][0]; // ходовете в дървото са сортирани по брой ↓ (при равенство — SAN ↑)
    let r = { ...best, typical: false, swap: false };
    if (top === best.san) r.typical = true;
    else {
      stats.evals++;
      stats.typicalEvals++;
      const x = (await evaluator.analyse(k, { searchmove: sanToUci(node.fen, top) }))[0];
      if (x && best.cp - x.cp <= P.tailOppMaxLossCp) r = { san: top, cp: x.cp, typical: true, swap: true };
    }
    tailMove.set(k, r);
    return r;
  }

  /** Най-добрият ход на противника по двигателя (помни се по EPD). */
  async function oppBest(node) {
    const k = lastKey(node);
    if (oppMove.has(k)) return oppMove.get(k);
    stats.evals++;
    stats.oppEvals++;
    const cands = await evaluator.analyse(k);
    if (!cands.length) throw new Error(`${courseId}: двигателят не върна ход за ${k}`);
    const r = { san: cands[0].san, cp: cands[0].cp };
    oppMove.set(k, r);
    return r;
  }

  /** Защо дървото не дава ход на противника (противникът е на ход в node), или null. */
  function dataReason(node) {
    const tn = tree.get(lastKey(node));
    if (!tn) return 'noPos';
    if (tn.n < P.oppMinGames) return 'fewGames';
    const kids = oppKids(tn);
    if (!kids.length) return 'noMoves';
    if (!kids.some(([, c]) => minLineProbOk(node.p * (c / tn.n)))) return 'minLineProb';
    return null;
  }

  /**
   * „Спокойна“ позиция след моя ход (D-026, T018-D2): противникът не е под шах и най-добрият
   * му отговор не е взимане, шах или промоция (т.е. няма незавършена размяна).
   */
  async function isQuiet(node) {
    if (/[+#]$/.test(node.sans[node.sans.length - 1])) return false;
    const o = await oppBest(node);
    return !/[x+#=]/.test(o.san);
  }

  /**
   * Край на линията след моя ход (§2.4, D-026) или null. prevCp — оценката на предишния
   * мой ход. Може да маркира възела за продължение: node.quiet (довършване до спокойна
   * позиция) или node.tail (опашка от двигателя).
   */
  async function endOf(node, cp, prevCp) {
    const pos = new Position(node.fen);
    if (pos.isCheckmate()) return 'mate';
    const k = node.keys[node.keys.length - 1];
    if (pos.isDraw() || node.keys.filter((x) => x === k).length >= 3) return 'draw';
    const ply = node.sans.length;
    const castled = hasCastled(node.sans, side);
    let cand = null;
    if (cp >= (castled ? advCpCastled : advCpNoCastle)) cand = 'adv';
    else if (side === 'b' && (castled || !P.equalNeedsCastle) && ply >= P.minPlyBlack
      && cp >= P.equalCpBlack && prevCp >= P.equalCpBlack) cand = 'equal';
    if (cand) {
      if (P.quietMaxPly === 0 || await isQuiet(node)) return cand;
      if ((node.q ?? 0) + 2 > P.quietMaxPly || ply + 2 > P.maxPly) { stats.unquiet++; return cand; }
      node.quiet = cand;
      return null;
    }
    node.q = 0; // ако е било довършване — предимството изчезна; продължаваме нормално
    if (ply >= P.maxPly) return 'depth';
    // опашката не минава tailMaxPly: следващият ми ход би бил на ply + 2
    if (node.tail != null) return ply + 2 > P.tailMaxPly ? 'depth' : null;
    const why = dataReason(node);
    if (!why) return null;
    if (ply + 2 <= P.tailMaxPly) {
      stats.tailStarts[why]++;
      node.tail = ply;
      return null;
    }
    stats.dataEnds[why]++;
    return 'data';
  }

  const reserve = []; // T-030: слаби линии (depth/data под weakCp) — за допълване накрая
  const close = (node, end, cp, toKey = null) => {
    const l = {
      sans: node.sans, keys: node.keys, p: node.p, end, cp, toKey, str: node.str, tail: node.tail ?? null,
      tOpp: node.tOpp ?? 0, tTyp: node.tTyp ?? 0, tSwap: node.tSwap ?? 0,
    };
    if (rejectWeak && (end === 'depth' || end === 'data') && cp < weakCp) {
      stats.rejected++;
      reserve.push(l);
      return null;
    }
    if ((end === 'adv' || end === 'equal') && node.q > 0) stats.quietLines++;
    lines.push(l);
    return l;
  };

  /** Една стъпка на best-first: обработва възела; връща затворената линия или null. */
  async function step(n) {
    const pos = new Position(n.fen);
    if (pos.turn() === side) {
      if (pos.isGameOver()) { stats.droppedNodes++; return null; } // противникът ме матира / пат — не е линия
      const m = await chooseMyMove(n);
      const c = child(n, m.san, n.p, m.cp);
      c.tail = n.tail;
      c.q = n.q;
      c.tOpp = n.tOpp; c.tTyp = n.tTyp; c.tSwap = n.tSwap;
      const end = await endOf(c, m.cp, n.cp);
      if (end) return close(c, end, m.cp);
      const k = c.keys[c.keys.length - 1];
      if (expanded.has(k)) return close(c, 'transpose', m.cp, k);
      expanded.add(k);
      heap.push(c);
      return null;
    }
    // противникът е на ход
    const k = lastKey(n);
    const tn = tree.get(k);
    if (n.quiet || n.tail != null) {
      // довършване или опашка: един ход — най-добрият по двигателя (в опашката — типичният, T-030);
      // p не се променя
      if (pos.isGameOver()) { stats.droppedNodes++; return null; }
      const o = await engineOppMove(n, tn);
      const c = child(n, o.san, n.p, n.cp);
      const fromData = oppKids(tn).some(([s]) => s === c.sans[c.sans.length - 1]);
      c.tail = n.tail ?? (fromData ? null : n.sans.length);
      c.q = n.quiet ? (n.q ?? 0) + 2 : 0;
      const inTail = c.tail != null ? 1 : 0;
      c.tOpp = (n.tOpp ?? 0) + inTail;
      c.tTyp = (n.tTyp ?? 0) + (inTail && o.typical ? 1 : 0);
      c.tSwap = (n.tSwap ?? 0) + (inTail && o.swap ? 1 : 0);
      heap.push(c);
      return null;
    }
    let pushed = 0;
    for (const [san, cnt] of oppKids(tn)) {
      const p = n.p * (cnt / tn.n);
      if (!minLineProbOk(p)) continue;
      const c = child(n, san, p, n.cp);
      c.tOpp = n.tOpp; c.tTyp = n.tTyp; c.tSwap = n.tSwap;
      heap.push(c);
      pushed++;
    }
    if (!pushed) {
      if (n.sans.length === startSans.length) { stats.noData = true; return null; } // линия без мой ход не е линия
      return close(n, 'data', n.cp);
    }
    return null;
  }

  // ---- основен цикъл: top-N ----
  const root = applySans(startSans, START_FEN);
  heap.push(makeNode(root.sans, root.keys, root.fen, 1, 0));
  const maxT = Math.floor(P.maxTransposeShare * N);
  const counted = () => {
    const t = lines.filter((l) => l.end === 'transpose').length;
    return lines.length - t + Math.min(t, maxT);
  };
  for (;;) {
    if (counted() >= N) { stats.stoppedBy = 'lines'; break; }
    if (lines.length >= MAX_LINES) { stats.stoppedBy = 'maxLines'; break; }
    if (!heap.size) { stats.stoppedBy = 'exhausted'; break; }
    if (stats.evals >= P.maxEvalsPerCourse) { stats.stoppedBy = 'maxEvals'; break; }
    await step(heap.pop());
  }

  // ---- транспозиции: всяка трябва да сочи линия, която минава през позицията и продължава ----
  const target = (l) => {
    let best = null;
    for (const x of lines) {
      if (x === l) continue;
      const i = x.keys.indexOf(l.toKey);
      if (i >= 0 && i < x.keys.length - 1 && (!best || Heap.before(x, best))) best = x;
    }
    return best;
  };
  const unresolved = () => new Set(lines.filter((l) => l.end === 'transpose' && !target(l)).map((l) => l.toKey));
  let open = unresolved();
  // Допълване: продължаваме best-first само в поддърветата на неразрешените позиции.
  while (open.size && heap.size && stats.evals < P.maxEvalsPerCourse && lines.length < MAX_LINES) {
    const n = heap.pop();
    if (!n.keys.some((k) => open.has(k))) continue;
    const l = await step(n);
    if (l) { stats.extensionLines++; open = unresolved(); }
  }
  for (;;) {
    const bad = lines.filter((l) => l.end === 'transpose' && !target(l));
    if (!bad.length) break;
    for (const l of bad) {
      lines.splice(lines.indexOf(l), 1);
      stats.droppedTransposes++;
    }
  }
  if (stats.droppedTransposes) stats.warnings.push(`${stats.droppedTransposes} линии с транспозиция без продължение са махнати`);
  // T-030: не стигат линиите → допълване от резерва (най-вероятните слаби линии първо)
  if (counted() < N && reserve.length) {
    reserve.sort((a, b) => (Heap.before(a, b) ? -1 : Heap.before(b, a) ? 1 : 0));
    while (counted() < N && reserve.length && lines.length < MAX_LINES) { lines.push(reserve.shift()); stats.refilled++; }
    stats.warnings.push(`${stats.refilled} линии под прага за слаба линия (${weakCp} cp) — няма с какво да се заменят`);
  }
  if (stats.stoppedBy === 'maxEvals') stats.warnings.push(`достигнат maxEvalsPerCourse (${P.maxEvalsPerCourse})`);
  if (stats.noData) stats.warnings.push('няма данни в дървото за началната позиция на курса (под oppMinGames / oppMinShare)');
  if (counted() < N) stats.warnings.push(`само ${lines.length} линии (< linesPerCourse ${N})`);

  // ---- подреждане, id, имена ----
  lines.sort((a, b) => (Heap.before(a, b) ? -1 : Heap.before(b, a) ? 1 : 0));

  // ---- ev (T-027): оценка след всеки ход, от гледна точка на белите ----
  const evMemo = new Map(); // EPD → Promise(стойност)
  async function positionEv(k) {
    const pos = new Position(k);
    if (pos.isCheckmate()) return pos.turn() === 'w' ? '#-0' : '#0';
    if (pos.isGameOver()) return 0; // пат / недостатъчен материал
    const cands = await evaluator.analyse(k);
    return evValue(cands[0], pos.turn());
  }
  const evOf = (k) => {
    if (!evMemo.has(k)) evMemo.set(k, positionEv(k));
    return evMemo.get(k);
  };
  const evs = await Promise.all(lines.map((l) => Promise.all(l.keys.map(evOf))));
  stats.evPositions = evMemo.size;
  stats.evNulls = evs.reduce((s, e) => s + e.filter((v) => v === null).length, 0);
  const out = lines.map((l, i) => {
    if (l.keys.length !== l.sans.length) throw new Error(`${courseId}: keys/ходове се разминават в [${l.str}]`);
    const o = { id: lineId(courseId, l.sans), n: i + 1, m: l.sans, p: Number(l.p.toPrecision(6)), end: l.end };
    if (l.end === 'transpose') o.to = lineId(courseId, target(l).sans);
    o.cp = Math.round(l.cp);
    if (l.tail != null && l.tail < l.sans.length) {
      o.tail = l.tail; // D-027: ходовете от m[tail] нататък са от двигателя (без данни от партии)
      stats.tailLines++;
      stats.tailPlies += l.sans.length - l.tail;
      stats.tailOppPlies += l.tOpp;
      stats.tailTypicalPlies += l.tTyp;
      stats.tailTypicalSwaps += l.tSwap;
    }
    if (hasCastled(l.sans, side)) stats.castledLines++;
    const nm = names ? lineName(names, l.sans, l.keys) : null;
    if (nm) { o.eco = nm.eco; o.name = nm.name; }
    o.c = null; // коментари — след MVP (D-018)
    o.ev = evs[i];
    stats.ends[l.end] = (stats.ends[l.end] ?? 0) + 1;
    return o;
  });
  stats.lines = out.length;
  stats.coverage = Math.round(out.reduce((s, l) => s + l.p, 0) * 1e4) / 1e4;
  stats.avgPly = out.length ? Math.round((out.reduce((s, l) => s + l.m.length, 0) / out.length) * 10) / 10 : 0;
  stats.ms = Date.now() - t0;
  return { lines: out, stats };
}
