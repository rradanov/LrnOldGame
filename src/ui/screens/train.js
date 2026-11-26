// #/train/<courseId>/<lineId>?mode=learn|review — тренировка на линия (ARCH_T-014 §5.4, D-015, T-021, T-020).
// mode=review: един опит с автоматична оценка Again/Hard/Good (src/srs/review.js); след Again —
// повторение до relearnStreak чисти пробега; после „Следваща за преговор“. Линия, която не е
// за преговор днес, се отваря като упражнение (learn) с бележка.
// Логиката е в src/train/session.js (без DOM); тук са само дъската, текстовете и записът в IndexedDB.
import { T, fmt, decimal } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { Position } from '../../chess/position.js';
import { createSession, PHASE, lineFrames, mergeCarry } from '../../train/session.js';
import { nextAfter } from '../../data/progress.js';
import { lineInfo } from '../../data/dataUpdate.js';
import { isDueToday, inRelearn } from '../../srs/review.js';
import { loadToday, whenText } from '../../data/today.js';
import { h, screenHeader, asyncBlock } from '../dom.js';
import { createBoard, orientationFor } from '../board.js';
import { material, CAPTURE_TYPES } from '../../chess/material.js';

export { lineFrames };

async function load(ctx, courseId, lineId) {
  const { view } = await ctx.data();
  const meta = view.byId.get(courseId);
  if (!meta || !meta.available) return {};
  const course = await ctx.store.loadCourse(courseId);
  const line = course.byId.get(lineId) || null;
  let row = null;
  let rowsById = new Map();
  let settled = false;
  if (line && ctx.userDb) {
    try {
      row = await ctx.userDb.touchLine(courseId, lineId, line.n, lineInfo(line));
      // T013-D1: прекъснат (презареждане, убито приложение) нечист опит в режим learn се приключва като
      // неуспешен (броячът вече е 0 от markDirty; тук остава и записът в журнала). Режим review — в render.
      if (row?.pending?.mode === 'learn') {
        const p = row.pending;
        const out = await ctx.userDb.recordAttempt({
          courseId, lineId, n: line.n, mode: 'learn', learnStreak: ctx.settings.get('learnStreak'),
          dayStartHour: ctx.settings.get('dayStartHour'), srs: ctx.srs(),
          result: abandonedResult(p, line.sans.length),
        });
        row = out.row;
        settled = true;
      }
      rowsById = new Map((await ctx.userDb.progressByCourse(courseId)).map((r) => [r.lineId, r]));
    } catch (e) { console.error(e); }
  }
  return { meta, course, line, row, rowsById, settled };
}

/** Резултат на прекъснат опит от маркера pending (T013-D1). */
const abandonedResult = (p, total) => ({
  done: false, clean: false, errors: (p.errors || []).map((e) => ({ ...e })), hints: p.hints || 0,
  plies: 0, total, userMoves: 0, ms: 0, maxMoveMs: 0, transposeTo: null, attempt: 1, abandoned: true,
});

const moveLabel = (i, san) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san);

/**
 * T-026 (D-031): бутон-иконка от лентата под дъската. Иконката е SVG от vendor/tabler/ като CSS маска
 * (цвят = currentColor, работи и в тъмна тема; без inline SVG/скриптове заради CSP).
 * Неактивното действие е бледо с aria-disabled="true" (остава на мястото си и във фокуса).
 */
function iconButton(id, ico, caption, aria) {
  const btn = h('button', { type: 'button', class: 'icon-btn', id, 'aria-label': aria, title: aria, 'aria-disabled': 'true' },
    h('span', { class: `ico ico-${ico}`, 'aria-hidden': 'true' }),
    h('span', { class: 'ico-cap', 'aria-hidden': 'true' }, caption));
  let action = null;
  btn.addEventListener('click', () => { if (action) action(); });
  /** set(fn, aria) — активира с действие fn; set(null) — неактивно. */
  btn.set = (fn, label = aria) => {
    action = fn || null;
    btn.setAttribute('aria-disabled', fn ? 'false' : 'true');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  return btn;
}
const go = (href) => { location.hash = href.slice(1); };

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Малка фигура от спрайта на cm-chessboard (символът е в документа — assetsCache на дъската). */
function pieceIcon(color, type) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'cap-piece');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${color}${type}`);
  svg.append(use);
  return svg;
}

/**
 * D-032: ред „взети фигури“ на страната `side` (фигурите, които тя е взела, от другия цвят), групирани по вид,
 * и „+N“, ако тази страна е с повече материал.
 */
function drawCapturedRow(el, side, m) {
  const got = m.captured[side];
  const other = side === 'w' ? 'b' : 'w';
  const parts = [];
  const said = [];
  for (const t of CAPTURE_TYPES) {
    if (!got[t]) continue;
    parts.push(h('span', { class: 'cap-group', dataset: { type: t } }, Array.from({ length: got[t] }, () => pieceIcon(other, t))));
    said.push(`${T.train.pieceNames[t]} ×${got[t]}`);
  }
  const lead = m.leader === side && m.plus > 0;
  if (lead) parts.push(h('span', { class: 'cap-diff' }, `+${m.plus}`));
  el.replaceChildren(...parts);
  el.dataset.captured = CAPTURE_TYPES.map((t) => (got[t] ? `${t}${got[t]}` : '')).join('');
  el.dataset.diff = lead ? String(m.plus) : '';
  el.setAttribute('aria-label', fmt(side === 'w' ? T.train.capturedW : T.train.capturedB, {
    list: said.length ? said.join(', ') : T.train.capturedNone,
  }) + (lead ? ` · +${m.plus}` : ''));
}

export default {
  render(root, ctx, route) {
    let alive = true;
    let board = null;
    const timers = new Set();
    let abandon = null;
    const [courseId = '', lineId = ''] = route.parts;
    const wantReview = route.params.get('mode') === 'review';
    const back = h('a', { class: 'back', href: wantReview ? hrefFor('review') : hrefFor('course', courseId) }, wantReview ? T.train.backReview : T.course.back);
    root.append(back);

    const later = (ms, fn) => {
      const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const clearTimers = () => { for (const t of timers) clearTimeout(t); timers.clear(); };

    asyncBlock(root, () => load(ctx, courseId, lineId), (box, { meta, course, line, row: row0, rowsById, settled }) => {
      if (!line) { box.append(screenHeader(T.titles.train), h('p', { class: 'error' }, T.train.notFound)); return; }
      const S = ctx.settings;
      const need = S.get('learnStreak');
      const dsh = S.get('dayStartHour');
      let row = row0;
      const review = wantReview && isDueToday(row, ctx.now(), dsh);
      const mode = review ? 'review' : 'learn';
      let reviewOut = null; // резултатът от последния запис в режим review
      let queueLeft = null; // колко остават в опашката (без текущата)
      // T013-D1: грешките/подсказките от прекъснат опит в преговор се добавят към този опит.
      let carry = review && row?.pending?.mode === 'review' ? row.pending : null;
      if (!review) back.textContent = fmt(T.train.back, { course: meta.name.bg });
      const title = review
        ? fmt(T.train.reviewHeader, { course: meta.name.bg, n: line.n })
        : fmt(T.train.header, { course: meta.name.bg, n: line.n, total: course.lines.length });
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
      // D-032: взетите фигури — над дъската за горната страна (в реда на брояча), под дъската за долната.
      const showCap = S.get('showCaptured');
      const bottomSide = orientationFor(S.get('boardOrientation'), meta.side);
      const topSide = bottomSide === 'w' ? 'b' : 'w';
      const capTop = showCap ? h('div', { class: 'captured cap-top', id: 'captured-top', role: 'img', dataset: { side: topSide } }) : null;
      const capBottom = showCap ? h('div', { class: 'captured cap-bottom', id: 'captured-bottom', role: 'img', dataset: { side: bottomSide } }) : null;
      const values = { p: S.get('valuePawn'), n: S.get('valueKnight'), b: S.get('valueBishop'), r: S.get('valueRook'), q: S.get('valueQueen') };
      function drawCaptured(fen) {
        if (!showCap) return;
        const m = material(fen, values);
        drawCapturedRow(capTop, topSide, m);
        drawCapturedRow(capBottom, bottomSide, m);
      }
      const holder = h('div', { class: 'board-wrap', 'aria-label': T.train.boardLabel });
      const msg = h('p', { class: 'train-msg', id: 'train-msg', role: 'status', 'aria-live': 'polite' });
      const hintBtn = h('button', { type: 'button', class: 'btn secondary', id: 'hint-btn', onclick: () => doHint(false) }, T.train.hint);
      const restartBtn = h('button', { type: 'button', class: 'btn secondary', id: 'restart-btn', onclick: async () => { await abandonAttempt(); startAttempt(true); } }, T.train.restart);
      const moves = h('ol', { class: 'move-list played', id: 'played' });
      const donePanel = h('section', { class: 'train-done', id: 'train-done', hidden: true });
      // T-026: лента „стрелки“ (D-031, вариант Б) — Назад/Напред (стъпки по ходовете; в тренировката няма такова действие →
      // винаги неактивни), разделител, Пак и Следваща (активни само в края на линията).
      const stepBackBtn = iconButton('step-back-btn', 'back', T.train.icoBack, T.train.ariaBack);
      const stepFwdBtn = iconButton('step-fwd-btn', 'fwd', T.train.icoFwd, T.train.ariaFwd);
      const againBtn = iconButton('again-btn', 'again', T.train.icoAgain, T.train.ariaAgain);
      const nextBtn = iconButton(review ? 'next-review-btn' : 'next-line-btn', 'nextline', T.train.icoNext, T.train.nextLine);
      const iconBar = h('div', {
        class: `icon-bar${S.get('iconLabels') ? '' : ' no-labels'}`, id: 'icon-bar', role: 'toolbar', 'aria-label': T.train.bar,
      }, stepBackBtn, stepFwdBtn, h('span', { class: 'icon-sep', 'aria-hidden': 'true' }), againBtn, nextBtn);

      box.append(...[
        screenHeader(title),
        wantReview && !review ? h('p', { class: 'notice', id: 'practice-note' }, T.train.practice) : null,
        settled || carry ? h('p', { class: 'notice', id: 'resumed-note' }, carry ? T.train.resumedReview : T.train.resumedLearn) : null,
        h('p', { class: 'hint course-sub' }, line.name ? `${line.eco || ''} ${line.name}` : (line.eco || meta.name.en)),
        h('div', { class: 'train-top' }, streakEl, capTop),
        holder,
        capBottom,
        msg,
        h('div', { class: 'btn-row train-actions' }, hintBtn, restartBtn),
        iconBar,
        donePanel,
        moves,
        line.tail !== null ? h('p', { class: 'hint tail-note' }, T.train.tailNote) : null,
      ].filter(Boolean));

      function drawStreak(dirty = false) {
        if (review) {
          const k = inRelearn(row, ctx.now(), dsh) ? row.relearnLeft : 0;
          streakEl.replaceChildren(h('span', { class: 'review-state' }, k > 0
            ? fmt(T.train.relearnLeft, { k })
            : (queueLeft !== null ? fmt(T.train.reviewLeft, { left: queueLeft + 1 }) : T.train.reviewOne)));
          streakEl.dataset.mode = 'review';
          streakEl.dataset.relearn = String(k);
          streakEl.dataset.status = row?.status || 'new';
          return;
        }
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

      /** Позиция на дъската + взетите фигури (D-032: изчислени от самата позиция). */
      function setPos(fen, last, animate) {
        board.setPosition(fen, last, animate).catch(() => {});
        drawCaptured(fen);
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
          setPos(f.fen, f.last, false);
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
            setPos(ev.fen, ev, true);
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
        if (m.canceled) { setPos(before.fen, before.last, false); return; }
        let san;
        try {
          san = new Position(before.fen).playMove(m).san;
        } catch {
          setPos(before.fen, before.last, false);
          return;
        }
        disableInput();
        const res = session.userMove(san);
        board.clearArrows();
        board.clearMarks('hint');
        if (res.ok) {
          setPos(res.fen, res, false);
          board.clearMarks('ok');
          board.mark(res.to, 'ok');
          say(T.train.good, 'ok');
          drawMoves();
          step();
          return;
        }
        // Грешка: червен маркер, връщане, стрелка с верния ход, брояч → 0.
        drawStreak(true);
        persistDirty();
        board.mark(m.to, 'bad');
        say(fmt(res.restart ? T.train.restarting : T.train.wrong, { san: res.expected.san }), 'bad');
        later(S.get('wrongMoveMs'), () => {
          board.clearMarks('bad');
          setPos(before.fen, before.last, false);
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
        persistDirty();
      }

      /**
       * T013-D1: нечистият опит се записва веднага (learn: брояч 0; review: грешки и подсказки),
       * за да не се загуби при презареждане или убиване на приложението.
       */
      function persistDirty() {
        if (recorded || !ctx.userDb) return;
        const r = mergeCarry(session.result(), carry);
        if (mode === 'learn' ? !session.dirty() : !(r.errors.length || r.hints)) return;
        ctx.userDb.markDirty({ courseId, lineId, mode, errors: r.errors, hints: r.hints })
          .catch((e) => console.error('Нечистият опит не се записа:', e));
      }

      async function record() {
        if (recorded || !ctx.userDb) return null;
        recorded = true;
        try {
          const out = await ctx.userDb.recordAttempt({
            courseId, lineId, n: line.n, result: mergeCarry(session.result(), carry),
            learnStreak: need, dayStartHour: dsh, mode, srs: ctx.srs(),
          });
          row = out.row;
          carry = null;
          if (out.review) reviewOut = out.review;
          ctx.refreshBadge?.();
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
        if (!recorded && (session.dirty() || carry) && session.phase() !== PHASE.DONE) return record();
        return Promise.resolve(null);
      }
      abandon = abandonAttempt;

      async function finish() {
        disableInput();
        restartBtn.disabled = true;
        const res = session.result();
        const out = await record();
        if (!alive) return;
        if (review) { await finishReview(res, out); return; }
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
          h('p', { class: 'hint line-end' }, T.train.end[line.end] || '', line.cp !== null ? ` (${line.cp > 0 ? '+' : ''}${decimal(line.cp / 100, 2)})` : ''),
          next ? null : h('p', { class: 'hint' }, T.train.allLearned),
        ].filter(Boolean));
        againBtn.set(() => startAttempt(true));
        if (next) nextBtn.set(() => go(`${hrefFor('train', courseId, next.id)}?mode=learn`), `${T.train.nextLine} (${next.n})`);
        else nextBtn.set(() => go(hrefFor('course', courseId)), T.train.toCourse);
        showDone();
      }

      /** D4: панелът в края на линията се показва и се превърта до видимото (над долната лента). */
      function showDone() {
        donePanel.hidden = false;
        try { donePanel.scrollIntoView({ block: 'nearest' }); } catch { /* стар браузър */ }
      }

      /** Следващата линия от опашката за днес (без текущата, освен ако е в повторение). */
      async function nextInQueue() {
        try {
          const t = await loadToday(ctx);
          const rest = t.items.filter((it) => !(it.courseId === courseId && it.lineId === lineId));
          return { next: rest[0] || null, left: rest.length };
        } catch (e) { console.error(e); return { next: null, left: 0 }; }
      }

      async function finishReview(res, out) {
        const rv = out?.review || reviewOut;
        const { next, left } = await nextInQueue();
        if (!alive) return;
        queueLeft = left;
        drawStreak();
        const k = rv ? rv.relearnLeft : 0;
        const when = whenText(row?.due, ctx.now(), dsh);
        let text;
        let kind;
        if (!rv) { text = T.train.saveError; kind = 'errors'; }
        else if (rv.grade) {
          kind = rv.gradeName;
          text = rv.gradeName === 'again'
            ? fmt(T.train.gradeAgain, { k })
            : fmt(T.train.gradeDone, { grade: T.grade[rv.gradeName], when });
        } else if (k > 0) { text = fmt(T.train.relearnMore, { k }); kind = 'again'; }
        else { text = fmt(T.train.relearnDone, { when }); kind = 'good'; }
        say('', '');
        donePanel.dataset.kind = kind;
        donePanel.dataset.grade = rv?.gradeName || (rv?.relearn ? 'relearn' : '');
        donePanel.replaceChildren(...[
          h('p', { class: 'done-text', id: 'done-text' }, text),
          rv?.grade ? h('p', { class: 'hint', id: 'grade-why' }, T.train.gradeWhy[rv.gradeName] || '') : null,
          res.errors.length ? h('p', { class: 'hint' }, fmt(T.train.errorsList, {
            list: res.errors.map((e) => `${moveLabel(e.ply, e.played)} → ${e.expected}`).join(', '),
          })) : null,
          !next && k === 0 ? h('p', { class: 'hint', id: 'review-all-done' }, T.review.allDone) : null,
        ].filter(Boolean));
        // „Пак“ в преговора — само докато тече повторение след „Отново“ (k > 0), както досега.
        againBtn.set(k > 0 ? () => startAttempt(true) : null);
        if (next) nextBtn.set(() => go(`${hrefFor('train', next.courseId, next.lineId)}?mode=review`), fmt(T.train.nextReview, { left }));
        else nextBtn.set(() => go(hrefFor('review')), T.train.reviewDone);
        showDone();
      }

      function startAttempt(again) {
        clearTimers();
        hintTimer = null;
        if (again) session.restart();
        recorded = false;
        donePanel.hidden = true;
        restartBtn.disabled = false;
        againBtn.set(null);
        nextBtn.set(null, T.train.nextLine);
        board.clearArrows();
        board.clearMarks();
        const f = session.frame(0);
        setPos(f.fen, null, false);
        drawStreak();
        drawMoves();
        step();
      }

      // За e2e и отстраняване на проблеми.
      ctx.train = { session, line, courseId, mode };
      startAttempt(false);
      if (review) nextInQueue().then(({ left }) => { if (!alive) return; queueLeft = left; if (donePanel.hidden) drawStreak(session.dirty()); });
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
