// Схема на IndexedDB „lrnoldgame“ (ARCH_T-014 §4). Без DOM.
// Нова версия = нов ключ в MIGRATIONS; старите миграции не се пипат никога.

export const DB_NAME = 'lrnoldgame';

/** Версията на схемата = версията на IndexedDB = schemaVersion в бекъпа. */
export const SCHEMA_VERSION = 1;

export const STORES = Object.freeze(['myCourses', 'lineProgress', 'attempts', 'daily', 'settings', 'meta']);

/** @type {Record<number, (db: IDBDatabase, tx: IDBTransaction) => void>} */
export const MIGRATIONS = Object.freeze({
  1(db) {
    // {courseId, addedAt, order, hidden}
    db.createObjectStore('myCourses', { keyPath: 'courseId' });
    // {key:"<courseId>/<lineId>", courseId, lineId, n, status, streak, ..., due, fsrs}
    const lp = db.createObjectStore('lineProgress', { keyPath: 'key' });
    lp.createIndex('courseId', 'courseId');
    lp.createIndex('due', 'due');
    lp.createIndex('status', 'status');
    // журнал на опитите
    const at = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
    at.createIndex('lineKey', 'lineKey');
    at.createIndex('ts', 'ts');
    db.createObjectStore('daily', { keyPath: 'day' });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('meta', { keyPath: 'key' });
  },
});

export const lineKey = (courseId, lineId) => `${courseId}/${lineId}`;
