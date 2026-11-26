// Bootstrap: IndexedDB, настройки, данни на курсовете, долна лента, hash router, Service Worker.
import { T } from './i18n/bg.js';
import { createSettings, memoryStorage } from './settings.js';
import { TABS, startRouter, hrefFor } from './router.js';
import { openUserDb } from './db/userdb.js';
import { createCourseStore } from './data/courseStore.js';
import { h } from './ui/dom.js';
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
    )));
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

async function boot() {
  const ctx = { userDb: null, settings: null, store: createCourseStore(), persisted: null, dataUpdated: null };

  let viewP = null;
  ctx.data = () => (viewP ||= ctx.store.loadView().catch((e) => { viewP = null; throw e; }));

  try {
    ctx.userDb = await openUserDb();
    await ctx.userDb.migrateLegacySettings(globalThis.localStorage);
    const stored = await ctx.userDb.loadSettings();
    ctx.settings = createSettings({ load: () => stored, save: (obj) => ctx.userDb.saveSettings(obj) });
  } catch (err) {
    console.error('IndexedDB:', err);
    ctx.userDb = null;
    ctx.settings = createSettings(memoryStorage());
  }

  if (ctx.userDb) {
    requestPersist().then((v) => { ctx.persisted = v; });
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
