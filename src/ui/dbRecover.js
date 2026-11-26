// T013-D7: съобщение при недостъпно хранилище + път за възстановяване:
// „Изтегли каквото може като бекъп“ и „Нулирай данните“ (с потвърждение), след което бекъпът се внася наново.
import { T, fmt } from '../i18n/bg.js';
import { rescueDump, resetDb } from '../db/rescue.js';
import { APP_VERSION } from '../version.js';
import { h, download } from './dom.js';

export function dbRecoverBox(ctx) {
  const msg = h('p', { class: 'saved', role: 'status', 'aria-live': 'polite', id: 'db-recover-msg' });
  const fail = (e) => { msg.classList.add('error'); msg.textContent = e?.message || String(e); };
  const ok = (t) => { msg.classList.remove('error'); msg.textContent = t; };
  const can = !!globalThis.indexedDB;
  return h('section', { class: 'db-recover', id: 'db-recover', role: 'alert' },
    h('p', { class: 'error' }, T.dbError),
    ctx.dbErrorText ? h('p', { class: 'hint', id: 'db-error-reason' }, fmt(T.dbRecover.reason, { reason: ctx.dbErrorText })) : null,
    can ? h('p', { class: 'hint' }, T.dbRecover.help) : null,
    can ? h('div', { class: 'btn-row' },
      h('button', {
        type: 'button', class: 'btn secondary', id: 'db-rescue',
        onclick: async () => {
          try {
            const b = await rescueDump({ name: ctx.dbName, appVersion: APP_VERSION });
            if (!b || !b.rescue.rows) { ok(T.dbRecover.nothing); return; }
            download(`lrnoldgame-rescue-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b, null, 1));
            ok(fmt(T.dbRecover.rescued, { n: b.rescue.rows }));
          } catch (e) { fail(e); }
        },
      }, T.dbRecover.rescue),
      h('button', {
        type: 'button', class: 'btn danger', id: 'db-reset',
        onclick: async () => {
          if (!confirm(T.dbRecover.resetConfirm)) return;
          try {
            await resetDb({ name: ctx.dbName });
            ok(T.dbRecover.resetDone);
            setTimeout(() => location.reload(), 400);
          } catch (e) { fail(e); }
        },
      }, T.dbRecover.reset),
    ) : null,
    msg,
  );
}
