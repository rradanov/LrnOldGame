// UCI клиент за Stockfish (T-016, ARCH_T-014 §1.1, D-019).
// Един дъщерен процес = един двигател с Threads=1. Всяко изчисление:
//   ucinewgame → isready → position fen <FEN> → go nodes N [searchmoves …]
// и чете `info … multipv k … score cp|mate … pv …` до `bestmove`.
// ucinewgame преди всяка позиция + фиксиран брой възли + 1 нишка → детерминиран резултат,
// който не зависи от реда на обработка (затова кешът е коректен).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class UciError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UciError';
    this.code = code; // 'timeout' | 'exit' | 'spawn' | 'protocol'
  }
}

/**
 * Разбира един `info` ред. Връща {multipv, depth, nodes, nps, cp|null, mate|null, bound, pv: [uci]}
 * или null, ако редът няма оценка и pv (напр. `info string …`, `info currmove …`).
 */
export function parseInfo(line) {
  if (!line.startsWith('info ')) return null;
  const t = line.split(/\s+/);
  const out = { multipv: 1, depth: 0, nodes: 0, nps: 0, cp: null, mate: null, bound: null, pv: [] };
  let hasScore = false;
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'string': return null;
      case 'multipv': out.multipv = Number(t[++i]); break;
      case 'depth': out.depth = Number(t[++i]); break;
      case 'nodes': out.nodes = Number(t[++i]); break;
      case 'nps': out.nps = Number(t[++i]); break;
      case 'score':
        hasScore = true;
        if (t[i + 1] === 'cp') out.cp = Number(t[i + 2]);
        else if (t[i + 1] === 'mate') out.mate = Number(t[i + 2]);
        i += 2;
        if (t[i + 1] === 'upperbound' || t[i + 1] === 'lowerbound') out.bound = t[++i];
        break;
      case 'pv': out.pv = t.slice(i + 1); i = t.length; break;
      default: break;
    }
  }
  return hasScore && out.pv.length ? out : null;
}

/**
 * Един процес на двигателя. Методи: start(), analyse(fen, opts), close().
 * opts на конструктора: {path, args, threads, hashMb, multiPV, timeoutMs, env, log}.
 */
export class UciEngine {
  constructor(opts) {
    this.opts = { args: [], threads: 1, hashMb: 64, multiPV: 3, timeoutMs: 60_000, startTimeoutMs: 30_000, ...opts };
    this.proc = null;
    this.idName = null;
    this.dead = true;
    this._waiters = []; // [{match(line) → bool, resolve, reject}]
    this._onLine = null;
    this._multiPV = null;
    this._exitReason = null;
  }

  _send(cmd) {
    if (this.dead) throw new UciError('exit', 'двигателят не работи');
    this.proc.stdin.write(`${cmd}\n`);
  }

  /** Чака ред, за който match(line) е true; междувременно подава редовете на onLine. */
  _wait(match, timeoutMs, what, onLine = null) {
    return new Promise((resolve, reject) => {
      const w = { match, resolve, reject, onLine };
      w.timer = setTimeout(() => {
        this._waiters = this._waiters.filter((x) => x !== w);
        reject(new UciError('timeout', `двигателят не отговори за ${timeoutMs} ms (${what})`));
      }, timeoutMs);
      this._waiters.push(w);
    });
  }

  _line(line) {
    for (const w of [...this._waiters]) {
      if (w.onLine) w.onLine(line);
      if (w.match(line)) {
        clearTimeout(w.timer);
        this._waiters = this._waiters.filter((x) => x !== w);
        w.resolve(line);
      }
    }
  }

  async start() {
    const { path, args, env } = this.opts;
    this._exitReason = null;
    const proc = spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
    this.proc = proc;
    this.dead = false;
    proc.stdin.on('error', () => {}); // EPIPE при срив — обработва се в 'exit'
    proc.stderr.on('data', () => {});
    const failAll = (err) => {
      this.dead = true;
      for (const w of this._waiters.splice(0)) { clearTimeout(w.timer); w.reject(err); }
    };
    proc.on('error', (e) => failAll(new UciError('spawn', `не може да се стартира „${path}“: ${e.message}`)));
    proc.on('exit', (code, sig) => failAll(new UciError('exit', this._exitReason
      ?? `двигателят спря неочаквано (код ${code}${sig ? `, сигнал ${sig}` : ''})`)));
    createInterface({ input: proc.stdout, crlfDelay: Infinity }).on('line', (l) => this._line(l.trim()));

    const t = this.opts.startTimeoutMs;
    const onId = (l) => { if (l.startsWith('id name ')) this.idName = l.slice(8).trim(); };
    const ok = this._wait((l) => l === 'uciok', t, 'uci', onId);
    this._send('uci');
    await ok;
    this._send(`setoption name Threads value ${this.opts.threads}`);
    this._send(`setoption name Hash value ${this.opts.hashMb}`);
    this._setMultiPV(this.opts.multiPV);
    await this._ready(t);
    return this;
  }

  _setMultiPV(k) {
    if (this._multiPV === k) return;
    this._send(`setoption name MultiPV value ${k}`);
    this._multiPV = k;
  }

  async _ready(timeoutMs) {
    const p = this._wait((l) => l === 'readyok', timeoutMs, 'isready');
    this._send('isready');
    await p;
  }

  /**
   * Изчислява позицията. opts: {nodes, multiPV, searchmoves: [uci]}.
   * Връща {lines: [{uci, cp|null, mate|null, pv}] по multipv, bestmove, nodes, nps, depth}.
   * Оценките са от гледна точка на страната на ход (UCI).
   */
  async analyse(fen, { nodes, multiPV = this.opts.multiPV, searchmoves = null }) {
    const timeoutMs = this.opts.timeoutMs;
    this._send('ucinewgame');
    this._setMultiPV(multiPV);
    await this._ready(timeoutMs);
    const byPv = new Map();
    const onLine = (l) => {
      const info = parseInfo(l);
      if (info) byPv.set(info.multipv, info);
    };
    const done = this._wait((l) => l.startsWith('bestmove'), timeoutMs, `go nodes ${nodes}`, onLine);
    this._send(`position fen ${fen}`);
    this._send(`go nodes ${nodes}${searchmoves && searchmoves.length ? ` searchmoves ${searchmoves.join(' ')}` : ''}`);
    const bm = await done;
    const best = bm.split(/\s+/)[1];
    const lines = [...byPv.keys()].sort((a, b) => a - b).map((k) => {
      const i = byPv.get(k);
      return { uci: i.pv[0], cp: i.cp, mate: i.mate, pv: i.pv };
    });
    const last = byPv.get(1);
    return {
      lines, bestmove: best === '(none)' ? null : best,
      nodes: last?.nodes ?? 0, nps: last?.nps ?? 0, depth: last?.depth ?? 0,
    };
  }

  /** Убива процеса веднага (при таймаут). */
  kill(reason = 'убит') {
    if (!this.proc) return;
    this._exitReason = reason;
    try { this.proc.kill('SIGKILL'); } catch { /* вече е спрял */ }
  }

  /** Чисто затваряне: quit, после SIGKILL след graceMs. */
  async close(graceMs = 2000) {
    const proc = this.proc;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise((r) => proc.once('exit', r));
    this._exitReason = 'затворен';
    try { proc.stdin.write('quit\n'); proc.stdin.end(); } catch { /* */ }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, graceMs);
    await exited;
    clearTimeout(timer);
  }
}
