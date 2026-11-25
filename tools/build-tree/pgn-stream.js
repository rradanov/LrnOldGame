// Поточно разделяне на PGN на партии (T-004). Без зависимости.
// Вход: Readable (stdin, файл) или async iterable от Buffer/низове.
// Изход: async генератор на {headers, moves, bad}. Ако потребителят спре
// итерацията (break), потокът се унищожава — горната част на pipe-а
// получава EPIPE/SIGPIPE и спира (D-014).
import { StringDecoder } from 'node:string_decoder';

const HEADER_RE = /^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/;

/** Нова партия: хедъри, редове с ходове, флаг за повреден хедър. */
function newGame() {
  return { headers: Object.create(null), lines: [], bad: false, hasHeaders: false };
}

function finish(g) {
  return { headers: g.headers, moves: g.lines.join(' '), bad: g.bad };
}

/**
 * Разделя PGN поток на партии. Нова партия започва с `[Event ` или с хедър,
 * който идва след ходове (ресинхронизация при повреден файл). Ред, който
 * започва с „[“, но не е валиден хедър, маркира партията като `bad`.
 * Празни „партии“ (само празни редове) не се връщат.
 * @param {AsyncIterable<Buffer|string>} input
 */
export async function* readGames(input) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  let g = newGame();

  function* onLine(raw) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.length === 0) return;
    if (line.charCodeAt(0) === 91 /* [ */) {
      const m = HEADER_RE.exec(line);
      const isEvent = m ? m[1] === 'Event' : line.startsWith('[Event ');
      if (g.lines.length || (isEvent && g.hasHeaders)) {
        yield finish(g);
        g = newGame();
      }
      g.hasHeaders = true;
      if (m) g.headers[m[1]] = m[2].replace(/\\(.)/g, '$1');
      else g.bad = true;
      return;
    }
    if (line.charCodeAt(0) === 37 /* % escape */) return;
    g.lines.push(line);
  }

  for await (const chunk of input) {
    const text = rest + (typeof chunk === 'string' ? chunk : decoder.write(chunk));
    let start = 0;
    let nl;
    while ((nl = text.indexOf('\n', start)) !== -1) {
      yield* onLine(text.slice(start, nl));
      start = nl + 1;
    }
    rest = text.slice(start);
  }
  rest += decoder.end();
  if (rest) yield* onLine(rest);
  if (g.hasHeaders || g.lines.length) yield finish(g);
}
