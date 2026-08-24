import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Archery Master, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and the balance harness all drive
 * this module, so anything that touches a canvas belongs in game.ts.
 *
 * Four things are worth keeping apart, because they are tested in completely different
 * ways: **where the arrow goes** (a closed-form parabola of the aim, with no integration
 * anywhere), **what it passes through** (a swept segment test against a rack of drifting
 * targets, which is pure geometry over a fixed sampling of its own), **who shoots when**
 * (an ordering over round and shot indices, which is pure counting) and **who wins** (the
 * SDK's resolver, twice).
 *
 * Everything here is in **logical units and seconds** — the same 700 x 1000 box the
 * manifest declares and the simulation steps in. Nothing is in pixels; the renderer is
 * the only layer that knows what a device is.
 */

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

export const FIELD_WIDTH = 700;
export const FIELD_HEIGHT = 1000;

/**
 * The shooting line, which is also the height the bow sits at.
 *
 * Everything above it is the gallery an arrow flies through; everything below it is the
 * aiming pad. An arrow that comes back down to this line has landed.
 */
export const GROUND_Y = 700;
export const BOW_X = FIELD_WIDTH / 2;
export const BOW_Y = GROUND_Y;

/** Four rows of targets, highest first. Heights above the bow: 550, 410, 270, 140. */
export const ROW_Y: readonly number[] = Object.freeze([150, 290, 430, 560]);
/** Targets per row. Five, so a flat arrow along a row has something to walk into. */
export const COLUMNS = 5;
export const RACK_SIZE = ROW_Y.length * COLUMNS;

/** Where a column sits before its jitter, evenly across the usable width. */
export const COLUMN_LEFT = 70;
export const COLUMN_RIGHT = FIELD_WIDTH - COLUMN_LEFT;
export const COLUMN_STEP = (COLUMN_RIGHT - COLUMN_LEFT) / (COLUMNS - 1);

/**
 * How far a column may be nudged off its slot, and how far a target drifts either side.
 *
 * Chosen together so two neighbours in a row can never touch: the closest two centres ever
 * come is `COLUMN_STEP - COLUMN_JITTER - 2 * DRIFT_MAX` = 140 - 12 - 68 = 60, against the
 * 58 units two targets would need to overlap. Two units of clearance is not much, so a
 * test walks ten thousand racks across a full drift cycle and asserts it rather than
 * trusting the arithmetic.
 */
export const COLUMN_JITTER = 12;
export const DRIFT_MIN = 18;
export const DRIFT_MAX = 34;
/** Radians a second. Slow enough to read, fast enough that a lead is a real decision. */
export const RATE_MIN = 0.85;
export const RATE_MAX = 1.95;

export const TARGET_RADIUS = 29;
export const ARROW_RADIUS = 6;
/** An arrow skewers a target when their discs touch. */
export const HIT_RADIUS = TARGET_RADIUS + ARROW_RADIUS;

// ---------------------------------------------------------------------------
// The bow
// ---------------------------------------------------------------------------

/**
 * Gravity, in logical units per second squared.
 *
 * Picked from the two things that actually matter rather than from anything physical: the
 * arc has to cross the gallery, and a shot has to be over inside about a second. A shot
 * that reaches height h and comes back takes `2 * sqrt(2h/g)`; at h = 550 (the top row)
 * and g = 4200 that is 1.024 s, which is a watchable arc rather than a wait.
 */
export const GRAVITY = 4200;

/**
 * Launch speed at no draw and at full draw.
 *
 * The whole point of the draw is which row it can reach, and reaching height h straight up
 * needs `sqrt(2 g h)`:
 *
 * | Row | Height above the bow | Speed | Draw |
 * |---|---|---|---|
 * | 4 (nearest) | 140 | 1084 | 0.145 |
 * | 3 | 270 | 1506 | 0.420 |
 * | 2 | 410 | 1856 | 0.647 |
 * | 1 (highest) | 550 | 2149 | 0.837 |
 *
 * So the near row is a light pull and the top row asks for very nearly everything. An
 * undrawn bow tops out 88 above the string and reaches **nothing**, which is the point of
 * the floor: at SPEED_MIN = 980 it topped out at 114, and 114 plus the 35 units an arrow
 * and a target need to touch is 149 against the near row's 140 — so two players who never
 * touched the screen at all scored 27 targets each off the shot clock. Now the same match
 * ends 0-0. Full draw straight up tops out 686 above the bow — at y = 14, just inside the
 * field, so no arrow ever leaves over the top and the flight bound below is exact.
 */
export const SPEED_MIN = 860;
export const SPEED_MAX = 2400;

/**
 * How far either side of straight up the bow can be pointed, in radians.
 *
 * 0.85 rad is 48.7 degrees. The far top corner of the gallery needs about 0.34 rad and the
 * far near corner about 0.64, so the limit sits beyond every useful shot: pointing past the
 * useful band is a wasted arrow, which is a decision rather than a wall.
 */
export const AIM_LIMIT = 0.85;

/**
 * A ceiling on one flight, in seconds.
 *
 * Never binding with the constants above — the longest possible arc is full draw straight
 * up, `2 * SPEED_MAX / GRAVITY` = 1.143 s — but the termination arithmetic is multiplied
 * out against this number rather than against one that happens to be true today, and a
 * test asserts no legal aim ever reaches it.
 */
export const MAX_FLIGHT_SECONDS = 1.15;

/**
 * How finely a flight is walked when it is resolved, and when a bot is only guessing.
 *
 * **Sampling rates of the resolver, not of the simulation.** This is the whole reason the
 * hit test is rate-independent: a shot is resolved by walking its own parabola at its own
 * fixed rate, so the answer is a pure function of the aim and cannot change because a
 * device steps at 90 Hz instead of 60. At 600 Hz the arrow's arc departs from the straight
 * segment each step is tested as by 0.0015 units, and a target moves 0.11 units.
 */
export const RESOLVE_HZ = 600;
export const PLAN_HZ = 200;

// ---------------------------------------------------------------------------
// The rack
// ---------------------------------------------------------------------------

/**
 * One target, drifting sideways along a fixed row.
 *
 * Its whole path is a closed form of the time since the turn began, so a phone and a
 * laptop put it in the same place on the same step, and so a shot can be resolved against
 * where it *will* be rather than against where it was.
 */
export interface Target {
  /** Centre of the drift, in logical units. */
  baseX: number;
  /** Row height. Fixed for the life of the rack. */
  y: number;
  amplitude: number;
  /** Radians a second. */
  rate: number;
  phase: number;
}

export function createTarget(): Target {
  return { baseX: 0, y: 0, amplitude: 0, rate: 0, phase: 0 };
}

export function createRack(): Target[] {
  return Array.from({ length: RACK_SIZE }, createTarget);
}

/**
 * Roll one rack from the seeded stream, in place. Draws exactly four floats a target, in
 * a fixed order, so a rack is a function of its position in the stream and nothing else.
 */
export function rollRack(rack: readonly Target[], rng: Rng): void {
  for (let row = 0; row < ROW_Y.length; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const target = rack[row * COLUMNS + column];
      if (target === undefined) continue;
      target.baseX = COLUMN_LEFT + column * COLUMN_STEP + (rng.float() - 0.5) * COLUMN_JITTER;
      target.y = ROW_Y[row] ?? 0;
      target.amplitude = DRIFT_MIN + rng.float() * (DRIFT_MAX - DRIFT_MIN);
      target.rate = RATE_MIN + rng.float() * (RATE_MAX - RATE_MIN);
      target.phase = rng.float() * Math.PI * 2;
    }
  }
}

/** Where a target is, `seconds` into the turn. The only thing that moves in the gallery. */
export function targetXAt(target: Target, seconds: number): number {
  return target.baseX + target.amplitude * Math.sin(target.rate * seconds + target.phase);
}

/** How fast a target is sliding, for the readout that tells a player which way to lead. */
export function targetSpeedAt(target: Target, seconds: number): number {
  return target.amplitude * target.rate * Math.cos(target.rate * seconds + target.phase);
}

// ---------------------------------------------------------------------------
// The shot
// ---------------------------------------------------------------------------

/**
 * Where the bow points and how far it is drawn.
 *
 * `angle` is radians either side of straight up, positive to the right. `power` is the
 * draw, 0 to 1. Together they are the only two numbers a player controls.
 */
export interface Aim {
  angle: number;
  power: number;
}

export function createAim(): Aim {
  return { angle: 0, power: 0 };
}

export function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** Launch speed for a draw. Linear, so the draw gauge means what it looks like. */
export function launchSpeed(power: number): number {
  return SPEED_MIN + clamp(power, 0, 1) * (SPEED_MAX - SPEED_MIN);
}

/** Sideways component of the launch. Positive to the right. */
export function launchSideways(aim: Aim): number {
  return launchSpeed(aim.power) * Math.sin(clamp(aim.angle, -AIM_LIMIT, AIM_LIMIT));
}

/** Upward component of the launch. Always positive: the aim limit is inside a quarter turn. */
export function launchUpward(aim: Aim): number {
  return launchSpeed(aim.power) * Math.cos(clamp(aim.angle, -AIM_LIMIT, AIM_LIMIT));
}

/** Where the arrow is, `seconds` after it left the string. A parabola, not an integration. */
export function arrowXAt(aim: Aim, seconds: number): number {
  return BOW_X + launchSideways(aim) * seconds;
}

export function arrowYAt(aim: Aim, seconds: number): number {
  return BOW_Y - launchUpward(aim) * seconds + 0.5 * GRAVITY * seconds * seconds;
}

/** How high above the bow the arrow tops out. Only the upward component matters. */
export function apexHeight(aim: Aim): number {
  const up = launchUpward(aim);
  return (up * up) / (2 * GRAVITY);
}

/**
 * How long the arrow is in the air: until it comes back to the shooting line, leaves the
 * side of the field, or leaves over the top, whichever happens first.
 *
 * Closed form, every branch of it. Nothing is stepped towards, so the answer does not
 * depend on the rate the caller happens to be simulating at.
 */
export function flightSeconds(aim: Aim): number {
  const up = launchUpward(aim);
  const side = launchSideways(aim);
  // Back to the shooting line. `up` is strictly positive, so this is strictly positive.
  let end = (2 * up) / GRAVITY;
  if (side > 0) {
    const toEdge = (FIELD_WIDTH - BOW_X) / side;
    if (toEdge < end) end = toEdge;
  } else if (side < 0) {
    const toEdge = BOW_X / -side;
    if (toEdge < end) end = toEdge;
  }
  // Over the top. Unreachable with the shipped constants, and asserted to be; kept so the
  // bound stays true if the speeds are ever raised.
  const discriminant = up * up - 2 * GRAVITY * BOW_Y;
  if (discriminant > 0) {
    const toSky = (up - Math.sqrt(discriminant)) / GRAVITY;
    if (toSky > 0 && toSky < end) end = toSky;
  }
  return end < MAX_FLIGHT_SECONDS ? end : MAX_FLIGHT_SECONDS;
}

/**
 * What one arrow did.
 *
 * `hitAt` is indexed by rack position and holds the flight time each target was skewered
 * at, or -1 for one the arrow missed, so the flight can be replayed exactly as it was
 * resolved rather than re-decided a frame at a time.
 */
export interface ShotResult {
  /** How many targets this arrow skewered. The only thing that scores. */
  count: number;
  /** How long the arrow is in the air. */
  seconds: number;
  /** Flight time of each hit, or -1. Length {@link RACK_SIZE}. */
  readonly hitAt: Float64Array;
}

export function createShotResult(): ShotResult {
  return { count: 0, seconds: 0, hitAt: new Float64Array(RACK_SIZE).fill(-1) };
}

export function resetShotResult(out: ShotResult): void {
  out.count = 0;
  out.seconds = 0;
  out.hitAt.fill(-1);
}

/**
 * The closest an arrow moving from (ax0, ay0) to (ax1, ay1) comes to a target moving from
 * (tx0, ty) to (tx1, ty), as a fraction of the step, or -1 if it never comes close enough.
 *
 * Both motions are linear over one sample, so the gap between them is linear too and its
 * minimum is exact rather than sampled — which is what stops a fast arrow stepping straight
 * over a small target between two samples.
 */
function sweepFraction(
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  tx0: number,
  tx1: number,
  ty: number,
): number {
  const rx0 = ax0 - tx0;
  const ry0 = ay0 - ty;
  const dx = ax1 - tx1 - rx0;
  const dy = ay1 - ty - ry0;
  const denominator = dx * dx + dy * dy;
  let u = 0;
  if (denominator > 0) {
    u = clamp(-(rx0 * dx + ry0 * dy) / denominator, 0, 1);
  }
  const cx = rx0 + u * dx;
  const cy = ry0 + u * dy;
  return cx * cx + cy * cy <= HIT_RADIUS * HIT_RADIUS ? u : -1;
}

/**
 * Fly one arrow through one rack and record everything it skewers.
 *
 * The flight is walked at {@link RESOLVE_HZ}, which belongs to this function and not to
 * the caller's simulation: the result is a pure function of the rack, the aim and the
 * instant the arrow left, so two devices stepping at different rates resolve the identical
 * shot. A target is counted once however many times the arc crosses it.
 *
 * Allocates nothing: `out` is written in place and the only working state is a bitmask of
 * targets still standing.
 */
export function resolveShot(
  out: ShotResult,
  rack: readonly Target[],
  aim: Aim,
  startSeconds: number,
): void {
  resetShotResult(out);
  walk(rack, aim, startSeconds, RESOLVE_HZ, out, 1);
}

/**
 * How many targets an aim would skewer, in a world that drifts at `lead` times the real
 * rate.
 *
 * This is what a bot chooses between, and `lead` is the single thing its tier believes
 * about the gallery. At 0 it thinks the rack is standing still and both picks and aims
 * accordingly; at 1 it models the drift exactly, which is the same drift a person watching
 * the screen can see and no more (CLAUDE.md rule 6).
 *
 * Belief and aim have to come from the *same* number or the knob cancels itself out. An
 * earlier version led the aim by `leadRead` but always judged the candidate against a
 * frozen rack, so a leading shot was penalised in the choosing by exactly as much as it
 * gained in the flying: 20 000 arrows at `leadRead` 0 and at 1 both scored 3.08, and the
 * knob looked wired in while doing nothing at all.
 */
export function countHitsBelieved(
  rack: readonly Target[],
  aim: Aim,
  startSeconds: number,
  lead: number,
): number {
  return walk(rack, aim, startSeconds, PLAN_HZ, null, lead);
}

function walk(
  rack: readonly Target[],
  aim: Aim,
  startSeconds: number,
  hz: number,
  out: ShotResult | null,
  lead: number,
): number {
  const duration = flightSeconds(aim);
  if (out !== null) out.seconds = duration;
  const up = launchUpward(aim);
  const side = launchSideways(aim);
  const samples = Math.max(1, Math.ceil(duration * hz));
  const step = duration / samples;
  const size = rack.length;
  let pending = (1 << size) - 1;
  let count = 0;

  let s0 = 0;
  let ax0 = BOW_X;
  let ay0 = BOW_Y;
  for (let i = 0; i < samples && pending !== 0; i += 1) {
    const s1 = i + 1 === samples ? duration : (i + 1) * step;
    const ax1 = BOW_X + side * s1;
    const ay1 = BOW_Y - up * s1 + 0.5 * GRAVITY * s1 * s1;
    for (let index = 0; index < size; index += 1) {
      const bit = 1 << index;
      if ((pending & bit) === 0) continue;
      const target = rack[index];
      if (target === undefined) continue;
      const ty = target.y;
      // Cheap rejection on the row height alone, before the drift is evaluated at all.
      // The arrow crosses a row in about a thirtieth of a second, so all but a handful of
      // samples leave here without a sine call.
      if (ay0 - ty > HIT_RADIUS && ay1 - ty > HIT_RADIUS) continue;
      if (ty - ay0 > HIT_RADIUS && ty - ay1 > HIT_RADIUS) continue;
      const tx0 = targetXAt(target, startSeconds + lead * s0);
      const tx1 = lead === 0 ? tx0 : targetXAt(target, startSeconds + lead * s1);
      const u = sweepFraction(ax0, ay0, ax1, ay1, tx0, tx1, ty);
      if (u < 0) continue;
      pending &= ~bit;
      count += 1;
      if (out !== null) out.hitAt[index] = s0 + u * (s1 - s0);
    }
    s0 = s1;
    ax0 = ax1;
    ay0 = ay1;
  }
  if (out !== null) out.count = count;
  return count;
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

/** The observed rule, and the only number in this file that came from outside it. */
export const TARGET_GOAL = 70;

/**
 * The most rounds a match can run to.
 *
 * A race needs a backstop or it is not guaranteed to end, and this is ours. Thirty six is
 * comfortably past what any tier needs — measured, `easy` reaches seventy in 27.1 rounds
 * and `hard` in 13.9 — while keeping the worst case a long way inside the guard's ten
 * minutes: 2 x 36 x (3.5 s clock + 1.15 s flight + 0.2 s settle) plus 72 board turns of
 * 0.36 s is 375.1 s. See SPEC.md, which multiplies it out.
 */
export const ROUND_CAP = 36;

/** Two shots to a round, one each, so neither seat ever shoots more arrows than the other. */
export const SHOTS_PER_ROUND = 2;

/**
 * Who shoots first in a round.
 *
 * It alternates, because shooting *second* is a small advantage and a real one: you have
 * just watched an arrow fly through the rack you are about to shoot into, and you know
 * what you have to beat. Over an even number of rounds each seat leads exactly half.
 */
export function leaderFor(roundIndex: number): SeatId {
  return roundIndex % 2 === 0 ? 'p1' : 'p2';
}

/** Whose shot this is, given the round and which of its two shots is up. */
export function shooterFor(roundIndex: number, shotInRound: number): SeatId {
  const leader = leaderFor(roundIndex);
  return shotInRound % 2 === 0 ? leader : otherSeat(leader);
}

/** How many of an archer's best arrows the tie-break counts. */
export const TOP_ARROWS = 3;

export interface SeatState {
  /** Targets skewered. This is the score, and the race. */
  targets: number;
  /** Arrows loosed. Equal for both seats at every round boundary. */
  arrows: number;
  /**
   * The three biggest arrows of the match, largest first. Their sum is the tie-break.
   *
   * The single best arrow was the obvious choice and it is not enough: measured over 400
   * matches a tier, two seats finished level on targets 8.0-9.5% of the time and the best
   * arrow separated barely a quarter of those, because a good arrow tops out around six
   * and both seats shoot dozens. Three arrows have the resolution to settle nearly all of
   * them while still being the same claim — that the archer who put the most on one string
   * takes a dead heat.
   */
  readonly top: number[];
  /** Arrows that skewered nothing at all, for the card. */
  blanks: number;
}

export function createSeatState(): SeatState {
  return { targets: 0, arrows: 0, top: new Array<number>(TOP_ARROWS).fill(0), blanks: 0 };
}

export function resetSeatState(state: SeatState): void {
  state.targets = 0;
  state.arrows = 0;
  state.top.fill(0);
  state.blanks = 0;
}

/** The single best arrow, for the card. */
export function bestArrow(state: SeatState): number {
  return state.top[0] ?? 0;
}

/** The tie-break: how many targets this archer's three best arrows took between them. */
export function topArrows(state: SeatState): number {
  let total = 0;
  for (let i = 0; i < TOP_ARROWS; i += 1) total += state.top[i] ?? 0;
  return total;
}

/**
 * One target skewered.
 *
 * Split from {@link recordArrow} on purpose: the score moves as the arrow reaches each
 * target rather than all at once when it stops, so a player watches an arrow take three
 * rather than reading a number after it has gone. The arrow itself is recorded once, when
 * it comes to rest.
 */
export function recordHit(state: SeatState): void {
  state.targets += 1;
}

/** Close one arrow off on a seat's card. Adds no targets; {@link recordHit} did that. */
export function recordArrow(state: SeatState, hits: number): void {
  state.arrows += 1;
  if (hits === 0) state.blanks += 1;
  // Insertion into a descending list of three. Allocation-free, and the list is short
  // enough that anything cleverer would be slower as well as harder to read.
  for (let i = 0; i < TOP_ARROWS; i += 1) {
    if (hits <= (state.top[i] ?? 0)) continue;
    for (let j = TOP_ARROWS - 1; j > i; j -= 1) state.top[j] = state.top[j - 1] ?? 0;
    state.top[i] = hits;
    return;
  }
}

/**
 * First to seventy, and if both get there in the same round, whoever has more.
 *
 * Both comparisons go through the SDK's resolver rather than being written out here, so
 * "first to seventy" means the same thing as it does everywhere else in the catalogue and
 * a draw is a defined outcome rather than an oversight.
 *
 * Nothing is ever clamped to the goal. A seat that finishes a round on 72 beats one on 70,
 * because 72 and 70 are what they actually shot — pinning both to 70 and then comparing
 * them would manufacture a dead heat out of a decided race, which is exactly how two of
 * this catalogue's racing games spent a fortnight calling a bug a feature.
 *
 * @param roundComplete both seats have shot the same number of arrows. A race may never
 * be decided in the middle of a round: the seat that shoots first would otherwise win
 * every match that came down to one arrow.
 * @param capReached the round cap has been used up, so the highest count settles it.
 */
const RACE: WinCondition = { kind: 'first-to', target: TARGET_GOAL };
const HIGHEST: WinCondition = { kind: 'highest-when-time-expires' };

export function winnerOf(
  p1: SeatState,
  p2: SeatState,
  roundComplete: boolean,
  capReached: boolean,
): Outcome {
  if (!roundComplete) return null;
  const onTargets = resolve(RACE, { p1: p1.targets, p2: p2.targets }, { timeExpired: capReached });
  if (onTargets !== 'draw') return onTargets;
  // Level on targets: the archer whose three best arrows took the most between them takes
  // it. Level on that too and it is a genuine draw, which the shell knows what to do with.
  return resolve(HIGHEST, { p1: topArrows(p1), p2: topArrows(p2) }, { timeExpired: true });
}

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How many targets it looks at, nearest to the bow first.
   *
   * A weak archer takes the easy shot in front of them; a strong one reads the whole rack
   * looking for the line that takes three at once. This *withholds* attention rather than
   * granting knowledge — at its highest it sees exactly the rack a person sees, and never
   * more (CLAUDE.md rule 6).
   */
  readonly scan: number;
  /** How many flight times it tries for each of those targets. A finer search, not a better one. */
  readonly times: number;
  /** How much of a target's sideways drift it allows for, 0 to 1. Leading is the skill. */
  readonly leadRead: number;
  /** Spread on the angle it actually looses at, in radians. Its hand. */
  readonly angleSpread: number;
  /** Spread on the draw it actually looses at, as a fraction of full. */
  readonly powerSpread: number;
  /** Seconds it takes to settle before loosing, on the same clock everyone is on. */
  readonly dwell: number;
}

/**
 * Three tiers, all of them things a person does badly.
 *
 * A weak archer plinks at the nearest target, does not lead the drift, and has an unsteady
 * hand; a strong one scans the whole rack for the arrow that takes three, leads the slide,
 * and holds a line. None of the knobs hands a tier anything a human on the same screen
 * cannot see. Measured over thousands of seeded matches and recorded in SPEC.md.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    scan: 10,
    times: 2,
    leadRead: 0.2,
    angleSpread: 0.02,
    powerSpread: 0.03,
    dwell: 0.6,
  }),
  normal: Object.freeze({
    scan: 15,
    times: 3,
    leadRead: 0.6,
    angleSpread: 0.012,
    powerSpread: 0.018,
    dwell: 0.4,
  }),
  hard: Object.freeze({
    scan: 20,
    times: 5,
    leadRead: 0.95,
    angleSpread: 0.005,
    powerSpread: 0.008,
    dwell: 0.25,
  }),
});

/**
 * The flight times a bot considers, in seconds, **best first**.
 *
 * Ordered rather than spread across a band, so `times` is a monotone knob: a tier that
 * tries three of these tries the same three the tier above starts with, and never a worse
 * set. Spread evenly between a minimum and a maximum instead, `times` was not monotone at
 * all — two tries meant only the two extremes, and 20 000 arrows scored 2.59 against 2.94
 * for a single try at the middle.
 */
export const PLAN_TIMES: readonly number[] = Object.freeze([0.36, 0.26, 0.47, 0.21, 0.56]);

/**
 * A standard normal draw, by Box-Muller from the seeded stream.
 *
 * `float()` can return zero and `log(0)` is `-Infinity`, which would give an aim of NaN and
 * an arrow that misses everything for ever after, so the draw is nudged into `(0, 1]`.
 */
export function gaussian(rng: Rng): number {
  const u1 = Math.max(Number.EPSILON, rng.float());
  const u2 = rng.float();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * The aim that puts an arrow through a point in a chosen flight time, or false if no legal
 * draw does.
 *
 * Choosing the *time* rather than solving for the angle is what makes both arcs reachable
 * from one formula: a short time is a flat fast arrow, a long one a lob that arrives on the
 * way down. `vx = dx / t` and `vy = (dy + g t^2 / 2) / t` come straight out of the parabola.
 */
export function aimThrough(out: Aim, x: number, y: number, seconds: number): boolean {
  if (!(seconds > 0)) return false;
  const dx = x - BOW_X;
  const up = BOW_Y - y;
  const sideSpeed = dx / seconds;
  const upSpeed = (up + 0.5 * GRAVITY * seconds * seconds) / seconds;
  if (upSpeed <= 0) return false;
  const speed = Math.hypot(sideSpeed, upSpeed);
  if (speed < SPEED_MIN || speed > SPEED_MAX) return false;
  const angle = Math.atan2(sideSpeed, upSpeed);
  if (angle < -AIM_LIMIT || angle > AIM_LIMIT) return false;
  out.angle = angle;
  out.power = (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  return true;
}

/**
 * Working state for one bot's planning. Preallocated once and reused, so a turn allocates
 * nothing: the frozen rack it chooses against, the order it looks at targets in, and two
 * scratch aims.
 */
export interface BotPlan {
  readonly frozenX: Float64Array;
  readonly order: Int32Array;
  readonly candidate: Aim;
  readonly chosen: Aim;
  /** How many targets the chosen arrow was expected to take, against the frozen rack. */
  expected: number;
}

export function createBotPlan(): BotPlan {
  return {
    frozenX: new Float64Array(RACK_SIZE),
    order: new Int32Array(RACK_SIZE),
    candidate: createAim(),
    chosen: createAim(),
    expected: 0,
  };
}

/**
 * Choose an arrow.
 *
 * It reads the rack as it stands at the instant it means to loose, sorts the targets by how
 * near they are to the bow, and for the first `scan` of them tries `times` flight times,
 * keeping whichever legal aim would skewer the most **if the rack stood still**. Then its
 * hand is added: a normal wobble on the angle and on the draw, which is what separates the
 * tiers more than anything else does.
 *
 * `releaseSeconds` is when it intends to loose, not when it is thinking — so the lead it
 * takes is the lead a person takes when they say "I will shoot when it gets there".
 */
export function planShot(
  plan: BotPlan,
  rack: readonly Target[],
  profile: BotProfile,
  releaseSeconds: number,
  rng: Rng,
): void {
  const size = rack.length;
  for (let i = 0; i < size; i += 1) {
    const target = rack[i];
    plan.frozenX[i] = target === undefined ? 0 : targetXAt(target, releaseSeconds);
    plan.order[i] = i;
  }
  // Nearest first, by insertion sort over at most twenty entries: no allocation, and the
  // order is total because two targets never share a position.
  for (let i = 1; i < size; i += 1) {
    const index = plan.order[i] ?? 0;
    const key = distanceRank(rack, plan.frozenX, index);
    let j = i - 1;
    while (j >= 0 && distanceRank(rack, plan.frozenX, plan.order[j] ?? 0) > key) {
      plan.order[j + 1] = plan.order[j] ?? 0;
      j -= 1;
    }
    plan.order[j + 1] = index;
  }

  // A fallback that is always legal, in case no candidate is: point straight up at a draw
  // that reaches the middle row. An arrow is always loosed, so a turn always ends.
  plan.chosen.angle = 0;
  plan.chosen.power = 0.6;
  plan.expected = 0;

  const scan = Math.min(profile.scan, size);
  const times = Math.min(PLAN_TIMES.length, Math.max(1, profile.times));
  let best = -1;
  for (let slot = 0; slot < scan; slot += 1) {
    const index = plan.order[slot] ?? 0;
    const target = rack[index];
    if (target === undefined) continue;
    const now = plan.frozenX[index] ?? 0;
    for (let k = 0; k < times; k += 1) {
      const seconds = PLAN_TIMES[k] ?? PLAN_TIMES[0] ?? 0.36;
      // Where it thinks the target will be: some fraction of the way to where it will
      // actually be, which is the one thing the tiers differ on that the game is about.
      const led = targetXAt(target, releaseSeconds + seconds);
      const aimedX = now + profile.leadRead * (led - now);
      if (!aimThrough(plan.candidate, aimedX, target.y, seconds)) continue;
      const value = countHitsBelieved(rack, plan.candidate, releaseSeconds, profile.leadRead);
      if (value <= best) continue;
      best = value;
      plan.expected = value;
      plan.chosen.angle = plan.candidate.angle;
      plan.chosen.power = plan.candidate.power;
    }
  }

  plan.chosen.angle = clamp(
    plan.chosen.angle + gaussian(rng) * profile.angleSpread,
    -AIM_LIMIT,
    AIM_LIMIT,
  );
  plan.chosen.power = clamp(plan.chosen.power + gaussian(rng) * profile.powerSpread, 0, 1);
}

/** How far a target is from the bow, squared. Only ever compared, never rooted. */
function distanceRank(rack: readonly Target[], frozenX: Float64Array, index: number): number {
  const target = rack[index];
  if (target === undefined) return Number.POSITIVE_INFINITY;
  const dx = (frozenX[index] ?? 0) - BOW_X;
  const dy = target.y - BOW_Y;
  return dx * dx + dy * dy;
}
