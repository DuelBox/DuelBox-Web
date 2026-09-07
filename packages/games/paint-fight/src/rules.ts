import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Paint Fight, as pure rules.
 *
 * Both players roll across one shared board leaving colour behind them. Roll over what the
 * other player has painted and it becomes yours. Most of the board after forty-five
 * seconds wins.
 *
 * This is the first game here scored by **territory** rather than by events. Everything
 * else counts goals, pots, pellets or rounds; here the score is a property of the whole
 * board, recomputed as it changes. That difference drives most of the design.
 *
 * No rendering, no timing, no DOM.
 */

export const COLUMNS = 24;
export const ROWS = 24;
export const CELLS = COLUMNS * ROWS;

export const BOARD_WIDTH = 960;
export const BOARD_HEIGHT = 960;
export const CELL_SIZE = BOARD_WIDTH / COLUMNS;

/**
 * The roller, in logical units, against a 40-unit cell.
 *
 * 34 was the first value and made a roller barely wider than one cell — a second of
 * driving covered 18 cells and the trail read as a pencil line rather than a paint roller.
 * 56 is nearly three cells across, which is what makes covering ground feel like it.
 */
export const ROLLER_RADIUS = 56;
export const SPEED = 300;
/** Radians a second at full steer. */
export const TURN_RATE = 4.2;

export const ROUND_SECONDS = 45;

/** Who owns a cell: a seat, or null for bare board. */
export type Owner = SeatId | null;

export interface Roller {
  x: number;
  y: number;
  heading: number;
  /** Cells painted this round, for the HUD. Recomputed, never accumulated. */
  painted: number;
}

export type Phase = 'playing' | 'over';

export interface Game {
  readonly cells: Owner[];
  readonly p1: Roller;
  readonly p2: Roller;
  phase: Phase;
  winner: SeatId | 'draw' | null;
  elapsed: number;
}

export function columnOf(cell: number): number {
  return cell % COLUMNS;
}

export function rowOf(cell: number): number {
  return Math.floor(cell / COLUMNS);
}

export function cellAt(column: number, row: number): number {
  return row * COLUMNS + column;
}

export function inBounds(column: number, row: number): boolean {
  return column >= 0 && column < COLUMNS && row >= 0 && row < ROWS;
}

/** Where a roller starts, before its opening heading is drawn. */
export interface StartMark {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
}

/**
 * The two marks: opposite corners, each facing along its own diagonal.
 *
 * Exact half-turn images of one another, so the pair is unchanged by turning the board
 * through 180 degrees and neither is aimed at the other.
 */
export const START_MARKS: readonly [StartMark, StartMark] = Object.freeze([
  Object.freeze({ x: BOARD_WIDTH * 0.2, y: BOARD_HEIGHT * 0.2, heading: 0 }),
  Object.freeze({ x: BOARD_WIDTH * 0.8, y: BOARD_HEIGHT * 0.8, heading: Math.PI }),
]);

/**
 * How far off its mark's diagonal a roller may be pointed at the start, either side.
 *
 * The opening was fixed, and with a bot that used no randomness either that made the whole
 * game fixed: every seed played the identical match, so a hundred sampled matches were one
 * match counted a hundred times. A quarter turn either way is enough that no two rounds open
 * the same and small enough that a roller still sets off across the board rather than into
 * the nearest wall.
 */
export const START_SPREAD = Math.PI / 2;

export function createGame(): Game {
  const game: Game = {
    cells: new Array<Owner>(CELLS).fill(null),
    p1: { x: 0, y: 0, heading: 0, painted: 0 },
    p2: { x: 0, y: 0, heading: 0, painted: 0 },
    phase: 'playing',
    winner: null,
    elapsed: 0,
  };
  resetGame(game, 'p1', 0.5, 0.5);
  return game;
}

/**
 * Start a round.
 *
 * `first` takes the first mark and its roll; the other seat takes the second of each. Those
 * two lines are the **only** place in this file where a seat label reaches the simulation:
 * painting, scoring, steering and the whistle all treat the two seats as interchangeable. So
 * the same round played with the opening seat swapped is the same round with the two labels
 * swapped, bit for bit — which is a proof that neither chair is favoured rather than a
 * measurement that says so.
 *
 * Both rolls are in `[0, 1)`. Passing 0.5 twice gives the fixed opening the game had before
 * it was seeded, which is what {@link createGame} does.
 */
export function resetGame(game: Game, first: SeatId, rollFirst: number, rollSecond: number): void {
  game.cells.fill(null);
  place(rollerOf(game, first), START_MARKS[0], rollFirst);
  place(rollerOf(game, otherOf(first)), START_MARKS[1], rollSecond);
  game.phase = 'playing';
  game.winner = null;
  game.elapsed = 0;
}

function place(roller: Roller, mark: StartMark, roll: number): void {
  roller.x = mark.x;
  roller.y = mark.y;
  roller.heading = mark.heading + (roll - 0.5) * START_SPREAD;
  roller.painted = 0;
}

export function rollerOf(game: Game, seat: SeatId): Roller {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * How many cells a seat owns.
 *
 * Walked rather than accumulated. Painting over the other player's colour changes two
 * counts at once and a cell can change hands many times, so a running total is a
 * bookkeeping bug waiting to happen — and the board is only 576 cells, which is nothing.
 */
export function countOwned(game: Game, seat: SeatId): number {
  let count = 0;
  for (const owner of game.cells) {
    if (owner === seat) count += 1;
  }
  return count;
}

export function countBare(game: Game): number {
  let count = 0;
  for (const owner of game.cells) {
    if (owner === null) count += 1;
  }
  return count;
}

export function steer(roller: Roller, amount: number, fixedDeltaSeconds: number): void {
  const clamped = amount < -1 ? -1 : amount > 1 ? 1 : amount;
  roller.heading += clamped * TURN_RATE * fixedDeltaSeconds;
}

/**
 * Paint every cell the roller covers, and return how many changed hands.
 *
 * A disc rather than a point: a roller is a wide thing and painting only the cell under
 * its centre leaves a one-cell trail that no amount of driving fills in. The disc is what
 * makes covering ground feel like covering ground.
 *
 * `rivalX`/`rivalY` are the other roller's centre, and every cell under **both** discs is
 * left exactly as it was. Nobody paints where two rollers meet, so the contested cells
 * cannot be awarded by the order the two seats happen to be processed in — see {@link step}.
 * Left out, there is no rival and the whole disc is painted.
 */
export function paintAt(
  game: Game,
  seat: SeatId,
  x: number,
  y: number,
  rivalX = Infinity,
  rivalY = Infinity,
): number {
  const reach = Math.ceil(ROLLER_RADIUS / CELL_SIZE);
  const centreColumn = Math.floor(x / CELL_SIZE);
  const centreRow = Math.floor(y / CELL_SIZE);
  let changed = 0;

  for (let dRow = -reach; dRow <= reach; dRow += 1) {
    for (let dColumn = -reach; dColumn <= reach; dColumn += 1) {
      const column = centreColumn + dColumn;
      const row = centreRow + dRow;
      if (!inBounds(column, row)) continue;
      // Against the cell's centre, so the painted area is a disc rather than a square.
      const cx = (column + 0.5) * CELL_SIZE;
      const cy = (row + 0.5) * CELL_SIZE;
      if (Math.hypot(cx - x, cy - y) > ROLLER_RADIUS) continue;
      if (Math.hypot(cx - rivalX, cy - rivalY) <= ROLLER_RADIUS) continue;
      const cell = cellAt(column, row);
      if (game.cells[cell] === seat) continue;
      game.cells[cell] = seat;
      changed += 1;
    }
  }
  return changed;
}

/**
 * One fixed step.
 *
 * **Both rollers move before either paints, and neither paints where the two discs overlap.**
 * The comment here used to claim that moving and painting both rollers before reading either
 * count meant "the order they are processed in cannot decide who owns a cell they both
 * crossed", and that was simply false: p2 painted second, so p2 took every contested cell.
 * It never showed up as a seat advantage because the rest of the game was an exact mirror
 * and the overlap was symmetric too — a bug hiding behind another bug. Cells under both
 * rollers now change hands for nobody, which is a rule two people can see happen and the
 * only version of it that does not depend on a loop order.
 */
export function step(game: Game, fixedDeltaSeconds: number): void {
  if (game.phase !== 'playing') return;
  game.elapsed += fixedDeltaSeconds;

  for (const seat of ['p1', 'p2'] as SeatId[]) {
    const roller = rollerOf(game, seat);
    roller.x += Math.cos(roller.heading) * SPEED * fixedDeltaSeconds;
    roller.y += Math.sin(roller.heading) * SPEED * fixedDeltaSeconds;
    bounceOffWalls(roller);
  }
  paintAt(game, 'p1', game.p1.x, game.p1.y, game.p2.x, game.p2.y);
  paintAt(game, 'p2', game.p2.x, game.p2.y, game.p1.x, game.p1.y);

  game.p1.painted = countOwned(game, 'p1');
  game.p2.painted = countOwned(game, 'p2');

  if (game.elapsed >= ROUND_SECONDS) callTime(game);
}

/**
 * The walls turn a roller rather than stopping it.
 *
 * A roller that stops is a roller that paints one cell for ever, and a player who has run
 * into a wall would have nothing to do but turn around — the bounce keeps them moving and
 * keeps the round busy.
 */
function bounceOffWalls(roller: Roller): void {
  const low = ROLLER_RADIUS * 0.5;
  const highX = BOARD_WIDTH - low;
  const highY = BOARD_HEIGHT - low;
  let vx = Math.cos(roller.heading);
  let vy = Math.sin(roller.heading);
  let bounced = false;

  if (roller.x < low) {
    roller.x = low;
    vx = Math.abs(vx);
    bounced = true;
  } else if (roller.x > highX) {
    roller.x = highX;
    vx = -Math.abs(vx);
    bounced = true;
  }
  if (roller.y < low) {
    roller.y = low;
    vy = Math.abs(vy);
    bounced = true;
  } else if (roller.y > highY) {
    roller.y = highY;
    vy = -Math.abs(vy);
    bounced = true;
  }
  if (bounced) roller.heading = Math.atan2(vy, vx);
}

export function callTime(game: Game): void {
  if (game.phase !== 'playing') return;
  game.phase = 'over';
  const p1 = countOwned(game, 'p1');
  const p2 = countOwned(game, 'p2');
  game.winner = p1 === p2 ? 'draw' : p1 > p2 ? 'p1' : 'p2';
}

export function winnerOf(game: Game): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far ahead it looks when scoring a heading, in seconds. */
  readonly lookahead: number;
  /** How many headings it considers. More is strictly better. */
  readonly fanSize: number;
  /** Whether it counts the opponent's colour as worth more than bare board. */
  readonly stealsBack: boolean;
}

/**
 * How far ahead every tier looks.
 *
 * **Shared, not a difficulty axis**, because it has an optimum rather than a direction.
 * Swept head to head against 0.5 s, in percentage points of the board:
 *
 * | lookahead | solo coverage | against 0.5 s |
 * |---|---|---|
 * | 0.25 s | 60% | −18 |
 * | 0.4 s | 83% | +3 |
 * | 0.6 s | 86% | −7 |
 * | 0.9 s | 75% | −5 |
 * | 1.4 s | 77% | −20 |
 *
 * Too short and it cannot see round a corner; too long and it commits to a direction that
 * is good far away and bad right now. The first draft used it as the difficulty axis and
 * made the hardest tier the worst one, losing 37–58 to the weakest.
 */
export const LOOKAHEAD_SECONDS = 0.5;

/**
 * The tiers differ by **how many headings they consider**, which is the axis that is
 * actually monotonic. Swept against a nine-wide fan: three is −53 points, five is −13,
 * fifteen is +2 and twenty-one is +10.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { lookahead: LOOKAHEAD_SECONDS, fanSize: 3, stealsBack: false },
  normal: { lookahead: LOOKAHEAD_SECONDS, fanSize: 9, stealsBack: false },
  hard: { lookahead: LOOKAHEAD_SECONDS, fanSize: 21, stealsBack: true },
});

/** How much a heading is worth: cells it would gain, sampled along the path. */
export function scoreHeading(
  game: Game,
  seat: SeatId,
  heading: number,
  profile: BotProfile,
): number {
  const roller = rollerOf(game, seat);
  const them = otherOf(seat);
  const steps = 7;
  let gained = 0;
  // Cells already counted this sweep, so a slow-moving overlap is not counted twice.
  const seen = new Set<number>();

  for (let i = 1; i <= steps; i += 1) {
    const distance = SPEED * profile.lookahead * (i / steps);
    let x = roller.x + Math.cos(heading) * distance;
    let y = roller.y + Math.sin(heading) * distance;
    // A path that leaves the board is not worth what it looks worth: the wall turns it.
    x = Math.max(0, Math.min(BOARD_WIDTH, x));
    y = Math.max(0, Math.min(BOARD_HEIGHT, y));

    const reach = Math.ceil(ROLLER_RADIUS / CELL_SIZE);
    const centreColumn = Math.floor(x / CELL_SIZE);
    const centreRow = Math.floor(y / CELL_SIZE);
    for (let dRow = -reach; dRow <= reach; dRow += 1) {
      for (let dColumn = -reach; dColumn <= reach; dColumn += 1) {
        const column = centreColumn + dColumn;
        const row = centreRow + dRow;
        if (!inBounds(column, row)) continue;
        const cx = (column + 0.5) * CELL_SIZE;
        const cy = (row + 0.5) * CELL_SIZE;
        if (Math.hypot(cx - x, cy - y) > ROLLER_RADIUS) continue;
        const cell = cellAt(column, row);
        if (seen.has(cell)) continue;
        seen.add(cell);
        const owner = game.cells[cell];
        if (owner === seat) continue;
        // Taking a cell off the other player swings the gap by two, not one — which is
        // the whole reason a good player chases rather than colours in the corners.
        gained += owner === them && profile.stealsBack ? 2 : 1;
      }
    }
  }
  return gained;
}

/** How wide a fan of headings the bot considers, either side of straight ahead. */
export const FAN_SPREAD = Math.PI * 0.9;

/**
 * The `rank`-th offset either side of straight ahead, out of `half` on each side.
 *
 * **Squared**, so the fan is dense near straight ahead and sparse at the edges. Spaced
 * evenly, a fan's finest step is several times what one decision can turn, so every option
 * but "straight" clamps to full lock and the roller can only spin — with a long lookahead
 * that was catastrophic, two of the hardest tier covering 14% of the board each in a full
 * round.
 *
 * Once the lookahead was corrected the gap narrowed a lot, and the honest measurement is
 * that the squared fan is worth **1 to 3 points of the board** against an even one at every
 * tier. Small, consistent, and free.
 */
export function fanOffset(rank: number, half: number, side: number): number {
  const t = rank / half;
  return FAN_SPREAD * t * t * side;
}

/** Two headings scoring within this of each other are the same heading. */
export const TIE_EPSILON = 1e-9;

/**
 * Where the bot steers, as a −1..1 amount.
 *
 * Every tier sees the board a human sees, per rule 6. They differ in how far ahead they
 * look, how finely they steer, and whether they understand that repainting the opponent is
 * worth double.
 *
 * **`rng` breaks ties, and it is the only randomness in the game.** The fan is generated in
 * pairs — straight ahead, then each rank to the left before the same rank to the right — and
 * a strict `>` gave every tie to whichever of the pair was enumerated first, which is always
 * the left one. On an empty board almost every option ties, so the opening was one scripted
 * line the seed could not touch: 50 seeds produced *one* distinct match on every tier. Taking
 * a tied heading uniformly at random makes the seed matter and takes the left-hand bias out
 * with it, at no cost in strength, because the options it chooses between score the same.
 *
 * Each seat draws from its own stream, so the number of draws one roller makes cannot shift
 * the other's — see `game.ts`, which hands the streams out by opening seat rather than by
 * seat, so a round replayed with the seats swapped is bit-for-bit the same round.
 */
export function botSteer(game: Game, seat: SeatId, difficulty: BotDifficulty, rng: Rng): number {
  const profile = BOT_PROFILES[difficulty];
  const roller = rollerOf(game, seat);

  let best = 0;
  let bestScore = -Infinity;
  /** How many headings are tied on the best score so far, for the reservoir below. */
  let tied = 0;
  const half = Math.max(1, (profile.fanSize - 1) / 2);

  for (let i = 0; i < profile.fanSize; i += 1) {
    const rank = Math.ceil(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = fanOffset(rank, half, side);
    // A faint preference for going straight, so a tie does not jitter.
    const score =
      scoreHeading(game, seat, roller.heading + offset, profile) - Math.abs(offset) * 0.5;
    if (score > bestScore + TIE_EPSILON) {
      bestScore = score;
      best = offset;
      tied = 1;
    } else if (score >= bestScore - TIE_EPSILON) {
      // Reservoir sampling: the k-th tied heading is taken with probability 1/k, which
      // leaves all of them equally likely without a second pass or an array to hold them.
      tied += 1;
      if (score > bestScore) bestScore = score;
      if (rng.float() * tied < 1) best = offset;
    }
  }

  const amount = best / (TURN_RATE / 60);
  return amount < -1 ? -1 : amount > 1 ? 1 : amount;
}
