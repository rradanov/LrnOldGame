// Hash router: #/today, #/explore, ... Без DOM зависимости в parseHash(),
// за да може да се тества в Node.

export const ROUTES = Object.freeze(['today', 'explore', 'repertoire', 'train', 'settings']);
export const DEFAULT_ROUTE = 'today';

/** '#/explore?x=1' → {name: 'explore', params: URLSearchParams}. Непознат път → DEFAULT_ROUTE. */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const name = path.split('/')[0];
  return {
    name: ROUTES.includes(name) ? name : DEFAULT_ROUTE,
    known: name === '' || ROUTES.includes(name),
    params: new URLSearchParams(query),
  };
}

export function hrefFor(name) {
  return `#/${name}`;
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
