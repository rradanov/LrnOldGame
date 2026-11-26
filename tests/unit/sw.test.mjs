// Проверки на app shell: версии, списък за precache, manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../../src/version.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sw = read('sw.js');

function shellList() {
  const m = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(m, 'SHELL в sw.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Всички относителни импорти (статични и динамични), достижими от входния файл. */
function importGraph(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
    for (const m of src.matchAll(re)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec.startsWith('.')) throw new Error(`bare import „${spec}“ в ${file}`);
      stack.push(relative(ROOT, normalize(join(ROOT, dirname(file), spec))).split('\\').join('/'));
    }
  }
  return seen;
}

test('версията е една и съща в sw.js, src/version.js и package.json', () => {
  const swVer = sw.match(/const APP_VERSION = '([^']+)'/)[1];
  const pkg = JSON.parse(read('package.json'));
  assert.equal(swVer, APP_VERSION);
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(APP_VERSION, '0.3.0');
  assert.match(sw, /const BUILD = 'dev';/, 'BUILD се заменя от deploy.yml');
});

test('всеки файл от SHELL съществува', () => {
  for (const p of shellList()) {
    if (p === './') continue;
    assert.ok(existsSync(join(ROOT, p)), `липсва ${p}`);
  }
});

test('SHELL съдържа всички модули, достижими от src/app.js', () => {
  const shell = new Set(shellList());
  const missing = [...importGraph('src/app.js')].filter((f) => !shell.has(f));
  assert.deepEqual(missing, [], 'добави ги в SHELL в sw.js');
});

test('SHELL съдържа стиловете и иконките от index.html и manifest', () => {
  const shell = new Set(shellList());
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
    assert.ok(shell.has(m[1]), `index.html → ${m[1]} липсва в SHELL`);
  }
  const man = JSON.parse(read('manifest.webmanifest'));
  for (const icon of man.icons) assert.ok(shell.has(icon.src), `иконка ${icon.src}`);
});

test('manifest: име, БГ, портрет, относителни пътища, иконки 192 и 512', () => {
  const man = JSON.parse(read('manifest.webmanifest'));
  assert.equal(man.name, 'LrnOldGame');
  assert.equal(man.lang, 'bg');
  assert.equal(man.orientation, 'portrait');
  assert.equal(man.display, 'standalone');
  assert.ok(!man.start_url.startsWith('/') && !man.scope.startsWith('/'), 'относителни пътища за /LrnOldGame/');
  const sizes = man.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(man.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of man.icons) assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
});

test('vendor: версии и лицензи', () => {
  assert.equal(read('vendor/chess.js/VERSION').trim(), '1.4.0');
  assert.match(read('vendor/cm-chessboard/VERSION').trim(), /^8\./);
  assert.match(read('vendor/chess.js/LICENSE'), /Redistribution and use/);
  assert.match(read('vendor/cm-chessboard/LICENSE'), /MIT License/);
  assert.ok(!existsSync(join(ROOT, 'vendor/cm-chessboard/assets/pieces/staunty.svg')), 'staunty (NC) не се ползва');
});

test('SW кешира данните: catalog, manifest и всички курсове от manifest (D-023)', () => {
  assert.match(sw, /const DATA_BASE = 'data\/';/);
  assert.match(sw, /const DATA_INDEX = \['catalog\.json', 'manifest\.json'\];/);
  assert.match(sw, /manifest\.courses/);
  assert.match(sw, /await precacheData\(cache\)/);
  // Тестовите данни не са в shell-а и не се зареждат от приложението.
  assert.ok(!shellList().some((p) => p.includes('fixtures')));
  for (const f of importGraph('src/app.js')) assert.ok(!read(f).includes('fixtures/'), `${f} не сочи data/fixtures`);
});

test('всеки файл от data/manifest.json съществува и SHA-256 съвпада', async () => {
  const { createHash } = await import('node:crypto');
  const man = JSON.parse(read('data/manifest.json'));
  assert.ok(!man.sample, 'в продукция няма тестови данни');
  assert.ok(man.courses.length >= 1);
  for (const c of man.courses) {
    const buf = readFileSync(join(ROOT, 'data', c.file));
    assert.equal(createHash('sha256').update(buf).digest('hex'), c.sha256, c.file);
  }
});
