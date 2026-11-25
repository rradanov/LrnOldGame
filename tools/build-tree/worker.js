// worker_threads: играе партиите от партида и брои ребрата (T-004).
// Съобщения: {type:'batch', games:[movetext]} → {type:'ack', counted, illegal, empty};
// {type:'finish'} → {type:'chunk', data:"ребро\tброй\n…"}… → {type:'done', stats}.
import { parentPort, workerData } from 'node:worker_threads';
import { EdgeCounter, gameEdges } from './counter.js';

const { maxPly, window, chunkEntries = 200000 } = workerData;
const counter = new EdgeCounter({ window });
let illegal = 0;
let empty = 0;

parentPort.on('message', (msg) => {
  if (msg.type === 'batch') {
    let counted = 0;
    let bad = 0;
    let none = 0;
    for (const text of msg.games) {
      const edges = gameEdges(text, maxPly);
      if (edges === null) bad++;
      else if (edges.length === 0) none++;
      else { counter.addGame(edges); counted++; }
    }
    illegal += bad;
    empty += none;
    parentPort.postMessage({ type: 'ack', counted, illegal: bad, empty: none });
  } else if (msg.type === 'finish') {
    counter.finalPrune();
    let buf = [];
    for (const [e, c] of counter.entries()) {
      buf.push(e + '\t' + c);
      if (buf.length >= chunkEntries) {
        parentPort.postMessage({ type: 'chunk', data: buf.join('\n') });
        buf = [];
      }
    }
    if (buf.length) parentPort.postMessage({ type: 'chunk', data: buf.join('\n') });
    parentPort.postMessage({
      type: 'done',
      stats: {
        games: counter.games, illegal, empty, entries: counter.size,
        peakEntries: counter.peakEntries, pruned: counter.pruned, maxUndercount: counter.maxUndercount,
      },
    });
  }
});
