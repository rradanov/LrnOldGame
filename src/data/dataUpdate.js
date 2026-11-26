// Обновяване на данните без загуба на прогрес (D-023, ARCH_T-014 §4, T-012). Чисти функции, без DOM.
//
// При нов dataVersion:
// - линия със същия lineId запазва реда си в lineProgress (статус, брояч, FSRS карта); номерът n се обновява;
// - ред на линия, която я няма в новите данни → status 'orphan' („вече не е в курса“): не се трие,
//   не се брои в прогреса и не влиза в „Преговор“ (learnedRows чете само status 'learned'). Старият
//   статус е в row.orphan.prevStatus — ако линията се появи отново, редът се връща такъв, какъвто е бил;
// - линия, която я няма в предишния снимък (meta.lineIds), е „нова“ (+X в резюмето).
// Курс, който го няма в manifest, не се пипа (показва се като „не е генериран“).

/** Колко дни след обновяването новите линии носят знак „ново“ и курсът — бележка „Обновен“. */
export const UPDATE_NOTE_DAYS = 14;

/** Кратка информация за линията, която пазим в реда — за да може да се покаже и след като изчезне. */
export const lineInfo = (l) => ({ m: l.sans.slice(), name: l.name ?? null, eco: l.eco ?? null });

const sameInfo = (a, b) => !!a && !!b && a.name === b.name && a.eco === b.eco
  && Array.isArray(a.m) && a.m.length === b.m.length && a.m.every((s, i) => s === b.m[i]);

/**
 * @param {object} o
 * @param {Array<{id: string, lines: Array<{id, n, sans, name?, eco?}>}>} o.courses всички курсове от новия manifest
 * @param {Array<object>} o.rows всички редове от lineProgress
 * @param {Object<string, string[]>|null} o.prevLineIds снимката от предишните данни (meta.lineIds) или null
 * @param {string} o.dataVersion новата версия
 * @param {string|null} o.prevDataVersion предишната версия (null при първо пускане)
 * @param {number} o.now
 * @returns {{puts: object[], lineIds: Object<string, string[]>, courses: Object<string, object>}}
 *   courses[id] = {added: number|null, addedIds: string[], removed: number, orphaned: number, restored: number}
 *   (added е null, ако за курса няма предишен снимък — тогава не знаем кои линии са нови)
 */
export function planDataUpdate({ courses, rows, prevLineIds = null, dataVersion, prevDataVersion = null, now }) {
  const puts = [];
  const lineIds = {};
  const summary = {};
  const rowsByCourse = new Map();
  for (const r of rows || []) {
    if (!rowsByCourse.has(r.courseId)) rowsByCourse.set(r.courseId, []);
    rowsByCourse.get(r.courseId).push(r);
  }
  for (const c of courses) {
    const byId = new Map(c.lines.map((l) => [l.id, l]));
    lineIds[c.id] = c.lines.map((l) => l.id);
    const prev = prevLineIds && Array.isArray(prevLineIds[c.id]) ? new Set(prevLineIds[c.id]) : null;
    const s = { added: null, addedIds: [], removed: 0, orphaned: 0, restored: 0 };
    if (prev) {
      s.addedIds = c.lines.filter((l) => !prev.has(l.id)).map((l) => l.id);
      s.added = s.addedIds.length;
      for (const id of prev) if (!byId.has(id)) s.removed++;
    }
    for (const r of rowsByCourse.get(c.id) || []) {
      const l = byId.get(r.lineId);
      if (l) {
        const info = lineInfo(l);
        if (r.status === 'orphan') {
          const { orphan, ...rest } = r;
          puts.push({ ...rest, status: orphan?.prevStatus || 'new', n: l.n, info });
          s.restored++;
        } else if (r.n !== l.n || !sameInfo(r.info, info)) {
          puts.push({ ...r, n: l.n, info });
        }
      } else if (r.status !== 'orphan') {
        puts.push({
          ...r,
          status: 'orphan',
          orphan: { prevStatus: r.status || 'new', at: now, dataVersion, fromVersion: prevDataVersion, n: r.n },
        });
        s.orphaned++;
      }
    }
    // Без снимък (данни от преди 0.5.0) „оттеглени“ са поне тези с прогрес.
    if (!prev) s.removed = s.orphaned;
    summary[c.id] = s;
  }
  return { puts, lineIds, courses: summary };
}

/**
 * Резюме за „Моите курсове“ върху видимите курсове: {added, removed, changed}.
 * added се брои само там, където е известно (има снимък).
 */
export function summarize(update, visibleIds) {
  let added = 0;
  let removed = 0;
  for (const [id, s] of Object.entries(update?.courses || {})) {
    if (visibleIds && !visibleIds.has(id)) continue;
    added += s.added || 0;
    removed += s.removed || 0;
  }
  return { added, removed, changed: added + removed > 0 };
}

/** Дали бележката за обновяването още е актуална (UPDATE_NOTE_DAYS дни). */
export const updateIsRecent = (update, now) => !!update && now - (update.at || 0) < UPDATE_NOTE_DAYS * 86_400_000;
