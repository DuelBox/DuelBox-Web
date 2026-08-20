import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Shut the Box, as pure rules.
 *
 * Nine numbered tiles stand open. Roll two dice, then shut any set of open tiles adding
 * up to the roll. Keep going until no set adds up and your turn is over; your score is
 * what you failed to shut. Both players take a full turn each, and the **lower** score
 * wins — the only game here where scoring down is the goal, which the shell's HUD has to
 * be told about rather than left to infer.
 *
 * The single rule that makes it a game of judgement rather than luck: **a roll can
 * usually be made in several ways**, and which tiles you spend decides what you can still
 * reach. Shutting 7 as 7 keeps 3+4; shutting it as 3+4 keeps 7.
 *
 * No rendering, no timing, no DOM.
 */

export const TILE_COUNT = 9;
/** Two dice, so a roll is 2–12. */
export const DICE = 2;
export const DIE_FACES = 6;

/**
 * Below this, one die. The traditional rule, and it matters: with 7, 8 and 9 shut, the
 * best two-dice roll still cannot be made with the tiles left, so a player who has done
 * well would be punished for it.
 */
export const ONE_DIE_BELOW = 7;

export type Phase = 'rolling' | 'choosing' | 'handover' | 'over';

export interface Game {
  /** Open tiles, index 0 being tile 1. A shut tile is false. */
  readonly open: boolean[];
  /** The dice as rolled, length 1 or 2. Zero-length before the first roll of a turn. */
  readonly dice: number[];
  /** Tiles the player has picked so far this roll, as tile numbers. */
  readonly picked: number[];
  seat: SeatId;
  phase: Phase;
  /** Final scores; -1 until that seat has finished its turn. */
  scoreP1: number;
  scoreP2: number;
}

export function createGame(): Game {
  return {
    open: new Array<boolean>(TILE_COUNT).fill(true),
    dice: [],
    picked: [],
    seat: 'p1',
    phase: 'rolling',
    scoreP1: -1,
    scoreP2: -1,
  };
}

export function resetGame(game: Game): void {
  game.open.fill(true);
  game.dice.length = 0;
  game.picked.length = 0;
  game.seat = 'p1';
  game.phase = 'rolling';
  game.scoreP1 = -1;
  game.scoreP2 = -1;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** The sum of the tiles still open — a player's score if their turn ended now. */
export function openTotal(game: Game): number {
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if (game.open[i] === true) total += i + 1;
  }
  return total;
}

/** The highest open tile, or 0 when the box is shut. */
export function highestOpen(game: Game): number {
  for (let i = TILE_COUNT - 1; i >= 0; i -= 1) {
    if (game.open[i] === true) return i + 1;
  }
  return 0;
}

/** Whether one die is offered, which the traditional rule allows once 7, 8 and 9 are shut. */
export function oneDieAllowed(game: Game): boolean {
  return highestOpen(game) < ONE_DIE_BELOW;
}

export function rollTotal(game: Game): number {
  let total = 0;
  for (const die of game.dice) total += die;
  return total;
}

/**
 * Roll, into the game's own array so nothing allocates per turn.
 *
 * `dieCount` is the player's choice where the rule allows it; anything else is clamped to
 * what is legal, so a caller cannot roll one die with the 9 still standing.
 */
export function roll(game: Game, rng: Rng, dieCount = DICE): void {
  const allowed = oneDieAllowed(game) ? dieCount : DICE;
  const count = allowed === 1 ? 1 : DICE;
  game.dice.length = 0;
  for (let i = 0; i < count; i += 1) game.dice.push(rng.int(1, DIE_FACES + 1));
  game.picked.length = 0;
  game.phase = 'choosing';
}

/**
 * Can the open tiles make `target` at all?
 *
 * Nine tiles is 512 subsets, so this could be brute-forced, but it is called from the bot
 * search often enough to be worth doing properly. A bitmask reachability sweep over sums
 * up to 12 costs nine passes and allocates nothing.
 */
export function canMake(game: Game, target: number): boolean {
  if (target <= 0) return false;
  // Bit n set means "some subset of the tiles seen so far sums to n".
  let reachable = 1;
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if (game.open[i] !== true) continue;
    reachable |= reachable << (i + 1);
  }
  return (reachable & (1 << target)) !== 0;
}

/** Whether the tiles picked so far could still be completed to the roll. */
export function pickedTotal(game: Game): number {
  let total = 0;
  for (const tile of game.picked) total += tile;
  return total;
}

export function isPicked(game: Game, tile: number): boolean {
  return game.picked.includes(tile);
}

/**
 * Toggle a tile in the current pick.
 *
 * Returns false when the tile is shut, out of range, or would take the pick past the
 * roll — a refusal a caller can show, rather than a silent no-op that reads as a missed
 * tap.
 */
export function togglePick(game: Game, tile: number): boolean {
  if (game.phase !== 'choosing') return false;
  if (!Number.isInteger(tile) || tile < 1 || tile > TILE_COUNT) return false;
  if (game.open[tile - 1] !== true) return false;

  const at = game.picked.indexOf(tile);
  if (at >= 0) {
    game.picked.splice(at, 1);
    return true;
  }
  if (pickedTotal(game) + tile > rollTotal(game)) return false;
  game.picked.push(tile);
  return true;
}

/** Whether the current pick exactly makes the roll and may be shut. */
export function pickComplete(game: Game): boolean {
  return (
    game.phase === 'choosing' && game.picked.length > 0 && pickedTotal(game) === rollTotal(game)
  );
}

/** Whether this seat's turn is over: the roll cannot be made from what is open. */
export function turnIsDead(game: Game): boolean {
  return game.phase === 'choosing' && !canMake(game, rollTotal(game));
}

export interface CommitResult {
  /** False when the pick did not make the roll. */
  readonly shut: boolean;
  /** True when the box is now empty — a perfect round. */
  readonly boxShut: boolean;
}

/** Shut the picked tiles. */
export function commitPick(game: Game): CommitResult {
  if (!pickComplete(game)) return { shut: false, boxShut: false };
  for (const tile of game.picked) game.open[tile - 1] = false;
  game.picked.length = 0;
  game.dice.length = 0;
  const boxShut = highestOpen(game) === 0;
  game.phase = boxShut ? 'handover' : 'rolling';
  if (boxShut) recordScore(game, 0);
  return { shut: true, boxShut };
}

function recordScore(game: Game, score: number): void {
  if (game.seat === 'p1') game.scoreP1 = score;
  else game.scoreP2 = score;
}

/**
 * End this seat's turn on the tiles it could not shut, and hand over — or finish the
 * match if both have played.
 */
export function endTurn(game: Game): void {
  if (game.phase === 'over') return;
  if (highestOpen(game) > 0) recordScore(game, openTotal(game));
  game.dice.length = 0;
  game.picked.length = 0;

  if (game.seat === 'p2') {
    game.phase = 'over';
    return;
  }
  game.seat = 'p2';
  game.open.fill(true);
  game.phase = 'rolling';
}

/** The winner, 'draw', or null while the match is live. Lower score wins. */
export function winnerOf(game: Game): SeatId | 'draw' | null {
  if (game.phase !== 'over') return null;
  if (game.scoreP1 === game.scoreP2) return 'draw';
  return game.scoreP1 < game.scoreP2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * How the three tiers choose between the ways of making a roll.
 *
 * `blunder` is the chance of taking a random legal set instead of the chosen one, and
 * `lookahead` is whether the tier scores a candidate by what it leaves reachable rather
 * than only by what it shuts.
 */
export const BOT_PROFILES: Readonly<
  Record<BotDifficulty, { readonly blunder: number; readonly lookahead: boolean }>
> = Object.freeze({
  easy: { blunder: 0.65, lookahead: false },
  normal: { blunder: 0.2, lookahead: true },
  hard: { blunder: 0, lookahead: true },
});

/**
 * Every set of open tiles summing to `target`, appended to `out` as bitmasks.
 *
 * Bit `n` of a mask means tile `n + 1`. Returned as masks rather than arrays so the
 * search allocates nothing per candidate.
 */
export function legalSets(out: number[], game: Game, target: number): number {
  out.length = 0;
  if (target <= 0) return 0;
  search(out, game, target, 0, 0);
  return out.length;
}

function search(out: number[], game: Game, remaining: number, from: number, mask: number): void {
  if (remaining === 0) {
    out.push(mask);
    return;
  }
  for (let i = from; i < TILE_COUNT; i += 1) {
    const tile = i + 1;
    if (tile > remaining) break;
    if (game.open[i] !== true) continue;
    search(out, game, remaining - tile, i + 1, mask | (1 << i));
  }
}

/** The chance the next roll can be made, given a set of open tiles as a bitmask. */
function survivalOdds(openMask: number): number {
  let reachable = 1;
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if ((openMask & (1 << i)) === 0) continue;
    reachable |= reachable << (i + 1);
  }
  let highest = 0;
  for (let i = TILE_COUNT - 1; i >= 0; i -= 1) {
    if ((openMask & (1 << i)) !== 0) {
      highest = i + 1;
      break;
    }
  }
  if (highest === 0) return 1;

  // Every face pair, weighted equally — the honest distribution, not a sum-of-two
  // approximation, because 7 is six times as likely as 2 and that is the whole shape of
  // the risk.
  let made = 0;
  let total = 0;
  if (highest < ONE_DIE_BELOW) {
    for (let die = 1; die <= DIE_FACES; die += 1) {
      total += 1;
      if ((reachable & (1 << die)) !== 0) made += 1;
    }
    return made / total;
  }
  for (let a = 1; a <= DIE_FACES; a += 1) {
    for (let b = 1; b <= DIE_FACES; b += 1) {
      total += 1;
      if ((reachable & (1 << (a + b))) !== 0) made += 1;
    }
  }
  return made / total;
}

function maskOfOpen(game: Game): number {
  let mask = 0;
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if (game.open[i] === true) mask |= 1 << i;
  }
  return mask;
}

/** Reused by the bot so choosing a move allocates nothing. */
const candidateBuffer: number[] = [];

/**
 * The set of tiles a bot shuts, as a bitmask, or 0 when the roll cannot be made.
 *
 * Every tier sees exactly what a human sees — the open tiles and the roll. Difficulty is
 * how well it chooses among the legal sets, never extra information and never a reroll.
 */
export function botPick(game: Game, rng: Rng, difficulty: BotDifficulty): number {
  const count = legalSets(candidateBuffer, game, rollTotal(game));
  if (count === 0) return 0;

  const profile = BOT_PROFILES[difficulty];
  if (rng.bool(profile.blunder)) return candidateBuffer[rng.int(0, count)] as number;

  const openMask = maskOfOpen(game);
  let best = candidateBuffer[0] as number;
  let bestScore = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const mask = candidateBuffer[i] as number;
    // Shutting the high tiles first is the standard heuristic, and it is what a tier
    // without lookahead uses on its own.
    let score = 0;
    for (let bit = 0; bit < TILE_COUNT; bit += 1) {
      if ((mask & (1 << bit)) !== 0) score += (bit + 1) * (bit + 1);
    }
    if (profile.lookahead) score += survivalOdds(openMask & ~mask) * 400;
    if (score > bestScore) {
      bestScore = score;
      best = mask;
    }
  }
  return best;
}

/** Whether a bot takes the one-die option, offered only once 7, 8 and 9 are shut. */
export function botTakesOneDie(game: Game, difficulty: BotDifficulty): boolean {
  if (!oneDieAllowed(game)) return false;
  if (difficulty === 'easy') return false;
  // With little left, one die is far more likely to be makeable than two.
  const openMask = maskOfOpen(game);
  let two = 0;
  let one = 0;
  let reachable = 1;
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if ((openMask & (1 << i)) === 0) continue;
    reachable |= reachable << (i + 1);
  }
  for (let die = 1; die <= DIE_FACES; die += 1) {
    if ((reachable & (1 << die)) !== 0) one += 1;
  }
  for (let a = 1; a <= DIE_FACES; a += 1) {
    for (let b = 1; b <= DIE_FACES; b += 1) {
      if ((reachable & (1 << (a + b))) !== 0) two += 1;
    }
  }
  return one / DIE_FACES > two / (DIE_FACES * DIE_FACES);
}

export function tilesOfMask(out: number[], mask: number): number {
  out.length = 0;
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if ((mask & (1 << i)) !== 0) out.push(i + 1);
  }
  return out.length;
}
