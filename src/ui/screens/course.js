// „Курс“ (#/course/<id>) — списък на линиите и „Учи следващата“ (ARCH_T-014 §5.3).
import { T, fmt } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { formatMoves, fullMoves } from '../../data/courseStore.js';
import { lineStatus, nextToLearn, courseProgress } from '../../data/progress.js';
import { h, screenHeader, asyncBlock } from '../dom.js';
import { hasCard, isDueToday } from '../../srs/review.js';
import { nextReviewAt } from '../../srs/queue.js';
import { whenText } from '../../data/today.js';
import { updateIsRecent } from '../../data/dataUpdate.js';

const STATUS_ICON = { new: '○', learning: '◐', learned: '●' };

async function load(ctx, id) {
  const { view } = await ctx.data();
  const meta = view.byId.get(id);
  if (!meta || !meta.available) return { meta: null };
  const course = await ctx.store.loadCourse(id);
  const rows = ctx.userDb ? await ctx.userDb.progressByCourse(id) : [];
  const selected = ctx.userDb ? (await ctx.userDb.selectedIds()).has(id) : false;
  const upd = ctx.userDb ? await ctx.userDb.getMeta('dataUpdate').catch(() => null) : null;
  const update = upd && updateIsRecent(upd, ctx.now()) && upd.courses?.[id] ? { ...upd.courses[id], v: upd.to } : null;
  return { meta, course, rowsById: new Map(rows.map((r) => [r.lineId, r])), selected, update };
}

/** Сгънат раздел „Вече не са в курса“ (T-012): линии с прогрес, които ги няма в новите данни. */
function orphanSection(rows, startPly) {
  return h('details', { class: 'orphans', id: 'orphans' },
    h('summary', {}, fmt(T.course.orphans, { n: rows.length })),
    h('p', { class: 'hint' }, T.course.orphansHint),
    h('ul', { class: 'line-list orphan-list' }, rows.map((r) => {
      const prev = r.orphan?.prevStatus;
      const was = prev && prev !== 'new' ? fmt(T.course.orphanWas, { status: T.course.status[prev] || prev }) : null;
      const m = r.info?.m;
      return h('li', { class: 'orphan-row', dataset: { line: r.lineId } },
        h('span', { class: 'ln-n' }, String(r.orphan?.n ?? r.n ?? '')),
        h('span', { class: 'ln-body' },
          h('span', { class: 'ln-name' }, r.info?.name ? `${r.info.eco || ''} ${r.info.name.replace(/^[^:]*:\s*/, '') || r.info.name}`.trim() : fmt(T.course.orphanLine, { n: r.orphan?.n ?? r.n })),
          h('span', { class: 'ln-moves' }, m ? formatMoves(m, { from: Math.min(startPly, m.length - 1), max: 10 }) : T.course.orphanNoMoves),
          h('span', { class: 'ln-meta' }, [was, r.orphan?.dataVersion ? fmt(T.course.orphanSince, { v: r.orphan.dataVersion }) : null].filter(Boolean).join(' · '))));
    })));
}

export default {
  title: (route) => route.parts[0] || T.titles.course,
  render(root, ctx, route) {
    let alive = true;
    const id = route.parts[0] || '';
    root.append(h('a', { class: 'back', href: hrefFor('courses') }, T.course.back));
    asyncBlock(root, () => load(ctx, id), (box, { meta, course, rowsById, selected, update }) => {
      if (!meta) { box.append(screenHeader(T.titles.course), h('p', { class: 'error' }, T.course.notFound)); return; }
      document.title = `${meta.name.bg} · ${T.appName}`;
      box.append(
        screenHeader(meta.name.bg),
        h('p', { class: 'hint course-sub' }, `${T.sideIcon[meta.side]} ${T.side[meta.side]} · ${meta.name.en} · ${meta.eco}`),
      );
      if (!selected && ctx.userDb) {
        const note = h('p', { class: 'notice' }, T.course.notSelected, ' ',
          h('button', {
            type: 'button', class: 'btn secondary small',
            onclick: async () => { await ctx.userDb.setSelected(id, true); note.remove(); },
          }, T.course.add));
        box.append(note);
      }
      if (update && (update.added || update.removed)) {
        box.append(h('p', { class: 'notice', role: 'status', id: 'course-updated' }, update.added === null
          ? fmt(T.course.updatedRemoved, update)
          : fmt(T.course.updated, update)));
      }
      const newIds = new Set(update?.addedIds || []);
      const need = ctx.settings.get('learnStreak');
      const ids = new Set(course.lines.map((l) => l.id));
      const prog = courseProgress(course.lines.length, [...rowsById.values()], ids);
      const pct = prog.total ? Math.round((100 * prog.learned) / prog.total) : 0;
      box.append(h('div', { class: 'course-progress' },
        h('span', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': prog.total, 'aria-valuenow': prog.learned },
          h('span', { class: 'progress-fill', style: `width:${pct}%` })),
        h('span', { id: 'course-learned' }, fmt(T.course.learnedCount, { learned: prog.learned, total: prog.total }))));
      const now = ctx.now();
      const dsh = ctx.settings.get('dayStartHour');
      const cur = [...rowsById.values()].filter((r) => ids.has(r.lineId));
      const due = course.lines.filter((l) => isDueToday(rowsById.get(l.id), now, dsh));
      const nextAt = nextReviewAt(cur, now, dsh);
      if (cur.some(hasCard)) {
        box.append(h('div', { class: 'course-review', id: 'course-review' },
          h('span', { id: 'course-due' }, fmt(T.course.reviewSummary, { n: due.length })),
          nextAt ? h('span', { class: 'hint', id: 'course-next' }, ` · ${fmt(T.course.reviewNext, { when: whenText(nextAt, now, dsh) })}`) : null,
          due.length ? h('a', { class: 'btn secondary small', id: 'course-review-btn', href: hrefFor('review') }, fmt(T.course.reviewBtn, { n: due.length })) : null));
      }
      const next = nextToLearn(course.lines, rowsById);
      box.append(next
        ? h('a', { class: 'btn block', id: 'learn-next', href: `${hrefFor('train', id, next.id)}?mode=learn` }, `${T.course.learnNext} (${next.n})`)
        : h('p', { class: 'notice' }, T.course.allLearned));

      box.append(h('h2', { class: 'section-title' }, `${T.course.lines} (${course.lines.length})`));
      box.append(h('ol', { class: 'line-list' }, course.lines.map((l) => {
        const r = rowsById.get(l.id);
        const st = lineStatus(r);
        let label = st === 'learning' ? `${T.course.status.learning} ${fmt(T.course.learningStreak, { streak: Math.min(r.streak || 0, need), need })}` : T.course.status[st];
        let dueAttr = null;
        if (st === 'learned' && hasCard(r)) {
          const today = isDueToday(r, now, dsh);
          label += ` · ${today ? T.course.dueToday : fmt(T.course.dueIn, { when: whenText(r.due, now, dsh) })}`;
          dueAttr = today ? 'today' : 'later';
        }
        return h('li', { class: 'line-row', dataset: { line: l.id, status: st, ...(dueAttr ? { due: dueAttr } : {}) } },
          h('a', { href: `${hrefFor('train', id, l.id)}?mode=learn` },
            h('span', { class: 'ln-n' }, String(l.n)),
            h('span', { class: 'ln-body' },
              h('span', { class: 'ln-name' }, l.name ? `${l.eco} ${l.name.replace(/^[^:]*:\s*/, '') || l.name}` : (l.eco || meta.name.en)),
              h('span', { class: 'ln-moves' }, formatMoves(l.sans, { from: Math.min(course.startPly, l.sans.length - 1), max: 10 })),
              h('span', { class: 'ln-meta' },
                fmt(T.course.moves, { n: fullMoves(l.sans.length) }),
                l.toN ? h('span', { class: 'ln-to' }, ` · ${fmt(T.course.transpose, { n: l.toN })}`) : null),
            ),
            h('span', { class: `ln-status st-${st}`, title: T.course.status[st] },
              newIds.has(l.id) && st === 'new' ? h('span', { class: 'badge-new' }, T.course.newBadge) : null,
              h('span', { 'aria-hidden': 'true' }, STATUS_ICON[st]), ' ', label),
          ));
      })));
      const orphans = [...rowsById.values()].filter((r) => r.status === 'orphan').sort((a, b) => (a.n || 0) - (b.n || 0));
      if (orphans.length) box.append(orphanSection(orphans, course.startPly));
    }, () => alive);
    return () => { alive = false; };
  },
};
