// Потребителските данни: избрани курсове, прогрес, настройки, meta, бекъп.
// Над src/db/idb.js; без DOM (localStorage и indexedDB се подават отвън).
import { openDb } from './idb.js';
import { DB_NAME, MIGRATIONS, SCHEMA_VERSION, STORES, lineKey } from './schema.js';
import { applyAttempt, dayKey, newLineRow } from '../data/progress.js';

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

  /** Първо отваряне на линията: създава реда (ARCH §4), ако го няма. Връща реда. */
  async function touchLine(courseId, lineId, n) {
    return db.tx(['lineProgress'], 'readwrite', async (t) => {
      const os = t.store('lineProgress');
      const cur = await reqP(os.get(lineKey(courseId, lineId)));
      if (cur) return cur;
      const row = newLineRow({ courseId, lineId, n }, now());
      os.put(row);
      return row;
    });
  }

  /**
   * Записва един опит в режим learn: lineProgress + attempts + daily в една транзакция.
   * @param {{courseId, lineId, n, result, learnStreak, dayStartHour?, mode?}} a
   * @returns {Promise<{row: object, becameLearned: boolean, attemptId: number}>}
   */
  async function recordAttempt({ courseId, lineId, n, result, learnStreak, dayStartHour = 0, mode = 'learn' }) {
    const ts = now();
    const key = lineKey(courseId, lineId);
    return db.tx(['lineProgress', 'attempts', 'daily'], 'readwrite', async (t) => {
      const lp = t.store('lineProgress');
      const cur = await reqP(lp.get(key));
      const { row, becameLearned } = applyAttempt(cur, result, { courseId, lineId, n, learnStreak, now: ts });
      lp.put(row);
      const attemptId = await reqP(t.store('attempts').add({
        lineKey: key, ts, mode, ok: !!result.clean, done: !!result.done, ms: result.ms,
        errors: result.errors, hints: result.hints, plies: result.plies, total: result.total, userMoves: result.userMoves,
        streakAfter: row.streak,
      }));
      const day = dayKey(ts, dayStartHour);
      const dy = t.store('daily');
      const d = (await reqP(dy.get(day))) || { day, newLearned: 0, reviews: 0, reviewErrors: 0, plays: 0 };
      d.plays += 1;
      if (becameLearned) d.newLearned += 1;
      dy.put(d);
      return { row, becameLearned, attemptId };
    });
  }

  /** Опитите за линия (най-новите последни). */
  const attemptsFor = (courseId, lineId) => db.getAllByIndex('attempts', 'lineKey', lineKey(courseId, lineId));

  /** Целият бекъп като обикновен обект (D-010). */
  async function exportBackup({ appVersion = '', dataVersion = null, withAttempts = true } = {}) {
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
    await setMeta('lastBackup', exportedAt);
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
    getLine, touchLine, recordAttempt, attemptsFor,
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
