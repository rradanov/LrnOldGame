import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, TABS, ROUTES, DEFAULT_ROUTE, hrefFor } from '../../src/router.js';

test('четири раздела в реда на долната лента (D-012)', () => {
  assert.deepEqual(TABS, ['courses', 'review', 'catalog', 'settings']);
  assert.equal(DEFAULT_ROUTE, 'courses');
  assert.ok(ROUTES.includes('course') && ROUTES.includes('train'));
});

test('parseHash разпознава пътищата, частите и параметрите', () => {
  assert.equal(parseHash('').name, DEFAULT_ROUTE);
  assert.equal(parseHash('#/').name, DEFAULT_ROUTE);
  assert.equal(parseHash('#/catalog').name, 'catalog');
  assert.equal(parseHash('#settings').name, 'settings');
  const c = parseHash('#/course/italian');
  assert.equal(c.name, 'course');
  assert.deepEqual(c.parts, ['italian']);
  assert.equal(c.tab, 'courses');
  const t = parseHash('#/train/caro-kann/8e89627b?mode=learn');
  assert.equal(t.name, 'train');
  assert.deepEqual(t.parts, ['caro-kann', '8e89627b']);
  assert.equal(t.params.get('mode'), 'learn');
  const bad = parseHash('#/nope/x');
  assert.equal(bad.name, DEFAULT_ROUTE);
  assert.equal(bad.known, false);
  assert.deepEqual(bad.parts, []);
  for (const n of TABS) assert.equal(parseHash(hrefFor(n)).name, n);
  assert.equal(hrefFor('course', 'vs-nf3'), '#/course/vs-nf3');
  assert.deepEqual(parseHash(hrefFor('train', 'a b', 'x/y')).parts, ['a b', 'x/y']);
});
