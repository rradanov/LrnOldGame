// T-021: тренировка на линия — машина на състоянията (src/train/session.js),
// прогрес (applyAttempt, dayKey, nextAfter) и запис в IndexedDB (recordAttempt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { createSession, PHASE, colorAt, lineFrames } from '../../src/train/session.js';
import { applyAttempt, dayKey, nextAfter, newLineRow, lineStatus, courseProgress } from '../../src/data/progress.js';
import { normalizeCourse } from '../../src/data/courseStore.js';
import { openUserDb } from '../../src/db/userdb.js';
import { Position } from '../../src/chess/position.js';

const ITALIAN = normalizeCourse(JSON.parse(readFileSync(new URL('../../data/courses/italian.json', import.meta.url), 'utf8')));
const CARO = normalizeCourse(JSON.parse(readFileSync(new URL('../../data/courses/caro-kann.json', import.meta.url), 'utf8')));

/** Играе линията докрай без грешка; връща списък на събитията. */
function playClean(s) {
  const log = [];
  for (;;) {
    const ph = s.phase();
    if (ph === PHASE.DONE) return log;
    if (ph === PHASE.OPPONENT || ph === PHASE.AUTO) log.push(['app', s.playAuto()]);
    else if (ph === PHASE.USER || ph === PHASE.CORRECT) log.push(['me', s.userMove(s.expected().san)]);
    else throw new Error(ph);
  }
}

const SHORT = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']; // бели: 3 мои хода, 2 на противника
const PROMO = ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6', 'bxa8=Q'];

test('бели: потребителят играе четните полуходове, приложението — нечетните; край → done, clean', () => {
  let t = 0;
  const s = createSession({ sans: SHORT, side: 'w', now: () => (t += 100) });
  assert.equal(s.phase(), PHASE.USER);
  assert.equal(s.expected().san, 'e4');
  const r1 = s.userMove('e4');
  assert.equal(r1.ok, true);
  assert.equal(r1.from, 'e2');
  assert.equal(r1.to, 'e4');
  assert.equal(s.phase(), PHASE.OPPONENT);
  assert.throws(() => s.userMove('d4'), /Не е ред на потребителя/);
  const o = s.playAuto();
  assert.equal(o.san, 'e5');
  assert.equal(o.auto, false);
  assert.equal(s.phase(), PHASE.USER);
  s.userMove('Nf3'); s.playAuto();
  const last = s.userMove('Bc4');
  assert.equal(last.done, true);
  assert.equal(s.phase(), PHASE.DONE);
  const res = s.result();
  assert.equal(res.done, true);
  assert.equal(res.clean, true);
  assert.deepEqual(res.errors, []);
  assert.equal(res.userMoves, 3);
  assert.equal(res.plies, 5);
  assert.ok(res.ms > 0);
});

test('черни: първият ход е на противника; side определя чии са ходовете', () => {
  const line = CARO.lines[0];
  const s = createSession({ sans: line.sans, side: 'b', startPly: CARO.startPly });
  assert.equal(s.phase(), PHASE.OPPONENT);
  assert.equal(s.playAuto().san, line.sans[0]);
  assert.equal(s.phase(), PHASE.USER);
  assert.equal(colorAt(1), 'b');
  const log = playClean(s);
  assert.ok(log.filter(([who]) => who === 'me').every(([, ev]) => colorAt(ev.ply) === 'b'));
  assert.equal(s.result().clean, true);
});

test('грешка (continue): нулира чистотата, показва верния ход, после верният ход продължава линията', () => {
  const s = createSession({ sans: SHORT, side: 'w' });
  const bad = s.userMove('d4');
  assert.equal(bad.ok, false);
  assert.equal(bad.restart, false);
  assert.deepEqual(bad.expected, { san: 'e4', from: 'e2', to: 'e4' });
  assert.equal(s.phase(), PHASE.CORRECT);
  assert.equal(s.ply, 0, 'грешният ход не се играе');
  assert.equal(s.dirty(), true);
  // втора грешка на същия ход също се брои
  assert.equal(s.userMove('c4').ok, false);
  const ok = s.userMove('e4');
  assert.equal(ok.ok, true);
  assert.equal(ok.corrected, true);
  assert.equal(s.phase(), PHASE.OPPONENT);
  playClean(s);
  const res = s.result();
  assert.equal(res.done, true);
  assert.equal(res.clean, false);
  assert.deepEqual(res.errors, [{ ply: 0, played: 'd4', expected: 'e4' }, { ply: 0, played: 'c4', expected: 'e4' }]);
});

test('грешка (restart): опитът свършва веднага като неуспешен; restart() започва нов опит', () => {
  const s = createSession({ sans: SHORT, side: 'w', onError: 'restart' });
  s.userMove('e4'); s.playAuto();
  const bad = s.userMove('Bc4');
  assert.equal(bad.ok, false);
  assert.equal(bad.restart, true);
  assert.equal(s.phase(), PHASE.FAILED);
  assert.throws(() => s.userMove('Nf3'));
  const res = s.result();
  assert.equal(res.done, false);
  assert.equal(res.clean, false);
  assert.equal(res.errors.length, 1);
  s.restart();
  assert.equal(s.attempt, 2);
  assert.equal(s.ply, 0);
  assert.equal(s.phase(), PHASE.USER);
  assert.equal(s.dirty(), false);
  playClean(s);
  assert.equal(s.result().clean, true);
});

test('подсказка: верният ход; при hintResetsStreak опитът не е чист, иначе е', () => {
  for (const reset of [true, false]) {
    const s = createSession({ sans: SHORT, side: 'w', hintResetsStreak: reset });
    assert.equal(s.hint().san, 'e4');
    s.hint(); // същият ход — брои се веднъж
    assert.equal(s.phase(), PHASE.USER);
    playClean(s);
    const res = s.result();
    assert.equal(res.hints, 1);
    assert.equal(res.clean, !reset);
  }
  const s = createSession({ sans: SHORT, side: 'w' });
  s.userMove('e4');
  assert.equal(s.hint(), null, 'не е ред на потребителя');
});

test('autoPlayStart: стартовите ходове (и двете страни) се играят от приложението', () => {
  const line = ITALIAN.lines[0];
  const s = createSession({ sans: line.sans, side: 'w', startPly: ITALIAN.startPly, autoPlayStart: true });
  assert.equal(ITALIAN.startPly, 2);
  assert.equal(s.phase(), PHASE.AUTO);
  assert.equal(s.playAuto().auto, true);
  assert.equal(s.phase(), PHASE.AUTO);
  s.playAuto();
  assert.equal(s.phase(), PHASE.USER);
  assert.equal(s.expected().san, line.sans[2]);
  playClean(s);
  const res = s.result();
  assert.equal(res.userMoves, Math.ceil(line.sans.length / 2) - 1, 'e4 не е ход на потребителя');
  // без autoPlayStart потребителят играе и 1.e4
  const s2 = createSession({ sans: line.sans, side: 'w', startPly: 2 });
  assert.equal(s2.phase(), PHASE.USER);
  assert.equal(s2.expected().san, 'e4');
});

test('промоция: SAN с =Q е верният ход; слаба промоция е грешка', () => {
  const s = createSession({ sans: PROMO, side: 'w' });
  while (s.ply < PROMO.length - 1) {
    if (s.phase() === PHASE.USER) s.userMove(s.expected().san); else s.playAuto();
  }
  const fen = s.frame().fen;
  const pos = new Position(fen);
  assert.equal(pos.isPromotion('b7', 'a8'), true);
  const under = new Position(fen).playMove({ from: 'b7', to: 'a8', promotion: 'n' }).san;
  assert.equal(under, 'bxa8=N');
  const bad = s.userMove(under);
  assert.equal(bad.ok, false);
  assert.equal(bad.expected.san, 'bxa8=Q');
  const good = s.userMove(new Position(fen).playMove({ from: 'b7', to: 'a8', promotion: 'q' }).san);
  assert.equal(good.ok, true);
  assert.equal(good.done, true);
  assert.ok(lineFrames(PROMO).at(-1).fen.startsWith('Q2qkbnr'));
});

test('опашка (tail, D-027): ходовете от двигателя се играят като обикновени, само се маркират', () => {
  const line = ITALIAN.lines.find((l) => l.tail !== null);
  assert.ok(line, 'в Италианската има линия с опашка');
  const s = createSession({ sans: line.sans, side: 'w', tail: line.tail });
  const log = playClean(s);
  assert.equal(log.length, line.sans.length);
  for (const [, ev] of log) assert.equal(ev.fromEngine, ev.ply >= line.tail);
  assert.ok(log.some(([who, ev]) => who === 'me' && ev.fromEngine), 'и мой ход от опашката');
  assert.equal(s.result().clean, true);
});

test('транспозиция: линията свършва в края си, резултатът носи transposeTo', () => {
  const line = ITALIAN.lines.find((l) => l.end === 'transpose');
  assert.ok(line && line.to && ITALIAN.byId.has(line.to));
  const s = createSession({ sans: line.sans, side: 'w', transposeTo: line.to });
  playClean(s);
  const res = s.result();
  assert.equal(res.done, true);
  assert.equal(res.transposeTo, line.to);
  // Позицията в края на линията е и в линията, която продължава (транспозиция).
  const endKey = new Position(s.frame().fen).key();
  const toFrames = lineFrames(ITALIAN.byId.get(line.to).sans);
  assert.ok(toFrames.some((f) => new Position(f.fen).key() === endKey));
});

test('всички линии на два курса се изиграват чисто от машината', () => {
  for (const c of [ITALIAN, CARO]) {
    for (const l of c.lines) {
      const s = createSession({ sans: l.sans, side: c.side, startPly: c.startPly, tail: l.tail });
      playClean(s);
      assert.equal(s.result().clean, true, `${c.id} ${l.n}`);
    }
  }
});

test('applyAttempt: брояч, „научена“ при learnStreak, грешка → 0, learnedAt не се презаписва', () => {
  const k = { courseId: 'italian', lineId: 'aaaa0001', n: 1, learnStreak: 3 };
  const clean = { clean: true, done: true, errors: [], hints: 0 };
  const dirty = { clean: false, done: true, errors: [{ ply: 2, played: 'd4', expected: 'Nf3' }], hints: 0 };
  let { row, becameLearned } = applyAttempt(null, clean, { ...k, now: 10 });
  assert.equal(row.key, 'italian/aaaa0001');
  assert.equal(row.status, 'learning');
  assert.equal(row.streak, 1);
  assert.equal(becameLearned, false);
  ({ row } = applyAttempt(row, clean, { ...k, now: 20 }));
  assert.equal(row.streak, 2);
  ({ row } = applyAttempt(row, dirty, { ...k, now: 30 }));
  assert.equal(row.streak, 0);
  assert.equal(row.bestStreak, 2);
  assert.equal(row.errors, 1);
  assert.equal(row.status, 'learning');
  for (const t of [40, 50]) ({ row } = applyAttempt(row, clean, { ...k, now: t }));
  assert.equal(row.status, 'learning');
  ({ row, becameLearned } = applyAttempt(row, clean, { ...k, now: 60 }));
  assert.equal(becameLearned, true);
  assert.equal(row.status, 'learned');
  assert.equal(row.learnedAt, 60);
  assert.equal(row.due, null, 'due се смята от FSRS (T-010)');
  assert.deepEqual(row.fsrs, { stability: null, difficulty: null, reps: 0, lapses: 0, state: 'new', lastReview: null });
  assert.equal(row.plays, 6);
  assert.equal(row.cleanPlays, 5);
  ({ row, becameLearned } = applyAttempt(row, dirty, { ...k, now: 70 }));
  assert.equal(row.status, 'learned', 'грешка в learn не „разучава“ линията');
  assert.equal(row.learnedAt, 60);
  assert.equal(becameLearned, false);
  // learnStreak 1 → научена от първия чист опит
  assert.equal(applyAttempt(null, clean, { ...k, learnStreak: 1, now: 1 }).becameLearned, true);
});

test('dayKey с dayStartHour; nextAfter по ред с обикаляне; статуси', () => {
  const t = new Date(2026, 10, 26, 3, 59).getTime();
  assert.equal(dayKey(t, 4), '2026-11-25');
  assert.equal(dayKey(t, 0), '2026-11-26');
  assert.equal(dayKey(new Date(2026, 10, 26, 4, 0).getTime(), 4), '2026-11-26');
  const lines = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'c', n: 3 }];
  const rows = new Map([['b', { status: 'learned' }]]);
  assert.equal(nextAfter(lines, rows, 'a').id, 'c');
  assert.equal(nextAfter(lines, rows, 'c').id, 'a');
  assert.equal(nextAfter(lines, new Map([['a', { status: 'learned' }], ['b', { status: 'learned' }]]), 'c'), null);
  assert.equal(lineStatus(newLineRow({ courseId: 'x', lineId: 'a', n: 1 }, 1)), 'new');
  assert.deepEqual(courseProgress(3, [{ lineId: 'a', status: 'learned' }, { lineId: 'b', status: 'learning' }, { lineId: 'zz', status: 'learned' }], new Set(['a', 'b', 'c'])),
    { total: 3, learned: 1, learning: 1, fresh: 1 });
});

test('IndexedDB: touchLine + recordAttempt пишат lineProgress, attempts и daily в една транзакция', async () => {
  let clock = new Date(2026, 10, 26, 12, 0).getTime();
  const udb = await openUserDb({ indexedDB: new IDBFactory(), now: () => (clock += 1000) });
  const row0 = await udb.touchLine('italian', 'aaaa0001', 1);
  assert.equal(row0.status, 'new');
  assert.equal((await udb.touchLine('italian', 'aaaa0001', 1)).firstSeen, row0.firstSeen, 'вторият touch не пипа реда');
  const res = { done: true, clean: true, errors: [], hints: 0, plies: 5, total: 5, userMoves: 3, ms: 4000 };
  for (let i = 0; i < 2; i++) await udb.recordAttempt({ courseId: 'italian', lineId: 'aaaa0001', n: 1, result: res, learnStreak: 3, dayStartHour: 4 });
  const out = await udb.recordAttempt({ courseId: 'italian', lineId: 'aaaa0001', n: 1, result: res, learnStreak: 3, dayStartHour: 4 });
  assert.equal(out.becameLearned, true);
  const row = await udb.getLine('italian', 'aaaa0001');
  assert.equal(row.status, 'learned');
  assert.equal(row.streak, 3);
  assert.equal(row.firstSeen, row0.firstSeen);
  const bad = { ...res, clean: false, errors: [{ ply: 2, played: 'd4', expected: 'Nf3' }] };
  await udb.recordAttempt({ courseId: 'italian', lineId: 'aaaa0001', n: 1, result: bad, learnStreak: 3, dayStartHour: 4 });
  const atts = await udb.attemptsFor('italian', 'aaaa0001');
  assert.equal(atts.length, 4);
  assert.deepEqual(atts.map((a) => a.ok), [true, true, true, false]);
  assert.deepEqual(atts[3].errors, bad.errors);
  assert.equal(atts[3].mode, 'learn');
  assert.equal(atts[3].streakAfter, 0);
  const daily = await udb.db.getAll('daily');
  assert.deepEqual(daily, [{ day: '2026-11-26', newLearned: 1, reviews: 0, reviewErrors: 0, plays: 4 }]);
  assert.equal((await udb.progressByCourse('italian')).length, 1);
  udb.close();
});
