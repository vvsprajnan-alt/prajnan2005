import { BallRecord, InningsState, PlayerDef, STROKES, Stroke, VARIATION_LABEL, Variation, oversString } from '@crease/sim';

/**
 * Broadcast-style text commentary. Pure and deterministic: the phrasing for a
 * ball is picked from the ball's position in the innings, so everyone watching
 * the same match reads the same line.
 */

export interface CommentaryInput {
  rec: BallRecord;
  /** Index of this record in `inn.log`. */
  index: number;
  inn: InningsState;
  bowler: PlayerDef;
  batter: PlayerDef;
  /** Name of the fielder involved in a dismissal, if any. */
  fielder?: string;
  ballsPerOver: number;
}

export interface Commentary {
  /** e.g. "4.3" */
  over: string;
  text: string;
  /** Headline for milestone moments ("FIFTY", "HAT-TRICK"...). */
  milestone?: string;
  /** Short title for boundaries and wickets. */
  headline?: string;
}

const pick = <T>(options: T[], seed: number): T => options[Math.abs(seed) % options.length]!;

const hash = (a: number, b: number): number => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13;
  return h >>> 0;
};

/** Field region for a shot angle (relative to the batter: 0 straight, + off side). */
export function region(angle: number): string {
  const a = Math.abs(angle);
  const off = angle >= 0;
  if (a < 12) return 'straight down the ground';
  if (a < 40) return off ? 'past mid-off' : 'past mid-on';
  if (a < 75) return off ? 'through the covers' : 'through midwicket';
  if (a < 110) return off ? 'square on the off side' : 'square on the leg side';
  if (a < 150) return off ? 'behind point' : 'behind square leg';
  return off ? 'down to third man' : 'fine down the leg side';
}

const surname = (p: PlayerDef) => p.name.split(' ').slice(1).join(' ') || p.name;

function strokeLabel(stroke: string | undefined): string {
  return stroke && stroke in STROKES ? STROKES[stroke as Stroke].label.toLowerCase() : 'shot';
}

function deliveryPhrase(rec: BallRecord): string {
  const o = rec.outcome;
  const v = o.variation && o.variation in VARIATION_LABEL ? VARIATION_LABEL[o.variation as Variation].toLowerCase() : 'delivery';
  const len = o.pitch ? (o.pitch.length < 1.8 ? 'yorker-length' : o.pitch.length < 4.5 ? 'full' : o.pitch.length < 8 ? 'good-length' : 'short') : 'full-toss';
  const speed = o.speedKmh ? `${o.speedKmh} km/h ` : '';
  return v === 'stock delivery' || v === 'stock' ? `${speed}${len} ball` : `${speed}${len} ${v}`;
}

export function commentary(c: CommentaryInput): Commentary {
  const { rec, inn, bowler, batter } = c;
  const o = rec.outcome;
  const seed = hash(c.index, inn.battingTeam * 7919 + inn.runs);
  const bowl = surname(bowler);
  const bat = surname(batter);
  const lead = `${bowl} to ${bat}, `;
  const shot = o.shot;
  const stroke = strokeLabel(shot?.stroke);
  const where = o.shotAngle !== undefined ? region(o.shotAngle) : '';
  const perfect = shot?.timing === 'perfect';
  const del = deliveryPhrase(rec);
  const overStr = oversString(c.inn.log.slice(0, c.index + 1).filter((l) => l.outcome.extra !== 'wide' && l.outcome.extra !== 'noBall').length, c.ballsPerOver);
  let text: string;
  let headline: string | undefined;

  if (o.wicket) {
    const f = c.fielder ?? 'the fielder';
    headline = 'WICKET';
    switch (o.wicket.kind) {
      case 'bowled':
        text = shot?.outcome === 'edge'
          ? pick([`OUT! Dragged on! The inside edge crashes into the stumps.`, `OUT! Played on - a sorry end for ${bat}.`], seed)
          : pick([`OUT! Clean bowled! The ${del} goes straight through the gate.`, `OUT! Timber! ${bat} is beaten and the stumps are shattered.`, `OUT! Bowled him! Knocked back the middle stump.`], seed);
        break;
      case 'caught':
        text = shot?.outcome === 'edge'
          ? pick([`OUT! Edged and taken by ${f}! The ${del} found the outside edge.`, `OUT! Nicked off - ${f} makes no mistake.`], seed)
          : pick([`OUT! Caught by ${f}! The ${stroke} goes straight to him.`, `OUT! Holed out! ${f} takes it cleanly ${where}.`, `OUT! ${bat} goes for the big one and ${f} pouches it.`], seed);
        break;
      case 'lbw':
        text = pick([`OUT! Trapped in front! Struck on the pad, and the finger goes up.`, `OUT! LBW - ${bat} misses the ${del} and is pinned on the crease.`], seed);
        break;
      case 'runOut':
        text = pick([`OUT! Run out! ${f} hits the stumps with the batter short of the crease.`, `OUT! Terrible mix-up - and ${f} completes the run out.`], seed);
        break;
      case 'stumped':
        text = pick([`OUT! Stumped! ${bat} charges, misses, and the keeper whips off the bails.`, `OUT! Beaten in the flight - stumped by a mile.`], seed);
        break;
      default:
        text = `OUT!`;
    }
  } else if (o.boundary === 6) {
    headline = 'SIX';
    text = pick([`SIX! ${perfect ? 'Timed to perfection - ' : ''}${bat} launches the ${del} ${where} into the crowd.`, `SIX! That's enormous! A ${stroke} that clears the rope with ease.`, `SIX! Picked the length early and deposited it ${where}.`], seed);
  } else if (o.boundary === 4) {
    headline = 'FOUR';
    if (o.extra === 'bye' || o.extra === 'legBye') text = `FOUR ${o.extra === 'bye' ? 'byes' : 'leg byes'}! It beats everyone and runs away to the rope.`;
    else if (o.extra === 'wide') text = `Wide - and it races away for four more. Expensive.`;
    else if (shot?.outcome === 'edge') text = pick([`FOUR! Thick edge, and it flies ${where}.`, `FOUR! Not off the middle, but it goes ${where} all the same.`], seed);
    else text = pick([`FOUR! ${perfect ? 'Glorious timing. ' : ''}A ${stroke} ${where}.`, `FOUR! Pierces the gap ${where} and races to the boundary.`, `FOUR! ${bat} leans into the ${stroke} and the fielder doesn't bother chasing.`], seed);
  } else if (o.extra === 'wide') {
    text = pick([`Wide. The ${del} strays too far from the batter.`, `Wide called - ${bowl} loses his line.`], seed);
  } else if (o.extra === 'noBall') {
    text = pick([`No ball! ${bat} gets a free hit next.`, `No ball called - and that means a free hit.`], seed);
  } else if (o.extra === 'bye' || o.extra === 'legBye') {
    text = `${o.extraRuns} ${o.extra === 'bye' ? 'bye' : 'leg bye'}${o.extraRuns > 1 ? 's' : ''} - they scamper through.`;
  } else if (o.batRuns === 1) {
    text = pick([`1 run, worked ${where}.`, `Single - a ${stroke} ${where}.`, `Nudged ${where} for one.`], seed);
  } else if (o.batRuns === 2) {
    text = pick([`2 runs - placed ${where} and they come back for the second.`, `Good running, two ${where}.`], seed);
  } else if (o.batRuns >= 3) {
    text = `${o.batRuns} runs - chased down just inside the rope ${where}.`;
  } else if (shot?.outcome === 'miss') {
    text = pick([`Beaten! The ${del} whistles past the edge.`, `Played and missed - lovely delivery from ${bowl}.`, `Swing and a miss. ${bowl} is on top here.`], seed);
  } else if (shot?.stroke === 'defence') {
    text = pick([`Solid defence to the ${del}.`, `Blocked back to the bowler.`, `Dead bat, no run.`], seed);
  } else if (!shot) {
    text = pick([`Left alone. ${bat} is happy to let the ${del} go.`, `No shot offered to the ${del}.`], seed);
  } else {
    text = pick([`No run - the ${stroke} goes straight to the fielder.`, `Dot ball. Good fielding cuts it off.`], seed);
  }

  return { over: overStr, text: lead + text, headline, milestone: milestoneFor(c) };
}

/** Milestones reached on this ball. */
export function milestoneFor(c: CommentaryInput): string | undefined {
  const { inn, rec, batter, bowler } = c;
  const before = inn.log.slice(0, c.index);
  const upto = inn.log.slice(0, c.index + 1);
  const batRuns = (log: BallRecord[]) => log.filter((l) => l.striker === rec.striker).reduce((a, l) => a + l.outcome.batRuns, 0);
  const b0 = batRuns(before);
  const b1 = batRuns(upto);
  for (const m of [100, 50]) if (b0 < m && b1 >= m) return `${m === 100 ? 'HUNDRED' : 'FIFTY'} for ${batter.name}`;
  const wk = (log: BallRecord[]) => log.filter((l) => l.bowler === rec.bowler && l.outcome.wicket && l.outcome.wicket.kind !== 'runOut').length;
  if (rec.outcome.wicket && rec.outcome.wicket.kind !== 'runOut') {
    const w = wk(upto);
    // Hat-trick: three wickets in three consecutive deliveries by the bowler.
    const mine = upto.filter((l) => l.bowler === rec.bowler && l.outcome.extra !== 'wide' && l.outcome.extra !== 'noBall');
    const last3 = mine.slice(-3);
    if (last3.length === 3 && last3.every((l) => l.outcome.wicket && l.outcome.wicket.kind !== 'runOut')) return `HAT-TRICK for ${bowler.name}!`;
    if (w === 5) return `FIVE WICKETS for ${bowler.name}`;
    if (w === 3) return `Three wickets for ${bowler.name}`;
  }
  const team = (log: BallRecord[]) =>
    log.reduce((a, l) => a + l.outcome.batRuns + l.outcome.extraRuns + (l.outcome.extra === 'wide' || l.outcome.extra === 'noBall' ? 1 : 0), 0);
  const t0 = team(before);
  const t1 = team(upto);
  for (const m of [200, 150, 100, 50]) if (t0 < m && t1 >= m) return `${m} up for the batting side`;
  return undefined;
}
