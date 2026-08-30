import { circleCircle, circleSegment, createContact, otherSeat } from '@duelbox/engine';
import type { Circle, Rng, Segment, SeatId } from '@duelbox/engine';

/**
 * Pinball Duel, as pure rules: one ball, one table, and two flippers at each end of it.
 *
 * No rendering, no wall clock, no DOM. The game, the bot and the balance harness all drive
 * this same file, so what the harness measures is what a player feels.
 *
 * Every length is a logical unit and every speed a logical unit per second (rule 8). p1
 * defends the bottom mouth (y = height) and p2 the top (y = 0), matching the horizontal
 * zone split the manifest declares and the split `GameHost` actually gives an `rt-*` game.
 *
 * **The whole table is its own picture upside down.** Every wall segment has a partner at
 * (width - x, height - y), the two bumper pairs are each other's image, the centre bumper
 * is its own image, and the two serve spots are each other's image with exactly negated
 * velocities. Neither seat is ever handed the easier end, and `rules.test.ts` asserts each
 * of those separately rather than trusting the arithmetic here.
 *
 * A flipper's `side` is always **screen** left or right, never "the left one as you sit":
 * the geometry, the renderer and the bot all work in the table's own frame, so the half-turn
 * mirror swaps the side as well as the seat and `flipperIndex` names a fixed slot in the
 * match's phase array. Nothing about that changes per seat, and it must not — the four
 * flippers are four places on one shared table.
 *
 * **Which flipper a press means is a different question, and it is answered in the pressing
 * seat's own frame.** This table never rotates: the renderer pushes no seat rotation, both
 * ends are drawn at once, and the far seat therefore reads the picture upside down — the
 * flipper it sees on its left hand is the screen-**right** one. See {@link wantsFlipper} for
 * how the two instruments differ on that, and why only one of them needed mapping.
 */

export interface Table {
  readonly width: number;
  readonly height: number;
}

/**
 * Portrait, because two people share one phone held upright with one end each.
 *
 * 600 wide is chosen against the goal mouth rather than copied: the mouth spans the 380
 * units between the two posts, 63% of the width, and the gap the resting flippers leave in
 * the middle of it is 178 units of clear ball travel — 30% of the table. Wider than 600 and
 * a raised flipper cannot reach across its own half of the mouth; narrower and the gap stops
 * being a target worth aiming at. 960 tall is a 163-unit flipper zone at each end, the
 * 222-unit shoulder above each of those, and the 190 units of full-width table between them.
 */
export const TABLE: Table = { width: 600, height: 960 };

export const CENTRE_X = TABLE.width / 2;
export const CENTRE_Y = TABLE.height / 2;

export const BALL_RADIUS = 14;

/**
 * How far from the centre line each goal post stands; the mouth is the span between them.
 *
 * 190 makes the mouth 380 units, 63% of the table, and that is deliberately most of the end:
 * a ball arriving anywhere in it meets a flipper or drains, so nearly every arrival is a
 * decision rather than a bounce off a dead wall. The 110 units of baseline outside each post
 * is the alcove a ball can be banked into, and is the only part of an end nothing guards.
 */
export const GOAL_HALF_WIDTH = 190;

/**
 * How far up the rails the two shoulder walls reach, measured from a seat's own baseline.
 *
 * The number that decides whether this table works at all, and the one it first got wrong.
 * A shoulder runs from the rail down to a flipper pivot, so it drops 222 units across 110 —
 * **steeper than 45 degrees, and that is the whole requirement**. Reflect a ball travelling
 * straight down the table off a wall whose horizontal run exceeds its drop and it comes back
 * up: with no gravity behind it, a funnel is a wall that repels the ball from the end it is
 * meant to feed.
 *
 * The first build ran them at 34 degrees, which is the wrong side of that line. Measured over
 * sixty bot matches, moving them to 63.6 degrees took goals a match from 6.2, 5.5 and 2.7 at
 * the three tiers to 7.4, 6.9 and 3.8, and stalemate re-serves from 1.7, 2.2 and 3.1 a match
 * down to 0.7, 1.2 and 2.6. A ball falling straight down the shipped shoulder keeps 0.65 of
 * its downward travel and is pushed in towards the mouth; `rules.test.ts` asserts that sign
 * rather than trusting the arithmetic here.
 */
export const SHOULDER_RISE = 385;

export const FLIPPER_PIVOT_DX = GOAL_HALF_WIDTH;
/**
 * How far a flipper's pivot sits from its own baseline: exactly far enough that a resting
 * flipper's tip lands 9.7 units above the baseline, which is less than the 23 a ball needs to
 * slip underneath. A resting flipper therefore seals against its own baseline, and the only
 * way past a resting pair is the gap between their two tips.
 */
export const FLIPPER_PIVOT_INSET = 163;
/**
 * How long a flipper is.
 *
 * Set by the one requirement that decides whether this game has a defence: a **raised**
 * flipper must reach past the middle of the mouth. 172 puts the raised tip at x = 281.8, and
 * a ball needs its centre 23 units clear of that, so a raised left flipper covers every
 * arrival up to 304.8 — 4.8 units past the middle. Each flipper alone covers slightly more
 * than its own half of the mouth, the pair covers all of it, and a seat may raise only one at
 * a time. Picking the right one is the whole of the defending skill.
 */
export const FLIPPER_LENGTH = 172;
export const FLIPPER_RADIUS = 9;

/**
 * The angle a resting flipper makes with the inward horizontal, in radians.
 *
 * 1.1 rad (63 degrees) is not a look, it is the drain. Together with the swing it fixes both
 * ends of the flipper's travel: a resting pair leaves 206 units of clear gap between their
 * tips down the middle of the mouth — 178 of it passable by a ball centre — and a raised one
 * reaches in past the centre line. The ratio of the two is cos(1.1) to cos(0.05), so a
 * resting tip sits at 45% of the raised reach and the drain cannot be tuned independently of
 * the cover.
 */
export const FLIPPER_REST_ANGLE = 1.1;

/**
 * How far a flipper travels when it is fired, in radians.
 *
 * 1.05 leaves a raised flipper at 0.05 rad — all but flat, so almost the whole of its length
 * is reaching across the mouth rather than down it. See {@link FLIPPER_LENGTH} for what that
 * reach has to be worth.
 */
export const FLIPPER_SWING = 1.05;

/** Seconds a flipper takes to travel its full swing, up and back down. */
export const FLIPPER_RISE_SECONDS = 0.075;
export const FLIPPER_FALL_SECONDS = 0.11;

/**
 * What a ball keeps of its approach speed when it meets a flipper that is not moving.
 *
 * Half, so a flipper you left up is a wall that kills the ball rather than a free return.
 * A flipper caught mid-swing adds its own surface velocity instead, which at the tip is
 * 2408 units a second — the difference between a dead bounce and a shot is entirely timing.
 */
export const FLIPPER_RESTITUTION = 0.5;

/** Bumper contact multiplies the ball's speed by this, then re-clamps it. */
export const BUMPER_GAIN = 1.12;

/**
 * The least vertical a ball may travel after a bumper, as a fraction of its speed.
 *
 * A ball sent flat across the table by a bumper can never reach either mouth: it bounces
 * between the two side rails and the match becomes a clock. 0.22 costs nothing anybody can
 * feel — the shallowest face a flipper can present is a resting one, whose normal is already
 * 0.45 vertical — and removes the position outright rather than leaving the stalemate timer
 * to notice it.
 */
export const MIN_VERTICAL_FRACTION = 0.22;

/**
 * Ball speed bounds, in units a second.
 *
 * The ceiling is set by the substep, not by taste: 900 / 240 is 3.75 units of travel in one
 * substep against a 23-unit contact distance, so nothing can pass through a flipper or a
 * wall between two discrete tests. The floor keeps a ball that has been killed by two
 * resting flippers moving, so no rally can quietly stop.
 */
export const MIN_BALL_SPEED = 300;
export const MAX_BALL_SPEED = 900;

/**
 * Passes of the ball solver inside one fixed step.
 *
 * A flipper tip travels 2408 units a second and a ball up to 900, so head-on they close
 * 55.1 units in a 60 Hz step against a 23-unit contact distance — a fired flipper would pass
 * straight through a ball rather than hit it. Four passes puts the worst closing at 13.78
 * units a pass, inside contact with room to spare. The flippers advance on the same substep
 * as the ball, so the surface velocity a contact reads is the one it actually travelled at.
 */
export const SUBSTEPS = 4;

export const SERVE_SPEED = 520;
/** Half-angle of the serve, in radians: about 29 degrees either side of straight. */
export const SERVE_SPREAD = 0.5;
/** How far the two serve spots sit either side of the middle of the table. */
export const SERVE_OFFSET_X = 60;
export const SERVE_OFFSET_Y = 60;

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** Screen left or screen right, never seat-relative. See the note at the top of this file. */
export type FlipperSide = 'left' | 'right';

/** Which seat SCORED, i.e. the one whose mouth was NOT crossed. */
export type GoalResult = 'none' | 'p1' | 'p2';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Bumper {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * The five bumpers, as two half-turn pairs and one self-image at the middle of the table.
 *
 * An odd count needs a bumper at the exact centre, which is why the serve spots are offset
 * from it rather than on it — the two spots are each other's image, so putting the ball on
 * one of them costs neither seat anything.
 */
export const BUMPERS: readonly Bumper[] = [
  { x: CENTRE_X, y: CENTRE_Y, radius: 42 },
  { x: CENTRE_X, y: CENTRE_Y - 190, radius: 32 },
  { x: CENTRE_X, y: CENTRE_Y + 190, radius: 32 },
  { x: CENTRE_X - 154, y: CENTRE_Y, radius: 32 },
  { x: CENTRE_X + 154, y: CENTRE_Y, radius: 32 },
];

interface BotProfile {
  /** Seconds of stale information the bot acts on. Never negative: it never sees ahead. */
  readonly reactionSeconds: number;
  /** Seconds of noise on when it fires. The whole of a flipper's skill is when. */
  readonly timingError: number;
  /** Logical units of noise on where it thinks the ball is arriving, so it picks wrong. */
  readonly aimError: number;
}

/**
 * Difficulty is reaction delay, firing-time noise and arrival-place noise, and nothing
 * else. Every tier reads the one ball a player reads off the same screen, none of them is
 * told what the ball will do after it meets a bumper, and **no tier's flipper moves faster
 * than a human's** — there is only one {@link FLIPPER_RISE_SECONDS} (rule 6).
 */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { reactionSeconds: 0.28, timingError: 0.105, aimError: 130 },
  normal: { reactionSeconds: 0.17, timingError: 0.06, aimError: 74 },
  hard: { reactionSeconds: 0.12, timingError: 0.04, aimError: 48 },
};

/**
 * How far in front of the pivot the bot predicts the ball's arrival, along its own axis.
 *
 * Re-derived for this table rather than borrowed: a flipper tip sweeps from 153.3 units past
 * its pivot up to 8.6, so 81 is the middle of the 145-unit band a contact can actually happen
 * in. A number taken from a game with a differently shaped end would aim the bot at a line its
 * own flippers never reach.
 */
export const BOT_AIM_OFFSET = 81;

/** Seconds before arrival the bot starts its swing: exactly one flipper rise. */
export const BOT_FIRE_LEAD = FLIPPER_RISE_SECONDS;

/** What one bot seat remembers between steps. One draw per approach, not one per step. */
export interface BotMemory {
  /** Firing-time noise held for the whole of one approach, so the jitter is not resampled. */
  noise: number;
  /** Place noise, likewise held: a bot that re-rolled it would average away its own error. */
  drift: number;
  /** Whether the ball was coming this way on the previous step. */
  approaching: boolean;
}

export function createBotMemory(): BotMemory {
  return { noise: 0, drift: 0, approaching: false };
}

/** Scratch shapes, at module scope so a step allocates nothing. */
const contact = createContact();
const ballShape: Circle = { x: 0, y: 0, radius: BALL_RADIUS };
const bumperShape: Circle = { x: 0, y: 0, radius: 0 };

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Mirror `value` back and forth into [min, max], which is what a straight line does when it
 * bounces between two parallel rails. The bot predicts with it; nothing else does.
 *
 * Lifted from Brick Blast, where it does the same job for the same reason. It carries no
 * constant of its own, so there is nothing here to have inherited the wrong number.
 */
export function foldIntoBand(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return min;
  const period = span * 2;
  let t = (value - min) % period;
  if (t < 0) t += period;
  return t <= span ? min + t : min + (period - t);
}

function segment(x1: number, y1: number, x2: number, y2: number): Segment {
  return { x1, y1, x2, y2 };
}

/**
 * Every static wall of the table, built once at module load and never written to.
 *
 * Read the list as three half-turn pairs and one pair of rails.
 *
 * **The rails are vertical for their whole length**, and the only walls that lean are the
 * four shoulders, which lean steeply — see {@link SHOULDER_RISE} for why the angle is the one
 * shape decision on this table that can quietly break it.
 *
 * The shoulder, the post, the stretch of baseline outside it and the rail together seal the
 * alcove behind each flipper completely, so a ball can never arrive in a corner nothing can
 * reach it in — and, more to the point, can never spend twenty seconds bouncing up and down a
 * rail between two dead stretches of baseline. With the alcoves open that cost between one
 * and a half and three and a quarter stalemate re-serves in every match.
 */
export const WALLS: readonly Segment[] = [
  // Side rails, the full height of the table.
  segment(0, 0, 0, TABLE.height),
  segment(TABLE.width, 0, TABLE.width, TABLE.height),
  // p1's baseline, either side of its mouth.
  segment(0, TABLE.height, CENTRE_X - GOAL_HALF_WIDTH, TABLE.height),
  segment(CENTRE_X + GOAL_HALF_WIDTH, TABLE.height, TABLE.width, TABLE.height),
  // p2's baseline, the half-turn image of p1's.
  segment(0, 0, CENTRE_X - GOAL_HALF_WIDTH, 0),
  segment(CENTRE_X + GOAL_HALF_WIDTH, 0, TABLE.width, 0),
  // The shoulders, which seal the alcove behind each flipper and turn a ball coming down a
  // rail in towards the mouth rather than back up the table.
  segment(
    0,
    TABLE.height - SHOULDER_RISE,
    CENTRE_X - GOAL_HALF_WIDTH,
    TABLE.height - FLIPPER_PIVOT_INSET,
  ),
  segment(
    TABLE.width,
    TABLE.height - SHOULDER_RISE,
    CENTRE_X + GOAL_HALF_WIDTH,
    TABLE.height - FLIPPER_PIVOT_INSET,
  ),
  segment(0, SHOULDER_RISE, CENTRE_X - GOAL_HALF_WIDTH, FLIPPER_PIVOT_INSET),
  segment(TABLE.width, SHOULDER_RISE, CENTRE_X + GOAL_HALF_WIDTH, FLIPPER_PIVOT_INSET),
  // The four posts, from each pivot straight down to its own baseline.
  segment(
    CENTRE_X - GOAL_HALF_WIDTH,
    TABLE.height - FLIPPER_PIVOT_INSET,
    CENTRE_X - GOAL_HALF_WIDTH,
    TABLE.height,
  ),
  segment(
    CENTRE_X + GOAL_HALF_WIDTH,
    TABLE.height - FLIPPER_PIVOT_INSET,
    CENTRE_X + GOAL_HALF_WIDTH,
    TABLE.height,
  ),
  segment(CENTRE_X - GOAL_HALF_WIDTH, FLIPPER_PIVOT_INSET, CENTRE_X - GOAL_HALF_WIDTH, 0),
  segment(CENTRE_X + GOAL_HALF_WIDTH, FLIPPER_PIVOT_INSET, CENTRE_X + GOAL_HALF_WIDTH, 0),
];

export const FLIPPER_COUNT = 4;

/**
 * Index into the flat phase and rate arrays a match keeps: p1 left, p1 right, p2 left, p2 right.
 *
 * Screen sides, and deliberately so: this names a place on the table, and the same slot has to
 * mean the same flipper to the solver, the renderer, the bot and both seats' inputs. Turning
 * it per seat would rotate the *table* rather than the question being asked of it, and the
 * bot — which reads a ball position and answers with a side — would start defending the wrong
 * post. It is {@link wantsFlipper} that works in a seat's frame, and it hands its answer back
 * here as a screen side.
 */
export function flipperIndex(seat: SeatId, side: FlipperSide): number {
  return (seat === 'p1' ? 0 : 2) + (side === 'left' ? 0 : 1);
}

export function flipperSeatOf(index: number): SeatId {
  return index < 2 ? 'p1' : 'p2';
}

export function flipperSideOf(index: number): FlipperSide {
  return index % 2 === 0 ? 'left' : 'right';
}

export function otherSide(side: FlipperSide): FlipperSide {
  return side === 'left' ? 'right' : 'left';
}

/**
 * The hand a seat sees a screen side on: its own left is the screen's right when it is
 * reading the table upside down.
 *
 * `rotated` is `seatView(seat, presentation, localSeat).rotated` — the engine's one
 * definition of that, and the same flag `toWorld` takes. A half-turn is its own inverse, so
 * this one function maps a screen side into a seat's frame and a seat's side back out to the
 * screen, exactly as `toWorld` and `toScreen` share a mapping for a position.
 */
export function seatSide(side: FlipperSide, rotated: boolean): FlipperSide {
  return rotated ? otherSide(side) : side;
}

/** +1 for the screen-left flipper, -1 for the screen-right one. */
function sideSign(side: FlipperSide): number {
  return side === 'left' ? 1 : -1;
}

/** +1 for the seat defending the bottom, -1 for the seat defending the top. */
function seatSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export function flipperPivotX(side: FlipperSide): number {
  return CENTRE_X - sideSign(side) * FLIPPER_PIVOT_DX;
}

export function flipperPivotY(seat: SeatId): number {
  return seat === 'p1' ? TABLE.height - FLIPPER_PIVOT_INSET : FLIPPER_PIVOT_INSET;
}

/** The angle of a flipper at `phase`, 0 at rest and 1 fully raised. */
export function flipperAngle(phase: number): number {
  return FLIPPER_REST_ANGLE - phase * FLIPPER_SWING;
}

export function flipperTipX(side: FlipperSide, phase: number): number {
  return flipperPivotX(side) + sideSign(side) * Math.cos(flipperAngle(phase)) * FLIPPER_LENGTH;
}

/** The two sides are each other's reflection in the centre line, so the tip's y is shared. */
export function flipperTipY(seat: SeatId, phase: number): number {
  return flipperPivotY(seat) + seatSign(seat) * Math.sin(flipperAngle(phase)) * FLIPPER_LENGTH;
}

/** The flipper's line, written into `out`. Allocates nothing, so a step may call it freely. */
export function flipperSegment(
  seat: SeatId,
  side: FlipperSide,
  phase: number,
  out: Segment,
): Segment {
  out.x1 = flipperPivotX(side);
  out.y1 = flipperPivotY(seat);
  out.x2 = flipperTipX(side, phase);
  out.y2 = flipperTipY(seat, phase);
  return out;
}

/**
 * Where a flipper's phase goes in `dt`, clamped to its travel.
 *
 * Rise and fall are different rates because a flipper is thrown up and falls back: 0.075 s
 * up against 0.11 s down. Both are counted from the phase actually reached rather than from
 * a target, so a key tapped for one step moves the flipper exactly one step's worth.
 */
export function nextFlipperPhase(phase: number, up: boolean, dt: number): number {
  const rate = up ? 1 / FLIPPER_RISE_SECONDS : -1 / FLIPPER_FALL_SECONDS;
  return clamp(phase + rate * dt, 0, 1);
}

/**
 * The phase rate a contact should read, taken from the travel that actually happened.
 *
 * Not `1 / FLIPPER_RISE_SECONDS`: a flipper already at the top of its swing has stopped, and
 * a contact must read zero surface velocity there or a parked flipper would launch a ball as
 * hard as a swinging one. Deriving it from the displacement makes the two agree by
 * construction.
 */
export function flipperPhaseRate(phase: number, next: number, dt: number): number {
  return dt > 0 ? (next - phase) / dt : 0;
}

/**
 * Whether a seat is asking for the flipper on screen-`side`, from either input source.
 *
 * A key names a direction and a finger names a place, and both name the same flipper: the two
 * are OR-ed rather than switched between, so there is no mode and a player may use both at
 * once. `pointerX` is null when this seat has no finger down, and is in device space, which is
 * the frame `InputManager` reports in.
 *
 * **`rotated` is what makes the two seats the same game.** Pass
 * `seatView(seat, presentation, localSeat).rotated` for the seat doing the pressing: true when
 * that person is reading the device upside down. *Which flipper does this press mean* is a
 * seat-space question — the answer has to be the flipper that player can see under their own
 * hand — so it is decided in seat space and mapped back to a screen side at the end, the way
 * `toWorld` maps a tap before anything decides what was touched. The two instruments need
 * different amounts of that mapping, and the difference is not an inconsistency:
 *
 * - **A key already names the seat's own direction.** That is the engine's stated contract:
 *   `GridCursor.step` documents `moveX` as "the seat's direction vector, in the *player's*
 *   frame". So a negative axis is that player's left whichever end of the table they sit at,
 *   and only the side it picks has to be turned back into a screen side. Without that the far
 *   seat's arrows raised the flipper on its other hand, which is the defect this closes.
 * - **A finger is a place, and a place is in device space**, so it is mapped into the seat's
 *   frame first. That mapping and the mapping of the side back out cancel exactly — which is
 *   why the pointer behaves as it always did and why it was already right. Touch the half of
 *   the glass on your left and the flipper on your left comes up, because a flipper's place
 *   mirrors along with the finger's. Whack-a-Mole draws the same distinction on the same
 *   ground: on a board drawn in one orientation its keys mirror and its taps do not.
 *
 * The one thing that does move for the far seat's pointer is the tie-break. A finger exactly
 * on the centre line now raises that seat's own **right** flipper rather than the screen-right
 * one, so the tie-break commutes with the half-turn like every other one on this table (see
 * {@link enforceVertical}) instead of quietly handing the two seats different hands.
 *
 * A seat can raise **one** flipper at a time and that is the same for both instruments: the
 * engine sums the two direction keys into one axis, so A and D together read as neither, and
 * a seat reports one pointer position however many fingers are on the glass. Being an equal
 * limit on both is what keeps it fair rather than a defect in one of them.
 */
export function wantsFlipper(
  side: FlipperSide,
  moveX: number,
  pointerX: number | null,
  rotated: boolean,
): boolean {
  const asked = seatSide(side, rotated);
  const seatPointerX = pointerX !== null && rotated ? TABLE.width - pointerX : pointerX;
  if (asked === 'left') {
    return moveX < 0 || (seatPointerX !== null && seatPointerX < CENTRE_X);
  }
  return moveX > 0 || (seatPointerX !== null && seatPointerX >= CENTRE_X);
}

export function createBall(): Ball {
  return { x: CENTRE_X, y: CENTRE_Y, vx: 0, vy: 0 };
}

export function ballSpeed(ball: Ball): number {
  return Math.hypot(ball.vx, ball.vy);
}

/** Hold the ball's speed inside its bounds, keeping its direction. A still ball stays still. */
export function clampBallSpeed(ball: Ball): void {
  const speed = ballSpeed(ball);
  if (speed <= 0) return;
  const wanted = clamp(speed, MIN_BALL_SPEED, MAX_BALL_SPEED);
  if (wanted === speed) return;
  const scale = wanted / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

/**
 * Keep the ball's travel at least {@link MIN_VERTICAL_FRACTION} vertical.
 *
 * The tie-breaks are chosen so the whole function commutes with the half-turn: a ball with
 * no vertical travel at all is sent by the sign of its horizontal travel, which negates
 * under the mirror, rather than by which half of the table it is in, which does not negate
 * when it is exactly on the halfway line.
 */
export function enforceVertical(ball: Ball): void {
  const speed = ballSpeed(ball);
  if (speed <= 0) return;
  const least = speed * MIN_VERTICAL_FRACTION;
  if (Math.abs(ball.vy) >= least) return;
  const towards = ball.vy < 0 ? -1 : ball.vy > 0 ? 1 : ball.vx < 0 ? -1 : 1;
  const across = Math.sqrt(Math.max(0, speed * speed - least * least));
  ball.vy = least * towards;
  ball.vx = ball.vx < 0 ? -across : across;
}

/**
 * Move the ball for `dt`, with no drag of any kind.
 *
 * There is no gravity either, and that is a decision rather than an omission: a table with
 * two ends cannot be tilted towards one of them without handing that seat the harder half
 * for the whole match. With nothing but constant velocity between contacts the position
 * integral is exact however the step is chopped up, so two substeps of `h` and one of `2h`
 * land on the same numbers and 60 Hz, 90 Hz and 144 Hz step the identical match.
 */
export function stepBall(ball: Ball, dt: number): void {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
}

/** Reflect the ball off one static wall. Returns whether it touched. */
export function collideBallWall(ball: Ball, wall: Segment): boolean {
  ballShape.x = ball.x;
  ballShape.y = ball.y;
  if (!circleSegment(contact, ballShape, wall)) return false;
  ball.x += contact.normalX * contact.depth;
  ball.y += contact.normalY * contact.depth;
  const into = ball.vx * contact.normalX + ball.vy * contact.normalY;
  // A rail is a mirror: nothing is taken and nothing is added, so the only two things that
  // change a ball's speed on this table are a bumper and a flipper.
  if (into < 0) {
    ball.vx -= 2 * into * contact.normalX;
    ball.vy -= 2 * into * contact.normalY;
  }
  return true;
}

/** Reflect the ball off one bumper, speed it up, and keep it travelling up or down the table. */
export function collideBallBumper(ball: Ball, bumper: Bumper): boolean {
  ballShape.x = ball.x;
  ballShape.y = ball.y;
  bumperShape.x = bumper.x;
  bumperShape.y = bumper.y;
  bumperShape.radius = bumper.radius;
  if (!circleCircle(contact, ballShape, bumperShape)) return false;
  ball.x += contact.normalX * contact.depth;
  ball.y += contact.normalY * contact.depth;
  const into = ball.vx * contact.normalX + ball.vy * contact.normalY;
  if (into < 0) {
    ball.vx -= 2 * into * contact.normalX;
    ball.vy -= 2 * into * contact.normalY;
  }
  const speed = ballSpeed(ball);
  if (speed > 0) {
    const scale = clamp(speed * BUMPER_GAIN, MIN_BALL_SPEED, MAX_BALL_SPEED) / speed;
    ball.vx *= scale;
    ball.vy *= scale;
  }
  enforceVertical(ball);
  return true;
}

/**
 * Resolve the ball against one flipper and report whether it touched.
 *
 * The capsule test is written out here rather than handed to `circleSegment` because the
 * distance along the flipper is not a by-product, it is the whole point: the surface at that
 * distance is travelling at `r * angleRate`, so a tip hit throws a ball more than three times
 * as hard as a hit by the pivot. That number is what a player is aiming with.
 *
 * The bounce is resolved in the flipper's own frame — the surface velocity is subtracted,
 * the normal component reflected with {@link FLIPPER_RESTITUTION}, and the surface velocity
 * put back — which is why a flipper that is not moving damps a ball and a flipper caught
 * mid-swing fires it.
 */
export function collideBallFlipper(
  ball: Ball,
  seat: SeatId,
  side: FlipperSide,
  phase: number,
  phaseRate: number,
): boolean {
  const angle = flipperAngle(phase);
  const ss = sideSign(side);
  const ts = seatSign(seat);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pivotX = flipperPivotX(side);
  const pivotY = flipperPivotY(seat);
  const dirX = ss * cos;
  const dirY = ts * sin;

  const alongRaw = (ball.x - pivotX) * dirX + (ball.y - pivotY) * dirY;
  const along = clamp(alongRaw, 0, FLIPPER_LENGTH);
  const nearX = pivotX + dirX * along;
  const nearY = pivotY + dirY * along;

  const reach = BALL_RADIUS + FLIPPER_RADIUS;
  let nx = ball.x - nearX;
  let ny = ball.y - nearY;
  const distSq = nx * nx + ny * ny;
  if (distSq > reach * reach) return false;

  const dist = Math.sqrt(distSq);
  if (dist > 0) {
    nx /= dist;
    ny /= dist;
  } else {
    // Dead centre on the flipper's line, which has no thickness and so no near side. Push
    // out along the flipper's own left perpendicular, always the same one, so a ball on the
    // line cannot flip sides from substep to substep.
    nx = -dirY;
    ny = dirX;
  }
  ball.x = nearX + nx * reach;
  ball.y = nearY + ny * reach;

  const angleRate = -FLIPPER_SWING * phaseRate;
  const surfaceX = along * angleRate * -(ss * sin);
  const surfaceY = along * angleRate * (ts * cos);
  const into = (ball.vx - surfaceX) * nx + (ball.vy - surfaceY) * ny;
  if (into < 0) {
    const impulse = -(1 + FLIPPER_RESTITUTION) * into;
    ball.vx += impulse * nx;
    ball.vy += impulse * ny;
  }
  return true;
}

/** Which seat scored, once the ball has passed a baseline entirely. */
export function goalScored(ball: Ball): GoalResult {
  if (ball.y - BALL_RADIUS > TABLE.height) return 'p2';
  if (ball.y + BALL_RADIUS < 0) return 'p1';
  return 'none';
}

/**
 * Whether the ball has left the table altogether.
 *
 * It cannot, and that is the point: the walls seal every edge except the two mouths, and a
 * ball through a mouth is a goal in the same step. This is the backstop for the case where
 * that stops being true, so a lost ball becomes a re-serve rather than a match nobody can
 * finish. `game.test.ts` asserts the walls hold it across a hundred thousand steps.
 */
export function ballLost(ball: Ball): boolean {
  return (
    ball.x < -TABLE.width ||
    ball.x > TABLE.width * 2 ||
    ball.y < -TABLE.height ||
    ball.y > TABLE.height * 2 ||
    !Number.isFinite(ball.x) ||
    !Number.isFinite(ball.y)
  );
}

/** Where the ball is placed for a serve aimed at `target`. The two spots are each other's image. */
export function serveSpotX(target: SeatId): number {
  return CENTRE_X - seatSign(target) * SERVE_OFFSET_X;
}

export function serveSpotY(target: SeatId): number {
  return CENTRE_Y - seatSign(target) * SERVE_OFFSET_Y;
}

/** Park the ball on its serve spot, at rest. The countdown runs, then it launches. */
export function placeServe(ball: Ball, target: SeatId): void {
  ball.x = serveSpotX(target);
  ball.y = serveSpotY(target);
  ball.vx = 0;
  ball.vy = 0;
}

/**
 * Send the ball at `target` at `angle` off straight.
 *
 * A serve at p2 is the exact negation of the same serve at p1 from the mirrored spot, so
 * the two directions are the same serve seen from the two ends and no angle can favour a
 * seat however it falls.
 */
export function launchServe(ball: Ball, target: SeatId, angle: number): void {
  const sign = seatSign(target);
  ball.vx = Math.sin(angle) * SERVE_SPEED * sign;
  ball.vy = Math.cos(angle) * SERVE_SPEED * sign;
}

/**
 * The y a seat's bot predicts the ball's arrival on: the middle of the band its flippers
 * can actually make contact in.
 */
export function botAimLine(seat: SeatId): number {
  return flipperPivotY(seat) + seatSign(seat) * BOT_AIM_OFFSET;
}

/**
 * Which flipper a bot seat wants raised this step, or 'none'.
 *
 * It reads the one ball's position and velocity and nothing else: no future state, no
 * opponent intent, no knowledge of which bumper the ball is about to meet. It rewinds the
 * ball by its reaction time — acting on where the ball **was** is strictly less information
 * than the person at the other end has, never more — predicts a straight line folded off the
 * side rails, and starts its swing one flipper-rise before arrival.
 *
 * Both noise samples are drawn once per approach and held, in `memory`. Resampling them every
 * step would average the error away and leave three tiers that all fired at the same instant.
 * The generator is advanced on **every** step whether the samples are used or not, so the
 * stream runs at one rate however the match goes.
 */
export function botFlipperSide(
  ball: Ball,
  seat: SeatId,
  difficulty: BotDifficulty,
  memory: BotMemory,
  rng: Rng,
): FlipperSide | 'none' {
  const profile = BOT_PROFILES[difficulty];
  const noiseSample = rng.float() * 2 - 1;
  const driftSample = rng.float() * 2 - 1;

  const towards = seatSign(seat);
  const approaching = ball.vy * towards > 0;
  if (approaching && !memory.approaching) {
    memory.noise = noiseSample * profile.timingError;
    memory.drift = driftSample * profile.aimError;
  }
  memory.approaching = approaching;
  if (!approaching) return 'none';

  const wasX = ball.x - ball.vx * profile.reactionSeconds;
  const wasY = ball.y - ball.vy * profile.reactionSeconds;
  const line = botAimLine(seat);
  const time = (line - wasY) / ball.vy;
  if (time <= 0) return 'none';
  if (time > BOT_FIRE_LEAD + memory.noise) return 'none';

  const arrival = foldIntoBand(
    wasX + ball.vx * time + memory.drift,
    BALL_RADIUS,
    TABLE.width - BALL_RADIUS,
  );
  return arrival < CENTRE_X ? 'left' : 'right';
}

/** The seat that is not `seat`. Re-exported so a caller needs one import for the rules. */
export function opponentOf(seat: SeatId): SeatId {
  return otherSeat(seat);
}
