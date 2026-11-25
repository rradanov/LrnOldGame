#!/usr/bin/env node
// CLI: дърво от lichess PGN (T-004). Пример (T-017):
//   curl -sL <url> | zstd -dc | node tools/build-tree --max-games 2000000 --out build/tree.jsonl.gz
// След --max-games приети партии stdin се затваря; curl/zstd спират с SIGPIPE.
import { createReadStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildTree } from './build.js';
import { parseCli, USAGE } from './config.js';
import { writeTree } from './tree-file.js';

async function main() {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`build-tree: ${e.message}\n${USAGE}\n`);
    return 2;
  }
  if (cli.help) { process.stdout.write(USAGE + '\n'); return 0; }

  const input = cli.input ? createReadStream(cli.input, { highWaterMark: 1 << 20 }) : process.stdin;
  const log = (s) => { if (!cli.quiet) process.stderr.write(s + '\n'); };
  const p = cli.tree;
  log(`build-tree: вход ${cli.input ?? 'stdin'} · Elo ${p.minElo}–${p.maxElo || '∞'} (двамата) · база ≥ ${p.minBaseSec}s` +
    `${p.maxBaseSec ? ` ≤ ${p.maxBaseSec}s` : ''} · ${p.ratedOnly ? 'само рейтингови' : 'всички'} · maxGames ${p.maxGames} · maxPly ${p.maxPly}`);

  const { manifest, nodes } = await buildTree(input, {
    tree: p,
    source: cli.source,
    inputName: cli.input ? resolve(cli.input) : 'stdin',
    onProgress: cli.quiet ? null : (s) => log(
      `  [${s.phase}] ${s.seconds.toFixed(0)}s · прочетени ${s.read} · приети ${s.accepted} · преброени ${s.counted} · ` +
      `${Math.round(s.accepted / Math.max(s.seconds, 1e-9))} партии/s · RSS ${s.rssMb.toFixed(0)} MB`),
  });
  if (input !== process.stdin) input.destroy();
  else process.stdin.destroy();

  mkdirSync(dirname(resolve(cli.out)), { recursive: true });
  const { bytes } = await writeTree(cli.out, manifest, nodes);
  const st = manifest.stats;
  const r = manifest.run;
  log(`build-tree: ${st.stoppedBy === 'maxGames' ? 'спрях при maxGames' : 'край на входа'} · прочетени ${st.gamesRead} · ` +
    `приети ${st.gamesAccepted} · преброени ${st.gamesCounted} (невалидни ${st.gamesIllegal}) · позиции ${st.nodes} · ходове ${st.moves}`);
  log(`  отхвърлени: ${JSON.stringify(st.rejected)} · lossy: макс. подброяване ${st.lossy.maxUndercount}, изрязани ${st.lossy.pruned}`);
  log(`  ${r.seconds}s (четене ${r.readSeconds}s) · ${r.gamesPerSec} приети партии/s · ${r.workers} нишки · пик RSS ${r.peakRssMb} MB · ${cli.out} ${(bytes / 2 ** 20).toFixed(2)} MB`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => {
  process.stderr.write(`build-tree: грешка: ${e.stack ?? e}\n`);
  process.exitCode = 1;
});
