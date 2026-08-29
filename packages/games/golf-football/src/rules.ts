import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Golf Football, as pure rules.
 *
 * A patch of turf with a cup at the middle of it and two posts standing either side, so the
 * cup sits in a goal mouth. Each seat owns a ball. On your turn you kick **your own ball**
 * from wherever it lies; put it in the cup and you score. Both balls are on the turf the
 * whole match and they hit each other, so a kick that leaves your ball in front of the goal
 * is a thing your opponent can do something about.
 *
 * ## The four decisions that shape this file
 *
 * **The turf is a constant deceleration, and the step is its exact integral.** Issue #2465:
 * a game that steps `x += v·dt` and then decays `v` while its bot works out the stopping
 * distance from the analytic integral is a bot aiming at a different world from the one it
 * plays in. There are two sanctioned models in this repository and this is Mini Golf's: a
 * constant deceleration, `d = v² / 2a` exactly, with the per-step travel written as
 * `(v − ½a·dt)·dt` rather than `v·dt`. The consequence is not academic — the whole of the
 * weight dial is `reachOf`/`powerForReach`, an exact inverse pair through the same constant,
 * and {@link CAPTURE_OVERRUN} (how far past the cup a ball may be aimed and still drop) is
 * that same law read backwards from {@link CAPTURE_SPEED}. A bot using those numbers is
 * using the physics the ball actually obeys. `rules.test.ts` steps the same kick at 60, 90,
 * 120 and 240 Hz and requires the identical stopping coordinate.
 *
 * **Both dials are moments.** The catalogue row already says the power is a press length —
 * "the longer you press, the stronger the shot" — and a press length is the most
 * instrument-neutral quantity there is. But an *angle* read off a pointer hands a mouse an
 * aim a thumb cannot match, so the angle is a moment too: a needle sweeps across the arc and
 * the press-down keeps it. One gesture, two moments — press to keep the line, hold to build
 * the weight, let go to kick. The pointer's *position* is never read anywhere in this game.
 * See `SPEC.md`.
 *
 * **The ready pause is here, not in the shell.** The shell turns the pitch to face whoever
 * is kicking and refuses a person's input for the 0.36 s that takes. A bot does not go
 * through the shell, so it would get that third of a second of free needle.
 * {@link READY_SECONDS} freezes the needle for both of them in the simulation, where a
 * person and a bot are the same thing. It cannot live in `game.ts` instead: `seatView`
 * reports no rotation at all in single-seat play, so a freeze keyed off the flip would step
 * one match on a shared phone and a different one on two phones playing remotely. **[ours]**
 *
 * **A match is a fixed number of kicks each.** `roundSeconds` ends nothing — it prints
 * "about 2 min" on a catalogue card. A golf game whose weak bot never holes out would hang,
 * so nothing about how the match is played can add or remove a kick: {@link KICKS_EACH} each,
 * strictly alternating from `openingSeat`, and when they are gone the higher score wins.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit, never a pixel.
 */

/* ------------------------------------------------------------------ the pitch */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;

/**
 * The centre of the logical box, which is also the cup.
 *
 * `Renderer.pushRotation` turns the world about the centre of the *logical box*, so
 * everything below is laid out symmetrically about this point and the half-turn maps the
 * pitch, the posts, the cup and the two kick-off spots onto themselves. A pitch centred
 * anywhere else would sit differently on the screen for the two seats, which is rule 9.
 */
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** The turf inside the boards. The bands above and below carry the card and the scoreboard. */
export const PITCH_LEFT = 40;
export const PITCH_RIGHT = 660;
export const PITCH_TOP = 130;
export const PITCH_BOTTOM = 870;

export const BALL_RADIUS = 13;
/** The cup's mouth, measured against a ball's centre. */
export const CUP_RADIUS = 20;
export const POST_RADIUS = 16;

/**
 * Half the gap between the two posts.
 *
 * The posts are what makes the angle a skill rather than a formality. A ball travelling
 * straight at the cup clears both posts while its centre is inside `GATE_HALF − POST_RADIUS
 * − BALL_RADIUS` of the middle — 29 units — and drops while it is inside `CUP_RADIUS`, 20.
 * So the gate is mostly cup: threading it is very nearly scoring, and the nine units either
 * side are the near miss that leaves the ball sitting in the mouth for the other player to
 * knock away.
 */
export const GATE_HALF = 58;

export interface Post {
  readonly x: number;
  readonly y: number;
}

/**
 * The two posts, one either side of the cup.
 *
 * A rotationally symmetric pair: the half-turn maps each onto the other, so neither seat
 * faces the easier side of the goal.
 */
export const POSTS: readonly Post[] = Object.freeze([
  Object.freeze({ x: CENTRE_X - GATE_HALF, y: CENTRE_Y }),
  Object.freeze({ x: CENTRE_X + GATE_HALF, y: CENTRE_Y }),
]);

/**
 * Where a ball is placed at the start of the match and after it is holed.
 *
 * Off the centre line on purpose. Straight in front of the cup the opening kick would be one
 * exact needle value for the whole match and every seat would learn the same single moment;
 * from the corner the line into the gate is a real angle, and the two spots are still one
 * shape under the half-turn — `spotOf('p1')` rotated about the centre **is** `spotOf('p2')`,
 * to the bit, and a test asserts it.
 */
export const SPOT_LATERAL = 150;
export const SPOT_FORWARD = 280;

export function spotXOf(seat: SeatId): number {
  return seat === 'p1' ? CENTRE_X - SPOT_LATERAL : CENTRE_X + SPOT_LATERAL;
}

export function spotYOf(seat: SeatId): number {
  return seat === 'p1' ? CENTRE_Y + SPOT_FORWARD : CENTRE_Y - SPOT_FORWARD;
}

/* ------------------------------------------------------------------ the ball on turf */

/**
 * Deceleration of a rolling ball, in units per second per second.
 *
 * **Constant, not proportional**, and that is the whole of issue #2465's answer. A decay
 * only approaches zero and needs a crawl threshold to cut it off; a constant deceleration
 * reaches zero at a time that can be written down — {@link SETTLE_BOUND_SECONDS} — and gives
 * an exact relation between weight and distance, `d = v² / 2a`, which is what makes a kick
 * learnable rather than a guess and what lets the bot use the same arithmetic the ball does.
 */
export const TURF_FRICTION = 420;

/**
 * The weight gauge, in units of turf rather than in units of speed.
 *
 * Linear in *distance*, not in speed. A gauge linear in speed would put three quarters of
 * its travel in the last quarter of the pitch, because distance goes as the square of
 * speed — so a press error near the bottom of the gauge would be worth almost nothing and
 * one near the top would be worth a hundred units. Linear in distance, a tenth of a second
 * of press error is worth the same number of units of turf wherever on the gauge it lands,
 * which is what lets the difficulty ladder sit in one place instead of three.
 */
export const MIN_REACH = 55;
export const MAX_REACH = 880;

/** The fastest a ball can leave a foot: exactly the speed that rolls {@link MAX_REACH}. */
export const KICK_MAX_SPEED = Math.sqrt(2 * TURF_FRICTION * MAX_REACH);

/**
 * How fast a ball may be moving over the cup and still drop.
 *
 * A ball hit flat out at the goal rides the lip and runs on, which is a real rule of the
 * game and the reason the weight is a skill instead of a slider to hold at maximum. Under a
 * constant deceleration this is exactly a distance: a ball drops if and only if the turf
 * left in it — `v² / 2a` — is at most {@link CAPTURE_OVERRUN}. So "how far past the cup may
 * I aim" has an exact answer rather than an experimental one, and it is the same answer for
 * a player and for the bot.
 */
export const CAPTURE_SPEED = 200;

/** How far past the cup a ball may be aimed to die and still drop: `v² / 2a`, 47.6 units. */
export const CAPTURE_OVERRUN = (CAPTURE_SPEED * CAPTURE_SPEED) / (2 * TURF_FRICTION);

/** How much speed survives a board. Enough to bank a kick, little enough to punish one. */
export const BOARD_BOUNCE = 0.62;
/** A post is dead wood: a ball off one has lost most of what it had. */
export const POST_BOUNCE = 0.5;
/** Ball on ball. Nearly elastic, so a clearance carries. */
export const BALL_BOUNCE = 0.9;

/**
 * The longest a kick can possibly still be rolling, in seconds.
 *
 * A bound, not a hope, and the reason the turn order can rest on "the turf settles". Nothing
 * out there adds energy: a board keeps {@link BOARD_BOUNCE} of one component, a post keeps
 * {@link POST_BOUNCE} of one, and an equal-mass contact with restitution `e < 1` exchanges
 * the normal components as `((1−e)a + (1+e)b)/2` and its mirror, whose squares sum to at
 * most the original pair's. The separating push moves a ball without touching a velocity.
 * So no ball ever exceeds {@link KICK_MAX_SPEED}, and every ball loses exactly
 * {@link TURF_FRICTION} of speed a second: `KICK_MAX_SPEED / TURF_FRICTION`, 2.05 s.
 */
export const SETTLE_BOUND_SECONDS = KICK_MAX_SPEED / TURF_FRICTION;

/**
 * A belt-and-braces cap on one kick.
 *
 * The friction model already stops every ball inside 2.05 s and a test proves it, so this
 * never fires in play. It is here because "the turf must actually settle" is the property
 * the whole turn order rests on, and a guard costing one addition a step is cheaper than a
 * match that hangs.
 */
export const MAX_ROLL_SECONDS = 4;

/** The turf a kick at `power` covers on clean ground. The exact inverse of {@link powerForReach}. */
export function reachOf(power: number): number {
  return MIN_REACH + clamp(power, 0, 1) * (MAX_REACH - MIN_REACH);
}

/** The gauge reading that would leave a ball dead after `distance`. Clamped to the gauge. */
export function powerForReach(distance: number): number {
  return clamp((distance - MIN_REACH) / (MAX_REACH - MIN_REACH), 0, 1);
}

/** The speed that rolls exactly `distance` before stopping: `√(2ad)`. */
export function speedForReach(distance: number): number {
  return Math.sqrt(2 * TURF_FRICTION * (distance > 0 ? distance : 0));
}

/* ------------------------------------------------------------------ the two dials */

/**
 * The aim needle: how far it sweeps either side of the line to the cup, and how fast.
 *
 * **Centred on the cup, not on the pitch.** The decision a player is making is "how much
 * left or right of the hole", so that is what the gauge measures, from wherever the ball
 * happens to lie. It also makes the gauge exactly covariant under the half-turn — the line
 * to the cup rotates with everything else, so both seats read the identical needle for
 * mirrored positions, and `rules.test.ts` asserts that over hundreds of random pitches.
 *
 * The rate is a lattice and that is the part worth watching: a needle can only be stopped on
 * a whole frame, so a kick's line can only fall on a grid — 0.015 rad, which at the 318
 * units from a kick-off spot to the cup is 4.8 units of turf. **8.4 steps across the cup's
 * 40-unit mouth**, and eight is where Cup Pong found the ladder stops being decided by the
 * frame rate rather than by the press. A crossing takes 1.22 s, comfortably over the 1.2 s
 * `docs/input-idiom.md` requires of a timing gauge so that 30 ms of device latency is under
 * 3% of the window.
 */
export const AIM_SWEEP = 0.55;
export const AIM_RATE = 0.9;

/**
 * How long the weight gauge takes to fill, and what that is per second.
 *
 * 1.6 s over 825 units of turf is 516 units a second. The window in which a ball drops runs
 * from `CUP_RADIUS` short of the cup to {@link CAPTURE_OVERRUN} past it — 67.6 units — so the
 * gauge is worth **0.066 s of press error either side of centre**.
 *
 * The needle is worth 0.070 s: a 20-unit cup radius at the 318 units from a kick-off spot,
 * under a needle covering 286 units of that arc a second. The two are within 6% of each other
 * on purpose, so neither press is the one that decides everything.
 */
export const POWER_RISE = 1.6;
export const POWER_RATE = 1 / POWER_RISE;

/**
 * How long both dials are frozen at the start of a turn.
 *
 * **Longer than the shell's 0.36 s seat flip, deliberately.** The needle starts at one end of
 * its sweep and covers 0.9 rad a second, so 0.36 s of it is 0.324 rad — nearly a third of
 * the whole gauge, and every line from the left limit to well past the middle. A person who
 * had to wait the flip out would find all of it gone on the first pass and would wait most
 * of a second more for the needle to come back; a bot, which does not go through the shell,
 * would have had every bit of it.
 */
export const READY_SECONDS = 0.5;

/**
 * How long the needle may sweep before the line is taken automatically, and how long the
 * gauge may fill before the ball is kicked automatically.
 *
 * Nothing else forces either press, and a match has to move whether anybody touches the
 * device or not — `input-fuzz.test.ts` drives every game with a storm of garbage and no bots
 * at all. The aim deadline is a whole sweep and a half so a person always gets the far half
 * of the gauge; the wind deadline is the fill plus a beat at the top.
 */
export const AIM_DEADLINE = 3.2;
export const WIND_DEADLINE = POWER_RISE + 0.35;

/** Seconds the result is held on the pitch before the board turns. */
export const SETTLE_SECONDS = 0.45;

/* ------------------------------------------------------------------ the match */

/**
 * Kicks each seat gets. The termination guarantee, and a plain counter rather than a clock.
 *
 * Kicks alternate strictly from `openingSeat`, so a match is eighteen kicks whatever happens
 * in them and two players who never hole out still finish. See the note at the top.
 */
export const KICKS_EACH = 9;

/**
 * A goal is worth what it was worth to hole: three from range, two from the middle
 * distance, one from inside the apron, valued by where the ball stood when the kick was
 * taken.
 *
 * This is the score's resolution and it is the third thing tried. Everything worth one point
 * left two players of the same standard level far too often; two tiers left them level 14.8%
 * of the time at `hard`, and the obvious tiebreak — who scored more of the dearer goals —
 * turned out to be **almost the same number as the score**, resolving 14.8% to 14.6%. With
 * `p = 2L + T` fixed, `L` and `T` move together, so a two-tier score and a two-tier tiebreak
 * carry one bit between them. Three tiers carry a genuinely finer score: draws fall to the
 * figures in `SPEC.md`.
 *
 * It cannot be farmed. Holing out returns the ball to its own spot, 318 units out and worth
 * the full three, so kicking away to manufacture a dearer goal costs the extra kick it earns.
 * A near miss that leaves the ball sitting in the mouth is the only way into the cheap bands,
 * which is the mild penalty a near miss deserves.
 */
export const APRON_RADIUS = 110;
export const RANGE_RADIUS = 260;
export const RANGE_GOAL = 3;
export const MID_GOAL = 2;
export const TAP_GOAL = 1;

/**
 * The primary comparison, asked of the SDK so that "highest score at the end" means here
 * what it means everywhere else. The tiebreak that follows it is in {@link settleMatch}.
 */
export const WIN_CONDITION: WinCondition = { kind: 'highest-when-time-expires' };

export type Phase = 'ready' | 'aiming' | 'winding' | 'rolling' | 'settling' | 'over';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** How far from the cup this ball stood when the kick in progress was taken. */
  startDistance: number;
  /** Dropped during the kick in progress. Cleared when it is put back on its spot. */
  holed: boolean;
}

export interface Match {
  readonly p1: Ball;
  readonly p2: Ball;
  /** Who kicks. A turn game has to answer this. */
  seat: SeatId;
  phase: Phase;
  /** Seconds left of the ready freeze or of the settle, whichever phase is running. */
  hold: number;
  /** Seconds the live dial has been running, for its deadline. */
  clock: number;
  /** Where the needle is, in radians either side of the line to the cup. */
  aim: number;
  aimRising: boolean;
  /** The line kept by the press, as an offset. Meaningful once the phase is past `aiming`. */
  lockedAim: number;
  /** The absolute bearing the needle is measured from: the line from the ball to the cup. */
  aimBase: number;
  /** Where the weight gauge is, in 0..1. */
  power: number;
  rollSeconds: number;
  /** Kicks taken by both seats together. The match ends when it reaches `KICKS_EACH * 2`. */
  kicks: number;
  /** Kicks each seat has taken, for the scoreboard. */
  readonly kicksBy: { p1: number; p2: number };
  readonly points: { p1: number; p2: number };
  /** Goals worth {@link RANGE_GOAL}. The first tiebreak, and the reason distance pays. */
  readonly rangeGoals: { p1: number; p2: number };
  /** The distances those goals were holed from, summed. The backstop under both. */
  readonly holedRange: { p1: number; p2: number };
  /** Who scored on the kick just settled, and what it was worth. For the card. */
  lastGoal: SeatId | null;
  lastGoalValue: number;
  winner: SeatId | 'draw' | null;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function ballOf(match: Match, seat: SeatId): Ball {
  return seat === 'p1' ? match.p1 : match.p2;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function newBall(): Ball {
  return { x: 0, y: 0, vx: 0, vy: 0, startDistance: 0, holed: false };
}

export function createMatch(): Match {
  const match: Match = {
    p1: newBall(),
    p2: newBall(),
    seat: 'p1',
    phase: 'ready',
    hold: READY_SECONDS,
    clock: 0,
    aim: -AIM_SWEEP,
    aimRising: true,
    lockedAim: 0,
    aimBase: 0,
    power: 0,
    rollSeconds: 0,
    kicks: 0,
    kicksBy: { p1: 0, p2: 0 },
    points: { p1: 0, p2: 0 },
    rangeGoals: { p1: 0, p2: 0 },
    holedRange: { p1: 0, p2: 0 },
    lastGoal: null,
    lastGoalValue: 0,
    winner: null,
  };
  resetMatch(match, 'p1');
  return match;
}

/**
 * Stand the match back up with `opener` to kick.
 *
 * The opening seat comes from `GameContext.openingSeat` and is never assumed to be `p1`:
 * the SDK alternates it across the rounds of a best-of so first-mover advantage washes out,
 * and thirty-four older games hardcoding `p1` are being dug out under #2487.
 */
export function resetMatch(match: Match, opener: SeatId): void {
  placeOnSpot(match.p1, 'p1');
  placeOnSpot(match.p2, 'p2');
  match.seat = opener;
  match.kicks = 0;
  match.kicksBy.p1 = 0;
  match.kicksBy.p2 = 0;
  match.points.p1 = 0;
  match.points.p2 = 0;
  match.rangeGoals.p1 = 0;
  match.rangeGoals.p2 = 0;
  match.holedRange.p1 = 0;
  match.holedRange.p2 = 0;
  match.lastGoal = null;
  match.lastGoalValue = 0;
  match.winner = null;
  beginKick(match);
}

function placeOnSpot(ball: Ball, seat: SeatId): void {
  ball.x = spotXOf(seat);
  ball.y = spotYOf(seat);
  ball.vx = 0;
  ball.vy = 0;
  ball.holed = false;
}

/**
 * Start a turn, with the needle parked at one end of its sweep and neither dial moving.
 *
 * Parked at the end rather than in the middle: parked at zero it would already be pointing
 * at the cup on the step the freeze lifts, and an instant press would be a free perfect line.
 */
function beginKick(match: Match): void {
  const ball = ballOf(match, match.seat);
  match.phase = 'ready';
  match.hold = READY_SECONDS;
  match.clock = 0;
  match.aim = -AIM_SWEEP;
  match.aimRising = true;
  match.lockedAim = 0;
  match.aimBase = Math.atan2(CENTRE_Y - ball.y, CENTRE_X - ball.x);
  match.power = 0;
  match.rollSeconds = 0;
  match.p1.startDistance = Math.hypot(match.p1.x - CENTRE_X, match.p1.y - CENTRE_Y);
  match.p2.startDistance = Math.hypot(match.p2.x - CENTRE_X, match.p2.y - CENTRE_Y);
}

/** How far from the cup a point is. Every distance in this game is measured to it. */
export function distanceToCup(x: number, y: number): number {
  return Math.hypot(x - CENTRE_X, y - CENTRE_Y);
}

/** What a goal by this ball would be worth, from where it stood when the kick was taken. */
export function goalValueOf(ball: Ball): number {
  if (ball.startDistance > RANGE_RADIUS) return RANGE_GOAL;
  return ball.startDistance > APRON_RADIUS ? MID_GOAL : TAP_GOAL;
}

/* ------------------------------------------------------------------ the two presses */

/**
 * The press: keep the line and start the weight gauge.
 *
 * Returns whether it did anything, so a caller need not re-derive the phase. Refused from
 * the wrong seat and refused during the ready freeze, which is what makes the freeze mean
 * the same thing for a person and for a bot.
 */
export function pressAim(match: Match, seat: SeatId): boolean {
  if (match.phase !== 'aiming') return false;
  if (match.seat !== seat) return false;
  match.lockedAim = match.aim;
  match.phase = 'winding';
  match.power = 0;
  match.clock = 0;
  return true;
}

/**
 * The release: kick, at whatever the gauge has reached.
 *
 * A press and a release arriving on the same step is an ordinary tap on most devices, and it
 * is a legal kick here — the feeblest one there is, {@link MIN_REACH} units of turf. Refusing
 * it would make a tap mean nothing on the one input the whole game is built out of.
 */
export function release(match: Match, seat: SeatId): boolean {
  if (match.phase !== 'winding') return false;
  if (match.seat !== seat) return false;
  kick(match);
  return true;
}

function kick(match: Match): void {
  const ball = ballOf(match, match.seat);
  const angle = match.aimBase + match.lockedAim;
  const speed = speedForReach(reachOf(match.power));
  ball.vx = Math.cos(angle) * speed;
  ball.vy = Math.sin(angle) * speed;
  match.phase = 'rolling';
  match.rollSeconds = 0;
  match.clock = 0;
  match.lastGoal = null;
  match.lastGoalValue = 0;
  match.kicks += 1;
  match.kicksBy[match.seat] += 1;
}

/* ------------------------------------------------------------------ the step */

export interface StepResult {
  /** True on the step the turf came to rest. */
  readonly settled: boolean;
  /** Who scored on the step the kick settled, or null. */
  readonly goal: SeatId | null;
  readonly goalValue: number;
  /** True on the step the turn passed. */
  readonly handedOver: boolean;
}

interface MutableStepResult {
  settled: boolean;
  goal: SeatId | null;
  goalValue: number;
  handedOver: boolean;
}

/** Reused, so a step allocates nothing. Read before the next call, never held. */
const stepScratch: MutableStepResult = {
  settled: false,
  goal: null,
  goalValue: 0,
  handedOver: false,
};

/**
 * One fixed step of the whole match.
 *
 * The state machine lives here rather than in `game.ts` on purpose: everything a match does
 * has to be identical in shared-screen and single-seat play, and the only way to guarantee
 * that is for none of it to be reachable from the presentation. `game.ts` feeds this two
 * booleans and draws what comes out.
 */
export function step(match: Match, fixedDeltaSeconds: number): StepResult {
  stepScratch.settled = false;
  stepScratch.goal = null;
  stepScratch.goalValue = 0;
  stepScratch.handedOver = false;
  if (match.phase === 'over') return stepScratch;

  if (match.phase === 'ready') {
    match.hold -= fixedDeltaSeconds;
    if (match.hold <= 0) {
      match.phase = 'aiming';
      match.clock = 0;
    }
    return stepScratch;
  }

  if (match.phase === 'aiming') {
    const travel = (match.aimRising ? 1 : -1) * AIM_RATE * fixedDeltaSeconds;
    match.aim = clamp(match.aim + travel, -AIM_SWEEP, AIM_SWEEP);
    if (match.aim >= AIM_SWEEP) match.aimRising = false;
    else if (match.aim <= -AIM_SWEEP) match.aimRising = true;
    match.clock += fixedDeltaSeconds;
    // Nothing else forces the press, and a match has to move whether anybody touches the
    // device or not. The line taken is wherever the needle is: a fumble, not a gift.
    if (match.clock >= AIM_DEADLINE) pressAim(match, match.seat);
    return stepScratch;
  }

  if (match.phase === 'winding') {
    match.power = clamp(match.power + POWER_RATE * fixedDeltaSeconds, 0, 1);
    match.clock += fixedDeltaSeconds;
    if (match.clock >= WIND_DEADLINE) kick(match);
    return stepScratch;
  }

  if (match.phase === 'rolling') {
    match.rollSeconds += fixedDeltaSeconds;
    rollTurf(match, fixedDeltaSeconds);
    const stopped = atRest(match.p1) && atRest(match.p2);
    if (!stopped && match.rollSeconds < MAX_ROLL_SECONDS) return stepScratch;
    stopBoth(match);
    awardGoals(match);
    match.phase = 'settling';
    match.hold = SETTLE_SECONDS;
    stepScratch.settled = true;
    stepScratch.goal = match.lastGoal;
    stepScratch.goalValue = match.lastGoalValue;
    return stepScratch;
  }

  match.hold -= fixedDeltaSeconds;
  if (match.hold > 0) return stepScratch;
  handOver(match);
  stepScratch.handedOver = true;
  return stepScratch;
}

function atRest(ball: Ball): boolean {
  return ball.holed || (ball.vx === 0 && ball.vy === 0);
}

function stopBoth(match: Match): void {
  match.p1.vx = 0;
  match.p1.vy = 0;
  match.p2.vx = 0;
  match.p2.vy = 0;
}

/**
 * Both balls, one step.
 *
 * The travel over a step is the exact integral of a constant deceleration, `(v − ½a·dt)·dt`,
 * and the last partial step covers exactly the `v² / 2a` it has left — which is what makes
 * the total roll the same number at 60, 90, 120 and 240 Hz instead of drifting by a per-step
 * rounding. That is not tidiness: `reachOf` is the inverse of this law and the bot aims with
 * it, so an integrator that disagreed would be a bot aiming at a different pitch from the one
 * it plays on. See issue #2465 and the note at the top of this file.
 */
function rollTurf(match: Match, fixedDeltaSeconds: number): void {
  advance(match.p1, fixedDeltaSeconds);
  advance(match.p2, fixedDeltaSeconds);
  bounceOffBoards(match.p1);
  bounceOffBoards(match.p2);
  bounceOffPosts(match.p1);
  bounceOffPosts(match.p2);
  if (!match.p1.holed && !match.p2.holed) collide(match.p1, match.p2);
  dropIn(match.p1);
  dropIn(match.p2);
}

function advance(ball: Ball, fixedDeltaSeconds: number): void {
  if (ball.holed) return;
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed === 0) return;
  const ux = ball.vx / speed;
  const uy = ball.vy / speed;
  let travel: number;
  let left: number;
  if (speed <= TURF_FRICTION * fixedDeltaSeconds) {
    // It runs out inside this step: the exact distance it has left, then a dead stop.
    travel = (speed * speed) / (2 * TURF_FRICTION);
    left = 0;
  } else {
    travel = (speed - 0.5 * TURF_FRICTION * fixedDeltaSeconds) * fixedDeltaSeconds;
    left = speed - TURF_FRICTION * fixedDeltaSeconds;
  }
  ball.x += ux * travel;
  ball.y += uy * travel;
  // Written as an exact zero rather than `ux * 0`, which is a negative zero for half the
  // directions on the pitch and reads as one in every test and trace that prints it.
  ball.vx = left === 0 ? 0 : ux * left;
  ball.vy = left === 0 ? 0 : uy * left;
}

function bounceOffBoards(ball: Ball): void {
  if (ball.holed) return;
  const left = PITCH_LEFT + BALL_RADIUS;
  const right = PITCH_RIGHT - BALL_RADIUS;
  const top = PITCH_TOP + BALL_RADIUS;
  const bottom = PITCH_BOTTOM - BALL_RADIUS;
  if (ball.x < left) {
    ball.x = left;
    ball.vx = Math.abs(ball.vx) * BOARD_BOUNCE;
  } else if (ball.x > right) {
    ball.x = right;
    ball.vx = -Math.abs(ball.vx) * BOARD_BOUNCE;
  }
  if (ball.y < top) {
    ball.y = top;
    ball.vy = Math.abs(ball.vy) * BOARD_BOUNCE;
  } else if (ball.y > bottom) {
    ball.y = bottom;
    ball.vy = -Math.abs(ball.vy) * BOARD_BOUNCE;
  }
}

/**
 * The ball against the two posts.
 *
 * Pushed clear along the normal and reflected about it. A ball whose centre has ended up
 * exactly on a post centre cannot happen at these speeds — a post is 16 across and a ball
 * covers at most 14 units in a step — but it is handled anyway rather than dividing by zero,
 * because a ball that got stuck inside a post would buzz there for ever and a kick that never
 * settles is the one failure the turn order cannot survive.
 */
function bounceOffPosts(ball: Ball): void {
  if (ball.holed) return;
  const reach = BALL_RADIUS + POST_RADIUS;
  for (let i = 0; i < POSTS.length; i += 1) {
    const post = POSTS[i];
    if (post === undefined) continue;
    const dx = ball.x - post.x;
    const dy = ball.y - post.y;
    const gap = Math.hypot(dx, dy);
    if (gap >= reach) continue;
    const nx = gap > 1e-9 ? dx / gap : 0;
    const ny = gap > 1e-9 ? dy / gap : 1;
    ball.x = post.x + nx * reach;
    ball.y = post.y + ny * reach;
    reflect(ball, nx, ny, POST_BOUNCE);
  }
}

function reflect(ball: Ball, nx: number, ny: number, bounce: number): void {
  const along = ball.vx * nx + ball.vy * ny;
  // Already travelling away from the face: reflecting again would suck it back in.
  if (along >= 0) return;
  const impulse = (1 + bounce) * along;
  ball.vx -= impulse * nx;
  ball.vy -= impulse * ny;
}

/**
 * Ball on ball: equal masses, restitution {@link BALL_BOUNCE}.
 *
 * Written symmetrically on purpose. The normal is `(b − a)` and the impulse `−(1+e)/2` of the
 * relative normal speed, applied `+` to one and `−` to the other, so swapping the arguments
 * gives the identical result — which is what makes the whole game covariant under the
 * half-turn that separates the two seats, and is asserted by the mirror test.
 */
function collide(a: Ball, b: Ball): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const gap = Math.hypot(dx, dy);
  const reach = BALL_RADIUS * 2;
  if (gap >= reach) return;
  const nx = gap > 1e-9 ? dx / gap : 1;
  const ny = gap > 1e-9 ? dy / gap : 0;
  // Separate first, in equal halves, so neither ball is the one that gives way.
  const push = (reach - gap) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;

  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= 0) return;
  const impulse = ((1 + BALL_BOUNCE) * closing) / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

/**
 * Whether the ball drops.
 *
 * Over the cup **and** slow enough. Under a constant deceleration "slow enough" is exactly
 * "has at most {@link CAPTURE_OVERRUN} of turf left in it", which is the same sentence a
 * player learns as "do not batter it at the hole".
 */
export function cupCaptures(x: number, y: number, vx: number, vy: number): boolean {
  const dx = x - CENTRE_X;
  const dy = y - CENTRE_Y;
  if (dx * dx + dy * dy > CUP_RADIUS * CUP_RADIUS) return false;
  return Math.hypot(vx, vy) <= CAPTURE_SPEED;
}

function dropIn(ball: Ball): void {
  if (ball.holed) return;
  if (!cupCaptures(ball.x, ball.y, ball.vx, ball.vy)) return;
  ball.x = CENTRE_X;
  ball.y = CENTRE_Y;
  ball.vx = 0;
  ball.vy = 0;
  ball.holed = true;
}

const SEAT_ORDER: readonly SeatId[] = Object.freeze(['p1', 'p2']);

/**
 * Book-keep whatever went in.
 *
 * **A ball in the cup is a point for the player it belongs to, whoever put it there.** That
 * one sentence is what gives a clearance its price: knocking the other ball away from the
 * mouth is the obvious move, and knocking it *in* hands them the goal. Both balls can drop
 * on the same kick, and both count.
 */
function awardGoals(match: Match): void {
  match.lastGoal = null;
  match.lastGoalValue = 0;
  for (const seat of SEAT_ORDER) {
    const ball = ballOf(match, seat);
    if (!ball.holed) continue;
    const value = goalValueOf(ball);
    match.points[seat] += value;
    match.holedRange[seat] += ball.startDistance;
    if (value === RANGE_GOAL) match.rangeGoals[seat] += 1;
    // The card shows one goal, and the kicker's own is the interesting one when two drop.
    if (match.lastGoal === null || seat === match.seat) {
      match.lastGoal = seat;
      match.lastGoalValue = value;
    }
  }
}

/**
 * Put any holed ball back on its spot, hand the turn over, and decide whether the match is
 * done.
 *
 * A ball coming back to an occupied spot is pushed clear rather than left overlapping — it
 * can only happen when the other player has parked on your spot, which is rare and legal —
 * and the push is along the line out from the cup, so it is the same push for both seats.
 */
function handOver(match: Match): void {
  returnHoled(match, 'p1');
  returnHoled(match, 'p2');
  if (match.kicks >= KICKS_EACH * 2) {
    settleMatch(match);
    return;
  }
  match.seat = otherOf(match.seat);
  beginKick(match);
}

function returnHoled(match: Match, seat: SeatId): void {
  const ball = ballOf(match, seat);
  if (!ball.holed) return;
  placeOnSpot(ball, seat);
  const other = ballOf(match, otherOf(seat));
  const dx = ball.x - other.x;
  const dy = ball.y - other.y;
  const gap = Math.hypot(dx, dy);
  const reach = BALL_RADIUS * 2;
  if (gap >= reach) return;
  if (gap > 1e-9) {
    ball.x = other.x + (dx / gap) * reach;
    ball.y = other.y + (dy / gap) * reach;
    return;
  }
  // Exactly coincident: push out along the line from the cup to the spot, which is a
  // direction both seats derive the same way and which the half-turn carries over.
  const outX = spotXOf(seat) - CENTRE_X;
  const outY = spotYOf(seat) - CENTRE_Y;
  const span = Math.hypot(outX, outY);
  ball.x = other.x + (outX / span) * reach;
  ball.y = other.y + (outY / span) * reach;
}

/**
 * Points, then goals from range, then the range those goals were holed from, then a draw.
 *
 * The primary comparison is the SDK's, told the clock has expired, so "highest score at the
 * end" means here what it means in every other game. Everything below it says one thing in
 * finer and finer terms — **the same score off longer goals wins** — and every level of it
 * is time-symmetric, so neither seat gains anything from kicking last. That last property
 * is what ruled out the tiebreak this game wanted to have, which was "whose ball finished
 * nearer the cup": a real golf idea, almost never tied, and it hands the match to whoever
 * kicked most recently.
 *
 * Three levels rather than two, because the middle one is coarse and it was measured. On
 * the score alone two `hard` seats finish level 15.5% of the time, and the tiebreak counting
 * goals from range shifts that to 15.3% — **the tiebreak is very nearly the score again**.
 * With `p = 3a + 2b + c` fixed, `a` is pinned by the same arithmetic that pins `p` far more
 * often than it looks as though it should be. The summed range is the continuous form of the
 * same idea and it does the work the counted form could not: 15.3% becomes 0.00% over 1000
 * `hard` matches, so a draw now means the two of them really did play the same match.
 */
export function settleMatch(match: Match): void {
  match.phase = 'over';
  const byPoints = resolve(WIN_CONDITION, match.points, { timeExpired: true });
  if (byPoints !== null && byPoints !== 'draw') {
    match.winner = byPoints;
    return;
  }
  if (match.rangeGoals.p1 !== match.rangeGoals.p2) {
    match.winner = match.rangeGoals.p1 > match.rangeGoals.p2 ? 'p1' : 'p2';
    return;
  }
  if (match.holedRange.p1 !== match.holedRange.p2) {
    match.winner = match.holedRange.p1 > match.holedRange.p2 ? 'p1' : 'p2';
    return;
  }
  match.winner = 'draw';
}

export function winnerOf(match: Readonly<Match>): Outcome {
  return match.winner;
}

/** Kicks this seat has left, for the scoreboard. */
export function kicksLeftOf(match: Readonly<Match>, seat: SeatId): number {
  const left = KICKS_EACH - match.kicksBy[seat];
  return left > 0 ? left : 0;
}

/* ------------------------------------------------------------------ the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the moment it meant to press it actually presses, in seconds. */
  readonly timing: number;
  /** How far past the cup it tries to leave the ball. Over `CAPTURE_OVERRUN` it will not drop. */
  readonly overshoot: number;
  /** How often one of the two presses is an outright fumble. */
  readonly blunder: number;
}

/**
 * Three tiers, measured rather than chosen. `SPEC.md` carries the full table.
 *
 * They differ in three things a person differs in — how accurately they hit the moment they
 * meant to, how far past the hole they try to leave the ball, and how often they simply get
 * it wrong — and in nothing else. Every tier reads the same pitch a player reads: the ball,
 * the cup, the two posts and the other ball, all of them drawn on the screen (rule 6).
 *
 * `overshoot` is the lever that reads as skill. A ball can be at most
 * {@link CAPTURE_OVERRUN} — 47.6 units — past the cup and still drop, so `easy` is
 * deliberately on the wrong side of that line: it batters the ball at the goal and it runs
 * through, which is what a bad player does.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.26, overshoot: 66, blunder: 0.2 },
  normal: { timing: 0.18, overshoot: 44, blunder: 0.09 },
  hard: { timing: 0.126, overshoot: 28, blunder: 0.03 },
});

/** How much larger a fumbled press's error is than the tier's ordinary one. */
export const BLUNDER_SCALE = 5;

/**
 * Lines the bot looks along, across the whole gauge.
 *
 * Odd, so that offset zero — straight at the cup — is one of them, and generated as
 * `(i − MID) · AIM_STEP` so that the sample at `MID − k` is the exact negation of the one at
 * `MID + k`. That is not pedantry: with the ball on the centre line the two ways round a post
 * are an everyday tie, and a tie broken by a last-bit difference between `+φ` and `−φ` is
 * exactly the mirror-symmetry defect Snowball Throw shipped. Exact negation makes the tie
 * exact, the first index wins it, and both seats therefore choose mirrored lines.
 */
export const AIM_SAMPLES = 61;
const AIM_MID = (AIM_SAMPLES - 1) / 2;
const AIM_STEP = (2 * AIM_SWEEP) / (AIM_SAMPLES - 1);

/** The offset of the `index`th line the bot considers. */
export function aimSampleAt(index: number): number {
  return (index - AIM_MID) * AIM_STEP;
}

export type BotStage = 'plan' | 'line' | 'weight';

export interface BotState {
  /**
   * The line it wants, as a needle offset in radians, and the weight it wants, as a fraction
   * of the gauge.
   *
   * Two fields and not one. They are quantities in different units — a needle offset against
   * a gauge fraction — and Cup Pong's most expensive bug was one `want` shared between two
   * presses, which stopped the second dial at the first one's number. Both are cleared on
   * the press that consumes them, and `stage` is the other half of the guard.
   */
  wantAim: number;
  wantPower: number;
  /** Seconds of error committed to for each press, drawn separately: two presses, two hands. */
  aimOffset: number;
  powerOffset: number;
  /** Seconds left before the press it has already committed to. */
  lineTimer: number;
  weightTimer: number;
  stage: BotStage;
}

export function createBotState(): BotState {
  return {
    wantAim: 0,
    wantPower: 0,
    aimOffset: 0,
    powerOffset: 0,
    lineTimer: 0,
    weightTimer: 0,
    stage: 'plan',
  };
}

export function resetBotState(state: BotState): void {
  state.wantAim = 0;
  state.wantPower = 0;
  state.aimOffset = 0;
  state.powerOffset = 0;
  state.lineTimer = 0;
  state.weightTimer = 0;
  state.stage = 'plan';
}

/**
 * One generator per seat, both drawn from the match's own before anything else touches it.
 *
 * In this game the two seats are genuinely coupled — a kick moves the other player's ball —
 * so a shared stream is not merely untidy: the number of values one seat has drawn would
 * depend on how many kicks the match has taken, and the two seats would trade residues the
 * moment anything about the draw count changed. A generator each makes a seat's play a
 * function of its own seed and nothing else, and `rules.test.ts` asserts that a seat plays
 * the identical kicks against an `easy` opponent and against a `hard` one.
 */
export function createBotRngs(source: Rng): { p1: Rng; p2: Rng } {
  return { p1: new Rng(source.next() | 0), p2: new Rng(source.next() | 0) };
}

/**
 * Values a bot draws per kick. Always exactly this many, drawn before anything branches.
 *
 * The other half of the guarantee above: a draw count that depended on what the bot decided
 * would make one seat's stream a function of the other's play even with a generator each,
 * because the two seats read the same pitch.
 */
export const BOT_DRAWS_PER_KICK = 6;

/**
 * How far the bot may be from the cup's centre line and still call the line clear.
 *
 * The same number a player uses: the ball has to fit through the gate, so a line whose
 * closest approach to a post is under a ball-and-a-post is one that will hit it.
 */
const CLEARANCE = BALL_RADIUS + POST_RADIUS;

/** Penalty added to a line the ball cannot travel down. Bigger than the pitch, so it loses. */
const BLOCKED_PENALTY = 4000;

/**
 * Choose the kick, once, at the start of a turn.
 *
 * It does what a player does with the same picture: it looks along every line the needle can
 * stop on, throws away the ones that run into a post or into the other ball before they get
 * to the cup, and takes the one that passes nearest the middle of the cup. The weight is then
 * the distance along that line to the cup plus the tier's overshoot, converted through
 * `powerForReach` — the exact inverse of the law {@link step} integrates, so the bot is aiming
 * at the pitch it is actually playing on.
 *
 * If nothing is clear it plays the straightest line anyway and takes what the carom gives it,
 * which is also what a player does. Deliberately no bank-shot search: a bot that could bank
 * off a board would be reading a rebound a person has to guess at.
 */
export function planKick(
  match: Readonly<Match>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
  rng: Rng,
): void {
  // Six values, drawn unconditionally and before anything branches. See BOT_DRAWS_PER_KICK.
  const aimRollA = rng.float();
  const aimRollB = rng.float();
  const powerRollA = rng.float();
  const powerRollB = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  const ball = seat === 'p1' ? match.p1 : match.p2;
  const rival = seat === 'p1' ? match.p2 : match.p1;
  const toCupX = CENTRE_X - ball.x;
  const toCupY = CENTRE_Y - ball.y;
  const range = Math.hypot(toCupX, toCupY);
  const base = Math.atan2(toCupY, toCupX);

  let bestIndex = AIM_MID;
  let bestScore = Infinity;
  let bestAlong = range;
  for (let i = 0; i < AIM_SAMPLES; i += 1) {
    const angle = base + aimSampleAt(i);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // Along the line to the cup's closest point, and how far off the middle it passes.
    const along = toCupX * dx + toCupY * dy;
    const offSq = range * range - along * along;
    const miss = offSq > 0 ? Math.sqrt(offSq) : 0;
    let score = miss;
    if (along <= 0) score += BLOCKED_PENALTY;
    if (blockedBefore(ball.x, ball.y, dx, dy, along, rival)) score += BLOCKED_PENALTY;
    if (score >= bestScore) continue;
    bestScore = score;
    bestIndex = i;
    bestAlong = along;
  }

  state.wantAim = aimSampleAt(bestIndex);
  const wanted = (bestAlong > 0 ? bestAlong : range) + profile.overshoot;
  state.wantPower = powerForReach(wanted);

  // Two draws a dial, summed, so the press error is triangular rather than flat: most presses
  // land near the mark and a bad one is rare, which is the better picture of a person.
  //
  // Being honest about how much that is worth, because it was measured and the answer was
  // smaller than expected. Cup Pong reports a flat error leaving its ladder nowhere to stand;
  // on this pitch a flat error of the same half-width makes 51.1%, 40.5% and 27.5% of kicks
  // at the three shipped timings against the triangular 65.9%, 54.2% and 40.8%. Both are
  // workable ladders. Triangular is kept because it is the truer model and because it puts
  // the tiers on a flatter part of the curve, not because the alternative was unusable.
  state.aimOffset = (aimRollA + aimRollB - 1) * profile.timing;
  state.powerOffset = (powerRollA + powerRollB - 1) * profile.timing;
  if (blunderRoll < profile.blunder) {
    // One roll decides both which press is fumbled and by how much — the low bit picks the
    // dial, the rest the size — so a fumble costs the same one draw as no fumble at all.
    const slip = (((blunderSize * 2) % 1) * 2 - 1) * profile.timing * BLUNDER_SCALE;
    if (blunderSize < 0.5) state.aimOffset += slip;
    else state.powerOffset += slip;
  }

  // The needle starts parked at `-AIM_SWEEP` and rises, so the moment it will be at a wanted
  // value is arithmetic rather than a search — and committing to a *moment* rather than to a
  // position is what stops the bot deadlocking. See `driveBot`.
  state.lineTimer = (state.wantAim + AIM_SWEEP) / AIM_RATE + state.aimOffset;
  state.stage = 'line';
}

/**
 * Whether anything solid stands on this line before the cup.
 *
 * The two posts and the other ball, each grown by a ball radius, tested as a ray against a
 * circle. Nothing about bounces: a line that hits a post is off, whatever the post then does
 * with it, because a player cannot read that rebound either.
 */
function blockedBefore(
  x: number,
  y: number,
  dx: number,
  dy: number,
  limit: number,
  rival: Readonly<Ball>,
): boolean {
  for (let i = 0; i < POSTS.length; i += 1) {
    const post = POSTS[i];
    if (post === undefined) continue;
    if (rayHitsCircle(x, y, dx, dy, post.x, post.y, CLEARANCE, limit)) return true;
  }
  return rayHitsCircle(x, y, dx, dy, rival.x, rival.y, BALL_RADIUS * 2, limit);
}

/** The first `t` in `(0, limit)` at which a unit ray comes within `radius` of a point. */
function rayHitsCircle(
  x: number,
  y: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  radius: number,
  limit: number,
): boolean {
  const toX = cx - x;
  const toY = cy - y;
  const along = toX * dx + toY * dy;
  const gapSq = toX * toX + toY * toY - radius * radius;
  const under = along * along - gapSq;
  if (under < 0) return false;
  const enter = along - Math.sqrt(under);
  return enter > 0 && enter < limit;
}

/**
 * Run a bot for one step: plan if it has not, then press when the moment it chose arrives.
 *
 * **It counts down to a moment; it does not watch for a position.** Watching for a position is
 * the obvious way to write this and it hangs: the error is added in whichever direction the
 * needle is currently going, so an error larger than the gauge is out of reach *both* ways —
 * the needle turns round at the end of its sweep and the wanted value turns round with it, and
 * the two never meet. Cup Pong went into exactly that on seed 2 of its very first harness run.
 * A countdown cannot fail to expire, and it is the more honest model anyway: a person commits
 * to a moment, and pressing late enough that the needle has turned round is a real way to miss.
 *
 * One entry point rather than a plan call and a press call, because the two have to agree
 * about the stage, and a caller that got the order wrong would look like a tuning problem
 * rather than a bug.
 *
 * It takes a {@link BotProfile} rather than a tier name so that a single knob can be swept
 * on its own with everything else left as shipped. Three of the first six games in this
 * catalogue deleted a knob after measuring it — one that was flat, one that ran backwards,
 * one that changed sign across the ladder — and none of those measurements is possible
 * against a frozen table looked up by name.
 */
export function driveBot(
  match: Match,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (match.seat !== seat) return false;

  if (match.phase === 'aiming' && state.stage === 'plan') {
    planKick(match, seat, profile, state, rng);
  }

  if (match.phase === 'aiming' && state.stage === 'line') {
    if (state.lineTimer > fixedDeltaSeconds / 2) {
      state.lineTimer -= fixedDeltaSeconds;
      return false;
    }
    // The weight gauge takes its first step in the same step this press is taken, so its
    // clock starts one step ahead of the line's.
    state.weightTimer = state.wantPower / POWER_RATE + state.powerOffset - fixedDeltaSeconds;
    // Cleared on the press. `wantAim` is radians and `weightTimer` above divides a gauge
    // fraction by a gauge rate; leaving the line's answer standing in a field the weight
    // press reads is how the second dial ends up stopped at the first one's number.
    state.wantAim = 0;
    state.aimOffset = 0;
    state.lineTimer = 0;
    state.stage = 'weight';
    return pressAim(match, seat);
  }

  if (match.phase === 'winding' && state.stage === 'weight') {
    if (state.weightTimer > fixedDeltaSeconds / 2) {
      state.weightTimer -= fixedDeltaSeconds;
      return false;
    }
    state.wantPower = 0;
    state.powerOffset = 0;
    state.weightTimer = 0;
    state.stage = 'plan';
    return release(match, seat);
  }

  // The turn has moved on without this bot pressing — a deadline fired, or the ball is
  // rolling. Either way its plan is spent and the next turn starts a fresh one.
  if (match.phase !== 'aiming' && match.phase !== 'winding' && state.stage !== 'plan') {
    resetBotState(state);
  }
  return false;
}
