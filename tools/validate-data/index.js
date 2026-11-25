#!/usr/bin/env node
// CLI: node tools/validate-data [опции]   (също: npm run validate-data)
// Изход: 0 — данните са валидни; 1 — има грешки; 2 — грешна употреба.
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAll } from './validate.js';
import { loadOpenings, OPENINGS_DIR } from './openings.js';

const HELP = `Валидатор на данните на LrnOldGame (T-015)

Употреба: node tools/validate-data [опции]

По подразбиране проверява под корена на репото:
  data/catalog.json            каталог (задължителен)
  data/manifest.json           генерирани курсове (ако има; без "sample")
  data/fixtures/manifest.json  тестови курсове (ако има; с "sample": true)

Опции:
  --root DIR          корен (по подразбиране — репото)
  --catalog FILE      друг каталог
  --manifest FILE     провери този manifest като истински данни (може няколко пъти)
  --sample FILE       провери този manifest като тестови данни (може няколко пъти)
  --openings DIR      папка с a.tsv…e.tsv (по подразбиране tools/chess-openings)
  --quiet             само грешките
  --help              тази помощ`;

function usage(msg) {
  process.stderr.write(`Грешка: ${msg}\n\n${HELP}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = { manifests: null, quiet: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const val = () => {
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) usage(`${a} изисква стойност`);
    return v;
  };
  switch (a) {
    case '--help': case '-h': process.stdout.write(`${HELP}\n`); process.exit(0); break;
    case '--root': opt.root = resolve(val()); break;
    case '--catalog': opt.catalog = resolve(val()); break;
    case '--manifest': (opt.manifests ||= []).push({ path: resolve(val()), expectSample: false }); break;
    case '--sample': (opt.manifests ||= []).push({ path: resolve(val()), expectSample: true }); break;
    case '--openings': opt.openings = resolve(val()); break;
    case '--quiet': opt.quiet = true; break;
    default: usage(`непозната опция „${a}“`);
  }
}

const root = opt.root || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!existsSync(root)) usage(`няма папка ${root}`);

let openings;
try {
  openings = loadOpenings(opt.openings || OPENINGS_DIR);
} catch (e) {
  process.stderr.write(`✗ chess-openings: ${e.message}\n`);
  process.exit(1);
}

const { errors, info } = validateAll({
  root, openings, catalogPath: opt.catalog || join(root, 'data', 'catalog.json'), manifests: opt.manifests || undefined,
});

if (!opt.quiet) for (const line of info) process.stdout.write(`  ${line}\n`);
for (const e of errors) process.stderr.write(`✗ ${e}\n`);
if (errors.length) {
  process.stderr.write(`\nДанните НЕ са валидни: ${errors.length} грешк${errors.length === 1 ? 'а' : 'и'}.\n`);
  process.exit(1);
}
if (!opt.quiet) process.stdout.write('✓ Данните са валидни.\n');
