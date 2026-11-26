// Малка проверка по схема без зависимости (T-015).
// Схемата е обикновен обект:
//   {type:'string', re?, min?, max?, enum?}   min/max — дължина
//   {type:'int'|'number', min?, max?, gt?}     gt — строго по-голямо
//   {type:'bool'} · {type:'null'} · {const: X}
//   {type:'array', items?, min?, max?}
//   {type:'object', props:{k: spec}, required?:[k], extra?:bool}  extra — позволява непознати полета
//   {anyOf:[spec, …], label?}
// Грешките са на български: „<път>: <съобщение>“.

const TYPE_BG = {
  string: 'низ', int: 'цяло число', number: 'число', bool: 'true/false',
  null: 'null', array: 'масив', object: 'обект',
};

function typeOk(type, v) {
  switch (type) {
    case 'string': return typeof v === 'string';
    case 'int': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'bool': return typeof v === 'boolean';
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    default: throw new Error(`непознат тип в схемата: ${type}`);
  }
}

function describe(spec) {
  if (spec.label) return spec.label;
  if ('const' in spec) return JSON.stringify(spec.const);
  if (spec.anyOf) return spec.anyOf.map(describe).join(' или ');
  return TYPE_BG[spec.type];
}

/**
 * Проверява `value` по `spec`. Добавя грешките в `errors` (масив от низове).
 * Връща true, ако няма нови грешки.
 */
export function check(spec, value, path, errors) {
  const before = errors.length;
  const fail = (msg) => errors.push(`${path}: ${msg}`);

  if ('const' in spec) {
    if (value !== spec.const) fail(`очаква се ${JSON.stringify(spec.const)}, а е ${JSON.stringify(value)}`);
    return errors.length === before;
  }
  if (spec.anyOf) {
    for (const s of spec.anyOf) {
      const tmp = [];
      if (check(s, value, path, tmp)) return true;
    }
    // ако само един вариант е от същия тип, показваме неговата конкретна грешка
    const same = spec.anyOf.filter((s) => s.type && typeOk(s.type, value));
    if (same.length === 1) return check(same[0], value, path, errors);
    fail(`очаква се ${describe(spec)}`);
    return false;
  }
  if (!typeOk(spec.type, value)) {
    fail(`очаква се ${describe(spec)}, а е ${value === null ? 'null' : Array.isArray(value) ? 'масив' : typeof value}`);
    return false;
  }
  switch (spec.type) {
    case 'string':
      if (spec.min !== undefined && value.length < spec.min) fail(spec.min === 1 ? 'празен низ' : `по-къс от ${spec.min} знака`);
      if (spec.max !== undefined && value.length > spec.max) fail(`по-дълъг от ${spec.max} знака`);
      if (spec.re && !spec.re.test(value)) fail(`невалиден формат „${value}“${spec.reHint ? ` (${spec.reHint})` : ''}`);
      if (spec.enum && !spec.enum.includes(value)) fail(`„${value}“ не е от ${spec.enum.join(' | ')}`);
      break;
    case 'int':
    case 'number':
      if (spec.min !== undefined && value < spec.min) fail(`${value} < ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) fail(`${value} > ${spec.max}`);
      if (spec.gt !== undefined && !(value > spec.gt)) fail(`трябва да е > ${spec.gt}`);
      break;
    case 'array':
      if (spec.min !== undefined && value.length < spec.min) fail(`по-малко от ${spec.min} елемента`);
      if (spec.max !== undefined && value.length > spec.max) fail(`повече от ${spec.max} елемента`);
      if (spec.items) value.forEach((x, i) => check(spec.items, x, `${path}[${i}]`, errors));
      break;
    case 'object': {
      const props = spec.props || {};
      for (const k of spec.required || []) {
        if (!(k in value)) fail(`липсва поле „${k}“`);
      }
      for (const [k, v] of Object.entries(value)) {
        if (props[k]) check(props[k], v, `${path}.${k}`, errors);
        else if (!spec.extra) fail(`непознато поле „${k}“`);
      }
      break;
    }
    default:
      break;
  }
  return errors.length === before;
}

// ---- Схеми на данните (ARCH_T-014 §3) ----

export const LIMITS = {
  catalogBytes: 64 * 1024,
  manifestBytes: 64 * 1024,
  courseBytes: 100 * 1024, // ARCH: 5–8 KB при 20 линии; < 0,6 MB общо при 60 линии
  totalCourseBytes: 2 * 1024 * 1024,
  maxCourses: 200,
  maxLines: 100, // linesPerCourse ≤ 60, плюс допълване при транспозиции (§2.5)
  maxPly: 40, // lines.maxPly ≤ 36 (§6.2) + резерв
  maxBook: 20,
  maxComment: 1000,
  maxAbsCp: 100000,
};

export const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ECO_RE = /^[A-E]\d\d$/;
export const LINE_ID_RE = /^[0-9a-f]{8}$/;
export const DATA_VERSION_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const END_REASONS = ['adv', 'equal', 'depth', 'data', 'transpose', 'mate', 'draw']; // equal — D-026 (черни)

const str = (extra = {}) => ({ type: 'string', min: 1, ...extra });

/** Параметри, които курсът може да презапише в `params` (секция lines в ARCH §6.2). */
export const COURSE_PARAMS = {
  linesPerCourse: { type: 'int', min: 5, max: 60 },
  advCpWhite: { type: 'int', min: 30, max: 300 },
  advCpBlack: { type: 'int', min: 0, max: 300 },
  maxPly: { type: 'int', min: 8, max: 36 },
  oppMinShare: { type: 'number', min: 0.01, max: 0.5 },
  oppMinMoveGames: { type: 'int', min: 1, max: 1000 },
  oppMinGames: { type: 'int', min: 1, max: 1000 },
  minLineProb: { type: 'number', min: 0, max: 0.05 },
  myMoveToleranceCp: { type: 'int', min: 0, max: 100 },
  myMoveMinGames: { type: 'int', min: 0, max: 10000 },
  bookToleranceCp: { type: 'int', min: 0, max: 300 },
  maxTransposeShare: { type: 'number', min: 0, max: 1 },
  maxEvalsPerCourse: { type: 'int', min: 50, max: 5000 },
  // T-022 (D-026, D-027)
  equalCpBlack: { type: 'int', min: -300, max: 300 },
  minPlyBlack: { type: 'int', min: 2, max: 40 }, // > maxPly = без край „equal“
  tailMaxPly: { type: 'int', min: 0, max: 36 }, // 0 = без опашка
  quietMaxPly: { type: 'int', min: 0, max: 8 }, // 0 = без довършване
};

export const CATALOG_SCHEMA = {
  type: 'object',
  required: ['v', 'courses', 'groups'],
  props: {
    v: { const: 1 },
    courses: {
      type: 'array', min: 1, max: LIMITS.maxCourses,
      items: {
        type: 'object',
        required: ['id', 'side', 'group', 'name', 'eco', 'start', 'book', 'default', 'params'],
        props: {
          id: str({ max: 32, re: ID_RE, reHint: 'малки латински букви, цифри и „-“' }),
          side: { type: 'string', enum: ['w', 'b'] },
          group: str({ re: ID_RE }),
          name: {
            type: 'object', required: ['bg', 'en'],
            props: { bg: str({ max: 80 }), en: str({ max: 120 }) },
          },
          eco: str({ re: ECO_RE, reHint: 'A00–E99' }),
          start: { type: 'string', max: 200 },
          book: { type: 'array', max: LIMITS.maxBook, items: str({ max: 400 }) },
          default: { type: 'bool' },
          params: { type: 'object', props: COURSE_PARAMS },
        },
      },
    },
    groups: {
      type: 'array', min: 1,
      items: { type: 'array', min: 2, max: 2, items: str({ max: 80 }) },
    },
  },
};

export const COURSE_SCHEMA = {
  type: 'object',
  required: ['v', 'id', 'side', 'dataVersion', 'start', 'lines'],
  props: {
    v: { const: 1 },
    id: str({ re: ID_RE }),
    side: { type: 'string', enum: ['w', 'b'] },
    dataVersion: str({ re: DATA_VERSION_RE, reHint: 'YYYY-MM-DD.N' }),
    sample: { type: 'bool' },
    start: { type: 'array', max: LIMITS.maxPly, items: str() },
    lines: {
      type: 'array', min: 1, max: LIMITS.maxLines,
      items: {
        type: 'object',
        required: ['id', 'n', 'm', 'p', 'end', 'cp', 'c'],
        props: {
          id: str({ re: LINE_ID_RE, reHint: '8 hex знака' }),
          n: { type: 'int', min: 1 },
          m: { type: 'array', min: 1, max: LIMITS.maxPly, items: str({ max: 10 }) },
          p: { type: 'number', gt: 0, max: 1 },
          end: { type: 'string', enum: END_REASONS },
          to: str({ re: LINE_ID_RE }),
          cp: { anyOf: [{ type: 'int', min: -LIMITS.maxAbsCp, max: LIMITS.maxAbsCp }, { type: 'null' }] },
          // D-027: незадължително — индекс в m на първия ход без данни от партии (опашка от двигателя)
          tail: { type: 'int', min: 0, max: LIMITS.maxPly - 1 },
          eco: str({ re: ECO_RE }),
          name: str({ max: 200 }),
          c: {
            anyOf: [
              { type: 'null' },
              { type: 'array', items: { anyOf: [{ type: 'null' }, str({ max: LIMITS.maxComment })] } },
            ],
          },
        },
      },
    },
  },
};

export const MANIFEST_SCHEMA = {
  type: 'object',
  required: ['v', 'dataVersion', 'built', 'courses'],
  props: {
    v: { const: 1 },
    dataVersion: str({ re: DATA_VERSION_RE, reHint: 'YYYY-MM-DD.N' }),
    built: str({ re: ISO_RE, reHint: 'ISO 8601 UTC, напр. 2026-12-01T10:12:00Z' }),
    sample: { type: 'bool' },
    note: str({ max: 500 }),
    generator: { type: 'object', extra: true },
    engine: { type: 'object', extra: true },
    source: { type: 'object', extra: true },
    params: { type: 'object', extra: true },
    courses: {
      type: 'array', max: LIMITS.maxCourses,
      items: {
        type: 'object',
        required: ['id', 'file', 'sha256', 'lines', 'coverage'],
        props: {
          id: str({ re: ID_RE }),
          file: str(),
          sha256: str({ re: SHA256_RE, reHint: '64 hex знака' }),
          lines: { type: 'int', min: 1, max: LIMITS.maxLines },
          coverage: { type: 'number', min: 0, max: 1 },
        },
      },
    },
  },
};
