// Hash router (ARCH_T-014 §5). Без DOM зависимости в parseHash(), за да се тества в Node.
// Раздели в долната лента: #/courses · #/review · #/catalog · #/settings.
// Вътрешни екрани: #/course/<courseId>, #/train/<courseId>/<lineId>?mode=learn|review.

export const TABS = Object.freeze(['courses', 'review', 'catalog', 'settings']);
/** Вътрешен екран → раздел, който свети в лентата. */
export const INNER = Object.freeze({ course: 'courses', train: 'courses' });
export const ROUTES = Object.freeze([...TABS, ...Object.keys(INNER)]);
export const DEFAULT_ROUTE = 'courses';

/**
 * '#/course/italian?x=1' → {name: 'course', parts: ['italian'], params, tab: 'courses', known}.
 * Непознат път → DEFAULT_ROUTE (known: false).
 */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const segs = path.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const name = segs[0] || '';
  const ok = ROUTES.includes(name);
  const resolved = ok ? name : DEFAULT_ROUTE;
  const params = new URLSearchParams(query);
  return {
    name: resolved,
    parts: ok ? segs.slice(1) : [],
    known: name === '' || ok,
    // T013-D9: тренировка в режим преговор свети под „Преговор“.
    tab: resolved === 'train' && params.get('mode') === 'review' ? 'review' : (INNER[resolved] || resolved),
    params,
  };
}

export function hrefFor(name, ...parts) {
  return `#/${[name, ...parts].map((p) => encodeURIComponent(p)).join('/')}`;
}

/**
 * Стартира router-а. onRoute(route) се вика при всяка смяна на hash
 * и веднага при старт. Връща функция за спиране.
 */
export function startRouter(onRoute, win = window) {
  const handler = () => onRoute(parseHash(win.location.hash));
  win.addEventListener('hashchange', handler);
  handler();
  return () => win.removeEventListener('hashchange', handler);
}
