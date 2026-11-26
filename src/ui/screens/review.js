// „Преговор днес“ (#/review) — опашката идва в T-020; засега празно състояние.
import { T } from '../../i18n/bg.js';
import { h, screenHeader } from '../dom.js';

export default {
  render(root) {
    root.append(
      screenHeader(T.review.title),
      h('div', { class: 'empty-state' },
        h('p', { class: 'empty-big' }, T.review.empty),
        h('p', { class: 'hint' }, T.review.hint)),
    );
  },
};
