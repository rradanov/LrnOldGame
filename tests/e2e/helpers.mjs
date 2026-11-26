// Общи помощни функции за e2e на приемането (T-013). Не е spec (не съвпада с *.spec.mjs).
import { expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { lineFrames } from '../../src/train/session.js';

export const MANIFEST = JSON.parse(readFileSync(new URL('../../data/manifest.json', import.meta.url), 'utf8'));
export const course = (id) => JSON.parse(readFileSync(new URL(`../../data/courses/${id}.json`, import.meta.url), 'utf8'));
export const lineN = (c, n) => c.lines.find((l) => l.n === n);

// Екранни снимки само ако е зададена папка (локално: T013_SCREENS=/home/claude/t013/screens).
const SHOTS = process.env.T013_SCREENS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
export async function shot(page, name, opts = {}) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false, animations: 'disabled', ...opts });
}

export async function open(page, hash = '', search = '') {
  await page.goto(`./${search}${hash}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
}

export async function waitForSW(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
}

/** Бързи настройки, записани и в IDB. */
export async function fast(page, extra = {}) {
  await page.evaluate(async (o) => {
    for (const [k, v] of Object.entries(o)) globalThis.__lrn.settings.set(k, v);
    await globalThis.__lrn.userDb.flush();
  }, { opponentDelayMs: 0, animationMs: 0, wrongMoveMs: 100, errorPauseMs: 0, ...extra });
}

export async function center(page, sq) {
  const b = await page.locator(`.board-wrap rect[data-square="${sq}"]`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Ход с тап-тап (how = 'tap') или с плъзгане (how = 'drag'). */
export async function move(page, from, to, how = 'tap') {
  const a = await center(page, from);
  const b = await center(page, to);
  if (how === 'drag') {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
  } else {
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
  }
}

export const turn = (page) => page.evaluate(() => {
  const s = globalThis.__lrn.train?.session;
  return s ? `${s.phase()}@${s.ply}` : null;
});

/** Първият мой полуход на линията (с/без autoPlayStart). */
export const firstMine = (side, startPly = 0) => {
  const mine = side === 'w' ? 0 : 1;
  let i = mine;
  while (i < startPly) i += 2;
  return i;
};

/**
 * Изиграва моите ходове от полуход `from` докрай.
 * wrongAt: индекс на мой полуход, където първо се играе грешен ход `wrong` ([from,to]).
 * hintAt: индекс, където първо се натиска „Подсказка“.
 */
export async function playLine(page, line, side, { how = 'tap', from = null, wrongAt = -1, wrong = null, hintAt = -1, stopAt = -1 } = {}) {
  const frames = lineFrames(line.m);
  const start = from ?? (side === 'w' ? 0 : 1);
  for (let i = start; i < line.m.length; i += 2) {
    await expect.poll(() => turn(page)).toMatch(new RegExp(`^(user|correct)@${i}$`));
    if (i === stopAt) return;
    if (i === hintAt) {
      await page.locator('#hint-btn').click();
      await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', /hint/);
    }
    if (i === wrongAt) {
      await move(page, wrong[0], wrong[1], how);
      await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct');
    }
    const f = frames[i + 1].last;
    await move(page, f.from, f.to, how);
  }
  await expect(page.locator('#train-done')).toBeVisible();
}

/** Грешен, но легален ход за полуход i (първият легален различен ход от очаквания). */
export function wrongMoveFor(line, i) {
  const frames = lineFrames(line.m);
  const exp = frames[i + 1].last;
  return { exp, frames };
}

export const row = (page, c, id) => page.evaluate(([cc, ii]) => globalThis.__lrn.userDb.getLine(cc, ii), [c, id]);

/** Легален грешен ход в позицията преди полуход i (взима се от приложението). */
export async function legalWrong(page) {
  return page.evaluate(async () => {
    const { Position } = await import('./src/chess/position.js');
    const s = globalThis.__lrn.train.session;
    const fen = s.frame().fen;
    const exp = s.expected();
    const dests = new Position(fen).dests();
    for (const [from, tos] of dests) for (const to of tos) {
      if (!(from === exp.from && to === exp.to)) return [from, to];
    }
    return null;
  });
}
