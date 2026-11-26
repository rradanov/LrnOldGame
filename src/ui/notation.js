// T-028 (D-036): ходове с фигурки — малки фигури от същия комплект като дъската (спрайтът на cm-chessboard),
// бели за ходовете на белите и черни за ходовете на черните. Буквата остава в текста като скрит текст
// (за екранния четец и за textContent: „Nf3“), а на екрана се вижда фигурката.
import { sanTokens, moveItems } from '../chess/notation.js';
import { h } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Същият файл като ASSETS_URL в board.js (без импорт на cm-chessboard в екрани без дъска).
const SPRITE = './vendor/cm-chessboard/assets/pieces/standard.svg';

/** Фигурка (външна референция към спрайта: работи и в екрани без дъска; same-origin, CSP 'self'). */
export function figurine(color, piece, cls = 'fig') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', `${cls} fig-${color}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${SPRITE}#${color}${piece}`);
  svg.append(use);
  return svg;
}

/** Части на един ход (SAN) като DOM възли: фигурка + скрита буква, после текстът. */
export function sanNodes(san, color) {
  return sanTokens(san).map((t) => (typeof t === 'string'
    ? t
    : h('span', { class: 'fig-wrap', dataset: { piece: t.piece } }, figurine(color, t.piece), h('span', { class: 'visually-hidden' }, t.letter))));
}

/** Един ход с номер („1.“ / „3...“) като span. */
export function moveNode(num, san, color, attrs = {}) {
  return h('span', { class: 'san', ...attrs }, num, ...sanNodes(san, color));
}

/** Заместител на formatMoves(): ред от ходове с фигурки („1.e4 e5 2.♘f3 …“). */
export function movesLine(sans, opts = {}) {
  const { items, more } = moveItems(sans, opts);
  const out = [];
  items.forEach((it, k) => {
    if (k) out.push(' ');
    out.push(moveNode(it.num, it.san, it.color));
  });
  if (more) out.push(' …');
  return h('span', { class: 'fig-moves' }, ...out);
}
