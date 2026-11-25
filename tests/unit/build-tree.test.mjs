// T-004: дърво от lichess — поток, филтри, броене, транспозиции, спиране, подрязване.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { readGames } from '../../tools/build-tree/pgn-stream.js';
import { rejectReason, parseTimeControl, hasMoves } from '../../tools/build-tree/filter.js';
import { EdgeCounter, gameEdges, START_KEY } from '../../tools/build-tree/counter.js';
import { buildTree, paramsHash } from '../../tools/build-tree/build.js';
import { writeTree, readTree } from '../../tools/build-tree/tree-file.js';
import { parseCli, resolveParams, loadConfigFile } from '../../tools/build-tree/config.js';
import { applySans, sha1Hex } from '../../src/chess/position.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'lichess-sample.pgn');
const CLI = join(ROOT, 'tools', 'build-tree', 'index.js');

const BASE = {
  maxGames: 1000, minElo: 1200, maxElo: 1800, minBaseSec: 180, maxBaseSec: 0,
  ratedOnly: true, includeCorrespondence: false, excludeTerminations: ['Abandoned'],
  maxPly: 28, minGames: 1, minGamesPerMove: 1, workers: 1, pruneEveryGames: 100000, batchSize: 3,
};
const params = (o = {}) => resolveParams({ ...BASE, ...o });
const keyOf = (sans) => applySans(sans).key;
const fixtureStream = () => createReadStream(FIXTURE, { highWaterMark: 97 }); // малки парчета → редове през границата

async function collect(input) {
  const out = [];
  for await (const g of readGames(input)) out.push(g);
  return out;
}
const nodeMap = (nodes) => new Map(nodes.map(([epd, n, flat]) => [epd, { n, flat }]));

// ---- поток ----

test('readGames: 22 партии от fixture, хедъри и ходове, CRLF и парчета', async () => {
  const games = await collect(fixtureStream());
  assert.equal(games.length, 22);
  assert.equal(games[0].headers.WhiteElo, '1500');
  assert.match(games[0].moves, /^1\. e4 \{ \[%clk 0:05:00\] \} e5/);
  const crlf = readFileSync(FIXTURE, 'utf8').replace(/\n/g, '\r\n');
  const games2 = await collect(Readable.from([crlf.slice(0, 1000), crlf.slice(1000)]));
  assert.deepEqual(games2.map((g) => g.moves), games.map((g) => g.moves));
});

test('readGames: повреден хедър → bad; ресинхронизация след ходове без празен ред', async () => {
  const text = '[Event "Rated Blitz game"]\n[WhiteElo "15\n\n1. e4 1-0\n[Event "x"]\n1. d4 1-0\n[Site "y"]\n1. c4\n';
  const games = await collect(Readable.from([text]));
  assert.equal(games.length, 3);
  assert.equal(games[0].bad, true);
  assert.equal(games[1].bad, false);
  assert.equal(games[1].moves, '1. d4 1-0');
  assert.equal(games[2].headers.Site, 'y'); // хедър след ходове започва нова партия
});

test('readGames: многобайтови UTF-8 знаци, разделени между парчета', async () => {
  const buf = Buffer.from('[Event "Rated"]\n[White "Иван"]\n\n1. e4 1-0\n');
  const parts = [];
  for (let i = 0; i < buf.length; i += 5) parts.push(buf.subarray(i, i + 5));
  const [g] = await collect(Readable.from(parts));
  assert.equal(g.headers.White, 'Иван');
});

// ---- филтри ----

test('parseTimeControl и hasMoves', () => {
  assert.deepEqual(parseTimeControl('180+2'), { base: 180, inc: 2, correspondence: false });
  assert.equal(parseTimeControl('-').correspondence, true);
  assert.equal(parseTimeControl('abc'), null);
  assert.equal(hasMoves('0-1'), false);
  assert.equal(hasMoves('1/2-1/2'), false);
  assert.equal(hasMoves('{ [%clk 0:01:00] } *'), false);
  assert.equal(hasMoves('1. e4 1-0'), true);
});

test('rejectReason: всеки филтър поотделно', async () => {
  const games = await collect(fixtureStream());
  const reasons = games.map((g) => rejectReason(g, params()));
  assert.deepEqual(reasons, [
    null, null, null, null, null, null, null, // 1–7 приети
    'casual', 'termination', 'elo', 'elo', 'time-control', 'time-control',
    'termination', 'no-moves', 'from-position', 'variant', 'bad-header',
    null, // 19: невалиден ход — хедърите са наред, отхвърля го нишката
    'elo', // 20: Elo „?“
    null, null, // 21 (боклук в ходовете), 22
  ]);
  // Рейтинг: и двамата в [min, max]; maxElo 0 = без горна граница.
  const g = (we, be) => ({ headers: { Event: 'Rated Blitz game', WhiteElo: we, BlackElo: be, TimeControl: '300+0' }, moves: '1. e4', bad: false });
  assert.equal(rejectReason(g('1200', '1800'), params()), null);
  assert.equal(rejectReason(g('1199', '1500'), params()), 'elo');
  assert.equal(rejectReason(g('1500', '1801'), params()), 'elo');
  assert.equal(rejectReason(g('2500', '1500'), params({ maxElo: 0 })), null);
  // Контрол на времето: база ≥ minBaseSec, ≤ maxBaseSec (0 = без граница); кореспондентни по флаг.
  const tc = (t) => ({ ...g('1500', '1500'), headers: { ...g('1500', '1500').headers, TimeControl: t } });
  assert.equal(rejectReason(tc('179+5'), params()), 'time-control');
  assert.equal(rejectReason(tc('180+0'), params()), null);
  assert.equal(rejectReason(tc('900+10'), params({ maxBaseSec: 600 })), 'time-control');
  assert.equal(rejectReason(tc('-'), params({ includeCorrespondence: true })), null);
  // Нерейтингови по флаг.
  assert.equal(rejectReason(games[7], params({ ratedOnly: false })), null);
});

// ---- броене ----

test('gameEdges: позиции и ребра до maxPly, край, повторение, невалиден ход', () => {
  const k1 = keyOf(['e4']);
  assert.deepEqual(gameEdges('1. e4 e5 1-0', 28), [START_KEY, `${START_KEY} e4`, k1, `${k1} e5`, keyOf(['e4', 'e5'])]);
  // maxPly отрязва: позицията след последния броен ход не се записва
  assert.deepEqual(gameEdges('1. e4 e5 2. Nf3 1-0', 2), [START_KEY, `${START_KEY} e4`, k1, `${k1} e5`]);
  // повторение на началната позиция — брои се веднъж
  const e = gameEdges('1. Nf3 Nf6 2. Ng1 Ng8 3. e4 1-0', 28);
  assert.equal(e.filter((x) => x === START_KEY).length, 1);
  assert.ok(!e.includes(`${START_KEY} e4`));
  assert.equal(e.at(-1), k1); // 3.e4 стига позицията след 1.e4 → брои се като край
  // каноничен SAN
  assert.deepEqual(gameEdges('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. 0-0', 28).at(-2).split(' ').at(-1), 'O-O');
  assert.equal(gameEdges('1. e4 e5 2. Ke3', 28), null);
  assert.equal(gameEdges('1. e4 ### 1-0', 28), null);
  assert.equal(gameEdges('1. e4 e5 2. Ke3', 2).length, 4); // невалидното е след maxPly — не се проверява
  assert.deepEqual(gameEdges('1-0', 28), []);
});

test('EdgeCounter: точно под ширината на кофата; lossy изрязване с гаранция', () => {
  const c = new EdgeCounter({ window: 4 });
  for (let i = 0; i < 3; i++) c.addGame(['a', 'a x', `u${i}`]);
  assert.equal(c.size, 5);
  c.finalPrune(); // < 1 кофа → нищо не се маха
  assert.equal(c.size, 5);
  assert.equal(c.maxUndercount, 0);
  c.addGame(['a', 'a x', 'u3']); // край на кофа 1 → единичните u* изчезват
  assert.deepEqual(new Map(c.entries()), new Map([['a', 4], ['a x', 4]]));
  // b: всяка 2-ра партия (> 1/w) — оцелява; v*: единични — изчезват в края на всяка кофа
  for (let i = 0; i < 400; i++) c.addGame(i % 2 === 0 ? ['a', 'b'] : ['a', `v${i}`]);
  c.finalPrune();
  const m = new Map(c.entries());
  assert.equal(m.get('a'), 404);
  assert.equal(m.get('b'), 200);
  assert.equal(m.get('a x'), undefined); // 4 от 404 (< N/w) — изрязано
  assert.equal(c.size, 2);
  assert.ok(c.pruned >= 200);
  assert.equal(c.maxUndercount, 101);
});

test('buildTree върху fixture: броеве, транспозиции, статистика', async () => {
  const { manifest, nodes } = await buildTree(fixtureStream(), { tree: params(), source: { month: '2026-10' } });
  const st = manifest.stats;
  assert.equal(st.gamesRead, 22);
  assert.equal(st.gamesAccepted, 10);
  assert.equal(st.gamesCounted, 8);
  assert.equal(st.gamesIllegal, 2);
  assert.equal(st.stoppedBy, 'eof');
  assert.deepEqual(st.rejected, { 'bad-header': 1, casual: 1, elo: 3, 'from-position': 1, 'no-moves': 1, termination: 2, 'time-control': 2, variant: 1 });
  const m = nodeMap(nodes);
  assert.deepEqual(m.get(START_KEY), { n: 8, flat: ['e4', 4, 'Nf3', 2, 'c4', 1, 'd4', 1] });
  assert.deepEqual(m.get(keyOf(['e4'])), { n: 5, flat: ['e5', 3, 'c5', 1] }); // +1 от 3.e4 след повторение
  // транспозиция: 1.e4 e5 2.Nf3 Nc6 = 1.Nf3 Nc6 2.e4 e5
  assert.deepEqual(m.get(keyOf(['e4', 'e5', 'Nf3', 'Nc6'])), { n: 3, flat: ['Bb5', 2, 'Bc4', 1] });
  // транспозиция: 1.d4 Nf6 2.c4 e6 = 1.c4 e6 2.d4 Nf6 (и двете партии свършват тук)
  assert.deepEqual(m.get(keyOf(['d4', 'Nf6', 'c4', 'e6'])), { n: 2, flat: [] });
  // невалидните партии (19, 21) не оставят следа
  assert.equal(m.get(keyOf(['d4', 'd5'])), undefined);
  // сортирани по EPD, n ≥ сумата на ходовете
  assert.deepEqual(nodes.map((x) => x[0]), nodes.map((x) => x[0]).slice().sort());
  for (const [, n, flat] of nodes) assert.ok(n >= flat.filter((_, i) => i % 2).reduce((a, b) => a + b, 0));
});

test('подрязване: minGames и minGamesPerMove', async () => {
  const { nodes } = await buildTree(fixtureStream(), { tree: params({ minGames: 3, minGamesPerMove: 2 }) });
  const m = nodeMap(nodes);
  assert.deepEqual([...m.values()].map((x) => x.n).sort(), [3, 3, 3, 5, 8]);
  assert.deepEqual(m.get(START_KEY), { n: 8, flat: ['e4', 4, 'Nf3', 2] }); // n остава пълното
  assert.deepEqual(m.get(keyOf(['e4'])), { n: 5, flat: ['e5', 3] });
  assert.deepEqual(m.get(keyOf(['e4', 'e5', 'Nf3', 'Nc6'])), { n: 3, flat: ['Bb5', 2] });
});

test('maxPly ограничава дълбочината', async () => {
  const { nodes } = await buildTree(fixtureStream(), { tree: params({ maxPly: 1 }) });
  assert.deepEqual(nodes.map((x) => x[0]), [START_KEY]);
  // партии 19 и 21 са невалидни след 1-вия полуход — при maxPly 1 не се проверяват и се броят
  assert.deepEqual(nodes[0][2], ['e4', 5, 'Nf3', 2, 'd4', 2, 'c4', 1]);
});

test('maxGames: спира след N приети и затваря входа', async () => {
  const input = fixtureStream();
  const { manifest, nodes } = await buildTree(input, { tree: params({ maxGames: 3 }) });
  assert.equal(manifest.stats.stoppedBy, 'maxGames');
  assert.equal(manifest.stats.gamesAccepted, 3);
  assert.equal(manifest.stats.gamesRead, 3);
  assert.equal(nodeMap(nodes).get(START_KEY).n, 3);
  assert.equal(input.destroyed, true);
});

test('детерминизъм: еднакъв резултат при 1, 2 и 3 нишки и различни партиди', async () => {
  const runs = [];
  for (const [workers, batchSize] of [[1, 500], [2, 1], [3, 2]]) {
    const { manifest, nodes } = await buildTree(fixtureStream(), { tree: params({ workers, batchSize }) });
    runs.push({ stats: manifest.stats, nodes });
  }
  assert.deepEqual(runs[1].nodes, runs[0].nodes);
  assert.deepEqual(runs[2].nodes, runs[0].nodes);
  // snapshot: хеш на възлите на fixture (сменя се само при промяна на формата/правилата)
  const digest = sha1Hex(runs[0].nodes.map((x) => JSON.stringify(x)).join('\n'));
  assert.equal(digest, FIXTURE_DIGEST);
});
const FIXTURE_DIGEST = '05eb585af1f492283d8d4d3e5ae70f7a518f06d1';

test('writeTree/readTree: round-trip и manifest вътре', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'));
  try {
    const { manifest, nodes } = await buildTree(fixtureStream(), { tree: params(), source: { month: '2026-10' } });
    const path = join(dir, 'tree.jsonl.gz');
    await writeTree(path, manifest, nodes);
    const t = await readTree(path);
    assert.equal(t.manifest.kind, 'lrnoldgame-tree');
    assert.equal(t.manifest.v, 1);
    assert.deepEqual(t.manifest.params, manifest.params);
    assert.equal(t.manifest.paramsHash, paramsHash({ month: '2026-10' }, manifest.params));
    assert.equal(t.nodes.size, nodes.length);
    assert.deepEqual(t.nodes.get(START_KEY), { n: 8, moves: [['e4', 4], ['Nf3', 2], ['c4', 1], ['d4', 1]] });
    const lines = gunzipSync(readFileSync(path)).toString('utf8').trim().split('\n');
    assert.equal(lines.length, nodes.length + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- конфиг и CLI ----

test('config.json: валидни подразбиращи стойности (рейтинг 1200–1800)', () => {
  const cfg = loadConfigFile();
  const p = resolveParams(cfg.tree);
  assert.equal(p.minElo, 1200);
  assert.equal(p.maxElo, 1800);
  assert.match(cfg.source.month, /^\d{4}-\d{2}$/);
  assert.throws(() => resolveParams({ ...p, maxElo: 1000 }), /maxElo/);
  assert.throws(() => resolveParams({ ...p, maxPly: 'x' }), /maxPly/);
});

test('parseCli: флаговете презаписват config.json', () => {
  const c = parseCli(['--max-games', '50_000', '--min-elo', '1400', '--max-elo', '0', '--include-casual', '--month', '2026-09', '--out', 'x.gz']);
  assert.equal(c.tree.maxGames, 50000);
  assert.equal(c.tree.minElo, 1400);
  assert.equal(c.tree.maxElo, 0);
  assert.equal(c.tree.ratedOnly, false);
  assert.equal(c.source.month, '2026-09');
  assert.equal(c.out, 'x.gz');
  assert.equal(c.input, null);
  assert.throws(() => parseCli(['--max-games', 'many']), /max-games/);
  assert.throws(() => parseCli(['--bogus']));
});

function sh(script, timeout = 60000) {
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout });
}

test('CLI от stdin: изход, manifest; pipe с голям вход спира горния процес (SIGPIPE)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-cli-'));
  try {
    const big = join(dir, 'big.pgn');
    const one = readFileSync(FIXTURE, 'utf8');
    writeFileSync(big, one.repeat(3000)); // ~13 MB, много повече от буфера на pipe-а
    const out = join(dir, 'tree.jsonl.gz');
    const r = sh(`cat "${big}" | node "${CLI}" --max-games 25 --workers 2 --quiet --out "${out}"; echo "PS=\${PIPESTATUS[*]}"`);
    assert.match(r.stdout, /PS=141 0/, r.stderr + r.stdout); // cat: SIGPIPE (128+13), node: 0
    const lines = gunzipSync(readFileSync(out)).toString('utf8').trim().split('\n');
    const manifest = JSON.parse(lines[0]);
    assert.equal(manifest.stats.stoppedBy, 'maxGames');
    assert.equal(manifest.stats.gamesAccepted, 25);
    assert.equal(manifest.source.input, 'stdin');
    // Грешен флаг → код 2 и помощ
    const bad = sh(`node "${CLI}" --nope < /dev/null`);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Употреба/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const hasZstd = sh('command -v zstd').status === 0;
test('CLI: zstd -dc | build-tree спира zstd след maxGames', { skip: !hasZstd && 'няма zstd' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-zst-'));
  try {
    const big = join(dir, 'big.pgn');
    writeFileSync(big, readFileSync(FIXTURE, 'utf8').repeat(3000));
    assert.equal(sh(`zstd -q "${big}" -o "${big}.zst"`).status, 0);
    const out = join(dir, 'tree.jsonl.gz');
    const r = sh(`zstd -dc "${big}.zst" | node "${CLI}" --max-games 30 --quiet --out "${out}"; echo "PS=\${PIPESTATUS[*]}"`);
    const [zs, ns] = r.stdout.match(/PS=(\d+) (\d+)/).slice(1).map(Number);
    assert.equal(ns, 0, r.stderr);
    assert.notEqual(zs, 0, 'zstd трябва да спре преди края (SIGPIPE/грешка при запис)');
    assert.ok(existsSync(out));
    const manifest = JSON.parse(gunzipSync(readFileSync(out)).toString('utf8').split('\n')[0]);
    assert.equal(manifest.stats.gamesAccepted, 30);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
