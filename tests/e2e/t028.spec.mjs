// T-028 (D-033…D-037): „По-малко текст, повече иконки“ — крушка встрани, една иконка „Пак“, отметки ✓,
// индикатор за хода, оценка от Stockfish (поле ev; тук от fixture), фигурна нотация, Назад/Напред в края
// и в прегледа от Курс. Pixel 7. Снимки: T028_SCREENS=/home/claude/t028 npx playwright test t028
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import {
  course, lineN, open, fast, move, turn, playLine, row, legalWrong, iconBar, againBtn, nextBtn, hintBtn,
  backBtn, fwdBtn, checks, doneKind, firstMine, boardSpan,
} from './helpers.mjs';

const ITALIAN = course('italian');
const I1 = lineN(ITALIAN, 1);
const FIX_PATH = new URL('../fixtures/ev-italian.json', import.meta.url);
const FIX = JSON.parse(readFileSync(FIX_PATH, 'utf8'));
const F1 = FIX.lines.find((l) => l.n === 1);
const F2 = FIX.lines.find((l) => l.n === 2);
const SHOTS = process.env.T028_SCREENS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const disabled = (loc) => expect(loc).toHaveAttribute('aria-disabled', 'true');
const enabled = (loc) => expect(loc).toHaveAttribute('aria-disabled', 'false');
const attempts = (page, id) => page.evaluate((i) => globalThis.__lrn.userDb.attemptsFor('italian', i), id);

async function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    globalThis.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => globalThis.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return errors;
}

/** Курсът „Италианска“ от fixture-а с ev (без SW, за да мине през page.route). */
async function useFixture(page) {
  await page.route('**/data/courses/italian.json', (r) => r.fulfill({ path: FIX_PATH.pathname, contentType: 'application/json' }));
}

test('D-033: крушка встрани от лентата; „Пак“ — чист опит рестартира без наказание, нечист се записва като неуспешен', async ({ page }) => {
  const errors = await watch(page);
  await open(page);
  await fast(page);
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  // крушката не е в лентата, вляво е от нея и е ≥ 44 px; иконка bulb от vendor/tabler
  const hint = hintBtn(page);
  await expect(iconBar(page).getByRole('button', { name: /Подсказка/ })).toHaveCount(0);
  await expect(hint.locator('.ico-cap')).toHaveText('Подсказка');
  const hb = await hint.boundingBox();
  const bar = await iconBar(page).boundingBox();
  expect(hb.width).toBeGreaterThanOrEqual(44);
  expect(hb.height).toBeGreaterThanOrEqual(44);
  expect(bar.x - (hb.x + hb.width)).toBeGreaterThanOrEqual(16); // встрани
  expect(await hint.locator('.ico').evaluate((e) => getComputedStyle(e).maskImage)).toMatch(/vendor\/tabler\/bulb\.svg/);
  await enabled(hint);
  await enabled(againBtn(page));
  // Подсказка → кратко съобщение (1 дума), стрелка; отметките са изчистени
  await hint.click();
  await expect(page.locator('#train-msg')).toHaveText('Подсказка');
  await expect(page.locator('.board-wrap .arrows .arrow')).toHaveCount(1);
  // нечист опит → „Пак“ го записва като неуспешен
  await againBtn(page).click();
  await expect.poll(async () => (await attempts(page, I1.id)).map((a) => a.ok)).toEqual([false]);
  // чисто изиграване → 1/3
  await playLine(page, I1, 'w');
  await doneKind(page, 'clean');
  await checks(page, 1, 3);
  // чист опит до средата → „Пак“ = рестарт без наказание: броячът остава 1, нов запис няма
  await againBtn(page).click();
  await playLine(page, I1, 'w', { stopAt: 4 });
  await againBtn(page).click();
  await expect.poll(() => turn(page)).toBe('user@0');
  await checks(page, 1, 3);
  expect((await attempts(page, I1.id)).length).toBe(2);
  expect((await row(page, 'italian', I1.id)).streak).toBe(1);
  expect(await page.evaluate(() => globalThis.__csp)).toEqual([]);
  expect(errors).toEqual([]);
});

test('D-034: отметки ✓, изчистване с анимация, „Научена“ с ефект; индикатор за хода; без дълги текстове', async ({ page }) => {
  await open(page);
  await fast(page, { learnStreak: 2, opponentDelayMs: 300 });
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await checks(page, 0, 2);
  await expect(page.locator('#streak')).toHaveAttribute('aria-label', 'Изигравания без грешка подред: 0 от 2');
  // индикатор: твой ход (бяло кръгче с пръстен) → ход на противника
  const ind = page.locator('#turn');
  await expect(ind).toHaveAttribute('data-turn', 'user');
  await expect(ind).toHaveAttribute('data-color', 'w');
  await expect(ind).toHaveAccessibleName('Твой ход');
  await expect(page.locator('#train-msg')).toHaveText('');
  const f = I1.m;
  await playLine(page, I1, 'w', { stopAt: 2 });
  await expect(ind).toHaveAttribute('data-turn', 'user');
  await playLine(page, I1, 'w', { from: 2 });
  await checks(page, 1, 2);
  await expect(ind).toHaveAttribute('data-turn', 'done');
  // грешка → отметката се изчиства с анимация (клас cleared), съобщението е 1 дума
  await againBtn(page).click();
  await expect.poll(() => turn(page)).toBe('user@0');
  const w = await legalWrong(page);
  await move(page, w[0], w[1]);
  await expect(page.locator('#train-msg')).toHaveText('Грешка');
  await checks(page, 0, 2);
  await expect(page.locator('#streak .chk.cleared')).toHaveCount(1);
  await expect(page.locator('.board-wrap .marker.marker-bad')).toHaveCount(1);
  expect(f.length).toBeGreaterThan(2);
  // довършва с грешка → „1 грешка“
  await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct');
  await playLine(page, I1, 'w');
  await doneKind(page, 'errors');
  await expect(page.locator('#done-text')).toHaveText('1 грешка');
  // две чисти → научена: всички отметки + ефект; резултатът е „Научена“
  for (let k = 0; k < 2; k++) { await againBtn(page).click(); await playLine(page, I1, 'w'); }
  await doneKind(page, 'learned');
  await expect(page.locator('#done-text')).toHaveText('Научена');
  await checks(page, 2, 2);
  await expect(page.locator('#streak')).toHaveClass(/learned/);
  await expect(page.locator('#streak')).toHaveClass(/celebrate/);
  // нито един от старите дълги текстове
  const body = await page.locator('main, body').first().innerText();
  for (const t of ['Линията е изиграна', 'изиграй линията по памет', 'Противникът мисли', 'Верният ход е', 'Край:', 'предимство']) {
    expect(body).not.toContain(t);
  }
});

test('D-037: Назад/Напред в края на линията — превъртане, грешният ход маркиран; по време на опита — неактивни', async ({ page }) => {
  await open(page);
  await fast(page);
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await disabled(backBtn(page));
  await disabled(fwdBtn(page));
  // грешка на 2.Nf3 (полуход 2), после довършване
  await playLine(page, I1, 'w', { stopAt: 2 });
  const w = await legalWrong(page);
  await move(page, w[0], w[1]);
  await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct');
  await disabled(backBtn(page)); // активен опит
  await playLine(page, I1, 'w', { from: 2 });
  await doneKind(page, 'errors');
  const total = I1.m.length;
  await enabled(backBtn(page));
  await disabled(fwdBtn(page));
  await expect(page.locator('#played .mv-bad')).toHaveCount(1);
  await expect(page.locator('#played .mv-bad')).toHaveAttribute('data-ply', '3');
  await expect(page.locator('#played .mv-bad')).toHaveText('2.Nf3');
  // превъртане назад до мястото на грешката: червено поле (изиграният ход) + стрелка с верния
  for (let p = total - 1; p >= 2; p--) {
    await backBtn(page).click();
    await expect(page.locator(`#played .mv[data-ply="${p}"]`)).toHaveAttribute('aria-current', 'true');
  }
  await expect(page.locator('.board-wrap .marker.marker-bad')).toHaveCount(1);
  await expect(page.locator('.board-wrap .arrows .arrow')).toHaveCount(1);
  await expect(page.locator('.board-wrap g[data-piece="wn"][data-square="g1"]')).toHaveCount(1);
  await enabled(fwdBtn(page));
  await fwdBtn(page).click();
  await expect(page.locator('.board-wrap g[data-piece="wn"][data-square="f3"]')).toHaveCount(1);
  await expect(page.locator('.board-wrap .marker.marker-bad')).toHaveCount(0);
  // тап върху ход в записа → скок до него
  await page.locator('#played .mv[data-ply="1"]').click();
  await expect(page.locator('#played .mv[data-ply="1"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  // „Пак“ → нов опит, превъртането е изключено
  await againBtn(page).click();
  await disabled(backBtn(page));
  await disabled(fwdBtn(page));
  await expect(page.locator('#played .mv')).toHaveCount(0);
});

test('D-037: преглед на линия от Курс (иконка „око“) — Назад/Напред, без опит и без запис; „Учи“ отваря тренировката', async ({ page }) => {
  const errors = await watch(page);
  await open(page, '#/course/italian');
  const eye = page.getByRole('link', { name: `Преглед на линия ${I1.n}`, exact: true });
  const eb = await eye.boundingBox();
  expect(eb.width).toBeGreaterThanOrEqual(44);
  expect(eb.height).toBeGreaterThanOrEqual(44);
  await eye.click();
  await expect(page).toHaveURL(new RegExp(`#/train/italian/${I1.id}\\?mode=view$`));
  await expect(page.locator('h1.screen-title')).toHaveText('Италианска партия · линия 1 · преглед');
  await expect(page.locator('#played .mv')).toHaveCount(I1.m.length);
  await expect(page.locator('.board-wrap g[data-piece]')).toHaveCount(32);
  await disabled(backBtn(page));
  await enabled(fwdBtn(page));
  await disabled(hintBtn(page));
  await disabled(nextBtn(page));
  await expect(againBtn(page)).toHaveCount(0);
  const learn = iconBar(page).getByRole('button', { name: 'Учи линията' });
  await enabled(learn);
  for (let p = 1; p <= I1.m.length; p++) await fwdBtn(page).click();
  await disabled(fwdBtn(page));
  await expect(page.locator(`#played .mv[data-ply="${I1.m.length}"]`)).toHaveAttribute('aria-current', 'true');
  // дъската не приема ходове, прогрес не се създава
  expect(await row(page, 'italian', I1.id)).toBeNull();
  await learn.click();
  await expect(page).toHaveURL(new RegExp(`#/train/italian/${I1.id}\\?mode=learn$`));
  await expect(page.locator('#turn')).toHaveAttribute('data-turn', 'user');
  expect(errors).toEqual([]);
});

test('D-036: фигурки вместо буквите — бели/черни според хода; пешки без фигурка; в Курс и в записа на ходовете', async ({ page }) => {
  const errors = await watch(page);
  await open(page, '#/course/italian');
  const moves1 = page.locator(`.line-row[data-line="${I1.id}"] .ln-moves`);
  await expect(moves1.locator('svg.fig-w use').first()).toHaveAttribute('href', /pieces\/standard\.svg#wn$/);
  await expect(moves1.locator('svg.fig-b use').first()).toHaveAttribute('href', /pieces\/standard\.svg#bn$/);
  await expect(moves1).toContainText('2.Nf3 Nc6'); // буквата е скрит текст (екранен четец, textContent)
  const vis = await moves1.locator('.fig-wrap .visually-hidden').first().boundingBox();
  expect(vis.width).toBeLessThanOrEqual(1);
  // фигурката се зарежда (спрайтът е от shell-а) и е видима
  const fig = await moves1.locator('svg.fig').first().boundingBox();
  expect(fig.width).toBeGreaterThanOrEqual(12);
  await fast(page);
  await open(page, `#/train/italian/${I1.id}?mode=learn`);
  await playLine(page, I1, 'w', { stopAt: 6 });
  const mv = (p) => page.locator(`#played .mv[data-ply="${p}"]`);
  await expect(mv(1).locator('svg')).toHaveCount(0); // 1.e4 — пешка
  await expect(mv(3).locator('svg.fig-w use')).toHaveAttribute('href', /#wn$/);
  await expect(mv(4).locator('svg.fig-b use')).toHaveAttribute('href', /#bn$/);
  await expect(mv(5).locator('svg.fig-w use')).toHaveAttribute('href', /#wb$/);
  // ходовете от опашката остават в курсив (с фигурки)
  const DRAGON = course('accel-dragon');
  const T = DRAGON.lines.find((l) => Number.isInteger(l.tail));
  if (T) {
    await fast(page, { autoPlayStart: true });
    await open(page, `#/train/accel-dragon/${T.id}?mode=learn`);
    await playLine(page, T, DRAGON.side, { from: firstMine(DRAGON.side, DRAGON.start.length) });
    const tail = page.locator('#played .mv-tail');
    await expect(tail.first()).toBeVisible();
    expect(await tail.first().evaluate((e) => getComputedStyle(e).fontStyle)).toBe('italic');
    await expect(page.locator('.tail-note')).toHaveText('Курсив — ходове от компютъра.');
  }
  expect(errors).toEqual([]);
});

test.describe('D-035: оценка от Stockfish (fixture с ev)', () => {
  test.use({ serviceWorkers: 'block' });

  test('число вдясно до дъската от гледна точка на белите; null — празно; при „не“ и без ev — няма колона', async ({ page }) => {
    const errors = await watch(page);
    await useFixture(page);
    await open(page);
    await fast(page);
    await open(page, `#/train/italian/${F1.id}?mode=learn`);
    const ev = page.locator('#eval');
    await expect(ev).toBeVisible();
    await expect(ev).toHaveText(''); // начална позиция — няма оценка
    // вдясно до дъската, на нейната височина
    const b = await page.locator('.board-wrap').boundingBox();
    const e = await ev.boundingBox();
    expect(e.x).toBeGreaterThanOrEqual(b.x + b.width);
    expect(Math.abs(e.height - b.height)).toBeLessThanOrEqual(2);
    await playLine(page, F1, 'w', { stopAt: 4 }); // след 2...Nc6: ev[3]
    await expect(ev).toHaveText('+0,5');
    await expect(ev).toHaveAttribute('data-ev', String(F1.ev[3]));
    await expect(ev).toHaveAccessibleName('Оценка на позицията: +0,5');
    await playLine(page, F1, 'w', { from: 4 });
    await expect(ev).toHaveText('+1,2'); // ev[последен] = 122
    await expect(page.locator('body')).not.toContainText('предимство');
    // превъртане назад сменя и оценката
    await backBtn(page).click();
    await expect(ev).toHaveText('+0,3');
    // линия 2: ev[2] = null → след 2.Nf3 (полуход 3) числото е празно
    expect(F2.ev[2]).toBeNull();
    await open(page, `#/train/italian/${F2.id}?mode=learn`);
    await playLine(page, F2, 'w');
    for (let p = F2.m.length; p > 3; p--) await backBtn(page).click();
    await expect(page.locator('#played .mv[data-ply="3"]')).toHaveAttribute('aria-current', 'true');
    await expect(ev).toHaveText('');
    await backBtn(page).click();
    await expect(ev).toHaveText('+0,1'); // ev[1] = 7
    // „Настройки → Дъска → Показвай оценката“ = не → няма колона
    await open(page, '#/settings');
    const field = page.locator('[data-key="showEval"]');
    await expect(field).toContainText('Показвай оценката');
    await expect(field).toContainText('По подразбиране: да.');
    await field.locator('.check-text').click();
    await expect(page.locator('#set-showEval')).not.toBeChecked();
    await open(page, `#/train/italian/${F1.id}?mode=learn`);
    await expect(page.locator('#eval')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('без ev в данните (стари данни) — без число и без грешка', async ({ page }) => {
    const errors = await watch(page);
    // T-027: истинските курсове вече имат ev — подаваме италианската без полето
    const noEv = { ...ITALIAN, lines: ITALIAN.lines.map(({ ev, ...l }) => l) };
    await page.route('**/data/courses/italian.json', (r) => r.fulfill({ body: JSON.stringify(noEv), contentType: 'application/json' }));
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    await expect(page.locator('.board-wrap')).toBeVisible();
    await expect(page.locator('#eval')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

for (const [name, w, h] of [['320x568', 320, 568], ['360x640', 360, 640], ['pixel7', 0, 0]]) {
  test(`малък екран ${name}: без припокриване с долното меню — опит, „Започни веднага отначало“, край`, async ({ page }) => {
    if (w) await page.setViewportSize({ width: w, height: h });
    await open(page);
    await fast(page, { onError: 'restart', wrongMoveMs: 400, errorPauseMs: 800 });
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    const tabsTop = await page.locator('#tabs').evaluate((e) => e.getBoundingClientRect().top);
    const vw = page.viewportSize().width;
    const fits = async () => {
      const r = await page.locator('#ctrl-row').boundingBox();
      const u = await page.locator('.train-under').boundingBox();
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      return r.y >= 0 && r.y + r.height <= tabsTop && u.y + u.height <= r.y + 1 && sw <= vw;
    };
    expect(await fits()).toBe(true);
    expect(await boardSpan(page)).toBeGreaterThanOrEqual(280); // дъската + колоната с оценката (D-035)
    // грешка при „Започни веднага отначало“: съобщението е 1 ред, нищо не слиза под менюто
    await playLine(page, I1, 'w', { stopAt: 2 });
    const wr = await legalWrong(page);
    await move(page, wr[0], wr[1]);
    await expect(page.locator('#train-msg')).toHaveText('Грешка');
    expect(await fits()).toBe(true);
    await expect(page.locator('#train-msg')).toHaveText('Отначало');
    const mh = await page.locator('#train-msg').evaluate((e) => e.getBoundingClientRect().height);
    expect(mh).toBeLessThanOrEqual(24);
    expect(await fits()).toBe(true);
    await expect.poll(() => turn(page)).toBe('user@0');
    await playLine(page, I1, 'w');
    await expect.poll(fits).toBe(true);
    const d = await page.locator('#done-text').boundingBox();
    expect(d.y + d.height).toBeLessThanOrEqual(tabsTop);
  });
}

test.describe('снимки (T028_SCREENS)', () => {
  test.use({ serviceWorkers: 'block' });
  test('игра с оценка, грешка, край с отметки и превъртане, тъмна тема 320×568', async ({ page }) => {
    test.skip(!SHOTS, 'само с T028_SCREENS');
    await useFixture(page);
    await open(page);
    await fast(page, { wrongMoveMs: 3000 });
    // 1) игра (fixture с ev), Pixel 7, светла тема
    await open(page, `#/train/italian/${F1.id}?mode=learn`);
    await playLine(page, F1, 'w', { stopAt: 8 });
    await page.screenshot({ path: `${SHOTS}/t028-1-pixel7-light-play-eval.png`, animations: 'disabled' });
    // 2) грешка: червено поле, 1 дума
    const wr = await legalWrong(page);
    await move(page, wr[0], wr[1]);
    await expect(page.locator('#train-msg')).toHaveText('Грешка');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/t028-2-pixel7-light-error.png`, animations: 'disabled' });
    await fast(page);
    await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct', { timeout: 6000 });
    await playLine(page, F1, 'w', { from: 8 });
    // 3) край: 3 чисти пробега → „Научена“, всички отметки; превъртане назад с Назад (тъмна тема)
    for (let k = 0; k < 3; k++) { await againBtn(page).click(); await playLine(page, F1, 'w'); }
    await doneKind(page, 'learned');
    for (let p = F1.m.length; p > 7; p--) await backBtn(page).click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(900); // ефектът на отметките е приключил
    await page.screenshot({ path: `${SHOTS}/t028-3-pixel7-dark-learned-browse.png`, animations: 'disabled' });
    // 4) тъмна тема, 320×568, край на линия 2 с грешка и превъртане
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page, `#/train/italian/${F2.id}?mode=learn`);
    await playLine(page, F2, 'w', { stopAt: 4 });
    const w3 = await legalWrong(page);
    await move(page, w3[0], w3[1]);
    await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct');
    await playLine(page, F2, 'w', { from: 4 });
    for (let p = F2.m.length; p > 4; p--) await backBtn(page).click(); // до позицията на грешката
    await expect(page.locator('.board-wrap .marker.marker-bad')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/t028-4-320x568-dark-done-browse.png`, animations: 'disabled' });
  });
});
