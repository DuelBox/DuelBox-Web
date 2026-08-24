import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Backgammon, as pure rules. No rendering, no timing, no DOM — the bot, the balance
 * harness and the tests all reuse this module, so anything that touches a canvas belongs
 * in game.ts.
 *
 * ## Travel indices, not point numbers
 *
 * A backgammon board is the same twenty-four points read in opposite directions by the two
 * players, and every rule in the game is stated from the mover's own end: your home board,
 * your bar, your bear-off. So positions here are addressed by **travel index** — how far a
 * checker of that seat has come, 0 at the point it starts furthest from home and 23 on the
 * last point before it bears off. `boardIndex` converts a seat's travel index to the shared
 * point it stands on, and it is the only place the two directions meet.
 *
 * That one choice is what makes the seats symmetric for free: every rule, every bot score
 * and every test is written once and reads the same for both players, and a mirrored
 * position produces exactly the mirrored moves. `rules.test.ts` asserts that rather than
 * assuming it.
 */

export const POINTS = 24;
export const CHECKERS = 15;
export const DIE_FACES = 6;
/** The first travel index of a seat's home board. The last six points before bearing off. */
export const HOME_START = 18;
/** The travel index that means "borne off". Reached exactly, or overshot from the back. */
export const BEAR_OFF = 24;
/** The travel index of the bar: one step behind the board, which is why a hit costs 25 pips. */
export const BAR = -1;
/** Pips a seat must cover from the opening position — the classic 167. */
export const START_PIPS = 167;

/**
 * Turns after which the race is settled on pips, both seats counted.
 *
 * Backgammon has no draw and no clock, and nothing in the rules stops two weak players from
 * hitting each other back and forth for ever.
 *
 * Two hundred and twenty is a backstop rather than a rule anybody plays against: over two
 * thousand measured easy-against-easy matches it was reached not once, and the longest ran
 * 121 turns. The pairings that trade blots for a long time do reach it — 18 matches in 400
 * for normal against normal — and those settle on pips, which is the right answer for a
 * race neither side is finishing.
 *
 * It is also the thing that makes the match *guaranteed* to end, which
 * `apps/web/src/data/termination.test.ts` requires of every game and which no amount of
 * average-case measurement can promise on its own. SPEC.md carries the arithmetic that
 * shows the cap clears the ten-minute guard even in the worst turn the dice can produce.
 */
export const MAX_TURNS = 220;

export type Phase = 'rolling' | 'moving' | 'over';

/**
 * The opening position, as (travel index, checkers). The standard one: two on the far
 * point, five on the mid point, three on the bar point and five on the six point.
 */
const START_LAYOUT: readonly (readonly [number, number])[] = [
  [0, 2],
  [11, 5],
  [16, 3],
  [18, 5],
];

export interface Position {
  /**
   * Checkers on each point, indexed in p1's travel order: positive counts p1's checkers,
   * negative counts p2's. One signed number rather than two arrays because a point can
   * never hold both colours, and the sign says which it is holding.
   */
  readonly points: number[];
  barP1: number;
  barP2: number;
  offP1: number;
  offP2: number;
  seat: SeatId;
  phase: Phase;
  /** Dice still to be played this turn. Four of them on a double, largest first otherwise. */
  readonly dice: number[];
  /** The pair as it was rolled, kept so a double still shows as the pair a player threw. */
  readonly rolled: number[];
  /** Turns taken by both seats. `MAX_TURNS` reads it. */
  turns: number;
  winner: SeatId | 'draw' | null;
}

export function createPosition(): Position {
  const position: Position = {
    points: new Array<number>(POINTS).fill(0),
    barP1: 0,
    barP2: 0,
    offP1: 0,
    offP2: 0,
    seat: 'p1',
    phase: 'rolling',
    dice: [],
    rolled: [0, 0],
    turns: 0,
    winner: null,
  };
  resetPosition(position);
  return position;
}

export function resetPosition(position: Position): void {
  position.points.fill(0);
  for (const [travel, count] of START_LAYOUT) {
    position.points[travel] = (position.points[travel] ?? 0) + count;
    const mirrored = POINTS - 1 - travel;
    position.points[mirrored] = (position.points[mirrored] ?? 0) - count;
  }
  position.barP1 = 0;
  position.barP2 = 0;
  position.offP1 = 0;
  position.offP2 = 0;
  position.seat = 'p1';
  position.phase = 'rolling';
  position.dice.length = 0;
  position.rolled[0] = 0;
  position.rolled[1] = 0;
  position.turns = 0;
  position.winner = null;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** The shared point a seat's travel index names. The two seats run opposite ways. */
export function boardIndex(seat: SeatId, travel: number): number {
  return seat === 'p1' ? travel : POINTS - 1 - travel;
}

/** How many of `seat`'s own checkers stand on that travel index. */
export function ownAt(position: Position, seat: SeatId, travel: number): number {
  if (travel < 0 || travel >= POINTS) return 0;
  const signed = position.points[boardIndex(seat, travel)] ?? 0;
  const count = seat === 'p1' ? signed : -signed;
  return count > 0 ? count : 0;
}

/** How many of the *other* seat's checkers stand there. Two or more of them block it. */
export function foeAt(position: Position, seat: SeatId, travel: number): number {
  return ownAt(position, otherOf(seat), POINTS - 1 - travel);
}

export function barOf(position: Position, seat: SeatId): number {
  return seat === 'p1' ? position.barP1 : position.barP2;
}

export function offOf(position: Position, seat: SeatId): number {
  return seat === 'p1' ? position.offP1 : position.offP2;
}

function setBar(position: Position, seat: SeatId, value: number): void {
  if (seat === 'p1') position.barP1 = value;
  else position.barP2 = value;
}

function setOff(position: Position, seat: SeatId, value: number): void {
  if (seat === 'p1') position.offP1 = value;
  else position.offP2 = value;
}

function place(position: Position, seat: SeatId, travel: number, delta: number): void {
  const index = boardIndex(seat, travel);
  const signed = position.points[index] ?? 0;
  position.points[index] = signed + (seat === 'p1' ? delta : -delta);
}

/** Where a move lands, as a travel index. `BEAR_OFF` or beyond means off the board. */
export function destinationOf(from: number, die: number): number {
  return from === BAR ? die - 1 : from + die;
}

/** True when every checker a seat still has is inside its home board. Bearing off needs it. */
export function allHome(position: Position, seat: SeatId): boolean {
  if (barOf(position, seat) > 0) return false;
  for (let travel = 0; travel < HOME_START; travel += 1) {
    if (ownAt(position, seat, travel) > 0) return false;
  }
  return true;
}

/**
 * Whether one checker may take one die.
 *
 * Four refusals, and each of them is a rule of the game rather than a convenience:
 *
 * - **The bar comes first.** A seat with a checker on the bar may move nothing else until
 *   it is back on, which is the whole reason hitting is worth anything.
 * - **A point held by two or more opponents is closed.** One of them is a blot and may be
 *   hit; two is a wall.
 * - **Bearing off needs every checker home**, and then an exact roll — except from the
 *   furthest point back, where a larger die bears off rather than being wasted.
 */
export function canMove(position: Position, seat: SeatId, from: number, die: number): boolean {
  if (die < 1 || die > DIE_FACES) return false;
  const onBar = barOf(position, seat);
  if (from === BAR) {
    if (onBar === 0) return false;
  } else {
    if (onBar > 0) return false;
    if (from < 0 || from >= POINTS) return false;
    if (ownAt(position, seat, from) === 0) return false;
  }

  const to = destinationOf(from, die);
  if (to < POINTS) return foeAt(position, seat, to) <= 1;

  if (!allHome(position, seat)) return false;
  if (to === BEAR_OFF) return true;
  // Overshooting only bears off the checker furthest from home: anything still behind it
  // has to be brought in first, which is what makes the last few rolls a decision.
  for (let travel = HOME_START; travel < from; travel += 1) {
    if (ownAt(position, seat, travel) > 0) return false;
  }
  return true;
}

/**
 * A move is one number: the point it starts from and the die it uses.
 *
 * Encoded rather than held as an object because the legal moves are recomputed every step
 * and games may not allocate per frame (CLAUDE.md rule 5). The stride is 8 so a die always
 * survives the low three bits, and the +1 lets the bar (-1) share the encoding.
 */
const MOVE_STRIDE = 8;

export function encodeMove(from: number, die: number): number {
  return (from + 1) * MOVE_STRIDE + die;
}

export function moveFrom(code: number): number {
  return Math.floor(code / MOVE_STRIDE) - 1;
}

export function moveDie(code: number): number {
  return code % MOVE_STRIDE;
}

export function moveTo(code: number): number {
  return destinationOf(moveFrom(code), moveDie(code));
}

function hasDie(position: Position, die: number): boolean {
  for (let i = 0; i < position.dice.length; i += 1) {
    if (position.dice[i] === die) return true;
  }
  return false;
}

function removeDie(position: Position, die: number): void {
  const dice = position.dice;
  let found = -1;
  for (let i = 0; i < dice.length; i += 1) {
    if (dice[i] === die) {
      found = i;
      break;
    }
  }
  if (found < 0) return;
  for (let i = found; i < dice.length - 1; i += 1) dice[i] = dice[i + 1] ?? 0;
  dice.length -= 1;
}

/**
 * Every legal move with the dice still in hand, written into `out`.
 *
 * Ordered by the point it starts from and then by the die, always — the keyboard walks this
 * list one press at a time, so the order has to be something a player can predict. Travel
 * order is the same order both seats read the board in once it has turned to face them, so
 * "press right" walks the highlight towards home for both of them.
 */
export function legalMoves(out: number[], position: Position, seat: SeatId): number {
  out.length = 0;
  if (position.phase !== 'moving') return 0;

  if (barOf(position, seat) > 0) {
    for (let die = 1; die <= DIE_FACES; die += 1) {
      if (!hasDie(position, die)) continue;
      if (canMove(position, seat, BAR, die)) out.push(encodeMove(BAR, die));
    }
    return out.length;
  }

  for (let from = 0; from < POINTS; from += 1) {
    if (ownAt(position, seat, from) === 0) continue;
    for (let die = 1; die <= DIE_FACES; die += 1) {
      if (!hasDie(position, die)) continue;
      if (canMove(position, seat, from, die)) out.push(encodeMove(from, die));
    }
  }
  return out.length;
}

export function hasMove(position: Position, seat: SeatId): boolean {
  if (position.phase !== 'moving') return false;
  if (barOf(position, seat) > 0) {
    for (let die = 1; die <= DIE_FACES; die += 1) {
      if (hasDie(position, die) && canMove(position, seat, BAR, die)) return true;
    }
    return false;
  }
  for (let from = 0; from < POINTS; from += 1) {
    if (ownAt(position, seat, from) === 0) continue;
    for (let die = 1; die <= DIE_FACES; die += 1) {
      if (hasDie(position, die) && canMove(position, seat, from, die)) return true;
    }
  }
  return false;
}

/** Throw both dice. A double is played four times, which is the one thing everyone knows. */
export function roll(position: Position, rng: Rng): number {
  if (position.phase !== 'rolling') return 0;
  const a = rng.int(1, DIE_FACES + 1);
  const b = rng.int(1, DIE_FACES + 1);
  position.rolled[0] = a;
  position.rolled[1] = b;
  position.dice.length = 0;
  if (a === b) {
    for (let i = 0; i < 4; i += 1) position.dice.push(a);
  } else {
    position.dice.push(a > b ? a : b);
    position.dice.push(a > b ? b : a);
  }
  position.phase = 'moving';
  return position.dice.length;
}

export interface MoveResult {
  readonly moved: boolean;
  /** True when this move sent a lone opponent checker to the bar. */
  readonly hit: boolean;
  readonly borneOff: boolean;
  /** True when this move finished the match. */
  readonly won: boolean;
}

const NOTHING: MoveResult = Object.freeze({
  moved: false,
  hit: false,
  borneOff: false,
  won: false,
});

/**
 * Play one move.
 *
 * Returns a result rather than a bare boolean so a caller can tell a refusal from a move
 * that hit nothing — they look the same on the board and mean different things.
 */
export function applyMove(position: Position, code: number): MoveResult {
  if (position.phase !== 'moving') return NOTHING;
  const seat = position.seat;
  const from = moveFrom(code);
  const die = moveDie(code);
  if (!canMove(position, seat, from, die)) return NOTHING;

  if (from === BAR) setBar(position, seat, barOf(position, seat) - 1);
  else place(position, seat, from, -1);

  const to = destinationOf(from, die);
  let hit = false;
  let borneOff = false;
  if (to < POINTS) {
    // A lone opponent checker is a blot: it goes to the bar and starts its lap again.
    if (foeAt(position, seat, to) === 1) {
      const foe = otherOf(seat);
      place(position, foe, POINTS - 1 - to, -1);
      setBar(position, foe, barOf(position, foe) + 1);
      hit = true;
    }
    place(position, seat, to, 1);
  } else {
    setOff(position, seat, offOf(position, seat) + 1);
    borneOff = true;
  }

  removeDie(position, die);
  const won = settle(position);
  // A turn is over when the dice are spent. A turn with dice left but nothing to do with
  // them is passed by the caller, after holding it on screen long enough to be read.
  if (!won && position.dice.length === 0) endTurn(position);
  return { moved: true, hit, borneOff, won };
}

/** Hand the dice to the other seat. */
export function endTurn(position: Position): void {
  if (position.phase === 'over') return;
  position.dice.length = 0;
  position.seat = otherOf(position.seat);
  position.phase = 'rolling';
  position.turns += 1;
  settle(position);
}

/** End a turn that has no legal move in it. Refuses a turn that has one. */
export function passTurn(position: Position): boolean {
  if (position.phase !== 'moving') return false;
  if (hasMove(position, position.seat)) return false;
  endTurn(position);
  return true;
}

/**
 * Bearing off fifteen checkers wins. The shared helper decides it rather than a comparison
 * written here, so "first to fifteen" means what it means everywhere else in the catalogue.
 */
const WIN_CONDITION: WinCondition = { kind: 'first-to', target: CHECKERS };

/**
 * And if the turn cap arrives first, the race is settled on how far each side has come —
 * the same helper every game with a clock uses, given the pip counts as the score.
 */
const RACE_CONDITION: WinCondition = { kind: 'highest-when-time-expires' };

export function winnerOf(position: Position): SeatId | 'draw' | null {
  const borneOff = resolve(WIN_CONDITION, { p1: position.offP1, p2: position.offP2 });
  if (borneOff !== null) return borneOff;
  if (position.turns < MAX_TURNS) return null;
  return resolve(
    RACE_CONDITION,
    { p1: pipsGained(position, 'p1'), p2: pipsGained(position, 'p2') },
    { timeExpired: true },
  );
}

function settle(position: Position): boolean {
  const winner = winnerOf(position);
  if (winner === null) return false;
  position.winner = winner;
  position.phase = 'over';
  position.dice.length = 0;
  return true;
}

/** Pips still to cover. A checker on the bar is twenty-five from home, the board plus one. */
export function pipsLeft(position: Position, seat: SeatId): number {
  let pips = barOf(position, seat) * (POINTS + 1);
  for (let travel = 0; travel < POINTS; travel += 1) {
    pips += ownAt(position, seat, travel) * (POINTS - travel);
  }
  return pips;
}

/**
 * How far a seat has come, which is what the shell's HUD shows.
 *
 * Borne-off checkers is the score a backgammon player would name, but it sits at nought for
 * most of a match and tells a spectator nothing about who is ahead. Pips gained moves on
 * **every** move and is the number the game is actually about — and it goes *down* when you
 * are hit, which is the point of being hit. Early on that can read below zero, and it
 * should: a checker on the bar is further from home than it was when it started.
 */
export function pipsGained(position: Position, seat: SeatId): number {
  return START_PIPS - pipsLeft(position, seat);
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Chance of grabbing a legal move without looking at it. */
  readonly blunder: number;
  /** Whether it goes looking for a blot to hit rather than only tripping over one. */
  readonly hits: boolean;
  /** How much it minds leaving a blot of its own, from 0 (blind) to 1 (counts the shots). */
  readonly safety: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { blunder: 0.55, hits: false, safety: 0 },
  normal: { blunder: 0.18, hits: true, safety: 0.5 },
  hard: { blunder: 0, hits: true, safety: 1 },
});

/**
 * How many of the six dice would let the opponent land on this travel index next turn.
 *
 * The direct shots only — a number a player counts off the board in a second, which is
 * exactly the point: rule 6 says a bot may not read anything a human cannot see, and
 * "which of my blots can be hit with one die" is the first thing anybody looks at.
 * Combination shots are not counted, by anybody.
 */
export function exposure(position: Position, seat: SeatId, travel: number): number {
  if (travel < 0 || travel >= POINTS) return 0;
  let ways = 0;
  for (let die = 1; die <= DIE_FACES; die += 1) {
    const source = travel + die;
    if (source < POINTS && foeAt(position, seat, source) > 0) {
      ways += 1;
      continue;
    }
    // A checker of theirs on the bar re-enters into this seat's home board.
    if (barOf(position, otherOf(seat)) > 0 && travel === POINTS - die) ways += 1;
  }
  return ways;
}

/**
 * Score a candidate move.
 *
 * The four things a person weighs on an ordinary turn: get a checker off, hit theirs, land
 * somewhere safe, and make ground. Bearing off is worth more than all of it and has to be
 * said so explicitly, or a fat hit bonus talks the bot out of finishing the game.
 */
function scoreMove(position: Position, seat: SeatId, code: number, profile: BotProfile): number {
  const from = moveFrom(code);
  const die = moveDie(code);
  const to = destinationOf(from, die);
  if (to >= BEAR_OFF) return 4000 + die;

  let score = to * 5;
  // Coming off the bar is forced anyway; scoring it keeps the ordering sane when it is not
  // the only entry available and the dice differ.
  if (from === BAR) score += 300;
  if (to >= HOME_START) score += 40;

  if (profile.hits && foeAt(position, seat, to) === 1) {
    // Hitting a checker that has come a long way costs them more, so it is worth more.
    score += 240 + (POINTS - 1 - to) * 5;
  }

  const after = ownAt(position, seat, to) + 1;
  if (after >= 2) score += 70;
  else if (profile.safety > 0) score -= profile.safety * exposure(position, seat, to) * 40;

  // Leaving a made point breaks it into a blot, which is the cost nobody counts at first.
  if (from !== BAR && ownAt(position, seat, from) === 2 && profile.safety > 0) {
    score -= profile.safety * 30;
  }

  return score;
}

const moveScratch: number[] = [];

/**
 * The move a bot plays, or -1 when it has none.
 *
 * Every tier sees the board a human sees. Difficulty is how well it chooses among the legal
 * moves — never extra information, never a second look at the dice.
 */
export function botMove(position: Position, rng: Rng, difficulty: BotDifficulty): number {
  const count = legalMoves(moveScratch, position, position.seat);
  if (count === 0) return -1;

  const profile = BOT_PROFILES[difficulty];
  if (rng.bool(profile.blunder)) return moveScratch[rng.int(0, count)] ?? -1;

  let best = moveScratch[0] ?? -1;
  let bestScore = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const code = moveScratch[i] ?? 0;
    const score = scoreMove(position, position.seat, code, profile);
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  }
  return best;
}
