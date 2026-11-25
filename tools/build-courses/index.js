#!/usr/bin/env node
// CLI: node tools/build-courses [опции]   (също: npm run build-courses -- …)
// Изход: 0 — готово и валидно; 1 — грешка (вкл. невалиден изход); 2 — грешна употреба; 130 — прекъснато.
import { parseCli, USAGE } from './config.js';
import { buildCourses } from './build.js';

let cli;
try {
  cli = parseCli(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`Грешка: ${e.message}\n\n${USAGE}\n`);
  process.exit(2);
}
if (cli.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const log = cli.quiet ? () => {} : (m) => process.stderr.write(`[build-courses] ${m}\n`);
const ac = new AbortController();
let interrupted = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { interrupted = true; ac.abort(); });
}

try {
  const r = await buildCourses({
    config: cli.config, catalogPath: cli.catalog, dataVersion: cli.dataVersion, built: cli.built, log, signal: ac.signal,
  });
  const t = r.totals;
  log(`готово: ${r.manifest.courses.length} курса, ${r.manifest.courses.reduce((s, c) => s + c.lines, 0)} линии, `
    + `оценки ${t.evals.requests} (кеш ${t.evals.hits}, двигател ${t.evals.misses}), ${t.seconds} s`);
  if (cli.config.output.report) log(`отчет: ${cli.config.output.report}`);
  if (r.errors.length) {
    for (const e of r.errors) process.stderr.write(`✗ ${e}\n`);
    process.stderr.write(`Изходът НЕ минава валидатора: ${r.errors.length} грешки.\n`);
    process.exit(1);
  }
} catch (e) {
  process.stderr.write(`Грешка: ${e.message}\n`);
  process.exit(interrupted ? 130 : 1);
}
