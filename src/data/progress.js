// Статус на линиите и прогрес на курс (ARCH_T-014 §4). Без DOM.
// Линия без ред в lineProgress е „new“; „orphan“ (линия, която я няма в данните) не се брои.

export function lineStatus(row) {
  if (!row || row.status === 'orphan') return 'new';
  return row.status === 'learned' || row.status === 'learning' ? row.status : 'new';
}

/**
 * @param {number} total брой линии в курса (от manifest)
 * @param {Array<object>} rows редовете от lineProgress за курса
 * @param {Set<string>} [lineIds] ако е подаден — броят се само тези линии (текущите данни)
 */
export function courseProgress(total, rows, lineIds = null) {
  let learned = 0;
  let learning = 0;
  for (const r of rows || []) {
    if (lineIds && !lineIds.has(r.lineId)) continue;
    const s = lineStatus(r);
    if (s === 'learned') learned++;
    else if (s === 'learning') learning++;
  }
  return { total, learned, learning, fresh: Math.max(0, total - learned - learning) };
}

/** Първата линия по ред, която не е научена (за „Учи следващата“). */
export function nextToLearn(lines, rowsById) {
  return lines.find((l) => lineStatus(rowsById.get(l.id)) !== 'learned') || null;
}

/**
 * Следващата линия за учене след `currentId` (по ред n = по вероятност), с обикаляне от началото.
 * Връща null, ако всички останали са научени.
 */
export function nextAfter(lines, rowsById, currentId) {
  const i = lines.findIndex((l) => l.id === currentId);
  const order = i < 0 ? lines : [...lines.slice(i + 1), ...lines.slice(0, i)];
  return order.find((l) => lineStatus(rowsById.get(l.id)) !== 'learned') || null;
}

/**
 * Ден за `daily` (YYYY-MM-DD, местно време): денят започва в dayStartHour (ARCH §4).
 * 03:59 при dayStartHour 4 е още предишният ден.
 */
export function dayKey(ts, dayStartHour = 0) {
  const d = new Date(ts - dayStartHour * 3600_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Нов ред на lineProgress (ARCH §4) — създава се при първото отваряне на линията. */
export function newLineRow({ courseId, lineId, n }, now) {
  return {
    key: `${courseId}/${lineId}`, courseId, lineId, n,
    status: 'new', streak: 0, bestStreak: 0, plays: 0, cleanPlays: 0, errors: 0, hints: 0,
    firstSeen: now, lastPlayed: null, learnedAt: null, due: null,
    // Картата на FSRS (T-010) се създава при „научена“: първи преглед Good в learnedAt.
    // Тук само подготвяме полетата; reps 0 = картата още не е създадена.
    fsrs: { stability: null, difficulty: null, reps: 0, lapses: 0, state: 'new', lastReview: null },
  };
}

/**
 * Прилага един опит в режим learn към реда на линията (чиста функция).
 * Чист опит → streak + 1; иначе streak = 0. При streak ≥ learnStreak линията става „научена“
 * (веднъж — learnedAt не се презаписва; грешка в learn не я връща в „учи се“, това е работа на преговора).
 * @returns {{row: object, becameLearned: boolean}}
 */
export function applyAttempt(row, res, { courseId, lineId, n, learnStreak, now }) {
  const base = row ? { ...row, fsrs: row.fsrs ? { ...row.fsrs } : newLineRow({ courseId, lineId, n }, now).fsrs } : newLineRow({ courseId, lineId, n }, now);
  const out = { ...base, n };
  out.plays = (out.plays || 0) + 1;
  out.errors = (out.errors || 0) + res.errors.length;
  out.hints = (out.hints || 0) + (res.hints || 0);
  out.lastPlayed = now;
  if (res.clean) {
    out.cleanPlays = (out.cleanPlays || 0) + 1;
    out.streak = (out.streak || 0) + 1;
  } else {
    out.streak = 0;
  }
  out.bestStreak = Math.max(out.bestStreak || 0, out.streak);
  let becameLearned = false;
  if (out.status !== 'learned') {
    if (out.streak >= learnStreak) {
      out.status = 'learned';
      out.learnedAt = now;
      becameLearned = true;
    } else {
      out.status = 'learning';
    }
  }
  return { row: out, becameLearned };
}
