// Шахматно ядро: обвивка над vendor/chess.js (D-002, D-005, D-021).
// Без DOM и без bare imports — внася се и от браузъра (ES module), и от Node
// инструментите в tools/ без bundler. Единственият източник на правила е chess.js.
import { Chess, DEFAULT_POSITION } from '../../vendor/chess.js/chess.js';

/** FEN на началната позиция. */
export const START_FEN = DEFAULT_POSITION;

/** Грешка на ядрото. `code`: bad-fen | illegal-move | bad-uci | bad-pgn. */
export class ChessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ChessError';
    this.code = code;
    Object.assign(this, details);
  }
}

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const PROMO = new Set(['q', 'r', 'b', 'n']);

function makeChess(fen) {
  if (fen === undefined || fen === null) return new Chess();
  if (typeof fen !== 'string') throw new ChessError('bad-fen', 'FEN трябва да е низ');
  const parts = fen.trim().split(/\s+/);
  // Приемаме и ключ (EPD с 4 полета) — допълваме броячите.
  if (parts.length === 4) parts.push('0', '1');
  try {
    return new Chess(parts.join(' '));
  } catch (e) {
    throw new ChessError('bad-fen', `Невалиден FEN „${fen}“: ${e.message}`, { fen });
  }
}

/** Права за рокада, които наистина са възможни (цар и топ на началните полета). */
function realCastling(chess, castling) {
  if (castling === '-') return castling;
  const is = (sq, color, type) => {
    const p = chess.get(sq);
    return !!p && p.color === color && p.type === type;
  };
  const ok = {
    K: is('e1', 'w', 'k') && is('h1', 'w', 'r'),
    Q: is('e1', 'w', 'k') && is('a1', 'w', 'r'),
    k: is('e8', 'b', 'k') && is('h8', 'b', 'r'),
    q: is('e8', 'b', 'k') && is('a8', 'b', 'r'),
  };
  const out = [...castling].filter((c) => ok[c]).join('');
  return out || '-';
}

/**
 * Нормализиран EPD ключ (D-005): фигури, страна на ход, рокади, en passant.
 * Без броячите на ходове. En passant полето присъства само ако има легално
 * вземане ан пасан (chess.js fen() вече проверява пешка до полето и връзване);
 * правата за рокада се изчистват, ако цар/топ не са на началните полета.
 */
function chessKey(chess) {
  const [placement, turn, castling, ep] = chess.fen().split(' ');
  return `${placement} ${turn} ${realCastling(chess, castling)} ${ep}`;
}

function moveInfo(m) {
  const info = {
    san: m.san,
    uci: m.from + m.to + (m.promotion || ''),
    from: m.from,
    to: m.to,
    piece: m.piece,
    color: m.color,
  };
  if (m.captured) info.captured = m.captured;
  if (m.promotion) info.promotion = m.promotion;
  if (m.isEnPassant()) info.enPassant = true;
  if (m.isKingsideCastle()) info.castle = 'k';
  if (m.isQueensideCastle()) info.castle = 'q';
  return info;
}

/**
 * Позиция с история. Ползва се за последователно прилагане на ходове
 * (тренировка, генератор). Всички методи, които приемат ход, хвърлят
 * ChessError при невалиден ход и не променят позицията.
 */
export class Position {
  /** @param {string} [fen] FEN или EPD ключ; по подразбиране началната позиция. */
  constructor(fen) {
    this._c = makeChess(fen);
    this._startFen = this._c.fen();
    this._moves = [];
  }

  static start() { return new Position(); }
  static fromFen(fen) { return new Position(fen); }

  /** Копие със същата начална позиция и история (вкл. за повторения). */
  clone() {
    const p = new Position(this._startFen);
    for (const m of this._moves) p.playUci(m.uci);
    return p;
  }

  fen() { return this._c.fen(); }
  key() { return chessKey(this._c); }
  /** 'w' или 'b'. */
  turn() { return this._c.turn(); }
  /** Номер на хода (както в FEN). */
  moveNumber() { return this._c.moveNumber(); }
  /** Изиграните ходове (MoveInfo) от създаването на обекта. */
  history() { return this._moves.slice(); }
  sans() { return this._moves.map((m) => m.san); }
  lastMove() { return this._moves[this._moves.length - 1] ?? null; }

  /** Фигура на поле: {type, color} или null. */
  pieceAt(square) { return this._c.get(square) ?? null; }

  /** Легални ходове като MoveInfo, в реда на chess.js (детерминиран). */
  legalMoves() { return this._c.moves({ verbose: true }).map(moveInfo); }
  legalSans() { return this._c.moves(); }
  legalUcis() { return this.legalMoves().map((m) => m.uci); }

  /** Карта поле → [полета], за вход от дъската. */
  dests() {
    const map = new Map();
    for (const m of this._c.moves({ verbose: true })) {
      if (!map.has(m.from)) map.set(m.from, []);
      const list = map.get(m.from);
      if (!list.includes(m.to)) list.push(m.to);
    }
    return map;
  }

  /** Дали ходът от–до е промоция (за диалога на дъската). */
  isPromotion(from, to) {
    return this._c.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  /** Опитва ход в chess.js; при успех го оставя изигран и връща Move, иначе null. */
  _try(arg) {
    try {
      return this._c.move(arg) || null;
    } catch {
      return null;
    }
  }

  _cleanSan(san) {
    if (typeof san !== 'string') return null;
    const s = san.trim().replace(/[!?]+$/, '');
    // null ход („--“) chess.js приема, но той не е легален ход
    if (!s || s === '--' || s === 'Z0' || s === '0000') return null;
    return s;
  }

  /** Намира легален ход по SAN, без да го играе. */
  findSan(san) {
    const s = this._cleanSan(san);
    const m = s && this._try(s);
    if (!m) return null;
    this._c.undo();
    return moveInfo(m);
  }

  /** Намира легален ход по UCI (e2e4, e7e8q), без да го играе. */
  findUci(uci) {
    const m = typeof uci === 'string' && uci.trim().toLowerCase().match(UCI_RE);
    if (!m) return null;
    const [, from, to, promo] = m;
    const found = this._c.moves({ square: from, verbose: true })
      .find((x) => x.to === to && (x.promotion || null) === (promo || null));
    return found ? moveInfo(found) : null;
  }

  _push(m) {
    const info = moveInfo(m);
    this._moves.push(info);
    return info;
  }

  /** Играе SAN ход. Връща MoveInfo с каноничния SAN. */
  playSan(san) {
    const s = this._cleanSan(san);
    const m = s && this._try(s);
    if (!m) {
      throw new ChessError('illegal-move', `Невалиден ход „${san}“ в позиция ${this.fen()}`, { san, fen: this.fen() });
    }
    return this._push(m);
  }

  /** Играе UCI ход (e2e4, e7e8q). */
  playUci(uci) {
    if (typeof uci !== 'string' || !UCI_RE.test(uci.trim().toLowerCase())) {
      throw new ChessError('bad-uci', `Невалиден UCI запис „${uci}“`, { uci });
    }
    const info = this.findUci(uci);
    if (!info) {
      throw new ChessError('illegal-move', `Невалиден ход „${uci}“ в позиция ${this.fen()}`, { uci, fen: this.fen() });
    }
    return this._push(this._c.move({ from: info.from, to: info.to, promotion: info.promotion }));
  }

  /** Играе ход от дъската: {from, to, promotion?}. */
  playMove({ from, to, promotion } = {}) {
    if (promotion && !PROMO.has(promotion)) {
      throw new ChessError('bad-uci', `Невалидна промоция „${promotion}“`, { promotion });
    }
    return this.playUci(`${from}${to}${promotion || ''}`);
  }

  /** Играе SAN или UCI (UCI се разпознава по формата „e2e4“/„e7e8q“). */
  play(move) {
    return typeof move === 'string' && UCI_RE.test(move.trim()) ? this.playUci(move) : this.playSan(move);
  }

  /** Връща последния ход назад; връща неговия MoveInfo или null. */
  undo() {
    if (!this._moves.length) return null;
    this._c.undo();
    return this._moves.pop();
  }

  isCheck() { return this._c.isCheck(); }
  isCheckmate() { return this._c.isCheckmate(); }
  isStalemate() { return this._c.isStalemate(); }
  isDraw() { return this._c.isDraw(); }
  isGameOver() { return this._c.isGameOver(); }

  /**
   * Край на играта: {over, reason, winner}. reason: checkmate | stalemate |
   * insufficient | threefold | fifty | null; winner: 'w' | 'b' | null.
   * Повторението се брои само по ходовете, изиграни в този обект.
   */
  status() {
    const c = this._c;
    if (c.isCheckmate()) return { over: true, reason: 'checkmate', winner: c.turn() === 'w' ? 'b' : 'w' };
    if (c.isStalemate()) return { over: true, reason: 'stalemate', winner: null };
    if (c.isInsufficientMaterial()) return { over: true, reason: 'insufficient', winner: null };
    if (c.isThreefoldRepetition()) return { over: true, reason: 'threefold', winner: null };
    if (c.isDrawByFiftyMoves()) return { over: true, reason: 'fifty', winner: null };
    return { over: false, reason: null, winner: null };
  }
}

// ---- Функции без състояние (FEN/EPD вход) ----

/** Ключ на позиция от FEN (или от вече нормализиран ключ). */
export function key(fen = START_FEN) { return chessKey(makeChess(fen)); }

/** FEN от ключ (броячи 0 1) — за зареждане на позиция по ключ. */
export function keyToFen(k) { return `${key(k)} 0 1`; }

export function sideToMove(fen = START_FEN) { return makeChess(fen).turn(); }

export function legalSans(fen = START_FEN) { return makeChess(fen).moves(); }

/** Прилага един SAN ход: {fen, key, move}. Хвърля ChessError при невалиден ход. */
export function applySan(fen, san) {
  const p = new Position(fen);
  const move = p.playSan(san);
  return { fen: p.fen(), key: p.key(), move };
}

export function applyUci(fen, uci) {
  const p = new Position(fen);
  const move = p.playUci(uci);
  return { fen: p.fen(), key: p.key(), move };
}

/** SAN → UCI в дадена позиция; хвърля при невалиден ход. */
export function sanToUci(fen, san) { return applySan(fen, san).move.uci; }

/** UCI → каноничен SAN в дадена позиция; хвърля при невалиден ход. */
export function uciToSan(fen, uci) { return applyUci(fen, uci).move.san; }

/**
 * Прилага поредица SAN ходове. Връща {sans (канонични), ucis, keys (след всеки ход),
 * fen, key}. При невалиден ход хвърля ChessError с `ply` (0-базиран) и `label` („2.Nf3“).
 */
export function applySans(sans, fen = START_FEN) {
  const p = new Position(fen);
  const keys = [];
  sans.forEach((san, ply) => {
    try {
      p.playSan(san);
    } catch (e) {
      const label = moveLabel(p, san);
      throw new ChessError('illegal-move', `Невалиден ход ${label} (полуход ${ply + 1})`, { ply, san, label, fen: p.fen() });
    }
    keys.push(p.key());
  });
  const h = p.history();
  return { sans: h.map((m) => m.san), ucis: h.map((m) => m.uci), keys, fen: p.fen(), key: p.key() };
}

function moveLabel(p, san) {
  return `${p.moveNumber()}${p.turn() === 'w' ? '.' : '...'}${san}`;
}

/**
 * Разбива PGN-подобен текст на SAN токени (без проверка на легалност).
 * Маха: тагове [..], коментари {..} и ;…, вариации (..), NAG $n,
 * номера на ходове („1.“, „12...“), резултат, суфикси !?.
 */
export function tokenizeMoves(text) {
  if (typeof text !== 'string') throw new ChessError('bad-pgn', 'PGN трябва да е низ');
  let s = text.replace(/^\s*\[[^\]]*\]\s*$/gm, ' ');
  s = s.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  // вложени вариации
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) throw new ChessError('bad-pgn', 'Затваряща скоба без отваряща');
      depth--;
    } else if (depth === 0) out += ch;
  }
  if (depth) throw new ChessError('bad-pgn', 'Незатворена вариация „(“');
  if (/[{}]/.test(out)) throw new ChessError('bad-pgn', 'Незатворен коментар „{“');
  const tokens = [];
  for (let t of out.split(/\s+/)) {
    if (!t) continue;
    t = t.replace(/^\d+\.+/, ''); // „1.e4“, „2...Nf6“
    if (!t || /^\d+\.*$/.test(t)) continue;
    if (/^\$\d+$/.test(t)) continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue;
    t = t.replace(/[!?]+$/, '');
    if (t) tokens.push(t);
  }
  return tokens;
}

/** PGN-подобен текст („1.e4 e5 2.Nf3“) → канонични SAN; хвърля ChessError при грешка. */
export function pgnToSans(pgn, fen = START_FEN) {
  return applySans(tokenizeMoves(pgn), fen).sans;
}

/** SAN ходове → текст „1.e4 e5 2.Nf3“ (от началната позиция). */
export function sansToPgn(sans, fen = START_FEN) {
  const p = new Position(fen);
  const parts = [];
  for (const san of sans) {
    const num = p.moveNumber();
    if (p.turn() === 'w') parts.push(`${num}.${san}`);
    else parts.push(parts.length ? san : `${num}...${san}`);
    p.playSan(san);
  }
  return parts.join(' ');
}

// ---- Stable id на линия (D-021, ARCH_T-014 §2.5) ----

/** SHA-1 (синхронно, чист JS) от UTF-8 низ → hex. Еднакво в Node и браузъра. */
export function sha1Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const words = new Uint32Array((((len + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[len >>> 2] |= 0x80 << (24 - (len % 4) * 8);
  const bitLen = len * 8;
  words[words.length - 1] = bitLen >>> 0;
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < words.length; off += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[off + t];
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const tmp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Stable id на линия: sha1(courseId + "|" + m.join(" "))[:8], m — SAN ходове. */
export function lineId(courseId, sans) {
  if (typeof courseId !== 'string' || !courseId) throw new TypeError('lineId: нужен е courseId');
  if (!Array.isArray(sans)) throw new TypeError('lineId: sans трябва да е масив');
  return sha1Hex(`${courseId}|${sans.join(' ')}`).slice(0, 8);
}

/** Perft — брой листа на дълбочина depth, през обвивката (за проверка). */
export function perft(fen, depth) {
  const p = new Position(fen);
  const walk = (d) => {
    if (d === 0) return 1;
    let n = 0;
    for (const m of p.legalMoves()) {
      p.playUci(m.uci);
      n += walk(d - 1);
      p.undo();
    }
    return n;
  };
  return walk(depth);
}
