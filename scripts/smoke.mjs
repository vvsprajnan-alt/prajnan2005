/**
 * Browser smoke test: loads the built game, starts a match, plays a few balls
 * (batting via real key presses timed off the live match state) and takes
 * screenshots. Usage: node scripts/smoke.mjs [url] [outDir]
 * Requires the `playwright` package and a Chromium build.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'test-results';
const prefer = process.argv[4] ?? 'bat'; // 'bat' | 'bowl'
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const state = () => page.evaluate(() => {
  const m = window.__crease?.currentMatch;
  if (!m) return null;
  return { phase: m.phase, z: m.ball.pos.z, bat: m.batContact, runs: m.inn.runs, wkts: m.inn.wickets, balls: m.inn.legalBalls, batting: m.inn.battingTeam, summary: m.lastSummary };
});
const waitFor = async (pred, timeout = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await state();
    if (s && pred(s)) return s;
    await page.waitForTimeout(30);
  }
  throw new Error('timeout waiting for state');
};

await page.goto(url);
await page.waitForTimeout(1500);
await page.getByText('Play', { exact: true }).click();
await page.getByText('To the toss').click();
await page.getByText('Heads', { exact: true }).click();
// Either we won (choose bat) or the AI chose.
if (await page.getByText('Bat first').count()) await page.getByText(prefer === 'bowl' ? 'Bowl first' : 'Bat first').click();
else await page.locator('.btn').first().click();
await page.waitForTimeout(800);

const shots = ['Space', 'KeyK', 'Space', 'KeyL'];
for (let i = 0; i < 4; i++) {
  const s = await waitFor((s) => s.phase === 'preDelivery' || s.phase === 'runUp' || s.phase === 'inPlay');
  const humanBats = s.batting === 0;
  if (!humanBats) {
    // Bowling: start run-up and release.
    await waitFor((s) => s.phase === 'preDelivery');
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyD');
    await page.screenshot({ path: `${out}/bowl-${i}-marker.png` });
    await page.keyboard.press(`Digit${1 + (i % 4)}`);
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await waitFor((s) => s.phase === 'runUp');
    const dur = await page.evaluate(() => window.__crease.currentMatch.runUpDuration);
    await page.waitForTimeout(dur * 1000 - 380);
    await page.screenshot({ path: `${out}/bowl-${i}-runup.png` });
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/bowl-${i}-delivery.png` });
  } else {
    await waitFor((s) => s.phase === 'runUp');
    await page.screenshot({ path: `${out}/bat-${i}-runup.png` });
    // Press the shot as the ball reaches ~6 m from the batter.
    await waitFor((s) => s.phase === 'inPlay' && s.z > (i % 2 ? -1.5 : 0.5));
    await page.keyboard.down(i % 2 ? 'KeyA' : 'KeyW');
    await page.keyboard.press(shots[i]);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/bat-${i}-contact.png` });
    await page.keyboard.up(i % 2 ? 'KeyA' : 'KeyW');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/bat-${i}-follow.png` });
    await page.keyboard.press('KeyR');
  }
  const end = await waitFor((s) => s.phase === 'dead', 30000);
  console.log(`ball ${i + 1}: ${end.summary} -> ${end.runs}/${end.wkts} (${end.balls} balls)`);
  await page.screenshot({ path: `${out}/ball-${i}-dead.png` });
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No page errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
