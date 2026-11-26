import { T, fmt, GEN_PARAM_LABELS } from '../../i18n/bg.js';
import { SETTINGS_GROUPS } from '../../settings.js';
import { APP_VERSION, BUILD } from '../../version.js';
import { dataSummary } from '../../data/courseStore.js';
import { checkBackup } from '../../db/userdb.js';
import { h, screenHeader, asyncBlock } from '../dom.js';

const fmtDate = (v) => {
  if (!v) return T.backup.never;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('bg-BG', { dateStyle: 'medium', timeStyle: 'short' });
};
const num = (n) => (typeof n === 'number' ? n.toLocaleString('bg-BG') : String(n ?? '—'));

/** „Данни на курсовете“: версия, дата, параметри на генерирането (D-013). */
function dataSection(ctx, isAlive) {
  const sec = h('section', { class: 'data-info', id: 'data-info' }, h('h2', {}, T.data.title));
  asyncBlock(sec, () => ctx.data(), (box, { manifest }) => {
    const s = dataSummary(manifest);
    if (!s) { box.append(h('p', { class: 'hint' }, T.data.none)); return; }
    const src = s.source || {};
    const f = src.filters || {};
    const elo = f.maxElo ? `${f.minElo}–${f.maxElo}` : `≥ ${f.minElo ?? 0}`;
    const lines = s.params.lines || {};
    box.append(...[
      s.sample ? h('p', { class: 'error' }, T.data.sample) : null,
      h('p', {}, `${T.data.version}: `, h('strong', { id: 'data-version' }, s.dataVersion)),
      h('p', {}, `${T.data.built}: ${fmtDate(s.built)}`),
      h('p', { id: 'data-counts' }, fmt(T.data.counts, { courses: s.courses, lines: s.lines })),
      src.month ? h('p', { class: 'hint' }, fmt(T.data.source, {
        month: src.month, elo, base: Math.round((f.minBaseSec ?? 0) / 60), games: num(src.gamesAccepted),
      })) : null,
      s.engine?.nodes ? h('p', { class: 'hint' }, fmt(T.data.engine, { engine: s.engine.id || `${s.engine.name} ${s.engine.version}`, nodes: num(s.engine.nodes) })) : null,
      Object.keys(lines).length ? h('details', { class: 'gen-params' },
        h('summary', {}, T.data.params),
        h('dl', {}, Object.entries(lines).flatMap(([k, v]) => [
          h('dt', {}, GEN_PARAM_LABELS[k] || k, h('code', {}, ` ${k}`)),
          h('dd', {}, Array.isArray(v) ? v.join(', ') : String(v)),
        ])),
      ) : null,
    ].filter(Boolean));
  }, isAlive);
  return sec;
}

/** Външна връзка (отваря се в браузъра, не в приложението). */
const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

/** „За приложението“ (T-012): версия, версия на данните, лицензи и атрибуции, репо. */
function aboutSection(ctx, offline, isAlive) {
  const A = T.about;
  const dataV = h('span', { id: 'about-data-version' }, '…');
  ctx.data().then(({ manifest }) => { if (isAlive()) dataV.textContent = manifest?.dataVersion || '—'; }, () => { dataV.textContent = '—'; });
  const items = A.items.map((it) => h('li', { dataset: { lib: it.id } },
    h('strong', {}, it.href ? ext(it.href, it.name) : it.name),
    ` — ${it.license}`,
    it.licenseHref ? [' ', h('span', { class: 'nowrap' }, '(', ext(it.licenseHref, A.licenseText), ')')] : null,
    it.note ? h('span', { class: 'hint about-note' }, ` ${it.note}`) : null));
  return h('section', { class: 'about', id: 'about' },
    h('h2', {}, T.settings.about),
    h('p', {}, `${T.settings.version} `, h('strong', { id: 'app-version' }, APP_VERSION), ` (${BUILD})`),
    h('p', {}, `${A.dataVersion}: `, dataV),
    offline,
    h('p', {}, A.appLicense, ' ', ext(A.repo, A.repoText)),
    h('h3', { class: 'about-h3' }, A.licensesTitle),
    h('ul', { class: 'about-list', id: 'licenses' }, items),
    h('p', { class: 'hint' }, A.stockfish),
  );
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Бекъп: изтегли/зареди JSON (D-010) и състояние на постоянното хранилище. */
function backupSection(ctx) {
  const sec = h('section', { class: 'backup', id: 'backup' }, h('h2', {}, T.backup.title));
  if (!ctx.userDb) { sec.append(h('p', { class: 'error' }, T.dbError)); return sec; }
  const msg = h('p', { class: 'saved', role: 'status', 'aria-live': 'polite', id: 'backup-msg' });
  const persisted = ctx.persisted === true ? T.backup.persisted : ctx.persisted === false ? T.backup.notPersisted : T.backup.unknown;
  const last = h('p', { class: 'hint', id: 'last-backup' });
  ctx.userDb.getMeta('lastBackup').then((v) => { last.textContent = fmt(T.backup.last, { when: fmtDate(v) }); });
  const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'backup-file', class: 'visually-hidden' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { msg.textContent = T.backup.badFile; msg.classList.add('error'); return; }
    try { checkBackup(obj); } catch (e) { msg.classList.add('error'); msg.textContent = e.message; return; }
    if (!confirm(T.backup.importConfirm)) return;
    try {
      await ctx.userDb.importBackup(obj);
      msg.classList.remove('error');
      msg.textContent = T.backup.imported;
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      msg.classList.add('error');
      msg.textContent = e.message;
    }
  });
  sec.append(
    h('p', { class: 'hint', id: 'persist-state' }, fmt(T.backup.storage, { state: persisted })),
    last,
    h('div', { class: 'btn-row' },
      h('button', {
        type: 'button', class: 'btn', id: 'backup-export',
        onclick: async () => {
          const manifest = await ctx.data().then((d) => d.manifest).catch(() => null);
          const b = await ctx.userDb.exportBackup({ appVersion: APP_VERSION, dataVersion: manifest?.dataVersion ?? null });
          download(`lrnoldgame-backup-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b, null, 1));
          msg.classList.remove('error');
          msg.textContent = T.backup.exported;
          last.textContent = fmt(T.backup.last, { when: fmtDate(Date.parse(b.exportedAt)) });
        },
      }, T.backup.export),
      h('label', { class: 'btn secondary', for: 'backup-file' }, T.backup.import),
      file,
    ),
    msg,
  );
  return sec;
}

function displayValue(def, v) {
  if (def.type === 'enum') return def.options.find(([val]) => val === v)?.[1] ?? String(v);
  return def.unit ? `${v} ${def.unit}` : String(v);
}

function field(def, settings, onSaved, refreshers) {
  const id = `set-${def.key}`;
  let input;
  if (def.type === 'enum') {
    input = h('select', { id, name: def.key },
      def.options.map(([val, label]) => h('option', { value: val }, label)));
    input.value = settings.get(def.key);
  } else if (def.type === 'bool') {
    input = h('input', { id, name: def.key, type: 'checkbox' });
    input.checked = settings.get(def.key);
  } else {
    input = h('input', {
      id, name: def.key, type: 'number', inputmode: def.type === 'int' ? 'numeric' : 'decimal',
      min: def.min, max: def.max, step: def.step ?? (def.type === 'int' ? 1 : 'any'),
    });
    input.value = String(settings.get(def.key));
  }

  // Изречения: пояснение. Допустимо: 0–100 %. По подразбиране: 10.
  const sentence = (txt) => (/[.!?]$/.test(txt) ? txt : `${txt}.`);
  const hintParts = [];
  if (def.help) hintParts.push(sentence(def.help));
  if (def.min !== undefined && def.max !== undefined) {
    hintParts.push(sentence(fmt(T.settings.range, { min: def.min, max: def.max }) + (def.unit ? ` ${def.unit}` : '')));
  }
  hintParts.push(sentence(`${T.settings.defaultHint}: ${displayValue(def, def.default)}`));

  const refresh = () => {
    const v = settings.get(def.key);
    if (def.type === 'bool') input.checked = v; else input.value = String(v);
  };
  refreshers.push(refresh);

  input.addEventListener('change', () => {
    const raw = def.type === 'bool' ? input.checked : input.value;
    settings.set(def.key, raw);
    refresh(); // показваме нормализираната (притисната) стойност
    onSaved();
  });

  return h('div', { class: 'field', dataset: { key: def.key } },
    h('label', { for: id }, def.label, def.unit ? h('span', { class: 'unit' }, ` (${def.unit})`) : null),
    input,
    h('p', { class: 'hint' }, hintParts.join(' ')),
  );
}

export default {
  render(root, ctx) {
    const { settings } = ctx;
    let alive = true;
    const status = h('p', { class: 'saved', role: 'status', 'aria-live': 'polite' });
    let timer = 0;
    const onSaved = () => {
      status.textContent = T.settings.saved;
      clearTimeout(timer);
      timer = setTimeout(() => { status.textContent = ''; }, 1500);
    };

    const refreshers = [];
    const form = h('form', { class: 'settings', onsubmit: (e) => e.preventDefault() });
    for (const [group, title] of SETTINGS_GROUPS) {
      const defs = settings.schema.filter((d) => d.group === group);
      if (!defs.length) continue;
      form.append(h('fieldset', {}, h('legend', {}, title), defs.map((d) => field(d, settings, onSaved, refreshers))));
    }

    const resetBtn = h('button', {
      type: 'button', class: 'btn secondary',
      onclick: () => {
        if (!confirm(T.settings.resetConfirm)) return;
        settings.reset();
        refreshers.forEach((fn) => fn());
        onSaved();
      },
    }, T.settings.reset);

    const offline = h('p', { class: 'hint', id: 'offline-status' },
      navigator.serviceWorker?.controller ? T.settings.offlineReady : T.settings.offlineNotReady);

    root.append(
      screenHeader(T.settings.title),
      h('p', { class: 'hint' }, T.settings.intro),
      form,
      status,
      resetBtn,
      dataSection(ctx, () => alive),
      backupSection(ctx),
      aboutSection(ctx, offline, () => alive),
    );
    // „Към бекъпа“ от напомнянето в „Курсове“.
    if (ctx.scrollTo) {
      const target = ctx.scrollTo;
      ctx.scrollTo = null;
      setTimeout(() => { if (alive) document.getElementById(target)?.scrollIntoView({ block: 'start' }); }, 0);
    }
    return () => { alive = false; clearTimeout(timer); };
  },
};
