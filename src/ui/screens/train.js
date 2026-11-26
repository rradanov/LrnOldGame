// #/train/<courseId>/<lineId> — засега само преглед на линията ход по ход (◀ ▶).
// Истинската тренировка (вход от дъската, брояч, грешки) идва в T-021.
import { T, fmt } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { Position, START_FEN } from '../../chess/position.js';
import { h, screenHeader, asyncBlock } from '../dom.js';
import { createBoard, orientationFor } from '../board.js';

async function load(ctx, courseId, lineId) {
  const { view } = await ctx.data();
  const meta = view.byId.get(courseId);
  if (!meta || !meta.available) return {};
  const course = await ctx.store.loadCourse(courseId);
  return { meta, course, line: course.byId.get(lineId) || null };
}

/** FEN след всеки полуход (индекс 0 = началната позиция) и последните ходове. */
export function lineFrames(sans) {
  const p = new Position(START_FEN);
  const frames = [{ fen: p.fen(), last: null }];
  for (const san of sans) {
    const m = p.playSan(san);
    frames.push({ fen: p.fen(), last: { from: m.from, to: m.to } });
  }
  return frames;
}

export default {
  render(root, ctx, route) {
    let alive = true;
    let board = null;
    let onKey = null;
    const [courseId = '', lineId = ''] = route.parts;
    const back = h('a', { class: 'back', href: hrefFor('course', courseId) }, T.course.back);
    root.append(back);
    asyncBlock(root, () => load(ctx, courseId, lineId), (box, { meta, course, line }) => {
      if (!line) { box.append(screenHeader(T.titles.train), h('p', { class: 'error' }, T.train.notFound)); return; }
      back.textContent = fmt(T.train.back, { course: meta.name.bg });
      const title = fmt(T.train.header, { course: meta.name.bg, n: line.n, total: course.lines.length });
      document.title = `${title} · ${T.appName}`;
      const frames = lineFrames(line.sans);
      const total = line.sans.length;
      let ply = ctx.settings.get('autoPlayStart') ? Math.min(course.startPly, total) : 0;

      const holder = h('div', { class: 'board-wrap', 'aria-label': T.train.boardLabel });
      const counter = h('p', { class: 'ply-counter', id: 'ply-counter', 'aria-live': 'polite' });
      const comment = h('p', { class: 'move-comment' });
      const moves = h('ol', { class: 'move-list' });
      const btn = (label, sym, fn, id) => h('button', { type: 'button', class: 'btn nav-btn', id, 'aria-label': label, title: label, onclick: fn }, sym);
      const bFirst = btn(T.train.first, '⏮', () => go(0), 'nav-first');
      const bPrev = btn(T.train.prev, '◀', () => go(ply - 1), 'nav-prev');
      const bNext = btn(T.train.next, '▶', () => go(ply + 1), 'nav-next');
      const bLast = btn(T.train.last, '⏭', () => go(total), 'nav-last');

      const moveEls = line.sans.map((san, i) => {
        const label = i % 2 === 0 ? `${i / 2 + 1}.${san}` : san;
        return h('button', { type: 'button', class: `mv${i < course.startPly ? ' mv-start' : ''}${line.tail !== null && i >= line.tail ? ' mv-tail' : ''}`, dataset: { ply: i + 1 }, onclick: () => go(i + 1) }, label);
      });
      moves.append(...moveEls.map((el) => h('li', {}, el)));

      function go(n) {
        const prevPly = ply;
        ply = Math.max(0, Math.min(total, n));
        board?.setPosition(frames[ply].fen, frames[ply].last, Math.abs(ply - prevPly) === 1).catch(() => {});
        counter.textContent = ply === 0 ? T.train.start : fmt(T.train.ply, { i: ply, total });
        moveEls.forEach((el, i) => el.toggleAttribute('aria-current', i === ply - 1));
        const c = ply > 0 ? line.moves[ply - 1].comment : null;
        comment.textContent = c || '';
        comment.hidden = !c;
        bFirst.disabled = bPrev.disabled = ply === 0;
        bNext.disabled = bLast.disabled = ply === total;
      }

      const endText = T.train.end[line.end] || '';
      box.append(
        screenHeader(title),
        holder,
        h('div', { class: 'nav-row' }, bFirst, bPrev, counter, bNext, bLast),
        comment,
        moves,
        h('p', { class: 'hint line-end' }, endText, line.cp !== null ? ` (${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(2)})` : '',
          line.toN ? h('span', {}, ' · ', h('a', { href: `${hrefFor('train', courseId, line.to)}?mode=learn` }, fmt(T.course.transpose, { n: line.toN }))) : null),
        h('p', { class: 'notice' }, T.train.previewNote),
      );
      try {
        board = createBoard(holder, {
          fen: frames[ply].fen,
          orientation: orientationFor(ctx.settings.get('boardOrientation'), meta.side),
          animationMs: ctx.settings.get('animationMs'),
        });
      } catch (err) {
        console.error(err);
        holder.replaceWith(h('p', { class: 'error' }, T.train.boardError));
      }
      go(ply);
      onKey = (e) => {
        if (e.key === 'ArrowLeft') go(ply - 1);
        else if (e.key === 'ArrowRight') go(ply + 1);
      };
      window.addEventListener('keydown', onKey);
    }, () => alive);
    return () => {
      alive = false;
      if (onKey) window.removeEventListener('keydown', onKey);
      board?.destroy();
    };
  },
};
