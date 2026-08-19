import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Darts, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and any future balance harness drive
 * this module.
 *
 * Two halves worth separating: **where a dart lands** (aim, plus a wobble that makes a
 * steady hand worth something) and **what that is worth** (the board's scoring rings,
 * which are fixed geometry). Keeping them apart is what lets the scoring be tested
 * exhaustively without simulating a throw.
 */

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** Radii as fractions of the board's outer radius, from the centre outwards. */
export const INNER_BULL = 0.037;
export const OUTER_BULL = 0.094;
export const TRIPLE_INNER = 0.582;
export const TRIPLE_OUTER = 0.629;
export const DOUBLE_INNER = 0.953;
export const DOUBLE_OUTER = 1.0;

/**
 * The twenty sectors, clockwise from the top.
 *
 * Not in numeric order, deliberately: a real board interleaves high and low so a near
 * miss is punished. 20 sits at the top between 1 and 5, which is why aiming at treble
 * twenty is a risk rather than a formality.
 */
export const SECTORS: readonly number[] = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

export type Ring = 'miss' | 'single' | 'double' | 'triple' | 'outer-bull' | 'inner-bull';

export interface Landing {
  /** The sector number, or 0 for a bull or a miss. */
  readonly sector: number;
  readonly ring: Ring;
  /** What the dart is worth. */
  readonly score: number;
}

const MISS: Landing = { sector: 0, ring: 'miss', score: 0 };

/**
 * Score a dart at `(x, y)` relative to the board's centre, in units of the outer radius.
 *
 * Pure geometry, so it can be tested exhaustively without simulating a throw.
 */
export function scoreAt(x: number, y: number): Landing {
  const distance = Math.hypot(x, y);
  if (distance > DOUBLE_OUTER) return MISS;
  if (distance <= INNER_BULL) return { sector: 0, ring: 'inner-bull', score: 50 };
  if (distance <= OUTER_BULL) return { sector: 0, ring: 'outer-bull', score: 25 };

  // Angle measured clockwise from straight up, so sector 0 (the number 20) is centred on
  // the top of the board rather than starting at it.
  const angle = Math.atan2(x, -y);
  const turns = (angle / (Math.PI * 2) + 1) % 1;
  const index = Math.floor(turns * SECTORS.length + 0.5) % SECTORS.length;
  const sector = SECTORS[index] ?? 0;

  if (distance >= DOUBLE_INNER) return { sector, ring: 'double', score: sector * 2 };
  if (distance >= TRIPLE_INNER && distance <= TRIPLE_OUTER) {
    return { sector, ring: 'triple', score: sector * 3 };
  }
  return { sector, ring: 'single', score: sector };
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

/** Where both seats start. Counting down from 301 is the standard short game. */
export const STARTING_SCORE = 301;
export const DARTS_PER_TURN = 3;

export interface SeatState {
  /** Points still to score. Zero means this seat has won. */
  remaining: number;
  /** Darts thrown in the current turn. */
  thrown: number;
  /** What this turn's darts scored, for the HUD. -1 where no dart has been thrown yet. */
  readonly turnScores: number[];
}

export function createSeatState(): SeatState {
  return { remaining: STARTING_SCORE, thrown: 0, turnScores: [-1, -1, -1] };
}

export function resetSeatState(state: SeatState): void {
  state.remaining = STARTING_SCORE;
  state.thrown = 0;
  state.turnScores.fill(-1);
}

export type ThrowOutcome =
  /** Scored, and the seat is still going. */
  | 'scored'
  /** Scored exactly, on a double: this seat has won. */
  | 'won'
  /**
   * The throw would have taken the seat below zero, to exactly one, or to zero without
   * a double. The whole turn is void and the score returns to where it began.
   */
  | 'bust';

export interface ThrowResult {
  readonly landing: Landing;
  readonly outcome: ThrowOutcome;
  /** True when the turn is over, whether by three darts, a win, or a bust. */
  readonly turnOver: boolean;
}

/**
 * Apply one dart.
 *
 * The rule that gives darts its shape is the **double out**: the dart that reaches zero
 * must be a double. Landing on exactly one is a bust too, because one cannot be finished
 * with a double. Without those, the last dart of a match would be a formality rather than
 * the hardest throw in the game.
 */
export function throwDart(state: SeatState, landing: Landing, turnStart: number): ThrowResult {
  state.turnScores[state.thrown] = landing.score;
  state.thrown += 1;

  const next = state.remaining - landing.score;
  const isDouble = landing.ring === 'double' || landing.ring === 'inner-bull';

  if (next === 0 && isDouble) {
    state.remaining = 0;
    return { landing, outcome: 'won', turnOver: true };
  }

  // Below zero, exactly one, or zero without a double: the whole turn is void.
  if (next < 0 || next === 1 || (next === 0 && !isDouble)) {
    state.remaining = turnStart;
    return { landing, outcome: 'bust', turnOver: true };
  }

  state.remaining = next;
  return { landing, outcome: 'scored', turnOver: state.thrown >= DARTS_PER_TURN };
}

export function startTurn(state: SeatState): void {
  state.thrown = 0;
  state.turnScores.fill(-1);
}

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How far the bot's darts stray, as a fraction of the board radius. A standard
   * deviation, so most darts land inside it and a few do not.
   */
  readonly spread: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { spread: 0.34 },
  normal: { spread: 0.17 },
  hard: { spread: 0.075 },
});

/**
 * Where a bot aims, in board units from the centre.
 *
 * It plays the game a person plays: go for treble twenty while the score is high, and
 * switch to the double that finishes once one is reachable. It knows only its own
 * remaining score — the same thing shown on screen — so it has no information a human
 * lacks.
 */
export function botAim(out: { x: number; y: number }, remaining: number): void {
  // A finishing double, when one exists. 40 remaining means double 20, and so on.
  if (remaining <= 40 && remaining % 2 === 0) {
    aimAtSector(out, remaining / 2, (DOUBLE_INNER + DOUBLE_OUTER) / 2);
    return;
  }
  if (remaining === 50) {
    out.x = 0;
    out.y = 0;
    return;
  }
  // Otherwise the highest-scoring target on the board.
  aimAtSector(out, 20, (TRIPLE_INNER + TRIPLE_OUTER) / 2);
}

/** Centre of a sector's ring band, in board units. */
export function aimAtSector(out: { x: number; y: number }, sector: number, radius: number): void {
  const index = SECTORS.indexOf(sector);
  const turns = index < 0 ? 0 : index / SECTORS.length;
  const angle = turns * Math.PI * 2;
  out.x = Math.sin(angle) * radius;
  out.y = -Math.cos(angle) * radius;
}

/**
 * Scatter a throw around its aim.
 *
 * Box-Muller from the seeded RNG, so the spread is a genuine normal distribution and a
 * replay of the same seed throws the same darts. A uniform box would make the bot's
 * misses look mechanical, clustering at the corners of a square.
 */
export function scatter(
  out: { x: number; y: number },
  aimX: number,
  aimY: number,
  spread: number,
  rng: Rng,
): void {
  // `float()` can return 0, and log(0) is -Infinity; nudging into (0, 1] is cheaper than
  // rejecting and re-rolling, and does not measurably bias the result.
  const u1 = Math.max(Number.EPSILON, rng.float());
  const u2 = rng.float();
  const magnitude = Math.sqrt(-2 * Math.log(u1)) * spread;
  const angle = 2 * Math.PI * u2;
  out.x = aimX + magnitude * Math.cos(angle);
  out.y = aimY + magnitude * Math.sin(angle);
}

/** Who has won, or null while both seats still have points to score. */
export function winnerOf(p1: SeatState, p2: SeatState): SeatId | 'draw' | null {
  const p1Done = p1.remaining === 0;
  const p2Done = p2.remaining === 0;
  // Both cannot finish: play is strictly alternating and a turn ends the moment a seat
  // reaches zero. The check exists so the rule is explicit rather than assumed.
  if (p1Done && p2Done) return 'draw';
  if (p1Done) return 'p1';
  if (p2Done) return 'p2';
  return null;
}
