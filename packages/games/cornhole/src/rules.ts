import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Cornhole, as pure rules.
 *
 * Each player throws four bags at a slanted board with a hole near the top. A bag in the
 * hole is three, a bag left on the board is one, and a bag on the ground is nothing.
 * **A bag that lands on another pushes it**, which is the whole game: a throw can knock an
 * opponent's bag off the board, or shove your own into the hole.
 *
 * Scoring is by *cancellation*. After a round, only the difference counts — eight points
 * against seven scores one, not eight. That is what stops a runaway and keeps a match
 * close enough to be worth finishing.
 *
 * No rendering, no timing, no DOM. All distances are logical units.
 */

/** The board a bag is aimed at. Its far edge is the top of the slant. */
export const BOARD_LEFT = 260;
export const BOARD_RIGHT = 640;
export const BOARD_TOP = 120;
export const BOARD_BOTTOM = 470;

/** The hole, near the top of the board. */
export const HOLE_X = (BOARD_LEFT + BOARD_RIGHT) / 2;
export const HOLE_Y = 210;
export const HOLE_RADIUS = 46;

export const BAG_RADIUS = 30;
export const BAGS_PER_ROUND = 4;
export const ROUNDS = 4;

/** Points that end a match early, as the real game does. */
export const TARGET_SCORE = 21;

export const IN_HOLE = 3;
export const ON_BOARD = 1;

/** Where a throw starts, at the near edge. */
export const THROW_X = HOLE_X;
export const THROW_Y = 830;

/**
 * How far a bag travels for a given power, and how much it drifts for a given angle.
 *
 * Power is in [0, 1] and angle in [-1, 1], so a game never has to know the geometry: the
 * whole flight is these two numbers plus the seeded wobble.
 */
export const MIN_REACH = 300;
export const MAX_REACH = 820;
export const MAX_DRIFT = 300;

/** How long a bag is in the air, in seconds. Presentation only; the landing is decided. */
export const FLIGHT_SECONDS = 0.75;

/** How far a landing bag shoves one it lands on. */
export const SHOVE = 62;

export interface Bag {
  readonly seat: SeatId;
  x: number;
  y: number;
  /** True once it has fallen through the hole and is out of play. */
  holed: boolean;
}

export type Phase = 'aiming' | 'flying' | 'round-over' | 'match-over';

export interface Game {
  readonly bags: Bag[];
  phase: Phase;
  toThrow: SeatId;
  /**
   * Who throws first in round zero. The shell's `context.openingSeat`, never a literal
   * `p1` — the SDK alternates it across the rounds of a best-of (#2466), and a game that
   * always opened with seat one would leave that rotation reaching nothing.
   */
  opener: SeatId;
  /** Bags each seat has left this round. */
  readonly left: { p1: number; p2: number };
  /** Match score, after cancellation each round. */
  readonly score: { p1: number; p2: number };
  round: number;
  /** Seconds left of the current flight. */
  flight: number;
  /** Where the bag in the air came from and is going, for the renderer. */
  readonly from: { x: number; y: number };
  readonly to: { x: number; y: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createGame(): Game {
  return {
    bags: [],
    phase: 'aiming',
    toThrow: 'p1',
    opener: 'p1',
    left: { p1: BAGS_PER_ROUND, p2: BAGS_PER_ROUND },
    score: { p1: 0, p2: 0 },
    round: 0,
    flight: 0,
    from: { x: THROW_X, y: THROW_Y },
    to: { x: THROW_X, y: THROW_Y },
  };
}

export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  game.bags.length = 0;
  game.phase = 'aiming';
  game.opener = opener;
  game.toThrow = opener;
  game.left.p1 = BAGS_PER_ROUND;
  game.left.p2 = BAGS_PER_ROUND;
  game.score.p1 = 0;
  game.score.p2 = 0;
  game.round = 0;
  game.flight = 0;
}

/** Whether a point is on the board's face. */
export function onBoard(x: number, y: number): boolean {
  return x >= BOARD_LEFT && x <= BOARD_RIGHT && y >= BOARD_TOP && y <= BOARD_BOTTOM;
}

/** Whether a point is inside the hole. */
export function inHole(x: number, y: number): boolean {
  const dx = x - HOLE_X;
  const dy = y - HOLE_Y;
  return dx * dx + dy * dy <= HOLE_RADIUS * HOLE_RADIUS;
}

/**
 * Where a throw lands, from an aim and a power.
 *
 * The wobble is seeded and small — enough that two identical throws are not identical,
 * which is what makes the game a game rather than a calibration exercise, but not so much
 * that skill stops mattering.
 */
export function landingOf(
  out: { x: number; y: number },
  angle: number,
  power: number,
  rng: Rng,
): { x: number; y: number } {
  const clampedAngle = angle < -1 ? -1 : angle > 1 ? 1 : angle;
  const clampedPower = power < 0 ? 0 : power > 1 ? 1 : power;
  const reach = MIN_REACH + (MAX_REACH - MIN_REACH) * clampedPower;
  const wobble = (rng.float() - 0.5) * 2 * WOBBLE;
  out.x = THROW_X + clampedAngle * MAX_DRIFT + wobble;
  out.y = THROW_Y - reach + (rng.float() - 0.5) * 2 * WOBBLE;
  return out;
}

/** How far a landing can stray from where it was aimed. */
export const WOBBLE = 22;

const landingScratch = { x: 0, y: 0 };

/**
 * Settle a bag that has just landed.
 *
 * A bag landing on another **shoves it away**, which can push a bag into the hole or off
 * the board entirely. Only one shove per landing: a chain reaction would make a single
 * throw unpredictable in a way the player could not have planned.
 */
export function settle(game: Game, landed: Bag): void {
  for (const bag of game.bags) {
    if (bag === landed || bag.holed) continue;
    const dx = bag.x - landed.x;
    const dy = bag.y - landed.y;
    const distance = Math.hypot(dx, dy);
    if (distance > BAG_RADIUS * 2) continue;
    // Straight away from the landing, or straight up the board when exactly on top.
    const nx = distance === 0 ? 0 : dx / distance;
    const ny = distance === 0 ? -1 : dy / distance;
    bag.x += nx * SHOVE;
    bag.y += ny * SHOVE;
    if (inHole(bag.x, bag.y)) bag.holed = true;
  }
  if (inHole(landed.x, landed.y)) landed.holed = true;
}

/**
 * Throw a bag.
 *
 * Returns false when it is not this seat's turn or they have none left, so a refusal is
 * never mistaken for a throw that scored nothing.
 */
export function throwBag(
  game: Game,
  seat: SeatId,
  angle: number,
  power: number,
  rng: Rng,
): boolean {
  if (game.phase !== 'aiming') return false;
  if (game.toThrow !== seat) return false;
  const left = seat === 'p1' ? game.left.p1 : game.left.p2;
  if (left <= 0) return false;

  landingOf(landingScratch, angle, power, rng);
  const bag: Bag = { seat, x: landingScratch.x, y: landingScratch.y, holed: false };
  game.bags.push(bag);
  settle(game, bag);

  if (seat === 'p1') game.left.p1 -= 1;
  else game.left.p2 -= 1;

  game.from.x = THROW_X;
  game.from.y = THROW_Y;
  game.to.x = bag.x;
  game.to.y = bag.y;
  game.phase = 'flying';
  game.flight = FLIGHT_SECONDS;
  return true;
}

/** What a seat's bags are worth on the board right now, before cancellation. */
export function rawScoreOf(game: Readonly<Game>, seat: SeatId): number {
  let total = 0;
  for (const bag of game.bags) {
    if (bag.seat !== seat) continue;
    if (bag.holed) total += IN_HOLE;
    else if (onBoard(bag.x, bag.y)) total += ON_BOARD;
  }
  return total;
}

/**
 * Settle a round by cancellation: only the difference counts.
 *
 * Eight against seven scores one. This is what stops a runaway, and it means a throw that
 * merely *matches* the opponent is worth as much as one that beats them.
 */
export function settleRound(game: Game): void {
  const p1 = rawScoreOf(game, 'p1');
  const p2 = rawScoreOf(game, 'p2');
  if (p1 > p2) game.score.p1 += p1 - p2;
  else if (p2 > p1) game.score.p2 += p2 - p1;

  game.bags.length = 0;
  game.left.p1 = BAGS_PER_ROUND;
  game.left.p2 = BAGS_PER_ROUND;
  game.round += 1;
  // The seat that did not throw first last round throws first now.
  game.toThrow = game.round % 2 === 0 ? game.opener : otherOf(game.opener);
}

export function roundOver(game: Readonly<Game>): boolean {
  return game.left.p1 === 0 && game.left.p2 === 0;
}

/**
 * Advance one fixed step. Only the flight is timed; everything else waits on a throw.
 */
export function step(game: Game, fixedDeltaSeconds: number): void {
  if (game.phase !== 'flying') return;
  game.flight -= fixedDeltaSeconds;
  if (game.flight > 0) return;
  game.flight = 0;
  if (roundOver(game)) {
    game.phase = 'round-over';
    return;
  }
  // Seats alternate within a round; a seat with none left is skipped.
  const next = otherOf(game.toThrow);
  const nextLeft = next === 'p1' ? game.left.p1 : game.left.p2;
  game.toThrow = nextLeft > 0 ? next : game.toThrow;
  game.phase = 'aiming';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  const { p1, p2 } = game.score;
  if (p1 >= TARGET_SCORE && p1 > p2) return 'p1';
  if (p2 >= TARGET_SCORE && p2 > p1) return 'p2';
  if (game.round < ROUNDS) return null;
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far its aim strays, as a fraction of the full angle range. */
  readonly angleError: number;
  /** How far its power strays. */
  readonly powerError: number;
}

/**
 * Measured over two thousand throws each: easy holes about 9%, normal 28%, hard 62%.
 *
 * The first hard tier holed **99%**, which is not a strong opponent but a wall — nothing a
 * player did could matter. A bot that always succeeds is as bad as one that always fails,
 * and rule 6 is about information rather than a licence to be superhuman with it.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { angleError: 0.45, powerError: 0.3 },
  normal: { angleError: 0.24, powerError: 0.16 },
  hard: { angleError: 0.15, powerError: 0.1 },
});

/** The aim and power that would drop a bag straight in the hole, with no wobble. */
export const PERFECT_ANGLE = (HOLE_X - THROW_X) / MAX_DRIFT;
export const PERFECT_POWER = (THROW_Y - HOLE_Y - MIN_REACH) / (MAX_REACH - MIN_REACH);

/**
 * What a bot aims at.
 *
 * Every tier aims at the hole and misses by its own margin. It has no more information
 * than a person does — it cannot see the wobble, which is drawn after it commits — so a
 * hard bot is a steady hand rather than a cheat.
 */
export function botAim(
  out: { angle: number; power: number },
  profile: BotProfile,
  rng: Rng,
): { angle: number; power: number } {
  out.angle = PERFECT_ANGLE + (rng.float() - 0.5) * 2 * profile.angleError;
  out.power = PERFECT_POWER + (rng.float() - 0.5) * 2 * profile.powerError;
  if (out.angle < -1) out.angle = -1;
  if (out.angle > 1) out.angle = 1;
  if (out.power < 0) out.power = 0;
  if (out.power > 1) out.power = 1;
  return out;
}
