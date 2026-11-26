// Преговор на линия по FSRS (ARCH_T-014 §4, §5.4–5.5; D-008, D-015). Чисти функции, без DOM.
//
// Автоматична оценка на опит в режим review (Easy не се ползва):
//   - грешки ≥ reviewErrorsForAgain (подразбиране 1 = всяка грешка) или незавършен опит → Again;
//   - верни ходове, но подсказка, бавен ход (> hardAfterSec) или по-малко грешки от прага → Hard;
//   - иначе → Good.
// След Again линията се играе веднага отново, докато не мине relearnStreak пъти чисто
// (същия ден). Тези повторения не променят картата — FSRS вижда един преглед на ден.
import { next, GRADE, GRADE_NAME, dayNumber, emptyCard } from './fsrs.js';

/** Оценка (1..3) на един опит в режим преговор. */
export function gradeAttempt(res, { hardAfterSec = 15, reviewErrorsForAgain = 1 } = {}) {
  const nErr = res.errors ? res.errors.length : 0;
  if (!res.done || nErr >= reviewErrorsForAgain) return GRADE.again;
  if (nErr > 0 || (res.hints || 0) > 0) return GRADE.hard;
  if ((res.maxMoveMs || 0) > hardAfterSec * 1000) return GRADE.hard;
  return GRADE.good;
}

/** Семе за детерминираното размиване: една и съща линия и преглед → един и същ интервал. */
const seedFor = (row, reps) => `${row.key}|${reps}`;

/** Опции на FSRS от настройките. */
export function fsrsOpts(o = {}) {
  return {
    retention: o.retention ?? 0.9,
    dayStartHour: o.dayStartHour ?? 0,
    maxInterval: o.maxIntervalDays ?? 36500,
    fuzz: !!o.reviewFuzz,
  };
}

/**
 * Създава картата на научена линия: първи преглед Good в момента на научаване (ARCH §4).
 * Връща нов ред (не пипа входа). Ако картата вече съществува — връща реда без промяна.
 */
export function createCard(row, at, opts = {}) {
  if (row.fsrs && row.fsrs.reps > 0) return row;
  const o = fsrsOpts(opts);
  const r = next(null, GRADE.good, at, { ...o, fuzzSeed: o.fuzz ? seedFor(row, 0) : null });
  return { ...row, fsrs: r.card, due: r.due, relearnLeft: 0, relearnDay: null };
}

/** Има ли линията карта (т.е. научена и планирана). */
export const hasCard = (row) => !!(row && row.status === 'learned' && row.fsrs && row.fsrs.reps > 0);

/** Линията е в повторение след Again днес. */
export const inRelearn = (row, now, dayStartHour = 0) =>
  !!(row && row.relearnLeft > 0 && row.relearnDay === dayNumber(now, dayStartHour));

/** Линията е за преговор днес (due ≤ края на деня) или е в повторение. */
export function isDueToday(row, now, dayStartHour = 0) {
  if (!hasCard(row)) return false;
  if (inRelearn(row, now, dayStartHour)) return true;
  return row.due != null && dayNumber(row.due, dayStartHour) <= dayNumber(now, dayStartHour);
}

/**
 * Прилага един опит в режим review (чиста функция).
 * @returns {{row, grade: number|null, gradeName: string|null, relearn: boolean, interval: number|null, relearnLeft: number}}
 *   grade = null, когато опитът е повторение след Again (картата не се пипа).
 */
export function applyReview(row, res, { now, relearnStreak = 1, hardAfterSec = 15, reviewErrorsForAgain = 1, ...settings }) {
  const o = fsrsOpts(settings);
  const out = { ...row, fsrs: { ...(row.fsrs || emptyCard()) } };
  out.plays = (out.plays || 0) + 1;
  out.errors = (out.errors || 0) + (res.errors ? res.errors.length : 0);
  out.hints = (out.hints || 0) + (res.hints || 0);
  out.lastPlayed = now;
  if (res.clean) out.cleanPlays = (out.cleanPlays || 0) + 1;

  if (inRelearn(row, now, o.dayStartHour)) {
    out.relearnLeft = res.clean ? row.relearnLeft - 1 : relearnStreak;
    return { row: out, grade: null, gradeName: null, relearn: true, interval: null, relearnLeft: out.relearnLeft };
  }

  const grade = gradeAttempt(res, { hardAfterSec, reviewErrorsForAgain });
  const reps = out.fsrs.reps || 0;
  const r = next(out.fsrs, grade, now, { ...o, fuzzSeed: o.fuzz ? seedFor(row, reps) : null });
  out.fsrs = r.card;
  out.due = r.due;
  if (grade === GRADE.again) {
    out.relearnLeft = relearnStreak;
    out.relearnDay = dayNumber(now, o.dayStartHour);
  } else {
    out.relearnLeft = 0;
    out.relearnDay = null;
  }
  return { row: out, grade, gradeName: GRADE_NAME[grade], relearn: false, interval: r.interval, relearnLeft: out.relearnLeft };
}
