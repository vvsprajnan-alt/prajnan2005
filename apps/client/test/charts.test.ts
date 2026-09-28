import { describe, expect, it } from 'vitest';
import { MatchHost, TEAMS, defaultConfig, manhattan, pitchMap, wagonShots, worm } from '@crease/sim';
import { CHART, legendHtml, manhattanSvg, pitchMapSvg, runsColor, wagonSummary, wagonWheelSvg, wormSvg } from '../src/ui/charts';

const cfg = defaultConfig([TEAMS[0]!, TEAMS[1]!], 3, 21);
const host = new MatchHost(cfg, { humanTeams: [], autoRunForHumans: false });
let t = 0;
while (host.match.phase !== 'complete' && t++ < 120 * 60 * 40) host.step();
const [i1, i2] = host.match.innings;

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('match centre charts', () => {
  it('draws one tooltip-bearing mark per scoring shot on the wagon wheel', () => {
    const shots = wagonShots(i1!);
    const svg = wagonWheelSvg(shots);
    expect(count(svg, /data-tip=/g)).toBe(shots.length);
    expect(svg).toContain('OFF');
    expect(svg).not.toMatch(/NaN|undefined/);
    const sum = wagonSummary(shots);
    expect(sum.off + sum.leg + sum.straight).toBe(shots.reduce((a, s) => a + s.runs, 0));
  });

  it('colours boundaries by the categorical palette and everything else neutral', () => {
    expect(runsColor(4)).toBe(CHART.series[0]);
    expect(runsColor(6)).toBe(CHART.series[1]);
    expect(runsColor(0)).toBe(CHART.neutral);
  });

  it('marks every delivery on the pitch map and wickets with a cross', () => {
    const pts = pitchMap(i1!);
    const svg = pitchMapSvg(pts, (p) => `${p.runs}`);
    expect(count(svg, /data-tip=/g)).toBe(pts.length);
    const wickets = pts.filter((p) => p.wicket).length;
    expect(count(svg, new RegExp(`stroke="${CHART.series[2]}"`, 'g'))).toBe(wickets);
    expect(svg).toContain('Yorker');
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('draws grouped Manhattan bars with a cross per wicket', () => {
    const series = [i1!, i2!].map((inn, i) => ({ label: `T${i}`, overs: manhattan(inn) }));
    const svg = manhattanSvg(series, 3);
    const overs = series.reduce((a, s) => a + s.overs.length, 0);
    expect(count(svg, /data-tip=/g)).toBe(overs);
    const wkts = series.reduce((a, s) => a + s.overs.reduce((b, o) => b + o.wickets, 0), 0);
    expect(count(svg, /stroke-width="2.2"/g)).toBe(wkts);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('draws a worm per innings, labelled at its end, with the target line', () => {
    const series = [i1!, i2!].map((inn, i) => ({ label: `TEAM${i}`, points: worm(inn) }));
    const svg = wormSvg(series, 3, i2!.target);
    expect(count(svg, /<path d="M/g)).toBeGreaterThanOrEqual(2);
    expect(svg).toContain('TEAM0');
    expect(svg).toContain('TEAM1');
    expect(svg).toContain(`Target ${i2!.target}`);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('builds legends with text labels (identity is never colour alone)', () => {
    const html = legendHtml([{ label: 'Four', color: CHART.series[0] }, { label: 'Wicket', color: CHART.series[2], shape: 'cross' }]);
    expect(html).toContain('Four');
    expect(html).toContain('Wicket');
    expect(count(html, /class="lg-item"/g)).toBe(2);
  });
});
