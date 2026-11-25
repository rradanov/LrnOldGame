// Runtime параметри на приложението (D-013).
// Всяка числова стойност или праг, която влияе на поведението, се описва тук:
// ключ, тип, подразбиране, мин/макс, стъпка и етикет на български.
// Модулът няма DOM и се тества с `node --test`.
// Хранилището се подава отвън (адаптер с load()/save()), за да може
// в T-008 localStorage да се смени с IndexedDB, без да се пипат екраните.

/**
 * @typedef {Object} SettingDef
 * @property {string} key
 * @property {'int'|'number'|'enum'|'bool'} type
 * @property {*} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string} [unit]
 * @property {Array<[string,string]>} [options]  // за enum: [стойност, етикет]
 * @property {string} label                      // етикет на български
 * @property {string} [help]                     // кратко пояснение на български
 * @property {string} [group]
 */

/** @type {ReadonlyArray<SettingDef>} */
export const SETTINGS_SCHEMA = Object.freeze([
  {
    key: 'newPerDay', type: 'int', default: 10, min: 0, max: 100, step: 1,
    group: 'train', label: 'Нови карти на ден',
    help: 'Колко нови позиции влизат в тренировка за един ден.',
  },
  {
    key: 'retention', type: 'number', default: 0.9, min: 0.7, max: 0.99, step: 0.01,
    group: 'train', label: 'Желана успеваемост (FSRS)',
    help: 'По-висока стойност дава повече прегледи и по-добро запомняне.',
  },
  {
    key: 'hardAfterSec', type: 'int', default: 15, min: 3, max: 120, step: 1, unit: 'сек.',
    group: 'train', label: 'Бавен отговор след',
    help: 'Верен ход след толкова секунди се оценява като „Трудно“.',
  },
  {
    key: 'opponentMinShare', type: 'int', default: 5, min: 0, max: 50, step: 1, unit: '%',
    group: 'train', label: 'Мин. дял на хода на противника',
    help: 'Ходове на противника с по-малък дял в дървото не се играят в тренировка.',
  },
  {
    key: 'boardOrientation', type: 'enum', default: 'auto',
    options: [['auto', 'Според страната'], ['white', 'Белите долу'], ['black', 'Черните долу']],
    group: 'board', label: 'Ориентация на дъската',
  },
  {
    key: 'animationMs', type: 'int', default: 300, min: 0, max: 1000, step: 50, unit: 'ms',
    group: 'board', label: 'Анимация на ходовете',
  },
  {
    key: 'backupReminderDays', type: 'int', default: 14, min: 1, max: 90, step: 1, unit: 'дни',
    group: 'data', label: 'Напомняне за бекъп след',
  },
]);

export const SETTINGS_GROUPS = Object.freeze([
  ['train', 'Тренировка'],
  ['board', 'Дъска'],
  ['data', 'Данни'],
]);

const BY_KEY = new Map(SETTINGS_SCHEMA.map((d) => [d.key, d]));

/** Описание на параметър по ключ (или undefined). */
export function getDef(key) {
  return BY_KEY.get(key);
}

/** Обект с всички подразбиращи се стойности. */
export function defaults() {
  const out = {};
  for (const d of SETTINGS_SCHEMA) out[d.key] = d.default;
  return out;
}

function decimalsOf(step) {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Привежда сурова стойност към типа и границите на параметъра.
 * Невалидна стойност (NaN, непозната опция, грешен тип) → подразбиране.
 * Числата извън [min, max] се притискат до границата и се закръгляват по стъпката.
 */
export function normalize(def, raw) {
  switch (def.type) {
    case 'int':
    case 'number': {
      if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return def.default;
      let v = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
      if (!Number.isFinite(v)) return def.default;
      if (def.min !== undefined && v < def.min) v = def.min;
      if (def.max !== undefined && v > def.max) v = def.max;
      if (def.type === 'int' && !(def.step > 1)) return Math.round(v);
      if (def.step) {
        const base = def.min ?? 0;
        v = base + Math.round((v - base) / def.step) * def.step;
        v = Number(v.toFixed(decimalsOf(def.step)));
        if (def.max !== undefined && v > def.max) v = def.max;
      }
      return v;
    }
    case 'enum': {
      const ok = def.options.some(([value]) => value === raw);
      return ok ? raw : def.default;
    }
    case 'bool':
      if (raw === true || raw === 'true') return true;
      if (raw === false || raw === 'false') return false;
      return def.default;
    default:
      throw new TypeError(`Непознат тип на параметър: ${def.type}`);
  }
}

/** Адаптер в паметта (за тестове и като резервен вариант). */
export function memoryStorage(initial = {}) {
  let data = { ...initial };
  return {
    load: () => ({ ...data }),
    save: (obj) => { data = { ...obj }; },
  };
}

/**
 * Адаптер над localStorage. Записва един JSON обект под `name`.
 * Грешки (пълно хранилище, частен режим) не спират приложението.
 */
export function localStorageBackend(name = 'lrnoldgame.settings.v1', ls = globalThis.localStorage) {
  return {
    load() {
      try {
        const txt = ls?.getItem(name);
        const obj = txt ? JSON.parse(txt) : {};
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
      } catch {
        return {};
      }
    },
    save(obj) {
      try { ls?.setItem(name, JSON.stringify(obj)); } catch { /* пренебрегваме */ }
    },
  };
}

/**
 * Единственият API за четене/запис на параметри.
 * @param {{load: () => object, save: (obj: object) => void}} storage
 */
export function createSettings(storage = memoryStorage()) {
  const values = defaults();
  const stored = storage.load() || {};
  for (const d of SETTINGS_SCHEMA) {
    if (Object.prototype.hasOwnProperty.call(stored, d.key)) values[d.key] = normalize(d, stored[d.key]);
  }
  const listeners = new Set();

  function requireDef(key) {
    const d = BY_KEY.get(key);
    if (!d) throw new RangeError(`Непознат параметър: ${key}`);
    return d;
  }

  function persist() {
    // Пазим само стойностите, различни от подразбирането, за да могат
    // бъдещи промени на подразбирането да стигнат до потребителя.
    const out = {};
    for (const d of SETTINGS_SCHEMA) if (values[d.key] !== d.default) out[d.key] = values[d.key];
    storage.save(out);
  }

  return {
    schema: SETTINGS_SCHEMA,
    get(key) { requireDef(key); return values[key]; },
    getAll() { return { ...values }; },
    /** Записва стойност; връща нормализираната (притисната) стойност. */
    set(key, raw) {
      const d = requireDef(key);
      const v = normalize(d, raw);
      if (values[key] !== v) {
        values[key] = v;
        persist();
        for (const fn of listeners) fn(key, v);
      }
      return v;
    },
    /** Връща подразбиране за един ключ или за всички. */
    reset(key) {
      const keys = key ? [requireDef(key).key] : SETTINGS_SCHEMA.map((d) => d.key);
      for (const k of keys) {
        const d = BY_KEY.get(k);
        if (values[k] !== d.default) {
          values[k] = d.default;
          for (const fn of listeners) fn(k, d.default);
        }
      }
      persist();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
