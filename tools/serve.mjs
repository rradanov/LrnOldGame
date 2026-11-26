// Малък статичен сървър без зависимости (за e2e и локален преглед).
// Сервира репото под /LrnOldGame/, както GitHub Pages, за да хванем
// грешки с абсолютни пътища. Употреба: node tools/serve.mjs [--port 4173]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE = '/LrnOldGame/';
const argPort = process.argv.indexOf('--port');
const PORT = Number(argPort > 0 ? process.argv[argPort + 1] : process.env.PORT || 4173);
// Само за e2e (--test): GET /__test/sw-build?b=xyz подменя BUILD в sw.js,
// за да се симулира нов деплой. Без --test пътят не съществува.
const TEST_MODE = process.argv.includes('--test');
let swBuildOverride = '';
// GET /__test/data-version?v=2026-12-01.1 подменя dataVersion в data/manifest.json (нов деплой на данни).
let dataVersionOverride = '';
const BLOCKED = ['node_modules', '.git', 'tests', 'test-results', 'playwright-report'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (TEST_MODE && url.pathname === '/__test/sw-build') {
      swBuildOverride = (url.searchParams.get('b') || '').replace(/[^\w-]/g, '');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(swBuildOverride || 'dev');
    }
    if (TEST_MODE && url.pathname === '/__test/data-version') {
      dataVersionOverride = (url.searchParams.get('v') || '').replace(/[^\w.-]/g, '');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(dataVersionOverride || '-');
    }
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(302, { Location: BASE });
      return res.end();
    }
    let rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(ROOT, rel));
    const top = rel.split('/')[0];
    if (!file.startsWith(ROOT + sep) || BLOCKED.includes(top)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    let body = await readFile(file);
    if (swBuildOverride && rel === 'sw.js') {
      body = body.toString('utf8').replace("const BUILD = 'dev';", `const BUILD = '${swBuildOverride}';`);
    }
    if (dataVersionOverride && rel === 'data/manifest.json') {
      const man = JSON.parse(body.toString('utf8'));
      man.dataVersion = dataVersionOverride;
      body = Buffer.from(JSON.stringify(man));
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
}).listen(PORT, () => {
  console.log(`LrnOldGame: http://localhost:${PORT}${BASE}`);
});
