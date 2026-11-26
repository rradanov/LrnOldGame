// Зареждане на данните на курсовете: manifest → catalog → courses (ARCH_T-014 §3.4).
// Без DOM: fetch се подава отвън, затова се тества в Node.
// Файловете идват от кеша на Service Worker-а (всички курсове от manifest, D-023),
// така че след първото зареждане всичко работи офлайн.

export const DATA_BASE = 'data/';

export class DataError extends Error {
  constructor(message, cause) { super(message); this.name = 'DataError'; this.cause = cause; }
}

/** '1. e4 e5 2. Nf3' → ['e4','e5','Nf3'] (форматът в каталога е строг, T-015). */
export function startToSans(start) {
  return String(start || '').split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
}

/** ['e4','e5','Nf3'] → '1.e4 e5 2.Nf3'; from = индекс на първия показан ход. */
export function formatMoves(sans, { from = 0, max = Infinity } = {}) {
  const out = [];
  const end = Math.min(sans.length, from + max);
  for (let i = from; i < end; i++) {
    if (i % 2 === 0) out.push(`${i / 2 + 1}.${sans[i]}`);
    else if (i === from) out.push(`${(i + 1) / 2}...${sans[i]}`);
    else out.push(sans[i]);
  }
  if (end < sans.length) out.push('…');
  return out.join(' ');
}

/** Брой ходове (пълни) в линия от ply полухода: 11 → 6. */
export const fullMoves = (ply) => Math.ceil(ply / 2);

/**
 * Нормализира курс от файла: moves[i] = {san, comment}, startPly, tail.
 * (D-018: `c` е null или масив с дължината на `m`.)
 */
export function normalizeCourse(raw) {
  if (!raw || !Array.isArray(raw.lines)) throw new DataError('Повреден файл на курс');
  const startPly = Array.isArray(raw.start) ? raw.start.length : 0;
  const lines = raw.lines.map((l) => ({
    id: l.id,
    n: l.n,
    sans: l.m.slice(),
    moves: l.m.map((san, i) => ({ san, comment: (Array.isArray(l.c) && l.c[i]) || null })),
    p: l.p,
    end: l.end,
    to: l.to ?? null,
    cp: l.cp ?? null,
    eco: l.eco ?? null,
    name: l.name ?? null,
    tail: Number.isInteger(l.tail) ? l.tail : null,
  })).sort((a, b) => a.n - b.n);
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const l of lines) l.toN = l.to ? byId.get(l.to)?.n ?? null : null;
  return { id: raw.id, side: raw.side, dataVersion: raw.dataVersion, startPly, start: raw.start || [], lines, byId };
}

/**
 * Изглед на каталога за UI: курсовете от каталога + броят линии от manifest.
 * Курс без запис в manifest е `available: false` („не е генериран“, ARCH §3.4).
 */
export function catalogView(catalog, manifest) {
  const inManifest = new Map((manifest?.courses || []).map((c) => [c.id, c]));
  const courses = catalog.courses.map((c, index) => {
    const m = inManifest.get(c.id);
    return {
      id: c.id, side: c.side, group: c.group, name: c.name, eco: c.eco,
      start: startToSans(c.start), default: !!c.default, index,
      available: !!m, lines: m ? m.lines : 0, coverage: m ? m.coverage : null,
    };
  });
  const groups = (catalog.groups || []).map(([id, label]) => ({
    id, label, sides: [...new Set(courses.filter((c) => c.group === id).map((c) => c.side))],
  }));
  return { courses, groups, byId: new Map(courses.map((c) => [c.id, c])) };
}

/** Обобщение на данните за „Настройки → Данни“. */
export function dataSummary(manifest) {
  if (!manifest) return null;
  const courses = manifest.courses || [];
  return {
    dataVersion: manifest.dataVersion,
    built: manifest.built,
    sample: !!manifest.sample,
    courses: courses.length,
    lines: courses.reduce((s, c) => s + (c.lines || 0), 0),
    engine: manifest.engine || null,
    source: manifest.source || null,
    params: manifest.params || {},
  };
}

/**
 * @param {{fetch?: typeof fetch, base?: string}} [opts]
 * base е относителен спрямо index.html (работи и под /LrnOldGame/).
 */
export function createCourseStore({ fetch: f = globalThis.fetch?.bind(globalThis), base = DATA_BASE } = {}) {
  let manifestP = null;
  let catalogP = null;
  const courses = new Map();

  async function getJson(path) {
    let res;
    try {
      // no-cache: без SW браузърът проверява за по-нова версия; със SW отговаря кешът му.
      res = await f(base + path, { cache: 'no-cache' });
    } catch (e) {
      throw new DataError(`Няма връзка и файлът ${path} още не е изтеглен`, e);
    }
    if (!res.ok) throw new DataError(`Файлът ${path} не се зареди (HTTP ${res.status})`);
    try { return await res.json(); } catch (e) { throw new DataError(`Повреден файл ${path}`, e); }
  }

  const memo = (p, reset) => p.catch((e) => { reset(); throw e; });

  const loadManifest = () => (manifestP ||= memo(getJson('manifest.json'), () => { manifestP = null; }));
  const loadCatalog = () => (catalogP ||= memo(getJson('catalog.json'), () => { catalogP = null; }));

  async function loadView() {
    const [manifest, catalog] = await Promise.all([loadManifest(), loadCatalog()]);
    return { manifest, catalog, view: catalogView(catalog, manifest) };
  }

  /** Курс по id (с кеш в паметта). */
  async function loadCourse(id) {
    if (!courses.has(id)) {
      const p = (async () => {
        const manifest = await loadManifest();
        const entry = manifest.courses.find((c) => c.id === id);
        if (!entry) throw new DataError(`Курсът „${id}“ не е генериран`);
        return normalizeCourse(await getJson(entry.file));
      })();
      courses.set(id, p);
      p.catch(() => courses.delete(id));
    }
    return courses.get(id);
  }

  return { loadManifest, loadCatalog, loadView, loadCourse };
}
