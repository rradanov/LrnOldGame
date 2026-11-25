import { T, fmt } from '../../i18n/bg.js';
import { SETTINGS_GROUPS } from '../../settings.js';
import { APP_VERSION, BUILD } from '../../version.js';
import { h, screenHeader } from '../dom.js';

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
      h('section', { class: 'about' },
        h('h2', {}, T.settings.about),
        h('p', {}, `${T.settings.version} `, h('span', { id: 'app-version' }, APP_VERSION), ` (${BUILD})`),
        offline,
        h('p', { class: 'hint' }, T.settings.licenses),
      ),
    );
    return () => clearTimeout(timer);
  },
};
