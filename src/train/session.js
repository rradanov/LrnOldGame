// Тренировка на една линия (режим learn) — машина на състоянията без DOM (ARCH_T-014 §5.4, D-015).
//
// Линията е масив от SAN ходове от началото на партията. Потребителят играе своите ходове
// (страната на курса), приложението — тези на противника. Стартовите ходове на курса
// (`startPly`) се играят автоматично само при `autoPlayStart`; иначе потребителят играе
// своите стартови ходове като всички останали.
//
// Ходовете от опашката (`tail`, D-027: продължение от двигателя) се играят като обикновените;
// събитията само ги маркират с `fromEngine`.
//
// Грешка (D-015): броячът на поредните чисти изигравания се нулира и се показва верният ход.
//   onError = 'continue' (подразбиране): потребителят играе верния ход и довършва линията;
//   onError = 'restart': опитът свършва веднага като неуспешен; UI рестартира след errorPauseMs.
// Подсказка: показва верния ход; при hintResetsStreak опитът вече не е „чист“.
//
// Транспозиция (end = 'transpose', `to`): линията учи реда на ходовете до общата позиция,
// продължението е в линия `to` (ARCH §2.5). Линията се смята за изиграна, когато стигне края си;
// резултатът носи `transposeTo`, за да може UI да предложи продължението.
import { Position, START_FEN } from '../chess/position.js';

/** FEN след всеки полуход (индекс 0 = началната позиция) и последните ходове. */
export function lineFrames(sans, fen = START_FEN) {
  const p = new Position(fen);
  const frames = [{ fen: p.fen(), last: null }];
  for (const san of sans) {
    const m = p.playSan(san);
    frames.push({ fen: p.fen(), last: { from: m.from, to: m.to }, san: m.san, uci: m.uci, promotion: m.promotion || null });
  }
  return frames;
}

/** 'w' | 'b' — кой е на ход при даден полуход (от началната позиция). */
export const colorAt = (ply) => (ply % 2 === 0 ? 'w' : 'b');

export const PHASE = Object.freeze({
  AUTO: 'auto', // стартов ход, който приложението играе (autoPlayStart)
  OPPONENT: 'opponent', // ход на противника — приложението го играе след opponentDelayMs
  USER: 'user', // чака се ходът на потребителя
  CORRECT: 'correct', // след грешка (continue): чака се верният ход
  FAILED: 'failed', // след грешка (restart): опитът е свършил неуспешно
  DONE: 'done', // линията е изиграна докрай
});

/**
 * @param {object} o
 * @param {string[]} o.sans ходовете на линията (каноничен SAN, от началото)
 * @param {'w'|'b'} o.side страната на потребителя
 * @param {number} [o.startPly] брой стартови полуходове на курса
 * @param {boolean} [o.autoPlayStart]
 * @param {'continue'|'restart'} [o.onError]
 * @param {boolean} [o.hintResetsStreak]
 * @param {number|null} [o.tail] индекс на първия ход от двигателя (или null)
 * @param {string|null} [o.transposeTo] id на линията, която продължава (end = 'transpose')
 * @param {() => number} [o.now]
 */
export function createSession({
  sans, side, startPly = 0, autoPlayStart = false, onError = 'continue', hintResetsStreak = true,
  tail = null, transposeTo = null, now = () => Date.now(),
}) {
  if (!Array.isArray(sans) || !sans.length) throw new TypeError('Празна линия');
  if (side !== 'w' && side !== 'b') throw new TypeError(`Непозната страна: ${side}`);
  const frames = lineFrames(sans);
  const total = sans.length;

  let ply = 0;
  let errors = [];
  let hints = 0;
  let hintedPlies = new Set();
  let failed = false; // restart: опитът е прекъснат от грешка
  let pendingError = false; // continue: чака се верният ход
  let startedAt = now();
  let finishedAt = null;
  let lastEventAt = startedAt; // кога е изигран предишният полуход (за времето на моя ход)
  let maxMoveMs = 0; // най-бавният верен мой ход (ARCH §4: hardAfterSec → „Трудно“)
  let attempt = 1;

  const isMine = (p) => colorAt(p) === side;
  const fromEngine = (p) => tail !== null && p >= tail;

  function phase() {
    if (failed) return PHASE.FAILED;
    if (ply >= total) return PHASE.DONE;
    if (pendingError) return PHASE.CORRECT;
    if (ply < startPly && autoPlayStart) return PHASE.AUTO;
    return isMine(ply) ? PHASE.USER : PHASE.OPPONENT;
  }

  function expected() {
    return ply < total ? frames[ply + 1] : null;
  }

  function finishIfDone() {
    if (ply >= total && finishedAt === null) finishedAt = now();
  }

  /** Изиграва хода на приложението (противник или стартов ход). */
  function playAuto() {
    const ph = phase();
    if (ph !== PHASE.OPPONENT && ph !== PHASE.AUTO) throw new Error(`Не е ред на приложението (${ph})`);
    const f = frames[ply + 1];
    const ev = { ply, san: f.san, from: f.last.from, to: f.last.to, fen: f.fen, fromEngine: fromEngine(ply), auto: ph === PHASE.AUTO };
    ply++;
    lastEventAt = now();
    finishIfDone();
    return ev;
  }

  /**
   * Ход на потребителя (SAN, каноничен — UI го получава от Position).
   * @returns {{ok: true, ply, san, fen, from, to, fromEngine, done: boolean}
   *   | {ok: false, ply, played, expected: {san, from, to}, restart: boolean}}
   */
  function userMove(san) {
    const ph = phase();
    if (ph !== PHASE.USER && ph !== PHASE.CORRECT) throw new Error(`Не е ред на потребителя (${ph})`);
    const f = frames[ply + 1];
    if (san === f.san) {
      const ev = { ok: true, ply, san: f.san, from: f.last.from, to: f.last.to, fen: f.fen, fromEngine: fromEngine(ply), corrected: pendingError };
      const t = now();
      if (!pendingError) maxMoveMs = Math.max(maxMoveMs, t - lastEventAt);
      lastEventAt = t;
      pendingError = false;
      ply++;
      finishIfDone();
      return { ...ev, done: ply >= total };
    }
    errors.push({ ply, played: san, expected: f.san });
    const exp = { san: f.san, from: f.last.from, to: f.last.to };
    if (onError === 'restart') {
      failed = true;
      finishedAt = now();
      return { ok: false, ply, played: san, expected: exp, restart: true };
    }
    pendingError = true;
    return { ok: false, ply, played: san, expected: exp, restart: false };
  }

  /** Подсказка: верният ход за текущия полуход (само когато е ред на потребителя). */
  function hint() {
    const ph = phase();
    if (ph !== PHASE.USER && ph !== PHASE.CORRECT) return null;
    if (!hintedPlies.has(ply)) { hintedPlies.add(ply); hints++; }
    const f = frames[ply + 1];
    return { ply, san: f.san, from: f.last.from, to: f.last.to };
  }

  /** Опитът вече не може да е чист (грешка или подсказка, която нулира брояча). */
  function dirty() {
    return errors.length > 0 || (hintResetsStreak && hints > 0);
  }

  /** Резултатът на опита (за записа в lineProgress/attempts). */
  function result() {
    const done = ply >= total && !failed;
    return {
      done,
      clean: done && !dirty(),
      errors: errors.map((e) => ({ ...e })),
      hints,
      plies: ply,
      total,
      userMoves: sans.slice(0, ply).filter((_, i) => isMine(i) && !(i < startPly && autoPlayStart)).length,
      ms: (finishedAt ?? now()) - startedAt,
      maxMoveMs,
      transposeTo: done ? transposeTo : null,
      attempt,
    };
  }

  /** Нов опит от началото на линията. */
  function restart() {
    ply = 0;
    errors = [];
    hints = 0;
    hintedPlies = new Set();
    failed = false;
    pendingError = false;
    startedAt = now();
    finishedAt = null;
    lastEventAt = startedAt;
    maxMoveMs = 0;
    attempt++;
  }

  return {
    get ply() { return ply; },
    get total() { return total; },
    get side() { return side; },
    get attempt() { return attempt; },
    phase, expected, playAuto, userMove, hint, dirty, result, restart,
    /** Позицията (FEN) и последният ход след n полухода. */
    frame: (n = ply) => frames[n],
    fromEngine,
    isMine,
  };
}

/**
 * T013-D1: резултатът на опита + грешките/подсказките от прекъснат (презареждане, убито приложение) нечист опит
 * в преговор (lineProgress.pending). Така оценката е по реалните грешки, а не „Добре“ след чисто повторение.
 */
export function mergeCarry(res, carry) {
  if (!carry) return res;
  const errors = [...(carry.errors || []).map((e) => ({ ...e })), ...res.errors];
  const hints = (res.hints || 0) + (carry.hints || 0);
  return { ...res, errors, hints, clean: res.clean && errors.length === 0 && hints === 0, resumed: true };
}
