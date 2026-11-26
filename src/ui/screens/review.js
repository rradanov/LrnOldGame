// „Преговор днес“ (#/review) — ARCH_T-014 §5.5, T-020.
// Опашката: научените линии с due ≤ днес от видимите курсове, по курс и по ред, до maxReviewsPerDay.
// „Започни преговор“ отваря първата линия в режим review; тренировката води към следващата.
import { T, fmt } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { loadToday, whenText } from '../../data/today.js';
import { inRelearn } from '../../srs/review.js';
import { dayNumber } from '../../srs/fsrs.js';
import { formatMoves } from '../../data/courseStore.js';
import { h, screenHeader, asyncBlock } from '../dom.js';
import { dbRecoverBox } from '../dbRecover.js';

export const reviewHref = (it) => `${hrefFor('train', it.courseId, it.lineId)}?mode=review`;

async function load(ctx) {
  const today = await loadToday(ctx);
  const { view } = await ctx.data();
  const lines = [];
  for (const it of today.items) {
    const meta = view.byId.get(it.courseId);
    let line = null;
    try { line = (await ctx.store.loadCourse(it.courseId)).byId.get(it.lineId) || null; } catch { line = null; }
    lines.push({ ...it, meta, line });
  }
  return { today, lines };
}

export default {
  render(root, ctx) {
    let alive = true;
    root.append(screenHeader(T.review.title));
    if (!ctx.userDb) root.append(dbRecoverBox(ctx));
    asyncBlock(root, () => load(ctx), (box, { today, lines }) => {
      const dsh = ctx.settings.get('dayStartHour');
      const { queue, day } = today;
      const n = lines.length;
      if (day && day.reviews) {
        box.append(h('p', { class: 'hint', id: 'review-today' }, fmt(T.review.doneToday, { reviews: day.reviews, again: day.reviewErrors || 0 })));
      }
      if (!n) {
        const reached = queue.left === 0 && queue.dueTotal > 0;
        box.append(h('div', { class: 'empty-state', id: 'review-empty' },
          h('p', { class: 'empty-big' }, day && day.reviews ? T.review.allDone : T.review.empty),
          reached ? h('p', { class: 'notice' }, fmt(T.review.limitReached, { max: ctx.settings.get('maxReviewsPerDay'), total: queue.dueTotal })) : null,
          today.nextAt
            ? h('p', { class: 'hint', id: 'review-next' }, fmt(T.review.nextAt, { when: whenText(today.nextAt, today.now, dsh) }))
            : (today.rows && today.rows.length ? null : h('p', { class: 'hint' }, T.review.noneLearned)),
          today.newLeft > 0
            ? h('a', { class: 'btn secondary', href: hrefFor('courses'), id: 'learn-new' }, fmt(T.review.learnNew, { n: today.newLeft }))
            : null));
        return;
      }
      box.append(...[
        h('p', { class: 'review-count', id: 'review-count' }, fmt(T.review.count, { n })),
        queue.limited ? h('p', { class: 'hint' }, fmt(T.review.limited, { n, total: queue.dueTotal })) : null,
        h('a', { class: 'btn block', id: 'review-start', href: reviewHref(lines[0]) }, T.review.start),
      ].filter(Boolean)); // T013-D2: нативният append превръща null в текст „null“
      let lastCourse = null;
      const list = h('ol', { class: 'line-list review-list', id: 'review-list' });
      for (const it of lines) {
        if (it.courseId !== lastCourse) {
          lastCourse = it.courseId;
          list.append(h('li', { class: 'review-course' }, `${T.sideIcon[it.meta?.side] || ''} ${it.meta?.name.bg || it.courseId}`));
        }
        const late = it.row.due != null ? dayNumber(today.now, dsh) - dayNumber(it.row.due, dsh) : 0;
        const relearn = inRelearn(it.row, today.now, dsh);
        list.append(h('li', { class: 'line-row', dataset: { line: it.lineId, course: it.courseId } },
          h('a', { href: reviewHref(it) },
            h('span', { class: 'ln-n' }, String(it.n)),
            h('span', { class: 'ln-body' },
              h('span', { class: 'ln-name' }, it.line?.name ? `${it.line.eco} ${it.line.name.replace(/^[^:]*:\s*/, '') || it.line.name}` : (it.line?.eco || '')),
              it.line ? h('span', { class: 'ln-moves' }, formatMoves(it.line.sans, { from: 0, max: 8 })) : null),
            h('span', { class: 'ln-status st-due' },
              relearn ? T.review.relearnTag : (late > 0 ? fmt(T.review.dueIn, { n: late }) : '')),
          )));
      }
      box.append(list);
    }, () => alive);
    return () => { alive = false; };
  },
};
