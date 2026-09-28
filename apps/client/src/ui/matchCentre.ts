import { CricketMatch, InningsState, VARIATION_LABEL, Variation, inningsPhase, manhattan, oversString, pitchMap, wagonShots, worm } from '@crease/sim';
import { CHART, LENGTH_ZONES, legendHtml, manhattanSvg, pitchMapSvg, wagonSummary, wagonWheelSvg, wormSvg } from './charts';
import { describeBall } from './commentary';
import { esc, h } from './dom';

export type CentreTab = 'scorecard' | 'wagon' | 'pitch' | 'manhattan' | 'worm' | 'commentary';

const TABS: [CentreTab, string][] = [
  ['scorecard', 'Scorecard'],
  ['wagon', 'Wagon wheel'],
  ['pitch', 'Pitch map'],
  ['manhattan', 'Manhattan'],
  ['worm', 'Worm'],
  ['commentary', 'Commentary'],
];

export interface MatchCentreOptions {
  title: string;
  /** Extra line under the title (result, Player of the Match...). */
  sub?: HTMLElement | string | null;
  tab?: CentreTab;
  scorecardHtml: (inn: InningsState) => string;
  actions: HTMLElement[];
}

/**
 * Match Centre: scorecard, charts and ball-by-ball commentary for the match so
 * far. Used from the pause menu, the innings break and the result screen.
 */
export function matchCentre(m: CricketMatch, opts: MatchCentreOptions): HTMLElement {
  let tab: CentreTab = opts.tab ?? 'scorecard';
  let innIdx = Math.max(0, m.innings.length - 1);
  let player = -1; // batter (wagon wheel) or bowler (pitch map); -1 = all
  const tabs = h('div', { class: 'mc-tabs', role: 'tablist' });
  const tools = h('div', { class: 'mc-tools' });
  const body = h('div', { class: 'mc-body', role: 'tabpanel' });
  const tip = h('div', { class: 'chart-tip' });
  tip.style.display = 'none';
  const teams = m.cfg.teams;
  const rules = m.cfg.rules;
  const bpo = rules.ballsPerOver;
  const main = m.innings.filter((i) => !i.superOver);

  const innLabel = (inn: InningsState) => `${inn.superOver ? 'Super over · ' : ''}${teams[inn.battingTeam]!.shortName} ${inn.runs}/${inn.wickets}`;

  const renderTools = () => {
    tools.innerHTML = '';
    if (tab === 'scorecard' || tab === 'manhattan' || tab === 'worm') return;
    const chips = h('div', { class: 'row mc-inns' });
    m.innings.forEach((inn, i) => {
      chips.append(h('button', { class: `ctrl${i === innIdx ? ' on' : ''}`, onclick: () => { innIdx = i; player = -1; render(); } }, innLabel(inn)));
    });
    tools.append(chips);
    const inn = m.innings[innIdx];
    if (!inn || tab === 'commentary') return;
    const bat = tab === 'wagon';
    const list = bat ? inn.batters.map((b) => b.player) : inn.bowlers.map((b) => b.player);
    const team = teams[bat ? inn.battingTeam : inn.bowlingTeam]!;
    const sel = h('select', { 'aria-label': bat ? 'Batter' : 'Bowler', onchange: (e: Event) => { player = Number((e.target as HTMLSelectElement).value); render(); } },
      h('option', { value: '-1', selected: player === -1 }, bat ? 'All batters' : 'All bowlers'),
      ...list.map((p) => h('option', { value: String(p), selected: p === player }, team.players[p]!.name)));
    tools.append(sel);
  };

  const wagon = (inn: InningsState): string => {
    const shots = wagonShots(inn, player >= 0 ? player : undefined);
    const team = teams[inn.battingTeam]!;
    const sum = wagonSummary(shots);
    const total = sum.off + sum.leg + sum.straight;
    const pct = (v: number) => (total ? `${Math.round((v * 100) / total)}%` : '-');
    return `<div class="mc-split"><div><div class="mc-chart">${wagonWheelSvg(shots, (s) => `${team.players[s.player]!.shortName} · ${s.boundary ? (s.boundary === 6 ? 'SIX' : 'FOUR') : `${s.runs} run${s.runs === 1 ? '' : 's'}`}`)}</div>
      ${legendHtml([{ label: '1-3 runs', color: CHART.neutral, shape: 'line' }, { label: 'Four', color: CHART.series[0], shape: 'line' }, { label: 'Six', color: CHART.series[1], shape: 'line' }])}</div>
      <div><table class="card mc-table"><thead><tr><th>Area</th><th>Runs</th><th>Share</th></tr></thead><tbody>
      <tr><td>Off side</td><td>${sum.off}</td><td>${pct(sum.off)}</td></tr>
      <tr><td>Leg side</td><td>${sum.leg}</td><td>${pct(sum.leg)}</td></tr>
      <tr><td>Straight</td><td>${sum.straight}</td><td>${pct(sum.straight)}</td></tr>
      <tr><td class="muted">Fours / sixes</td><td>${sum.fours} / ${sum.sixes}</td><td></td></tr></tbody></table></div></div>`;
  };

  const pitch = (inn: InningsState): string => {
    const pts = pitchMap(inn, player >= 0 ? player : undefined);
    const bowlTeam = teams[inn.bowlingTeam]!;
    const label = (p: (typeof pts)[number]) =>
      `${bowlTeam.players[p.bowler]!.shortName} · ${p.speedKmh ?? '-'} km/h ${p.variation ? VARIATION_LABEL[p.variation as Variation] ?? p.variation : ''} · ${p.wicket ? 'WICKET' : p.runs === 0 ? 'dot' : `${p.runs} run${p.runs === 1 ? '' : 's'}`}${p.full ? ' · on the full' : ''}`;
    const rows = LENGTH_ZONES.map((z) => {
      const inZone = pts.filter((p) => p.length >= z.from && (p.length < z.to || (z.name === 'Short' && p.length >= 8)));
      const runs = inZone.reduce((a, p) => a + p.runs, 0);
      const wk = inZone.filter((p) => p.wicket).length;
      return `<tr><td>${z.name}</td><td>${inZone.length}</td><td>${runs}</td><td>${wk}</td><td>${inZone.length ? ((runs * bpo) / inZone.length).toFixed(1) : '-'}</td></tr>`;
    }).join('');
    return `<div class="mc-split"><div><div class="mc-chart narrow">${pitchMapSvg(pts, label)}</div>
      ${legendHtml([{ label: 'Dot ball', color: CHART.neutral, shape: 'ring' }, { label: '1-3 runs', color: CHART.neutral, shape: 'dot' }, { label: 'Four', color: CHART.series[0], shape: 'dot' }, { label: 'Six', color: CHART.series[1], shape: 'dot' }, { label: 'Wicket', color: CHART.series[2], shape: 'cross' }])}</div>
      <div><p class="muted mc-note">Where each delivery pitched, seen from the bowler's end. Balls hit on the full are shown where they were aimed.</p>
      <table class="card mc-table"><thead><tr><th>Length</th><th>Balls</th><th>Runs</th><th>Wkts</th><th>Runs/over</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  };

  const phases = (): string => {
    const rows = main.map((inn) => {
      const acc = { powerplay: [0, 0], middle: [0, 0], death: [0, 0] } as Record<string, [number, number]>;
      manhattan(inn, bpo).forEach((o, i) => {
        const ph = inningsPhase(rules, i);
        acc[ph]![0] += o.runs;
        acc[ph]![1] += o.wickets;
      });
      const c = (k: string) => `${acc[k]![0]}/${acc[k]![1]}`;
      return `<tr><td>${esc(teams[inn.battingTeam]!.name)}</td><td>${c('powerplay')}</td><td>${c('middle')}</td><td>${c('death')}</td></tr>`;
    }).join('');
    return `<table class="card mc-table"><thead><tr><th>Innings</th><th>Powerplay</th><th>Middle</th><th>Death</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const manhattanTab = (): string => {
    const series = main.map((inn) => ({ label: teams[inn.battingTeam]!.shortName, overs: manhattan(inn, bpo) }));
    return `<div class="mc-chart wide">${manhattanSvg(series, rules.overs)}</div>
      ${legendHtml([...series.map((s, i) => ({ label: s.label, color: CHART.series[i]!, shape: 'bar' as const })), { label: 'Wicket', color: CHART.muted, shape: 'cross' }])}${phases()}`;
  };

  const wormTab = (): string => {
    const series = main.map((inn) => ({ label: teams[inn.battingTeam]!.shortName, points: worm(inn, bpo) }));
    const target = main[1]?.target ?? null;
    return `<div class="mc-chart wide">${wormSvg(series, rules.overs, target)}</div>
      ${legendHtml([...series.map((s, i) => ({ label: s.label, color: CHART.series[i]!, shape: 'line' as const })), { label: 'Wicket(s) in the over', color: CHART.muted, shape: 'cross' }])}${phases()}`;
  };

  const commentaryTab = (inn: InningsState): string => {
    if (!inn.log.length) return '<p class="muted">No balls bowled yet.</p>';
    const out: string[] = [];
    let lastOver = -1;
    for (let i = inn.log.length - 1; i >= 0; i--) {
      const rec = inn.log[i]!;
      if (rec.over !== lastOver) {
        const balls = inn.log.filter((l) => l.over === rec.over);
        const runs = balls.reduce((a, l) => a + l.outcome.batRuns + l.outcome.extraRuns + (l.outcome.extra === 'wide' || l.outcome.extra === 'noBall' ? 1 : 0), 0);
        const done = balls.filter((l) => l.outcome.extra !== 'wide' && l.outcome.extra !== 'noBall').length >= bpo;
        out.push(`<div class="cm-over">Over ${rec.over + 1} · ${esc(teams[inn.bowlingTeam]!.players[rec.bowler]!.name)} · ${runs} run${runs === 1 ? '' : 's'}${done ? '' : ' (in progress)'}</div>`);
        lastOver = rec.over;
      }
      const c = describeBall(teams, inn, i, bpo);
      const cls = rec.outcome.wicket ? 'w' : rec.outcome.boundary === 6 ? 's6' : rec.outcome.boundary === 4 ? 's4' : '';
      out.push(`<div class="cm-line ${cls}"><span class="cm-ov">${esc(c.over)}</span><span>${esc(c.text)}${c.milestone ? `<span class="cm-ms">${esc(c.milestone)}</span>` : ''}</span></div>`);
    }
    return `<div class="cm-list">${out.join('')}</div>`;
  };

  const render = () => {
    tabs.innerHTML = '';
    for (const [id, label] of TABS) {
      tabs.append(h('button', { class: `mc-tab${id === tab ? ' on' : ''}`, role: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; player = -1; render(); } }, label));
    }
    renderTools();
    const inn = m.innings[innIdx]!;
    switch (tab) {
      case 'scorecard':
        body.innerHTML = m.innings.map((i) => opts.scorecardHtml(i)).join('');
        break;
      case 'wagon':
        body.innerHTML = wagon(inn);
        break;
      case 'pitch':
        body.innerHTML = pitch(inn);
        break;
      case 'manhattan':
        body.innerHTML = manhattanTab();
        break;
      case 'worm':
        body.innerHTML = wormTab();
        break;
      case 'commentary':
        body.innerHTML = commentaryTab(inn);
        break;
    }
  };

  // Hover / tap tooltips for chart marks.
  const showTip = (e: PointerEvent) => {
    const target = (e.target as Element | null)?.closest?.('[data-tip]');
    if (!target) {
      tip.style.display = 'none';
      return;
    }
    tip.textContent = target.getAttribute('data-tip');
    tip.style.display = '';
    const r = card.getBoundingClientRect();
    const x = Math.min(e.clientX - r.left + 14, r.width - 220);
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${e.clientY - r.top + card.scrollTop + 14}px`;
  };
  body.addEventListener('pointermove', showTip);
  body.addEventListener('pointerdown', showTip);
  body.addEventListener('pointerleave', () => (tip.style.display = 'none'));

  const card = h('div', { class: 'menu-card match-centre' },
    h('div', { class: 'mc-head' }, h('h2', {}, opts.title), opts.sub ? (typeof opts.sub === 'string' ? h('p', { class: 'muted' }, opts.sub) : opts.sub) : null,
      h('p', { class: 'muted mc-score' }, main.map((i) => `${teams[i.battingTeam]!.name} ${i.runs}/${i.wickets} (${oversString(i.legalBalls, bpo)} ov)`).join('  ·  '))),
    tabs, tools, body, tip,
    h('div', { class: 'row', style: 'margin-top:18px' }, ...opts.actions));
  render();
  return card;
}
