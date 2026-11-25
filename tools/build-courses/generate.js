// Алгоритъм на генератора на линии (ARCH_T-014 §2, D-020, D-021).
// Best-first по вероятността на линията: max-heap по p (при равенство — по SAN
// записа, за детерминизъм). Вероятността само намалява надолу, затова първите N
// затворени линии са точно N-те най-вероятни.
//   • моя ход: §2.2 (book в рамките на bookToleranceCp; иначе най-популярният от
//     MultiPV кандидатите в рамките на myMoveToleranceCp; иначе най-добрият). Помни
//     се по EPD → една позиция има един и същ мой ход в целия курс.
//   • ход на противника: от дървото, дял ≥ oppMinShare и брой ≥ oppMinMoveGames;
//     дяловете НЕ се пренормират (Σp = покритие).
//   • край (§2.4) след мой ход: mate / draw / adv / depth / data / transpose.
import { Position, applySan, applySans, sanToUci, lineId, START_FEN } from '../../src/chess/position.js';
import { lineName } from './names.js';

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
  const advCp = side === 'w' ? P.advCpWhite : P.advCpBlack;
  const book = bookMap(bookLines, startSans.length, side);
  const t0 = Date.now();
  const stats = {
    evals: 0, myMoves: { book: 0, popular: 0, engine: 0 }, warnings: [], stoppedBy: null,
    droppedNodes: 0, extensionLines: 0, droppedTransposes: 0, ends: {},
  };
  const myMove = new Map(); // EPD → {san, cp, reason}
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

  /** Край на линията след моя ход (§2.4) или null. */
  function endOf(node, cp) {
    const pos = new Position(node.fen);
    if (pos.isCheckmate()) return 'mate';
    const k = node.keys[node.keys.length - 1];
    if (pos.isDraw() || node.keys.filter((x) => x === k).length >= 3) return 'draw';
    if (cp >= advCp) return 'adv';
    if (node.sans.length >= P.maxPly) return 'depth';
    const tn = tree.get(k);
    if (!tn || tn.n < P.oppMinGames || !oppKids(tn).length) return 'data';
    return null;
  }

  const close = (node, end, cp, toKey = null) => {
    const l = { sans: node.sans, keys: node.keys, p: node.p, end, cp, toKey, str: node.str };
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
      const end = endOf(c, m.cp);
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
    let pushed = 0;
    for (const [san, cnt] of oppKids(tn)) {
      const p = n.p * (cnt / tn.n);
      if (!(p > 0) || p < P.minLineProb) continue;
      heap.push(child(n, san, p, n.cp));
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
  if (stats.stoppedBy === 'maxEvals') stats.warnings.push(`достигнат maxEvalsPerCourse (${P.maxEvalsPerCourse})`);
  if (stats.noData) stats.warnings.push('няма данни в дървото за началната позиция на курса (под oppMinGames / oppMinShare)');
  if (counted() < N) stats.warnings.push(`само ${lines.length} линии (< linesPerCourse ${N})`);

  // ---- подреждане, id, имена ----
  lines.sort((a, b) => (Heap.before(a, b) ? -1 : Heap.before(b, a) ? 1 : 0));
  const out = lines.map((l, i) => {
    const o = { id: lineId(courseId, l.sans), n: i + 1, m: l.sans, p: Number(l.p.toPrecision(6)), end: l.end };
    if (l.end === 'transpose') o.to = lineId(courseId, target(l).sans);
    o.cp = Math.round(l.cp);
    const nm = names ? lineName(names, l.sans, l.keys) : null;
    if (nm) { o.eco = nm.eco; o.name = nm.name; }
    o.c = null; // коментари — след MVP (D-018)
    stats.ends[l.end] = (stats.ends[l.end] ?? 0) + 1;
    return o;
  });
  stats.lines = out.length;
  stats.coverage = Math.round(out.reduce((s, l) => s + l.p, 0) * 1e4) / 1e4;
  stats.avgPly = out.length ? Math.round((out.reduce((s, l) => s + l.m.length, 0) / out.length) * 10) / 10 : 0;
  stats.ms = Date.now() - t0;
  return { lines: out, stats };
}
