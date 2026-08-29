import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Dice Yatzy, as pure rules.
 *
 * Five dice, three rolls a turn, and after each roll you may keep any of them and re-roll
 * the rest. Then you must spend the hand on one of thirteen categories, each usable once.
 * Thirteen turns each, highest total wins.
 *
 * The whole game is in that "must spend": late on, every good category is used and you are
 * choosing which of your remaining ones to waste. Scoring zero somewhere is normal play,
 * not a mistake, and the interface has to make that possible without making it an accident.
 *
 * No rendering, no timing, no DOM.
 */

export const DICE = 5;
export const DIE_FACES = 6;
export const ROLLS_PER_TURN = 3;

export const CATEGORIES = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'three-of-a-kind',
  'four-of-a-kind',
  'full-house',
  'small-straight',
  'large-straight',
  'yatzy',
  'chance',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** The six number categories, which feed the upper bonus. */
export const UPPER: readonly Category[] = CATEGORIES.slice(0, 6);

/** Score 63 or more in the upper section — three of each number — and take 35. */
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;

export const FULL_HOUSE_SCORE = 25;
export const SMALL_STRAIGHT_SCORE = 30;
export const LARGE_STRAIGHT_SCORE = 40;
export const YATZY_SCORE = 50;

/**
 * How much the hard bot weights being ahead of the pace that reaches 63.
 *
 * Swept over 3,000 games a value. At 1.5 it averaged 184.6 and took the bonus 8.6% of the
 * time; at 3 it averages the same 184.6 and takes it **15.7%** — the same score played more
 * like a person. Past 3 it starts paying for the bonus with points it should have kept:
 * 183.5 at 5, 181.9 at 8.
 */
export const UPPER_PACE_WEIGHT = 3;

export type Sheet = Partial<Record<Category, number>>;

export type Phase = 'rolling' | 'choosing' | 'over';

export interface Game {
  /** The five dice as they lie. Empty before the first roll of a turn. */
  readonly dice: number[];
  /** Which dice are being kept for the next roll. */
  readonly held: boolean[];
  readonly sheetP1: Sheet;
  readonly sheetP2: Sheet;
  seat: SeatId;
  phase: Phase;
  /** Rolls used this turn, 0 to ROLLS_PER_TURN. */
  rollsUsed: number;
}

export function createGame(): Game {
  return {
    dice: [],
    held: new Array<boolean>(DICE).fill(false),
    sheetP1: {},
    sheetP2: {},
    seat: 'p1',
    phase: 'rolling',
    rollsUsed: 0,
  };
}

/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK
 * alternates it across the rounds of a best-of so first-mover advantage washes out
 * (#2466), and a game that assumed seat one would leave that rotation reaching nothing.
 * The default exists only so the rules tests can name a concrete side.
 */
export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  game.dice.length = 0;
  game.held.fill(false);
  for (const category of CATEGORIES) {
    delete game.sheetP1[category];
    delete game.sheetP2[category];
  }
  game.seat = opener;
  game.phase = 'rolling';
  game.rollsUsed = 0;
}

export function sheetOf(game: Game, seat: SeatId): Sheet {
  return seat === 'p1' ? game.sheetP1 : game.sheetP2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** How many of each face are showing, into `out` (length 7, index by face). */
export function counts(out: number[], dice: readonly number[]): number[] {
  for (let face = 0; face <= DIE_FACES; face += 1) out[face] = 0;
  for (const die of dice) {
    const at = out[die];
    if (at !== undefined) out[die] = at + 1;
  }
  return out;
}

const countScratch: number[] = new Array<number>(DIE_FACES + 1).fill(0);

function sumOf(dice: readonly number[]): number {
  let total = 0;
  for (const die of dice) total += die;
  return total;
}

/**
 * What a hand is worth in a category.
 *
 * Zero is a real answer, not an error: spending a hand on a category it does not fit is
 * ordinary late-game play.
 */
export function scoreFor(category: Category, dice: readonly number[]): number {
  if (dice.length === 0) return 0;
  const c = counts(countScratch, dice);

  switch (category) {
    case 'ones':
      return (c[1] ?? 0) * 1;
    case 'twos':
      return (c[2] ?? 0) * 2;
    case 'threes':
      return (c[3] ?? 0) * 3;
    case 'fours':
      return (c[4] ?? 0) * 4;
    case 'fives':
      return (c[5] ?? 0) * 5;
    case 'sixes':
      return (c[6] ?? 0) * 6;
    case 'three-of-a-kind':
      return hasOfAKind(c, 3) ? sumOf(dice) : 0;
    case 'four-of-a-kind':
      return hasOfAKind(c, 4) ? sumOf(dice) : 0;
    case 'full-house':
      return isFullHouse(c) ? FULL_HOUSE_SCORE : 0;
    case 'small-straight':
      return longestRun(c) >= 4 ? SMALL_STRAIGHT_SCORE : 0;
    case 'large-straight':
      return longestRun(c) >= 5 ? LARGE_STRAIGHT_SCORE : 0;
    case 'yatzy':
      return hasOfAKind(c, DICE) ? YATZY_SCORE : 0;
    case 'chance':
      return sumOf(dice);
  }
}

function hasOfAKind(c: readonly number[], n: number): boolean {
  for (let face = 1; face <= DIE_FACES; face += 1) {
    if ((c[face] ?? 0) >= n) return true;
  }
  return false;
}

/** Five of a kind counts: it is three *and* two of the same face. */
function isFullHouse(c: readonly number[]): boolean {
  let three = 0;
  let two = 0;
  for (let face = 1; face <= DIE_FACES; face += 1) {
    const count = c[face] ?? 0;
    if (count === 5) return true;
    if (count >= 3) three = face;
    else if (count === 2) two = face;
  }
  return three > 0 && two > 0;
}

export function longestRun(c: readonly number[]): number {
  let best = 0;
  let run = 0;
  for (let face = 1; face <= DIE_FACES; face += 1) {
    if ((c[face] ?? 0) > 0) {
      run += 1;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}

export function isTaken(sheet: Sheet, category: Category): boolean {
  return sheet[category] !== undefined;
}

export function categoriesLeft(sheet: Sheet): number {
  let count = 0;
  for (const category of CATEGORIES) {
    if (!isTaken(sheet, category)) count += 1;
  }
  return count;
}

/** The upper section subtotal, before any bonus. */
export function upperTotal(sheet: Sheet): number {
  let total = 0;
  for (const category of UPPER) total += sheet[category] ?? 0;
  return total;
}

export function bonusFor(sheet: Sheet): number {
  return upperTotal(sheet) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
}

export function totalFor(sheet: Sheet): number {
  let total = bonusFor(sheet);
  for (const category of CATEGORIES) total += sheet[category] ?? 0;
  return total;
}

/** Roll the dice that are not held. */
export function roll(game: Game, rng: Rng): boolean {
  if (game.phase !== 'rolling') return false;
  if (game.rollsUsed >= ROLLS_PER_TURN) return false;

  if (game.dice.length === 0) {
    for (let i = 0; i < DICE; i += 1) game.dice.push(rng.int(1, DIE_FACES + 1));
  } else {
    for (let i = 0; i < DICE; i += 1) {
      if (game.held[i] === true) continue;
      game.dice[i] = rng.int(1, DIE_FACES + 1);
    }
  }
  game.rollsUsed += 1;
  // The third roll ends the choosing of dice; the hand must now be spent.
  if (game.rollsUsed >= ROLLS_PER_TURN) game.phase = 'choosing';
  return true;
}

export function toggleHold(game: Game, index: number): boolean {
  if (game.dice.length === 0) return false;
  if (!Number.isInteger(index) || index < 0 || index >= DICE) return false;
  // Holding is only meaningful while a re-roll is still available.
  if (game.phase !== 'rolling' || game.rollsUsed === 0) return false;
  game.held[index] = game.held[index] !== true;
  return true;
}

/**
 * Spend the hand on a category and hand over.
 *
 * Returns false when the category is already used or there is no hand, so a refusal is
 * never mistaken for a score of zero — which is a real and different thing.
 */
export function score(game: Game, category: Category): boolean {
  if (game.phase === 'over') return false;
  if (game.dice.length === 0) return false;
  const sheet = sheetOf(game, game.seat);
  if (isTaken(sheet, category)) return false;

  sheet[category] = scoreFor(category, game.dice);
  game.dice.length = 0;
  game.held.fill(false);
  game.rollsUsed = 0;

  if (categoriesLeft(game.sheetP1) === 0 && categoriesLeft(game.sheetP2) === 0) {
    game.phase = 'over';
    return true;
  }
  game.seat = otherOf(game.seat);
  game.phase = 'rolling';
  return true;
}

export function winnerOf(game: Game): SeatId | 'draw' | null {
  if (game.phase !== 'over') return null;
  const p1 = totalFor(game.sheetP1);
  const p2 = totalFor(game.sheetP2);
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Keeps matching dice at all, rather than re-rolling the lot every time. */
  readonly keepsPairs: boolean;
  /** Weights the upper section toward the 63 that pays the bonus. */
  readonly chasesUpperBonus: boolean;
  /** Lets go of a low pair, which is worth less than a fresh roll of both dice. */
  readonly dropsWeakPairs: boolean;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { keepsPairs: false, chasesUpperBonus: false, dropsWeakPairs: false },
  normal: { keepsPairs: true, chasesUpperBonus: false, dropsWeakPairs: false },
  hard: { keepsPairs: true, chasesUpperBonus: true, dropsWeakPairs: true },
});

/**
 * Which dice the bot keeps before a re-roll, as a boolean per die.
 *
 * `easy` keeps nothing and simply re-rolls everything, which is what someone who has not
 * worked out that holding is allowed does. The others keep the largest matching group,
 * and prefer a straight when they already have four of one.
 */
export function botHold(out: boolean[], game: Game, difficulty: BotDifficulty): void {
  for (let i = 0; i < DICE; i += 1) out[i] = false;
  const profile = BOT_PROFILES[difficulty];
  if (!profile.keepsPairs) return;

  const c = counts(countScratch, game.dice);
  // The biggest group, breaking ties toward the higher face.
  let bestFace = 0;
  let bestCount = 1;
  for (let face = 1; face <= DIE_FACES; face += 1) {
    const count = c[face] ?? 0;
    if (count > bestCount || (count === bestCount && count > 1 && face > bestFace)) {
      bestCount = count;
      bestFace = face;
    }
  }

  // Four in a row is worth more than any group of the same size, so keep the run.
  //
  // Chasing a straight from *three* in a row was tried and measured: it cost 6.3 points a
  // game over 3,000 games and halved the upper-bonus rate. Two dice are not enough to fill
  // two gaps often enough to be worth giving up a developing group, however much it looks
  // like the clever play.
  const runLength = longestRun(c) >= 4 ? 4 : 0;
  if (runLength > 0 && runLength >= bestCount) {
    const start = runStart(c, runLength);
    if (start > 0) {
      const wanted = new Set<number>();
      for (let face = start; face < start + runLength; face += 1) wanted.add(face);
      for (let i = 0; i < DICE; i += 1) {
        const die = game.dice[i];
        if (die !== undefined && wanted.has(die)) {
          out[i] = true;
          wanted.delete(die);
        }
      }
      return;
    }
  }

  if (bestFace === 0) return;

  // A pair of ones or twos is worth less than two fresh dice: keeping it locks in about
  // three points and gives up two rolls at everything else.
  if (profile.dropsWeakPairs && bestCount === 2 && bestFace <= 2) return;

  for (let i = 0; i < DICE; i += 1) {
    if (game.dice[i] === bestFace) out[i] = true;
  }
}

function runStart(c: readonly number[], length: number): number {
  for (let face = 1; face + length - 1 <= DIE_FACES; face += 1) {
    let ok = true;
    for (let i = 0; i < length; i += 1) {
      if ((c[face + i] ?? 0) === 0) {
        ok = false;
        break;
      }
    }
    if (ok) return face;
  }
  return 0;
}

/**
 * The category the bot spends its hand on.
 *
 * It scores every open category and takes the best, with two adjustments that a person
 * makes and a naive maximiser does not: the upper bonus is worth chasing, and a category
 * that would score zero should be the *cheapest* zero rather than whichever comes first.
 */
export function botCategory(game: Game, difficulty: BotDifficulty): Category {
  const profile = BOT_PROFILES[difficulty];
  const sheet = sheetOf(game, game.seat);

  let best: Category = 'chance';
  let bestValue = -Infinity;
  for (const category of CATEGORIES) {
    if (isTaken(sheet, category)) continue;
    const raw = scoreFor(category, game.dice);
    let value = raw;

    if (profile.chasesUpperBonus && (UPPER as readonly string[]).includes(category)) {
      // Three of a number is the pace that reaches 63. Beating it is worth a little more
      // than the pips say, and falling short of it a little less.
      const face = UPPER.indexOf(category) + 1;
      const par = face * 3;
      if (upperTotal(sheet) < UPPER_BONUS_THRESHOLD) {
        // Capped at half the bonus. Uncapped, five sixes scored 30 + 36 = 66 in this
        // weighting and beat a 50-point yatzy — the aggregate average never noticed,
        // because a hand that good is rare, but it is plainly the wrong play and a test
        // for it is what found it. Being ahead of pace cannot be worth more than the
        // bonus it is chasing.
        const pace = (raw - par) * UPPER_PACE_WEIGHT;
        value += Math.max(-UPPER_BONUS / 2, Math.min(UPPER_BONUS / 2, pace));
      }
    }

    if (raw === 0) {
      // Every zero is worth the same nothing, so pick the one that costs least later:
      // the low numbers first, and never a big bonus category if something else will do.
      // Subtracted, not added: a category worth keeping should be the *last* place a
      // wasted turn goes. Adding it sent every zero into yatzy, which is the exact
      // beginner's mistake this is meant to avoid.
      value = -100 - zeroCost(category);
    }

    if (value > bestValue) {
      bestValue = value;
      best = category;
    }
  }
  return best;
}

/** How much a category is worth keeping, for choosing which zero hurts least. */
function zeroCost(category: Category): number {
  switch (category) {
    case 'ones':
      return 0;
    case 'twos':
      return 1;
    case 'threes':
      return 2;
    case 'fours':
      return 3;
    case 'fives':
      return 4;
    case 'sixes':
      return 5;
    case 'yatzy':
      return 12;
    case 'large-straight':
      return 10;
    case 'small-straight':
      return 9;
    case 'full-house':
      return 8;
    case 'four-of-a-kind':
      return 7;
    case 'three-of-a-kind':
      return 6;
    case 'chance':
      return 11;
  }
}
