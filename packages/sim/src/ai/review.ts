import { Rng } from '../math/rng';
import { CricketMatch } from '../match/match';

/**
 * Should an AI side ask for a review? AI players "feel" how clear the decision
 * was (the true tracking, blurred by difficulty) and are choosier with their
 * last review.
 */
export function aiWantsReview(m: CricketMatch, rng: Rng): boolean {
  const pr = m.pendingReview;
  if (!pr || pr.reviewing) return false;
  const t = pr.tracking;
  const left = m.reviewsLeft[pr.team];
  const sense = { easy: 0.55, normal: 0.7, hard: 0.82, expert: 0.92 }[m.cfg.difficulty];
  // Probability the decision looks wrong to this side.
  let wrong: number;
  if (t.verdict === 'umpiresCall') wrong = 0.45;
  else if ((t.verdict === 'out') !== pr.onFieldOut) wrong = sense;
  else wrong = 1 - sense;
  // Batters given out gamble more; the last review is precious.
  if (pr.onFieldOut) wrong += 0.1;
  if (left <= 1) wrong -= 0.15;
  return rng.next() < wrong;
}
