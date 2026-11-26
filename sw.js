/* LrnOldGame Service Worker.
 * APP_VERSION трябва да съвпада със src/version.js и package.json (unit тест).
 * BUILD се заменя при деплой с краткия SHA на commit-а (deploy.yml), така че
 * всеки деплой сменя байтовете на sw.js → браузърът инсталира новата версия,
 * а приложението показва „Има нова версия — Обнови“.
 */
const APP_VERSION = '0.4.0';
const BUILD = 'dev';
const CACHE_PREFIX = 'lrnoldgame-shell-';
const CACHE = `${CACHE_PREFIX}${APP_VERSION}-${BUILD}`;

// App shell: всичко нужно за работа без мрежа. Списъкът се проверява от
// tests/unit/sw.test.mjs (файловете съществуват, всички импорти от src/app.js са тук).
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/app.css',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/version.js',
  'src/settings.js',
  'src/router.js',
  'src/i18n/bg.js',
  'src/db/idb.js',
  'src/db/schema.js',
  'src/db/userdb.js',
  'src/data/courseStore.js',
  'src/data/progress.js',
  'src/train/session.js',
  'src/srs/fsrs.js',
  'src/srs/review.js',
  'src/srs/queue.js',
  'src/data/today.js',
  'src/clock.js',
  'src/chess/position.js',
  'src/ui/dom.js',
  'src/ui/board.js',
  'src/ui/screens/courses.js',
  'src/ui/screens/review.js',
  'src/ui/screens/catalog.js',
  'src/ui/screens/course.js',
  'src/ui/screens/train.js',
  'src/ui/screens/settings.js',
  'vendor/chess.js/chess.js',
  'vendor/cm-chessboard/src/Chessboard.js',
  'vendor/cm-chessboard/src/lib/Svg.js',
  'vendor/cm-chessboard/src/lib/Utils.js',
  'vendor/cm-chessboard/src/model/ChessboardState.js',
  'vendor/cm-chessboard/src/model/Extension.js',
  'vendor/cm-chessboard/src/model/Position.js',
  'vendor/cm-chessboard/src/view/ChessboardView.js',
  'vendor/cm-chessboard/src/view/PositionAnimationsQueue.js',
  'vendor/cm-chessboard/src/view/VisualMoveInput.js',
  'vendor/cm-chessboard/src/extensions/markers/Markers.js',
  'vendor/cm-chessboard/src/extensions/arrows/Arrows.js',
  'vendor/cm-chessboard/assets/chessboard.css',
  'vendor/cm-chessboard/assets/pieces/standard.svg',
  'vendor/cm-chessboard/assets/extensions/markers/markers.css',
  'vendor/cm-chessboard/assets/extensions/markers/markers.svg',
  'vendor/cm-chessboard/assets/extensions/arrows/arrows.css',
  'vendor/cm-chessboard/assets/extensions/arrows/arrows.svg',
];

// Данните на курсовете (D-023): catalog + manifest + всички файлове от manifest.courses.
// Кешират се заедно с shell-а при install, затова новите данни идват с нов деплой
// (нов BUILD → „Обнови“), а прогресът е в IndexedDB по courseId/lineId.
const DATA_BASE = 'data/';
const DATA_INDEX = ['catalog.json', 'manifest.json'];

async function precacheData(cache) {
  const fetchOk = async (path) => {
    const res = await fetch(new Request(DATA_BASE + path, { cache: 'reload' }));
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res;
  };
  const [catalogRes, manifestRes] = await Promise.all(DATA_INDEX.map(fetchOk));
  const manifest = await manifestRes.clone().json();
  const files = (manifest.courses || []).map((c) => c.file);
  const courseRes = await Promise.all(files.map(fetchOk));
  // Записваме едва когато всичко е изтеглено: или всички данни, или install пада.
  await cache.put(DATA_BASE + 'catalog.json', catalogRes);
  await cache.put(DATA_BASE + 'manifest.json', manifestRes);
  await Promise.all(files.map((f, i) => cache.put(DATA_BASE + f, courseRes[i])));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' заобикаля HTTP кеша, за да не запишем стари файлове.
    await cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
    await precacheData(cache);
  })());
  // Не викаме skipWaiting() тук: при обновяване новата версия чака
  // потвърждение от потребителя (съобщение SKIP_WAITING).
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'VERSION', version: APP_VERSION, build: BUILD });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Навигации (вкл. ?параметри): винаги app shell от кеша, мрежата е резерва.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match('index.html');
      if (hit) return hit;
      return fetch(req);
    })());
    return;
  }

  // Останалото (вкл. data/*): cache-first; непознатите файлове се добавят в кеша при успех.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  })());
});
