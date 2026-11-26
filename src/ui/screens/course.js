// „Курс“ (#/course/<id>) — списък на линиите и „Учи следващата“ (ARCH_T-014 §5.3).
import { T, fmt } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { formatMoves, fullMoves } from '../../data/courseStore.js';
import { lineStatus, nextToLearn, courseProgress } from '../../data/progress.js';
import { h, screenHeader, asyncBlock } from '../dom.js';

const STATUS_ICON = { new: '○', learning: '◐', learned: '●' };

async function load(ctx, id) {
  const { view } = await ctx.data();
  const meta = view.byId.get(id);
  if (!meta || !meta.available) return { meta: null };
  const course = await ctx.store.loadCourse(id);
  const rows = ctx.userDb ? await ctx.userDb.progressByCourse(id) : [];
  const selected = ctx.userDb ? (await ctx.userDb.selectedIds()).has(id) : false;
  return { meta, course, rowsById: new Map(rows.map((r) => [r.lineId, r])), selected };
}

export default {
  title: (route) => route.parts[0] || T.titles.course,
  render(root, ctx, route) {
    let alive = true;
    const id = route.parts[0] || '';
    root.append(h('a', { class: 'back', href: hrefFor('courses') }, T.course.back));
    asyncBlock(root, () => load(ctx, id), (box, { meta, course, rowsById, selected }) => {
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
      const need = ctx.settings.get('learnStreak');
      const ids = new Set(course.lines.map((l) => l.id));
      const prog = courseProgress(course.lines.length, [...rowsById.values()], ids);
      const pct = prog.total ? Math.round((100 * prog.learned) / prog.total) : 0;
      box.append(h('div', { class: 'course-progress' },
        h('span', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': prog.total, 'aria-valuenow': prog.learned },
          h('span', { class: 'progress-fill', style: `width:${pct}%` })),
        h('span', { id: 'course-learned' }, fmt(T.course.learnedCount, { learned: prog.learned, total: prog.total }))));
      const next = nextToLearn(course.lines, rowsById);
      box.append(next
        ? h('a', { class: 'btn block', id: 'learn-next', href: `${hrefFor('train', id, next.id)}?mode=learn` }, `${T.course.learnNext} (${next.n})`)
        : h('p', { class: 'notice' }, T.course.allLearned));

      box.append(h('h2', { class: 'section-title' }, `${T.course.lines} (${course.lines.length})`));
      box.append(h('ol', { class: 'line-list' }, course.lines.map((l) => {
        const r = rowsById.get(l.id);
        const st = lineStatus(r);
        const label = st === 'learning' ? `${T.course.status.learning} ${fmt(T.course.learningStreak, { streak: Math.min(r.streak || 0, need), need })}` : T.course.status[st];
        return h('li', { class: 'line-row', dataset: { line: l.id, status: st } },
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
              h('span', { 'aria-hidden': 'true' }, STATUS_ICON[st]), ' ', label),
          ));
      })));
    }, () => alive);
    return () => { alive = false; };
  },
};
