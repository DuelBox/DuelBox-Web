import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Match Rush, as pure rules.
 *
 * Two sets of symbols share **exactly one** symbol between them. Find it in your own set
 * and touch it before the other player finds it in theirs. First to ten.
 *
 * ## Both players search their own set, and that is what makes it work
 *
 * The obvious reading — one shared pile that both players reach into — cannot be played on
 * a shared board, because the shell divides one into two pointer zones and neither player
 * can touch anything in the other's half. Giving each seat its *own* set of the pair turns
 * that constraint into the design: the board is one puzzle, each half of it is one player's
 * half of that puzzle, and each of them is looking for the same answer in a different place.
 *
 * The common symbol sits at the **same ring index in both sets**. Because the board is
 * point-symmetric, that puts it at the same position relative to each player — so neither
 * seat has a longer look than the other, and knowing the index is no help, because you only
 * learn it by having already found it. What cannot be equalised is which *distractors* it
 * sits among, since two identical sets would make the puzzle trivial; that residue is
 * measured rather than assumed. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

/**
 * How many kinds of symbol exist, and how many are in a set.
 *
 * A pair of sets sharing exactly one symbol needs `1 + 2·(SET_SIZE − 1)` distinct kinds, or
 * the two sets are forced to share a second. Nine would be the minimum for a set of five;
 * twelve leaves the pairs varied rather than nearly the same every round.
 */
export const SYMBOL_TYPES = 12;
export const SET_SIZE = 5;

export const TARGET_POINTS = 10;

/**
 * Rounds in a match, after which it is called on points.
 *
 * A structural cap: two players who never answer would otherwise sit for ever, and no clock
 * in the rules would change that. Twenty-four rounds at a five-second look is two minutes in
 * the very worst case, and a played match is a third of that.
 */
export const MAX_ROUNDS = 24;

/** How long a round stays up before it is abandoned. */
export const ROUND_SECONDS = 5;
/** How long the answer is shown before the next round. */
export const REVEAL_SECONDS = 0.9;

/**
 * How long a wrong touch locks a player out.
 *
 * The whole cost of guessing. Without it the fastest strategy is to touch all five symbols
 * as quickly as possible, which is not searching, and a set of five would be solved by
 * mashing in under a second. A lockout longer than the average honest search makes guessing
 * strictly worse than looking.
 */
export const PENALTY_SECONDS = 1.2;

export type Phase = 'searching' | 'revealing' | 'over';

export interface Game {
  /** Symbol kinds in each seat's set, by ring index. */
  readonly p1Set: number[];
  readonly p2Set: number[];
  /** The kind both sets share. */
  common: number;
  /** Where it sits, the same index in both sets. */
  commonIndex: number;
  /** Seconds each seat is locked out for after a wrong touch. */
  p1Lock: number;
  p2Lock: number;
  /** Which index each seat has touched correctly this round, or −1. */
  p1Found: number;
  p2Found: number;
  p1Points: number;
  p2Points: number;
  rounds: number;
  phase: Phase;
  /** Counts the search down, then the reveal. */
  timer: number;
  winner: SeatId | 'draw' | null;
}

export function createGame(): Game {
  return {
    p1Set: new Array<number>(SET_SIZE).fill(0),
    p2Set: new Array<number>(SET_SIZE).fill(0),
    common: 0,
    commonIndex: 0,
    p1Lock: 0,
    p2Lock: 0,
    p1Found: -1,
    p2Found: -1,
    p1Points: 0,
    p2Points: 0,
    rounds: 0,
    phase: 'searching',
    timer: ROUND_SECONDS,
    winner: null,
  };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function setOf(game: Readonly<Game>, seat: SeatId): readonly number[] {
  return seat === 'p1' ? game.p1Set : game.p2Set;
}

export function lockOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Lock : game.p2Lock;
}

export function foundOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Found : game.p2Found;
}

export function pointsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Points : game.p2Points;
}

/**
 * Values drawn from the shared stream per round. Always exactly this many.
 *
 * The bots share the game's single `Rng` with the deal itself, so a variable count anywhere
 * shifts everything after it. The shuffle below always makes `SYMBOL_TYPES − 1` swaps and
 * the index one more, whatever comes out.
 */
export const DEAL_DRAWS = SYMBOL_TYPES;

/**
 * Deal a fresh pair of sets sharing exactly one symbol.
 *
 * A shuffle of all twelve kinds, then the first is the common one, the next four fill out
 * seat one's set and the four after that seat two's. Built that way rather than by rejection
 * sampling because it **cannot** produce a second shared symbol — the property is a fact
 * about the construction, not something to test for and retry.
 */
export function deal(game: Game, rng: Rng): void {
  const kinds = scratchKinds;
  for (let i = 0; i < SYMBOL_TYPES; i += 1) kinds[i] = i;
  // Fisher-Yates, always SYMBOL_TYPES − 1 draws.
  for (let i = SYMBOL_TYPES - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.float() * (i + 1));
    const swap = kinds[i] as number;
    kinds[i] = kinds[j] as number;
    kinds[j] = swap;
  }
  const index = Math.floor(rng.float() * SET_SIZE);

  game.common = kinds[0] as number;
  game.commonIndex = index;

  let a = 1;
  let b = SET_SIZE;
  for (let slot = 0; slot < SET_SIZE; slot += 1) {
    if (slot === index) {
      game.p1Set[slot] = game.common;
      game.p2Set[slot] = game.common;
      continue;
    }
    game.p1Set[slot] = kinds[a] as number;
    game.p2Set[slot] = kinds[b] as number;
    a += 1;
    b += 1;
  }

  game.p1Lock = 0;
  game.p2Lock = 0;
  game.p1Found = -1;
  game.p2Found = -1;
  game.phase = 'searching';
  game.timer = ROUND_SECONDS;
  game.rounds += 1;
}

const scratchKinds: number[] = new Array<number>(SYMBOL_TYPES).fill(0);

export function resetGame(game: Game, rng: Rng): void {
  game.p1Points = 0;
  game.p2Points = 0;
  game.rounds = 0;
  game.winner = null;
  deal(game, rng);
}

/**
 * Touch a symbol in a seat's own set.
 *
 * Records; never resolves. Two players touching the right symbol on the same step have both
 * found it, and settling as each touch arrived would hand the point to whichever seat the
 * loop read first.
 */
export function touch(game: Game, seat: SeatId, index: number): boolean {
  if (game.phase !== 'searching') return false;
  if (index < 0 || index >= SET_SIZE) return false;
  if (lockOf(game, seat) > 0) return false;
  if (foundOf(game, seat) !== -1) return false;

  const right = setOf(game, seat)[index] === game.common;
  if (right) {
    if (seat === 'p1') game.p1Found = index;
    else game.p2Found = index;
  } else if (seat === 'p1') game.p1Lock = PENALTY_SECONDS;
  else game.p2Lock = PENALTY_SECONDS;
  return right;
}

export interface StepResult {
  /** Seats that scored this step. */
  readonly scored: readonly SeatId[];
  /** True on the step a round was settled. */
  readonly resolved: boolean;
}

const scoredScratch: SeatId[] = [];
const result = { scored: scoredScratch, resolved: false };
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  scoredScratch.length = 0;
  result.resolved = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'revealing') {
    game.timer -= fixedDeltaSeconds;
    if (game.timer <= 0) {
      if (
        game.rounds >= MAX_ROUNDS ||
        game.p1Points >= TARGET_POINTS ||
        game.p2Points >= TARGET_POINTS
      ) {
        finish(game);
      } else {
        deal(game, rng);
      }
    }
    return result;
  }

  if (game.p1Lock > 0) game.p1Lock = Math.max(0, game.p1Lock - fixedDeltaSeconds);
  if (game.p2Lock > 0) game.p2Lock = Math.max(0, game.p2Lock - fixedDeltaSeconds);
  game.timer -= fixedDeltaSeconds;

  const anyFound = game.p1Found !== -1 || game.p2Found !== -1;
  if (!anyFound && game.timer > 0) return result;

  // Both seats are scored together, from the state as it stands.
  for (const seat of SEATS) {
    if (foundOf(game, seat) === -1) continue;
    if (seat === 'p1') game.p1Points += 1;
    else game.p2Points += 1;
    scoredScratch.push(seat);
  }

  result.resolved = true;
  game.phase = 'revealing';
  game.timer = REVEAL_SECONDS;
  return result;
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner =
    game.p1Points === game.p2Points ? 'draw' : game.p1Points > game.p2Points ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds it spends on each symbol it checks. */
  readonly perSymbol: number;
  /** Seconds before it starts looking at all. */
  readonly settle: number;
  /** How often it touches a symbol it has not actually matched. */
  readonly guesses: number;
}

/**
 * Three tiers, expressed as how fast a tier reads a symbol and how often it jumps.
 *
 * Never as a look at the answer: every tier searches its own set in an order it drew before
 * the deal was visible, one symbol at a time, and finds the common one when it reaches it.
 * A tier that simply knew the index would not be a difficulty setting, it would be a
 * different game with the same rules.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { perSymbol: 0.62, settle: 0.5, guesses: 0.24 },
  normal: { perSymbol: 0.34, settle: 0.28, guesses: 0.1 },
  hard: { perSymbol: 0.19, settle: 0.15, guesses: 0.03 },
});

export interface BotState {
  /** The order it will check the five slots in. */
  readonly order: number[];
  /** How far through that order it has read. */
  at: number;
  /** Seconds left on the symbol it is reading. */
  remaining: number;
  /** Whether it has planned this round. */
  ready: boolean;
  /** Whether this round is one it will guess on. */
  guessing: boolean;
}

export function createBotState(): BotState {
  return { order: [0, 1, 2, 3, 4], at: 0, remaining: 0, ready: false, guessing: false };
}

export function resetBotState(state: BotState): void {
  state.at = 0;
  state.remaining = 0;
  state.ready = false;
  state.guessing = false;
}

/**
 * Values a bot draws per round. Always exactly this many.
 *
 * `SET_SIZE − 1` for the shuffle of its search order and one for the guess roll. A seat
 * whose draw count depended on what it found would shift the other seat's stream, which is
 * the seat bias Fruit Duel was caught by.
 */
export const BOT_DRAWS_PER_ROUND = SET_SIZE;

/**
 * Which slot the bot touches this step, or −1.
 *
 * It plans a search order before it can see anything useful and then walks it at its own
 * reading speed. When it reaches the common symbol it touches that; if the round is one it
 * has decided to guess on, it touches whatever it is looking at when its patience runs out.
 */
export function botTouch(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): number {
  if (game.phase !== 'searching') {
    state.ready = false;
    return -1;
  }
  const profile = BOT_PROFILES[difficulty];

  if (!state.ready) {
    state.ready = true;
    state.at = 0;
    state.remaining = profile.settle + profile.perSymbol;
    for (let i = SET_SIZE - 1; i > 0; i -= 1) {
      const j = Math.floor(rng.float() * (i + 1));
      const swap = state.order[i] as number;
      state.order[i] = state.order[j] as number;
      state.order[j] = swap;
    }
    state.guessing = rng.float() < profile.guesses;
  }

  if (lockOf(game, seat) > 0 || foundOf(game, seat) !== -1) return -1;

  state.remaining -= fixedDeltaSeconds;
  if (state.remaining > 0) return -1;
  state.remaining = profile.perSymbol;

  const slot = state.order[state.at % SET_SIZE] as number;
  state.at += 1;

  // It touches the symbol it is reading only if it is the one — unless this is a round it
  // is guessing on, in which case the second symbol it looks at gets touched regardless.
  const isTheOne = setOf(game, seat)[slot] === game.common;
  if (isTheOne) return slot;
  if (state.guessing && state.at === 2) return slot;
  return -1;
}
