// Bootstrap: настройки, долна лента, hash router, Service Worker.
import { T } from './i18n/bg.js';
import { createSettings, localStorageBackend } from './settings.js';
import { ROUTES, startRouter, hrefFor } from './router.js';
import { h } from './ui/dom.js';
import home from './ui/screens/home.js';
import explore from './ui/screens/explore.js';
import repertoire from './ui/screens/repertoire.js';
import train from './ui/screens/train.js';
import settingsScreen from './ui/screens/settings.js';

const SCREENS = { today: home, explore, repertoire, train, settings: settingsScreen };

// Символи за разделите; U+FE0E иска текстово (не емоджи) изобразяване.
const TAB_ICONS = {
  today: '☀︎',
  explore: '♞︎',
  repertoire: '☰︎',
  train: '⟳︎',
  settings: '⚙︎',
};

const ctx = {
  settings: createSettings(localStorageBackend('lrnoldgame.settings.v1')),
};

function buildNav(nav) {
  nav.replaceChildren(...ROUTES.map((name) =>
    h('a', { href: hrefFor(name), class: 'tab', dataset: { route: name } },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, TAB_ICONS[name]),
      h('span', { class: 'tab-label' }, T.tabs[name]),
    )));
}

function mountRouter(main, nav) {
  let cleanup = null;
  startRouter((route) => {
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    main.replaceChildren();
    main.dataset.screen = route.name;
    for (const a of nav.querySelectorAll('a.tab')) {
      if (a.dataset.route === route.name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title = `${T.tabs[route.name]} · ${T.appName}`;
    const screen = SCREENS[route.name];
    const res = screen.render(main, ctx, route);
    cleanup = typeof res === 'function' ? res : null;
    main.scrollTop = 0;
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

const main = document.getElementById('screen');
const nav = document.getElementById('tabs');
buildNav(nav);
mountRouter(main, nav);
registerSW();
