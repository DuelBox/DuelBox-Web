import { createContact, envelopeFor, sweptCircleCircle, sweptCircleSegment } from '@duelbox/engine';
import type { Circle, Contact, Rng, SeatId, Segment } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Snowball Throw, as pure rules.
 *
 * Two people at opposite ends of a snowfield. A snowball packs itself in your hands and
 * grows through three sizes; let go and you throw the one you have. Which way you were
 * walking when you let go curves it. Two ice walls stand across the middle and take the
 * throws that miss. First to knock the other's health to nothing wins.
 *
 * No rendering, no timing, no DOM — the bot, the balance harness and the tests all reuse
 * this module.
 *
 * ## The three decisions this file exists to record
 *
 * **A throw is two discrete numbers, never a drag.** `docs/input-parity.md` says a drag
 * hands a thumb a continuous quantity a key cannot match, and the catalogue row for this
 * game describes exactly that ("pull back to aim"). So the throw carries a **size** (three
 * values) and a **lean** (three values) and nothing else. Nine trajectories, each one
 * nameable by a key and by a finger with identical effort. See SPEC.md.
 *
 * **The snowball packs on its own clock, not on the press.** `actionHeld` is
 * `keys.action || pointerDown` (`packages/engine/src/input.ts`), so a finger on the glass
 * *is* the action: a pointer cannot steer without holding, and cannot signal a discrete
 * event without letting go and steering nothing for as long as the finger is off. If the
 * pack timer restarted on the press, every lift would cost the pointer player progress a
 * keyboard player keeps. It does not restart: it runs from the last throw, so a lift costs
 * only the walk, and the two instruments have the identical set of decisions.
 *
 * **The ball has a lateral acceleration and the bot solves it in closed form**, so the two
 * expressions of the same parabola have to agree exactly. They do, because the travel
 * carries its `½·a·dt²` term — see {@link stepBalls} and {@link predictAtY}, and commit
 * b4af006 for the five games that got this wrong.
 */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** Where the two ice walls stand, and the line the clock bar is drawn on. */
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** Each thrower's line. Symmetric about the centre, so the board is its own half-turn. */
export const BASELINE_P1 = 820;
export const BASELINE_P2 = 180;

/**
 * How big a thrower is, and why it is this big.
 *
 * The number that decides whether this game exists is
 * `(THROWER_RADIUS + ball radius) / MOVE_SPEED` against the ball's time of flight. It is
 * how long stepping clear takes, against how long there is to do it. The first geometry
 * had a 26-unit thrower crossing a 760-unit field in 0.8 s and the two came out at 0.16 s
 * against 0.78: **every throw was dodgeable on reaction, by anybody**, and two competent
 * players simply never hit each other. Measured, 200 matches a tier: `normal` landed 1.6%
 * of its throws and `hard` landed **none at all** — 192 of 200 matches drawn nil-all at the
 * whistle. No bot tuning reaches that, because the bots were playing correctly.
 *
 * A wide thrower and a fast ball put the two times within a frame or two of each other, so
 * a throw aimed where somebody is standing is not answerable by reacting to it. What
 * answers it is having already moved, which is the contest a snowball fight actually is.
 */
export const THROWER_RADIUS = 40;

/**
 * How far along their line a thrower may walk.
 *
 * 504 units of lane against a 240-unit-a-second walk: crossing it takes 2.1 s, which is
 * three times the longest throw's time of flight. Nobody outruns a snowball to the far
 * side of the field, so a dodge is a step aside rather than a sprint.
 */
export const LANE_MIN = 48;
export const LANE_MAX = BOARD_WIDTH - LANE_MIN;

export const MOVE_SPEED = 240;

/**
 * How far a finger must sit from a thrower before it means "walk".
 *
 * Four precision envelopes, not a hand-picked number: `docs/input-idiom.md` counts
 * twenty-two bare deadzone constants across the catalogue meaning the same thing at
 * between two and six envelopes apiece. One envelope here is `min(600, 1000) / 200 = 3`
 * units, so this is 12 — and it is the same twelve for a bot, which steers to a wanted
 * spot through the identical test.
 */
export const MOVE_DEADZONE = 4 * envelopeFor({ width: BOARD_WIDTH, height: BOARD_HEIGHT });

/**
 * The three sizes of snowball.
 *
 * Discrete, and that is the fairness decision this game turns on. A continuous power meter
 * has its optimum at the top of the meter, so every player is always releasing at a
 * boundary and every millisecond of input latency is a power difference. Three sizes with
 * half-second plateaus have no reward for releasing at a boundary at all: you release
 * comfortably inside the size you want, and a 30 ms difference between a key and a thumb
 * buys nothing.
 *
 * Bigger is slower **and wider**, which is what stops any one of them dominating. A
 * perfect stream of each does 1.67, 1.82 and 1.76 damage a second — near enough flat — so
 * the choice is never about throughput. It is about the margin above: a jab arrives before
 * a step aside can finish and is worth one, a boulder can be stepped away from but is
 * eighty-eight units across and is worth three.
 */
export interface Stage {
  /** Seconds of packing before this size is available. */
  readonly windUp: number;
  /** Logical units a second, down the field. Constant for the whole flight. */
  readonly speed: number;
  readonly radius: number;
  readonly damage: number;
}

export const STAGES: readonly Stage[] = Object.freeze([
  Object.freeze({ windUp: 0.6, speed: 1480, radius: 16, damage: 1 }),
  Object.freeze({ windUp: 1.1, speed: 1140, radius: 28, damage: 2 }),
  Object.freeze({ windUp: 1.7, speed: 900, radius: 44, damage: 3 }),
]);

/**
 * Lateral acceleration a leaning throw carries, in units a second squared.
 *
 * An acceleration rather than a sideways velocity, so the ball flies almost straight
 * through the gap between the walls and hooks in the second half of its flight. By the
 * wall line it has moved 10, 15 and 21 units by size; by the far baseline it has moved 47,
 * 76 and 115. Threading a gap and arriving on a target are therefore two different
 * problems, which is what makes the lean worth having at all.
 */
export const CURVE = 600;

/**
 * Hit points each. Damage is 1, 2 or 3, so a match is eight to twenty landed throws.
 *
 * Ten made a match at every tier last twelve to seventeen seconds, which is a rally rather
 * than a game. Twenty is what puts two `easy` seats at half a minute and two `hard` seats
 * at three quarters of one, with the ninety-second clock still a backstop nobody reaches.
 */
export const HEALTH = 20;

/**
 * The clock, in seconds, and the only reason this game is guaranteed to end.
 *
 * `roundSeconds` ends nothing — it is text on a catalogue card — so the clock lives here.
 * Two `easy` bots dodge well enough to reach the whistle in about one match in six; every
 * other pairing knocks somebody out first.
 */
export const MATCH_SECONDS = 90;

/** Seconds a thrower is drawn flashing after taking a hit. Presentation, kept in state so
 * a restored snapshot looks like the match it came from. */
export const FLASH_SECONDS = 0.25;

export const WALL_Y = CENTRE_Y;
/** Chips a wall absorbs before it shatters. Damage-weighted, so a boulder costs three. */
export const WALL_HEALTH = 7;

/**
 * Where the ice stands.
 *
 * Two walls leave three lanes — 100 units at each edge and 120 up the middle. A boulder is
 * 88 units across, so it fits through any of the three but with very little to spare,
 * while a jab threads all of them easily: the ice is a size filter as well as a shield.
 * The pair is symmetric about `x = 300` and lies on the centre line, so the whole field is
 * unchanged by the half-turn that separates the two seats. Neither player has a better
 * board than the other at any moment of the match.
 */
export const WALL_SPANS: readonly { readonly x1: number; readonly x2: number }[] = Object.freeze([
  Object.freeze({ x1: 100, x2: 240 }),
  Object.freeze({ x1: 360, x2: 500 }),
]);

/**
 * How many snowballs may be in the air at once.
 *
 * The fastest sustainable cadence is one every 0.6 s and the longest a ball is on the
 * board is 1.6 s, so three a seat is the real ceiling and this is double it. A test plays
 * matches at every tier and asserts the pool never fills, because a full pool would
 * silently swallow a throw and that is a rule nobody could see.
 */
export const MAX_BALLS = 12;

export interface Ball {
  active: boolean;
  owner: SeatId;
  stage: number;
  x: number;
  y: number;
  /** Position at the start of the step, for render interpolation and the swept tests. */
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  /** Lateral acceleration: `lean * CURVE`. Constant for the whole flight. */
  ax: number;
  /**
   * Seconds since it left a hand. Counted, not derived, and that is load-bearing — see
   * {@link ballAge}.
   */
  age: number;
}

export interface Thrower {
  x: number;
  prevX: number;
  /** −1, 0 or +1, in board coordinates. The seat mirror is applied before this. */
  dir: number;
  /**
   * The direction walked on the **previous** step, which is the one a throw leans on.
   *
   * The pointer is already null on the step that reports `actionReleased`
   * (`docs/input-idiom.md`, fact 2), so a lean read on the release step is zero for a
   * finger and non-zero for a key — the same gesture, two different throws. Carrying the
   * previous step's direction makes the two identical, and a test asserts it.
   */
  lean: number;
  /** Seconds of packing since the last throw. Never reset by a press. */
  ready: number;
  health: number;
  /** Throws that landed on the other seat. The tiebreak when the clock runs out level. */
  hits: number;
  throws: number;
  flash: number;
}

export interface Wall {
  chips: number;
  readonly x1: number;
  readonly x2: number;
}

export interface Game {
  readonly balls: Ball[];
  readonly walls: Wall[];
  readonly p1: Thrower;
  readonly p2: Thrower;
  /** Seconds left. Counts down; the whistle is the only structural end. */
  clock: number;
  winner: SeatId | 'draw' | null;
}

/** What one seat is asking for this step. The whole input surface of the simulation. */
export interface Command {
  /** −1, 0 or +1 in board coordinates. Rate-limited identically for every source. */
  dir: number;
  /** The release edge. Throws the packed snowball, if there is one. */
  release: boolean;
}

export function createCommand(): Command {
  return { dir: 0, release: false };
}

export const WIN_CONDITION: WinCondition = Object.freeze({ kind: 'reduce-to-zero' });

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function baselineOf(seat: SeatId): number {
  return seat === 'p1' ? BASELINE_P1 : BASELINE_P2;
}

/** Which way this seat's throws travel down the board. */
export function firingSign(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

export function throwerOf(game: Readonly<Game>, seat: SeatId): Thrower {
  return seat === 'p1' ? game.p1 : game.p2;
}

function makeThrower(): Thrower {
  return {
    x: BOARD_WIDTH / 2,
    prevX: BOARD_WIDTH / 2,
    dir: 0,
    lean: 0,
    ready: 0,
    health: HEALTH,
    hits: 0,
    throws: 0,
    flash: 0,
  };
}

function makeBall(): Ball {
  return {
    active: false,
    owner: 'p1',
    stage: 0,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    ax: 0,
    age: 0,
  };
}

export function createGame(): Game {
  const balls: Ball[] = [];
  for (let i = 0; i < MAX_BALLS; i += 1) balls.push(makeBall());
  const walls: Wall[] = [];
  for (let i = 0; i < WALL_SPANS.length; i += 1) {
    const span = WALL_SPANS[i] as { readonly x1: number; readonly x2: number };
    walls.push({ chips: WALL_HEALTH, x1: span.x1, x2: span.x2 });
  }
  return { balls, walls, p1: makeThrower(), p2: makeThrower(), clock: MATCH_SECONDS, winner: null };
}

function resetThrower(thrower: Thrower): void {
  thrower.x = BOARD_WIDTH / 2;
  thrower.prevX = BOARD_WIDTH / 2;
  thrower.dir = 0;
  thrower.lean = 0;
  thrower.ready = 0;
  thrower.health = HEALTH;
  thrower.hits = 0;
  thrower.throws = 0;
  thrower.flash = 0;
}

export function resetGame(game: Game): void {
  for (let i = 0; i < game.balls.length; i += 1) (game.balls[i] as Ball).active = false;
  for (let i = 0; i < game.walls.length; i += 1) (game.walls[i] as Wall).chips = WALL_HEALTH;
  resetThrower(game.p1);
  resetThrower(game.p2);
  game.clock = MATCH_SECONDS;
  game.winner = null;
}

/** The largest size packed by `ready` seconds, or −1 when there is nothing to throw yet. */
export function stageFor(ready: number): number {
  for (let i = STAGES.length - 1; i >= 0; i -= 1) {
    if (ready >= (STAGES[i] as Stage).windUp) return i;
  }
  return -1;
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Where a snowball of this size leaves a thrower's hand, measured down the board. */
export function launchY(seat: SeatId, stage: number): number {
  const size = STAGES[stage] as Stage;
  return baselineOf(seat) + firingSign(seat) * (THROWER_RADIUS + size.radius);
}

/**
 * Seconds for a throw of this size to reach the line `y`, or NaN when it never does.
 *
 * Vertical speed is constant — only the sideways component accelerates — so this is a
 * division rather than a quadratic, and it is exact.
 */
export function flightTo(seat: SeatId, stage: number, y: number): number {
  const size = STAGES[stage] as Stage;
  const time = (y - launchY(seat, stage)) / (firingSign(seat) * size.speed);
  return time > 0 ? time : Number.NaN;
}

/**
 * Where a throw released now, at `x0` with this size and lean, crosses the line `y`.
 *
 * The closed form of what {@link stepBalls} integrates, and the bot's whole model of its
 * own physics. The two are the same parabola because the integrator carries its
 * `½·a·dt²` term: after `n` steps of `x += vx·dt + ½·ax·dt²` followed by `vx += ax·dt`,
 * the sum telescopes to exactly `x0 + ½·ax·(n·dt)²`. Written the other way round it lands
 * a whole `a·dt²` a step instead of half of one, and the bot would be aiming at a board
 * the game was not playing — the systematic bias commit b4af006 found in five games and
 * that no amount of tier tuning can reach. `rules.test.ts` drives both expressions over
 * every size and lean and asserts they agree to within a ten-thousandth of a unit.
 */
export function predictAtY(
  seat: SeatId,
  x0: number,
  stage: number,
  lean: number,
  y: number,
): number {
  const time = flightTo(seat, stage, y);
  if (Number.isNaN(time)) return Number.NaN;
  return x0 + 0.5 * lean * CURVE * time * time;
}

/** Where a throw crosses the far thrower's line: the point the whole game is aiming at. */
export function predictLanding(seat: SeatId, x0: number, stage: number, lean: number): number {
  return predictAtY(seat, x0, stage, lean, baselineOf(otherOf(seat)));
}

function spawnBall(game: Game, seat: SeatId, stage: number, x: number, lean: number): boolean {
  let slot = -1;
  for (let i = 0; i < game.balls.length; i += 1) {
    if (!(game.balls[i] as Ball).active) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return false;
  const size = STAGES[stage] as Stage;
  const ball = game.balls[slot] as Ball;
  ball.active = true;
  ball.owner = seat;
  ball.stage = stage;
  ball.x = x;
  ball.y = launchY(seat, stage);
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  ball.vx = 0;
  ball.vy = firingSign(seat) * size.speed;
  ball.ax = lean * CURVE;
  ball.age = 0;
  return true;
}

/**
 * Walk a thrower, and let go of a snowball if it was asked for.
 *
 * The throw is resolved **before** the walk, so a released snowball leaves the hand the
 * player was actually standing in rather than four units along. That is not cosmetic: the
 * bot decides to release from the position it can see, and a systematically stale launch
 * point is the same defect as a systematically wrong integrator.
 */
function driveSeat(
  thrower: Thrower,
  game: Game,
  seat: SeatId,
  command: Readonly<Command>,
  dt: number,
): void {
  if (command.release) {
    const stage = stageFor(thrower.ready);
    if (stage >= 0 && spawnBall(game, seat, stage, thrower.x, thrower.lean)) {
      thrower.ready = 0;
      thrower.throws += 1;
    }
  }
  thrower.prevX = thrower.x;
  thrower.x = clamp(thrower.x + command.dir * MOVE_SPEED * dt, LANE_MIN, LANE_MAX);
  thrower.dir = command.dir;
  thrower.lean = command.dir;
  thrower.ready += dt;
  if (thrower.flash > 0) thrower.flash = Math.max(0, thrower.flash - dt);
}

/* Scratch shapes. Allocated once at module load and reused, so a step allocates nothing. */
const contact: Contact = createContact();
const ballShape: Circle = { x: 0, y: 0, radius: 0 };
const targetShape: Circle = { x: 0, y: 0, radius: THROWER_RADIUS };
const wallShape: Segment = { x1: 0, y1: WALL_Y, x2: 0, y2: WALL_Y };
const tally = { p1: 0, p2: 0 };

/**
 * Move every snowball one step and see what it hit.
 *
 * Swept, never sampled. A size-one ball covers 16.3 units in a 60 Hz step and an ice wall
 * is a line with no thickness at all, so testing only the ends of the step would let a
 * throw pass straight through one. `sweptCircleSegment` and `sweptCircleCircle` solve the
 * whole step; `packages/engine/src/collision.test.ts` fires at 5000 units a second against
 * both. There is no `sweptCircleAabb` (issue #111), which is why the walls are segments —
 * treated as capsules of the ball's radius, so a wall is as thick as whatever hits it.
 *
 * The target is moving too, so it is tested against the ball's displacement **relative to
 * the thrower's**. A stationary test would miss a ball and a thrower converging inside one
 * step, and would report a hit for two that pass through the same point at different times.
 */
function stepBalls(game: Game, dt: number): void {
  const halfStepSq = 0.5 * dt * dt;
  for (let i = 0; i < game.balls.length; i += 1) {
    const ball = game.balls[i] as Ball;
    if (!ball.active) continue;
    const size = STAGES[ball.stage] as Stage;

    ball.prevX = ball.x;
    ball.prevY = ball.y;
    const dx = ball.vx * dt + ball.ax * halfStepSq;
    const dy = ball.vy * dt;

    ballShape.x = ball.prevX;
    ballShape.y = ball.prevY;
    ballShape.radius = size.radius;

    let bestTime = Infinity;
    let bestWall = -1;
    let hitTarget = false;

    for (let w = 0; w < game.walls.length; w += 1) {
      const wall = game.walls[w] as Wall;
      if (wall.chips <= 0) continue;
      wallShape.x1 = wall.x1;
      wallShape.x2 = wall.x2;
      if (!sweptCircleSegment(contact, ballShape, dx, dy, wallShape)) continue;
      if (contact.depth < bestTime) {
        bestTime = contact.depth;
        bestWall = w;
      }
    }

    const target = throwerOf(game, otherOf(ball.owner));
    targetShape.x = target.prevX;
    targetShape.y = baselineOf(otherOf(ball.owner));
    const targetDx = target.x - target.prevX;
    if (sweptCircleCircle(contact, ballShape, dx - targetDx, dy, targetShape)) {
      if (contact.depth < bestTime) {
        bestTime = contact.depth;
        bestWall = -1;
        hitTarget = true;
      }
    }

    if (bestWall >= 0) {
      const wall = game.walls[bestWall] as Wall;
      wall.chips = Math.max(0, wall.chips - size.damage);
      ball.active = false;
      continue;
    }
    if (hitTarget) {
      target.health = Math.max(0, target.health - size.damage);
      target.flash = FLASH_SECONDS;
      throwerOf(game, ball.owner).hits += 1;
      ball.active = false;
      continue;
    }

    ball.x += dx;
    ball.y += dy;
    ball.vx += ball.ax * dt;
    ball.age += dt;
    const margin = size.radius;
    if (
      ball.x < -margin ||
      ball.x > BOARD_WIDTH + margin ||
      ball.y < -margin ||
      ball.y > BOARD_HEIGHT + margin
    ) {
      ball.active = false;
    }
  }
}

/**
 * Who has won, or null while the match is still on.
 *
 * The knockout goes through the SDK's `reduce-to-zero`, which is the shared spelling of
 * the observed rule and is also what makes a double knockout a draw rather than a win for
 * whichever seat the loop happened to reach first — both seats' throws land before either
 * health is read.
 *
 * The whistle is settled here rather than by passing `timeExpired`, because this game has
 * a tiebreak the helper has no way to know about: level on health, the seat that **landed
 * more throws** takes it. Health is a number between nought and ten and two players of the
 * same standard sit on the same one of those eleven values often; landed throws separate
 * a pair who traded four ones against two twos.
 */
function judge(game: Game): void {
  tally.p1 = game.p1.health;
  tally.p2 = game.p2.health;
  const knockout = resolve(WIN_CONDITION, tally);
  if (knockout !== null) {
    game.winner = knockout;
    return;
  }
  if (game.clock > 0) return;
  if (game.p1.health !== game.p2.health) {
    game.winner = game.p1.health > game.p2.health ? 'p1' : 'p2';
    return;
  }
  if (game.p1.hits !== game.p2.hits) {
    game.winner = game.p1.hits > game.p2.hits ? 'p1' : 'p2';
    return;
  }
  game.winner = 'draw';
}

/** One fixed step. Deterministic, and allocates nothing. */
export function step(
  game: Game,
  dt: number,
  p1Command: Readonly<Command>,
  p2Command: Readonly<Command>,
): void {
  if (game.winner !== null) return;

  driveSeat(game.p1, game, 'p1', p1Command, dt);
  driveSeat(game.p2, game, 'p2', p2Command, dt);
  stepBalls(game, dt);

  game.clock = Math.max(0, game.clock - dt);
  judge(game);
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export function activeBalls(game: Readonly<Game>): number {
  let count = 0;
  for (let i = 0; i < game.balls.length; i += 1) if ((game.balls[i] as Ball).active) count += 1;
  return count;
}

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Five knobs, and each of them is a different thing a person is better or worse at.
 *
 * Nothing here is information a player does not have. Every snowball's position, size and
 * hook are on the board — the hook is drawn as a tick on its leading edge, precisely so
 * that reading it is a skill and not a privilege — and so is the walls' remaining ice and
 * which way the other player is walking. What a weaker tier is denied is time, attention
 * and patience, never sight.
 */
export interface BotProfile {
  /** Seconds between decisions. Between them it holds the spot it chose. */
  readonly think: number;
  /**
   * Seconds a snowball must have been in the air before this tier reacts to it.
   *
   * The honest model of a reaction time, and it has to be separate from `think`: a decision
   * cadence delays a reply by a *uniform* draw between nought and the cadence, so a bot
   * deciding every 0.18 s answers a throw in 0.09 s on average — half what the number
   * appears to promise, and enough for `hard` to step clear of everything. Measured on the
   * first tuned build: `hard` against `hard` landed 5.1% of ninety-nine throws a match and
   * reached the whistle 89 times in a hundred.
   *
   * A ball's age is read off its own position — `(y − launchY) / vy`, exact because the
   * vertical speed is constant — so this costs no state and cannot drift.
   */
  readonly notice: number;
  /**
   * How often a decision comes out as nothing at all: the tier looks up, and does not see
   * the throw that is already on its way.
   *
   * A blunder rate rather than an aim error, and that is a measurement rather than a
   * preference. The first version handed each tier an aim error in units and added it to
   * the point the bot both walked to and threw at — the honest model of a mistaken belief
   * about where the other player is. Swept alone it came out **backwards**: 77.0, 75.8,
   * 84.0 and 89.0 per cent won against an untouched `normal` at errors of 0, 34, 78 and
   * 150 units. A large error is a large *standing offset*, and standing off the other
   * player's line is worth more on defence than it costs on offence, so the accuracy knob
   * was paying for itself twice over. It went, exactly as Cup Pong's `wander` did.
   *
   * A blunder cannot do that, because it is not a direction. It is monotone by
   * construction and measures monotone: 86.4, 81.6, 77.5, 68.1, 54.7 and 38.2 per cent at
   * 0, 0.05, 0.12, 0.22, 0.35 and 0.55.
   */
  readonly blunder: number;
  /**
   * How much daylight it tries to leave between itself and where a throw will land.
   *
   * The one knob that is not monotone, and it is worth being exact about: below about ten
   * units it falls off a cliff (4.6% and 11.6% won at 0 and 5, against 80.8% at 10) because
   * a dodge that only just clears the ball does not clear a ball that is being aimed, and
   * above about twenty-five it declines slowly (81.9%, 76.8%, 74.0% at 26, 45 and 80)
   * because over-stepping wastes position. The three tiers sit on the plateau and the knob
   * is carried for the cliff, not for the slope.
   */
  readonly clearance: number;
  /**
   * How long past the size it was waiting for it will hold out for a good shot.
   *
   * Also the guarantee that a throw eventually happens: see {@link wantsRelease}. Monotone
   * and saturating — 28.4, 62.7, 81.6, 92.2 and 92.8 per cent at 0, 0.2, 0.44, 0.8 and 1.5
   * seconds — and the tier that throws the instant it has something is much the weakest.
   */
  readonly patience: number;
}

/**
 * The three tiers, and they are deliberately close together.
 *
 * Every knob here is strong: swept alone against an untouched `normal`, `think` runs from
 * 100% to 8% across its useful range and `notice` from 98% to 17%. Five strong knobs pulled
 * apart by intuition compound into a ladder nobody can climb — the first tuned set had
 * `normal` beating `easy` 97 times in a hundred and `hard` beating `normal` 98. The
 * shipped spread is a few hundredths of a second on each, and it is what a 95/81/75 ladder
 * actually costs. SPEC.md carries every sweep.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    think: 0.29,
    notice: 0.235,
    blunder: 0.15,
    clearance: 11,
    patience: 0.32,
  }),
  normal: Object.freeze({
    think: 0.27,
    notice: 0.205,
    blunder: 0.1,
    clearance: 13,
    patience: 0.38,
  }),
  hard: Object.freeze({
    think: 0.25,
    notice: 0.18,
    blunder: 0.05,
    clearance: 15,
    patience: 0.44,
  }),
});

/** How much the gap between decisions wanders, as a fraction. One draw. */
export const REACTION_WANDER = 0.25;

/**
 * How far off the other player's line a bot prefers to stand, in units.
 *
 * Not a difficulty knob — every tier uses it, and it is the shape of the game rather than
 * a handicap. It applies only **while a bot has nothing ready to throw**: it waits off the
 * other player's line while it packs, and steps onto it to throw. Standing off permanently
 * does not work, and the measurement is unambiguous — with the post held whatever was in
 * hand, `normal` and `hard` landed 4.8% and 2.1% of their throws and every match ran the
 * full ninety seconds, because a throw from seventy units off the line misses unless it is
 * leaning and a bot standing at its post is not walking.
 *
 * Without any standoff the opposite happens: both bots walk onto each other's line and
 * stand there trading throws they cannot miss — 86.6% of throws landed between two `easy`
 * seats, and a match over in fifteen seconds.
 */
export const STANDOFF = 70;

/**
 * Values a bot draws per decision. Always exactly this many, always before any branch on
 * what it can see, so the count cannot depend on the match — and each seat draws from its
 * own stream, so the order the two are polled in cannot be observed either.
 */
export const BOT_DRAWS_PER_DECISION = 3;

export interface BotState {
  cooldown: number;
  /** Where along its line it is walking to. */
  wantX: number;
  /** Whether this cycle's look missed the throw coming at it. */
  blundering: boolean;
  /** The smallest size it is prepared to throw this cycle. */
  capStage: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, wantX: BOARD_WIDTH / 2, blundering: false, capStage: 0 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.wantX = BOARD_WIDTH / 2;
  state.blundering = false;
  state.capStage = 0;
}

/** Where an in-flight snowball will cross the line `y`, from its state right now. */
export function ballCrossing(ball: Readonly<Ball>, y: number): number {
  const time = (y - ball.y) / ball.vy;
  if (!(time > 0)) return Number.NaN;
  return ball.x + ball.vx * time + 0.5 * ball.ax * time * time;
}

export function ballTimeTo(ball: Readonly<Ball>, y: number): number {
  const time = (y - ball.y) / ball.vy;
  return time > 0 ? time : Number.NaN;
}

/**
 * How long this snowball has been in the air.
 *
 * **Counted, and it used to be derived — `(y − launchY) / vy`, which is algebraically exact
 * and cost this game fourteen points of seat balance.**
 *
 * The two seats' throws accumulate their `y` by repeated addition from opposite ends of the
 * board: one counts up from 236 and the other down from 764, and floating-point addition is
 * not symmetric under `y → 1000 − y`. Two mirror-image balls therefore differ in the last
 * bit or two of their age. That is harmless everywhere except at a threshold, and
 * `ballAge(ball) < profile.notice` is a hard threshold — an age is a whole number of frames
 * and `notice` is written in hundredths of a second, so ages land on it, and when one does
 * the two sides of the mirror take opposite branches and one seat starts its dodge a frame
 * before the other.
 *
 * Measured, 1000 seeded matches a tier: seat one took 49.0%, 55.5% and **64.3%** of decided
 * matches at `easy`, `normal` and `hard`. The bias rises with the tier because a stronger
 * tier decides twice as often and so meets the threshold twice as often; the mechanism was
 * confirmed end to end rather than argued, by playing every match against its own mirror —
 * **11 of 200 mirrored matches flipped their winner before this change and 299 of 300
 * after**, and the seat bias went with them.
 *
 * Counting from zero gives every ball the identical sequence of additions, so two mirror
 * images have bit-identical ages and the comparison cannot straddle. A snowball's position
 * still accumulates asymmetrically and always will; what matters is that no decision
 * threshold sits on a knife edge, and the position ones do not — the value they are
 * compared against is either a messy float or, for a throw with no lean, exact.
 */
export function ballAge(ball: Readonly<Ball>): number {
  return ball.age;
}

/** True when a throw of this shape would break on the ice rather than reach anybody. */
export function blockedByWall(
  game: Readonly<Game>,
  seat: SeatId,
  x0: number,
  stage: number,
  lean: number,
): boolean {
  const at = predictAtY(seat, x0, stage, lean, WALL_Y);
  if (Number.isNaN(at)) return false;
  const radius = (STAGES[stage] as Stage).radius;
  for (let i = 0; i < game.walls.length; i += 1) {
    const wall = game.walls[i] as Wall;
    if (wall.chips <= 0) continue;
    if (at >= wall.x1 - radius && at <= wall.x2 + radius) return true;
  }
  return false;
}

/**
 * Whether to let go this step.
 *
 * It counts **down to a moment it cannot miss** as well as watching for one. Waiting for
 * an alignment that may never arrive is how a real-time bot deadlocks — Cup Pong's needle
 * bot swept for ever on the second seed it was ever given — so `patience` past the size it
 * wanted forces the throw whatever the board looks like.
 */
export function wantsRelease(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: Readonly<BotState>,
): boolean {
  const me = throwerOf(game, seat);
  const stage = stageFor(me.ready);
  if (stage < 0) return false;
  const forced = me.ready >= (STAGES[state.capStage] as Stage).windUp + profile.patience;
  if (stage < state.capStage) return forced;
  if (blockedByWall(game, seat, me.x, stage, me.lean)) return forced;

  const foeSeat = otherOf(seat);
  const foe = throwerOf(game, foeSeat);
  const landing = predictLanding(seat, me.x, stage, me.lean);
  if (Number.isNaN(landing)) return forced;
  const want = foe.x;
  const reach = THROWER_RADIUS + (STAGES[stage] as Stage).radius;
  if (Math.abs(landing - want) <= reach) return true;
  return forced;
}

/**
 * Decide where to stand and whether to throw. Allocation-free; writes into `out`.
 *
 * Steering is rate-limited through the same deadzone and the same `MOVE_SPEED` a person
 * gets, so a bot cannot walk anywhere a player could not have walked.
 */
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

/**
 * The same decision against an arbitrary profile.
 *
 * Split out so the balance harness can sweep one knob at a time against an untouched
 * opponent without editing the shipped table — every number in SPEC.md's sweeps comes
 * through here.
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
  const me = throwerOf(game, seat);

  state.cooldown -= dt;
  if (state.cooldown <= 0) {
    // All four drawn up front, unconditionally, so the count can never depend on the board.
    const jitter = rng.float();
    const blunderRoll = rng.float();
    const sizeRoll = rng.float();
    state.cooldown = profile.think * (1 + (jitter * 2 - 1) * REACTION_WANDER);
    state.blundering = blunderRoll < profile.blunder;
    state.capStage = Math.min(STAGES.length - 1, Math.floor(sizeRoll * STAGES.length));
    state.wantX = chooseSpot(game, seat, profile, state);
  }

  const gap = state.wantX - me.x;
  out.dir = Math.abs(gap) <= MOVE_DEADZONE ? 0 : gap > 0 ? 1 : -1;
  out.release = wantsRelease(game, seat, profile, state);
}

/**
 * Which way to step out of a throw's path. −1 is toward the low end of the lane.
 *
 * **This is the one place a board-handed tie-break cost a whole match.** The obvious
 * spelling — `me.x <= landing ? step low : step high` — is not covariant under the
 * half-turn that separates the two seats: mirrored, an exact tie takes the same board
 * direction rather than the opposite one, so both seats step the same way when a throw is
 * dead on them, and only one of them is stepping the way its mirror image would.
 *
 * That looked like a rounding-order footnote and is not, because the tie is **common**.
 * Both throwers move in exact four-unit steps from the same starting x, so every position
 * either of them can ever hold is on one 127-point lattice; a throw with no lean has no
 * sideways velocity at all, so it crosses the far line at exactly the x it left from,
 * which is on that same lattice. `me.x === landing` is therefore an everyday event and not
 * a measure-zero one — the same shape as Cup Pong's needle lattice, where a gauge coarser
 * than the target decided throws that looked like aim.
 *
 * Measured over 300 seeded matches a tier, `hard` against `hard`: seat one took **64.3%**
 * of decided matches with the handed test and landed 25.3% of its throws against seat
 * two's 20.9%, with both seats' mean position 38 units left of the centre line. Freezing
 * both throwers removed the bias entirely, which is what pointed at the steering rather
 * than the physics.
 *
 * The replacement is covariant at every branch: step away from the throw; if it is dead
 * on, step toward whichever half of the lane has more room; if that is level too, keep
 * going the way you were already going; and if there is nothing left to go on, step to
 * the **seat's** own left rather than the board's.
 *
 * That last branch is not the corner case it looks like. Two bots chasing each other's
 * position both settle on the centre line, and a throw with no lean from the centre line
 * lands on the centre line — so "dead level in every respect" is how a large share of
 * matches *open*. A bare `1` there was still worth 62% of decided matches to seat one
 * with the aim error switched off entirely, which is what finally identified it: with no
 * signed randomness left anywhere, a symmetric game cannot prefer a seat, so the
 * preference had to be a constant.
 */
function dodgeSide(me: Readonly<Thrower>, seat: SeatId, landing: number): number {
  if (me.x !== landing) return me.x < landing ? -1 : 1;
  const centre = (LANE_MIN + LANE_MAX) / 2;
  if (landing !== centre) return landing < centre ? 1 : -1;
  if (me.lean !== 0) return me.lean;
  // Dead level in every respect. There is no answer the board can give that survives the
  // half-turn, so the answer comes from the **seat**: each player steps to their own left,
  // which is the same move for both of them and the mirror of each other on the board.
  return seat === 'p1' ? 1 : -1;
}

/**
 * Where to walk: out of the way of the soonest throw that would hit, or else in line with
 * the other player so a throw of one's own has somewhere to go.
 *
 * Both halves are read off the board. The dodge extrapolates an in-flight snowball with
 * exactly the arithmetic the simulation integrates, and `notice` is the only thing a weaker
 * tier is denied: it sees the same throw, later.
 */
export function chooseSpot(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: Readonly<BotState>,
): number {
  const me = throwerOf(game, seat);
  const foe = throwerOf(game, otherOf(seat));
  const armed = stageFor(me.ready) >= state.capStage;
  const post = clamp(foe.x + (armed ? 0 : standSide(me, foe, seat) * STANDOFF), LANE_MIN, LANE_MAX);
  // A blundered look does not see the board at all, so it goes back to its post exactly as
  // if nothing were on its way.
  if (state.blundering) return post;
  const myLine = baselineOf(seat);

  let soonest = Number.NaN;
  let soonestTime = Infinity;
  let soonestRadius = 0;
  for (let i = 0; i < game.balls.length; i += 1) {
    const ball = game.balls[i] as Ball;
    if (!ball.active || ball.owner === seat) continue;
    if (ballAge(ball) < profile.notice) continue;
    const time = ballTimeTo(ball, myLine);
    if (Number.isNaN(time) || time >= soonestTime) continue;
    const at = ballCrossing(ball, myLine);
    if (Number.isNaN(at)) continue;
    const radius = (STAGES[ball.stage] as Stage).radius;
    if (Math.abs(at - me.x) > THROWER_RADIUS + radius + profile.clearance) continue;
    soonest = at;
    soonestTime = time;
    soonestRadius = radius;
  }

  if (!Number.isNaN(soonest)) {
    const room = THROWER_RADIUS + soonestRadius + profile.clearance + 6;
    const side = dodgeSide(me, seat, soonest);
    const away = soonest + side * room;
    if (away >= LANE_MIN && away <= LANE_MAX) return away;
    return clamp(soonest - side * room, LANE_MIN, LANE_MAX);
  }

  return post;
}

/**
 * Which side of the other player to stand on: whichever side you are already on, and on a
 * dead tie the seat's own left. Covariant under the half-turn for the same reason
 * {@link dodgeSide} is, and for the same measured reason.
 */
function standSide(me: Readonly<Thrower>, foe: Readonly<Thrower>, seat: SeatId): number {
  if (me.x !== foe.x) return me.x < foe.x ? -1 : 1;
  return seat === 'p1' ? 1 : -1;
}
