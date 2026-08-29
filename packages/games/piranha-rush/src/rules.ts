import { envelopeFor } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Piranha Rush, as pure rules.
 *
 * Two lagoons, one at each end of the device, with a swimmer in each. A shoal of four
 * piranhas hunts the swimmer from the moment the match starts, slower than it can swim
 * and getting faster every second; coral heads stand in the water and swimming into one
 * stops you dead for half a second. You score the distance you swim, and you stop scoring
 * the moment the shoal reaches you.
 *
 * No rendering, no timing, no DOM — the bot, the balance harness and the tests all reuse
 * this module.
 *
 * ## The four decisions this file exists to record
 *
 * **Both lagoons are simulated in ONE local frame, not in board coordinates.** A swimmer's
 * position is a point in a 560 x 470 box that starts at (0, 0) for *both* seats, and
 * {@link toBoardX}/{@link toBoardY} place that box into the device's half-turn only when
 * something is drawn. So the two seats do not run mirror-image simulations that have to be
 * *shown* to agree — they run the **identical arithmetic on the identical numbers**, and
 * seat symmetry is a property of the type rather than a measurement. `rules.test.ts` drives
 * the two seats with one command stream and asserts their whole states are bit-identical,
 * which is the strongest form of the check `docs`-level lore asks every game to make; see
 * SPEC.md, "The half-turn is a rendering transform".
 *
 * **A heading is one of nine values, and nothing here is continuous.** The catalogue row
 * says "run", and a run is a *position* — exactly the quantity `docs/input-parity.md` says
 * a thumb can name and a key cannot. So the simulation is handed a {@link Command} carrying
 * a direction drawn from the nine values a keyboard produces — eight compass points and a
 * standstill — and the swim runs at one {@link SWIM_SPEED} whichever instrument named it.
 *
 * **The match is guaranteed to end by arithmetic, not by a clock.** Every piranha is a pure
 * pursuer whose speed is a function of elapsed time alone, so the gap to the swimmer obeys
 * `d' <= d + (SWIM_SPEED - piranhaSpeed(t)) * dt` on every step, whatever anybody does.
 * Once `piranhaSpeed` passes `SWIM_SPEED` that sum runs to zero in bounded time, and
 * {@link terminationBoundSeconds} is the closed form of when. See SPEC.md, "Termination".
 *
 * **Piranhas swim through coral and swimmers do not.** That asymmetry is deliberate and it
 * is what keeps the paragraph above true: a pursuer that has to path around an obstacle is
 * no longer a pure pursuer and the bound evaporates. It is also the honest reading of the
 * catalogue row — the reef is what *you* have to watch out for.
 */

/* ------------------------------------------------------------------------------------ */
/* The board, and the one frame the simulation runs in                                   */
/* ------------------------------------------------------------------------------------ */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** The line the two lagoons are reflected through, and where the divider is drawn. */
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** How far a lagoon sits from the outside edge of the device. */
export const BOARD_INSET = 20;
/** Half the channel of open water left between the two lagoons. */
export const CENTRE_GAP = 10;

/**
 * The lagoon, in its own units.
 *
 * This box is the whole world the simulation knows about, and **both seats live in it at
 * once**. A swimmer at (40, 40) is forty units from the left rim and forty from its own
 * shore whichever seat it belongs to; which end of the device that is happens in
 * {@link toBoardX} and {@link toBoardY} and nowhere else.
 */
export const LAGOON_WIDTH = BOARD_WIDTH - BOARD_INSET * 2;
export const LAGOON_HEIGHT = CENTRE_Y - CENTRE_GAP - BOARD_INSET;

/** Where seat one's lagoon sits on the device. Seat two's is its half-turn image. */
export const LAGOON_X0 = BOARD_INSET;
export const LAGOON_Y0 = CENTRE_Y + CENTRE_GAP;

/**
 * Place a lagoon-local point on the device.
 *
 * The whole of the half-turn, in two functions, used by the drawing and by the input
 * mapping and by nothing in the simulation. Written as `BOARD - (offset + local)` rather
 * than as a rotation matrix because the two seats' rim values then come out *exactly*
 * equal under the reflection — `1000 - (510 + 470) === 20` in floating point as well as in
 * arithmetic — so a swimmer pinned against its own shore mirrors onto a swimmer pinned
 * against the other's with no last-bit disagreement. That family of defect (a threshold a
 * state variable lands on exactly by construction) is what cost Frozen Beaks 24 of 60
 * mirrored matches.
 */
export function toBoardX(seat: SeatId, localX: number): number {
  return seat === 'p1' ? LAGOON_X0 + localX : BOARD_WIDTH - (LAGOON_X0 + localX);
}

export function toBoardY(seat: SeatId, localY: number): number {
  return seat === 'p1' ? LAGOON_Y0 + localY : BOARD_HEIGHT - (LAGOON_Y0 + localY);
}

/**
 * Which way a seat's own axes point along the device.
 *
 * The only thing the half-turn costs anybody: seat two reads the device upside down, so
 * its own "forward" is the device's "up". `game.ts` multiplies both the keyboard's move
 * vector and the pointer's gap by this and gets a lagoon-local heading; nothing else in
 * the package needs it, because nothing else in the package knows about the device.
 */
export function seatAxisSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

/* ------------------------------------------------------------------------------------ */
/* The swimmer, the shoal and the reef                                                   */
/* ------------------------------------------------------------------------------------ */

export const SWIM_RADIUS = 20;
export const PIRANHA_RADIUS = 13;
export const CORAL_RADIUS = 30;

/** Close enough to be taken. Checked between centres, so the drawn discs are the rule. */
export const CATCH_RADIUS = SWIM_RADIUS + PIRANHA_RADIUS;
/** Close enough to a coral head to be caught on it. */
export const SNAG_RADIUS = SWIM_RADIUS + CORAL_RADIUS;

/**
 * How fast a swimmer swims, and the number the fairness argument rests on.
 *
 * One precision envelope in this box is `min(600, 1000) / 200 = 3` units, so a swimmer
 * covers exactly one envelope in 20 ms. The largest quantity two input families can
 * disagree about is *when* a heading changed, and a thirty-millisecond latency difference
 * therefore moves a swimmer by 4.5 units — one and a half of the finest distinction the
 * engine permits any device to make, against a 33-unit catch radius and a 50-unit coral.
 * See SPEC.md, "Fairness across input families".
 */
export const SWIM_SPEED = 150;

/**
 * How far a finger must sit from the swimmer before it means "swim".
 *
 * Four precision envelopes, per `docs/input-idiom.md` rule 2, rather than another
 * hand-picked constant. Inside it the answer is a standstill, which in this game means
 * exactly what releasing every key means: tread water and score nothing.
 */
export const MOVE_DEADZONE = 4 * envelopeFor({ width: BOARD_WIDTH, height: BOARD_HEIGHT });

/** Piranhas in a shoal. One per corner of the lagoon, all hunting from the first step. */
export const PIRANHA_COUNT = 4;

/**
 * The shoal's speed, in units a second, `t` seconds into the match.
 *
 * Linear and a function of **elapsed time alone** — never of the score, the board or how
 * well anybody is playing. That is what makes {@link terminationBoundSeconds} a closed
 * form instead of a hope, and it is also the honest model: the shoal is not reacting to
 * you, it is simply working itself up.
 *
 * It opens at 0.64 of {@link SWIM_SPEED}, which is comfortably outrun, and crosses it at
 * `(150 - 96) / 2.2 = 24.5` seconds, after which no swimmer can pull away from anything.
 */
export const PIRANHA_BASE = 96;
export const PIRANHA_RAMP = 2.2;

export function piranhaSpeed(elapsed: number): number {
  return PIRANHA_BASE + PIRANHA_RAMP * elapsed;
}

/** Where the shoal is faster than a swimmer, in seconds. Nothing outruns it after this. */
export const CROSSOVER_SECONDS = (SWIM_SPEED - PIRANHA_BASE) / PIRANHA_RAMP;

/** Seconds caught on a coral head. No movement, no score, and the shoal does not wait. */
export const SNAG_SECONDS = 0.5;

/** Coral heads in a lagoon, drawn from the eight cells around the middle. */
export const CORAL_COUNT = 6;

/**
 * One length: the swimmer's own body, and the unit the score is counted in.
 *
 * The score is **distance swum**, which in a game with exactly one speed is the time you
 * spent alive and moving — so a snag and a death both show up in it directly, and standing
 * still is worth precisely nothing. Counting it in body lengths rather than in raw units
 * puts the HUD number at about a hundred rather than about five thousand, and ticks it
 * under four times a second.
 */
export const SCORE_UNIT = SWIM_RADIUS * 2;

/**
 * The backstop clock, in seconds.
 *
 * **It is not the termination guarantee and it has never fired.** The guarantee is the
 * shoal's ramp, whose closed form {@link terminationBoundSeconds} puts at 59.7 seconds at
 * 60 Hz; this sits well above it so that a defect in the ramp shows up as a strange
 * scoreline rather than as a hung test suite. `rules.test.ts` asserts the ordering of the
 * two numbers and counts how often the clock decides a match, which is zero.
 */
export const MATCH_SECONDS = 90;

/**
 * Highest score when it is over, through the SDK.
 *
 * "It is over" is both swimmers taken, or the backstop clock — settled in {@link judge},
 * which also owns the tiebreak the helper cannot know about.
 */
export const WIN_CONDITION: WinCondition = Object.freeze({ kind: 'highest-when-time-expires' });

/* ------------------------------------------------------------------------------------ */
/* Where a swimmer may go                                                                */
/* ------------------------------------------------------------------------------------ */

export const MIN_X = SWIM_RADIUS;
export const MAX_X = LAGOON_WIDTH - SWIM_RADIUS;
export const MIN_Y = SWIM_RADIUS;
export const MAX_Y = LAGOON_HEIGHT - SWIM_RADIUS;

/** Where a swimmer starts: the middle of the lagoon, which the reef always leaves clear. */
export const START_X = LAGOON_WIDTH / 2;
export const START_Y = LAGOON_HEIGHT / 2;

/** The longest gap the lagoon can hold, used by the termination bound. */
export const LAGOON_DIAGONAL = Math.hypot(LAGOON_WIDTH, LAGOON_HEIGHT);

/**
 * The latest second at which a match can still be running, given the step size.
 *
 * The whole argument, and it is four lines. On one step the swimmer moves at most
 * `SWIM_SPEED * dt` and a piranha moves exactly `piranhaSpeed(t) * dt` straight at it
 * (capped at the gap, which only helps), so by the triangle inequality
 *
 * ```
 * d(t + dt) <= d(t) + (SWIM_SPEED - piranhaSpeed(t)) * dt
 * ```
 *
 * Summing that from zero and requiring the result to have fallen to {@link CATCH_RADIUS}
 * gives a quadratic in `T` whose positive root is returned here. `dt` appears because the
 * discrete sum under-counts the integral by `PIRANHA_RAMP * T * dt / 2`; at 60 Hz that is
 * a hundredth of a second, and including it means the number is a bound on the code rather
 * than on the calculus.
 *
 * Nothing about how the match is played enters it. A swimmer that hides in a corner, one
 * that never moves, one that plays perfectly and one that is stuck on a coral for the
 * whole match are all covered, because the only thing the inequality assumes is that
 * nobody swims faster than `SWIM_SPEED`.
 */
export function terminationBoundSeconds(dt: number): number {
  const closing = SWIM_SPEED - PIRANHA_BASE + (PIRANHA_RAMP * dt) / 2;
  const reach = LAGOON_DIAGONAL - CATCH_RADIUS;
  return (closing + Math.sqrt(closing * closing + 2 * PIRANHA_RAMP * reach)) / PIRANHA_RAMP;
}

/* ------------------------------------------------------------------------------------ */
/* State                                                                                 */
/* ------------------------------------------------------------------------------------ */

export interface Swimmer {
  x: number;
  y: number;
  /** Position at the start of the step, for render interpolation. */
  prevX: number;
  prevY: number;
  /** The heading asked for on this step. Drawn as the swimmer's nose; never a rule. */
  dirX: number;
  dirY: number;
  /** Seconds still caught on a coral head. Zero while swimming. */
  snag: number;
  /** Units swum. The score, before it is divided into lengths. */
  distance: number;
  /** Coral heads swum into. The tiebreak when two swimmers finish level on lengths. */
  snags: number;
  alive: boolean;
  /** Seconds into the match at which the shoal took this swimmer. */
  diedAt: number;
  /** Seconds since the last snag, purely so the drawing can flash. */
  flash: number;
}

export interface Piranha {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
}

export interface Coral {
  x: number;
  y: number;
}

export interface Lagoon {
  readonly swimmer: Swimmer;
  readonly piranhas: Piranha[];
}

export interface Game {
  readonly p1: Lagoon;
  readonly p2: Lagoon;
  /**
   * The reef, in lagoon-local units — **one list, read by both seats**.
   *
   * Not "generated once and mirrored": generated once and *shared*, because the simulation
   * has only one frame. There is no second copy that could drift, and no mirroring step
   * that could be written in board coordinates by accident.
   */
  readonly corals: Coral[];
  /** Seconds played. Counted, never derived: {@link piranhaSpeed} reads it every step. */
  elapsed: number;
  /** Seconds left on the backstop clock. */
  clock: number;
  winner: SeatId | 'draw' | null;
}

/** What one seat is asking for this step, in lagoon-local units. */
export interface Command {
  /** A unit heading, or (0, 0) for a standstill — tread water and score nothing. */
  dirX: number;
  dirY: number;
}

export function createCommand(): Command {
  return { dirX: 0, dirY: 0 };
}

export const SEATS: readonly SeatId[] = Object.freeze(['p1', 'p2']);

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function lagoonOf(game: Readonly<Game>, seat: SeatId): Lagoon {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** A swimmer's score: whole body lengths swum. */
export function lengthsOf(lagoon: Readonly<Lagoon>): number {
  return Math.floor(lagoon.swimmer.distance / SCORE_UNIT);
}

/* ------------------------------------------------------------------------------------ */
/* The reef                                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * The nine cells a coral head may sit in, and how far it may wander inside one.
 *
 * A jittered grid rather than rejection sampling, so every clearance in the lagoon is
 * guaranteed by arithmetic instead of by a loop that might not converge:
 *
 * - horizontal neighbours are 168 apart and may close by 52, so never nearer than **116**;
 * - vertical neighbours are 125 apart and may close by 24, so never nearer than **101**;
 * - two coral heads 100 apart leave exactly enough water for a swimmer to pass between
 *   them, so **every gap in the reef is swimmable**;
 * - the outermost a head can sit is 86 from a side rim and 98 from an end, against the 70
 *   a swimmer needs to squeeze past, so **the rim channel is never closed**.
 *
 * The middle cell is always empty, which is what keeps the swimmer's own starting point
 * clear without a rejection test.
 *
 * `rules.test.ts` checks all four claims over 300 seeds rather than trusting this comment.
 */
const CORAL_CELL_X: readonly number[] = Object.freeze([112, 280, 448]);
const CORAL_CELL_Y: readonly number[] = Object.freeze([110, 235, 360]);
const CORAL_JITTER_X = 26;
const CORAL_JITTER_Y = 12;
/** The middle of the nine, which never carries a head. */
const CORAL_MIDDLE_CELL = 4;

/** The four corners the shoal starts in, in lagoon-local units. */
const PIRANHA_HOME: readonly { readonly x: number; readonly y: number }[] = Object.freeze([
  Object.freeze({ x: 28, y: 28 }),
  Object.freeze({ x: LAGOON_WIDTH - 28, y: LAGOON_HEIGHT - 28 }),
  Object.freeze({ x: LAGOON_WIDTH - 28, y: 28 }),
  Object.freeze({ x: 28, y: LAGOON_HEIGHT - 28 }),
]);

/**
 * A number in [0, 1) for the `k`th draw of the reef.
 *
 * Two modes through one function. With a generator it is a seeded draw; without one it is
 * a golden-ratio low-discrepancy sequence, which spreads as evenly as a random one and
 * lets {@link createGame} hand back a real, playable reef before anybody has a seed —
 * tests and the balance harness both want that.
 */
function reefDraw(rng: Rng | null, k: number): number {
  if (rng !== null) return rng.float();
  const x = (k + 1) * 0.6180339887498949;
  return x - Math.floor(x);
}

/**
 * Lay out the reef: six heads on a jittered grid, in the one frame both seats read.
 *
 * Which two of the eight outer cells are left empty is the structural variety a match has,
 * and both players get the same two. Neither seat can draw the easier lagoon because there
 * is only one lagoon in the simulation at all.
 */
function layout(game: Game, rng: Rng | null): void {
  let draw = 0;
  // Two cells of the eight are left empty. Drawn as an ordered pair of distinct indices so
  // the count of draws is fixed and the choice cannot depend on anything on the board.
  const firstSkip = Math.floor(reefDraw(rng, draw) * 8);
  draw += 1;
  const secondSkip = (firstSkip + 1 + Math.floor(reefDraw(rng, draw) * 7)) % 8;
  draw += 1;

  let placed = 0;
  let outer = 0;
  for (let cell = 0; cell < 9; cell += 1) {
    if (cell === CORAL_MIDDLE_CELL) continue;
    const skipped = outer === firstSkip || outer === secondSkip;
    outer += 1;
    if (skipped) {
      // Drawn anyway, so the stream position after a layout never depends on which cells
      // were chosen. A generator whose consumption varies with the board is how two seats
      // stop being able to share one seed.
      draw += 2;
      continue;
    }
    const cx = CORAL_CELL_X[cell % 3] as number;
    const cy = CORAL_CELL_Y[Math.floor(cell / 3)] as number;
    const jx = (reefDraw(rng, draw) * 2 - 1) * CORAL_JITTER_X;
    draw += 1;
    const jy = (reefDraw(rng, draw) * 2 - 1) * CORAL_JITTER_Y;
    draw += 1;
    const coral = game.corals[placed] as Coral;
    coral.x = cx + jx;
    coral.y = cy + jy;
    placed += 1;
  }
}

/* ------------------------------------------------------------------------------------ */
/* Building and resetting                                                                */
/* ------------------------------------------------------------------------------------ */

function makeSwimmer(): Swimmer {
  return {
    x: START_X,
    y: START_Y,
    prevX: START_X,
    prevY: START_Y,
    dirX: 0,
    dirY: 0,
    snag: 0,
    distance: 0,
    snags: 0,
    alive: true,
    diedAt: 0,
    flash: 0,
  };
}

function makeLagoon(): Lagoon {
  const piranhas: Piranha[] = [];
  for (let i = 0; i < PIRANHA_COUNT; i += 1) {
    const home = PIRANHA_HOME[i % PIRANHA_HOME.length] as { x: number; y: number };
    piranhas.push({ x: home.x, y: home.y, prevX: home.x, prevY: home.y });
  }
  return { swimmer: makeSwimmer(), piranhas };
}

export function createGame(): Game {
  const corals: Coral[] = [];
  for (let i = 0; i < CORAL_COUNT; i += 1) corals.push({ x: 0, y: 0 });
  const game: Game = {
    p1: makeLagoon(),
    p2: makeLagoon(),
    corals,
    elapsed: 0,
    clock: MATCH_SECONDS,
    winner: null,
  };
  resetGame(game, null);
  return game;
}

function resetLagoon(lagoon: Lagoon): void {
  const swimmer = lagoon.swimmer;
  swimmer.x = START_X;
  swimmer.y = START_Y;
  swimmer.prevX = START_X;
  swimmer.prevY = START_Y;
  swimmer.dirX = 0;
  swimmer.dirY = 0;
  swimmer.snag = 0;
  swimmer.distance = 0;
  swimmer.snags = 0;
  swimmer.alive = true;
  swimmer.diedAt = 0;
  swimmer.flash = 0;
  for (let i = 0; i < lagoon.piranhas.length; i += 1) {
    const piranha = lagoon.piranhas[i] as Piranha;
    const home = PIRANHA_HOME[i % PIRANHA_HOME.length] as { x: number; y: number };
    piranha.x = home.x;
    piranha.y = home.y;
    piranha.prevX = home.x;
    piranha.prevY = home.y;
  }
}

/**
 * Start a fresh match. `rng` is the match seed; pass null for the fixed opening reef
 * {@link createGame} builds.
 */
export function resetGame(game: Game, rng: Rng | null): void {
  game.elapsed = 0;
  game.clock = MATCH_SECONDS;
  game.winner = null;
  resetLagoon(game.p1);
  resetLagoon(game.p2);
  layout(game, rng);
}

/* ------------------------------------------------------------------------------------ */
/* Geometry the simulation, the bot and the tests all share                               */
/* ------------------------------------------------------------------------------------ */

/**
 * Whether a swimmer moving by `(dx, dy)` would touch a coral head at any point of the step.
 *
 * Swept rather than sampled at the endpoints. A swimmer only covers 2.5 units in a 60 Hz
 * step against a 50-unit snag radius so nothing can tunnel today, but the whole point of a
 * closed-form test is that it stays true when somebody doubles the speed.
 */
export function crossesCoral(
  corals: readonly Coral[],
  x: number,
  y: number,
  dx: number,
  dy: number,
): boolean {
  const travel = dx * dx + dy * dy;
  for (let i = 0; i < corals.length; i += 1) {
    const coral = corals[i] as Coral;
    const ox = coral.x - x;
    const oy = coral.y - y;
    // Closest approach along the step, with the parameter clamped to the segment.
    let t = travel === 0 ? 0 : (ox * dx + oy * dy) / travel;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const gx = ox - dx * t;
    const gy = oy - dy * t;
    if (gx * gx + gy * gy < SNAG_RADIUS * SNAG_RADIUS) return true;
  }
  return false;
}

/** How far a swimmer may travel along `(dx, dy)` before its centre leaves the lagoon. */
export function rimAlong(x: number, y: number, dx: number, dy: number): number {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (MAX_X - x) / dx);
  else if (dx < 0) t = Math.min(t, (MIN_X - x) / dx);
  if (dy > 0) t = Math.min(t, (MAX_Y - y) / dy);
  else if (dy < 0) t = Math.min(t, (MIN_Y - y) / dy);
  return t < 0 ? 0 : t;
}

/**
 * How far along `(dx, dy)` before a swimmer catches a coral head, or Infinity.
 *
 * Analytic ray-to-circle rather than marching: exact, allocation-free, and the same answer
 * {@link crossesCoral} gives, which is the point — a bot that planned with a different
 * arithmetic from the one the game steps would be aiming at a different reef.
 */
export function coralAlong(
  corals: readonly Coral[],
  x: number,
  y: number,
  dx: number,
  dy: number,
): number {
  let best = Infinity;
  for (let i = 0; i < corals.length; i += 1) {
    const coral = corals[i] as Coral;
    const ox = coral.x - x;
    const oy = coral.y - y;
    const c = ox * ox + oy * oy - SNAG_RADIUS * SNAG_RADIUS;
    if (c <= 0) return 0;
    const b = ox * dx + oy * dy;
    if (b <= 0) continue;
    const disc = b * b - c;
    if (disc < 0) continue;
    const hit = b - Math.sqrt(disc);
    if (hit < best) best = hit;
  }
  return best;
}

/** The distance from `(x, y)` to the nearest piranha in this lagoon. */
export function nearestPiranha(lagoon: Readonly<Lagoon>, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < lagoon.piranhas.length; i += 1) {
    const piranha = lagoon.piranhas[i] as Piranha;
    const gap = Math.hypot(piranha.x - x, piranha.y - y);
    if (gap < best) best = gap;
  }
  return best;
}

/* ------------------------------------------------------------------------------------ */
/* Stepping                                                                              */
/* ------------------------------------------------------------------------------------ */

/** Scratch tally. Allocated once at module load, so judging allocates nothing. */
const tally = { p1: 0, p2: 0 };

/**
 * Swim, or sit on the coral you just hit.
 *
 * **A swimmer that hits a coral does not move at all**, rather than sliding along it or
 * stopping on its rim. That is a deliberate answer to the defect family Frozen Beaks
 * documented: a swimmer stopped *on* a rim sits at exactly `SNAG_RADIUS` from the head's
 * centre by construction, which is precisely the value the next step's inside-test
 * compares against. Refusing the move instead leaves the swimmer on the lattice its own
 * strides produce, where landing exactly on a threshold takes a coincidence rather than a
 * definition.
 */
function driveSwimmer(game: Game, lagoon: Lagoon, command: Readonly<Command>, dt: number): void {
  const swimmer = lagoon.swimmer;
  swimmer.prevX = swimmer.x;
  swimmer.prevY = swimmer.y;
  swimmer.dirX = command.dirX;
  swimmer.dirY = command.dirY;
  if (swimmer.flash > 0) swimmer.flash = Math.max(0, swimmer.flash - dt);

  if (swimmer.snag > 0) {
    swimmer.snag = Math.max(0, swimmer.snag - dt);
    return;
  }
  if (command.dirX === 0 && command.dirY === 0) return;

  const stride = SWIM_SPEED * dt;
  const wantX = clamp(swimmer.x + command.dirX * stride, MIN_X, MAX_X);
  const wantY = clamp(swimmer.y + command.dirY * stride, MIN_Y, MAX_Y);
  const dx = wantX - swimmer.x;
  const dy = wantY - swimmer.y;
  if (crossesCoral(game.corals, swimmer.x, swimmer.y, dx, dy)) {
    swimmer.snag = SNAG_SECONDS;
    swimmer.snags += 1;
    swimmer.flash = 1;
    return;
  }
  swimmer.distance += Math.hypot(dx, dy);
  swimmer.x = wantX;
  swimmer.y = wantY;
}

/**
 * Move the shoal, and see whether it has anybody.
 *
 * Pure pursuit, and pure pursuit is not a simplification — it is the termination
 * guarantee. Each piranha heads exactly at the swimmer at `piranhaSpeed(elapsed)`, capped
 * at the gap so it can never overshoot, and it ignores the reef entirely. Every one of
 * those three clauses is load-bearing for the inequality in
 * {@link terminationBoundSeconds}: a lead, a wander, or a detour around a coral all break
 * it, and none of them would be visible in a normal test.
 *
 * The pursuit also cannot leave the lagoon without being clamped, which would have been a
 * second place for the two seats to disagree: the lagoon is convex and both the piranha
 * and the swimmer are inside it, so every point of the segment between them is too.
 */
function driveShoal(lagoon: Lagoon, speed: number, dt: number): void {
  const swimmer = lagoon.swimmer;
  const reach = speed * dt;
  for (let i = 0; i < lagoon.piranhas.length; i += 1) {
    const piranha = lagoon.piranhas[i] as Piranha;
    piranha.prevX = piranha.x;
    piranha.prevY = piranha.y;
    const ox = swimmer.x - piranha.x;
    const oy = swimmer.y - piranha.y;
    const gap = Math.hypot(ox, oy);
    if (gap > 0) {
      const move = reach < gap ? reach : gap;
      piranha.x += (ox / gap) * move;
      piranha.y += (oy / gap) * move;
    }
    const nx = swimmer.x - piranha.x;
    const ny = swimmer.y - piranha.y;
    if (nx * nx + ny * ny <= CATCH_RADIUS * CATCH_RADIUS) swimmer.alive = false;
  }
}

function driveSeat(game: Game, seat: SeatId, command: Readonly<Command>, dt: number): void {
  const lagoon = lagoonOf(game, seat);
  // A taken swimmer stops entirely, shoal included: the picture freezes on the moment it
  // happened and nothing about a finished lagoon can move the score any further.
  if (!lagoon.swimmer.alive) return;
  driveSwimmer(game, lagoon, command, dt);
  driveShoal(lagoon, piranhaSpeed(game.elapsed), dt);
  if (!lagoon.swimmer.alive) lagoon.swimmer.diedAt = game.elapsed;
}

/**
 * Who has won, or null while the match is still on.
 *
 * The match is over when **both** swimmers have been taken — a seat that is still swimming
 * is still scoring, so the seat that lasts longer normally wins by simply carrying on —
 * or, never yet observed, when the backstop clock runs out.
 *
 * The winner is the higher score, through the SDK's `highest-when-time-expires`, which is
 * also what makes two swimmers finishing level a draw rather than a win for whichever seat
 * this file happens to read first. The tiebreak on top of it is the one thing the helper
 * cannot know about: level on lengths, the swimmer that caught **fewer** coral heads takes
 * it.
 *
 * That tiebreak is deliberately not a function of the board. A rule written in positions —
 * "the swimmer further up the lagoon", "the swimmer nearer the middle" — cannot settle
 * this game at all, because the two lagoons are the same lagoon: a covariant rule returns
 * the mirror answer and decides nothing. A count of events is not a position, so it does.
 */
function judge(game: Game): void {
  const done = !game.p1.swimmer.alive && !game.p2.swimmer.alive;
  const over = done || game.clock <= 0;
  tally.p1 = lengthsOf(game.p1);
  tally.p2 = lengthsOf(game.p2);
  const decided = resolve(WIN_CONDITION, tally, { timeExpired: over });
  if (decided === null) return;
  if (decided !== 'draw') {
    game.winner = decided;
    return;
  }
  const s1 = game.p1.swimmer.snags;
  const s2 = game.p2.swimmer.snags;
  game.winner = s1 === s2 ? 'draw' : s1 < s2 ? 'p1' : 'p2';
}

/** One fixed step. Deterministic, and allocates nothing. */
export function step(
  game: Game,
  dt: number,
  p1Command: Readonly<Command>,
  p2Command: Readonly<Command>,
): void {
  if (game.winner !== null) return;

  driveSeat(game, 'p1', p1Command, dt);
  driveSeat(game, 'p2', p2Command, dt);

  game.elapsed += dt;
  game.clock = Math.max(0, game.clock - dt);
  judge(game);
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * The eight headings, and the order is the tie-break.
 *
 * Written once, in lagoon-local units, and used by **both** seats unchanged. There is no
 * `seatAxisSign` anywhere in the bot, and that is the whole seat-symmetry argument: the
 * two seats do not need a covariant preference order because they are not looking at
 * mirrored boards — they are looking at the same board. Snowball Throw's `dodgeSide` and
 * Frozen Beaks' seat-relative headings both exist to make a board-coordinate preference
 * covariant; this file has no board coordinates to be preferential about.
 *
 * A human's heading lands on exactly these vectors too — the pointer and the keys both
 * produce a per-axis sign, and a diagonal is normalised through the same `Math.SQRT1_2` —
 * so a bot cannot steer anywhere a player could not.
 */
const D = Math.SQRT1_2;
export const HEADINGS: readonly { readonly x: number; readonly y: number }[] = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: D, y: -D }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: D, y: D }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -D, y: D }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: -D, y: -D }),
]);

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Three knobs, and each of them is a different thing a person is better or worse at.
 *
 * Nothing here is information a player does not have. Every coral head, every piranha and
 * the shoal's own speed are on the board and drawn — the speed as a gauge down the middle
 * of the device, precisely so that "they are faster than me now" is something a player
 * reads rather than something a bot knows. What a weaker tier is denied is attention,
 * care and foresight, never sight, and every heading it picks is one of the nine a
 * player has.
 */
export interface BotProfile {
  /**
   * Seconds between decisions. Between them it holds the heading it chose, which is why a
   * slower tier swims further on a stale plan and runs into more coral.
   */
  readonly think: number;
  /**
   * How often a decision comes out as nothing at all: it looks up and sees no change.
   *
   * A blunder rate rather than an aim error, because a blunder is not a direction and so
   * cannot double as a tactic the way Snowball Throw's aim error and Cup Pong's `wander`
   * both did.
   */
  readonly blunder: number;
  /**
   * Seconds of swimming it projects along a heading before scoring it.
   *
   * The foresight knob. A short projection judges a heading on where the shoal is now; a
   * long one judges it on where the swimmer would be committed to when it got there.
   */
  readonly lookAhead: number;
}

/**
 * The three tiers.
 *
 * Every one of these is a strong knob on its own, so the shipped spread is deliberately
 * narrow — three strong knobs pulled apart by intuition compound into a ladder nobody can
 * climb. SPEC.md carries every sweep.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ think: 0.4, blunder: 0.26, lookAhead: 0.55 }),
  normal: Object.freeze({ think: 0.26, blunder: 0.14, lookAhead: 1.0 }),
  hard: Object.freeze({ think: 0.16, blunder: 0.04, lookAhead: 1.5 }),
});

/** How much the gap between decisions wanders, as a fraction. One draw. */
export const REACTION_WANDER = 0.25;

/**
 * How far ahead a bot insists on clear water before it will swim somewhere.
 *
 * Not a difficulty knob — every tier uses it, and it is the shape of the game rather than
 * a handicap. Below this a heading is refused outright however open it looks further on,
 * so no tier ever swims knowingly into a coral head it can see; what separates the tiers
 * is how stale their plan is when they do, which is where the game is.
 */
export const ESCAPE_ROOM = SWIM_RADIUS * 2;

/**
 * How much a heading's open water is worth against a body length of daylight from the
 * shoal.
 *
 * Small on purpose: fleeing is the game and room is the tie-break, so this only decides
 * between two headings the shoal is equally far from. It is not a difficulty knob for the
 * reason SPEC.md records — swept alone it is flat.
 */
export const ROOM_WEIGHT = 0.12;

/** Values a bot draws per decision. Always this many, always before any branch. */
export const BOT_DRAWS_PER_DECISION = 2;

export interface BotState {
  cooldown: number;
  /** The heading it is swimming, in lagoon-local units. */
  wantX: number;
  wantY: number;
  /** Whether this cycle's look saw anything. */
  blundering: boolean;
}

export function createBotState(): BotState {
  return { cooldown: 0, wantX: 0, wantY: 0, blundering: false };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.wantX = 0;
  state.wantY = 0;
  state.blundering = false;
}

/**
 * Which of the eight headings to swim, and it is the whole of the bot's plan.
 *
 * A heading is scored by the daylight it buys: project the swimmer along it for
 * `lookAhead` seconds — or up to whatever the reef and the rim allow, whichever is nearer
 * — and ask how close the shoal would be to the halfway point and to the far end of that
 * run, allowing for how far a piranha travels in the same time. The nearest of those four
 * numbers is the heading's worth, with open water as a small tie-break so an empty line
 * still prefers the middle of the lagoon to a corner.
 *
 * A heading with less than {@link ESCAPE_ROOM} of clear water is refused outright and
 * ranked by how much room it has, so a swimmer boxed into a corner still picks the least
 * bad way out rather than the first one it happens to test.
 */
export function chooseHeading(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
): void {
  const lagoon = lagoonOf(game, seat);
  const swimmer = lagoon.swimmer;
  const speed = piranhaSpeed(game.elapsed);

  let bestScore = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < HEADINGS.length; i += 1) {
    const heading = HEADINGS[i] as { readonly x: number; readonly y: number };
    const dx = heading.x;
    const dy = heading.y;
    const rim = rimAlong(swimmer.x, swimmer.y, dx, dy);
    const reef = coralAlong(game.corals, swimmer.x, swimmer.y, dx, dy);
    const room = rim < reef ? rim : reef;
    let score: number;
    if (room < ESCAPE_ROOM) {
      score = room - 10000;
    } else {
      const span = Math.min(room, SWIM_SPEED * profile.lookAhead);
      // Two samples, because a piranha sitting halfway along a line is not visible from
      // its far end: scoring the endpoint alone sends a swimmer straight through the
      // shoal to the open water on the other side of it.
      const half = span / 2;
      const mid =
        nearestPiranha(lagoon, swimmer.x + dx * half, swimmer.y + dy * half) -
        (speed * half) / SWIM_SPEED;
      const far =
        nearestPiranha(lagoon, swimmer.x + dx * span, swimmer.y + dy * span) -
        (speed * span) / SWIM_SPEED;
      score = (mid < far ? mid : far) + room * ROOM_WEIGHT;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const chosen = HEADINGS[bestIndex] as { readonly x: number; readonly y: number };
  state.wantX = chosen.x;
  state.wantY = chosen.y;
}

/**
 * Decide where to swim. Allocation-free; writes into `out`.
 *
 * A bot steers through the same nine headings and the same {@link SWIM_SPEED} a person
 * gets, so it cannot swim anywhere a player could not have swum. It never chooses the
 * ninth — treading water scores nothing and dodges nothing — which is a judgement about
 * this game rather than a restriction on the vocabulary.
 */
export function botStep(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
  rng: Rng,
  dt: number,
  out: Command,
): void {
  state.cooldown -= dt;
  if (state.cooldown <= 0) {
    // Both drawn up front, unconditionally, so the count can never depend on the water.
    const jitter = rng.float();
    const blunderRoll = rng.float();
    state.cooldown = profile.think * (1 + (jitter * 2 - 1) * REACTION_WANDER);
    state.blundering = blunderRoll < profile.blunder;
    if (!state.blundering) chooseHeading(game, seat, profile, state);
  }
  out.dirX = state.wantX;
  out.dirY = state.wantY;
}

export function botCommand(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  dt: number,
  out: Command,
): void {
  botStep(game, seat, BOT_PROFILES[difficulty], state, rng, dt, out);
}
