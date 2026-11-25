// Кеш на оценките (ARCH_T-014 §1.3, D-024). Файл gzip JSON Lines:
//   ред 1: {"v":1,"kind":"lrnoldgame-evals","prefix":"stockfish-19|n500000|m3|h64","entries":N}
//   ред 2…: ["<prefix>|<EPD>[|sm:<uci>]", [[uci, san, cp|null, mate|null], …]]  (по multipv)
// Ключът = версия на двигателя + параметри на търсенето + EPD. Търсенето е детерминирано,
// затова кешът само ускорява и не променя резултата. Редовете са сортирани по ключ;
// записът е атомарен (временен файл + rename). T-017 пази папката в actions/cache.
import { createReadStream, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createGunzip, gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';

export const CACHE_KIND = 'lrnoldgame-evals';

/** Префикс на ключа от параметрите на двигателя. */
export function cachePrefix(engine) {
  const id = `${engine.name}-${engine.version}`.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
  return `${id}|n${engine.nodes}|m${engine.multiPV}|h${engine.hashMb}`;
}

/** Име на файла за дадения префикс, напр. evals-stockfish-19-n500000-m3-h64.jsonl.gz. */
export function cacheFileName(prefix) {
  return `evals-${prefix.replace(/\|/g, '-')}.jsonl.gz`;
}

export class EvalCache {
  /** dir: папка (null = само в паметта); flushEvery: запис на диска на всеки N нови записа. */
  constructor(dir, prefix, { flushEvery = 0 } = {}) {
    this.prefix = prefix;
    this.flushEvery = flushEvery;
    this.path = dir ? join(dir, cacheFileName(prefix)) : null;
    this.map = new Map();
    this.loaded = 0;
    this.added = 0;
    this.dirty = false;
  }

  key(epd, searchmove = null) {
    return `${this.prefix}|${epd}${searchmove ? `|sm:${searchmove}` : ''}`;
  }

  /** Чете файла, ако го има. Записи с чужд префикс се пропускат. */
  async load() {
    if (!this.path || !existsSync(this.path)) return this;
    const rl = createInterface({ input: createReadStream(this.path).pipe(createGunzip()), crlfDelay: Infinity });
    let header = null;
    const pre = `${this.prefix}|`;
    for await (const line of rl) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (header === null) {
        header = row;
        if (header.kind !== CACHE_KIND || header.v !== 1) throw new Error(`${this.path}: не е кеш ${CACHE_KIND} v1`);
        continue;
      }
      if (typeof row[0] === 'string' && row[0].startsWith(pre)) this.map.set(row[0], row[1]);
    }
    this.loaded = this.map.size;
    return this;
  }

  get(k) { return this.map.get(k); }

  set(k, v) {
    this.map.set(k, v);
    this.added++;
    this.dirty = true;
    if (this.flushEvery && this.added % this.flushEvery === 0) this.save();
  }

  /** Записва целия кеш (сортиран → детерминиран файл). */
  save() {
    if (!this.path || !this.dirty) return false;
    mkdirSync(dirname(this.path), { recursive: true });
    const keys = [...this.map.keys()].sort();
    const parts = [JSON.stringify({ v: 1, kind: CACHE_KIND, prefix: this.prefix, entries: keys.length })];
    for (const k of keys) parts.push(JSON.stringify([k, this.map.get(k)]));
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, gzipSync(`${parts.join('\n')}\n`, { level: 9 }));
    renameSync(tmp, this.path);
    this.dirty = false;
    return true;
  }
}
