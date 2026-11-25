// Шахматно ядро src/chess/position.js (T-003).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  START_FEN, ChessError, Position, key, keyToFen, sideToMove, legalSans,
  applySan, applyUci, applySans, sanToUci, uciToSan, tokenizeMoves, pgnToSans,
  sansToPgn, sha1Hex, lineId, perft,
} from '../../src/chess/position.js';

const START_KEY = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof ChessError && e.code === code);

// ---- Ключ на позиция (D-005) ----

test('ключът на началната позиция е EPD с 4 полета', () => {
  assert.equal(key(), START_KEY);
  assert.equal(key(START_FEN), START_KEY);
  assert.equal(Position.start().key(), START_KEY);
  assert.equal(key(START_KEY), START_KEY, 'ключът е идемпотентен');
  assert.equal(keyToFen(START_KEY), `${START_KEY} 0 1`);
});

test('ключът не зависи от броячите на ходове', () => {
  const a = applySans(['Nf3', 'Nf6', 'Ng1', 'Ng8']);
  assert.equal(a.key, START_KEY);
  assert.notEqual(a.fen, START_FEN, 'FEN-ът се различава по броячите');
  assert.equal(key('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 37 99'), START_KEY);
});

test('транспозиция: 1.d4 Nf6 2.c4 e6 = 1.c4 e6 2.d4 Nf6', () => {
  const a = applySans(['d4', 'Nf6', 'c4', 'e6']);
  const b = applySans(['c4', 'e6', 'd4', 'Nf6']);
  assert.equal(a.key, b.key);
  assert.equal(a.key, 'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -');
});

test('транспозиция с двоен ход на пешка накрая: en passant не разделя ключа', () => {
  // При 1.e4 e5 2.Nf3 Nc6 последният ход е Nc6; при 1.Nf3 Nc6 2.e4 e5 — e7-e5 (ep поле e6, но няма вземане).
  const a = applySans(['e4', 'e5', 'Nf3', 'Nc6']);
  const b = applySans(['Nf3', 'Nc6', 'e4', 'e5']);
  assert.equal(a.key, b.key);
  assert.equal(pgnToSans('1.Nf3 Nc6 2.e4 e5').length, 4);
});

test('en passant поле само ако има легално вземане ан пасан', () => {
  // След 1.e4 няма черна пешка до e4 → без ep поле.
  assert.equal(applySans(['e4']).key.split(' ')[3], '-');
  // След 1.e4 a6 2.e5 d5 белите могат exd6 e.p. → d6.
  const r = applySans(['e4', 'a6', 'e5', 'd5']);
  assert.equal(r.key.split(' ')[3], 'd6');
  // FEN с ep поле, но без пешка, която да вземе → нормализира се до „-“.
  assert.equal(key('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2').split(' ')[3], '-');
  // ...и двата записа дават един ключ.
  assert.equal(
    key('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq e6 0 2'),
    key('rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2'),
  );
});

test('en passant при вързана пешка не е легален → без ep поле', () => {
  // Черните са изиграли c7-c5; bxc6 e.p. би открило царя на a5 за топа на h5.
  const fen = '8/8/8/KPp4r/8/8/8/4k3 w - c6 0 2';
  assert.equal(key(fen).split(' ')[3], '-');
  assert.ok(!legalSans(fen).includes('bxc6'));
  // Същата позиция без топа: вземането е легално → c6 остава.
  const free = '8/8/8/KPp5/8/8/8/4k3 w - c6 0 2';
  assert.equal(key(free).split(' ')[3], 'c6');
  assert.ok(legalSans(free).includes('bxc6'));
});

test('вземане ан пасан: флаг, UCI и премахната пешка', () => {
  const p = new Position();
  for (const s of ['e4', 'a6', 'e5', 'd5']) p.playSan(s);
  const m = p.playSan('exd6');
  assert.equal(m.uci, 'e5d6');
  assert.equal(m.enPassant, true);
  assert.equal(m.captured, 'p');
  assert.equal(p.pieceAt('d5'), null);
  assert.deepEqual(p.pieceAt('d6'), { type: 'p', color: 'w' });
});

test('ключът изчиства невъзможни права за рокада', () => {
  // Цар на f1, но FEN твърди KQkq.
  const bogus = 'r3k2r/8/8/8/8/8/8/R4K1R w KQkq - 0 1';
  assert.equal(key(bogus).split(' ')[2], 'kq');
  // Липсващ топ на a8.
  assert.equal(key('4k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1').split(' ')[2], 'KQk');
  assert.equal(key('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1').split(' ')[2], '-');
});

// ---- Рокади ----

test('рокада: къса и дълга, SAN и UCI', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const short = applySan(fen, 'O-O');
  assert.equal(short.move.uci, 'e1g1');
  assert.equal(short.move.castle, 'k');
  assert.equal(short.key, 'r3k2r/8/8/8/8/8/8/R4RK1 b kq -');
  const long = applySan(fen, 'O-O-O');
  assert.equal(long.move.uci, 'e1c1');
  assert.equal(long.move.castle, 'q');
  assert.equal(uciToSan(fen, 'e1g1'), 'O-O');
  assert.equal(sanToUci(fen, '0-0-0'), 'e1c1', 'нулите се приемат и се нормализират');
  assert.equal(applySan(fen, '0-0').move.san, 'O-O');
});

test('рокада: не през шах, не под шах, не след ход на царя', () => {
  // Черен топ на f8 бие f1 → няма къса рокада; дългата е възможна.
  const through = '1k3r2/8/8/8/8/8/8/R3K2R w KQ - 0 1';
  assert.ok(!legalSans(through).includes('O-O'));
  assert.ok(legalSans(through).includes('O-O-O'));
  throwsCode(() => applySan(through, 'O-O'), 'illegal-move');
  // Под шах — никаква рокада.
  const inCheck = '1k2r3/8/8/8/8/8/8/R3K2R w KQ - 0 1';
  assert.ok(!legalSans(inCheck).some((s) => s.startsWith('O-O')));
  // Цар отиде и се върна → правата са загубени.
  const r = applySans(['Kf1', 'Kf8', 'Ke1', 'Ke8'], 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(r.key, 'r3k2r/8/8/8/8/8/8/R3K2R w - -');
  // Ход с топ губи само едната страна.
  assert.equal(applySan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'Rb1').key.split(' ')[2], 'Kkq');
});

// ---- Промоция ----

test('промоция: SAN, UCI, слаба промоция, вземане с промоция', () => {
  const fen = '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  assert.equal(sanToUci(fen, 'a8=Q'), 'a7a8q');
  assert.equal(uciToSan(fen, 'a7a8n'), 'a8=N');
  assert.equal(uciToSan(fen, 'a7b8q'), 'axb8=Q+');
  const r = applyUci(fen, 'a7b8r');
  assert.equal(r.move.promotion, 'r');
  assert.equal(r.move.captured, 'r');
  assert.deepEqual(new Position(r.fen).pieceAt('b8'), { type: 'r', color: 'w' });
  // UCI без фигура за промоция е невалиден ход; e7e8k — невалиден запис.
  throwsCode(() => applyUci(fen, 'a7a8'), 'illegal-move');
  throwsCode(() => applyUci(fen, 'a7a8k'), 'bad-uci');
  const p = new Position(fen);
  assert.equal(p.isPromotion('a7', 'a8'), true);
  assert.equal(p.isPromotion('e1', 'e2'), false);
  assert.equal(p.playMove({ from: 'a7', to: 'a8', promotion: 'q' }).san, 'a8=Q');
  // Четирите варианта на промоция са отделни легални ходове.
  const promos = new Position(fen).legalUcis().filter((u) => u.startsWith('a7a8'));
  assert.deepEqual(promos.sort(), ['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r']);
});

// ---- Шах, мат, пат, край ----

test('шах и мат: детски мат и мат на глупака', () => {
  const p = new Position();
  for (const s of ['f3', 'e5', 'g4']) p.playSan(s);
  const m = p.playSan('Qh4');
  assert.equal(m.san, 'Qh4#', 'каноничният SAN съдържа #');
  assert.equal(p.isCheck(), true);
  assert.equal(p.isCheckmate(), true);
  assert.equal(p.isGameOver(), true);
  assert.deepEqual(p.status(), { over: true, reason: 'checkmate', winner: 'b' });
  assert.deepEqual(p.legalSans(), []);
  throwsCode(() => p.playSan('a3'), 'illegal-move');

  const s = pgnToSans('1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 4.Qxf7');
  assert.equal(s.at(-1), 'Qxf7#');
});

test('шах без мат; пат; недостатъчен материал; трикратно повторение', () => {
  const check = new Position('4k3/8/8/8/8/8/8/4K2R w - - 0 1');
  assert.equal(check.playSan('Rh8').san, 'Rh8+');
  assert.equal(check.isCheck(), true);
  assert.equal(check.isCheckmate(), false);
  assert.equal(check.status().over, false);

  const stalemate = new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stalemate.isStalemate(), true);
  assert.deepEqual(stalemate.status(), { over: true, reason: 'stalemate', winner: null });

  assert.equal(new Position('4k3/8/8/8/8/8/8/4KB2 w - - 0 1').status().reason, 'insufficient');

  const rep = new Position();
  for (const s of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) rep.playSan(s);
  assert.equal(rep.status().reason, 'threefold');
  assert.equal(rep.clone().status().reason, 'threefold', 'clone пази историята');

  assert.equal(new Position('4k3/8/8/8/8/8/8/4K2R w - - 100 80').status().reason, 'fifty');
  assert.deepEqual(Position.start().status(), { over: false, reason: null, winner: null });
});

// ---- Невалидни ходове и вход ----

test('невалидни ходове: ясна грешка и непроменена позиция', () => {
  const p = new Position();
  for (const bad of ['e5', 'Nf4', 'Ke2', 'O-O', 'xyz', '', '--', 'Z0', '0000', 'e2e5', null, 42]) {
    assert.throws(() => p.playSan(bad), ChessError, `трябва да откаже ${bad}`);
  }
  assert.equal(p.fen(), START_FEN);
  assert.equal(p.history().length, 0);
  throwsCode(() => p.playUci('e2e5'), 'illegal-move');
  throwsCode(() => p.playUci('e2-e4'), 'bad-uci');
  throwsCode(() => p.playUci('i2i4'), 'bad-uci');
  assert.equal(p.findSan('e5'), null);
  assert.equal(p.findUci('e2e5'), null);
  assert.equal(p.fen(), START_FEN);
});

test('нееднозначен SAN се отказва, уточненият се приема', () => {
  const fen = '4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1';
  throwsCode(() => applySan(fen, 'Nd2'), 'illegal-move');
  assert.equal(applySan(fen, 'Nbd2').move.uci, 'b1d2');
  assert.equal(applySan(fen, 'Nfd2').move.uci, 'f1d2');
});

test('невалиден FEN дава bad-fen', () => {
  throwsCode(() => new Position('not a fen'), 'bad-fen');
  throwsCode(() => key('8/8/8/8/8/8/8/8 w - - 0 1'), 'bad-fen'); // без царе
  throwsCode(() => new Position(123), 'bad-fen');
});

test('applySans: грешка с номер на хода и полуход', () => {
  try {
    applySans(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf3']);
    assert.fail('трябваше да хвърли');
  } catch (e) {
    assert.ok(e instanceof ChessError);
    assert.equal(e.code, 'illegal-move');
    assert.equal(e.ply, 5);
    assert.equal(e.label, '3...Nf3');
    assert.match(e.message, /3\.\.\.Nf3/);
  }
});

// ---- PGN-подобен текст ----

test('pgnToSans: номера, коментари, вариации, NAG, резултат, тагове', () => {
  const pgn = `[Event "x"]
[Site "y"]

1.e4 e5 2. Nf3 {коментар (със скоба)} Nc6 (2...d6 3.d4 (3.Bc4)) 3.Bb5!? a6 $1
4.Ba4 ; ред-коментар
4... Nf6 5.0-0 1-0`;
  assert.deepEqual(pgnToSans(pgn), ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
  assert.deepEqual(pgnToSans('1.e4 e5 2.Nf3'), ['e4', 'e5', 'Nf3']);
  assert.deepEqual(pgnToSans('1. d4 d5 2. c4'), ['d4', 'd5', 'c4']);
  assert.deepEqual(pgnToSans(''), []);
  assert.deepEqual(pgnToSans('1...e5', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'), ['e5']);
  // Каноничен SAN: добавя + и нормализира рокадата.
  assert.deepEqual(pgnToSans('1.e4 f5 2.Qh5'), ['e4', 'f5', 'Qh5+']);
});

test('pgnToSans: ясна грешка при невалиден ход и счупен текст', () => {
  assert.throws(() => pgnToSans('1.e4 e5 2.Nf9'), (e) => e.code === 'illegal-move' && e.label === '2.Nf9' && e.ply === 2);
  assert.throws(() => pgnToSans('1.e4 e4'), (e) => e.code === 'illegal-move' && e.label === '1...e4');
  throwsCode(() => tokenizeMoves('1.e4 (1.d4'), 'bad-pgn');
  throwsCode(() => tokenizeMoves('1.e4 ) e5'), 'bad-pgn');
  throwsCode(() => tokenizeMoves('1.e4 {без край'), 'bad-pgn');
  throwsCode(() => tokenizeMoves(null), 'bad-pgn');
});

test('sansToPgn е обратна на pgnToSans', () => {
  const sans = ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6'];
  const text = sansToPgn(sans);
  assert.equal(text, '1.e4 c5 2.Nf3 Nc6 3.d4 cxd4 4.Nxd4 g6');
  assert.deepEqual(pgnToSans(text), sans);
  const blackFirst = sansToPgn(['e5', 'Nf3'], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.equal(blackFirst, '1...e5 2.Nf3');
});

// ---- Ход, полета, страна на ход ----

test('MoveInfo съдържа от–до полета; dests за дъската; кой е на ход', () => {
  assert.equal(sideToMove(), 'w');
  assert.equal(sideToMove(applySan(START_FEN, 'e4').fen), 'b');
  const p = Position.start();
  const m = p.playSan('Nf3');
  assert.equal(m.from, 'g1');
  assert.equal(m.to, 'f3');
  assert.equal(m.piece, 'n');
  assert.equal(m.color, 'w');
  assert.deepEqual(p.lastMove(), m);
  assert.equal(p.turn(), 'b');
  const d = Position.start().dests();
  assert.equal(d.size, 10);
  assert.deepEqual(d.get('g1').sort(), ['f3', 'h3']);
  assert.deepEqual(d.get('e2').sort(), ['e3', 'e4']);
  assert.equal(legalSans().length, 20);
  assert.deepEqual(p.sans(), ['Nf3']);
  assert.equal(p.undo().san, 'Nf3');
  assert.equal(p.key(), START_KEY);
  assert.equal(p.undo(), null);
});

test('play() разпознава SAN и UCI', () => {
  const p = new Position();
  assert.equal(p.play('e2e4').san, 'e4');
  assert.equal(p.play('c5').uci, 'c7c5');
  assert.equal(p.play('g1f3').san, 'Nf3');
  assert.deepEqual(p.sans(), ['e4', 'c5', 'Nf3']);
});

test('applySans връща ключ след всеки ход и UCI', () => {
  const r = applySans(['e4', 'e5']);
  assert.deepEqual(r.ucis, ['e2e4', 'e7e5']);
  assert.equal(r.keys.length, 2);
  assert.equal(r.keys[1], r.key);
  assert.equal(r.key, key(r.fen));
});

// ---- Stable id на линия (D-021) ----

test('sha1Hex съвпада с node:crypto (вкл. UTF-8 и граници на блока)', () => {
  const samples = ['', 'abc', 'кирилица ♞', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'b'.repeat(119), 'c'.repeat(1000),
    'italian|e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5 exd5 Nxd5 Qb3'];
  for (const s of samples) assert.equal(sha1Hex(s), createHash('sha1').update(s, 'utf8').digest('hex'), `sha1 „${s.slice(0, 20)}“`);
});

test('lineId = sha1(courseId|ходове)[:8], детерминиран', () => {
  const m = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];
  const id = lineId('italian', m);
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.equal(id, createHash('sha1').update('italian|e4 e5 Nf3 Nc6 Bc4').digest('hex').slice(0, 8));
  assert.equal(lineId('italian', [...m]), id);
  assert.equal(lineId('italian', ['e4', 'e5']), '0bcbe87d', 'фиксирана стойност (регресия)');
  assert.notEqual(lineId('scotch', m), id, 'зависи от курса');
  assert.notEqual(lineId('italian', m.slice(0, 4)), id, 'зависи от ходовете');
  assert.throws(() => lineId('', m), TypeError);
  assert.throws(() => lineId('italian', 'e4 e5'), TypeError);
});

// ---- Perft през обвивката ----

test('perft от началната позиция: 20 / 400 / 8902', () => {
  assert.equal(perft(START_FEN, 1), 20);
  assert.equal(perft(START_FEN, 2), 400);
  assert.equal(perft(START_FEN, 3), 8902);
});

test('perft Kiwipete (рокади, ан пасан, промоции): 48 / 2039', () => {
  assert.equal(perft(KIWIPETE, 1), 48);
  assert.equal(perft(KIWIPETE, 2), 2039);
});

// ---- Съвместимост: Node и браузър ----

test('модулът няма DOM и bare imports (работи в Node и като ES module в браузъра)', () => {
  const src = readFileSync(new URL('../../src/chess/position.js', import.meta.url), 'utf8');
  const specs = [...src.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(specs, ['../../vendor/chess.js/chess.js']);
  assert.doesNotMatch(src, /\b(window|document|localStorage|navigator|crypto\.subtle|require\()/);
  assert.equal(typeof globalThis.document, 'undefined', 'тестът върви без DOM');
});
