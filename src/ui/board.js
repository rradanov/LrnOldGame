// Единственото място, което познава cm-chessboard (ARCH §3).
import { Chessboard } from '../../vendor/cm-chessboard/src/Chessboard.js';
import { Chess } from '../../vendor/chess.js/chess.js';

// Пътят е спрямо index.html, затова работи и под /LrnOldGame/ в GitHub Pages.
export const ASSETS_URL = './vendor/cm-chessboard/assets/';

/** Създава дъска в началната позиция (FEN от chess.js). */
export function createBoard(el, { orientation = 'w', animationMs = 300 } = {}) {
  const fen = new Chess().fen();
  const board = new Chessboard(el, {
    position: fen,
    orientation,
    assetsUrl: ASSETS_URL,
    style: {
      cssClass: 'default',
      showCoordinates: true,
      pieces: { file: 'pieces/standard.svg' },
      animationDuration: animationMs,
    },
  });
  return board;
}
