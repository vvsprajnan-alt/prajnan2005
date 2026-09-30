/**
 * Browser end-to-end suite: drives the built game in real (headless) Chromium
 * against a running server. Needs the `playwright` package and a Chromium.
 *
 *   npm run server                    # builds the client and serves it on :8787
 *   node scripts/e2e-browser.mjs [url] [outDir]
 *
 * Flows: single player (intro, batting/bowling a few balls, captions, replays,
 * instant replay, every Match Centre tab) and online 1v1 through matchmaking
 * (intro skip, a delivery, captions, a replay giving way to live play).
 * Exits non-zero on any failure or page error.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:8787/';
const out = process.argv[3] ?? 'test-results/e2e';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const log = (...a) => console.log(...a);
let failed = false;

async function newPage(name, settings) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  // Low quality keeps software rendering usable.
  await page.addInitScript((s) => localStorage.setItem('crease-clash-settings-v1', JSON.stringify(s)), { quality: 'low', adaptiveResolution: false, playerName: name, ...settings });
  await page.goto(url);
  await page.waitForTimeout(1200);
  return page;
}
const state = (p) => p.evaluate(() => {
  const s = window.__crease?.session;
  const m = s?.match;
  return m ? { phase: m.phase, z: m.ball.pos.z, balls: m.inn.log.length, batting: m.inn.battingTeam, team: s.humanTeam, replay: !!s.replay, summary: m.lastSummary } : null;
});
async function waitFor(p, pred, ms = 120000, what = 'state') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await state(p);
    if (s && pred(s)) return s;
    await p.waitForTimeout(40);
  }
  throw new Error(`timeout: ${what} (last ${JSON.stringify(await state(p))})`);
}
const check = (ok, msg) => {
  log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

/** Bowl one ball as the local player (closing the bowler picker if it is up). */
async function bowlOne(p) {
  await waitFor(p, (s) => s.phase === 'preDelivery' && !s.replay, 150000, 'pre-delivery');
  const overStart = await p.evaluate(() => window.__crease.currentMatch.inn.thisOver.length === 0);
  if (overStart) await p.waitForSelector('.picker', { state: 'visible', timeout: 20000 }).catch(() => {});
  if (await p.locator('.picker').isVisible()) await p.locator('.picker button', { hasText: 'Done' }).click();
  await p.waitForTimeout(300);
  await p.keyboard.press('Space');
  await waitFor(p, (s) => s.phase === 'runUp', 30000, 'run-up');
  const dur = await p.evaluate(() => window.__crease.currentMatch.runUpDuration);
  await p.waitForTimeout(Math.max(0, dur * 1000 - 400));
  await p.keyboard.press('Space');
}

async function singlePlayer() {
  log('\n# Single player');
  const p = await newPage('Solo');
  await p.getByText('Play', { exact: true }).click();
  await p.getByText('To the toss').click();
  await p.getByText('Heads', { exact: true }).click();
  if (await p.getByText('Bat first').count()) await p.getByText('Bat first').click();
  else await p.locator('.btn').first().click();
  await p.waitForTimeout(1500);
  check(await p.locator('.intro').isVisible(), 'team intro shows');
  await p.keyboard.press('Space');
  await waitFor(p, (s) => s.phase !== 'intro', 20000, 'intro skipped');
  check(true, 'intro skips with Space');
  for (let i = 0; i < 4; i++) {
    const s = await waitFor(p, (s) => (s.phase === 'preDelivery' || s.phase === 'runUp') && !s.replay, 150000, 'next ball');
    if (s.batting !== 0) await bowlOne(p);
    else {
      await waitFor(p, (s) => s.phase === 'inPlay' && s.z > 0, 60000, 'ball in play');
      await p.keyboard.down('KeyW');
      await p.keyboard.press(i % 2 ? 'KeyK' : 'Space');
      await p.waitForTimeout(150);
      await p.keyboard.up('KeyW');
    }
    const end = await waitFor(p, (s) => s.phase === 'dead', 90000, 'ball complete');
    await p.waitForTimeout(400);
    const cap = (await p.locator('.caption').isVisible()) ? await p.locator('.caption').innerText() : '';
    check(cap.length > 10, `ball ${i + 1}: ${end.summary} | caption "${cap.replace(/\s+/g, ' ').slice(0, 70)}"`);
    if (await p.locator('.replay-badge').isVisible()) await p.keyboard.press('Space');
  }
  await waitFor(p, (s) => s.phase === 'preDelivery' && !s.replay, 150000, 'between balls');
  await p.keyboard.press('KeyI');
  await p.waitForSelector('.replay-badge', { state: 'visible', timeout: 10000 }).then(() => check(true, 'instant replay starts'), () => check(false, 'instant replay starts'));
  await p.screenshot({ path: `${out}/replay.png` });
  await p.keyboard.press('Space');
  await p.waitForSelector('.replay-badge', { state: 'hidden', timeout: 10000 }).then(() => check(true, 'replay skips'), () => check(false, 'replay skips'));
  await p.keyboard.press('Escape');
  await p.getByText('Match Centre').click();
  for (const tab of ['Scorecard', 'Wagon wheel', 'Pitch map', 'Manhattan', 'Worm', 'Commentary']) {
    await p.getByRole('tab', { name: tab }).click();
    await p.waitForTimeout(200);
    const body = await p.locator('.mc-body').innerText();
    check(body.length > 20, `Match Centre: ${tab}`);
  }
  await p.screenshot({ path: `${out}/match-centre.png` });
  await p.context().close();
}

async function online() {
  log('\n# Online 1v1 (matchmaking)');
  const A = await newPage('Asha');
  const B = await newPage('Ben');
  for (const p of [A, B]) await p.getByText('Play Online').click();
  await A.getByRole('button', { name: '1v1', exact: true }).click();
  await B.getByRole('button', { name: '1v1', exact: true }).click();
  for (const p of [A, B]) await p.waitForFunction(() => window.__crease.session?.driver?.networked === true, null, { timeout: 30000 });
  check(true, 'matched and started');
  await waitFor(A, (s) => s.phase === 'intro', 20000, 'intro').then(() => check(true, 'intro on both')).catch(() => check(false, 'intro on both'));
  await A.keyboard.press('Space');
  for (const p of [A, B]) await waitFor(p, (s) => s.phase !== 'intro', 30000, 'intro skipped');
  check(true, 'intro skipped for everyone');
  const sa = await state(A);
  const bowler = sa.team === sa.batting ? B : A;
  const batter = bowler === A ? B : A;
  await bowlOne(bowler);
  await waitFor(batter, (s) => s.phase === 'dead', 90000, 'ball complete');
  await batter.waitForTimeout(400);
  check((await batter.locator('.caption').innerText().catch(() => '')).length > 10, 'caption on the other player');
  await waitFor(batter, (s) => s.phase === 'preDelivery', 90000, 'next ball');
  await batter.keyboard.press('KeyI');
  await batter.waitForSelector('.replay-badge', { state: 'visible', timeout: 10000 }).then(() => check(true, 'instant replay online'), () => check(false, 'instant replay online'));
  await bowlOne(bowler);
  await waitFor(batter, (s) => s.phase === 'runUp' || s.phase === 'inPlay', 60000, 'next run-up');
  await batter.waitForTimeout(500);
  check(!(await state(batter)).replay, 'replay gives way to live play');
  await A.context().close();
  await B.context().close();
}

for (const flow of [singlePlayer, online]) {
  try {
    await flow();
  } catch (e) {
    check(false, `${flow.name}: ${e.message}`);
  }
}
check(errors.length === 0, `no page errors${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
