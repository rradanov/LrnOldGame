// Малък promise слой над IndexedDB (без външни библиотеки, D-010).
// Без DOM: indexedDB се подава отвън, затова се тества в Node с fake-indexeddb.

/** IDBRequest → Promise. */
export function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Promise, който се изпълнява при complete на транзакцията. */
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакцията е прекъсната'));
  });
}

/**
 * Отваря база и пуска миграциите от oldVersion+1 до version.
 * migrations: {1: (db, tx) => {...}, 2: ...}; version = най-големият ключ.
 * @returns {Promise<Db>}
 */
export async function openDb({ name, migrations, indexedDB = globalThis.indexedDB }) {
  if (!indexedDB) throw new Error('IndexedDB не е достъпен');
  const version = Math.max(...Object.keys(migrations).map(Number));
  for (let v = 1; v <= version; v++) {
    if (typeof migrations[v] !== 'function') throw new Error(`Липсва миграция към версия ${v}`);
  }
  const open = indexedDB.open(name, version);
  open.onupgradeneeded = (ev) => {
    const db = open.result;
    const tx = open.transaction;
    for (let v = (ev.oldVersion || 0) + 1; v <= version; v++) {
      migrations[v](db, tx);
    }
  };
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Базата е заета от друг раздел — затвори го и опитай пак'));
  });
  // Друг раздел с по-нова версия иска да мигрира: освобождаваме базата.
  db.onversionchange = () => db.close();
  return wrap(db, version);
}

/**
 * @typedef {Object} Db
 * @property {number} version
 * @property {string[]} stores
 * @property {(store: string, key: any) => Promise<any>} get
 * @property {(store: string) => Promise<any[]>} getAll
 * @property {(store: string, index: string, query?: any) => Promise<any[]>} getAllByIndex
 * @property {(store: string, value: any) => Promise<any>} put
 * @property {(store: string, key: any) => Promise<void>} del
 * @property {(store: string) => Promise<number>} count
 * @property {(store: string) => Promise<void>} clear
 * @property {(stores: string[]|string, mode: 'readonly'|'readwrite', fn: (t: object) => any) => Promise<any>} tx
 * @property {() => void} close
 */
function wrap(db, version) {
  /**
   * Една транзакция върху няколко store-а. fn получава {store(name)} и може да
   * пуска заявки без await между тях (иначе транзакцията се затваря).
   * Връща стойността на fn (след complete).
   */
  async function tx(stores, mode, fn) {
    const t = db.transaction(stores, mode);
    const finished = done(t);
    let result;
    try {
      result = await fn({ store: (n) => t.objectStore(n), raw: t });
    } catch (e) {
      try { t.abort(); } catch { /* вече приключила */ }
      await finished.catch(() => {});
      throw e;
    }
    await finished;
    return result;
  }
  const one = (store, mode, fn) => tx([store], mode, (t) => req(fn(t.store(store))));
  return {
    version,
    get stores() { return [...db.objectStoreNames]; },
    get: (s, k) => one(s, 'readonly', (os) => os.get(k)),
    getAll: (s) => one(s, 'readonly', (os) => os.getAll()),
    getAllByIndex: (s, i, q) => one(s, 'readonly', (os) => os.index(i).getAll(q)),
    put: (s, v) => one(s, 'readwrite', (os) => os.put(v)),
    del: (s, k) => one(s, 'readwrite', (os) => os.delete(k)).then(() => {}),
    count: (s) => one(s, 'readonly', (os) => os.count()),
    clear: (s) => one(s, 'readwrite', (os) => os.clear()).then(() => {}),
    tx,
    close: () => db.close(),
  };
}

/** Изтрива база (за тестове и „нулиране“). */
export function deleteDb(name, indexedDB = globalThis.indexedDB) {
  return req(indexedDB.deleteDatabase(name));
}
