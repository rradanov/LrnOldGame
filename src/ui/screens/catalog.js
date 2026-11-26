// „Каталог“ (#/catalog) — ARCH_T-014 §5.1, D-017.
import { T, fmt } from '../../i18n/bg.js';
import { formatMoves } from '../../data/courseStore.js';
import { h, screenHeader, asyncBlock } from '../dom.js';

// Филтърът се помни, докато приложението е отворено.
const state = { side: 'w', group: 'all' };

async function load(ctx) {
  const { view } = await ctx.data();
  const selected = ctx.userDb ? await ctx.userDb.selectedIds() : new Set();
  const banner = ctx.userDb ? await ctx.userDb.getMeta('suggestedBanner', false) : false;
  return { view, selected, banner };
}

function segmented(name, options, value, onPick) {
  return h('div', { class: 'segmented', role: 'group', dataset: { filter: name } },
    options.map(([v, label]) => h('button', {
      type: 'button', class: 'seg', 'aria-pressed': String(v === value), dataset: { value: v },
      onclick: () => onPick(v),
    }, label)));
}

export default {
  render(root, ctx) {
    let alive = true;
    root.append(screenHeader(T.catalog.title));
    asyncBlock(root, () => load(ctx), (box, { view, selected, banner }) => {
      const count = h('p', { class: 'hint', id: 'catalog-count' });
      const updateCount = () => { count.textContent = fmt(T.catalog.count, { n: selected.size }); };

      if (banner) {
        const bar = h('div', { class: 'notice suggested', role: 'status' },
          h('span', {}, T.catalog.suggested),
          h('button', {
            type: 'button', class: 'btn secondary small',
            onclick: async (e) => {
              // T-024: първо записът (иначе бързо затваряне/презареждане връща банера), после махането.
              e.currentTarget.disabled = true;
              try { await ctx.userDb.setMeta('suggestedBanner', false); } catch (err) { console.error(err); }
              bar.remove();
            },
          }, T.catalog.dismiss));
        box.append(bar);
      }

      const filters = h('div', { class: 'filters' });
      const list = h('ul', { class: 'catalog-list' });

      function row(c) {
        const id = `pick-${c.id}`;
        const input = h('input', {
          type: 'checkbox', id, class: 'pick', dataset: { course: c.id },
          disabled: !c.available || !ctx.userDb,
        });
        input.checked = selected.has(c.id);
        input.addEventListener('change', async () => {
          const on = input.checked;
          input.disabled = true;
          try {
            await ctx.userDb.setSelected(c.id, on);
            if (on) selected.add(c.id); else selected.delete(c.id);
          } catch (e) {
            console.error(e);
            input.checked = !on;
          } finally {
            input.disabled = false;
            updateCount();
          }
        });
        const meta = c.available ? fmt(T.catalog.lines, { n: c.lines }) : T.catalog.notGenerated;
        return h('li', { class: `catalog-row${c.available ? '' : ' unavailable'}`, dataset: { course: c.id, group: c.group } },
          h('label', { for: id },
            h('span', { class: 'cr-body' },
              h('span', { class: 'cr-name' }, c.name.bg),
              h('span', { class: 'cr-en' }, c.name.en),
              h('span', { class: 'cr-meta' },
                h('span', { class: 'eco' }, c.eco), ' · ',
                h('span', { class: 'cr-start' }, c.start.length ? formatMoves(c.start) : '—'), ' · ',
                h('span', { class: 'cr-lines' }, meta)),
            ),
            h('span', { class: 'cr-pick' }, input, h('span', { class: 'visually-hidden' }, T.catalog.learnIt)),
          ));
      }

      function draw() {
        const groups = view.groups.filter((g) => g.sides.includes(state.side));
        if (state.group !== 'all' && !groups.some((g) => g.id === state.group)) state.group = 'all';
        filters.replaceChildren(
          segmented('side', [['w', `${T.sideIcon.w} ${T.side.w}`], ['b', `${T.sideIcon.b} ${T.side.b}`]], state.side,
            (v) => { state.side = v; state.group = 'all'; draw(); }),
          h('div', { class: 'chips', role: 'group', dataset: { filter: 'group' } },
            [['all', T.catalog.allGroups], ...groups.map((g) => [g.id, g.label])].map(([v, label]) => h('button', {
              type: 'button', class: 'chip', 'aria-pressed': String(v === state.group), dataset: { value: v },
              onclick: () => { state.group = v; draw(); },
            }, label))),
        );
        const shown = view.courses.filter((c) => c.side === state.side && (state.group === 'all' || c.group === state.group));
        list.replaceChildren(...shown.map(row));
      }

      draw();
      updateCount();
      box.append(filters, count, list);
    }, () => alive);
    return () => { alive = false; };
  },
};
