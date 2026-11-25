// Строене на дървото (T-004): поток PGN → филтри → worker_threads → сливане.
import { Worker } from 'node:worker_threads';
import { sha1Hex } from '../../src/chess/position.js';
import { readGames } from './pgn-stream.js';
import { rejectReason } from './filter.js';
import { effectiveWorkers } from './config.js';

const WORKER_URL = new URL('./worker.js', import.meta.url);
const MAX_INFLIGHT = 4; // партиди на нишка, преди четенето да спре (backpressure)

/** Ключ „EPD“ (3 интервала) или ребро „EPD SAN“ (4 интервала) → индекс на 4-тия интервал или −1. */
function sanSpace(k) {
  let i = -1;
  for (let n = 0; n < 4; n++) {
    i = k.indexOf(' ', i + 1);
    if (i === -1) return -1;
  }
  return i;
}

/** Стабилен JSON (сортирани ключове) за хеш на параметрите. */
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Хеш на параметрите, от които зависи дървото (за ключа на кеша в T-017). */
export function paramsHash(source, params) {
  return sha1Hex(stableJson({ month: source.month ?? null, tree: params })).slice(0, 12);
}

class Pool {
  constructor(n, workerData) {
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(WORKER_URL, { workerData });
      const st = { w, inflight: 0, waiters: [], chunks: [], done: null, error: null };
      w.on('message', (m) => {
        if (m.type === 'ack') {
          st.inflight--;
          this.counted += m.counted; this.illegal += m.illegal; this.empty += m.empty;
          const r = st.waiters.shift();
          if (r) r();
        } else if (m.type === 'chunk') st.chunks.push(m.data);
        else if (m.type === 'done') st.done(m.stats);
      });
      w.on('error', (e) => { st.error = e; this.failed = e; for (const r of st.waiters.splice(0)) r(); });
      this.workers.push(st);
    }
    this.counted = 0; this.illegal = 0; this.empty = 0; this.failed = null;
    this.next = 0;
  }

  async send(games) {
    const st = this.workers[this.next];
    this.next = (this.next + 1) % this.workers.length;
    while (st.inflight >= MAX_INFLIGHT && !this.failed) await new Promise((r) => st.waiters.push(r));
    if (this.failed) throw this.failed;
    st.inflight++;
    st.w.postMessage({ type: 'batch', games });
  }

  /** Изчаква всички партиди и събира броячите: [{chunks, stats}]. */
  async finish() {
    const out = await Promise.all(this.workers.map((st) => new Promise((resolve, reject) => {
      if (st.error) { reject(st.error); return; }
      st.done = (stats) => resolve({ chunks: st.chunks, stats });
      st.w.once('error', reject);
      st.w.postMessage({ type: 'finish' });
    })));
    return out;
  }

  async close() {
    await Promise.all(this.workers.map((st) => st.w.terminate()));
  }
}

/**
 * Строи дървото.
 * @param {AsyncIterable<Buffer|string>} input PGN поток
 * @param {{tree: object, source?: object, inputName?: string, onProgress?: Function, progressMs?: number}} opts
 * @returns {Promise<{manifest: object, nodes: Array}>}
 */
export async function buildTree(input, { tree: params, source = {}, inputName = 'stdin', onProgress = null, progressMs = 5000 }) {
  const t0 = process.hrtime.bigint();
  const nWorkers = effectiveWorkers(params);
  const pool = new Pool(nWorkers, { maxPly: params.maxPly, window: params.pruneEveryGames });
  const rejected = {};
  let read = 0;
  let accepted = 0;
  let stoppedBy = 'eof';
  let batch = [];
  let lastReport = Date.now();
  const elapsed = () => Number(process.hrtime.bigint() - t0) / 1e9;
  const progress = (phase) => onProgress?.({ phase, read, accepted, counted: pool.counted, seconds: elapsed(), rssMb: process.memoryUsage().rss / 2 ** 20 });

  try {
    if (params.maxGames > 0) {
      for await (const game of readGames(input)) {
        read++;
        const why = rejectReason(game, params);
        if (why) { rejected[why] = (rejected[why] ?? 0) + 1; continue; }
        accepted++;
        batch.push(game.moves);
        if (batch.length >= params.batchSize) { await pool.send(batch); batch = []; }
        if (onProgress && Date.now() - lastReport >= progressMs) { lastReport = Date.now(); progress('read'); }
        if (accepted >= params.maxGames) { stoppedBy = 'maxGames'; break; } // затваря входа (D-014)
      }
    }
    if (batch.length) await pool.send(batch);
    const readSec = elapsed();
    progress('merge');
    const parts = await pool.finish();

    // Сливане на броячите на нишките.
    const merged = new Map();
    const lossy = { window: params.pruneEveryGames, maxUndercount: 0, pruned: 0, peakEntries: 0 };
    for (const { chunks, stats } of parts) {
      lossy.maxUndercount += stats.maxUndercount;
      lossy.pruned += stats.pruned;
      lossy.peakEntries += stats.peakEntries;
      for (const data of chunks) {
        for (const line of data.split('\n')) {
          const tab = line.lastIndexOf('\t');
          const k = line.slice(0, tab);
          merged.set(k, (merged.get(k) ?? 0) + Number(line.slice(tab + 1)));
        }
      }
    }
    await pool.close();

    // Групиране по позиция, подрязване (minGames, minGamesPerMove).
    const keys = [...merged.keys()].sort();
    const nodes = [];
    let moves = 0;
    let i = 0;
    while (i < keys.length) {
      const sp0 = sanSpace(keys[i]);
      const epd = sp0 === -1 ? keys[i] : keys[i].slice(0, sp0);
      let n = 0;
      let sum = 0;
      const list = [];
      for (; i < keys.length; i++) {
        const k = keys[i];
        const sp = sanSpace(k);
        const e = sp === -1 ? k : k.slice(0, sp);
        if (e !== epd) break;
        const c = merged.get(k);
        if (sp === -1) n += c;
        else {
          sum += c;
          if (c >= params.minGamesPerMove) list.push([k.slice(sp + 1), c]);
        }
      }
      n = Math.max(n, sum);
      if (n < params.minGames) continue;
      list.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const flat = [];
      for (const [s, c] of list) flat.push(s, c);
      moves += list.length;
      nodes.push([epd, n, flat]);
    }

    const seconds = elapsed();
    const manifest = {
      tool: 'tools/build-tree',
      source: { month: source.month ?? null, url: source.urlTemplate && source.month ? source.urlTemplate.replace('{month}', source.month) : null, input: inputName },
      params: { ...params },
      paramsHash: paramsHash(source, params),
      stats: {
        gamesRead: read,
        gamesAccepted: accepted,
        gamesCounted: pool.counted,
        gamesIllegal: pool.illegal,
        gamesEmpty: pool.empty,
        rejected: Object.fromEntries(Object.entries(rejected).sort()),
        stoppedBy,
        entriesMerged: merged.size,
        nodes: nodes.length,
        moves,
        lossy,
      },
      // Зависи от машината и часа — не влиза в детерминираното сравнение.
      run: {
        built: new Date().toISOString(),
        workers: nWorkers,
        node: process.version,
        readSeconds: round(readSec),
        seconds: round(seconds),
        gamesPerSec: Math.round(accepted / Math.max(seconds, 1e-9)), // приети партии / цялото време (четене+броене+сливане)
        readPerSec: Math.round(read / Math.max(readSec, 1e-9)),
        peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
      },
    };
    return { manifest, nodes };
  } catch (e) {
    await pool.close();
    throw e;
  }
}

function round(x) { return Math.round(x * 100) / 100; }
