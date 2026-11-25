// Формат на междинното дърво (T-004, D-022: не се разпространява в приложението).
//
// `tree.jsonl.gz` — gzip на JSON Lines:
//   ред 1: manifest {"v":1,"kind":"lrnoldgame-tree", params, source, stats, run, …}
//   ред 2…: ["<EPD>", n, ["e4", 512, "d4", 301, …]]
// EPD е ключът от src/chess/position.js (key()); n — партии, стигнали до
// позицията (до maxPly); ходовете са канонични SAN с брой партии, сортирани по
// брой ↓ и SAN ↑. n ≥ сумата на ходовете (останалото: редки ходове под
// minGamesPerMove и партии, свършили в позицията). Редовете са сортирани по EPD.
// JSON Lines, а не един JSON: пише се и се чете поточно, без низ от стотици MB.
import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const TREE_KIND = 'lrnoldgame-tree';
export const TREE_VERSION = 1;

/**
 * Записва дървото. `nodes` е итерируем от [epd, n, [san, c, …]].
 * @returns {Promise<{bytes: number}>}
 */
export async function writeTree(path, manifest, nodes) {
  function* lines() {
    yield JSON.stringify({ v: TREE_VERSION, kind: TREE_KIND, ...manifest }) + '\n';
    let buf = '';
    for (const node of nodes) {
      buf += JSON.stringify(node) + '\n';
      if (buf.length > 1 << 16) { yield buf; buf = ''; }
    }
    if (buf) yield buf;
  }
  const out = createWriteStream(path);
  await pipeline(Readable.from(lines()), createGzip({ level: 9 }), out);
  return { bytes: out.bytesWritten };
}

/**
 * Чете дървото: {manifest, nodes: Map<epd, {n, moves: [[san, c], …]}>}.
 * Хвърля, ако файлът не е дърво от този формат.
 */
export async function readTree(path) {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  let manifest = null;
  const nodes = new Map();
  for await (const line of rl) {
    if (!line) continue;
    if (manifest === null) {
      manifest = JSON.parse(line);
      if (manifest.kind !== TREE_KIND || manifest.v !== TREE_VERSION) {
        throw new Error(`${path}: не е дърво ${TREE_KIND} v${TREE_VERSION}`);
      }
      continue;
    }
    const [epd, n, flat] = JSON.parse(line);
    const moves = [];
    for (let i = 0; i < flat.length; i += 2) moves.push([flat[i], flat[i + 1]]);
    nodes.set(epd, { n, moves });
  }
  if (manifest === null) throw new Error(`${path}: празен файл`);
  return { manifest, nodes };
}
