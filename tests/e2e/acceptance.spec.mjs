// T-013: пълно приемане на MVP (тестер) — потребителски сценарий от първо пускане до бекъп.
// Pixel 7, портрет, истинските данни. Независим от останалите spec-ове.
import { test, expect } from '@playwright/test';
import { MANIFEST, course, lineN, shot, open, waitForSW, fast, move, turn, playLine, row, legalWrong, firstMine, againBtn, nextBtn, checks, doneKind, hintBtn, boardSpan } from './helpers.mjs';

const ITALIAN = course('italian');
const CARO = course('caro-kann');
const LINES = Object.fromEntries(MANIFEST.courses.map((c) => [c.id, c.lines]));
const I1 = lineN(ITALIAN, 1);
const I2 = lineN(ITALIAN, 2);
const I3 = lineN(ITALIAN, 3);
const C1 = lineN(CARO, 1); // транспозиция → линия 3

function collect(page) {
  const errors = [];
  const foreign = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:')) foreign.push(r.url()); });
  return { errors, foreign };
}

test('T-013 сценарий: първо пускане → каталог → учене (бели/черни, плъзгане/тап) → грешка/подсказка → научена → следваща → транспозиция', async ({ page }) => {
  test.setTimeout(120_000);
  const { errors, foreign } = collect(page);
  await open(page);
  // Първо пускане: 9 ★ курса
  await expect(page.locator('.course-card')).toHaveCount(9);
  await shot(page, '01-kursove-parvo-puskane');

  // Каталог: филтри, банер, избор на курс извън ★
  await page.locator('a.tab[data-route="catalog"]').click();
  await expect(page.locator('.catalog-row')).toHaveCount(15); // бели
  await expect(page.locator('#catalog-count')).toHaveText('Избрани: 9');
  await shot(page, '02-katalog-beli');
  await page.locator('[data-filter="side"] [data-value="b"]').click();
  await expect(page.locator('.catalog-row')).toHaveCount(16);
  await page.locator('[data-filter="group"] .chip').nth(1).click();
  const inGroup = await page.locator('.catalog-row').count();
  expect(inGroup).toBeGreaterThan(0);
  expect(inGroup).toBeLessThan(16);
  await page.locator('[data-filter="group"] [data-value="all"]').click();
  await page.locator('label[for="pick-pirc"]').click();
  await expect(page.locator('#catalog-count')).toHaveText('Избрани: 10');
  await shot(page, '03-katalog-cherni-izbran-pirc');
  await page.locator('a.tab[data-route="courses"]').click();
  await expect(page.locator('.course-card')).toHaveCount(10);
  await expect(page.locator('.course-card[data-course="pirc"]')).toBeVisible();

  // Бял курс: Италианска, learnStreak = 3 (подразбиране)
  await page.locator('.course-card[data-course="italian"] a').first().click();
  await expect(page.locator('#course-learned')).toHaveText(`научени 0/${LINES.italian}`);
  await shot(page, '04-kurs-italianska');
  await fast(page);
  await page.locator('#learn-next').click();
  await expect(page.locator('h1.screen-title')).toHaveText(`Италианска партия · линия 1/${LINES.italian}`);
  await checks(page, 0, 3);
  await shot(page, '05-trenirovka-nachalo');

  // 1) чисто с плъзгане → 1/3
  await playLine(page, I1, 'w', { how: 'drag' });
  await doneKind(page, 'clean'); await checks(page, 1, 3);
  await shot(page, '06-trenirovka-izigrana-1-3');

  // 2) грешка на втория мой ход → брояч 0, показан верен ход
  await againBtn(page).click();
  await expect.poll(() => turn(page)).toBe('user@0');
  const f = I1.m;
  // първи ход вярно
  await playLine(page, I1, 'w', { stopAt: 2 });
  const w = await legalWrong(page);
  await move(page, w[0], w[1]);
  await expect(page.locator('#streak')).toHaveAttribute('data-streak', '0');
  await expect(page.locator('#train-msg')).toHaveText('Грешка');
  await shot(page, '07-greshka-veren-hod');
  await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct');
  await expect(page.locator('#train-msg')).toHaveText('Грешка');
  await expect(page.locator('.board-wrap .arrow, .board-wrap [class*="arrow"]').first()).toBeAttached();
  await shot(page, '08-greshka-strelka');
  await playLine(page, I1, 'w', { from: 2 });
  await doneKind(page, 'errors'); await checks(page, 0, 3);
  expect((await row(page, 'italian', I1.id)).streak).toBe(0);

  // 3) подсказка → брояч 0 (hintResetsStreak = да)
  await againBtn(page).click();
  await playLine(page, I1, 'w', { hintAt: 2 });
  await doneKind(page, 'errors'); await checks(page, 0, 3);

  // 4) три чисти (тап-тап) → научена
  for (const k of [1, 2]) {
    await againBtn(page).click();
    await playLine(page, I1, 'w');
    await doneKind(page, 'clean'); await checks(page, k, 3);
  }
  await againBtn(page).click();
  await playLine(page, I1, 'w');
  await doneKind(page, 'learned'); await checks(page, 3, 3);
  await shot(page, '09-nauchena');
  const r1 = await row(page, 'italian', I1.id);
  expect(r1.status).toBe('learned');
  // D-030: първи преговор след 3 дни от началото на деня на научаване
  const days = Math.round((r1.due - r1.learnedAt) / 86_400_000);
  expect(days === 2 || days === 3).toBeTruthy();

  // „Учи следващата“ от екрана на курса → линия 2
  await page.locator('a.back').click();
  await expect(page.locator('#course-learned')).toHaveText(`научени 1/${LINES.italian}`);
  await expect(page.locator(`.line-row[data-line="${I1.id}"]`)).toContainText('научена · преговор след 3 дни');
  await expect(page.locator('#learn-next')).toHaveText('Учи следващата (2)');
  await shot(page, '10-kurs-sled-nauchena');
  await page.locator('#learn-next').click();
  await expect(page.locator('h1.screen-title')).toHaveText(`Италианска партия · линия 2/${LINES.italian}`);

  // Черен курс (Каро-Кан), линия 1 е транспозиция → линия 3; тап-тап
  await open(page, '#/course/caro-kann');
  await fast(page);
  await expect(page.locator(`.line-row[data-line="${C1.id}"]`)).toContainText(`→ продължава като линия ${lineN(CARO, 3).n}`);
  await page.locator('#learn-next').click();
  await expect(page.locator('h1.screen-title')).toHaveText(`Каро-Кан · линия 1/${LINES['caro-kann']}`);
  // черните долу
  const a1 = await page.locator('.board-wrap rect[data-square="a1"]').boundingBox();
  const a8 = await page.locator('.board-wrap rect[data-square="a8"]').boundingBox();
  expect(a1.y).toBeLessThan(a8.y);
  await playLine(page, C1, 'b');
  await doneKind(page, 'clean'); await checks(page, 1, 3);
  await expect(page.locator('#transpose-go')).toHaveText('→ линия 3');
  await expect(page.locator('#transpose-go')).toHaveAccessibleName('Линията продължава като линия 3 — продължи с нея');
  await shot(page, '11-cherni-transpoziciya');
  await page.locator('#transpose-go').click();
  await expect(page.locator('h1.screen-title')).toHaveText(`Каро-Кан · линия 3/${LINES['caro-kann']}`);

  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

const I4 = lineN(ITALIAN, 4);
const daysOf = (r) => r.fsrs.scheduledDays;

test('T-013 преговор със симулирано време: Добре / Трудно / Отново, интервали, reviewErrorsForAgain, истинският прогрес е непокътнат', async ({ page }) => {
  test.setTimeout(120_000);
  const { errors } = collect(page);
  await open(page);
  await fast(page, { learnStreak: 1 });
  for (const l of [I1, I2, I3, I4]) {
    await open(page, `#/train/italian/${l.id}?mode=learn`);
    await playLine(page, l, 'w');
    await doneKind(page, 'learned'); await checks(page, 1, 1);
  }
  // ден 2: още нищо
  await open(page, '#/review', '?now=+2d');
  await expect(page.locator('#sim-bar')).toBeVisible();
  await expect(page.locator('#review-empty')).toBeVisible();
  // ден 3: и четирите (firstReviewDays = 3)
  await open(page, '#/review', '?now=+3d');
  await expect(page.locator('#review-count')).toHaveText('За преговор днес: 4');
  await expect(page.locator('#review-badge')).toHaveText('4');
  await shot(page, '12-pregovor-den3');
  await fast(page, { learnStreak: 1 });

  // I1 чисто → Добре
  await page.locator('#review-start').click();
  await playLine(page, I1, 'w');
  await expect(page.locator('#train-done')).toHaveAttribute('data-grade', 'good');
  await expect(page.locator('#done-text')).toHaveText(/^Добре · след \d+ дни$/);
  await shot(page, '13-pregovor-dobre');
  const good = await row(page, 'italian', I1.id);
  // I2 с подсказка → Трудно
  await nextBtn(page).click();
  await playLine(page, I2, 'w', { hintAt: 2 });
  await expect(page.locator('#train-done')).toHaveAttribute('data-grade', 'hard');
  const hard = await row(page, 'italian', I2.id);
  // I3 с грешка → Отново, „Повтори“ → повторение готово, утре
  await nextBtn(page).click();
  await playLine(page, I3, 'w', { wrongAt: 2, wrong: ['a2', 'a3'] });
  await expect(page.locator('#train-done')).toHaveAttribute('data-grade', 'again');
  await expect(page.locator('#done-text')).toHaveText('Отново');
  await shot(page, '14-pregovor-otnovo');
  await againBtn(page).click();
  await expect(page.locator('#streak')).toHaveText('Повторение');
  await shot(page, '15-povtorenie-sled-greshka');
  await playLine(page, I3, 'w');
  await expect(page.locator('#done-text')).toHaveText('✓ · утре');
  const again = await row(page, 'italian', I3.id);
  // reviewErrorsForAgain = 2: една грешка → Трудно
  await fast(page, { reviewErrorsForAgain: 2 });
  await nextBtn(page).click();
  await playLine(page, I4, 'w', { wrongAt: 2, wrong: ['a2', 'a3'] });
  await expect(page.locator('#train-done')).toHaveAttribute('data-grade', 'hard');
  const hard2 = await row(page, 'italian', I4.id);
  await expect(page.locator('#train-done')).toHaveAttribute('data-all-done', '1');

  // Интервали: Отново (1) < Трудно < Добре
  expect(daysOf(again)).toBe(1);
  expect(daysOf(hard)).toBeGreaterThan(1);
  expect(daysOf(good)).toBeGreaterThan(daysOf(hard));
  expect(daysOf(hard2)).toBe(daysOf(hard));
  test.info().annotations.push({ type: 'intervals', description: `Добре ${daysOf(good)} д., Трудно ${daysOf(hard)} д., Отново ${daysOf(again)} д.` });

  // ден 4: само I3 (Отново → утре)
  await open(page, '#/review', '?now=+4d');
  await expect(page.locator('#review-count')).toHaveText('За преговор днес: 1');
  await expect(page.locator(`#review-list [href*="${I3.id}"]`)).toHaveCount(1);
  // ден 3 + Good интервал: I1 се връща
  await open(page, '#/review', `?now=+${3 + daysOf(good)}d`);
  await expect(page.locator(`#review-list [href*="${I1.id}"]`)).toHaveCount(1);

  // Извън симулацията: истинският прогрес не е пипан (само първият преглед при научаване)
  await open(page, '#/review');
  await expect(page.locator('#sim-bar')).toHaveCount(0);
  const real = await row(page, 'italian', I1.id);
  expect(real.fsrs.reps).toBe(1);
  expect(errors).toEqual([]);
});

/** Смяна на настройка през UI („Настройки“) — както потребителят. */
async function setUi(page, key, value) {
  await open(page, '#/settings');
  const el = page.locator(`#set-${key}`);
  const tag = await el.evaluate((e) => (e.tagName === 'SELECT' ? 'select' : e.type));
  if (tag === 'select') await el.selectOption(String(value));
  else if (tag === 'checkbox') await el.setChecked(Boolean(value));
  else { await el.fill(String(value)); await el.dispatchEvent('change'); }
  await page.evaluate(() => globalThis.__lrn.userDb.flush());
}

test('T-013 настройки през UI: стойността се пази след презареждане и има ефект (8 параметъра)', async ({ page }) => {
  test.setTimeout(150_000);
  const { errors } = collect(page);
  await open(page);
  // Бързина за теста — само в паметта (не са предмет на проверката)
  const quick = () => page.evaluate(() => { const s = globalThis.__lrn.settings; s.set('animationMs', 0); s.set('wrongMoveMs', 100); });

  // 1. learnStreak = 2 → научена след 2 чисти
  await setUi(page, 'learnStreak', 2);
  // 2. opponentDelayMs = 1500 → противникът чака
  await setUi(page, 'opponentDelayMs', 1500);
  await page.reload();
  await open(page, '#/settings');
  await expect(page.locator('#set-learnStreak')).toHaveValue('2');
  await expect(page.locator('#set-opponentDelayMs')).toHaveValue('1500');
  await shot(page, '16-nastroiki', { fullPage: false });
  await open(page, `#/train/italian/${I2.id}?mode=learn`);
  await quick();
  await checks(page, 0, 2);
  await move(page, 'e2', 'e4');
  const t0 = Date.now();
  await expect(page.locator('#turn')).toHaveAttribute('data-turn', 'opponent');
  await expect(page.locator('#turn')).toHaveAccessibleName('Ход на противника');
  await expect.poll(() => turn(page), { timeout: 5000 }).toBe('user@2');
  expect(Date.now() - t0).toBeGreaterThanOrEqual(1200);
  await page.evaluate(() => globalThis.__lrn.settings.set('opponentDelayMs', 0));
  await playLine(page, I2, 'w', { from: 2 });
  await againBtn(page).click();
  await playLine(page, I2, 'w');
  await doneKind(page, 'learned'); await checks(page, 2, 2);
  await setUi(page, 'opponentDelayMs', 0);

  // 3. boardOrientation = black → бял курс с черните долу
  await setUi(page, 'boardOrientation', 'black');
  await open(page, `#/train/italian/${I3.id}?mode=learn`);
  let a1 = await page.locator('.board-wrap rect[data-square="a1"]').boundingBox();
  let a8 = await page.locator('.board-wrap rect[data-square="a8"]').boundingBox();
  expect(a1.y).toBeLessThan(a8.y);
  await setUi(page, 'boardOrientation', 'auto');

  // 4. autoPlayStart = да → стартовите ходове на курса се играят сами (Каро-Кан: 1.e4 c6 → моят първи ход е 2...d5)
  await setUi(page, 'autoPlayStart', true);
  await open(page, `#/train/caro-kann/${lineN(CARO, 2).id}?mode=learn`);
  await expect.poll(() => turn(page)).toBe('user@3');
  await setUi(page, 'autoPlayStart', false);
  await open(page, `#/train/caro-kann/${lineN(CARO, 2).id}?mode=learn`);
  await expect.poll(() => turn(page)).toBe('user@1');

  // 5. onError = restart → след грешка линията започва отначало
  await setUi(page, 'onError', 'restart');
  await setUi(page, 'errorPauseMs', 0);
  await open(page, `#/train/italian/${I4.id}?mode=learn`);
  await quick();
  await move(page, 'a2', 'a3');
  // errorPauseMs = 0: кратката дума „Отначало“ се сменя веднага — проверява се самият рестарт
  await expect.poll(() => page.evaluate(() => globalThis.__lrn.train.session.attempt)).toBe(2);
  await expect.poll(() => turn(page)).toBe('user@0');
  await setUi(page, 'onError', 'continue');

  // 6. hintAfterSec = 1 → подсказката излиза сама
  await setUi(page, 'hintAfterSec', 1);
  await open(page, `#/train/italian/${I4.id}?mode=learn`);
  await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'hint auto', { timeout: 4000 });
  await expect(page.locator('#train-msg')).toHaveText('Подсказка');
  await setUi(page, 'hintAfterSec', 0);

  // 7. hintResetsStreak = не → подсказката не нулира брояча
  await setUi(page, 'hintResetsStreak', false);
  await open(page, `#/train/italian/${I4.id}?mode=learn`);
  await quick();
  await playLine(page, I4, 'w', { hintAt: 2 });
  await doneKind(page, 'clean'); await checks(page, 1, 2);
  await setUi(page, 'hintResetsStreak', true);

  // 8. firstReviewDays = 7 → научената линия е за преговор след 7 дни
  await setUi(page, 'firstReviewDays', 7);
  await open(page, `#/train/italian/${I4.id}?mode=learn`);
  await quick();
  await playLine(page, I4, 'w');
  await doneKind(page, 'learned'); await checks(page, 2, 2);
  await open(page, '#/course/italian');
  await expect(page.locator(`.line-row[data-line="${I4.id}"]`)).toContainText('преговор след 7 дни');
  await expect(page.locator(`.line-row[data-line="${I2.id}"]`)).toContainText('преговор след 3 дни');

  // 9. maxReviewsPerDay = 1 → на ден 7 се показва само 1 от 2
  await setUi(page, 'maxReviewsPerDay', 1);
  await open(page, '#/review', '?now=+7d');
  await expect(page.locator('#review-count')).toHaveText('За преговор днес: 1');
  await expect(page.locator('#screen')).toContainText('Показани са 1 от 2');

  // Притискане до границите и „Върни стойностите по подразбиране“
  await open(page, '#/settings');
  await setUi(page, 'learnStreak', 99);
  await expect(page.locator('#set-learnStreak')).toHaveValue('10');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Върни стойностите по подразбиране' }).click();
  await expect(page.locator('#set-learnStreak')).toHaveValue('3');
  expect(errors).toEqual([]);
});

test.describe('T-013 обновяване, офлайн, бекъп', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterEach(async ({ request }) => {
    await request.get('/__test/sw-build?b=');
    await request.get('/__test/data-version?v=');
  });

  test('офлайн след първо зареждане → нова версия на приложението и данните → прогресът (статус, брояч, FSRS) е същият; офлайн и след това', async ({ page, context, request }) => {
    test.setTimeout(120_000);
    await open(page);
    await waitForSW(page);
    await fast(page, { learnStreak: 2 });
    // научена (бял) + в процес (черен) — през истинската игра
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    await playLine(page, I1, 'w');
    await againBtn(page).click();
    await playLine(page, I1, 'w');
    await open(page, `#/train/caro-kann/${lineN(CARO, 2).id}?mode=learn`);
    await playLine(page, lineN(CARO, 2), 'b');
    const before = {
      i1: await row(page, 'italian', I1.id),
      c2: await row(page, 'caro-kann', lineN(CARO, 2).id),
    };
    expect(before.i1.status).toBe('learned');
    expect(before.c2.status).toBe('learning');
    await expect.poll(() => page.evaluate(async () => !!(await globalThis.__lrn.userDb.getMeta('lineIds'))?.italian)).toBe(true);

    // Офлайн: всичко работи, вкл. курс, който не е отварян
    await context.setOffline(true);
    await open(page, '#/courses');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect(page.locator('.course-card')).toHaveCount(9);
    await open(page, '#/course/vs-nf3');
    await expect(page.locator('.line-row')).toHaveCount(LINES['vs-nf3']);
    await open(page, `#/train/slav/${lineN(course('slav'), 3).id}?mode=learn`);
    await expect(page.locator('.board-wrap rect[data-square="e4"]')).toBeAttached();
    await context.setOffline(false);

    // Нов деплой: друга версия на данните, в italian е оттеглена линия 2 (не моята)
    await request.get('/__test/data-version?v=2099-03-01.1&retire=italian:2');
    await request.get('/__test/sw-build?b=t013');
    await open(page, '#/courses');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const bar = page.locator('#update-bar');
    await expect(bar).toContainText('Има нова версия.');
    await shot(page, '17-ima-nova-versiya');
    await Promise.all([page.waitForEvent('load'), bar.getByRole('button', { name: 'Обнови' }).click()]);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect(page.locator('#data-update')).toContainText('Курсовете са обновени: +1 нови, −1 оттеглени линии.');
    await shot(page, '18-kursovete-sa-obnoveni');
    const after = {
      i1: await row(page, 'italian', I1.id),
      c2: await row(page, 'caro-kann', lineN(CARO, 2).id),
    };
    for (const k of ['status', 'streak', 'due', 'learnedAt']) {
      expect(after.i1[k]).toEqual(before.i1[k]);
      expect(after.c2[k]).toEqual(before.c2[k]);
    }
    expect(after.i1.fsrs).toEqual(before.i1.fsrs);
    await open(page, '#/course/italian');
    await expect(page.locator('#course-learned')).toHaveText(`научени 1/${LINES.italian}`);
    // и пак офлайн — с новите данни
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await open(page, '#/settings');
    await expect(page.locator('#data-version')).toHaveText('2099-03-01.1');
    await context.setOffline(false);
  });

  test('бекъп: изтегляне → изтриване на данните (нов профил) → внос → изборът, прогресът, FSRS и настройките се връщат', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await open(page);
    await fast(page, { learnStreak: 1 });
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    await playLine(page, I1, 'w');
    await open(page, '#/catalog');
    await page.locator('[data-filter="side"] [data-value="b"]').click();
    await page.locator('label[for="pick-pirc"]').click();
    await expect(page.locator('#catalog-count')).toHaveText('Избрани: 10');
    await setUi(page, 'maxReviewsPerDay', 33);
    const orig = await row(page, 'italian', I1.id);
    await open(page, '#/settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#backup-export').click()]);
    expect(dl.suggestedFilename()).toMatch(/^lrnoldgame-backup-\d{4}-\d\d-\d\d\.json$/);
    const file = await dl.path();
    await expect(page.locator('#backup-msg')).toHaveText('Бекъпът е изтеглен.');
    await shot(page, '19-bekap');

    // „Изтриване на данните“: изтриваме IndexedDB и на същото устройство
    await page.evaluate(async () => {
      globalThis.__lrn.userDb.close();
      await new Promise((r, j) => { const q = indexedDB.deleteDatabase('lrnoldgame'); q.onsuccess = r; q.onerror = j; q.onblocked = r; });
    });
    await page.goto('./#/courses');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect(page.locator('.course-card')).toHaveCount(9);
    await open(page, '#/course/italian');
    await expect(page.locator('#course-learned')).toHaveText(`научени 0/${LINES.italian}`);

    // Внос
    await open(page, '#/settings');
    page.once('dialog', (d) => d.accept());
    await page.locator('#backup-file').setInputFiles(file);
    await expect(page.locator('#backup-msg')).toHaveText('Бекъпът е зареден.');
    await page.waitForEvent('load');
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await open(page, '#/courses');
    await expect(page.locator('.course-card')).toHaveCount(10);
    const back = await row(page, 'italian', I1.id);
    expect(back.status).toBe('learned');
    expect(back.due).toBe(orig.due);
    expect(back.fsrs).toEqual(orig.fsrs);
    await open(page, '#/settings');
    await expect(page.locator('#set-maxReviewsPerDay')).toHaveValue('33');

    // Същият файл на „нов телефон“ (нов профил)
    const ctx2 = await browser.newContext({ ...test.info().project.use, baseURL: test.info().project.use.baseURL });
    const p2 = await ctx2.newPage();
    await open(p2, '#/settings');
    p2.once('dialog', (d) => d.accept());
    await p2.locator('#backup-file').setInputFiles(file);
    await p2.waitForEvent('load');
    await expect(p2.locator('html')).toHaveAttribute('data-ready', '1');
    await open(p2, '#/course/italian');
    await expect(p2.locator('#course-learned')).toHaveText(`научени 1/${LINES.italian}`);
    await ctx2.close();
  });
});

test.describe('T-013 устойчивост', () => {
  test('бързи двойни натискания: „Пак“, „Подсказка“, ходове по време на хода на противника', async ({ page }) => {
    await open(page);
    await fast(page);
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    await playLine(page, I1, 'w');
    await againBtn(page).dblclick();
    await playLine(page, I1, 'w');
    const atts = await page.evaluate((id) => globalThis.__lrn.userDb.attemptsFor('italian', id), I1.id);
    expect(atts.map((a) => a.ok)).toEqual([true, true]);
    await page.evaluate(() => globalThis.__lrn.settings.set('opponentDelayMs', 800));
    await againBtn(page).click();
    await move(page, 'e2', 'e4');
    await move(page, 'g1', 'f3'); // докато „Противникът мисли…“
    await move(page, 'g1', 'f3');
    await expect.poll(() => turn(page)).toBe('user@2');
    await expect(page.locator('#played .mv')).toHaveCount(2);
    await expect(page.locator('#streak')).toHaveAttribute('data-streak', '2');
    await hintBtn(page).dblclick();
    await expect(page.locator('#train-msg')).toHaveText('Подсказка');
  });

  for (const [w, h] of [[360, 640], [320, 568]]) {
    test(`малък екран ${w}×${h}: без хоризонтален скрол, дъската се вижда цяла`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page);
      for (const hash of ['#/courses', '#/catalog', '#/settings', `#/train/italian/${I1.id}?mode=learn`]) {
        await open(page, hash);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      }
      const b = await page.locator('.board-wrap').boundingBox();
      const tabsTop = await page.locator('#tabs').evaluate((e) => e.getBoundingClientRect().top);
      expect(await boardSpan(page)).toBeGreaterThanOrEqual(w - 40); // дъската + колоната с оценката (D-035)
      expect(b.y + b.height).toBeLessThanOrEqual(tabsTop);
      await shot(page, `20-trenirovka-${w}x${h}`);
    });
  }

  test('бавна мрежа (400 kbps, 400 ms) при първо зареждане: 9 курса и офлайн след това', async ({ page, context }) => {
    test.setTimeout(120_000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 });
    await page.goto('./');
    await expect(page.locator('.course-card')).toHaveCount(9, { timeout: 60_000 });
    await waitForSW(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.course-card')).toHaveCount(9);
    await context.setOffline(false);
  });

  test('изтрита IndexedDB при кеширано приложение → като първо пускане (9 курса)', async ({ page }) => {
    await open(page);
    await waitForSW(page);
    await page.evaluate(async () => {
      globalThis.__lrn.userDb.close();
      await new Promise((r) => { const q = indexedDB.deleteDatabase('lrnoldgame'); q.onsuccess = r; q.onblocked = r; });
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect(page.locator('.course-card')).toHaveCount(9);
  });

  test('повредена IndexedDB (непозната по-нова версия) → ясно съобщение, каталогът се вижда', async ({ page }) => {
    await open(page);
    await page.evaluate(async () => {
      globalThis.__lrn.userDb.close();
      await new Promise((r) => { const q = indexedDB.deleteDatabase('lrnoldgame'); q.onsuccess = r; q.onblocked = r; });
      await new Promise((r) => { const q = indexedDB.open('lrnoldgame', 99); q.onupgradeneeded = () => q.result.createObjectStore('junk'); q.onsuccess = () => { q.result.close(); r(); }; });
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect(page.locator('#screen')).toContainText('Хранилището на браузъра (IndexedDB) не е достъпно');
    await open(page, '#/catalog');
    await expect(page.locator('.catalog-row')).toHaveCount(15);
    await shot(page, '24-povredena-idb');
  });

  test('стар бекъп (0.3.0: научена линия без FSRS карта) → картата се създава, линията идва за преговор', async ({ page }) => {
    await open(page);
    const snap = await page.evaluate(() => globalThis.__lrn.userDb.exportBackup({ appVersion: '0.3.0', touch: false }));
    const learnedAt = Date.now() - 10 * 86_400_000;
    const old = { ...snap, appVersion: '0.3.0', dataVersion: '2026-11-20.1', stores: { ...snap.stores,
      lineProgress: [{ key: `italian/${I1.id}`, courseId: 'italian', lineId: I1.id, n: 1, status: 'learned', streak: 3, learnedAt, lastPlayed: learnedAt }],
      meta: snap.stores.meta.filter((m) => !['lineIds', 'dataVersion', 'dataUpdate'].includes(m.key)) } };
    await open(page, '#/settings');
    page.once('dialog', (d) => d.accept());
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('#backup-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) }),
    ]);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await open(page, '#/course/italian');
    await expect(page.locator('#course-learned')).toHaveText(`научени 1/${LINES.italian}`);
    await expect(page.locator(`.line-row[data-line="${I1.id}"]`)).toContainText('преговор днес');
    expect((await row(page, 'italian', I1.id)).fsrs).toBeTruthy();
    // чужд файл → ясна грешка, данните не се пипат
    await open(page, '#/settings');
    await page.locator('#backup-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
    await expect(page.locator('#backup-msg')).toHaveText('Файлът не е бекъп на LrnOldGame.');
  });
});

// Дефекти от T-013, поправени в T-025 (0.5.1): тестовете вече са без test.fail.
test.describe('T-013 дефекти (поправени в T-025)', () => {
  test('T013-D1: презареждане след грешка не бива да запази брояча (learn)', async ({ page }) => {
    await open(page);
    await fast(page);
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    for (let k = 0; k < 2; k++) { await playLine(page, I1, 'w'); await againBtn(page).click(); }
    await playLine(page, I1, 'w', { stopAt: 2 });
    await move(page, 'a2', 'a3');
    await expect(page.locator('#streak')).toHaveAttribute('data-streak', '0');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect.poll(async () => (await row(page, 'italian', I1.id)).streak, { timeout: 2000 }).toBe(0);
  });

  test('T013-D1: презареждане по време на преговор след грешка не бива да даде „Добре“', async ({ page }) => {
    await open(page);
    await fast(page, { learnStreak: 1 });
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    await playLine(page, I1, 'w');
    await open(page, `#/train/italian/${I1.id}?mode=review`, '?now=+3d');
    await fast(page, { learnStreak: 1 });
    await playLine(page, I1, 'w', { stopAt: 2 });
    await move(page, 'a2', 'a3');
    await expect(page.locator('#train-msg')).toHaveAttribute('data-kind', 'correct');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await playLine(page, I1, 'w');
    await expect(page.locator('#train-done')).not.toHaveAttribute('data-grade', 'good', { timeout: 2000 });
  });

  test('T013-D2: „Преговор“ не показва текст „null“', async ({ page }) => {
    await open(page);
    await fast(page, { learnStreak: 1 });
    await open(page, `#/train/italian/${I1.id}?mode=learn`);
    await playLine(page, I1, 'w');
    await open(page, '#/review', '?now=+3d');
    await expect(page.locator('#review-count')).toBeVisible();
    await expect(page.locator('#screen')).not.toContainText('null', { timeout: 1000 });
  });

  test('T013-D5: текстовете в „Настройки“ — без „(дни) (дни)“ и „false“', async ({ page }) => {
    await open(page, '#/settings');
    await expect(page.locator('[data-key="firstReviewDays"] label')).toHaveText('Първи преговор след (дни)', { timeout: 1000 });
    await expect(page.locator('form.settings')).not.toContainText(/: (true|false)\./, { timeout: 1000 });
  });
});
