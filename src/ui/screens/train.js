// #/train/<courseId>/<lineId>?mode=learn — тренировка на линия (ARCH_T-014 §5.4, D-015, T-021).
// Логиката е в src/train/session.js (без DOM); тук са само дъската, текстовете и записът в IndexedDB.
import { T, fmt } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { Position } from '../../chess/position.js';
import { createSession, PHASE, lineFrames } from '../../train/session.js';
import { nextAfter } from '../../data/progress.js';
import { h, screenHeader, asyncBlock } from '../dom.js';
import { createBoard, orientationFor } from '../board.js';

export { lineFrames };

async function load(ctx, courseId, lineId) {
  const { view } = await ctx.data();
  const meta = view.byId.get(courseId);
  if (!meta || !meta.available) return {};
  const course = await ctx.store.loadCourse(courseId);
  const line = course.byId.get(lineId) || null;
  let row = null;
  let rowsById = new Map();
  if (line && ctx.userDb) {
    try {
      row = await ctx.userDb.touchLine(courseId, lineId, line.n);
      rowsById = new Map((await ctx.userDb.progressByCourse(courseId)).map((r) => [r.lineId, r]));
    } catch (e) { console.error(e); }
  }
  return { meta, course, line, row, rowsById };
}

const moveLabel = (i, san) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san);

export default {
  render(root, ctx, route) {
    let alive = true;
    let board = null;
    const timers = new Set();
    let abandon = null;
    const [courseId = '', lineId = ''] = route.parts;
    const back = h('a', { class: 'back', href: hrefFor('course', courseId) }, T.course.back);
    root.append(back);

    const later = (ms, fn) => {
      const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const clearTimers = () => { for (const t of timers) clearTimeout(t); timers.clear(); };

    asyncBlock(root, () => load(ctx, courseId, lineId), (box, { meta, course, line, row: row0, rowsById }) => {
      if (!line) { box.append(screenHeader(T.titles.train), h('p', { class: 'error' }, T.train.notFound)); return; }
      const S = ctx.settings;
      const need = S.get('learnStreak');
      let row = row0;
      back.textContent = fmt(T.train.back, { course: meta.name.bg });
      const title = fmt(T.train.header, { course: meta.name.bg, n: line.n, total: course.lines.length });
      document.title = `${title} · ${T.appName}`;

      const session = createSession({
        sans: line.sans,
        side: meta.side,
        startPly: course.startPly,
        autoPlayStart: S.get('autoPlayStart'),
        onError: S.get('onError'),
        hintResetsStreak: S.get('hintResetsStreak'),
        tail: line.tail,
        transposeTo: line.end === 'transpose' ? line.to : null,
      });

      // --- DOM ---
      const streakEl = h('p', { class: 'streak', id: 'streak', 'aria-live': 'polite' });
      const holder = h('div', { class: 'board-wrap', 'aria-label': T.train.boardLabel });
      const msg = h('p', { class: 'train-msg', id: 'train-msg', role: 'status', 'aria-live': 'polite' });
      const hintBtn = h('button', { type: 'button', class: 'btn secondary', id: 'hint-btn', onclick: () => doHint(false) }, T.train.hint);
      const restartBtn = h('button', { type: 'button', class: 'btn secondary', id: 'restart-btn', onclick: async () => { await abandonAttempt(); startAttempt(true); } }, T.train.restart);
      const moves = h('ol', { class: 'move-list played', id: 'played' });
      const donePanel = h('section', { class: 'train-done', id: 'train-done', hidden: true });

      box.append(...[
        screenHeader(title),
        h('p', { class: 'hint course-sub' }, line.name ? `${line.eco || ''} ${line.name}` : (line.eco || meta.name.en)),
        streakEl,
        holder,
        msg,
        h('div', { class: 'btn-row train-actions' }, hintBtn, restartBtn),
        donePanel,
        moves,
        line.tail !== null ? h('p', { class: 'hint tail-note' }, T.train.tailNote) : null,
      ].filter(Boolean));

      function drawStreak(dirty = false) {
        const cur = dirty ? 0 : (row?.streak || 0);
        const shown = Math.min(cur, need);
        const dots = '●'.repeat(shown) + '○'.repeat(Math.max(0, need - shown));
        const learned = row?.status === 'learned';
        streakEl.replaceChildren(
          h('span', { class: 'dots', 'aria-hidden': 'true' }, dots), ' ',
          h('span', { class: 'streak-n' }, fmt(T.train.streak, { streak: cur, need })),
          ...(learned ? [h('span', { class: 'learned-badge' }, ` · ● ${T.train.learnedBadge}`)] : []),
        );
        streakEl.setAttribute('aria-label', fmt(T.train.streakLabel, { streak: cur, need }));
        streakEl.dataset.streak = String(cur);
        streakEl.dataset.status = row?.status || 'new';
      }

      function say(text, kind = '') {
        msg.textContent = text;
        msg.dataset.kind = kind;
      }

      function drawMoves() {
        const n = session.ply;
        moves.replaceChildren(...line.sans.slice(0, n).map((san, i) => h('li', {},
          h('span', {
            class: `mv${i < course.startPly ? ' mv-start' : ''}${session.fromEngine(i) ? ' mv-tail' : ''}`,
            title: session.fromEngine(i) ? T.train.tailTitle : null,
            dataset: { ply: i + 1 },
          }, moveLabel(i, san)))));
      }

      // --- дъска ---
      try {
        board = createBoard(holder, {
          fen: session.frame(0).fen,
          orientation: orientationFor(S.get('boardOrientation'), meta.side),
          animationMs: S.get('animationMs'),
        });
      } catch (err) {
        console.error(err);
        holder.replaceWith(h('p', { class: 'error' }, T.train.boardError));
        return;
      }

      let inputOn = false;
      let hintTimer = null;
      let recorded = false;

      function enableInput() {
        const fen = session.frame().fen;
        const pos = new Position(fen);
        const dests = pos.dests();
        board.enableInput({
          color: meta.side,
          dests: () => dests,
          isPromotion: (from, to) => pos.isPromotion(from, to),
          onMove,
        });
        inputOn = true;
        hintBtn.disabled = false;
        const sec = S.get('hintAfterSec');
        if (sec > 0) hintTimer = later(sec * 1000, () => doHint(true));
      }
      function disableInput() {
        if (hintTimer) { clearTimeout(hintTimer); timers.delete(hintTimer); hintTimer = null; }
        board.disableInput();
        inputOn = false;
        hintBtn.disabled = true;
      }

      function step() {
        if (!alive) return;
        const ph = session.phase();
        if (ph === PHASE.AUTO) {
          // Стартовите ходове на курса — веднага, без пауза.
          while (session.phase() === PHASE.AUTO) session.playAuto();
          const f = session.frame();
          board.setPosition(f.fen, f.last, false).catch(() => {});
          drawMoves();
          step();
          return;
        }
        if (ph === PHASE.OPPONENT) {
          disableInput();
          say(T.train.opponent, 'wait');
          later(S.get('opponentDelayMs'), () => {
            const ev = session.playAuto();
            board.clearMarks('ok');
            board.setPosition(ev.fen, ev, true).catch(() => {});
            drawMoves();
            step();
          });
          return;
        }
        if (ph === PHASE.USER) {
          say(session.ply === 0 ? T.train.yourMoveStart : T.train.yourMove, 'turn');
          enableInput();
          return;
        }
        if (ph === PHASE.CORRECT) {
          say(fmt(T.train.playCorrect, { san: session.expected().san }), 'correct');
          enableInput();
          return;
        }
        if (ph === PHASE.DONE) finish();
      }

      function onMove(m) {
        if (!alive || !inputOn) return;
        const before = session.frame();
        if (m.canceled) { board.setPosition(before.fen, before.last, false).catch(() => {}); return; }
        let san;
        try {
          san = new Position(before.fen).playMove(m).san;
        } catch {
          board.setPosition(before.fen, before.last, false).catch(() => {});
          return;
        }
        disableInput();
        const res = session.userMove(san);
        board.clearArrows();
        board.clearMarks('hint');
        if (res.ok) {
          board.setPosition(res.fen, res, false).catch(() => {});
          board.clearMarks('ok');
          board.mark(res.to, 'ok');
          say(T.train.good, 'ok');
          drawMoves();
          step();
          return;
        }
        // Грешка: червен маркер, връщане, стрелка с верния ход, брояч → 0.
        drawStreak(true);
        board.mark(m.to, 'bad');
        say(fmt(res.restart ? T.train.restarting : T.train.wrong, { san: res.expected.san }), 'bad');
        later(S.get('wrongMoveMs'), () => {
          board.clearMarks('bad');
          board.setPosition(before.fen, before.last, false).catch(() => {});
          board.arrow(res.expected.from, res.expected.to);
          board.mark(res.expected.from, 'hint');
          if (res.restart) {
            later(S.get('errorPauseMs'), async () => {
              await record();
              startAttempt(true);
            });
          } else {
            step();
          }
        });
      }

      function doHint(auto) {
        if (!inputOn) return;
        const hnt = session.hint();
        if (!hnt) return;
        board.clearArrows();
        board.clearMarks('hint');
        board.arrow(hnt.from, hnt.to);
        board.mark(hnt.from, 'hint');
        say(fmt(T.train.hintText, { san: hnt.san }), auto ? 'hint auto' : 'hint');
        if (session.dirty()) drawStreak(true);
      }

      async function record() {
        if (recorded || !ctx.userDb) return null;
        recorded = true;
        try {
          const out = await ctx.userDb.recordAttempt({
            courseId, lineId, n: line.n, result: session.result(),
            learnStreak: need, dayStartHour: S.get('dayStartHour'),
          });
          row = out.row;
          rowsById.set(lineId, row);
          return out;
        } catch (e) {
          console.error(e);
          say(T.train.saveError, 'bad');
          return null;
        }
      }

      /** Прекъснат опит с грешка/подсказка се записва като неуспешен — иначе „Отначало“ би заобиколил нулирането. */
      function abandonAttempt() {
        if (!recorded && session.dirty() && session.phase() !== PHASE.DONE) return record();
        return Promise.resolve(null);
      }
      abandon = abandonAttempt;

      async function finish() {
        disableInput();
        restartBtn.disabled = true;
        const res = session.result();
        const out = await record();
        if (!alive) return;
        drawStreak();
        const st = out?.row || row;
        const streak = st?.streak || 0;
        let text;
        let kind;
        if (out?.becameLearned) { text = fmt(T.train.doneLearned, { streak, need }); kind = 'learned'; }
        else if (res.clean && st?.status === 'learned') { text = T.train.doneAlreadyLearned; kind = 'clean'; }
        else if (res.clean) { text = fmt(T.train.doneClean, { streak, need }); kind = 'clean'; }
        else { text = fmt(T.train.doneErrors, { streak, need }); kind = 'errors'; }
        say('', '');
        const next = nextAfter(course.lines, rowsById, lineId);
        const toLine = res.transposeTo ? course.byId.get(res.transposeTo) : null;
        donePanel.dataset.kind = kind;
        donePanel.replaceChildren(...[
          h('p', { class: 'done-text', id: 'done-text' }, text),
          res.errors.length ? h('p', { class: 'hint' }, fmt(T.train.errorsList, {
            list: res.errors.map((e) => `${moveLabel(e.ply, e.played)} → ${e.expected}`).join(', '),
          })) : null,
          toLine ? h('p', { class: 'hint transpose-note' }, fmt(T.train.transposeNote, { n: toLine.n }), ' · ',
            h('a', { href: `${hrefFor('train', courseId, toLine.id)}?mode=learn`, id: 'transpose-go' }, fmt(T.train.transposeGo, { n: toLine.n }))) : null,
          h('p', { class: 'hint line-end' }, T.train.end[line.end] || '', line.cp !== null ? ` (${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(2)})` : ''),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn', id: 'again-btn', onclick: () => startAttempt(true) }, T.train.again),
            next
              ? h('a', { class: 'btn secondary', id: 'next-line-btn', href: `${hrefFor('train', courseId, next.id)}?mode=learn` }, `${T.train.nextLine} (${next.n})`)
              : h('a', { class: 'btn secondary', id: 'next-line-btn', href: hrefFor('course', courseId) }, T.train.toCourse),
          ),
          next ? null : h('p', { class: 'hint' }, T.train.allLearned),
        ].filter(Boolean));
        donePanel.hidden = false;
      }

      function startAttempt(again) {
        clearTimers();
        hintTimer = null;
        if (again) session.restart();
        recorded = false;
        donePanel.hidden = true;
        restartBtn.disabled = false;
        board.clearArrows();
        board.clearMarks();
        const f = session.frame(0);
        board.setPosition(f.fen, null, false).catch(() => {});
        drawStreak();
        drawMoves();
        step();
      }

      // За e2e и отстраняване на проблеми.
      ctx.train = { session, line, courseId };
      startAttempt(false);
    }, () => alive);

    return () => {
      alive = false;
      clearTimers();
      try { abandon?.(); } catch (e) { console.error(e); }
      board?.destroy();
      if (ctx.train) ctx.train = null;
    };
  },
};
