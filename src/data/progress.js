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
