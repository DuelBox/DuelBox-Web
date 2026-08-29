import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve, resolveSimultaneous } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Sticky Tongues as pure rules: one marsh, eight dragonflies drifting through the middle of
 * it, and a frog on each bank that flicks its tongue out when its player commits.
 *
 * A shot that touches a dragonfly is a catch. A shot that touches nothing is a **wasted
 * shot**, and six of those lose the match. A shot that reaches the far frog is a blow, and
 * knocks it home stunned.
 *
 * No rendering, no wall clock, no DOM. The game, both bots and the balance harness all drive
 * this file, so there is exactly one definition of what a tongue touches.
 *
 * Four structural choices are worth reading before the numbers:
 *
 * 1. **A frog cannot move while its tongue is out.** Not flavour. It makes the path the
 *    tongue sweeps a *vertical segment*, which both the simulation and the bot can test
 *    exactly with {@link reaches} — so the bot's model of a whole shot is the exact union of
 *    the per-step segments the simulation applies, and prediction equals outcome rather than
 *    nearly equalling it. That is issue #2465 designed out rather than patched, and it is
 *    lifted wholesale from Happy Hippos, which solved it first.
 *    It is also the whole tension of the game: the price of shooting is three quarters of a
 *    second in which you cannot dodge.
 * 2. **Steering is nine headings and nothing else** — {@link headingSign} on each axis, which
 *    is the exact vocabulary a keyboard gives. A finger cannot name a heading a key cannot.
 * 3. **A caught dragonfly is replaced at the half-turn image of where it was caught**, with no
 *    randomness at all. The whole simulation after the opening layout is therefore *exactly*
 *    covariant under the half-turn: mirror the marsh, mirror the commands, and every step is
 *    the mirror of the step it would have taken. Seat balance is a proof here, not a sample.
 * 4. **Two tongues on one dragonfly are settled from when each shot was committed**, through
 *    the SDK's {@link resolveSimultaneous} on source times, never by which seat this file
 *    happens to read first.
 */

/* ------------------------------------------------------------------- the marsh */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/**
 * The water. Everything below is in these logical units and never in pixels (rule 8), and
 * every one of them is its own half-turn image about the centre of the board.
 */
export const MARSH_LEFT = 20;
export const MARSH_RIGHT = 580;
export const MARSH_TOP = 20;
export const MARSH_BOTTOM = 980;

/* --------------------------------------------------------------- the dragonflies */

export const FLY_COUNT = 8;
export const FLY_RADIUS = 16;

/**
 * The air the dragonflies keep to: a band across the middle of the marsh, and its own
 * half-turn image.
 *
 * Its depth is chosen against {@link TONGUE_REACH} rather than for the look of it, and the
 * arithmetic is in SPEC.md under "The depth gradient". Four hundred units against a reach of
 * three hundred and forty means a frog at its own back line sweeps ninety units of the band
 * and a frog at the front of its bank sweeps all three hundred and forty of the tongue — so
 * coming forward is worth nearly four times as much hunting, and coming forward is exactly
 * what puts a frog inside the other tongue's arc.
 */
export const FLY_MIN_Y = 300;
export const FLY_MAX_Y = 700;
export const FLY_MIN_X = 60;
export const FLY_MAX_X = 540;

export const FLY_SPEED_MIN = 110;
export const FLY_SPEED_MAX = 190;

/**
 * How long a caught dragonfly's replacement takes to settle before it can be caught again.
 *
 * It is on the board for the whole of it, drawn as an outline, so it is a preview rather than
 * a surprise — and nothing can camp a spawn point, because there is nothing to eat there yet.
 */
export const FLY_RETURN_SECONDS = 0.85;

/* -------------------------------------------------------------------- the frogs */

export const FROG_RADIUS = 32;

export const FROG_MIN_X = 60;
export const FROG_MAX_X = 540;

/**
 * The near and far edges of seat one's bank. Seat two's are the half-turn images:
 * `1000 - 950 = 50` and `1000 - 560 = 440`.
 *
 * The two banks stop a hundred and twenty apart, so the frogs never overlap and the middle of
 * the marsh belongs to neither.
 */
export const BANK_BACK_Y = 950;
export const BANK_FRONT_Y = 560;

/** Logical units a second, for a thumb, a key and a bot alike. See SPEC.md, "Fairness". */
export const FROG_SPEED = 300;

/**
 * How far a steering command has to ask for before it counts as a direction.
 *
 * Four precision envelopes — `4 * min(w, h) / 200` — per `docs/input-idiom.md` rule 2, rather
 * than a hand-picked constant. Inside it the answer is a standstill, never "keep going the way
 * you were", because a resting thumb must not read as a held key.
 */
export const STEER_DEADZONE = 12;

/**
 * How far a pointer gesture may wander and still be a shot rather than a steer.
 *
 * Two precision envelopes — `min(w, h) / 100` — which is the tap radius
 * `docs/input-idiom.md` defines, expressed in envelopes so it can never be finer than the
 * lattice `InputManager` quantises a coordinate onto.
 */
export const TAP_RADIUS = 6;

/**
 * How long a pointer gesture may last and still be a shot rather than a steer.
 *
 * The radius alone is not enough to separate the two channels, and the reason is measurable:
 * a finger resting on one spot is quantised onto a five-unit lattice, so a player holding
 * still to steer never leaves the six-unit radius and never steers at all. A gesture is a
 * shot when it stays inside the radius **and** ends inside this window; anything else steers
 * and can never fire. See SPEC.md, "Two mechanics, one hand".
 */
export const TAP_SECONDS = 0.25;

/* ------------------------------------------------------------------ the tongue */

export const TONGUE_HALF_WIDTH = 12;

/** Centre-to-centre distance at which a tongue has a dragonfly. */
export const CATCH_RADIUS = TONGUE_HALF_WIDTH + FLY_RADIUS;

/** Centre-to-centre distance at which a tongue has the other frog. */
export const SLAP_RADIUS = TONGUE_HALF_WIDTH + FROG_RADIUS;

/**
 * How far a tongue reaches, measured from the frog it belongs to.
 *
 * Chosen against the bank depth and the fly band together. From its own back line a frog's
 * tongue tip stops at `950 - 340 = 610`, which reaches ninety units of the band and cannot
 * touch the far frog at all — the back line is a safe harbour with poor hunting. From the
 * front of the bank the tip reaches `560 - 340 = 220`, past the near edge of the band, and
 * well inside the arc of a far frog standing anywhere in its own forward strip.
 */
export const TONGUE_REACH = 340;

export const SHOT_OUT_SECONDS = 0.15;
/**
 * Seconds the tongue hangs at full stretch before it comes back.
 *
 * The hold is what makes a contested dragonfly a real event rather than a coincidence.
 * Without it a tongue passes its furthest point in a single frame and two tongues are only
 * ever both out there by accident.
 */
export const SHOT_HOLD_SECONDS = 0.12;
export const SHOT_BACK_SECONDS = 0.2;
/**
 * Seconds the frog spends reeling the tongue back in before it may move or shoot again.
 *
 * This is the sitting-duck window, and it is the longest phase on purpose. It also sets the
 * cadence ceiling: one shot per {@link SHOT_CYCLE_SECONDS} is **1.33 a second**, comfortably
 * under the two-committing-presses-a-second line `docs/input-idiom.md` draws between a game
 * that is cross-device fair and one that is not.
 */
export const SHOT_RECOVER_SECONDS = 0.28;

/** How long the tongue is out — reaching, held and returning, and none of the recovery. */
export const TONGUE_OUT_SECONDS = SHOT_OUT_SECONDS + SHOT_HOLD_SECONDS + SHOT_BACK_SECONDS;

/** One shot, from committing it to being able to commit the next. */
export const SHOT_CYCLE_SECONDS = TONGUE_OUT_SECONDS + SHOT_RECOVER_SECONDS;

/* ------------------------------------------------------------------ the scoring */

/** Seconds a frog spends sitting on its own bank after a blow lands on it. */
export const STUN_SECONDS = 2;

/**
 * How many shots a frog may waste before it loses the match.
 *
 * The catalogue row's loss condition, built as written. A shot is wasted when its tongue
 * touched no dragonfly at all — reaching the other frog does not excuse it, so aggression
 * costs the aggressor a shot and buys the other seat's tempo, which is a trade rather than a
 * free move.
 */
export const WASTE_LIMIT = 6;

/** Dragonflies to win outright. */
export const TARGET_CATCHES = 35;

/**
 * The match clock, **ours**, and the backstop behind both endings.
 *
 * `manifest.roundSeconds` ends nothing anywhere in this repository — it is the text on a
 * catalogue card — so the clock lives here, in the simulation, where a person and a bot are
 * the same thing. A test asserts the two numbers are the same hundred.
 */
export const MATCH_SECONDS = 100;

/**
 * Three questions, asked in this order, and every comparison is the SDK's.
 *
 * The catalogue row names two endings and this game builds both. `reduce-to-zero` over shots
 * remaining answers "has anybody run out"; `first-to` over dragonflies answers "has anybody
 * got there, or has the whistle gone". A whistle that leaves them level on dragonflies is
 * settled on shots remaining, because a score is one of twenty-one values and two players of
 * the same standard sit on the same one of them often.
 */
export const WASTE_CONDITION: WinCondition = { kind: 'reduce-to-zero' };
export const CATCH_CONDITION: WinCondition = { kind: 'first-to', target: TARGET_CATCHES };
export const WHISTLE_CONDITION: WinCondition = { kind: 'highest-when-time-expires' };

/**
 * Scratch for {@link resolve}.
 *
 * Hoisted and reused because the match is judged on **every** step, and an object literal
 * there would be a fresh allocation sixty times a second — exactly what rule 5 forbids. The
 * SDK hoists its own empty-eliminations array for the same reason.
 */
const resolveOptions = { timeExpired: false };
const shotsLeftTally = { p1: 0, p2: 0 };

/* -------------------------------------------------------------------- the state */

export interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** False while the replacement is still settling. Only a live dragonfly can be caught. */
  live: boolean;
  /** Seconds left before it becomes live. Zero once it is. */
  returnSeconds: number;
}

export interface Frog {
  x: number;
  y: number;
  /** True from the moment a shot is committed until the frog may move again. */
  shooting: boolean;
  /** Seconds since this shot was committed, or 0 when the frog is resting. */
  shotSeconds: number;
  /**
   * Match time at which the current shot was committed, or -1 while resting.
   *
   * A *source* time, not an arrival time: when two tongues reach one dragonfly this is what
   * {@link resolveSimultaneous} compares, so it goes to whoever actually flicked first rather
   * than to whoever's packet landed first on a remote match.
   */
  shotAt: number;
  /** Dragonflies this shot has taken so far. */
  shotCaught: number;
  /** This shot's tongue was on a dragonfly another tongue took. Not a wasted shot. */
  shotClashed: boolean;
  /** This shot has landed a blow on the other frog. Feedback only; it excuses nothing. */
  shotSlapped: boolean;
  /** Seconds of stun left after a blow. The frog can neither move nor shoot. */
  stunSeconds: number;
  /** Shots wasted so far. {@link WASTE_LIMIT} of them loses the match. */
  wasted: number;
}

export interface State {
  readonly flies: Fly[];
  readonly p1Frog: Frog;
  readonly p2Frog: Frog;
  /** Dragonflies caught. Named `p1`/`p2` so the state is a `Tally` the SDK can judge. */
  p1: number;
  p2: number;
  /** Seconds of play. The only clock in the game. */
  clock: number;
  winner: Outcome;
}

/* ------------------------------------------------------------------- the frames */

/** The bank a seat's frog sits on: the y its resting mouth is at when fully back. */
export function homeYOf(seat: SeatId): number {
  return seat === 'p1' ? BANK_BACK_Y : BOARD_HEIGHT - BANK_BACK_Y;
}

/** Which way a seat's tongue travels: seat one reaches up the board, seat two down it. */
export function reachSignOf(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

/** The far edge of a seat's own bank — as close to the middle as its frog may come. */
export function frontYOf(seat: SeatId): number {
  return seat === 'p1' ? BANK_FRONT_Y : BOARD_HEIGHT - BANK_FRONT_Y;
}

export function bankMinYOf(seat: SeatId): number {
  return seat === 'p1' ? BANK_FRONT_Y : BOARD_HEIGHT - BANK_BACK_Y;
}

export function bankMaxYOf(seat: SeatId): number {
  return seat === 'p1' ? BANK_BACK_Y : BOARD_HEIGHT - BANK_FRONT_Y;
}

export function frogOf(state: Readonly<State>, seat: SeatId): Frog {
  return seat === 'p1' ? state.p1Frog : state.p2Frog;
}

/* ------------------------------------------------------------------- the tongue */

/** How far a tongue stands out from its frog, `seconds` after the shot was committed. */
export function depthAt(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < SHOT_OUT_SECONDS) return TONGUE_REACH * (seconds / SHOT_OUT_SECONDS);
  const held = seconds - SHOT_OUT_SECONDS;
  if (held < SHOT_HOLD_SECONDS) return TONGUE_REACH;
  const back = held - SHOT_HOLD_SECONDS;
  if (back < SHOT_BACK_SECONDS) return TONGUE_REACH * (1 - back / SHOT_BACK_SECONDS);
  return 0;
}

/** Where a seat's tongue tip is, given how far into its shot it is. */
export function tipYOf(seat: SeatId, frogY: number, seconds: number): number {
  return frogY + reachSignOf(seat) * depthAt(seconds);
}

/** True while a frog's tongue is out and can touch something. */
export function tongueOut(frog: Readonly<Frog>): boolean {
  return frog.shooting && frog.shotSeconds < TONGUE_OUT_SECONDS;
}

/** True when the frog is free to move and free to shoot again. */
export function resting(frog: Readonly<Frog>): boolean {
  return !frog.shooting && frog.stunSeconds <= 0;
}

/**
 * Does a tongue sweeping the vertical segment `x, y0 -> x, y1` touch a circle of `radius`
 * about `(targetX, targetY)`?
 *
 * Exact point-to-segment distance, and the segment is vertical because a frog may not move
 * while its tongue is out. That is what lets the bot evaluate a *whole* shot with the
 * identical predicate the simulation applies one step at a time: for a marsh that is holding
 * still, the union of the per-step segments is the whole-shot segment, so the two answers are
 * the same number rather than nearly the same number.
 */
export function reaches(
  x: number,
  y0: number,
  y1: number,
  targetX: number,
  targetY: number,
  radius: number,
): boolean {
  const dx = targetX - x;
  if (dx > radius || dx < -radius) return false;
  const low = y0 < y1 ? y0 : y1;
  const high = y0 < y1 ? y1 : y0;
  let dy = 0;
  if (targetY < low) dy = low - targetY;
  else if (targetY > high) dy = targetY - high;
  return dx * dx + dy * dy <= radius * radius;
}

/* -------------------------------------------------------------------- the state */

function createFrog(seat: SeatId): Frog {
  return {
    x: BOARD_WIDTH / 2,
    y: homeYOf(seat),
    shooting: false,
    shotSeconds: 0,
    shotAt: -1,
    shotCaught: 0,
    shotClashed: false,
    shotSlapped: false,
    stunSeconds: 0,
    wasted: 0,
  };
}

function resetFrog(frog: Frog, seat: SeatId): void {
  frog.x = BOARD_WIDTH / 2;
  frog.y = homeYOf(seat);
  frog.shooting = false;
  frog.shotSeconds = 0;
  frog.shotAt = -1;
  frog.shotCaught = 0;
  frog.shotClashed = false;
  frog.shotSlapped = false;
  frog.stunSeconds = 0;
  frog.wasted = 0;
}

/** A fresh state. Allocates, so call it from init() and never from a step. */
export function createState(): State {
  const flies: Fly[] = [];
  for (let i = 0; i < FLY_COUNT; i += 1) {
    flies.push({ x: 0, y: 0, vx: 0, vy: 0, live: false, returnSeconds: 0 });
  }
  return {
    flies,
    p1Frog: createFrog('p1'),
    p2Frog: createFrog('p2'),
    p1: 0,
    p2: 0,
    clock: 0,
    winner: null,
  };
}

/**
 * Lay the marsh out for a fresh match, **in mirrored pairs**.
 *
 * Slot `2k + 1` is placed at the half-turn image of slot `2k` with its heading reversed, so
 * the opening board is *exactly* symmetric under the rotation that turns one seat's view into
 * the other's. Neither seat can be dealt the better marsh, for any seed. A test asserts it for
 * two hundred seeds to ten decimal places.
 *
 * This is the only randomness in the whole simulation. Replacements are placed by reflection
 * rather than drawn (see {@link sendAway}), so after this call the marsh is a deterministic
 * function of the opening and of what the two players do to it.
 */
export function resetState(state: State, rng: Rng): void {
  state.p1 = 0;
  state.p2 = 0;
  state.clock = 0;
  state.winner = null;
  resetFrog(state.p1Frog, 'p1');
  resetFrog(state.p2Frog, 'p2');

  for (let pair = 0; pair * 2 < state.flies.length; pair += 1) {
    const x = FLY_MIN_X + rng.float() * (FLY_MAX_X - FLY_MIN_X);
    const y = FLY_MIN_Y + rng.float() * (FLY_MAX_Y - FLY_MIN_Y);
    const heading = rng.float() * Math.PI * 2;
    const speed = FLY_SPEED_MIN + rng.float() * (FLY_SPEED_MAX - FLY_SPEED_MIN);
    const vx = Math.cos(heading) * speed;
    const vy = Math.sin(heading) * speed;

    const near = state.flies[pair * 2];
    if (near !== undefined) {
      near.x = x;
      near.y = y;
      near.vx = vx;
      near.vy = vy;
      near.live = true;
      near.returnSeconds = 0;
    }
    const far = state.flies[pair * 2 + 1];
    if (far !== undefined) {
      far.x = BOARD_WIDTH - x;
      far.y = BOARD_HEIGHT - y;
      far.vx = -vx;
      far.vy = -vy;
      far.live = true;
      far.returnSeconds = 0;
    }
  }
}

/* ------------------------------------------------------------------- steering */

/**
 * One axis of a steering command, as a sign and nothing else.
 *
 * The whole vocabulary of this game's movement is `{-1, 0, 1}` on each axis — nine headings,
 * eight compass points and a standstill. That is exactly what `InputManager` hands a game as
 * `move`, and it is exactly what taking the sign of the gap between a frog and a finger
 * produces. Neither instrument can name a heading the other cannot, which is the whole of the
 * steering half of the fairness argument.
 */
export function headingSign(gap: number): number {
  if (gap > STEER_DEADZONE) return 1;
  if (gap < -STEER_DEADZONE) return -1;
  return 0;
}

/**
 * Move a frog one step along a heading, at its own speed and no faster.
 *
 * A rate, never a set: a thumb that jumps to the far corner and a key held down move the frog
 * at the identical speed. A frog with its tongue out, or one still seeing stars from a blow,
 * does not move at all — and the first of those is what makes the tongue's path a segment.
 *
 * Diagonals are normalised through `Math.SQRT1_2`, the same factor `InputManager` applies when
 * it caps two keys at unit length, so eight compass points all cover the same ground.
 */
export function steerFrog(frog: Frog, dirX: number, dirY: number, fixedDeltaSeconds: number): void {
  if (frog.shooting || frog.stunSeconds > 0) return;
  let nx = dirX;
  let ny = dirY;
  if (nx !== 0 && ny !== 0) {
    nx *= Math.SQRT1_2;
    ny *= Math.SQRT1_2;
  }
  const reach = FROG_SPEED * fixedDeltaSeconds;
  frog.x += nx * reach;
  frog.y += ny * reach;
  if (frog.x < FROG_MIN_X) frog.x = FROG_MIN_X;
  else if (frog.x > FROG_MAX_X) frog.x = FROG_MAX_X;
}

/**
 * Clamp a frog to its own bank. Split out from {@link steerFrog} because the bank a frog
 * belongs to is a fact about its seat and the frog record does not carry one.
 */
export function keepOnBank(frog: Frog, seat: SeatId): void {
  const low = bankMinYOf(seat);
  const high = bankMaxYOf(seat);
  if (frog.y < low) frog.y = low;
  else if (frog.y > high) frog.y = high;
}

/** Steer and clamp in one call — what every caller actually wants. */
export function driveFrog(
  state: State,
  seat: SeatId,
  dirX: number,
  dirY: number,
  fixedDeltaSeconds: number,
): void {
  const frog = frogOf(state, seat);
  steerFrog(frog, dirX, dirY, fixedDeltaSeconds);
  keepOnBank(frog, seat);
}

/**
 * Commit a shot. Returns false when the frog is busy with the last one or still stunned.
 *
 * The commit *time* is recorded rather than the fact of it, because a contested dragonfly is
 * settled on when the two shots started and not on the order this file reads the seats in.
 */
export function shoot(state: State, seat: SeatId): boolean {
  const frog = frogOf(state, seat);
  if (!resting(frog)) return false;
  frog.shooting = true;
  frog.shotSeconds = 0;
  frog.shotAt = state.clock;
  frog.shotCaught = 0;
  frog.shotClashed = false;
  frog.shotSlapped = false;
  return true;
}

/* ---------------------------------------------------------------------- the step */

/**
 * Finish a shot and judge it.
 *
 * A shot is wasted when it took nothing **and** nothing took a dragonfly out from under it.
 * The clash exemption is there because two tongues arriving on one dragonfly is a coincidence
 * of timing that falls on both seats equally, and punishing both for it would put a chunk of
 * every match's outcome on a coin. Landing a blow is *not* an exemption: a shot fired at the
 * far frog costs a shot and buys tempo, which is a trade a player can choose to make.
 */
function endShot(frog: Frog): void {
  if (frog.shotCaught === 0 && !frog.shotClashed) frog.wasted += 1;
  frog.shooting = false;
  frog.shotSeconds = 0;
  frog.shotAt = -1;
}

function advanceFrog(frog: Frog, fixedDeltaSeconds: number): void {
  if (frog.stunSeconds > 0) {
    frog.stunSeconds -= fixedDeltaSeconds;
    if (frog.stunSeconds < 0) frog.stunSeconds = 0;
  }
  if (!frog.shooting) return;
  frog.shotSeconds += fixedDeltaSeconds;
  if (frog.shotSeconds >= SHOT_CYCLE_SECONDS) endShot(frog);
}

/**
 * Replace a caught dragonfly at the **half-turn image** of where it was taken, drifting the
 * other way.
 *
 * No randomness, which buys three things at once. The simulation past the opening layout is
 * exactly covariant under the half-turn, so seat balance is a structural claim rather than a
 * measured one. A tier that thinks more often cannot be dealt a different marsh from a tier
 * that thinks less, because nothing it does draws from a stream. And it is a fair rule a
 * player can read off the board: whatever you take from your side of the marsh comes back on
 * the other side, which is the one thing that stops a strong hunter emptying the middle.
 */
function sendAway(fly: Fly): void {
  fly.x = BOARD_WIDTH - fly.x;
  fly.y = BOARD_HEIGHT - fly.y;
  fly.vx = -fly.vx;
  fly.vy = -fly.vy;
  fly.live = false;
  fly.returnSeconds = FLY_RETURN_SECONDS;
}

function driftFly(fly: Fly, fixedDeltaSeconds: number): void {
  if (!fly.live) {
    fly.returnSeconds -= fixedDeltaSeconds;
    if (fly.returnSeconds <= 0) {
      fly.returnSeconds = 0;
      fly.live = true;
    }
    return;
  }
  fly.x += fly.vx * fixedDeltaSeconds;
  fly.y += fly.vy * fixedDeltaSeconds;
  if (fly.x < FLY_MIN_X) {
    fly.x = FLY_MIN_X + (FLY_MIN_X - fly.x);
    fly.vx = -fly.vx;
  } else if (fly.x > FLY_MAX_X) {
    fly.x = FLY_MAX_X - (fly.x - FLY_MAX_X);
    fly.vx = -fly.vx;
  }
  if (fly.y < FLY_MIN_Y) {
    fly.y = FLY_MIN_Y + (FLY_MIN_Y - fly.y);
    fly.vy = -fly.vy;
  } else if (fly.y > FLY_MAX_Y) {
    fly.y = FLY_MAX_Y - (fly.y - FLY_MAX_Y);
    fly.vy = -fly.vy;
  }
}

/** A blow has landed: home, stunned, and whatever shot was in progress is judged and over. */
function knockHome(state: State, seat: SeatId): void {
  const frog = frogOf(state, seat);
  if (frog.shooting) endShot(frog);
  frog.x = BOARD_WIDTH / 2;
  frog.y = homeYOf(seat);
  frog.stunSeconds = STUN_SECONDS;
}

/**
 * Hand out everything the two tongues touched this step.
 *
 * Both seats are read before either is applied, twice over: a dragonfly both tongues reached
 * goes to the shot committed first — `resolveSimultaneous` on the two source times, with
 * anything inside its tolerance a genuine draw — and the two blows are computed against the
 * positions the frogs held at the top of the step, so two frogs that reach each other on one
 * step both land and both are knocked home. Neither is decided by which seat this loop
 * happens to read first, which is the only way a mirrored board can give a mirrored answer.
 */
function feedFrogs(state: State, previousP1Seconds: number, previousP2Seconds: number): void {
  const p1 = state.p1Frog;
  const p2 = state.p2Frog;
  const p1Out = tongueOut(p1);
  const p2Out = tongueOut(p2);
  if (!p1Out && !p2Out) return;

  const p1From = tipYOf('p1', p1.y, previousP1Seconds);
  const p1To = tipYOf('p1', p1.y, p1.shotSeconds);
  const p2From = tipYOf('p2', p2.y, previousP2Seconds);
  const p2To = tipYOf('p2', p2.y, p2.shotSeconds);

  for (let i = 0; i < state.flies.length; i += 1) {
    const fly = state.flies[i];
    if (fly === undefined || !fly.live) continue;
    const p1Bite = p1Out && reaches(p1.x, p1From, p1To, fly.x, fly.y, CATCH_RADIUS);
    const p2Bite = p2Out && reaches(p2.x, p2From, p2To, fly.x, fly.y, CATCH_RADIUS);
    if (!p1Bite && !p2Bite) continue;

    let taker: SeatId;
    if (p1Bite && p2Bite) {
      const first = resolveSimultaneous(p1.shotAt, p2.shotAt);
      if (first === 'draw' || first === null) {
        // Tongues clash. Neither frog gets it, and neither shot is wasted for it.
        p1.shotClashed = true;
        p2.shotClashed = true;
        continue;
      }
      taker = first;
      const lost = otherSeat(first);
      frogOf(state, lost).shotClashed = true;
    } else {
      taker = p1Bite ? 'p1' : 'p2';
    }

    const winner = frogOf(state, taker);
    winner.shotCaught += 1;
    if (taker === 'p1') state.p1 += 1;
    else state.p2 += 1;
    sendAway(fly);
  }

  const p1Lands = p1Out && reaches(p1.x, p1From, p1To, p2.x, p2.y, SLAP_RADIUS);
  const p2Lands = p2Out && reaches(p2.x, p2From, p2To, p1.x, p1.y, SLAP_RADIUS);
  if (p1Lands) p1.shotSlapped = true;
  if (p2Lands) p2.shotSlapped = true;
  if (p1Lands) knockHome(state, 'p2');
  if (p2Lands) knockHome(state, 'p1');
}

/**
 * Judge the match. Three SDK calls, in a fixed order, and not one comparison of our own.
 */
function judge(state: State): Outcome {
  shotsLeftTally.p1 = WASTE_LIMIT - state.p1Frog.wasted;
  shotsLeftTally.p2 = WASTE_LIMIT - state.p2Frog.wasted;
  const outOfShots = resolve(WASTE_CONDITION, shotsLeftTally);
  if (outOfShots !== null) return outOfShots;
  const caught = resolve(CATCH_CONDITION, state, resolveOptions);
  // Level on dragonflies at the whistle: the frog that wasted fewer shots takes it. Both
  // seats crossing the target on the same step is a genuine draw and is left alone.
  if (caught === 'draw' && resolveOptions.timeExpired) {
    return resolve(WHISTLE_CONDITION, shotsLeftTally, resolveOptions);
  }
  return caught;
}

/**
 * One fixed step: frogs first, then the air, then what the tongues touched, then the verdict.
 *
 * The tongue is swept as a segment across the step while a dragonfly is sampled at its new
 * position. The tongue is the fast object — 2267 units a second against a dragonfly's 190 at
 * most — so it is the one that has to be continuous, and being a segment it cannot tunnel past
 * anything however fast it goes. A dragonfly moves three units in a step, well inside the
 * twenty-eight-unit catch radius, so sampling it at a point loses nothing.
 */
export function step(state: State, fixedDeltaSeconds: number): void {
  if (state.winner !== null) return;

  const previousP1Seconds = state.p1Frog.shotSeconds;
  const previousP2Seconds = state.p2Frog.shotSeconds;
  advanceFrog(state.p1Frog, fixedDeltaSeconds);
  advanceFrog(state.p2Frog, fixedDeltaSeconds);

  for (let i = 0; i < state.flies.length; i += 1) {
    const fly = state.flies[i];
    if (fly === undefined) continue;
    driftFly(fly, fixedDeltaSeconds);
  }

  feedFrogs(state, previousP1Seconds, previousP2Seconds);

  state.clock += fixedDeltaSeconds;
  resolveOptions.timeExpired = state.clock >= MATCH_SECONDS;
  state.winner = judge(state);
}

export function winnerOf(state: Readonly<State>): Outcome {
  return state.winner;
}

/** Shots a seat has left before it loses. Never negative. */
export function shotsLeft(state: Readonly<State>, seat: SeatId): number {
  const left = WASTE_LIMIT - frogOf(state, seat).wasted;
  return left < 0 ? 0 : left;
}

/** Seconds of play left, for the bar on the side margins. Never negative. */
export function secondsLeft(state: Readonly<State>): number {
  const left = MATCH_SECONDS - state.clock;
  return left < 0 ? 0 : left;
}

/**
 * The deepest point into `seat`'s own bank that the other frog's tongue could ever arrive at.
 *
 * Drawn on the board as a chalk line, because "how far forward is safe" is the decision this
 * game is made of and a player should not have to discover it by being hit.
 */
export function threatLineOf(seat: SeatId): number {
  const other = otherSeat(seat);
  const from = frontYOf(other);
  return from + reachSignOf(other) * (TONGUE_REACH + SLAP_RADIUS);
}

/* --------------------------------------------------------------------- the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the marsh. Everything a bot does between two looks it does on
   * the older picture, which is this game's reaction delay.
   */
  readonly thinkSeconds: number;
  /**
   * Chance of failing to see one dragonfly at a look, drawn afresh at every look, per slot.
   *
   * This is the skill the game actually asks for — reading which dragonflies your tongue
   * would really reach from where you are standing — so it is the skill the ladder is built
   * from. A bot that cannot see one shoots where it is not, which is exactly what happens to a
   * person going too fast.
   */
  readonly blindChance: number;
}

/**
 * Three tiers, and only three knobs — measured, not guessed. See SPEC.md for the sweeps, and
 * for the knob that was written, swept and deleted because it did nothing.
 *
 * No tier is given a dragonfly's velocity, the other frog's shot timing, or a dragonfly that
 * has not settled yet (rule 6). Every number a bot uses is on the board in front of a player,
 * and it steers with the same nine headings and the same {@link FROG_SPEED} a person has.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { thinkSeconds: 0.34, blindChance: 0.36 },
  normal: { thinkSeconds: 0.2, blindChance: 0.18 },
  hard: { thinkSeconds: 0.11, blindChance: 0.05 },
});

/**
 * The smallest number of dragonflies a bot will shoot for, at every tier alike.
 *
 * One, and it is a fact about the game rather than a difficulty axis: a shot that takes one
 * dragonfly is not a wasted shot, and the loss condition is wasted shots. Swept from 0 to 3
 * and the sweep is in SPEC.md — 0 is much worse and 2 and 3 are worse again, so a ladder
 * built on it would have had a tier sitting on the optimum and the sharper one handicapped
 * past it, which is the mistake Happy Hippos found in its own patience knob.
 */
export const SHOT_THRESHOLD = 1;

/**
 * What a blow on the far frog is worth to a bot, in dragonflies.
 *
 * **Strictly below {@link SHOT_THRESHOLD}, and that is the whole point.** A shot's value in
 * dragonflies is an integer, so a term below one can break a tie between two places to stand
 * and can never on its own be a reason to flick — the bot will *position itself* so its shot
 * also clips the far frog, and will never talk itself into the wasted shots the loss condition
 * counts. Every value strictly between 0 and 1 therefore selects the identical policy, which
 * the sweep in SPEC.md shows measuring bit-identically at 0.25, 0.5 and 0.75.
 *
 * At 1 and above it becomes "spend a shot on a blow", which measured five points off the
 * sharper tier's separation and doubled the wasted shots. At 0 the bot never uses half the
 * catalogue row.
 */
export const AGGRESSION = 0.5;

export interface BotState {
  /** Where it is walking to. */
  targetX: number;
  targetY: number;
  /** What a shot from where it was standing was worth at the last look. */
  nowValue: number;
  /** Counts down to the next look. */
  thinkSeconds: number;
  /**
   * The heading this bot wants this step, as the same nine values a person's keys produce.
   *
   * Written by {@link botDecide} and applied by the caller, so that **both seats decide
   * before either moves**. A bot reads where the far frog is standing, so applying seat one's
   * movement before seat two looked would hand seat two half a step of fresher information —
   * a seat bias dressed up as a poll order. `rules.test.ts` asserts a reversed order gives a
   * bit-identical match.
   */
  dirX: number;
  dirY: number;
  /** Whether this look failed to see slot `i`. One entry per dragonfly slot. */
  readonly blind: boolean[];
}

export function createBotState(): BotState {
  return {
    targetX: BOARD_WIDTH / 2,
    targetY: 0,
    nowValue: 0,
    thinkSeconds: 0,
    dirX: 0,
    dirY: 0,
    blind: new Array<boolean>(FLY_COUNT).fill(false),
  };
}

export function resetBotState(bot: BotState, seat: SeatId): void {
  bot.targetX = BOARD_WIDTH / 2;
  bot.targetY = homeYOf(seat);
  bot.nowValue = 0;
  bot.thinkSeconds = 0;
  bot.dirX = 0;
  bot.dirY = 0;
  for (let i = 0; i < bot.blind.length; i += 1) bot.blind[i] = false;
}

/**
 * How many dragonflies a shot from `(x, y)` would take, on the board as it stands.
 *
 * The whole-shot segment, tested with {@link reaches} — **the identical predicate the
 * simulation applies one step at a time**. Because a frog may not move while its tongue is
 * out, that segment is exactly the union of the per-step segments, so for a marsh that is
 * holding still the prediction and the outcome are the same number rather than nearly the
 * same number. Issue #2465 is about precisely this, and `rules.test.ts` asserts it over sixty
 * random marshes in both seats.
 *
 * What it does not model is a dragonfly drifting during the half-second the tongue is out, or
 * the other frog getting there first. A person cannot do either of those exactly either, and
 * both errors fall on the two seats alike.
 */
export function shotValue(
  state: Readonly<State>,
  seat: SeatId,
  x: number,
  y: number,
  blind: readonly boolean[],
): number {
  const tipY = y + reachSignOf(seat) * TONGUE_REACH;
  let value = 0;
  for (let i = 0; i < state.flies.length; i += 1) {
    const fly = state.flies[i];
    if (fly === undefined || !fly.live) continue;
    if (blind[i] === true) continue;
    if (reaches(x, y, tipY, fly.x, fly.y, CATCH_RADIUS)) value += 1;
  }
  return value;
}

/**
 * Could the other frog's tongue, fired from where it is standing now, reach `(x, y)`?
 *
 * Everything in this is on the board: where the far frog is, and how far a tongue goes. It is
 * the same question a person asks before coming forward.
 */
export function threatened(state: Readonly<State>, seat: SeatId, x: number, y: number): boolean {
  const other = otherSeat(seat);
  const far = frogOf(state, other);
  const tipY = far.y + reachSignOf(other) * TONGUE_REACH;
  return reaches(far.x, far.y, tipY, x, y, SLAP_RADIUS);
}

/**
 * What a blow is worth to a bot weighing a shot, in dragonflies.
 *
 * Kept out of {@link shotValue} on purpose. `shotValue` is exact — the far frog is not, because
 * it can move during the half-second the tongue is out and a dragonfly's slot cannot. Mixing
 * an exact term with an approximate one inside the predicate the #2465 test compares against
 * the simulation would make that test meaningless.
 */
export function blowWorth(state: Readonly<State>, seat: SeatId, x: number, y: number): number {
  const far = frogOf(state, otherSeat(seat));
  const tipY = y + reachSignOf(seat) * TONGUE_REACH;
  return reaches(x, y, tipY, far.x, far.y, SLAP_RADIUS) ? AGGRESSION : 0;
}

function clampX(x: number): number {
  if (x < FROG_MIN_X) return FROG_MIN_X;
  if (x > FROG_MAX_X) return FROG_MAX_X;
  return x;
}

function clampY(y: number, seat: SeatId): number {
  const low = bankMinYOf(seat);
  const high = bankMaxYOf(seat);
  if (y < low) return low;
  if (y > high) return high;
  return y;
}

/**
 * One look at the marsh.
 *
 * Exactly {@link FLY_COUNT} values are drawn, unconditionally and before anything branches, so
 * a bot occupies a fixed window of its own stream per look whatever the board looks like and
 * whatever it decides to do. Each seat has its own generator as well, so the order the two are
 * polled in is not observable at all — both guards are asserted in `rules.test.ts`.
 *
 * Candidates are the dragonflies themselves: a spot that puts one in the middle of the tongue's
 * arc, clamped to the bank. A shot is only ever worth taking from somewhere a dragonfly
 * already is, so a grid of positions would search a hundred spots to reach the same eight
 * answers.
 */
export function botLook(
  state: Readonly<State>,
  seat: SeatId,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  for (let i = 0; i < bot.blind.length; i += 1) bot.blind[i] = rng.bool(profile.blindChance);

  const frog = frogOf(state, seat);
  const sign = reachSignOf(seat);
  bot.nowValue =
    shotValue(state, seat, frog.x, frog.y, bot.blind) + blowWorth(state, seat, frog.x, frog.y);

  let bestX = clampX(frog.x);
  let bestY = clampY(frog.y, seat);
  let best = bot.nowValue;

  for (let i = 0; i < state.flies.length; i += 1) {
    const fly = state.flies[i];
    if (fly === undefined || !fly.live) continue;
    if (bot.blind[i] === true) continue;
    // Half the reach back from the dragonfly, so it sits in the middle of the arc rather than
    // on its lip — the one place a step of drift cannot take it out of range.
    const x = clampX(fly.x);
    const y = clampY(fly.y - sign * (TONGUE_REACH / 2), seat);
    const value = shotValue(state, seat, x, y, bot.blind) + blowWorth(state, seat, x, y);
    // A strict `>` keeps the lowest slot on a tie, and slot order is the same in both seats'
    // frames, so two mirrored boards break their ties the same way.
    if (value > best) {
      best = value;
      bestX = x;
      bestY = y;
    }
  }

  bot.targetX = bestX;
  bot.targetY = bestY;
  bot.thinkSeconds = profile.thinkSeconds;
}

/**
 * Decide what one bot wants this step, and report whether it flicks its tongue.
 *
 * It **decides and does not move** — the heading lands in `bot.dirX/dirY` for the caller to
 * apply once both seats have decided. It walks toward the spot it chose, with the same nine
 * headings a person has, and shoots when the spot it is *standing on* was worth its threshold
 * at the last look — never on what the marsh looks like this instant, because that would give
 * it a reaction of one frame.
 */
export function botDecide(
  state: Readonly<State>,
  seat: SeatId,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  bot.thinkSeconds -= fixedDeltaSeconds;
  if (bot.thinkSeconds <= 0) botLook(state, seat, difficulty, bot, rng);

  const frog = frogOf(state, seat);
  bot.dirX = headingSign(bot.targetX - frog.x);
  bot.dirY = headingSign(bot.targetY - frog.y);
  if (!resting(frog)) return false;
  return bot.nowValue >= SHOT_THRESHOLD;
}
