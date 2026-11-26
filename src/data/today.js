// „Днес“: опашката за преговор, нови линии и следваща дата — общо за „Курсове“, „Преговор“,
// „Тренировка“ и значката на раздела. Без DOM; чете от ctx.userDb и ctx.store.
import { reviewQueue, nextReviewAt, dueCountByCourse, newLeftToday } from '../srs/queue.js';
import { dayNumber } from '../srs/fsrs.js';
import { T, fmt } from '../i18n/bg.js';

/** Параметрите на FSRS/преговора от настройките (за recordAttempt и ensureCards). */
export function srsSettings(settings) {
  const g = (k) => settings.get(k);
  return {
    retention: g('retention'), maxIntervalDays: g('maxIntervalDays'), reviewFuzz: g('reviewFuzz'),
    relearnStreak: g('relearnStreak'), hardAfterSec: g('hardAfterSec'), reviewErrorsForAgain: g('reviewErrorsForAgain'),
    dayStartHour: g('dayStartHour'), firstReviewDays: g('firstReviewDays'),
  };
}

/**
 * @returns {Promise<{queue, items: Array<{courseId, lineId, n, row}>, nextAt: number|null,
 *   dueByCourse: Map<string, number>, day: object, newLeft: number, now: number}>}
 */
export async function loadToday(ctx) {
  const now = ctx.now();
  const S = ctx.settings;
  const dsh = S.get('dayStartHour');
  const empty = { queue: { items: [], dueTotal: 0, limited: false, left: null }, items: [], nextAt: null, dueByCourse: new Map(), day: null, newLeft: S.get('newLinesPerDay'), now };
  if (!ctx.userDb) return empty;
  const { view } = await ctx.data();
  const mine = (await ctx.userDb.listMyCourses()).filter((r) => !r.hidden && view.byId.get(r.courseId)?.available);
  const learned = await ctx.userDb.learnedRows();
  const visible = new Set(mine.map((r) => r.courseId));
  const rows = learned.filter((r) => visible.has(r.courseId));
  // Текущите линии на курсовете с научени линии (orphan линиите не се броят).
  const courses = [];
  for (const m of mine) {
    let lineIds = null;
    if (rows.some((r) => r.courseId === m.courseId)) {
      try { lineIds = new Set((await ctx.store.loadCourse(m.courseId)).lines.map((l) => l.id)); } catch { lineIds = null; }
    }
    courses.push({ courseId: m.courseId, lineIds });
  }
  const okRows = rows.filter((r) => {
    const c = courses.find((x) => x.courseId === r.courseId);
    return !c.lineIds || c.lineIds.has(r.lineId);
  });
  const day = await ctx.userDb.dayStats(now, dsh);
  const queue = reviewQueue({
    courses, rows: okRows, now, dayStartHour: dsh,
    maxReviewsPerDay: S.get('maxReviewsPerDay'), reviewsDoneToday: day.reviews,
  });
  return {
    queue,
    items: queue.items.map((r) => ({ courseId: r.courseId, lineId: r.lineId, n: r.n, row: r })),
    nextAt: nextReviewAt(okRows, now, dsh),
    dueByCourse: dueCountByCourse(okRows, now, dsh),
    rows: okRows,
    day,
    newLeft: newLeftToday(S.get('newLinesPerDay'), day.newLearned),
    now,
  };
}

/** „днес“ / „утре (29 ноем.)“ / „след 14 дни (10 дек.)“. */
export function whenText(due, now, dayStartHour = 0) {
  if (due == null) return '';
  const n = dayNumber(due, dayStartHour) - dayNumber(now, dayStartHour);
  const d = new Date(due);
  const date = `${d.getDate()} ${T.months[d.getMonth()]}`;
  if (n <= 0) return T.when.today;
  if (n === 1) return fmt(T.when.tomorrow, { date });
  return fmt(T.when.inDays, { n, date });
}
