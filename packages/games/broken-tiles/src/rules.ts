import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Broken Tiles, as pure rules.
 *
 * A floor of ice, and you standing on it. Standing wears the tile under you through; moving
 * off one costs it as well. Fall through, or run out of ice to step onto, and the round is
 * the other player's. First to three.
 *
 * ## The floor is a resource that only ever shrinks **[ours]**
 *
 * That single property does three jobs at once, and it is why the game is written round it
 * rather than round the running.
 *
 * - **It ends the round, with no clock anywhere.** Total ice is finite and strictly
 *   decreasing whenever anybody is alive — standing costs it, moving costs it, and nothing
 *   in the game puts any back. So a round between two players who never move and a round
 *   between two who never stop both finish, and the argument is arithmetic rather than a
 *   timer.
 * - **It makes standing still a decision rather than a pause.** The tile under you is
 *   going; the only question is where you spend what is left.
 * - **It makes the board its own difficulty ramp.** Nothing accelerates and nothing spawns
 *   — the floor simply runs out, and the last thirty seconds are hard because of what the
 *   first thirty did.
 *
 * The two seats each have their own floor, dealt from one seeded stream so the two are
 * **identical rather than merely similar** — the fairness question is answered by the deal,
 * not by tuning.
 *
 * No rendering, no timing, no DOM.
 */

export const COLUMNS = 7;
export const ROWS = 7;
export const TILES = COLUMNS * ROWS;

/**
 * How much wear a tile takes before it goes.
 *
 * Three, so a tile can be crossed twice and stood on briefly — enough that a route can be
 * planned and re-used once, and few enough that the floor visibly disappears.
 */
export const TILE_STRENGTH = 3;

/**
 * Wear a tile takes when its occupant leaves it.
 *
 * With the standing drain this sets the length of a round: a skater on the move spends
 * about ten units a second of a floor worth a hundred and thirty-five, which is a round of
 * roughly thirteen seconds and a match of about a minute.
 */
export const STEP_COST = 1.5;
/** Wear a second of standing costs the tile underneath. */
export const STAND_COST = 1.15;

/**
 * Seconds between steps.
 *
 * Rate-limited, and that is the input-fairness answer: a step takes this long whoever asked
 * for it, so a key held down, a key mashed and a finger dragged all move at one pace. A
 * game where running were a repeat rate would be won by whichever instrument repeats
 * fastest, which is why Road Dodge had to declare itself same-input-class-only.
 */
export const STEP_SECONDS = 0.16;

export const TARGET_ROUNDS = 3;
/** Hard cap, so a match cannot go on for ever however it is played. */
export const MAX_ROUNDS = 5;

/** Seconds of calm at the start of a round, and of pause after it. */
export const GRACE_SECONDS = 0.9;
export const SETTLE_SECONDS = 1.1;

export type Phase = 'grace' | 'running' | 'settling' | 'over';

export interface Skater {
  /** Where they stand, as a tile index. */
  at: number;
  alive: boolean;
  /** Seconds until they may step again. */
  cooldown: number;
  /** Which way they have asked to go, or −1. Held until the cooldown lets it happen. */
  wanted: number;
}

export interface Game {
  /** Remaining strength of every tile, one floor per seat. */
  readonly p1Floor: number[];
  readonly p2Floor: number[];
  readonly p1: Skater;
  readonly p2: Skater;
  phase: Phase;
  /** Counts the grace period down, then the settle. */
  hold: number;
  elapsed: number;
  p1Rounds: number;
  p2Rounds: number;
  rounds: number;
  /** Who took the last round, or 'draw'. */
  lastRound: SeatId | 'draw' | null;
  winner: SeatId | 'draw' | null;
}

/** The middle tile, where both skaters start. */
export const START_TILE = Math.floor(TILES / 2);

function makeSkater(): Skater {
  return { at: START_TILE, alive: true, cooldown: 0, wanted: -1 };
}

export function createGame(): Game {
  return {
    p1Floor: new Array<number>(TILES).fill(TILE_STRENGTH),
    p2Floor: new Array<number>(TILES).fill(TILE_STRENGTH),
    p1: makeSkater(),
    p2: makeSkater(),
    phase: 'grace',
    hold: GRACE_SECONDS,
    elapsed: 0,
    p1Rounds: 0,
    p2Rounds: 0,
    rounds: 0,
    lastRound: null,
    winner: null,
  };
}

export function skaterOf(game: Readonly<Game>, seat: SeatId): Skater {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function floorOf(game: Readonly<Game>, seat: SeatId): number[] {
  return seat === 'p1' ? game.p1Floor : game.p2Floor;
}

export function roundsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Rounds : game.p2Rounds;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function columnOf(tile: number): number {
  return tile % COLUMNS;
}

export function rowOf(tile: number): number {
  return Math.floor(tile / COLUMNS);
}

/** The four directions, as column and row deltas. Index order is up, left, down, right. */
export const DIRECTIONS: readonly (readonly [number, number])[] = Object.freeze([
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 0],
]);

/** The tile one step from `tile` in `direction`, or −1 off the edge. */
export function neighbourOf(tile: number, direction: number): number {
  const delta = DIRECTIONS[direction];
  if (delta === undefined) return -1;
  const column = columnOf(tile) + delta[0];
  const row = rowOf(tile) + delta[1];
  if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS) return -1;
  return row * COLUMNS + column;
}

/**
 * Deal both floors from one stream, identically.
 *
 * A handful of tiles start already worn, so a floor has a shape to read from the first
 * second rather than being a flat field that only becomes interesting once it has been
 * walked on. Both seats get **the same** worn tiles, which is what makes the two floors
 * equal rather than merely equally random.
 */
export const WORN_TILES = 6;

export function dealFloors(game: Game, rng: Rng): void {
  game.p1Floor.fill(TILE_STRENGTH);
  game.p2Floor.fill(TILE_STRENGTH);
  for (let i = 0; i < WORN_TILES; i += 1) {
    const tile = Math.floor(rng.float() * TILES);
    // Never the starting tile: a skater standing on a thin tile before the round begins is
    // a round decided by the deal.
    if (tile === START_TILE) continue;
    game.p1Floor[tile] = 1;
    game.p2Floor[tile] = 1;
  }
}

export function startRound(game: Game, rng: Rng): void {
  dealFloors(game, rng);
  for (const skater of [game.p1, game.p2]) {
    skater.at = START_TILE;
    skater.alive = true;
    skater.cooldown = 0;
    skater.wanted = -1;
  }
  game.phase = 'grace';
  game.hold = GRACE_SECONDS;
  game.elapsed = 0;
  game.rounds += 1;
}

export function resetGame(game: Game, rng: Rng): void {
  game.p1Rounds = 0;
  game.p2Rounds = 0;
  game.rounds = 0;
  game.lastRound = null;
  game.winner = null;
  startRound(game, rng);
}

/**
 * Ask a seat to step in a direction.
 *
 * Recorded rather than acted on: the step happens when the cooldown allows it, so an input
 * that arrives mid-cooldown is kept and spent by the step it releases. Without that, a
 * player pressing between steps loses the press and the game rewards drumming at exactly
 * the right rate — which is a rhythm test wearing a movement game's clothes.
 */
export function ask(game: Game, seat: SeatId, direction: number): void {
  const skater = skaterOf(game, seat);
  if (!skater.alive) return;
  if (direction < 0 || direction >= DIRECTIONS.length) return;
  skater.wanted = direction;
}

/** Total ice left on a seat's floor. Strictly decreasing while that seat is alive. */
export function iceLeft(game: Readonly<Game>, seat: SeatId): number {
  let total = 0;
  for (const strength of floorOf(game, seat)) total += Math.max(0, strength);
  return total;
}

/** Whether a tile is gone. */
export function isHole(floor: readonly number[], tile: number): boolean {
  return (floor[tile] ?? 0) <= 0;
}

/** How many of a tile's neighbours are still standing. */
export function escapesFrom(floor: readonly number[], tile: number): number {
  let count = 0;
  for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
    const next = neighbourOf(tile, direction);
    if (next >= 0 && !isHole(floor, next)) count += 1;
  }
  return count;
}

export interface StepResult {
  /** Seats that fell this step. Both can, which is a drawn round. */
  readonly fell: readonly SeatId[];
  /** True on the step a round was decided. */
  readonly roundOver: boolean;
}

const fellScratch: SeatId[] = [];
const result = { fell: fellScratch, roundOver: false };
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  fellScratch.length = 0;
  result.roundOver = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'settling') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) {
      if (decided(game)) finish(game);
      else startRound(game, rng);
    }
    return result;
  }

  if (game.phase === 'grace') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) game.phase = 'running';
    return result;
  }

  game.elapsed += fixedDeltaSeconds;

  // Both skaters are advanced from the same state before either fall is applied, so a step
  // that drops both drops both.
  for (const seat of SEATS) {
    const skater = skaterOf(game, seat);
    if (!skater.alive) continue;
    const floor = floorOf(game, seat);

    skater.cooldown -= fixedDeltaSeconds;
    if (skater.cooldown <= 0 && skater.wanted >= 0) {
      const next = neighbourOf(skater.at, skater.wanted);
      skater.wanted = -1;
      if (next >= 0 && !isHole(floor, next)) {
        // Leaving costs the tile behind you, which is what turns a route into a decision.
        floor[skater.at] = (floor[skater.at] ?? 0) - STEP_COST;
        skater.at = next;
        skater.cooldown = STEP_SECONDS;
      }
    }

    // And standing costs the tile underneath, whether or not you meant to stand there.
    floor[skater.at] = (floor[skater.at] ?? 0) - STAND_COST * fixedDeltaSeconds;
    if (isHole(floor, skater.at)) fellScratch.push(seat);
  }

  for (const seat of fellScratch) skaterOf(game, seat).alive = false;

  if (!game.p1.alive || !game.p2.alive) {
    endRound(game);
    result.roundOver = true;
  }
  return result;
}

function endRound(game: Game): void {
  const winner = game.p1.alive ? 'p1' : game.p2.alive ? 'p2' : 'draw';
  game.lastRound = winner;
  if (winner === 'p1') game.p1Rounds += 1;
  else if (winner === 'p2') game.p2Rounds += 1;
  game.phase = 'settling';
  game.hold = SETTLE_SECONDS;
}

function decided(game: Readonly<Game>): boolean {
  return (
    game.p1Rounds >= TARGET_ROUNDS || game.p2Rounds >= TARGET_ROUNDS || game.rounds >= MAX_ROUNDS
  );
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner =
    game.p1Rounds === game.p2Rounds ? 'draw' : game.p1Rounds > game.p2Rounds ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How many steps ahead it searches for a route. */
  readonly depth: number;
  /** Seconds between decisions. */
  readonly reaction: number;
  /** How much it values a tile's remaining strength against its escapes. */
  readonly thrift: number;
}

/**
 * Three tiers, all of them looking at the same floor a player looks at.
 *
 * They differ in how far ahead they search and how much they value keeping a route open —
 * never in speed, since `STEP_SECONDS` is the same for everybody, and never in knowledge,
 * since the floor is fully visible and nothing about it is hidden. That makes this an
 * unusually clean place to keep rule 6: there is simply nothing extra to give them.
 *
 * `easy` searches one step, which is exactly how somebody plays this the first time — they
 * step onto the thickest neighbour and are surprised to find themselves in a corner.
 */
/**
 * The deepest any tier searches, and the one working floor the search uses.
 *
 * **Copied once per decision, not once per node.** The first version copied the whole floor
 * at every node of the search, which is 4^depth copies of forty-nine numbers — the hardest
 * tier spent ten seconds of a test suite on it. Applying a step and then undoing it after
 * the recursive call gives the same answer for one copy per decision.
 *
 * A single shared buffer was also *wrong* before that: the search recurses, and one scratch
 * means the deeper call overwrites the floor the shallower one is still walking, so a
 * two-step lookahead worked and everything past it quietly scored a position that never
 * existed. Make-and-unmake has no such hazard, because there is only ever one floor and it
 * is always the true one on the way back out.
 */
const MAX_SEARCH_DEPTH = 5;
const WORKING_FLOOR: number[] = new Array<number>(TILES).fill(0);

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { depth: 1, reaction: 0.2, thrift: 0.2 },
  normal: { depth: 3, reaction: 0.1, thrift: 0.6 },
  hard: { depth: MAX_SEARCH_DEPTH, reaction: 0.05, thrift: 1 },
});

export interface BotState {
  cooldown: number;
  /** The direction it is holding until it looks again. */
  direction: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, direction: -1 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.direction = -1;
}

/**
 * How far a bot's reaction wanders, as a fraction of it.
 *
 * Both floors are dealt identically and both skaters start on the same tile, so a bot with
 * no randomness in it is a pure function of the state — two of the same tier take the same
 * route and fall through on the same step. It is the third time this repo has met that; see
 * Robot Arena and Slot Cars.
 */
export const REACTION_WANDER = 0.12;

/**
 * Values a bot draws per decision. Always exactly this many.
 *
 * Two: one wanders the reaction, one turns the direction scan.
 *
 * **The wander alone was not enough, and that was the surprise.** In Robot Arena and Slot
 * Cars, jittering *when* a bot looks was sufficient to separate two identical ones. Here it
 * was not: on an open floor most directions score the same, so looking a few milliseconds
 * later returns the same answer and both skaters walk the same route anyway. Two `normal`
 * bots drew **77 rounds in 120**. What actually separates them is which of several
 * equal-best directions gets kept — a strict `>` keeps the first one visited — so the scan
 * now starts at a drawn offset. Both seats draw from the same distribution, one value each,
 * so neither is favoured.
 *
 * The count is constant because the two bots share the game's single `Rng` with the deal,
 * and a seat whose draw count depended on what it chose would shift the other seat's stream
 * — the seat bias made of arithmetic that Fruit Duel was caught by.
 */
export const BOT_DRAWS_PER_DECISION = 2;

/**
 * Score a floor position: how much ice is under it, and how many ways out it has.
 *
 * A tile with three neighbours and one unit of ice is worse than one with two neighbours
 * and three, and `thrift` is how strongly a tier believes that. The weakest tier barely
 * does, which is why it walks into corners.
 */
export function scoreTile(floor: readonly number[], tile: number, thrift: number): number {
  if (isHole(floor, tile)) return -Infinity;
  return escapesFrom(floor, tile) + (floor[tile] ?? 0) * thrift;
}

/**
 * The best direction to step, searched `depth` steps ahead.
 *
 * A plain depth-limited search over a floor of forty-nine tiles with four moves — small
 * enough to be exact and cheap, so the hardest tier costs a fraction of a frame. It reads
 * the floor as it stands and assumes nothing about what the other player is doing, because
 * the other player is on a different floor entirely.
 */
export function bestDirection(
  floor: readonly number[],
  tile: number,
  depth: number,
  thrift: number,
  from = 0,
): number {
  for (let i = 0; i < TILES; i += 1) WORKING_FLOOR[i] = floor[i] ?? 0;

  let best = -Infinity;
  let bestDirection = -1;
  for (let i = 0; i < DIRECTIONS.length; i += 1) {
    // Scanned from `from` rather than from zero. See BOT_DRAWS_PER_DECISION: on a fresh
    // floor most directions score identically, and which of them a strict `>` keeps is
    // decided entirely by the order they are visited in.
    const direction = (from + i) % DIRECTIONS.length;
    const next = neighbourOf(tile, direction);
    if (next < 0 || isHole(WORKING_FLOOR, next)) continue;

    const before = WORKING_FLOOR[tile] ?? 0;
    WORKING_FLOOR[tile] = before - STEP_COST;
    const score = look(WORKING_FLOOR, next, depth - 1, thrift);
    WORKING_FLOOR[tile] = before;

    if (score > best) {
      best = score;
      bestDirection = direction;
    }
  }
  return bestDirection;
}

function look(floor: number[], tile: number, depth: number, thrift: number): number {
  const here = scoreTile(floor, tile, thrift);
  if (depth <= 0 || here === -Infinity) return here;

  // One level deep at a time, with the cost of having walked here charged to the tile
  // behind — the same accounting the simulation does — and undone on the way back out.
  let best = -Infinity;
  for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
    const next = neighbourOf(tile, direction);
    if (next < 0 || isHole(floor, next)) continue;
    const before = floor[tile] ?? 0;
    floor[tile] = before - STEP_COST;
    const score = look(floor, next, depth - 1, thrift);
    floor[tile] = before;
    if (score > best) best = score;
  }
  return best === -Infinity ? here : here + best * 0.6;
}

/** Which direction the bot wants this step, or −1 to hold. */
export function botDirection(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): number {
  const skater = skaterOf(game, seat);
  if (!skater.alive) return -1;

  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown > 0) {
    // A held direction can go stale: the skater may have taken the step it named, and the
    // way that was clear from the old tile can be a wall or a hole from the new one. Better
    // to do nothing for the rest of the cooldown than to ask for something impossible.
    const next = neighbourOf(skater.at, state.direction);
    if (state.direction < 0 || next < 0 || isHole(floorOf(game, seat), next)) return -1;
    return state.direction;
  }
  // Both drawn before any branch on what it decides, so the count is constant.
  const wander = (rng.float() * 2 - 1) * REACTION_WANDER;
  const from = Math.floor(rng.float() * DIRECTIONS.length);
  const profile = BOT_PROFILES[difficulty];
  state.cooldown = profile.reaction * (1 + wander);

  state.direction = bestDirection(
    floorOf(game, seat),
    skater.at,
    profile.depth,
    profile.thrift,
    from,
  );
  return state.direction;
}
