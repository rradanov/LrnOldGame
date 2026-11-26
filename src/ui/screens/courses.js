// „Моите курсове“ (#/courses, начален екран) — ARCH_T-014 §5.2.
import { T, fmt } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { courseProgress } from '../../data/progress.js';
import { h, screenHeader, asyncBlock } from '../dom.js';
import { loadToday, whenText } from '../../data/today.js';
import { nextReviewAt } from '../../srs/queue.js';

async function load(ctx) {
  const { view } = await ctx.data();
  const mine = ctx.userDb ? (await ctx.userDb.listMyCourses()).filter((r) => !r.hidden) : [];
  const today = await loadToday(ctx);
  const dsh = ctx.settings.get('dayStartHour');
  const cards = [];
  for (const r of mine) {
    const c = view.byId.get(r.courseId);
    if (!c || !c.available) continue; // курс, който вече го няма в каталога/данните
    const rows = await ctx.userDb.progressByCourse(c.id);
    const okRows = today.rows ? today.rows.filter((x) => x.courseId === c.id) : [];
    cards.push({
      course: c, progress: courseProgress(c.lines, rows),
      due: today.dueByCourse.get(c.id) || 0,
      nextAt: nextReviewAt(okRows, today.now, dsh), now: today.now, dsh,
    });
  }
  return { cards, today };
}

function card({ course: c, progress: p, due, nextAt, now, dsh }) {
  const pct = p.total ? Math.round((100 * p.learned) / p.total) : 0;
  return h('li', { class: 'course-card', dataset: { course: c.id } },
    h('a', { href: hrefFor('course', c.id) },
      h('span', { class: `side-icon side-${c.side}`, title: T.side[c.side], 'aria-label': T.side[c.side] }, T.sideIcon[c.side]),
      h('span', { class: 'cc-body' },
        h('span', { class: 'cc-name' }, c.name.bg),
        h('span', { class: 'cc-meta' }, `${c.eco} · ${fmt(T.courses.linesCount, { n: p.total })}`),
        h('span', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.learned },
          h('span', { class: 'progress-fill', style: `width:${pct}%` })),
        h('span', { class: 'cc-progress' }, fmt(T.courses.learned, { learned: p.learned, total: p.total }),
          due ? h('span', { class: 'cc-due' }, ` · ${fmt(T.courses.dueToday, { n: due })}`) : null,
          !due && nextAt ? h('span', { class: 'cc-next' }, ` · ${fmt(T.courses.nextReview, { when: whenText(nextAt, now, dsh) })}`) : null),
      ),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
    ));
}

export default {
  render(root, ctx) {
    let alive = true;
    root.append(screenHeader(T.courses.title));
    if (ctx.dataUpdated) {
      root.append(h('p', { class: 'notice', role: 'status' }, fmt(T.courses.dataUpdated, { v: ctx.dataUpdated })));
    }
    if (!ctx.userDb) root.append(h('p', { class: 'error' }, T.dbError));
    asyncBlock(root, () => load(ctx), (box, { cards, today }) => {
      if (!cards.length) {
        box.append(
          h('div', { class: 'empty-state' },
            h('p', { class: 'empty-note' }, T.courses.empty),
            h('a', { class: 'btn', href: hrefFor('catalog') }, T.courses.emptyCta)),
        );
        return;
      }
      const fresh = today.newLeft;
      box.append(
        h('div', { class: 'today-summary' },
          h('span', { id: 'today-line' }, fmt(T.courses.today, { reviews: today.queue.items.length, fresh })),
          h('a', { class: 'btn secondary small', href: hrefFor('review') }, T.courses.reviewBtn)),
        h('ul', { class: 'course-list' }, cards.map(card)),
      );
    }, () => alive);
    return () => { alive = false; };
  },
};
