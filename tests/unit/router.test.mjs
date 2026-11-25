import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, ROUTES, DEFAULT_ROUTE, hrefFor } from '../../src/router.js';

test('пет екрана в реда на долната лента', () => {
  assert.deepEqual(ROUTES, ['today', 'explore', 'repertoire', 'train', 'settings']);
});

test('parseHash разпознава пътищата и параметрите', () => {
  assert.equal(parseHash('').name, DEFAULT_ROUTE);
  assert.equal(parseHash('#/').name, DEFAULT_ROUTE);
  assert.equal(parseHash('#/explore').name, 'explore');
  assert.equal(parseHash('#settings').name, 'settings');
  const r = parseHash('#/train?card=5');
  assert.equal(r.name, 'train');
  assert.equal(r.params.get('card'), '5');
  const bad = parseHash('#/nope');
  assert.equal(bad.name, DEFAULT_ROUTE);
  assert.equal(bad.known, false);
  for (const n of ROUTES) assert.equal(parseHash(hrefFor(n)).name, n);
});
