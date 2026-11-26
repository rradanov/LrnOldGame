// Часовник на приложението. Без DOM.
//
// За проверка на преговора без да чакаш дни (ARCH_T-001 §8, T-013): `index.html?now=+3d#/review`
// или `?now=2026-12-01`. В този режим приложението работи върху ОТДЕЛНО копие на данните
// (IndexedDB „lrnoldgame-sim“, копира се от истинската база при първото влизане или със `&simreset=1`),
// така че истинският прогрес не се пипа. Горе се вижда лента „Симулирано време“ с изход.

/**
 * Отместване (ms) спрямо реалното време по параметъра `now`.
 * '+3d' / '-1d' — дни; 'YYYY-MM-DD' — тази дата в текущия час; ISO с час — точно този момент.
 * Невалидна стойност → 0.
 */
export function parseNowParam(value, realNow = Date.now()) {
  if (!value) return 0;
  const v = String(value).trim();
  let m = /^([+-]?\d{1,4})d$/i.exec(v);
  if (m) return Number(m[1]) * 86_400_000;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) {
    const r = new Date(realNow);
    const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), r.getHours(), r.getMinutes(), r.getSeconds(), r.getMilliseconds());
    return Number.isNaN(t.getTime()) ? 0 : t.getTime() - realNow;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t - realNow;
}

/** Часовник: now() = реалното време + отместване. */
export function createClock(offsetMs = 0, real = () => Date.now()) {
  return { now: () => real() + offsetMs, offset: offsetMs, simulated: offsetMs !== 0 };
}
