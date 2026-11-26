// #/train/<courseId>/<lineId>?mode=learn|review — тренировка на линия (ARCH_T-014 §5.4, D-015, T-021, T-020).
// mode=review: един опит с автоматична оценка Again/Hard/Good (src/srs/review.js); след Again —
// повторение до relearnStreak чисти пробега; после „Следваща за преговор“. Линия, която не е
// за преговор днес, се отваря като упражнение (learn) с бележка.
// Логиката е в src/train/session.js (без DOM); тук са само дъската, текстовете и записът в IndexedDB.
import { T, fmt } from '../../i18n/bg.js';
import { hrefFor } from '../../router.js';
import { Position } from '../../chess/position.js';
import { createSession, PHASE, lineFrames, mergeCarry, colorAt } from '../../train/session.js';
import { nextAfter } from '../../data/progress.js';
import { lineInfo } from '../../data/dataUpdate.js';
import { isDueToday, inRelearn } from '../../srs/review.js';
import { loadToday, whenText } from '../../data/today.js';
import { h, screenHeader, asyncBlock } from '../dom.js';
import { createBoard, orientationFor } from '../board.js';
import { material, CAPTURE_TYPES } from '../../chess/material.js';
import { evalAt, formatEval, evalLeader } from '../../chess/notation.js';
import { sanNodes } from '../notation.js';

export { lineFrames };

async function load(ctx, courseId, lineId, viewOnly = false) {
  const { view } = await ctx.data();
  const meta = view.byId.get(courseId);
  if (!meta || !meta.available) return {};
  const course = await ctx.store.loadCourse(courseId);
  const line = course.byId.get(lineId) || null;
  let row = null;
  let rowsById = new Map();
  let settled = false;
  if (line && ctx.userDb && viewOnly) {
    // T-028: прегледът не отваря линията (няма touchLine/firstSeen) — само чете прогреса за отметките.
    try {
      rowsById = new Map((await ctx.userDb.progressByCourse(courseId)).map((r) => [r.lineId, r]));
      row = rowsById.get(lineId) || null;
    } catch (e) { console.error(e); }
  } else if (line && ctx.userDb) {
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

/**
 * T-026 (D-031), T-028 (D-033): бутон-иконка (лентата под дъската и подсказката). Иконката е SVG от vendor/tabler/ като CSS маска
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
    const wantMode = route.params.get('mode');
    const wantReview = wantMode === 'review';
    // T-028 (D-037): преглед на линия от Курс — само разглеждане (Назад/Напред), без опит и без запис.
    const viewOnly = wantMode === 'view';
    const back = h('a', { class: 'back', href: wantReview ? hrefFor('review') : hrefFor('course', courseId) }, wantReview ? T.train.backReview : T.course.back);
    root.append(back);

    const later = (ms, fn) => {
      const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms);
      timers.add(t);
      return t;
    };
    const clearTimers = () => { for (const t of timers) clearTimeout(t); timers.clear(); };

    asyncBlock(root, () => load(ctx, courseId, lineId, viewOnly), (box, { meta, course, line, row: row0, rowsById, settled }) => {
      if (!line) { box.append(screenHeader(T.titles.train), h('p', { class: 'error' }, T.train.notFound)); return; }
      const S = ctx.settings;
      const need = S.get('learnStreak');
      const dsh = S.get('dayStartHour');
      let row = row0;
      const review = !viewOnly && wantReview && isDueToday(row, ctx.now(), dsh);
      const mode = review ? 'review' : 'learn';
      let reviewOut = null; // резултатът от последния запис в режим review
      let queueLeft = null; // колко остават в опашката (без текущата)
      // T013-D1: грешките/подсказките от прекъснат опит в преговор се добавят към този опит.
      let carry = review && row?.pending?.mode === 'review' ? row.pending : null;
      if (!review) back.textContent = fmt(T.train.back, { course: meta.name.bg });
      const title = review
        ? fmt(T.train.reviewHeader, { course: meta.name.bg, n: line.n })
        : (viewOnly
          ? fmt(T.train.viewHeader, { course: meta.name.bg, n: line.n })
          : fmt(T.train.header, { course: meta.name.bg, n: line.n, total: course.lines.length }));
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
      // D-034: серия като отметки ✓ (N слота); индикатор за страната на ход вместо изречение.
      const streakEl = h('p', { class: 'streak', id: 'streak' });
      const turnEl = h('span', { class: 'turn-ind', id: 'turn', role: 'img', dataset: { turn: '' } });
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
      // D-035: оценка от Stockfish (поле ev на линията) — вдясно до дъската; без ev или при „не“ — няма колона.
      const showEval = S.get('showEval') && Array.isArray(line.ev);
      const evalEl = showEval ? h('div', { class: 'eval', id: 'eval', role: 'img', dataset: { ev: '' } }, h('span', { class: 'eval-n' })) : null;
      const msg = h('p', { class: 'train-msg', id: 'train-msg', role: 'status', 'aria-live': 'polite' });
      const moves = h('ol', { class: 'move-list played', id: 'played' });
      const donePanel = h('section', { class: 'train-done', id: 'train-done', hidden: true });
      // D-033: подсказка — крушка, встрани от лентата; „Отначало“ и „Пак“ са една иконка (винаги активна).
      const hintBtn = iconButton('hint-btn', 'hint', T.train.hint, T.train.ariaHint);
      const stepBackBtn = iconButton('step-back-btn', 'back', T.train.icoBack, T.train.ariaBack);
      const stepFwdBtn = iconButton('step-fwd-btn', 'fwd', T.train.icoFwd, T.train.ariaFwd);
      const againBtn = viewOnly
        ? iconButton('again-btn', 'learn', T.train.icoLearn, T.train.ariaLearn)
        : iconButton('again-btn', 'again', T.train.icoAgain, T.train.ariaAgain);
      const nextBtn = iconButton(review ? 'next-review-btn' : 'next-line-btn', 'nextline', T.train.icoNext, T.train.nextLine);
      const labels = S.get('iconLabels') ? '' : ' no-labels';
      const iconBar = h('div', { class: `icon-bar${labels}`, id: 'icon-bar', role: 'toolbar', 'aria-label': T.train.bar },
        stepBackBtn, stepFwdBtn, h('span', { class: 'icon-sep', 'aria-hidden': 'true' }), againBtn, nextBtn);
      const ctrlRow = h('div', { class: `ctrl-row${labels}`, id: 'ctrl-row' }, hintBtn, iconBar);

      box.append(...[
        screenHeader(title),
        wantReview && !review ? h('p', { class: 'notice', id: 'practice-note' }, T.train.practice) : null,
        settled || carry ? h('p', { class: 'notice', id: 'resumed-note' }, carry ? T.train.resumedReview : T.train.resumedLearn) : null,
        h('p', { class: 'hint course-sub' }, line.name ? `${line.eco || ''} ${line.name}` : (line.eco || meta.name.en)),
        h('div', { class: 'train-top' }, turnEl, streakEl, capTop),
        h('div', { class: `board-row${showEval ? ' has-eval' : ''}` }, holder, evalEl),
        h('div', { class: 'train-under' }, capBottom || h('span', { class: 'cap-none' }), msg, donePanel),
        ctrlRow,
        moves,
        line.tail !== null ? h('p', { class: 'hint tail-note' }, T.train.tailNote) : null,
      ].filter(Boolean));

      let shownChecks = 0; // колко отметки се виждат (за анимацията при изчистване)
      /** N слота; запълнените — чисти пробези; изчистените при грешка — с кратка анимация (клас cleared). */
      function drawChecks(total, filled) {
        const out = [];
        for (let i = 0; i < total; i++) {
          const cls = i < filled ? ' on' : (i < shownChecks ? ' cleared' : '');
          out.push(h('span', { class: `chk${cls}`, 'aria-hidden': 'true' }));
        }
        shownChecks = filled;
        return h('span', { class: 'checks' }, out);
      }

      function drawStreak(dirty = false, celebrate = false) {
        if (review) {
          const k = inRelearn(row, ctx.now(), dsh) ? row.relearnLeft : 0;
          const R = S.get('relearnStreak');
          if (k > 0) {
            streakEl.replaceChildren(h('span', { class: 'review-state' }, T.train.relearnLeft), drawChecks(R, dirty ? 0 : Math.max(0, R - k)));
            streakEl.setAttribute('aria-label', fmt(T.train.relearnLabel, { k }));
          } else {
            streakEl.replaceChildren(h('span', { class: 'review-state' }, queueLeft !== null ? fmt(T.train.reviewLeft, { left: queueLeft + 1 }) : T.train.reviewOne));
            streakEl.removeAttribute('aria-label');
          }
          streakEl.dataset.mode = 'review';
          streakEl.dataset.relearn = String(k);
          streakEl.dataset.status = row?.status || 'new';
          return;
        }
        const cur = dirty ? 0 : (row?.streak || 0);
        const learned = row?.status === 'learned';
        streakEl.replaceChildren(drawChecks(need, Math.min(cur, need)));
        streakEl.setAttribute('role', 'img');
        streakEl.setAttribute('aria-label', fmt(T.train.streakLabel, { streak: cur, need }) + (learned ? ` · ${T.train.learnedBadge}` : ''));
        streakEl.classList.toggle('learned', learned);
        if (celebrate) {
          streakEl.classList.remove('celebrate');
          void streakEl.offsetWidth; // рестарт на анимацията
          streakEl.classList.add('celebrate');
        }
        streakEl.dataset.streak = String(cur);
        streakEl.dataset.status = row?.status || 'new';
      }

      /** D-034: кратко съобщение (до 2 думи); видът е в data-kind (цвят и тестове). */
      function say(text, kind = '') {
        msg.textContent = text;
        msg.dataset.kind = kind;
      }

      /** Индикатор: кой е на ход (кръгче в цвета на страната); „твой ход“ — с акцентен пръстен. */
      function setTurn(state) {
        turnEl.dataset.turn = state;
        const color = colorAt(session.ply);
        turnEl.dataset.color = state === 'user' ? meta.side : (state === 'opponent' ? (meta.side === 'w' ? 'b' : 'w') : color);
        const label = state === 'user' ? T.train.yourMove : (state === 'opponent' ? T.train.opponent : (state === 'done' ? T.train.turnDone : ''));
        if (label) { turnEl.setAttribute('aria-label', label); turnEl.title = label; } else { turnEl.removeAttribute('aria-label'); turnEl.removeAttribute('title'); }
      }

      function drawEval(ply) {
        if (!evalEl) return;
        const v = evalAt(line.ev, ply);
        const text = formatEval(v);
        evalEl.firstChild.textContent = text;
        evalEl.dataset.ev = v === null ? '' : String(v);
        evalEl.dataset.lead = evalLeader(v);
        if (text) evalEl.setAttribute('aria-label', fmt(T.train.evalLabel, { v: text }));
        else evalEl.removeAttribute('aria-label');
      }

      // --- D-037: разглеждане на изиграната линия (край на линията и преглед от Курс) ---
      let browse = false;
      let viewPly = 0;
      const errorsNow = () => (viewOnly ? [] : session.result().errors);

      function drawMoves() {
        const n = browse ? line.sans.length : session.ply;
        const bad = new Map();
        for (const e of errorsNow()) bad.set(e.ply, [...(bad.get(e.ply) || []), e.played]);
        moves.replaceChildren(...line.sans.slice(0, n).map((san, i) => {
          const tail = session.fromEngine(i);
          const attrs = {
            class: `mv${i < course.startPly ? ' mv-start' : ''}${tail ? ' mv-tail' : ''}${bad.has(i) ? ' mv-bad' : ''}`,
            title: bad.has(i) ? fmt(T.train.moveBad, { played: bad.get(i).join(', ') }) : (tail ? T.train.tailTitle : null),
            dataset: { ply: i + 1 },
            'aria-current': browse && viewPly === i + 1 ? 'true' : null,
          };
          const body = [i % 2 === 0 ? `${i / 2 + 1}.` : '', ...sanNodes(san, colorAt(i))];
          return h('li', {}, browse
            ? h('button', { type: 'button', ...attrs, onclick: () => showView(i + 1) }, ...body)
            : h('span', attrs, ...body));
        }));
      }

      function updateNav() {
        stepBackBtn.set(browse && viewPly > 0 ? () => showView(viewPly - 1) : null);
        stepFwdBtn.set(browse && viewPly < line.sans.length ? () => showView(viewPly + 1) : null);
      }

      /** Позиция след p полухода; на мястото на грешката — червено поле (изиграният ход) и стрелка с верния. */
      function showView(p) {
        if (!browse) return;
        viewPly = Math.max(0, Math.min(p, line.sans.length));
        const f = session.frame(viewPly);
        board.clearArrows();
        board.clearMarks();
        setPos(f.fen, f.last, false);
        const errs = errorsNow().filter((e) => e.ply === viewPly);
        if (errs.length) {
          for (const e of errs) {
            const mv = new Position(f.fen).findSan(e.played);
            if (mv) board.mark(mv.to, 'bad');
          }
          const exp = session.frame(viewPly + 1).last;
          board.arrow(exp.from, exp.to);
        }
        drawEval(viewPly);
        drawMoves();
        updateNav();
      }

      // --- дъска ---
      try {
        board = createBoard(holder, {
          fen: session.frame(0).fen,
          orientation: bottomSide,
          animationMs: S.get('animationMs'),
        });
      } catch (err) {
        console.error(err);
        holder.replaceWith(h('p', { class: 'error' }, T.train.boardError));
        return;
      }

      /** Позиция на дъската + взетите фигури (D-032: изчислени от самата позиция) + оценката (D-035). */
      function setPos(fen, last, animate, ply = null) {
        board.setPosition(fen, last, animate).catch(() => {});
        drawCaptured(fen);
        if (ply !== null) drawEval(ply);
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
        hintBtn.set(() => doHint(false));
        setTurn('user');
        const sec = S.get('hintAfterSec');
        if (sec > 0) hintTimer = later(sec * 1000, () => doHint(true));
      }
      function disableInput() {
        if (hintTimer) { clearTimeout(hintTimer); timers.delete(hintTimer); hintTimer = null; }
        board.disableInput();
        inputOn = false;
        hintBtn.set(null);
      }

      function step() {
        if (!alive) return;
        const ph = session.phase();
        if (ph === PHASE.AUTO) {
          // Стартовите ходове на курса — веднага, без пауза.
          while (session.phase() === PHASE.AUTO) session.playAuto();
          const f = session.frame();
          setPos(f.fen, f.last, false, session.ply);
          drawMoves();
          step();
          return;
        }
        if (ph === PHASE.OPPONENT) {
          disableInput();
          setTurn('opponent');
          if (msg.dataset.kind !== 'ok') say('', 'wait');
          later(S.get('opponentDelayMs'), () => {
            const ev = session.playAuto();
            board.clearMarks('ok');
            setPos(ev.fen, ev, true, session.ply);
            drawMoves();
            say('', 'wait');
            step();
          });
          return;
        }
        if (ph === PHASE.USER) {
          if (msg.dataset.kind !== 'ok') say('', 'turn');
          else msg.dataset.kind = 'turn';
          enableInput();
          return;
        }
        if (ph === PHASE.CORRECT) {
          say(T.train.wrong, 'correct');
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
          setPos(res.fen, res, false, session.ply);
          board.clearMarks('ok');
          board.mark(res.to, 'ok');
          say(T.train.good, 'ok');
          drawMoves();
          step();
          return;
        }
        // Грешка: червен маркер, връщане, стрелка с верния ход, отметките се изчистват.
        drawStreak(true);
        persistDirty();
        board.mark(m.to, 'bad');
        say(T.train.wrong, 'bad');
        later(S.get('wrongMoveMs'), () => {
          board.clearMarks('bad');
          setPos(before.fen, before.last, false);
          board.arrow(res.expected.from, res.expected.to);
          board.mark(res.expected.from, 'hint');
          if (res.restart) {
            say(T.train.restarting, 'bad');
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
        say(T.train.hintText, auto ? 'hint auto' : 'hint');
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

      /** Прекъснат опит с грешка/подсказка се записва като неуспешен — иначе „Пак“ би заобиколил нулирането. */
      function abandonAttempt() {
        if (!recorded && (session.dirty() || carry) && session.phase() !== PHASE.DONE) return record();
        return Promise.resolve(null);
      }
      abandon = viewOnly ? null : abandonAttempt;

      /**
       * D-033: „Пак“ — винаги активна. По време на опита: нечист опит (грешка/подсказка) се записва като неуспешен,
       * чист — просто рестарт без наказание. В края: нов опит (в преговор без повторение — упражнение без оценка).
       */
      async function again() {
        if (session.phase() === PHASE.DONE && recorded && review && !(reviewOut?.relearnLeft > 0)) {
          go(`${hrefFor('train', courseId, lineId)}?mode=review&again=1`);
          return;
        }
        await abandonAttempt();
        if (alive) startAttempt(true);
      }

      /** Кратък резултат в края (D-034): иконка или до 2 думи; подробностите — в aria-label/title. */
      function doneChip(kind, text, { icon = false, label = null } = {}) {
        return h('span', { class: `done-chip`, id: 'done-text', dataset: { kind }, title: label, 'aria-label': label },
          icon ? h('span', { class: 'ico ico-check', 'aria-hidden': 'true' }) : null, text);
      }

      function enterBrowse() {
        browse = true;
        viewPly = line.sans.length;
        drawMoves();
        updateNav();
      }

      async function finish() {
        disableInput();
        setTurn('done');
        const res = session.result();
        const out = await record();
        if (!alive) return;
        if (review) { await finishReview(res, out); return; }
        const st = out?.row || row;
        let chip;
        let kind;
        if (out?.becameLearned) { kind = 'learned'; chip = doneChip(kind, T.train.doneLearned, { icon: true }); }
        else if (res.clean) { kind = 'clean'; chip = doneChip(kind, '', { icon: true, label: T.train.doneClean }); }
        else if (res.errors.length) { kind = 'errors'; chip = doneChip(kind, fmt(T.train.doneErrors, { n: res.errors.length })); }
        else { kind = 'errors'; chip = doneChip(kind, T.train.hint); } // нечист само заради подсказка
        drawStreak(false, kind === 'learned');
        say('', '');
        const next = nextAfter(course.lines, rowsById, lineId);
        const toLine = res.transposeTo ? course.byId.get(res.transposeTo) : null;
        donePanel.dataset.kind = kind;
        donePanel.dataset.status = st?.status || '';
        donePanel.replaceChildren(...[
          chip,
          toLine ? h('a', {
            class: 'done-link transpose-note', id: 'transpose-go', href: `${hrefFor('train', courseId, toLine.id)}?mode=learn`,
            'aria-label': fmt(T.train.transposeAria, { n: toLine.n }), title: fmt(T.train.transposeAria, { n: toLine.n }),
          }, fmt(T.train.transposeGo, { n: toLine.n })) : null,
        ].filter(Boolean));
        if (next) nextBtn.set(() => go(`${hrefFor('train', courseId, next.id)}?mode=learn`), `${T.train.nextLine} (${next.n})`);
        else nextBtn.set(() => go(hrefFor('course', courseId)), T.train.toCourse);
        enterBrowse();
        showDone();
      }

      /** D4: в края редът с иконките се превърта до видимото (над долната лента). */
      function showDone() {
        donePanel.hidden = false;
        try { ctrlRow.scrollIntoView({ block: 'nearest' }); } catch { /* стар браузър */ }
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
        const short = when.replace(/\s*\(.*\)$/, '');
        let chip;
        let kind;
        if (!rv) { kind = 'errors'; chip = doneChip(kind, T.train.saveError); }
        else if (rv.grade) {
          kind = rv.gradeName;
          const why = T.train.gradeWhy[rv.gradeName] || '';
          chip = rv.gradeName === 'again'
            ? doneChip(kind, T.train.gradeAgain, { label: `${T.grade.again} · ${why}` })
            : doneChip(kind, fmt(T.train.gradeDone, { grade: T.grade[rv.gradeName], when: short }), { label: `${fmt(T.train.gradeDone, { grade: T.grade[rv.gradeName], when })} · ${why}` });
        } else if (k > 0) { kind = 'again'; chip = doneChip(kind, T.train.relearnMore); }
        else { kind = 'good'; chip = doneChip(kind, fmt(T.train.relearnDone, { when: short }), { label: fmt(T.train.relearnDone, { when }) }); }
        say('', '');
        donePanel.dataset.kind = kind;
        donePanel.dataset.grade = rv?.gradeName || (rv?.relearn ? 'relearn' : '');
        donePanel.dataset.allDone = !next && k === 0 ? '1' : '';
        donePanel.replaceChildren(chip);
        if (next) nextBtn.set(() => go(`${hrefFor('train', next.courseId, next.lineId)}?mode=review`), fmt(T.train.nextReview, { left }));
        else nextBtn.set(() => go(hrefFor('review')), T.train.reviewDone);
        enterBrowse();
        showDone();
      }

      function startAttempt(isAgain) {
        clearTimers();
        hintTimer = null;
        if (isAgain) session.restart();
        recorded = false;
        browse = false;
        donePanel.hidden = true;
        nextBtn.set(null, T.train.nextLine);
        board.clearArrows();
        board.clearMarks();
        const f = session.frame(0);
        setPos(f.fen, null, false, 0);
        say('', '');
        drawStreak();
        drawMoves();
        updateNav();
        step();
      }

      // За e2e и отстраняване на проблеми.
      ctx.train = { session, line, courseId, mode: viewOnly ? 'view' : mode };
      if (viewOnly) {
        // Преглед: всички ходове, Назад/Напред и тап върху ход; „Учи“ отваря тренировката.
        drawStreak();
        setTurn('view');
        hintBtn.set(null);
        againBtn.set(() => go(`${hrefFor('train', courseId, lineId)}?mode=learn`));
        nextBtn.set(null);
        browse = true;
        showView(0);
        return;
      }
      againBtn.set(() => again());
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
