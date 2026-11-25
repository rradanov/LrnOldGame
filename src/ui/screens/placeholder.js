import { h, screenHeader } from '../dom.js';

/** Празен екран със заглавие и кратък текст (за T-002). */
export function placeholderScreen(title, text) {
  return {
    render(root) {
      root.append(screenHeader(title), h('p', { class: 'empty-note' }, text));
    },
  };
}
