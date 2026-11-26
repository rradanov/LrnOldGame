// Runtime параметри на приложението (D-013).
// Всяка числова стойност или праг, която влияе на поведението, се описва тук:
// ключ, тип, подразбиране, мин/макс, стъпка и етикет на български.
// Модулът няма DOM и се тества с `node --test`.
// Хранилището се подава отвън (адаптер с load()/save()). В приложението това е
// store `settings` в IndexedDB (src/db/userdb.js): load() връща предварително
// прочетения обект, save() записва асинхронно.

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
  // Учене (ARCH_T-014 §6.1)
  {
    key: 'learnStreak', type: 'int', default: 3, min: 1, max: 10, step: 1,
    group: 'learn', label: 'Изигравания без грешка до „научена“',
    help: 'Колко пъти подред трябва да изиграеш линията без грешка, за да е научена.',
  },
  {
    key: 'newLinesPerDay', type: 'int', default: 5, min: 0, max: 50, step: 1,
    group: 'learn', label: 'Нови линии на ден',
  },
  {
    key: 'onError', type: 'enum', default: 'continue',
    options: [['continue', 'Довърши линията'], ['restart', 'Започни веднага отначало']],
    group: 'learn', label: 'При грешка',
  },
  {
    key: 'errorPauseMs', type: 'int', default: 1200, min: 0, max: 5000, step: 100, unit: 'ms',
    group: 'learn', label: 'Пауза за показване на верния ход',
  },
  {
    key: 'hintResetsStreak', type: 'bool', default: true,
    group: 'learn', label: 'Подсказката нулира брояча',
  },
  {
    key: 'autoPlayStart', type: 'bool', default: false,
    group: 'learn', label: 'Изиграй автоматично стартовите ходове на курса',
  },
  // Преговор
  {
    key: 'retention', type: 'number', default: 0.9, min: 0.7, max: 0.99, step: 0.01,
    group: 'review', label: 'Желана успеваемост (FSRS)',
    help: 'По-висока стойност дава повече преговори и по-добро запомняне.',
  },
  {
    key: 'maxReviewsPerDay', type: 'int', default: 50, min: 0, max: 500, step: 1,
    group: 'review', label: 'Макс. преговори на ден',
    help: '0 = без лимит.',
  },
  {
    key: 'relearnStreak', type: 'int', default: 1, min: 1, max: 5, step: 1,
    group: 'review', label: 'Чисти пробега след грешка при преговор',
  },
  {
    key: 'hardAfterSec', type: 'int', default: 15, min: 3, max: 120, step: 1, unit: 'сек.',
    group: 'review', label: 'Бавен ход след',
    help: 'Верен ход след толкова секунди дава оценка „Трудно“.',
  },
  {
    key: 'dayStartHour', type: 'int', default: 4, min: 0, max: 12, step: 1, unit: 'ч.',
    group: 'review', label: 'Новият ден започва в',
  },
  // Дъска
  {
    key: 'opponentDelayMs', type: 'int', default: 400, min: 0, max: 3000, step: 100, unit: 'ms',
    group: 'board', label: 'Пауза преди хода на противника',
  },
  {
    key: 'boardOrientation', type: 'enum', default: 'auto',
    options: [['auto', 'Според страната на курса'], ['white', 'Белите долу'], ['black', 'Черните долу']],
    group: 'board', label: 'Ориентация на дъската',
  },
  {
    key: 'animationMs', type: 'int', default: 300, min: 0, max: 1000, step: 50, unit: 'ms',
    group: 'board', label: 'Анимация на ходовете',
  },
  // Данни
  {
    key: 'backupReminderDays', type: 'int', default: 14, min: 1, max: 90, step: 1, unit: 'дни',
    group: 'data', label: 'Напомняне за бекъп след',
  },
]);

export const SETTINGS_GROUPS = Object.freeze([
  ['learn', 'Учене'],
  ['review', 'Преговор'],
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
