// FSRS-6 на ниво линия (D-008, D-015, ARCH_T-014 §4, ARCH_T-001 §5). Чисти функции, без DOM.
//
// Собствена малка реализация на формулите на FSRS-6 с тежестите по подразбиране от ts-fsrs 6.0.1.
// Само дългосрочният режим (enableShortTerm = false): една линия се преговаря най-много веднъж
// на ден, интервалите са цели дни. Сверено с ts-fsrs (devDependency) в tests/unit/fsrs.test.mjs.
//
// Времето е в „дни на приложението“: денят започва в dayStartHour местно време (ARCH §4),
// така че 03:59 при dayStartHour 4 е още предишният ден. `due` е началото на деня на преговора.

/** Тежести на FSRS-6 по подразбиране (ts-fsrs 6.0.1, FSRS6_DEFAULT_WEIGHTS). */
export const W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

export const GRADE = Object.freeze({ again: 1, hard: 2, good: 3, easy: 4 });
export const GRADE_NAME = Object.freeze({ 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' });

const S_MIN = 0.001;
const S_MAX = 36500;
export const MAX_INTERVAL = 36500;
const DAY_MS = 86_400_000;

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
/** Закръгляне до 8 знака — както в ts-fsrs (иначе натрупаните разлики стават > 1e-8). */
const r8 = (x) => Math.round(x * 1e8) / 1e8;

function decayFactor(w) {
  const decay = -w[20];
  const factor = r8(Math.exp(Math.log(0.9) / decay) - 1);
  return { decay, factor };
}

/** Вероятност да си спомниш след t дни при стабилност s. */
export function forgettingCurve(t, s, w = W) {
  const { decay, factor } = decayFactor(w);
  return r8(Math.pow(1 + (factor * t) / s, decay));
}

/** Интервал (цели дни, ≥ 1) до момента, в който вероятността падне до retention. */
export function nextInterval(s, retention, w = W, maxInterval = MAX_INTERVAL) {
  if (!(retention > 0 && retention <= 1)) throw new RangeError('retention трябва да е в (0, 1]');
  const { decay, factor } = decayFactor(w);
  const ivl = Math.max(Math.round((s / factor) * (Math.pow(retention, 1 / decay) - 1)), 1);
  return Math.min(ivl, maxInterval);
}

const initStability = (g, w) => clamp(w[g - 1], S_MIN, S_MAX);
const initDifficulty = (g, w) => r8(w[4] - Math.exp((g - 1) * w[5]) + 1);

function nextDifficulty(d, g, w) {
  const delta = -w[6] * (g - 3);
  const nd = d + r8((delta * (10 - d)) / 9); // линейно затихване
  const rev = r8(w[7] * initDifficulty(GRADE.easy, w) + (1 - w[7]) * nd); // връщане към средното
  return clamp(rev, 1, 10);
}

function recallStability(d, s, r, g, w) {
  const hard = g === GRADE.hard ? w[15] : 1;
  const easy = g === GRADE.easy ? w[16] : 1;
  return r8(clamp(s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy), S_MIN, S_MAX));
}

function forgetStability(d, s, r, w) {
  return r8(clamp(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]), S_MIN, S_MAX));
}

/**
 * Паметта след един преглед.
 * @param {{stability:number, difficulty:number}|null} mem null = нова карта
 * @param {number} t изминали дни от предишния преглед
 * @param {1|2|3|4} g оценка
 */
export function nextMemory(mem, t, g, w = W) {
  if (![1, 2, 3, 4].includes(g)) throw new RangeError(`Непозната оценка: ${g}`);
  if (!mem || !mem.stability) {
    return { stability: initStability(g, w), difficulty: clamp(initDifficulty(g, w), 1, 10) };
  }
  const { stability: s, difficulty: d } = mem;
  const r = forgettingCurve(Math.max(0, t), s, w);
  // Дългосрочен режим: w17 = w18 = 0 → долната граница при Again е s.
  const ns = g === GRADE.again ? clamp(r8(s), S_MIN, forgetStability(d, s, r, w)) : recallStability(d, s, r, g, w);
  return { stability: ns, difficulty: nextDifficulty(d, g, w) };
}

// --- размиване (fuzz) — детерминирано, по семе (както withFuzzing в ts-fsrs) ---
const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Infinity, factor: 0.05 },
];

export function fuzzRange(ivl, elapsed, maxInterval = MAX_INTERVAL) {
  let delta = 1;
  for (const rg of FUZZ_RANGES) delta += rg.factor * Math.max(Math.min(ivl, rg.end) - rg.start, 0);
  const capped = Math.min(ivl, maxInterval);
  let lo = Math.max(2, Math.round(capped - delta));
  const hi = Math.min(Math.round(capped + delta), maxInterval);
  if (capped > elapsed) lo = Math.max(lo, elapsed + 1);
  return { min: Math.min(lo, hi), max: hi };
}

/** Число в [0, 1) от низ (FNV-1a + mulberry32). */
export function seededRandom(seed) {
  let hsh = 2166136261;
  for (let i = 0; i < seed.length; i++) { hsh ^= seed.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
  let a = hsh >>> 0;
  a += 1831565813;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function fuzzed(ivl, elapsed, maxInterval, seed) {
  if (seed == null || ivl < 2.5) return ivl;
  const { min, max } = fuzzRange(ivl, elapsed, maxInterval);
  return Math.floor(seededRandom(String(seed)) * (max - min + 1) + min);
}

/**
 * Интервалът (дни) за оценка g, монотонен спрямо по-ниските оценки (Again ≤ Hard < Good < Easy),
 * както schedulerMonotonicIntervalMiddleware в ts-fsrs.
 */
export function scheduleDays(mem, t, g, { retention = 0.9, w = W, maxInterval = MAX_INTERVAL, fuzzSeed = null } = {}) {
  const ivl = (gr) => nextInterval(nextMemory(mem, t, gr, w).stability, retention, w, maxInterval);
  let out;
  for (let gr = 1; gr <= g; gr++) {
    const cand = gr === g ? fuzzed(ivl(gr), t, maxInterval, fuzzSeed) : ivl(gr);
    out = out === undefined ? Math.min(cand, maxInterval) : Math.min(Math.max(cand, out + 1), maxInterval);
  }
  return out;
}

// --- дни на приложението ---

/** Номер на деня (цяло число) с начало на деня в dayStartHour местно време. */
export function dayNumber(ts, dayStartHour = 0) {
  const d = new Date(ts - dayStartHour * 3_600_000);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Началото (ms, местно време) на ден с номер n. */
export function dayStart(n, dayStartHour = 0) {
  const u = new Date(n * DAY_MS);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), dayStartHour, 0, 0, 0).getTime();
}

/** Началото на следващия ден спрямо ts (граница „днес“ за опашката). */
export const endOfDay = (ts, dayStartHour = 0) => dayStart(dayNumber(ts, dayStartHour) + 1, dayStartHour);

/** Празна карта (полето fsrs на ред в lineProgress преди „научена“). */
export const emptyCard = () => ({ stability: null, difficulty: null, reps: 0, lapses: 0, state: 'new', lastReview: null, scheduledDays: 0 });

/**
 * Следващото състояние на картата след преглед (чиста функция; T-001 §5: next(state, grade, now)).
 * @param {object|null} card {stability, difficulty, reps, lapses, state, lastReview, scheduledDays}
 * @param {1|2|3|4} grade
 * @param {number} now ms
 * @param {{retention?:number, dayStartHour?:number, maxInterval?:number, fuzzSeed?:string|null, w?:number[]}} [o]
 * @returns {{card: object, due: number, interval: number, elapsed: number, retrievability: number|null}}
 */
export function next(card, grade, now, { retention = 0.9, dayStartHour = 0, maxInterval = MAX_INTERVAL, fuzzSeed = null, w = W } = {}) {
  const isNew = !card || !card.reps || !card.stability;
  const today = dayNumber(now, dayStartHour);
  const elapsed = isNew || card.lastReview == null ? 0 : Math.max(0, today - dayNumber(card.lastReview, dayStartHour));
  const mem = isNew ? null : { stability: card.stability, difficulty: card.difficulty };
  const retr = mem ? forgettingCurve(elapsed, mem.stability, w) : null;
  const m = nextMemory(mem, elapsed, grade, w);
  const interval = scheduleDays(mem, elapsed, grade, { retention, w, maxInterval, fuzzSeed });
  const lapse = !isNew && grade === GRADE.again;
  const out = {
    stability: m.stability,
    difficulty: m.difficulty,
    reps: (isNew ? 0 : card.reps) + 1,
    lapses: (isNew ? 0 : card.lapses || 0) + (lapse ? 1 : 0),
    state: lapse ? 'relearning' : 'review',
    lastReview: now,
    scheduledDays: interval,
  };
  return { card: out, due: dayStart(today + interval, dayStartHour), interval, elapsed, retrievability: retr };
}

/** Текуща вероятност да помниш линията (за показване/подредба); null за нова карта. */
export function retrievability(card, now, dayStartHour = 0, w = W) {
  if (!card || !card.reps || !card.stability || card.lastReview == null) return null;
  const t = Math.max(0, dayNumber(now, dayStartHour) - dayNumber(card.lastReview, dayStartHour));
  return forgettingCurve(t, card.stability, w);
}
