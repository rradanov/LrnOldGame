// Дневни опашки (ARCH_T-014 §5.2, §5.5; T-010). Чисти функции, без DOM.
//
// Преговор: научените линии с due ≤ края на днешния ден (с dayStartHour) от видимите курсове,
// групирани по курс (в реда на „Моите курсове“) и по номер на линията, до maxReviewsPerDay
// (0 = без лимит), като вече направените днес преговори се броят. Линиите в повторение след
// „Отново“ (същия ден) са винаги в опашката — те вече са броени.
// Нови: до newLinesPerDay за деня минус научените днес; в реда на линиите (по n).
import { dayNumber, dayStart } from './fsrs.js';
import { hasCard, inRelearn, isDueToday } from './review.js';
import { lineStatus } from '../data/progress.js';

/**
 * @param {object} o
 * @param {Array<{courseId: string, lineIds?: Set<string>}>} o.courses видимите курсове по ред; lineIds — текущите линии в данните
 * @param {Array<object>} o.rows всички редове от lineProgress (или само научените)
 * @param {number} o.now
 * @param {number} [o.dayStartHour]
 * @param {number} [o.maxReviewsPerDay] 0 = без лимит
 * @param {number} [o.reviewsDoneToday] daily.reviews за днес
 * @returns {{items: object[], dueTotal: number, limited: boolean, left: number|null}}
 */
export function reviewQueue({ courses, rows, now, dayStartHour = 0, maxReviewsPerDay = 0, reviewsDoneToday = 0 }) {
  const order = new Map(courses.map((c, i) => [c.courseId, i]));
  const ok = new Map(courses.map((c) => [c.courseId, c.lineIds || null]));
  const due = [];
  const relearn = [];
  for (const r of rows) {
    if (!order.has(r.courseId)) continue;
    const ids = ok.get(r.courseId);
    if (ids && !ids.has(r.lineId)) continue; // линия, която я няма в данните (orphan)
    if (!isDueToday(r, now, dayStartHour)) continue;
    (inRelearn(r, now, dayStartHour) ? relearn : due).push(r);
  }
  const cmp = (a, b) => order.get(a.courseId) - order.get(b.courseId) || (a.n || 0) - (b.n || 0);
  due.sort(cmp);
  relearn.sort(cmp);
  const left = maxReviewsPerDay > 0 ? Math.max(0, maxReviewsPerDay - reviewsDoneToday) : null;
  const taken = left === null ? due : due.slice(0, left);
  return {
    items: [...relearn, ...taken],
    dueTotal: due.length + relearn.length,
    limited: left !== null && due.length > left,
    left,
  };
}

/** Колко нови линии остават за днес (newLinesPerDay − научени днес). */
export const newLeftToday = (newLinesPerDay, newLearnedToday = 0) => Math.max(0, newLinesPerDay - newLearnedToday);

/**
 * Следващите нови/учени линии за днес: по курс и по n, общо до `left`.
 * @param {Array<{courseId: string, lines: Array<{id, n}>}>} courses
 * @param {Map<string, object>} rowsByKey "<courseId>/<lineId>" → ред
 */
export function newQueue({ courses, rowsByKey, left }) {
  const out = [];
  for (const c of courses) {
    for (const l of c.lines) {
      if (out.length >= left) return out;
      if (lineStatus(rowsByKey.get(`${c.courseId}/${l.id}`)) !== 'learned') out.push({ courseId: c.courseId, lineId: l.id, n: l.n });
    }
  }
  return out;
}

/** Най-ранният бъдещ преговор (ms, начало на деня) сред редовете — или null. */
export function nextReviewAt(rows, now, dayStartHour = 0) {
  const today = dayNumber(now, dayStartHour);
  let best = null;
  for (const r of rows) {
    if (!hasCard(r) || r.due == null) continue;
    const d = dayNumber(r.due, dayStartHour);
    if (d <= today) continue;
    if (best === null || d < best) best = d;
  }
  return best === null ? null : dayStart(best, dayStartHour);
}

/** След колко дни (0 = днес) е преговорът на реда. */
export function daysUntil(row, now, dayStartHour = 0) {
  if (!hasCard(row) || row.due == null) return null;
  return Math.max(0, dayNumber(row.due, dayStartHour) - dayNumber(now, dayStartHour));
}

/** Брой за преговор днес по курс (без лимита) — за картите в „Курсове“ и екрана „Курс“. */
export function dueCountByCourse(rows, now, dayStartHour = 0) {
  const m = new Map();
  for (const r of rows) if (isDueToday(r, now, dayStartHour)) m.set(r.courseId, (m.get(r.courseId) || 0) + 1);
  return m;
}
