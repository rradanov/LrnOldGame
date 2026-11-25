import { T } from '../../i18n/bg.js';
import { h, screenHeader } from '../dom.js';
import { createBoard } from '../board.js';

// T-002: само статична дъска в началната позиция, за да се види,
// че chess.js и cm-chessboard зареждат. Логиката идва в T-007.
export default {
  render(root, ctx) {
    const holder = h('div', { class: 'board-wrap', 'aria-label': T.explore.boardLabel });
    root.append(screenHeader(T.explore.title), holder, h('p', { class: 'empty-note' }, T.explore.empty));
    let board = null;
    try {
      board = createBoard(holder, {
        orientation: ctx.settings.get('boardOrientation') === 'black' ? 'b' : 'w',
        animationMs: ctx.settings.get('animationMs'),
      });
    } catch (err) {
      console.error(err);
      holder.replaceWith(h('p', { class: 'error' }, T.explore.loadError));
    }
    return () => board?.destroy();
  },
};
