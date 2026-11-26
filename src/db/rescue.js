// T013-D7: повредена или недостъпна база — спасяване на каквото може и нулиране. Без DOM.
// Ползва се само когато openUserDb() е паднал (непозната по-нова версия, липсващи store-ове и др.).
import { DB_NAME, SCHEMA_VERSION, STORES } from './schema.js';

/**
 * Отваря базата в текущата ѝ версия (без миграции) и чете store-овете, които познаваме и които съществуват.
 * Връща бекъп в обичайния формат (D-010) с поле `rescue`, или null, ако няма какво да се спаси.
 * schemaVersion е версията на самата база: бекъп от по-нова версия няма да се внесе в по-старо приложение
 * (checkBackup) — така не се смесват непознати формати.
 * @param {{indexedDB?: IDBFactory, name?: string, appVersion?: string, now?: () => number}} [o]
 */
export async function rescueDump({ indexedDB = globalThis.indexedDB, name = DB_NAME, appVersion = '', now = () => Date.now() } = {}) {
  if (!indexedDB) return null;
  const db = await new Promise((resolve, reject) => {
    let created = false;
    const r = indexedDB.open(name);
    r.onupgradeneeded = () => { created = true; r.transaction.abort(); }; // базата я няма — не я създаваме
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => (created ? resolve(null) : reject(r.error));
    r.onblocked = () => reject(new Error('Базата е заета от друг раздел — затвори го и опитай пак'));
  }).catch(() => null);
  if (!db) return null;
  try {
    const names = [...db.objectStoreNames];
    const stores = {};
    let rows = 0;
    for (const s of STORES) {
      if (!names.includes(s)) continue;
      try {
        stores[s] = await new Promise((resolve, reject) => {
          const q = db.transaction([s], 'readonly').objectStore(s).getAll();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        });
        rows += stores[s].length;
      } catch { /* този store не се чете — пропускаме го */ }
    }
    return {
      app: 'lrnoldgame', kind: 'backup',
      schemaVersion: Math.max(1, Number.isInteger(db.version) ? db.version : SCHEMA_VERSION),
      appVersion, dataVersion: null, exportedAt: new Date(now()).toISOString(),
      rescue: { dbVersion: db.version, storeNames: names, rows },
      stores,
    };
  } finally {
    db.close();
  }
}

/** Изтрива базата (нулиране). Отхвърля се, ако друг раздел я държи отворена. */
export function resetDb({ indexedDB = globalThis.indexedDB, name = DB_NAME } = {}) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('IndexedDB не е достъпен')); return; }
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Базата е заета от друг раздел — затвори го и опитай пак'));
  });
}
