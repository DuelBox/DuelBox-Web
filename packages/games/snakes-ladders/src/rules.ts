import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Snakes and Ladders, as pure rules.
 *
 * One token each on a shared serpentine board. Roll, move, climb a ladder or slide down a
 * snake, and the first token to **reach or pass** the last field wins.
 *
 * Two departures from the paper game, both deliberate and both explained in SPEC.md:
 *
 * 1. **Two dice are rolled and the player moves by one of them.** The observed rule is
 *    "roll a die to move" and nothing else, which leaves a player with no decision at all
 *    — and a game with no decision cannot have honest difficulty tiers, only rigged dice.
 *    Rolling two and choosing one keeps every roll fair and puts the whole of the skill in
 *    reading the board.
 * 2. **A snake bites a given player once.** After it has swallowed you it is full, and its
 *    head is spent for you for the rest of the match. This is what makes the match provably
 *    finite rather than merely finite in expectation — see {@link SNAKE_BUDGET}.
 *
 * No rendering, no timing, no DOM: the bot, the balance harness and the tests all reuse
 * this module, so anything that touches a canvas belongs in game.ts.
 */

/** Columns and rows of the board. Eight is a big tap target on a phone and a short race. */
export const COLUMNS = 8;
export const ROWS = 8;
/** Fields are numbered 1..FIELDS. Field 0 is the start, which is off the board. */
export const FIELDS = COLUMNS * ROWS;
export const START = 0;

/** How many dice are rolled each turn, and how many faces each has. */
export const DICE = 2;
export const DIE_FACES = 6;

export interface Jump {
  readonly from: number;
  readonly to: number;
}

/** Climbs. Every one of these is a field a player wants to stop on. */
export const LADDERS: readonly Jump[] = Object.freeze([
  Object.freeze({ from: 3, to: 19 }),
  Object.freeze({ from: 9, to: 28 }),
  Object.freeze({ from: 17, to: 35 }),
  Object.freeze({ from: 24, to: 41 }),
  Object.freeze({ from: 33, to: 50 }),
  Object.freeze({ from: 44, to: 58 }),
]);

/** Slides. No snake head sits on the last field, so the finish is never guarded. */
export const SNAKES: readonly Jump[] = Object.freeze([
  Object.freeze({ from: 21, to: 6 }),
  Object.freeze({ from: 30, to: 12 }),
  Object.freeze({ from: 38, to: 23 }),
  Object.freeze({ from: 47, to: 26 }),
  Object.freeze({ from: 54, to: 37 }),
  Object.freeze({ from: 61, to: 45 }),
]);

/**
 * The most ground every snake on this board can take from one player over a whole match.
 *
 * The termination argument rests on this number. A snake bites a player once, so the total
 * backward movement a player can ever suffer is fixed before the first roll; every turn
 * moves them forward by at least one field, so their position after T turns is at least
 * `T - SNAKE_BUDGET`. They must therefore be past the last field by turn
 * `FIELDS + SNAKE_BUDGET`, whatever the dice do. Nothing here is probabilistic.
 */
export const SNAKE_BUDGET = SNAKES.reduce((total, snake) => total + (snake.from - snake.to), 0);

/** The worst case, in turns per player, that {@link SNAKE_BUDGET} bounds the match at. */
export const MAX_TURNS_PER_SEAT = FIELDS + SNAKE_BUDGET;

/** First token to reach or pass the last field. Resolved by the SDK, never by hand. */
export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: FIELDS };

function buildIndex(jumps: readonly Jump[]): readonly number[] {
  const table = new Array<number>(FIELDS + 1).fill(-1);
  for (let i = 0; i < jumps.length; i += 1) {
    const jump = jumps[i];
    if (jump === undefined) continue;
    table[jump.from] = i;
  }
  return table;
}

const LADDER_INDEX = buildIndex(LADDERS);
const SNAKE_INDEX = buildIndex(SNAKES);

/** Which ladder starts on this field, or -1. Table lookup: no scan, no allocation. */
export function ladderAt(field: number): number {
  if (field < 0 || field > FIELDS) return -1;
  return LADDER_INDEX[field] ?? -1;
}

/** Which snake starts on this field, or -1, whether or not it is still hungry. */
export function snakeAt(field: number): number {
  if (field < 0 || field > FIELDS) return -1;
  return SNAKE_INDEX[field] ?? -1;
}

/** What happened when a token stopped somewhere. `spent` is a snake that had already fed. */
export type JumpKind = 'none' | 'ladder' | 'snake' | 'spent';

/**
 * Where a token that stops on `field` ends up.
 *
 * `bitten` is the moving seat's mask of snakes that have already had it. Overshooting the
 * last field is a win rather than a bounce back, so everything past the end settles on the
 * end — that is the observed rule, and it is also the first thing that keeps a match short.
 */
export function settle(field: number, bitten: number): number {
  if (field >= FIELDS) return FIELDS;
  const ladder = ladderAt(field);
  if (ladder >= 0) return LADDERS[ladder]?.to ?? field;
  const snake = snakeAt(field);
  if (snake >= 0 && (bitten & (1 << snake)) === 0) return SNAKES[snake]?.to ?? field;
  return field;
}

/** The same question as {@link settle}, answered as a reason rather than a field. */
export function settleKind(field: number, bitten: number): JumpKind {
  if (field >= FIELDS) return 'none';
  if (ladderAt(field) >= 0) return 'ladder';
  const snake = snakeAt(field);
  if (snake < 0) return 'none';
  return (bitten & (1 << snake)) === 0 ? 'snake' : 'spent';
}

/** The row a field sits in, counted from the bottom. Unitless: the renderer scales it. */
export function boardRow(field: number): number {
  return Math.floor((clampField(field) - 1) / COLUMNS);
}

/**
 * The column a field sits in, counted from the left.
 *
 * The board is a boustrophedon: field 1 is bottom-left, the bottom row runs right, and every
 * row after it doubles back. That is what makes a ladder able to reach across the board
 * rather than only up one file.
 */
export function boardColumn(field: number): number {
  const index = clampField(field) - 1;
  const row = Math.floor(index / COLUMNS);
  const along = index % COLUMNS;
  return row % 2 === 0 ? along : COLUMNS - 1 - along;
}

function clampField(field: number): number {
  if (field < 1) return 1;
  if (field > FIELDS) return FIELDS;
  return field;
}

export type Phase = 'rolling' | 'choosing' | 'resolving' | 'over';

export interface Position {
  /** The two faces as rolled, both 0 before the first roll of a turn. */
  readonly dice: number[];
  /** Each seat's field, 0 at the start and FIELDS once it has finished. */
  p1: number;
  p2: number;
  /** Bit per snake that has already bitten this seat, so it cannot bite again. */
  p1Bitten: number;
  p2Bitten: number;
  seat: SeatId;
  phase: Phase;
  /** Which die the last committed move used, -1 before any. */
  usedDie: number;
  /** The move that is being shown while the phase is `resolving`. */
  lastFrom: number;
  lastLanding: number;
  lastTo: number;
  lastKind: JumpKind;
  winner: SeatId | null;
}

export function createPosition(): Position {
  return {
    dice: new Array<number>(DICE).fill(0),
    p1: START,
    p2: START,
    p1Bitten: 0,
    p2Bitten: 0,
    seat: 'p1',
    phase: 'rolling',
    usedDie: -1,
    lastFrom: START,
    lastLanding: START,
    lastTo: START,
    lastKind: 'none',
    winner: null,
  };
}

/** Put a position back to the start without allocating a new one. */
export function resetPosition(position: Position): void {
  position.dice.fill(0);
  position.p1 = START;
  position.p2 = START;
  position.p1Bitten = 0;
  position.p2Bitten = 0;
  position.seat = 'p1';
  position.phase = 'rolling';
  position.usedDie = -1;
  position.lastFrom = START;
  position.lastLanding = START;
  position.lastTo = START;
  position.lastKind = 'none';
  position.winner = null;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function fieldOf(position: Position, seat: SeatId): number {
  return seat === 'p1' ? position.p1 : position.p2;
}

export function bittenOf(position: Position, seat: SeatId): number {
  return seat === 'p1' ? position.p1Bitten : position.p2Bitten;
}

/** Whether a snake has already had this seat, and so slides past it harmlessly. */
export function hasBitten(position: Position, seat: SeatId, snake: number): boolean {
  if (snake < 0 || snake >= SNAKES.length) return false;
  return (bittenOf(position, seat) & (1 << snake)) !== 0;
}

/** Roll both dice from the seeded stream. Returns false when it is not the moment to roll. */
export function roll(position: Position, rng: Rng): boolean {
  if (position.phase !== 'rolling') return false;
  for (let i = 0; i < DICE; i += 1) {
    position.dice[i] = rng.int(1, DIE_FACES + 1);
  }
  position.phase = 'choosing';
  return true;
}

export function dieAt(position: Position, index: number): number {
  return position.dice[index] ?? 0;
}

/** The field a die would land the seat on before any snake or ladder is applied. */
export function landingFor(position: Position, seat: SeatId, index: number): number {
  const die = dieAt(position, index);
  if (die === 0) return fieldOf(position, seat);
  return Math.min(FIELDS, fieldOf(position, seat) + die);
}

/** Where a die would actually leave the seat, snake or ladder included. */
export function destinationFor(position: Position, seat: SeatId, index: number): number {
  const die = dieAt(position, index);
  if (die === 0) return fieldOf(position, seat);
  return settle(fieldOf(position, seat) + die, bittenOf(position, seat));
}

/** What a die would do to the seat, as a reason. */
export function kindFor(position: Position, seat: SeatId, index: number): JumpKind {
  const die = dieAt(position, index);
  if (die === 0) return 'none';
  return settleKind(fieldOf(position, seat) + die, bittenOf(position, seat));
}

/**
 * Move by one of the two dice, which is the whole of the decision this game has.
 *
 * Both dice are always legal — there is no exact finish to overshoot and nothing to be
 * blocked by — so this only refuses an index that is not a die or a phase that is not the
 * choosing one. That matters for the pointer: a tap can always be answered.
 */
export function chooseDie(position: Position, index: number): boolean {
  if (position.phase !== 'choosing') return false;
  if (!Number.isInteger(index) || index < 0 || index >= DICE) return false;
  const die = dieAt(position, index);
  if (die < 1) return false;

  const seat = position.seat;
  const from = fieldOf(position, seat);
  const bitten = bittenOf(position, seat);
  const landing = from + die;
  const kind = settleKind(landing, bitten);
  const to = settle(landing, bitten);

  if (kind === 'snake') {
    const snake = snakeAt(landing);
    if (seat === 'p1') position.p1Bitten |= 1 << snake;
    else position.p2Bitten |= 1 << snake;
  }

  if (seat === 'p1') position.p1 = to;
  else position.p2 = to;

  position.usedDie = index;
  position.lastFrom = from;
  position.lastLanding = Math.min(FIELDS, landing);
  position.lastTo = to;
  position.lastKind = kind;

  if (to >= FIELDS) {
    position.winner = seat;
    position.phase = 'over';
    return true;
  }
  position.phase = 'resolving';
  return true;
}

/**
 * Hand the board to the other seat.
 *
 * Separate from {@link chooseDie} because a slide has to be *seen*: the caller holds the
 * position in `resolving` for a beat so the snake or ladder is on screen before the board
 * turns round. Rules that change hands the instant a key is pressed look like the game
 * skipped a turn.
 */
export function endTurn(position: Position): boolean {
  if (position.phase !== 'resolving') return false;
  position.seat = otherOf(position.seat);
  position.phase = 'rolling';
  position.dice.fill(0);
  position.usedDie = -1;
  position.lastKind = 'none';
  return true;
}

/** The outcome, decided by the SDK's `first-to` rather than by a comparison written here. */
export function winnerOf(position: Position): SeatId | 'draw' | null {
  return resolve(WIN_CONDITION, position);
}

/** How far along a seat is, which is what the shell's HUD shows. */
export function progressOf(position: Position, seat: SeatId): number {
  return fieldOf(position, seat);
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Chance of grabbing a die without looking at where it goes. */
  readonly blunder: number;
  /**
   * How much weight it puts on what the landing field exposes it to *next* turn, from 0
   * (only reads the square it lands on) to 1 (reads the square ahead as hard as the square
   * it is standing on).
   */
  readonly foresight: number;
}

/**
 * The three tiers, which differ **only** in how well they choose between two fair dice.
 *
 * Nothing here touches the dice themselves. A bot that rerolled, peeked, or nudged a face
 * would be getting physics no human can get, which rule 6 forbids outright — and in a game
 * whose only randomness *is* the die, biasing it is the one cheat available, so it is worth
 * saying plainly that it is not done.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ blunder: 0.8, foresight: 0 }),
  normal: Object.freeze({ blunder: 0.2, foresight: 0 }),
  hard: Object.freeze({ blunder: 0, foresight: 0.7 }),
});

/** A move that ends the match. Larger than any field, so nothing outbids winning. */
const WIN_SCORE = 1_000_000;

/**
 * What a field is worth to stand on, judged by what the next roll can do from it.
 *
 * The average over all thirty-six pairs of dice of the better of the two landings — which
 * is exactly the choice the player will face next turn. It is what tells a bot to stop one
 * short of a ladder rather than one short of a snake, and it is information a person reads
 * straight off the board.
 */
export function outlook(field: number, bitten: number): number {
  if (field >= FIELDS) return FIELDS;
  let total = 0;
  for (let a = 1; a <= DIE_FACES; a += 1) {
    const first = settle(field + a, bitten);
    for (let b = 1; b <= DIE_FACES; b += 1) {
      const second = settle(field + b, bitten);
      total += first > second ? first : second;
    }
  }
  return total / (DIE_FACES * DIE_FACES);
}

/**
 * Score one of the two dice for the seat to move.
 *
 * The immediate part needs no special case for snakes and ladders: `settle` has already
 * applied them, so a die that runs into a snake simply scores where the snake leaves you.
 */
export function scoreDie(
  position: Position,
  seat: SeatId,
  index: number,
  foresight: number,
): number {
  const die = dieAt(position, index);
  if (die < 1) return -Infinity;
  const from = fieldOf(position, seat);
  const bitten = bittenOf(position, seat);
  const landing = from + die;
  if (landing >= FIELDS) return WIN_SCORE;

  const to = settle(landing, bitten);
  if (to >= FIELDS) return WIN_SCORE;
  if (foresight <= 0) return to;

  // A snake that bites here is spent from here on, which changes what the field ahead is
  // worth. Reading the board without that would have the hard tier fear a dead snake.
  const kind = settleKind(landing, bitten);
  const after = kind === 'snake' ? bitten | (1 << snakeAt(landing)) : bitten;
  return to + foresight * (outlook(to, after) - to);
}

/**
 * The die a bot moves by, or -1 when there is nothing to choose.
 *
 * Every tier sees the board a human sees and the dice a human rolled. Difficulty is how
 * well it reads them, and nothing else.
 */
export function botDie(position: Position, rng: Rng, difficulty: BotDifficulty): number {
  if (position.phase !== 'choosing') return -1;
  const profile = BOT_PROFILES[difficulty];
  // Drawn even at a blunder rate of zero, so the three tiers consume the stream the same
  // way when they agree and a trace difference means a different *decision*.
  const careless = rng.bool(profile.blunder);
  if (careless) return rng.int(0, DICE);

  let best = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < DICE; index += 1) {
    const score = scoreDie(position, position.seat, index, profile.foresight);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}
