// Потребителските данни: избрани курсове, прогрес, настройки, meta, бекъп.
// Над src/db/idb.js; без DOM (localStorage и indexedDB се подават отвън).
import { openDb } from './idb.js';
import { DB_NAME, MIGRATIONS, SCHEMA_VERSION, STORES, lineKey } from './schema.js';
import { applyAttempt, dayKey, newLineRow } from '../data/progress.js';
import { applyReview, createCard, hasCard } from '../srs/review.js';
import { planDataUpdate } from '../data/dataUpdate.js';

const EMPTY_DAY = Object.freeze({ newLearned: 0, reviews: 0, reviewErrors: 0, plays: 0 });

/** Ключ на старите настройки от T-002 (localStorage). */
export const LEGACY_SETTINGS_KEY = 'lrnoldgame.settings.v1';

const BACKUP_APP = 'lrnoldgame';

/** Кой ключ идентифицира ред във всеки store (за проверка на бекъпа). */
const KEY_FIELD = { myCourses: 'courseId', lineProgress: 'key', attempts: null, daily: 'day', settings: 'key', meta: 'key' };

export class BackupError extends Error {
  constructor(message) { super(message); this.name = 'BackupError'; }
}

/**
 * Отваря базата и връща хранилището на потребителя.
 * @param {{indexedDB?: IDBFactory, name?: string, now?: () => number}} [opts]
 */
export async function openUserDb({ indexedDB = globalThis.indexedDB, name = DB_NAME, now = () => Date.now() } = {}) {
  const db = await openDb({ name, migrations: MIGRATIONS, indexedDB });
  return createUserDb(db, now);
}

export function createUserDb(db, now = () => Date.now()) {
  // Записите на настройките идват синхронно от createSettings → редим ги по ред.
  let settingsQueue = Promise.resolve();

  const getMeta = async (key, dflt = undefined) => {
    const row = await db.get('meta', key);
    return row ? row.value : dflt;
  };
  const setMeta = (key, value) => db.put('meta', { key, value });

  async function loadSettings() {
    const rows = await db.getAll('settings');
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /** Записва целия обект на настройките (само различните от подразбирането). */
  function saveSettings(obj) {
    const entries = Object.entries(obj || {});
    settingsQueue = settingsQueue.then(() => db.tx(['settings'], 'readwrite', (t) => {
      const os = t.store('settings');
      os.clear();
      for (const [key, value] of entries) os.put({ key, value });
    })).catch((e) => console.error('Настройките не се записаха:', e));
    return settingsQueue;
  }

  /**
   * Еднократно пренася настройките от localStorage (T-002) в IndexedDB.
   * Ако в IDB вече има настройки, те печелят. Ключът в localStorage се трие
   * едва след успешен запис. Връща броя пренесени стойности (или null, ако
   * миграцията вече е направена).
   */
  async function migrateLegacySettings(ls = globalThis.localStorage, key = LEGACY_SETTINGS_KEY) {
    if (await getMeta('legacySettingsMigrated')) return null;
    let obj = {};
    try {
      const txt = ls?.getItem(key);
      const parsed = txt ? JSON.parse(txt) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed;
    } catch { obj = {}; }
    const existing = await db.count('settings');
    let n = 0;
    await db.tx(['settings', 'meta'], 'readwrite', (t) => {
      if (!existing) {
        for (const [k, value] of Object.entries(obj)) { t.store('settings').put({ key: k, value }); n++; }
      }
      t.store('meta').put({ key: 'legacySettingsMigrated', value: now() });
    });
    try { ls?.removeItem(key); } catch { /* няма значение */ }
    return n;
  }

  /** Всички записи от myCourses (вкл. скритите), подредени по order. */
  async function listMyCourses() {
    const rows = await db.getAll('myCourses');
    return rows.sort((a, b) => a.order - b.order || a.courseId.localeCompare(b.courseId));
  }

  /** Set от id на видимите (избрани) курсове. */
  async function selectedIds() {
    return new Set((await listMyCourses()).filter((r) => !r.hidden).map((r) => r.courseId));
  }

  /**
   * Отметка „уча го“. Махането само скрива курса — прогресът остава,
   * а повторното добавяне го връща (ARCH §4).
   */
  async function setSelected(courseId, on) {
    return db.tx(['myCourses'], 'readwrite', async (t) => {
      const os = t.store('myCourses');
      const all = await new Promise((res, rej) => { const r = os.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const cur = all.find((r) => r.courseId === courseId);
      if (on) {
        if (cur && !cur.hidden) return cur;
        const order = cur ? cur.order : all.reduce((m, r) => Math.max(m, r.order), -1) + 1;
        const row = { courseId, addedAt: cur?.addedAt ?? now(), order, hidden: false };
        os.put(row);
        return row;
      }
      if (!cur || cur.hidden) return cur ?? null;
      const row = { ...cur, hidden: true };
      os.put(row);
      return row;
    });
  }

  /**
   * Първо пускане (D-017): отмята курсовете с default:true, които имат данни.
   * Прави се само веднъж (meta.firstRunDone). Връща true, ако е приложено сега.
   */
  async function applyFirstRun(defaultIds) {
    if (await getMeta('firstRunDone')) return false;
    const t0 = now();
    await db.tx(['myCourses', 'meta'], 'readwrite', (t) => {
      defaultIds.forEach((courseId, order) => {
        t.store('myCourses').put({ courseId, addedAt: t0, order, hidden: false });
      });
      t.store('meta').put({ key: 'firstRunDone', value: t0 });
      t.store('meta').put({ key: 'suggestedBanner', value: true });
    });
    return true;
  }

  /** Редовете на прогреса за курс (линиите без ред са „new“). */
  const progressByCourse = (courseId) => db.getAllByIndex('lineProgress', 'courseId', courseId);

  /** Редът на една линия (или null). */
  const getLine = async (courseId, lineId) => (await db.get('lineProgress', lineKey(courseId, lineId))) ?? null;

  /**
   * Първо отваряне на линията: създава реда (ARCH §4), ако го няма. Връща реда.
   * info = {m, name, eco} (T-012) — пази се в реда, за да се покаже линията, ако изчезне от данните.
   */
  async function touchLine(courseId, lineId, n, info = null) {
    return db.tx(['lineProgress'], 'readwrite', async (t) => {
      const os = t.store('lineProgress');
      const cur = await reqP(os.get(lineKey(courseId, lineId)));
      if (cur) {
        if (info && !cur.info) { const upd = { ...cur, info }; os.put(upd); return upd; }
        return cur;
      }
      const row = newLineRow({ courseId, lineId, n }, now());
      if (info) row.info = info;
      os.put(row);
      return row;
    });
  }

  /**
   * Записва един опит: lineProgress + attempts + daily в една транзакция.
   * mode 'learn': брояч до learnStreak; при „научена“ се създава FSRS картата (първи преглед Good).
   * mode 'review': автоматична оценка Again/Hard/Good и нова дата (src/srs/review.js); след Again —
   * повторения до relearnStreak чисти пробега, които не пипат картата.
   * @param {{courseId, lineId, n, result, learnStreak, dayStartHour?, mode?, srs?: object}} a
   *   srs: {retention, maxIntervalDays, reviewFuzz, relearnStreak, hardAfterSec, reviewErrorsForAgain}
   * @returns {Promise<{row, becameLearned: boolean, attemptId: number, review: object|null}>}
   */
  async function recordAttempt({ courseId, lineId, n, result, learnStreak, dayStartHour = 0, mode = 'learn', srs = {} }) {
    const ts = now();
    const key = lineKey(courseId, lineId);
    const so = { ...srs, dayStartHour };
    return db.tx(['lineProgress', 'attempts', 'daily'], 'readwrite', async (t) => {
      const lp = t.store('lineProgress');
      const cur = await reqP(lp.get(key));
      let row;
      let becameLearned = false;
      let review = null;
      if (mode === 'review' && hasCard(cur)) {
        review = applyReview(cur, result, { now: ts, ...so });
        row = { ...review.row, n };
      } else {
        mode = 'learn';
        ({ row, becameLearned } = applyAttempt(cur, result, { courseId, lineId, n, learnStreak, now: ts }));
        if (becameLearned) row = createCard(row, ts, so);
      }
      lp.put(row);
      const att = {
        lineKey: key, ts, mode, ok: !!result.clean, done: !!result.done, ms: result.ms,
        errors: result.errors, hints: result.hints, plies: result.plies, total: result.total, userMoves: result.userMoves,
        maxMoveMs: result.maxMoveMs ?? null, streakAfter: row.streak,
      };
      if (review) {
        att.relearn = review.relearn;
        if (review.grade) { att.grade = review.gradeName; att.interval = review.interval; att.dueAfter = row.due; }
        att.relearnLeft = review.relearnLeft;
      }
      const attemptId = await reqP(t.store('attempts').add(att));
      const day = dayKey(ts, dayStartHour);
      const dy = t.store('daily');
      const d = { ...EMPTY_DAY, ...((await reqP(dy.get(day))) || {}), day };
      d.plays += 1;
      if (becameLearned) d.newLearned += 1;
      if (review?.grade) {
        d.reviews += 1;
        if (review.gradeName === 'again') d.reviewErrors += 1;
        d.grades = { ...(d.grades || {}), [review.gradeName]: ((d.grades || {})[review.gradeName] || 0) + 1 };
      }
      dy.put(d);
      return { row, becameLearned, attemptId, review };
    });
  }

  /**
   * Миграция (T-010): научените линии без FSRS карта (от 0.3.0 или от стар бекъп) получават карта
   * с първи преглед Good в learnedAt (или lastPlayed/сега). Връща броя създадени карти.
   */
  async function ensureCards(srs = {}) {
    return db.tx(['lineProgress'], 'readwrite', async (t) => {
      const os = t.store('lineProgress');
      const rows = await reqP(os.index('status').getAll('learned'));
      let k = 0;
      for (const r of rows) {
        if (r.fsrs && r.fsrs.reps > 0) continue;
        os.put(createCard(r, r.learnedAt ?? r.lastPlayed ?? now(), srs));
        k++;
      }
      return k;
    });
  }

  /**
   * Обновяване на данните (T-012, D-023): прилага planDataUpdate върху всички редове в една транзакция
   * и записва meta.dataVersion, meta.lineIds (снимка на линиите) и meta.dataUpdate (резюме).
   * courses — всички курсове от новия manifest (нормализирани: {id, lines}).
   * @returns {Promise<{prev: string|null, update: object|null, puts: number}>} update е null, ако версията не е сменена.
   */
  async function applyDataUpdate({ dataVersion, courses }) {
    const ts = now();
    return db.tx(['lineProgress', 'meta'], 'readwrite', async (t) => {
      const meta = t.store('meta');
      const prev = (await reqP(meta.get('dataVersion')))?.value ?? null;
      const prevLineIds = (await reqP(meta.get('lineIds')))?.value ?? null;
      const lp = t.store('lineProgress');
      const rows = await reqP(lp.getAll());
      const plan = planDataUpdate({ courses, rows, prevLineIds, dataVersion, prevDataVersion: prev, now: ts });
      for (const r of plan.puts) lp.put(r);
      // Снимката пази и курсовете, които сега липсват в manifest (за да се сравнят, ако се върнат).
      meta.put({ key: 'lineIds', value: { ...(prevLineIds || {}), ...plan.lineIds } });
      meta.put({ key: 'dataVersion', value: dataVersion });
      let update = null;
      if (prev && prev !== dataVersion) {
        update = { from: prev, to: dataVersion, at: ts, courses: plan.courses, seen: false };
        meta.put({ key: 'dataUpdate', value: update });
      }
      return { prev, update, puts: plan.puts.length };
    });
  }

  /** Линиите „вече не са в курса“ (orphan) за курс. */
  const orphanRows = async (courseId) => (await progressByCourse(courseId)).filter((r) => r.status === 'orphan');

  /** Научените линии (с или без карта). */
  const learnedRows = () => db.getAllByIndex('lineProgress', 'status', 'learned');

  /** Записът в daily за деня на ts (или празен). */
  async function dayStats(ts = now(), dayStartHour = 0) {
    const day = dayKey(ts, dayStartHour);
    return { ...EMPTY_DAY, ...((await db.get('daily', day)) || {}), day };
  }

  /** Опитите за линия (най-новите последни). */
  const attemptsFor = (courseId, lineId) => db.getAllByIndex('attempts', 'lineKey', lineKey(courseId, lineId));

  /** Целият бекъп като обикновен обект (D-010). */
  async function exportBackup({ appVersion = '', dataVersion = null, withAttempts = true, touch = true } = {}) {
    const stores = {};
    await db.tx(STORES, 'readonly', async (t) => {
      await Promise.all(STORES.map((s) => new Promise((res, rej) => {
        if (s === 'attempts' && !withAttempts) { stores[s] = []; return res(); }
        const r = t.store(s).getAll();
        r.onsuccess = () => { stores[s] = r.result; res(); };
        r.onerror = () => rej(r.error);
      })));
    });
    const exportedAt = now();
    if (touch) await setMeta('lastBackup', exportedAt);
    return {
      app: BACKUP_APP, kind: 'backup', schemaVersion: SCHEMA_VERSION, appVersion, dataVersion,
      exportedAt: new Date(exportedAt).toISOString(), stores,
    };
  }

  /**
   * Заменя всички данни с тези от бекъпа (една транзакция — или всичко, или нищо).
   * Хвърля BackupError при чужд файл, по-нова schemaVersion или повреден формат.
   */
  async function importBackup(obj) {
    const counts = checkBackup(obj);
    await db.tx(STORES, 'readwrite', (t) => {
      for (const s of STORES) {
        const os = t.store(s);
        os.clear();
        for (const row of obj.stores[s] || []) os.put(row);
      }
      // Внесеният бекъп не трябва да пуска наново ★ и миграцията от localStorage.
      t.store('meta').put({ key: 'firstRunDone', value: now() });
      t.store('meta').put({ key: 'legacySettingsMigrated', value: now() });
    });
    return counts;
  }

  return {
    db, getMeta, setMeta, loadSettings, saveSettings, migrateLegacySettings,
    listMyCourses, selectedIds, setSelected, applyFirstRun, progressByCourse,
    getLine, touchLine, recordAttempt, attemptsFor, ensureCards, learnedRows, dayStats,
    applyDataUpdate, orphanRows,
    exportBackup, importBackup,
    /** Изчаква чакащите записи на настройки (за тестове). */
    flush: () => settingsQueue,
    close: () => db.close(),
  };
}

function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** Проверява формата на бекъп; връща {store: брой редове}. */
export function checkBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new BackupError('Файлът не е бекъп на LrnOldGame.');
  if (obj.app !== BACKUP_APP || obj.kind !== 'backup') throw new BackupError('Файлът не е бекъп на LrnOldGame.');
  const v = obj.schemaVersion;
  if (!Number.isInteger(v) || v < 1) throw new BackupError('Бекъпът няма валидна версия на схемата (schemaVersion).');
  if (v > SCHEMA_VERSION) {
    throw new BackupError(`Бекъпът е от по-нова версия на приложението (схема ${v}, тук ${SCHEMA_VERSION}). Обнови приложението.`);
  }
  if (!obj.stores || typeof obj.stores !== 'object') throw new BackupError('Бекъпът няма данни (stores).');
  const counts = {};
  for (const [s, rows] of Object.entries(obj.stores)) {
    if (!STORES.includes(s)) throw new BackupError(`Непознат раздел в бекъпа: ${s}.`);
    if (!Array.isArray(rows)) throw new BackupError(`Повреден раздел в бекъпа: ${s}.`);
    const kf = KEY_FIELD[s];
    for (const r of rows) {
      if (!r || typeof r !== 'object' || (kf && (r[kf] === undefined || r[kf] === null))) {
        throw new BackupError(`Повреден запис в раздел ${s}.`);
      }
    }
    counts[s] = rows.length;
  }
  return counts;
}
