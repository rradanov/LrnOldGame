#!/usr/bin/env node
// Фалшив UCI двигател за тестовете на tools/build-courses (детерминиран мок на Stockfish).
// Говори минималния UCI: uci, isready, setoption, ucinewgame, position fen, go nodes N
// [searchmoves …], quit. Оценките са от гледна точка на страната на ход:
//   • FAKE_UCI_TABLE=<json файл>: {"<EPD>": [["Nf3", 30], ["Nc3", {"mate": 3}], …]} — SAN и cp
//     (или мат) за изброените ходове; останалите легални ходове са под най-слабия изброен;
//   • иначе cp = (fnv1a(EPD + uci) mod 41) − 20 за всеки легален ход.
// Режими за тестове на пула: FAKE_UCI_CRASH_ONCE=<маркер> (първото go, ако маркерът липсва,
// го създава и процесът умира), FAKE_UCI_HANG_ONCE=<маркер> (… и не отговаря);
// FAKE_UCI_LOG=<файл> — добавя ред „<EPD>[|sm:uci]“ за всяко go; FAKE_UCI_ID — `id name`.
import { createInterface } from 'node:readline';
import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { Position } from '../../src/chess/position.js';

const env = process.env;
const table = env.FAKE_UCI_TABLE ? JSON.parse(readFileSync(env.FAKE_UCI_TABLE, 'utf8')) : {};
let multiPV = 1;
let fen = null;

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const val = (s) => (typeof s === 'object' ? (s.mate > 0 ? 30000 - s.mate : -30000 - s.mate) : s);
const out = (s) => process.stdout.write(`${s}\n`);

function scores(pos) {
  const k = pos.key();
  const legal = pos.legalMoves();
  const row = table[k];
  let list;
  if (row) {
    const listed = new Map(row.map(([san, sc]) => [pos.findSan(san).uci, sc]));
    const floor = Math.min(...row.map(([, sc]) => val(sc))) - 50;
    list = legal.map((m) => ({ uci: m.uci, sc: listed.has(m.uci) ? listed.get(m.uci) : floor - (fnv(k + m.uci) % 10) }));
  } else {
    list = legal.map((m) => ({ uci: m.uci, sc: (fnv(k + m.uci) % 41) - 20 }));
  }
  return list.sort((a, b) => val(b.sc) - val(a.sc) || (a.uci < b.uci ? -1 : 1));
}

function go(args) {
  const pos = new Position(fen);
  const sm = args.indexOf('searchmoves');
  const only = sm >= 0 ? new Set(args.slice(sm + 1)) : null;
  if (env.FAKE_UCI_LOG) appendFileSync(env.FAKE_UCI_LOG, `${pos.key()}${only ? `|sm:${[...only].join(',')}` : ''}\n`);
  for (const [mode, marker] of [['crash', env.FAKE_UCI_CRASH_ONCE], ['hang', env.FAKE_UCI_HANG_ONCE]]) {
    if (marker && !existsSync(marker)) {
      writeFileSync(marker, mode);
      if (mode === 'crash') process.exit(3);
      return; // hang: не отговаря
    }
  }
  let list = scores(pos);
  if (only) list = list.filter((x) => only.has(x.uci));
  const n = Number(args[args.indexOf('nodes') + 1]) || 1000;
  list.slice(0, multiPV).forEach((x, i) => {
    const score = typeof x.sc === 'object' ? `mate ${x.sc.mate}` : `cp ${x.sc}`;
    out(`info depth 1 seldepth 1 multipv ${i + 1} score ${score} nodes ${n} nps 1000000 time 1 pv ${x.uci}`);
  });
  out(`bestmove ${list[0]?.uci ?? '(none)'}`);
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  const line = raw.trim();
  const t = line.split(/\s+/);
  switch (t[0]) {
    case 'uci': out(`id name ${env.FAKE_UCI_ID ?? 'FakeFish 1'}`); out('id author tests'); out('uciok'); break;
    case 'isready': out('readyok'); break;
    case 'setoption': if (t[2] === 'MultiPV') multiPV = Number(t[4]); break;
    case 'ucinewgame': break;
    case 'position': fen = t[1] === 'startpos' ? undefined : t.slice(2).join(' '); break;
    case 'go': go(t); break;
    case 'quit': process.exit(0); break;
    default: break;
  }
});
