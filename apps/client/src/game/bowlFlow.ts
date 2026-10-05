import { LENGTHS, defaultIntent, type BowlIntent, type BowlStyle, type Variation } from '@crease/sim';

/**
 * Bowling, before the run-up, in two steps: place the target on the pitch with the joystick and press OK
 * ('aim'), then choose one of the bowler's deliveries and bowl ('delivery'). Pure, so it can be tested.
 */
export type BowlStage = 'aim' | 'delivery';

/** Deliveries that set their own length: the target jumps there while one is picked. */
const OWN_LENGTH: Partial<Record<Variation, number>> = { yorker: LENGTHS.yorker, bouncer: LENGTHS.bouncer };

/**
 * OK pressed: the target is set. A yorker or bouncer left over from the last ball that no longer matches
 * the target becomes the bowler's stock ball, so the target the bowler chose is the one bowled.
 * Returns the intent and the length to come back to when a delivery with its own length is swapped out.
 */
export function confirmAim(intent: BowlIntent, style: BowlStyle): { intent: BowlIntent; aimedLength: number } {
  const own = OWN_LENGTH[intent.variation];
  if (own !== undefined && Math.abs(intent.length - own) > 0.6) intent = { ...intent, variation: defaultIntent(style).variation };
  return { intent, aimedLength: intent.length };
}

/** A delivery picked: yorkers and bouncers move the target to their length, the rest bowl at the target that was set. */
export function chooseVariation(intent: BowlIntent, v: Variation, style: BowlStyle, aimedLength: number | null): BowlIntent {
  const next = { ...intent, variation: v };
  const own = OWN_LENGTH[v];
  if (own !== undefined) next.length = own;
  else if (aimedLength !== null) next.length = aimedLength;
  else if (next.length < 2 || next.length > 9.5) next.length = style === 'fast' || style === 'medium' ? LENGTHS.good : LENGTHS.full + 0.5;
  return next;
}

/** Move the target with the joystick (x = screen right, y = screen up, i.e. fuller) for dt seconds. */
export function moveTarget(intent: BowlIntent, d: { x: number; y: number }, hand: 'R' | 'L', dt: number): BowlIntent {
  // The bowling camera looks down +z, so screen-right is world -x; the line is measured for the batter's hand.
  const dxWorld = -d.x * 1.3 * dt;
  const dLine = hand === 'R' ? dxWorld : -dxWorld;
  return {
    ...intent,
    line: Math.max(-1.2, Math.min(1.4, intent.line + dLine)),
    length: Math.max(0.3, Math.min(12.5, intent.length - d.y * 6 * dt)),
  };
}
