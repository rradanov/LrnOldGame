// Пул от W процеса на двигателя × 1 нишка (D-019). Опашка от задачи; свободният
// процес взема следващата. Процесите се стартират мързеливо — при пълен кеш
// двигателят изобщо не се пуска. При таймаут или срив процесът се рестартира и
// задачата се опитва отново (до `retries` пъти). close() затваря всички чисто.
import { UciEngine, UciError } from './uci.js';

export class EnginePool {
  /**
   * opts: {path, args, env, workers, threads, hashMb, multiPV, nodes, timeoutMs, retries,
   *        expectId (низ — `id name` трябва да започва с него), log}
   */
  constructor(opts) {
    this.opts = { workers: 1, retries: 2, threads: 1, ...opts };
    this.slots = []; // {engine|null, busy, starting: Promise|null}
    this.queue = [];
    this.closed = false;
    this.stats = { analyses: 0, restarts: 0, timeouts: 0, crashes: 0, nodes: 0, ms: 0, started: 0 };
    this.idName = null;
    for (let i = 0; i < this.opts.workers; i++) this.slots.push({ engine: null, busy: false });
  }

  /** Изчислява FEN; връща резултата на UciEngine.analyse. */
  analyse(fen, { searchmoves = null } = {}) {
    if (this.closed) return Promise.reject(new Error('пулът е затворен'));
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, searchmoves, resolve, reject, tries: 0 });
      this._pump();
    });
  }

  _pump() {
    for (const slot of this.slots) {
      if (!this.queue.length) return;
      if (slot.busy) continue;
      const job = this.queue.shift();
      slot.busy = true;
      this._run(slot, job).finally(() => { slot.busy = false; this._pump(); });
    }
  }

  async _engine(slot) {
    if (slot.engine && !slot.engine.dead) return slot.engine;
    const o = this.opts;
    const e = new UciEngine({
      path: o.path, args: o.args, env: o.env, threads: o.threads, hashMb: o.hashMb,
      multiPV: o.multiPV, timeoutMs: o.timeoutMs,
    });
    if (slot.engine) this.stats.restarts++;
    slot.engine = e;
    await e.start();
    this.stats.started++;
    if (o.expectId && !(e.idName || '').startsWith(o.expectId)) {
      await e.close();
      throw new UciError('protocol', `двигателят е „${e.idName}“, а се очаква „${o.expectId}…“ (engine.name/version в конфига)`);
    }
    this.idName = e.idName;
    return e;
  }

  async _run(slot, job) {
    for (;;) {
      job.tries++;
      const t0 = Date.now();
      try {
        const e = await this._engine(slot);
        const r = await e.analyse(job.fen, { nodes: this.opts.nodes, multiPV: this.opts.multiPV, searchmoves: job.searchmoves });
        this.stats.analyses++;
        this.stats.nodes += r.nodes;
        this.stats.ms += Date.now() - t0;
        job.resolve(r);
        return;
      } catch (err) {
        if (err instanceof UciError && err.code === 'protocol') { job.reject(err); return; }
        if (err instanceof UciError && err.code === 'timeout') this.stats.timeouts++;
        else this.stats.crashes++;
        if (slot.engine) slot.engine.kill(`рестарт след грешка: ${err.message}`);
        const msg = `двигател: ${err.message} (FEN ${job.fen}, опит ${job.tries}/${this.opts.retries + 1})`;
        this.opts.log?.(msg);
        if (this.closed || job.tries > this.opts.retries || (err instanceof UciError && err.code === 'spawn')) {
          job.reject(new Error(msg));
          return;
        }
      }
    }
  }

  /** Средна скорост на един процес (възли/с, вкл. ucinewgame/isready); 0, ако няма изчисления. */
  nps() {
    return this.stats.ms > 0 ? Math.round((this.stats.nodes / this.stats.ms) * 1000) : 0;
  }

  async close() {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.reject(new Error('пулът е затворен'));
    await Promise.all(this.slots.map((s) => s.engine?.close()));
  }
}
