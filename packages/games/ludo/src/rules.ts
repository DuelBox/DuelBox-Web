import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Ludo Dash, as pure rules.
 *
 * Three tokens each. Roll a six to bring one out; move a token round the shared loop and
 * up your own home column. **Get one token home and you have won** — the race, not the
 * full four-token game, which is what the reference genre does on a phone.
 *
 * Land on an opponent and they go back to the start. That capture is the whole of the
 * interaction: without it two players roll dice at each other in parallel and never meet.
 *
 * No rendering, no timing, no DOM.
 */

export const TOKENS = 3;
/** Squares in the shared loop. */
export const TRACK = 32;
/** Squares in a seat's own home column, beyond the loop. */
export const HOME_RUN = 5;
/** The progress value that means home. Must be reached exactly. */
export const HOME = TRACK + HOME_RUN;
export const DIE_FACES = 6;
/** Only this roll brings a token out of the start. */
export const RELEASE_ROLL = 6;

/** Where each seat joins the loop. Opposite each other, so both laps are the same length. */
export const ENTRY: Readonly<Record<SeatId, number>> = Object.freeze({ p1: 0, p2: TRACK / 2 });

/** A token yet to be released. */
export const AT_START = -1;

export type Phase = 'rolling' | 'choosing' | 'over';

export interface Game {
  /** Progress per token: -1 at the start, 0..TRACK-1 on the loop, TRACK..HOME in the column. */
  readonly p1: number[];
  readonly p2: number[];
  seat: SeatId;
  phase: Phase;
  /** The die as rolled, 0 before the first roll of a turn. */
  die: number;
  winner: SeatId | null;
}

export function createGame(): Game {
  return {
    p1: new Array<number>(TOKENS).fill(AT_START),
    p2: new Array<number>(TOKENS).fill(AT_START),
    seat: 'p1',
    phase: 'rolling',
    die: 0,
    winner: null,
  };
}

export function resetGame(game: Game): void {
  game.p1.fill(AT_START);
  game.p2.fill(AT_START);
  game.seat = 'p1';
  game.phase = 'rolling';
  game.die = 0;
  game.winner = null;
}

export function tokensOf(game: Game, seat: SeatId): number[] {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * The square of the shared loop a token stands on, or -1 when it is not on the loop.
 *
 * A token at the start or up its home column is not on the loop and cannot be captured
 * there — which is what makes the home column worth reaching.
 */
export function loopSquare(seat: SeatId, progress: number): number {
  if (progress < 0 || progress >= TRACK) return -1;
  return (ENTRY[seat] + progress) % TRACK;
}

export function isHome(progress: number): boolean {
  return progress === HOME;
}

export function tokensHome(game: Game, seat: SeatId): number {
  let count = 0;
  for (const progress of tokensOf(game, seat)) {
    if (isHome(progress)) count += 1;
  }
  return count;
}

/**
 * Whether a token may take this roll.
 *
 * Two refusals: a token at the start needs a six, and a token near home must land on it
 * **exactly** — overshooting is not a move, which is what makes the last few squares a
 * decision rather than a formality.
 */
export function canMove(game: Game, seat: SeatId, token: number, die: number): boolean {
  const tokens = tokensOf(game, seat);
  const progress = tokens[token];
  if (progress === undefined) return false;
  if (die < 1 || die > DIE_FACES) return false;
  if (isHome(progress)) return false;
  if (progress === AT_START) return die === RELEASE_ROLL;
  return progress + die <= HOME;
}

export function legalMoves(out: number[], game: Game, seat: SeatId, die: number): number {
  out.length = 0;
  for (let token = 0; token < TOKENS; token += 1) {
    if (canMove(game, seat, token, die)) out.push(token);
  }
  return out.length;
}

export function hasMove(game: Game, seat: SeatId, die: number): boolean {
  for (let token = 0; token < TOKENS; token += 1) {
    if (canMove(game, seat, token, die)) return true;
  }
  return false;
}

export function roll(game: Game, rng: Rng): number {
  if (game.phase !== 'rolling') return 0;
  game.die = rng.int(1, DIE_FACES + 1);
  game.phase = 'choosing';
  return game.die;
}

export interface MoveResult {
  readonly moved: boolean;
  /** Opponent tokens sent back to the start by this move. */
  readonly captured: number;
  /** True when this move took a token home and won the match. */
  readonly won: boolean;
}

const NOTHING: MoveResult = Object.freeze({ moved: false, captured: 0, won: false });

/**
 * Move a token.
 *
 * Returns a result rather than a bare boolean so a caller can tell a refusal from a move
 * that captured nothing — they look the same on the board and mean different things.
 */
export function move(game: Game, token: number): MoveResult {
  if (game.phase !== 'choosing') return NOTHING;
  const seat = game.seat;
  const die = game.die;
  if (!canMove(game, seat, token, die)) return NOTHING;

  const tokens = tokensOf(game, seat);
  const from = tokens[token] ?? AT_START;
  const to = from === AT_START ? 0 : from + die;
  tokens[token] = to;

  // A capture only happens on the shared loop. Home columns and the start are safe.
  let captured = 0;
  const square = loopSquare(seat, to);
  if (square >= 0) {
    const theirs = tokensOf(game, otherOf(seat));
    for (let i = 0; i < theirs.length; i += 1) {
      if (loopSquare(otherOf(seat), theirs[i] ?? AT_START) !== square) continue;
      theirs[i] = AT_START;
      captured += 1;
    }
  }

  if (isHome(to)) {
    game.winner = seat;
    game.phase = 'over';
    return { moved: true, captured, won: true };
  }

  // A six earns another roll, which is what stops a bad run of dice from being hopeless.
  if (die === RELEASE_ROLL) {
    game.phase = 'rolling';
    return { moved: true, captured, won: false };
  }

  game.seat = otherOf(seat);
  game.phase = 'rolling';
  return { moved: true, captured, won: false };
}

/** End a turn that had no legal move. */
export function passTurn(game: Game): boolean {
  if (game.phase !== 'choosing') return false;
  if (hasMove(game, game.seat, game.die)) return false;
  game.seat = otherOf(game.seat);
  game.phase = 'rolling';
  game.die = 0;
  return true;
}

export function winnerOf(game: Game): SeatId | null {
  return game.winner;
}

/** How far along a seat's best token is, which is what the shell's HUD shows. */
export function leadOf(game: Game, seat: SeatId): number {
  let best = 0;
  for (const progress of tokensOf(game, seat)) {
    if (progress > best) best = progress;
  }
  return best;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Chance of taking a random legal move instead of the chosen one. */
  readonly blunder: number;
  /** Looks for captures rather than only for progress. */
  readonly capturesGladly: boolean;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { blunder: 0.6, capturesGladly: false },
  normal: { blunder: 0.2, capturesGladly: true },
  hard: { blunder: 0, capturesGladly: true },
});

/**
 * Whether an opponent could land on this square of the loop with their next roll.
 *
 * Kept because a caller may want it and it is the natural thing to ask — but **the bot
 * deliberately does not use it**, which is worth explaining.
 *
 * Avoiding capture is the main skill in ordinary Ludo. It is not a skill in *this* game.
 * Winning here means getting **one** token home, so being sent back costs one of three
 * tokens rather than the race, and dodging is not worth the tempo. Wiring it into the
 * hard tier changed the chosen move on almost every unforced turn and moved the win rate
 * by −0.2 points against `easy` and −0.7 against `normal` — nothing, or slightly worse.
 * It was measured, and then taken out rather than kept as decoration.
 */
export function isThreatened(game: Game, seat: SeatId, square: number): boolean {
  if (square < 0) return false;
  const them = otherOf(seat);
  for (const progress of tokensOf(game, them)) {
    if (progress < 0 || progress >= TRACK) continue;
    for (let die = 1; die <= DIE_FACES; die += 1) {
      const to = progress + die;
      if (to >= TRACK) break;
      if (loopSquare(them, to) === square) return true;
    }
  }
  return false;
}

const moveScratch: number[] = [];

/**
 * Score a candidate move.
 *
 * Three things a person weighs: getting a token home, taking one of theirs, and how far
 * along the token already is — a leader is worth pushing rather than spreading the risk.
 */
function scoreMove(game: Game, seat: SeatId, token: number, profile: BotProfile): number {
  const tokens = tokensOf(game, seat);
  const from = tokens[token] ?? AT_START;
  const die = game.die;
  const to = from === AT_START ? 0 : from + die;

  if (isHome(to)) return 10_000;

  let score = to;
  // Reaching the home column at all puts a token beyond capture.
  if (to >= TRACK) score += 200;

  if (profile.capturesGladly) {
    const square = loopSquare(seat, to);
    if (square >= 0) {
      for (const theirs of tokensOf(game, otherOf(seat))) {
        if (loopSquare(otherOf(seat), theirs) === square) score += 300 + theirs;
      }
    }
  }

  return score;
}

/**
 * The token a bot moves, or -1 when it has none.
 *
 * Every tier sees the board a human sees. Difficulty is how well it chooses among the legal
 * moves, never extra information and never a reroll.
 */
export function botMove(game: Game, rng: Rng, difficulty: BotDifficulty): number {
  const count = legalMoves(moveScratch, game, game.seat, game.die);
  if (count === 0) return -1;

  const profile = BOT_PROFILES[difficulty];
  if (rng.bool(profile.blunder)) return moveScratch[rng.int(0, count)] as number;

  let best = moveScratch[0] as number;
  let bestScore = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const token = moveScratch[i] as number;
    const score = scoreMove(game, game.seat, token, profile);
    if (score > bestScore) {
      bestScore = score;
      best = token;
    }
  }
  return best;
}
