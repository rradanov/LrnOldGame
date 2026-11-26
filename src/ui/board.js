// Единственото място, което познава cm-chessboard (ARCH §3).
import { Chessboard, COLOR, INPUT_EVENT_TYPE } from '../../vendor/cm-chessboard/src/Chessboard.js';
import { Markers, MARKER_TYPE } from '../../vendor/cm-chessboard/src/extensions/markers/Markers.js';
import { Arrows, ARROW_TYPE } from '../../vendor/cm-chessboard/src/extensions/arrows/Arrows.js';
import { START_FEN } from '../chess/position.js';

// Пътят е спрямо index.html, затова работи и под /LrnOldGame/ в GitHub Pages.
export const ASSETS_URL = './vendor/cm-chessboard/assets/';

// Собствени маркери (цветовете са в styles/app.css).
const MARK = {
  last: MARKER_TYPE.square,
  ok: { class: 'marker-ok', slice: 'markerSquare' },
  bad: { class: 'marker-bad', slice: 'markerSquare' },
  hint: { class: 'marker-hint', slice: 'markerFrame' },
  dest: MARKER_TYPE.dot,
  from: { class: 'marker-from', slice: 'markerSquare' },
};
const ARROW = { hint: ARROW_TYPE.success, correct: ARROW_TYPE.success };

/** Ориентация по настройка и страна на курса ('w'|'b'). */
export function orientationFor(setting, side = 'w') {
  if (setting === 'white') return 'w';
  if (setting === 'black') return 'b';
  return side === 'b' ? 'b' : 'w';
}

const PROMO_PIECES = [['q', 'Дама', '♛'], ['r', 'Топ', '♜'], ['b', 'Офицер', '♝'], ['n', 'Кон', '♞']];

/**
 * Дъска с по избор вход от потребителя (плъзгане и тап-тап; cm-chessboard ги поддържа сам).
 * @returns {{
 *   setPosition(fen: string, lastMove?: {from,to}|null, animate?: boolean): Promise<void>,
 *   enableInput(o: {color: 'w'|'b', dests: () => Map<string,string[]>, isPromotion: (from,to) => boolean,
 *     onMove: (m: {from, to, promotion?}) => void}): void,
 *   disableInput(): void,
 *   mark(square: string, kind: 'ok'|'bad'|'hint'|'last'): void,
 *   clearMarks(kind?: string): void,
 *   arrow(from: string, to: string): void,
 *   clearArrows(): void,
 *   destroy(): void,
 * }}
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
    extensions: [
      { class: Markers, props: { autoMarkers: null } },
      { class: Arrows },
    ],
  });
  let seq = 0;
  let promo = null;

  function clearMarks(kind) {
    if (kind) board.removeMarkers(MARK[kind]);
    else for (const k of Object.keys(MARK)) board.removeMarkers(MARK[k]);
  }

  /** Избор на фигура при промоция (HTML над дъската, с български надписи). */
  function askPromotion(color) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'promo-dialog';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Избери фигура');
      const finish = (v) => { box.remove(); promo = null; resolve(v); };
      for (const [p, label, sym] of PROMO_PIECES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `promo-btn promo-${color}`;
        b.dataset.piece = p;
        b.setAttribute('aria-label', label);
        b.textContent = sym;
        b.addEventListener('click', () => finish(p));
        box.append(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'promo-cancel';
      cancel.textContent = 'Отказ';
      cancel.addEventListener('click', () => finish(null));
      box.append(cancel);
      promo = finish;
      el.append(box);
    });
  }

  return {
    /** animate=false за скокове (⏮ ⏭); маркерът на последния ход е само за последната заявка. */
    async setPosition(nextFen, lastMove = null, animate = true) {
      const my = ++seq;
      board.removeMarkers(MARK.last);
      await board.setPosition(nextFen, animate && animationMs > 0);
      if (my !== seq) return;
      board.removeMarkers(MARK.last);
      if (lastMove) {
        board.addMarker(MARK.last, lastMove.from);
        board.addMarker(MARK.last, lastMove.to);
      }
    },
    enableInput({ color, dests, isPromotion, onMove }) {
      board.disableMoveInput();
      board.enableMoveInput((ev) => {
        switch (ev.type) {
          case INPUT_EVENT_TYPE.moveInputStarted: {
            const to = dests().get(ev.squareFrom) || [];
            if (!to.length) return false;
            board.removeMarkers(MARK.dest);
            board.removeMarkers(MARK.from);
            board.addMarker(MARK.from, ev.squareFrom);
            for (const sq of to) board.addMarker(MARK.dest, sq);
            return true;
          }
          case INPUT_EVENT_TYPE.validateMoveInput: {
            board.removeMarkers(MARK.dest);
            board.removeMarkers(MARK.from);
            const ok = (dests().get(ev.squareFrom) || []).includes(ev.squareTo);
            if (!ok) return false;
            const { squareFrom: from, squareTo: to } = ev;
            // Обработваме след movePiece на дъската, за да не се застъпят анимациите.
            setTimeout(async () => {
              if (isPromotion(from, to)) {
                const p = await askPromotion(color);
                onMove(p ? { from, to, promotion: p } : { from, to, canceled: true });
              } else {
                onMove({ from, to });
              }
            }, 0);
            return true;
          }
          case INPUT_EVENT_TYPE.moveInputCanceled:
            board.removeMarkers(MARK.dest);
            board.removeMarkers(MARK.from);
            return undefined;
          default:
            return undefined;
        }
      }, color === 'b' ? COLOR.black : COLOR.white);
    },
    disableInput() {
      board.disableMoveInput();
      board.removeMarkers(MARK.dest);
      board.removeMarkers(MARK.from);
    },
    mark(square, kind) { board.addMarker(MARK[kind], square); },
    clearMarks,
    arrow(from, to) { board.addArrow(ARROW.hint, from, to); },
    clearArrows() { board.removeArrows(); },
    destroy() { promo?.(null); board.destroy(); },
  };
}
