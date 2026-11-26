// Единственото място, което познава cm-chessboard (ARCH §3).
import { Chessboard, COLOR } from '../../vendor/cm-chessboard/src/Chessboard.js';
import { Markers, MARKER_TYPE } from '../../vendor/cm-chessboard/src/extensions/markers/Markers.js';
import { START_FEN } from '../chess/position.js';

// Пътят е спрямо index.html, затова работи и под /LrnOldGame/ в GitHub Pages.
export const ASSETS_URL = './vendor/cm-chessboard/assets/';

/** Ориентация по настройка и страна на курса ('w'|'b'). */
export function orientationFor(setting, side = 'w') {
  if (setting === 'white') return 'w';
  if (setting === 'black') return 'b';
  return side === 'b' ? 'b' : 'w';
}

/**
 * Дъска само за преглед (без вход).
 * @returns {{setPosition(fen: string, lastMove?: {from,to}|null): Promise<void>, destroy(): void}}
 */
export function createBoard(el, { fen = START_FEN, orientation = 'w', animationMs = 300 } = {}) {
  const board = new Chessboard(el, {
    position: fen,
    orientation: orientation === 'b' ? COLOR.black : COLOR.white,
    assetsUrl: ASSETS_URL,
    style: {
      cssClass: 'default',
      showCoordinates: true,
      pieces: { file: 'pieces/standard.svg' },
      animationDuration: animationMs,
    },
    extensions: [{ class: Markers, props: { autoMarkers: null } }],
  });
  let seq = 0;
  return {
    /** animate=false за скокове (⏮ ⏭); маркерите са само за последната заявка. */
    async setPosition(nextFen, lastMove = null, animate = true) {
      const my = ++seq;
      board.removeMarkers(MARKER_TYPE.square);
      await board.setPosition(nextFen, animate && animationMs > 0);
      if (my !== seq) return;
      board.removeMarkers(MARKER_TYPE.square);
      if (lastMove) {
        board.addMarker(MARKER_TYPE.square, lastMove.from);
        board.addMarker(MARKER_TYPE.square, lastMove.to);
      }
    },
    destroy() { board.destroy(); },
  };
}
