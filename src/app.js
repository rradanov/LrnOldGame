// Bootstrap: IndexedDB, настройки, данни на курсовете, долна лента, hash router, Service Worker.
import { T, fmt } from './i18n/bg.js';
import { createSettings, memoryStorage } from './settings.js';
import { TABS, startRouter, hrefFor } from './router.js';
import { openUserDb } from './db/userdb.js';
import { createClock, parseNowParam } from './clock.js';
import { loadToday, srsSettings } from './data/today.js';
import { createCourseStore } from './data/courseStore.js';
import { h } from './ui/dom.js';
import { APP_VERSION } from './version.js';

const SIM_DB = 'lrnoldgame-sim';
import courses from './ui/screens/courses.js';
import review from './ui/screens/review.js';
import catalog from './ui/screens/catalog.js';
import course from './ui/screens/course.js';
import train from './ui/screens/train.js';
import settingsScreen from './ui/screens/settings.js';

const SCREENS = { courses, review, catalog, settings: settingsScreen, course, train };

// Символи за разделите; U+FE0E иска текстово (не емоджи) изобразяване.
const TAB_ICONS = {
  courses: '♞︎',
  review: '⟳︎',
  catalog: '☰︎',
  settings: '⚙︎',
};

function buildNav(nav) {
  nav.replaceChildren(...TABS.map((name) =>
    h('a', { href: hrefFor(name), class: 'tab', dataset: { route: name } },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, TAB_ICONS[name]),
      h('span', { class: 'tab-label' }, T.tabs[name]),
      name === 'review' ? h('span', { class: 'tab-badge', id: 'review-badge', hidden: true }) : null,
    )));
}

/** Значката с броя за преговор днес на раздела „Преговор“. */
async function refreshBadge(ctx) {
  const el = document.getElementById('review-badge');
  if (!el) return;
  try {
    const t = await loadToday(ctx);
    const n = t.queue.items.length;
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
    el.setAttribute('aria-label', fmt(T.review.badge, { n }));
    el.closest('a')?.setAttribute('data-due', String(n));
  } catch (e) {
    console.warn('Значка:', e);
  }
}

function mountRouter(main, nav, ctx) {
  let cleanup = null;
  startRouter((route) => {
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    main.replaceChildren();
    main.dataset.screen = route.name;
    for (const a of nav.querySelectorAll('a.tab')) {
      if (a.dataset.route === route.tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = `${T.tabs[route.name] || T.titles[route.name]} · ${T.appName}`;
    const screen = SCREENS[route.name];
    const res = screen.render(main, ctx, route);
    cleanup = typeof res === 'function' ? res : null;
    window.scrollTo(0, 0);
    ctx.refreshBadge();
  });
}

// true след „Обнови“: само тогава смяната на контролера презарежда страницата.
// (Първото поемане на контрол при нова инсталация също вдига controllerchange.)
let updateRequested = false;

function showUpdateBanner(worker) {
  const bar = document.getElementById('update-bar');
  if (!bar || !worker) return;
  bar.replaceChildren(
    h('span', {}, T.update.available),
    h('button', {
      type: 'button', class: 'btn',
      onclick: () => { updateRequested = true; worker.postMessage({ type: 'SKIP_WAITING' }); },
    }, T.update.reload),
  );
  bar.hidden = false;
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // Нова версия, която чака: питаме потребителя.
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(nw);
      });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !updateRequested) return;
      reloaded = true;
      location.reload();
    });
  } catch (err) {
    console.warn('Service Worker не се регистрира:', err);
  }
}

/** D-010: молим браузъра да не трие данните сам. Връща true/false/null. */
async function requestPersist() {
  try {
    if (!navigator.storage?.persisted) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

/**
 * Симулирано време (?now=…): отделна база „lrnoldgame-sim“, копие на истинската
 * (при първо влизане или с &simreset=1). Истинските данни не се пипат.
 */
async function openSimDb(clock, reset) {
  const real = await openUserDb();
  const snap = await real.exportBackup({ appVersion: APP_VERSION, touch: false });
  real.close();
  const sim = await openUserDb({ name: SIM_DB, now: clock.now });
  if (reset || !(await sim.getMeta('simCopiedAt'))) {
    await sim.importBackup(snap);
    await sim.setMeta('simCopiedAt', Date.now());
  }
  return sim;
}

function showSimBar(clock) {
  const bar = h('div', { class: 'sim-bar', id: 'sim-bar', role: 'status' },
    h('span', {}, fmt(T.sim.bar, { date: new Date(clock.now()).toLocaleString('bg-BG', { dateStyle: 'medium', timeStyle: 'short' }) })),
    ' ',
    h('a', { href: location.pathname, id: 'sim-exit', onclick: (e) => { e.preventDefault(); location.href = `${location.pathname}${location.hash}`; } }, T.sim.exit));
  document.body.prepend(bar);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const clock = createClock(parseNowParam(params.get('now')));
  const ctx = { userDb: null, settings: null, store: createCourseStore(), persisted: null, dataUpdated: null, now: clock.now, clock };
  ctx.refreshBadge = () => refreshBadge(ctx);
  ctx.srs = () => srsSettings(ctx.settings);

  let viewP = null;
  ctx.data = () => (viewP ||= ctx.store.loadView().catch((e) => { viewP = null; throw e; }));

  try {
    ctx.userDb = clock.simulated ? await openSimDb(clock, params.has('simreset')) : await openUserDb();
    await ctx.userDb.migrateLegacySettings(globalThis.localStorage);
    const stored = await ctx.userDb.loadSettings();
    ctx.settings = createSettings({ load: () => stored, save: (obj) => ctx.userDb.saveSettings(obj) });
    // T-010: научените линии без FSRS карта (0.3.0, стар бекъп) получават карта от learnedAt.
    try {
      const made = await ctx.userDb.ensureCards(ctx.srs());
      if (made) console.info(`FSRS: създадени ${made} карти за научени линии`);
    } catch (e) { console.error('FSRS миграция:', e); }
  } catch (err) {
    console.error('IndexedDB:', err);
    ctx.userDb = null;
    ctx.settings = createSettings(memoryStorage());
  }

  if (clock.simulated) showSimBar(clock);
  if (ctx.userDb) {
    if (!clock.simulated) requestPersist().then((v) => { ctx.persisted = v; });
    try {
      const { manifest, view } = await ctx.data();
      // Първо пускане (D-017): предварително избраните ★ курсове, които имат данни.
      await ctx.userDb.applyFirstRun(view.courses.filter((c) => c.default && c.available).map((c) => c.id));
      const prev = await ctx.userDb.getMeta('dataVersion');
      if (prev !== manifest.dataVersion) {
        if (prev) ctx.dataUpdated = manifest.dataVersion;
        await ctx.userDb.setMeta('dataVersion', manifest.dataVersion);
      }
    } catch (err) {
      // Няма данни (напр. първо пускане без мрежа) — екраните показват „Опитай пак“.
      console.warn('Данните не се заредиха:', err);
    }
  }

  const main = document.getElementById('screen');
  const nav = document.getElementById('tabs');
  buildNav(nav);
  mountRouter(main, nav, ctx);
  document.documentElement.dataset.ready = '1';
  // За e2e и отстраняване на проблеми.
  globalThis.__lrn = ctx;
}

registerSW();
boot();
