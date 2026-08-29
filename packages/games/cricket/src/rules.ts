import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Cricket, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, both bots and the balance harness drive this
 * module, so anything that touches a canvas belongs in game.ts.
 *
 * The laws of cricket are not anybody's property and this is our own reading of them:
 * a delivery is a line, a length and a pace; a shot is a position, an instant and a
 * direction; and everything else falls out of arithmetic on those six numbers. Nothing
 * here is ported from another implementation.
 *
 * Four things are worth keeping apart, because they are tested in completely different
 * ways: **where the ball arrives** (a closed form in flight progress, so a 60 Hz device
 * and a 120 Hz one deliver the identical ball), **whether the bat met it** (two
 * independent tolerances, timing and lateral, multiplied), **what the shot is worth**
 * (fixed field geometry, exhaustively testable without simulating a delivery) and **who
 * is batting** (an ordering over ball indices, which is pure counting).
 *
 * The whole ground is a plan view. Two people sitting on opposite sides of one device
 * cannot share a side-on view of a pitch — one of them would read it upside down — but a
 * circle centred on the striker reads the same from either end, which is why the boundary
 * is a circle and the striker stands at its centre.
 */

// ---------------------------------------------------------------------------
// The ground
// ---------------------------------------------------------------------------

/** The striker stands at the centre of the ground, so the view is fair from either end. */
export const GROUND_CX = 350;
export const GROUND_CY = 500;
/** Fits the 700-unit logical width with a margin, and leaves the ends free for chrome. */
export const BOUNDARY_R = 340;

/** Where the ball leaves the bowler's hand, measured back along the pitch from the striker. */
export const RELEASE_DISTANCE = 300;
export const RELEASE_Y = GROUND_CY - RELEASE_DISTANCE;

/** Half the width of the stumps. A ball arriving inside this and low enough bowls the striker. */
export const STUMP_HALF_WIDTH = 22;

/**
 * How far off the stumps a delivery may arrive before it is called a wide.
 *
 * This is the bowler's whole constraint. Without it the winning line is to bowl every ball
 * where no bat can reach, which is not a duel — it is a way of forcing a 0–0 draw. A wide
 * concedes a run and is re-bowled, so an unplayable line costs more than it saves.
 */
export const WIDE_HALF_WIDTH = 95;

// ---------------------------------------------------------------------------
// The delivery
// ---------------------------------------------------------------------------

/** Logical units a second. A full-pace ball covers the pitch in a little over half a second. */
export const PACE_MIN = 300;
export const PACE_MAX = 560;

/**
 * How high the ball is when it reaches the striker, as a multiple of stump height.
 *
 * Length runs 0 (a yorker, arriving at the base of the stumps) to 1 (a bouncer, arriving
 * well above them). The two ends of the range are the two ways to bowl badly and the
 * middle is a good length, which is exactly the shape of the real decision: full is the
 * only length that bowls anybody, and short is the only length that cannot.
 */
export const HEIGHT_MIN = 0.15;
export const HEIGHT_MAX = 1.8;
/** The top of the stumps. Arrive above this and the ball passes over them. */
export const STUMP_HEIGHT = 0.75;

/**
 * How far late swing moves the ball, in logical units, at full pace.
 *
 * Swing is rolled from the seeded stream per delivery and is **drawn in flight** — the
 * ball visibly curves — so a bot reading it takes nothing a person on the same screen
 * cannot also read (CLAUDE.md rule 6). It is what stops the bowler's chosen line from
 * being the whole story, and it is why the striker watches the ball rather than the
 * bowler's arm.
 */
export const SWING_MAX = 46;

export interface Delivery {
  /** Where the bowler aimed, in logical x. The stumps are at {@link GROUND_CX}. */
  line: number;
  /** 0 is a yorker and 1 a bouncer. Sets how high the ball arrives. */
  length: number;
  /** Logical units a second, between {@link PACE_MIN} and {@link PACE_MAX}. */
  pace: number;
  /** Lateral drift over the flight, in logical units. Signed; rolled per delivery. */
  swing: number;
}

export function createDelivery(): Delivery {
  return { line: GROUND_CX, length: 0.5, pace: PACE_MIN, swing: 0 };
}

/** Seconds from release to the striker. Pace is constant, so this is one division. */
export function flightSeconds(delivery: Delivery): number {
  // Guarded rather than trusted: a zero or negative pace would divide to Infinity and
  // freeze the delivery on the wicket for ever, which is a hang rather than a bad ball.
  const pace = delivery.pace > 0 ? delivery.pace : PACE_MIN;
  return RELEASE_DISTANCE / pace;
}

/**
 * How much of the swing has acted after `progress` of the flight.
 *
 * Quadratic rather than linear, so the ball holds its line and moves late — which is what
 * makes swing worth watching rather than worth reading off the bowler's hand. At
 * `progress === 1` it has moved by the full amount, so {@link arrivalX} is the line plus
 * the swing and nothing else.
 */
export function swingFraction(progress: number): number {
  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return t * t;
}

/** Where the ball is across the pitch, `progress` of the way down it. */
export function ballX(delivery: Delivery, progress: number): number {
  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return GROUND_CX + (delivery.line - GROUND_CX) * t + delivery.swing * swingFraction(t);
}

/** Where the ball is down the pitch. Straight-line, because pace is constant. */
export function ballY(progress: number): number {
  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return RELEASE_Y + RELEASE_DISTANCE * t;
}

/** Where the ball crosses the stumps. The line the bowler chose, plus all of the swing. */
export function arrivalX(delivery: Delivery): number {
  return ballX(delivery, 1);
}

/** How high the ball is at the striker, in stump heights. */
export function arrivalHeight(delivery: Delivery): number {
  const length = delivery.length < 0 ? 0 : delivery.length > 1 ? 1 : delivery.length;
  return HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * length;
}

/**
 * How high the ball is *in flight*, in stump heights.
 *
 * It leaves the hand around stump height, dips as it pitches about two thirds of the way
 * down, and rises to {@link arrivalHeight}. Drawn as a ball that grows and shrinks, so the
 * striker can read the length before it arrives — which is the read the whole game is
 * about, and it has to be available to a person, not just to the simulation.
 */
export const PITCH_AT = 0.68;

export function heightAt(delivery: Delivery, progress: number): number {
  const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  const arrival = arrivalHeight(delivery);
  if (t <= PITCH_AT) {
    // Falling from the hand to the pitch.
    return STUMP_HEIGHT + (0 - STUMP_HEIGHT) * (t / PITCH_AT);
  }
  const after = (t - PITCH_AT) / (1 - PITCH_AT);
  return arrival * after;
}

/** A delivery arriving this far off the stumps is a wide: a run to the batting side, re-bowled. */
export function isWide(delivery: Delivery): boolean {
  return Math.abs(arrivalX(delivery) - GROUND_CX) > WIDE_HALF_WIDTH;
}

/** Roll one delivery's swing. Writes in place; allocates nothing. */
export function rollSwing(delivery: Delivery, rng: Rng): void {
  const share = (delivery.pace - PACE_MIN) / (PACE_MAX - PACE_MIN);
  const scale = 0.35 + 0.65 * (share < 0 ? 0 : share > 1 ? 1 : share);
  delivery.swing = (rng.float() * 2 - 1) * SWING_MAX * scale;
}

// ---------------------------------------------------------------------------
// The shot
// ---------------------------------------------------------------------------

/**
 * Seconds from pressing to the middle of the bat's arc.
 *
 * The striker is committing to a moment in the future, not reacting to the present. That
 * lag is the whole timing game, and it is the same on every device — it is expressed in
 * seconds of simulation, never in frames.
 */
export const SWING_LEAD = 0.12;
/** How far either side of the perfect instant the bat can still reach the ball. */
export const SWING_WINDOW = 0.16;
/** How far either side of the ball the bat can still reach, in logical units. */
export const BAT_REACH = 46;

/**
 * How well the bat met the ball, 0 (missed) to 1 (middled).
 *
 * Two independent tolerances multiplied rather than added: being in the right place at the
 * wrong moment is a miss, and so is the reverse. A product also means the perfect shot has
 * to be perfect twice, which is why a six is rare and a single is not.
 */
export function contactQuality(timingError: number, lateralError: number): number {
  const timing = 1 - Math.abs(timingError) / SWING_WINDOW;
  const lateral = 1 - Math.abs(lateralError) / BAT_REACH;
  if (!(timing > 0) || !(lateral > 0)) return 0;
  return timing * lateral;
}

/** Contact below this is not a shot at all — the ball goes through to the keeper. */
export const CONTACT_FLOOR = 0.02;

/** How far a middled ball travels off the bat, in logical units, before pace is added. */
export const RANGE_BASE = 40;
export const RANGE_QUALITY = 230;
/** The share of the bowler's pace that comes back off the bat. Faster on, faster off. */
export const RANGE_PACE = 0.2;

/**
 * How much of the delivery's height a middled shot can turn into carry.
 *
 * This is the *deliberate* half of loft, and it is the only half that scores. The length
 * the bowler gave you is what there is to hit in the air — a bouncer can be pulled over the
 * rope and a yorker cannot — but you only collect it if you middle it, so it is scaled by
 * contact quality. That is the trade the whole shot model is about: the height is offered
 * by the bowler and taken by the bat.
 */
export const LOFT_HEIGHT = 0.42;
/**
 * How high a mishit balloons.
 *
 * A thick edge or a top edge goes almost straight up and nowhere, which is how most
 * catches happen in a real innings and how nearly all of them happen here. It is also what
 * makes the bot's timing error produce dismissals rather than merely produce fewer runs.
 *
 * "And nowhere" is load-bearing, and it used not to be true. Loft was a single number that
 * *multiplied* range, so mistiming the ball bought carry: the model paid for the mistake it
 * exists to punish, a perfectly timed shot was flat and short of the rope, and the strongest
 * bot scored less than the middle one because it middled too much to reach a boundary. The
 * two sources of height are now separate numbers with opposite signs on range — see
 * {@link resolveShot}, {@link LOFT_RANGE} and {@link MISHIT_RANGE}.
 */
export const LOFT_MISHIT = 0.9;
/** Above this the ball is in the air and can be caught. Below it, it is along the ground. */
export const AIR_THRESHOLD = 0.34;
/**
 * Above this the ball has gone up rather than away, and somebody gets under it.
 *
 * A steepler hangs long enough that which fielder takes it is not interesting; that it is
 * out is. Carry alone cannot reach here — a perfectly middled bouncer tops out at
 * {@link LOFT_HEIGHT} — so no shot that is worth runs is ever caught by this rule. It is
 * what makes a top edge a wicket rather than a dot, now that a top edge lands at the
 * striker's feet instead of out among the fielders.
 */
export const SKY_THRESHOLD = 0.82;
/** How much further a ball middled into the air carries. */
export const LOFT_RANGE = 0.55;
/**
 * How much of its range a ballooned mishit throws away.
 *
 * A ball that leaves the bat vertically has spent the bowler's pace going up rather than
 * out: a total mishit off a good-length ball travels about twenty units, against the
 * hundred and twenty that buys the first run.
 */
export const MISHIT_RANGE = 0.55;

/**
 * How square the striker can hit, in radians either side of straight.
 *
 * Bounded well short of a half turn because the shot direction is not a separate control —
 * see {@link aimForBatX}. Nobody gets to hit a ball behind them that they met in front.
 */
export const MAX_AIM_ANGLE = 1.15;
/** How far across the crease the striker must meet the ball to hit it fully square. */
export const BAT_AIM_SPAN = 60;

/**
 * Which way a ball goes, given where the bat met it.
 *
 * Direction is **not** a fourth control. Meeting the ball out in front of the stumps sends
 * it straight and meeting it wide of them sends it square, which is both how a real shot
 * works and the only mapping that treats a thumb and a keyboard identically: a pointer
 * player taps where the bat should be and a keyboard player slides it there, and the two
 * get the same shot from the same position. A separate aim stick would have handed the
 * pointer an angular precision the keyboard could not match, which is the cross-device
 * fairness rule in CLAUDE.md.
 */
export function aimForBatX(batX: number): number {
  const offset = (batX - GROUND_CX) / BAT_AIM_SPAN;
  const clamped = offset < -1 ? -1 : offset > 1 ? 1 : offset;
  return clamped * MAX_AIM_ANGLE;
}

/** One struck ball: how far it goes, which way, and whether it is up. */
export interface Shot {
  /** Radians. Zero is straight back past the bowler; positive turns towards the off side. */
  angle: number;
  /** Logical units from the striker. */
  range: number;
  /** 0 along the ground, 1 straight up. Above {@link AIR_THRESHOLD} it can be caught. */
  loft: number;
}

export function createShot(): Shot {
  return { angle: 0, range: 0, loft: 0 };
}

/**
 * Turn a contact into a struck ball.
 *
 * `aim` is the striker's chosen direction in radians and is passed through untouched — the
 * player places the ball, the model decides only how hard and how high.
 *
 * Two different things get called "in the air", and they are kept as separate numbers
 * because they pull range in opposite directions:
 *
 * - **Carry** is the length, taken on. It is the height the bowler offered multiplied by
 *   how well the bat met it, and it sends the ball *further* ({@link LOFT_RANGE}). It is
 *   the only route to a six, and it is deliberate: the striker who picks the short ball
 *   and middles it gets it.
 * - **Balloon** is the edge. It comes from missing the middle and it takes nearly all of
 *   the range away ({@link MISHIT_RANGE}) — straight up, and nowhere.
 *
 * Adding the two into one number and multiplying range by the sum, which is what this used
 * to do, makes mistiming the ball *pay*. Range is now monotone in contact quality at every
 * length and pace, and {@link SKY_THRESHOLD} turns the tallest balloons into the catches
 * that the fielders are standing there for.
 */
export function resolveShot(out: Shot, quality: number, aim: number, delivery: Delivery): void {
  const q = quality < 0 ? 0 : quality > 1 ? 1 : quality;
  const height = arrivalHeight(delivery) / HEIGHT_MAX;
  const carry = height * LOFT_HEIGHT * q;
  const balloon = (1 - q) * LOFT_MISHIT;
  const loft = carry + balloon;
  const struck = RANGE_BASE + RANGE_QUALITY * q + delivery.pace * RANGE_PACE * q;
  out.angle = aim;
  out.loft = loft < 0 ? 0 : loft > 1 ? 1 : loft;
  out.range = struck * (1 + carry * LOFT_RANGE) * (1 - balloon * MISHIT_RANGE);
}

/** Where a shot comes down, or stops, relative to the striker. */
export function shotLandingX(shot: Shot): number {
  return GROUND_CX + Math.sin(shot.angle) * shot.range;
}

export function shotLandingY(shot: Shot): number {
  // Zero radians is straight back past the bowler, who stands at decreasing y.
  return GROUND_CY - Math.cos(shot.angle) * shot.range;
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/** How close a fielder must be to a ball coming down to take the catch. */
export const CATCH_RADIUS = 36;
/** How close a fielder must be to a ball along the ground to cut off a run. */
export const FIELD_RADIUS = 62;

export interface Fielder {
  readonly x: number;
  readonly y: number;
}

/**
 * Six fielders, the keeper and the bowler, at fixed stations.
 *
 * Fixed rather than rolled, and identical in both innings, because the field is the one
 * piece of information both strikers must be able to plan against. A field that moved
 * between innings would make the two halves of the match incomparable, and the whole match
 * is a comparison of two innings.
 *
 * Stated as angle and radius because that is how a captain thinks about a field, and
 * frozen because a game must not be able to hand a caller something it can move.
 */
const STATIONS: readonly (readonly [number, number])[] = [
  [0.0, 250], // long-on, straight back past the bowler
  [0.85, 300], // deep cover
  [-0.85, 300], // deep midwicket
  [1.75, 210], // point
  [-1.75, 210], // square leg
  [2.7, 235], // deep third
];

export const FIELDERS: readonly Fielder[] = Object.freeze(
  STATIONS.map(([angle, radius]) =>
    Object.freeze({
      x: GROUND_CX + Math.sin(angle) * radius,
      y: GROUND_CY - Math.cos(angle) * radius,
    }),
  ),
);

/** The keeper stands behind the stumps and stops everything that beats the bat. */
export const KEEPER: Fielder = Object.freeze({ x: GROUND_CX, y: GROUND_CY + 70 });

/** Distance from `(x, y)` to the nearest fielder. Allocates nothing. */
export function nearestFielderDistance(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const fielder of FIELDERS) {
    const dx = x - fielder.x;
    const dy = y - fielder.y;
    const distance = Math.hypot(dx, dy);
    if (distance < best) best = distance;
  }
  return best;
}

// ---------------------------------------------------------------------------
// What a ball is worth
// ---------------------------------------------------------------------------

export type BallOutcome =
  'dot' | 'one' | 'two' | 'three' | 'four' | 'six' | 'bowled' | 'caught' | 'wide';

/** Runs on the board for each outcome. A dismissal scores nothing; a wide scores one. */
export function runsFor(outcome: BallOutcome): number {
  switch (outcome) {
    case 'one':
      return 1;
    case 'two':
      return 2;
    case 'three':
      return 3;
    case 'four':
      return 4;
    case 'six':
      return 6;
    case 'wide':
      return 1;
    default:
      return 0;
  }
}

export function isDismissal(outcome: BallOutcome): boolean {
  return outcome === 'bowled' || outcome === 'caught';
}

/** A wide is re-bowled, so it does not use up one of the innings' balls. */
export function countsAsBall(outcome: BallOutcome): boolean {
  return outcome !== 'wide';
}

/** How far a ball has to be pushed for each run, once it has beaten the ring. */
const RUN_THRESHOLDS: readonly number[] = Object.freeze([120, 200, 275]);

/** Runs for a ball that stayed inside the boundary, before the fielders are consulted. */
export function runsForRange(range: number): number {
  let runs = 0;
  for (const threshold of RUN_THRESHOLDS) {
    if (range >= threshold) runs += 1;
  }
  return runs;
}

const OUTCOMES_BY_RUNS: readonly BallOutcome[] = Object.freeze(['dot', 'one', 'two', 'three']);

/**
 * What one struck ball is worth.
 *
 * Order matters and is the order the laws use: a ball that has crossed the rope is already
 * four or six and no fielder can touch it, a ball still in the air over a fielder is a
 * catch, and only what is left is worth running. Written as one function because every one
 * of those branches is a rule a test can state directly.
 */
export function scoreShot(shot: Shot): BallOutcome {
  const airborne = shot.loft > AIR_THRESHOLD;
  if (shot.range >= BOUNDARY_R) return airborne ? 'six' : 'four';

  // A ball hit this steeply went up instead of away, and it hangs long enough for whoever
  // is nearest to walk under it. Only a mishit reaches this height.
  if (shot.loft >= SKY_THRESHOLD) return 'caught';

  const x = shotLandingX(shot);
  const y = shotLandingY(shot);
  const nearest = nearestFielderDistance(x, y);

  if (airborne && nearest <= CATCH_RADIUS) return 'caught';

  let runs = runsForRange(shot.range);
  // A fielder on the ball cuts off the single the batter would otherwise have jogged.
  if (nearest <= FIELD_RADIUS && runs > 0) runs -= 1;
  return OUTCOMES_BY_RUNS[runs] ?? 'three';
}

/**
 * What a ball the bat missed is worth.
 *
 * It bowls the striker only if it would have hit the stumps: inside their width and below
 * their top. Everything else is a dot to the keeper — which is why leaving the ball is
 * safe, and why a bowler who only bowls short can never take a wicket.
 */
export function scoreMiss(delivery: Delivery): BallOutcome {
  if (isWide(delivery)) return 'wide';
  const onStumps = Math.abs(arrivalX(delivery) - GROUND_CX) <= STUMP_HALF_WIDTH;
  const underTop = arrivalHeight(delivery) <= STUMP_HEIGHT;
  return onStumps && underTop ? 'bowled' : 'dot';
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

/** Two overs an innings. Long enough to recover from one bad shot, short enough to matter. */
export const BALLS_PER_INNINGS = 12;
/** Two wickets, so a single mistimed pull does not end the contest on ball one. */
export const WICKETS_PER_INNINGS = 2;
/** Each seat bats once. The whole match is a comparison of the two innings. */
export const INNINGS_PER_MATCH = 2;

export interface InningsState {
  runs: number;
  wickets: number;
  /** Legal balls bowled. Wides do not count towards this. */
  balls: number;
  fours: number;
  sixes: number;
}

export function createInnings(): InningsState {
  return { runs: 0, wickets: 0, balls: 0, fours: 0, sixes: 0 };
}

export function resetInnings(innings: InningsState): void {
  innings.runs = 0;
  innings.wickets = 0;
  innings.balls = 0;
  innings.fours = 0;
  innings.sixes = 0;
}

/** Add one completed ball to the card. */
export function recordBall(innings: InningsState, outcome: BallOutcome): void {
  innings.runs += runsFor(outcome);
  if (isDismissal(outcome)) innings.wickets += 1;
  if (countsAsBall(outcome)) innings.balls += 1;
  if (outcome === 'four') innings.fours += 1;
  if (outcome === 'six') innings.sixes += 1;
}

/** An innings ends when the overs run out or the wickets do. */
export function inningsComplete(innings: InningsState): boolean {
  return innings.balls >= BALLS_PER_INNINGS || innings.wickets >= WICKETS_PER_INNINGS;
}

/**
 * Who bats in the given innings.
 *
 * The opener bats first, and the opener is `context.openingSeat` rather than a literal
 * `p1`: the SDK alternates it across the rounds of a best-of, so whatever advantage
 * batting first carries washes out over a match rather than accruing to seat one. Issue
 * #2466 is the reason this is a parameter at all.
 */
export function battingSeat(innings: number, opener: SeatId = 'p1'): SeatId {
  return innings % 2 === 0 ? opener : otherSeat(opener);
}

/** The other seat bowls. Both roles are live at once, so both are named per innings. */
export function bowlingSeat(innings: number, opener: SeatId = 'p1'): SeatId {
  return otherSeat(battingSeat(innings, opener));
}

/**
 * The bigger total wins, with boundaries breaking a tie.
 *
 * Both comparisons go through the SDK's resolver rather than being written out here:
 * "highest when the match ends" means the same thing in every game in the catalogue, and a
 * draw is a defined outcome rather than an oversight. Two identical totals with identical
 * boundary counts really is a tied match, which cricket has a word for and the shell knows
 * how to show.
 */
const HIGHEST: WinCondition = { kind: 'highest-when-time-expires' };

export function winnerOf(p1: InningsState, p2: InningsState, complete: boolean): Outcome {
  const onRuns = resolve(HIGHEST, { p1: p1.runs, p2: p2.runs }, { timeExpired: complete });
  if (onRuns !== 'draw') return onRuns;
  const p1Boundaries = p1.fours + p1.sixes;
  const p2Boundaries = p2.fours + p2.sixes;
  return resolve(HIGHEST, { p1: p1Boundaries, p2: p2Boundaries }, { timeExpired: true });
}

// ---------------------------------------------------------------------------
// The bots
// ---------------------------------------------------------------------------

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Standard deviation of the bot's swing timing, in seconds.
   *
   * The knob that carries the ladder, because {@link contactQuality} is a product: timing
   * error costs range and buys loft at the same time, so a shaky bot does not merely score
   * less, it gets caught more. Measured in SPEC.md.
   */
  readonly timingSd: number;
  /** How far its bat strays from the ball's line, as a standard deviation in logical units. */
  readonly lateralSd: number;
  /**
   * How much of the swing it allows for when it puts the bat down, 0 to 1.
   *
   * The ball visibly curves for everybody; a weak bot simply plays where the ball started.
   * This is the read the game is *about*, and giving a bot more of it than a person could
   * take would break CLAUDE.md rule 6 — so it is capped below 1 even at `hard`.
   */
  readonly swingRead: number;
  /** How well it finds the gaps between fielders when it places a shot, 0 to 1. */
  readonly placement: number;
  /** How far off its intended line the bot bowls, as a standard deviation in logical units. */
  readonly lineSd: number;
  /** How far off its intended length the bot bowls, in length units. */
  readonly lengthSd: number;
}

/**
 * Three tiers, all of them things a person does badly.
 *
 * A weak player mistimes the ball, plays where it pitched rather than where it swung, hits
 * it straight to a fielder and sprays it wide when bowling; a strong one middles it, reads
 * the swing, finds the gap and lands it on a length. None of the six knobs hands a bot
 * anything a human on the same screen cannot see: the swing is drawn in flight, the
 * fielders are drawn on the field, and the ball is the same ball.
 *
 * Measured over 400 matches a tier in `rules.test.ts` and recorded in SPEC.md.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    timingSd: 0.115,
    lateralSd: 30,
    swingRead: 0.15,
    placement: 0.2,
    lineSd: 46,
    lengthSd: 0.3,
  }),
  normal: Object.freeze({
    timingSd: 0.06,
    lateralSd: 16,
    swingRead: 0.6,
    placement: 0.55,
    lineSd: 26,
    lengthSd: 0.17,
  }),
  hard: Object.freeze({
    timingSd: 0.032,
    lateralSd: 8,
    swingRead: 0.9,
    placement: 0.85,
    lineSd: 14,
    lengthSd: 0.09,
  }),
});

/**
 * A standard normal draw, by Box-Muller from the seeded stream.
 *
 * `float()` can return zero and `log(0)` is `-Infinity`, which would place the bat at NaN
 * and make every subsequent comparison false — a bot that never swings again rather than a
 * bot that plays a bad shot. The draw is nudged into `(0, 1]` to make that unreachable.
 */
export function gaussian(rng: Rng): number {
  const u1 = Math.max(Number.EPSILON, rng.float());
  const u2 = rng.float();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * How far a bot will move off the ball to steer it towards a gap, in logical units.
 *
 * Small on purpose. Placement is not a free parameter for anybody: {@link aimForBatX} ties
 * direction to where the bat met the ball, so a bot buying a better angle pays for it in
 * contact quality exactly as a person does. Letting this grow would hand bots a shot no
 * human could play, which is CLAUDE.md rule 6.
 */
export const GAP_NUDGE = 12;

/**
 * Where the bot puts the bat: on the line, plus as much of the swing as this tier reads.
 *
 * The line is visible from the moment the ball leaves the hand and the swing is not — that
 * is the whole reason {@link swingFraction} is quadratic. So the only thing a weak tier
 * fails to allow for is the swing.
 *
 * This used to interpolate the ball's whole *position* between mid-flight and arrival,
 * which folded half of the bowler's line deviation into the read as though it were unread
 * movement. The effect was backwards and measurable: a wayward line made the bot bat
 * worse, so **easy bowling conceded fewer runs than hard bowling** at the same batting
 * tier. Reading the swing, and only the swing, restores the ordering.
 */
export function botBatX(delivery: Delivery, profile: BotProfile, rng: Rng): number {
  const read = delivery.line + delivery.swing * profile.swingRead;
  const nudge = Math.sign(botAim(profile)) * profile.placement * GAP_NUDGE;
  return read + nudge + gaussian(rng) * profile.lateralSd;
}

/** How far off the perfect instant this tier swings. Signed: it is as often early as late. */
export function botTimingError(profile: BotProfile, rng: Rng): number {
  return gaussian(rng) * profile.timingSd;
}

/**
 * The widest gap in the field, in radians, for a bot placing a shot.
 *
 * It is computed from the same fielder positions that are drawn on the screen, so a person
 * who looks at the field can find the same gap. A `placement` below 1 pulls the bot's aim
 * back towards straight, which is where the fielders are.
 */
export function widestGapAngle(): number {
  const angles = FIELDERS.map((fielder) =>
    Math.atan2(fielder.x - GROUND_CX, GROUND_CY - fielder.y),
  ).sort((a, b) => a - b);
  let bestAngle = 0;
  let bestGap = -1;
  for (let i = 0; i < angles.length; i += 1) {
    const a = angles[i] ?? 0;
    const b = angles[(i + 1) % angles.length] ?? 0;
    // The wrap-around pair is a gap through the back of the field like any other.
    const gap = i === angles.length - 1 ? b + Math.PI * 2 - a : b - a;
    if (gap > bestGap) {
      bestGap = gap;
      bestAngle = a + gap / 2;
    }
  }
  // Fold back into (-pi, pi] so the angle means the same thing as a player's aim.
  const turn = Math.PI * 2;
  return ((bestAngle + Math.PI) % turn) - Math.PI;
}

/**
 * Where the bot aims its shot: at the gap, pulled back towards straight by weak placement.
 *
 * Clamped to {@link MAX_AIM_ANGLE} because the widest gap in the field is often behind
 * square, and nobody — bot or person — can hit a ball there that they met in front.
 */
export function botAim(profile: BotProfile): number {
  const aim = widestGapAngle() * profile.placement;
  return aim < -MAX_AIM_ANGLE ? -MAX_AIM_ANGLE : aim > MAX_AIM_ANGLE ? MAX_AIM_ANGLE : aim;
}

/** The line and length this tier actually bowls, given what it intended. */
export function botBowl(out: Delivery, profile: BotProfile, rng: Rng): void {
  // Aim at the top of off stump on a good length: the ball that asks the most questions,
  // and the one a person learns to bowl too. Error is what separates the tiers.
  out.line = GROUND_CX + STUMP_HALF_WIDTH * 0.5 + gaussian(rng) * profile.lineSd;
  const length = 0.3 + gaussian(rng) * profile.lengthSd;
  out.length = length < 0 ? 0 : length > 1 ? 1 : length;
  // Swing is deliberately *not* rolled here. Every delivery gets its swing from the same
  // call at the moment of release, whoever bowled it, so a bot's ball is drawn from the
  // same distribution as a person's and the seeded stream advances identically either way.
  out.pace = PACE_MIN + (PACE_MAX - PACE_MIN) * (0.45 + rng.float() * 0.4);
}
