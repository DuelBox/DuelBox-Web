import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Hand Slap, as pure rules.
 *
 * One seat holds their hands out; the other tries to slap them before they pull away.
 * The attacker scores by connecting. The defender scores by **flinching the attacker into
 * a swing that misses** — but a dodge with no swing to dodge costs the defender a point,
 * which is the rule that makes it a mind game rather than a reaction test.
 *
 * The whole thing is a bluff. A defender who dodges on every twitch bleeds points; an
 * attacker who swings on every twitch does too. Neither player can win by being fast
 * alone, which is the point — a pure reaction contest is decided by hardware, and this
 * game is played on whatever two people happen to be holding.
 *
 * No rendering, no timing, no DOM.
 */

/** Points that win a match. */
export const TARGET_POINTS = 5;

/**
 * How long a swing takes to land, in seconds.
 *
 * This is the window the defender has to react in, and it is the number the whole game
 * balances on. Too short and only reflexes matter; too long and dodging is free.
 */
export const SWING_SECONDS = 0.34;

/** How long a dodge keeps the hands out of reach. */
export const DODGE_SECONDS = 0.42;

/** How long after a dodge before the hands can be pulled away again. */
export const DODGE_COOLDOWN_SECONDS = 0.55;

/** How long the round pauses after a point, so both players see what happened. */
export const SETTLE_SECONDS = 1.1;

/** Shortest and longest wait before a new round becomes live. */
export const MIN_READY_SECONDS = 0.6;
export const MAX_READY_SECONDS = 2.4;

export type Phase =
  /** Hands are settling; nothing counts yet. */
  | 'ready'
  /** Live: the attacker may swing, the defender may dodge. */
  | 'live'
  /** A swing is in the air and has not yet landed. */
  | 'swinging'
  /** A point has been scored; the board is holding still so both players see it. */
  | 'settling';

export type Outcome =
  /** The swing connected. */
  | 'hit'
  /** The swing landed on nothing because the hands had moved. */
  | 'dodged'
  /** A dodge with no swing to dodge. */
  | 'flinch'
  | null;

export interface State {
  phase: Phase;
  /** Which seat is swinging this round. */
  attacker: SeatId;
  /** Seconds left in the current phase. */
  timer: number;
  /** Seconds until the defender may dodge again. */
  dodgeCooldown: number;
  /** Seconds the defender's hands stay out of reach. */
  dodgeRemaining: number;
  /** What settled the last point, for the game to show. */
  outcome: Outcome;
  /** Who took the last point, so the renderer can say so. */
  scorer: SeatId | null;
  p1: number;
  p2: number;
  /** Rounds played, which decides who attacks next. */
  round: number;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createState(): State {
  return {
    phase: 'ready',
    attacker: 'p1',
    timer: MIN_READY_SECONDS,
    dodgeCooldown: 0,
    dodgeRemaining: 0,
    outcome: null,
    scorer: null,
    p1: 0,
    p2: 0,
    round: 0,
  };
}

export function resetState(state: State): void {
  state.phase = 'ready';
  state.attacker = 'p1';
  state.timer = MIN_READY_SECONDS;
  state.dodgeCooldown = 0;
  state.dodgeRemaining = 0;
  state.outcome = null;
  state.scorer = null;
  state.p1 = 0;
  state.p2 = 0;
  state.round = 0;
}

/** True while the defender's hands are out of reach. */
export function handsAway(state: Readonly<State>): boolean {
  return state.dodgeRemaining > 0;
}

/** The seat defending this round. */
export function defenderOf(state: Readonly<State>): SeatId {
  return otherOf(state.attacker);
}

function award(state: State, seat: SeatId, outcome: Outcome): void {
  if (seat === 'p1') state.p1 += 1;
  else state.p2 += 1;
  state.scorer = seat;
  state.outcome = outcome;
  state.phase = 'settling';
  state.timer = SETTLE_SECONDS;
  state.dodgeRemaining = 0;
  state.dodgeCooldown = 0;
}

/**
 * The attacker swings.
 *
 * Returns false when the swing was not accepted — during the wait, mid-swing, or while a
 * point is settling — so a caller can tell a refused swing from one that simply missed.
 */
export function swing(state: State): boolean {
  if (state.phase !== 'live') return false;
  state.phase = 'swinging';
  state.timer = SWING_SECONDS;
  return true;
}

/**
 * The defender pulls their hands away.
 *
 * Returns false when the dodge was not accepted. A dodge during the wait, or one while
 * the hands are already away, is simply nothing. A dodge *while the round is live and no
 * swing is in the air* is a flinch, and costs a point — that is what stops a defender
 * hammering the button.
 */
export function dodge(state: State): boolean {
  if (state.phase === 'ready' || state.phase === 'settling') return false;
  if (state.dodgeCooldown > 0 || state.dodgeRemaining > 0) return false;

  if (state.phase === 'live') {
    // Nothing to dodge: a flinch, and the attacker takes the point.
    award(state, state.attacker, 'flinch');
    return true;
  }
  state.dodgeRemaining = DODGE_SECONDS;
  state.dodgeCooldown = DODGE_COOLDOWN_SECONDS;
  return true;
}

/** How long to wait before the next round goes live. Seeded, never `Math.random`. */
export function readyDelay(rng: Rng): number {
  return MIN_READY_SECONDS + rng.float() * (MAX_READY_SECONDS - MIN_READY_SECONDS);
}

/**
 * Advance one fixed step.
 *
 * The whole state machine lives here: a wait becomes live, a swing lands or misses, and a
 * settled point starts the next round with the seats swapped.
 */
export function step(state: State, fixedDeltaSeconds: number, rng: Rng): void {
  if (state.dodgeCooldown > 0) state.dodgeCooldown = Math.max(0, state.dodgeCooldown - fixedDeltaSeconds);
  if (state.dodgeRemaining > 0) {
    state.dodgeRemaining = Math.max(0, state.dodgeRemaining - fixedDeltaSeconds);
  }

  state.timer -= fixedDeltaSeconds;
  if (state.timer > 0) return;

  if (state.phase === 'ready') {
    state.phase = 'live';
    // A live round has no deadline of its own; the attacker takes as long as they like.
    state.timer = Number.POSITIVE_INFINITY;
    state.outcome = null;
    state.scorer = null;
    return;
  }

  if (state.phase === 'swinging') {
    // The swing lands. Whether it connects depends only on where the hands are now.
    if (handsAway(state)) award(state, defenderOf(state), 'dodged');
    else award(state, state.attacker, 'hit');
    return;
  }

  if (state.phase === 'settling') {
    // Seats swap every round, so neither player attacks twice running and the advantage
    // of attacking — whatever it turns out to be — is shared exactly.
    state.round += 1;
    state.attacker = otherOf(state.attacker);
    state.phase = 'ready';
    state.timer = readyDelay(rng);
    state.dodgeRemaining = 0;
    state.dodgeCooldown = 0;
  }
}

export function winnerOf(state: Readonly<State>): SeatId | 'draw' | null {
  if (state.p1 >= TARGET_POINTS && state.p2 >= TARGET_POINTS) {
    return state.p1 === state.p2 ? 'draw' : state.p1 > state.p2 ? 'p1' : 'p2';
  }
  if (state.p1 >= TARGET_POINTS) return 'p1';
  if (state.p2 >= TARGET_POINTS) return 'p2';
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds of reaction time before the bot can respond to a swing it has seen.
   *
   * A human's simple visual reaction is about 0.25s, so a bot faster than that is not a
   * better player, it is a machine — and rule 6 says a bot never gets speed a human cannot
   * have. `hard` sits at the quick end of human, not past it.
   */
  readonly reaction: number;
  /** Chance per live second that the attacker chooses to swing. */
  readonly swingRate: number;
  /** Chance the defender panics and dodges with nothing in the air. */
  readonly flinchRate: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.42, swingRate: 0.7, flinchRate: 0.55 },
  normal: { reaction: 0.3, swingRate: 1.1, flinchRate: 0.22 },
  hard: { reaction: 0.22, swingRate: 1.6, flinchRate: 0.04 },
});

/** What a bot remembers between steps: only how long it has been watching a swing. */
export interface BotState {
  /** Seconds the current swing has been visible to the bot. */
  watched: number;
}

export function createBotState(): BotState {
  return { watched: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.watched = 0;
}

export type BotAction = 'none' | 'swing' | 'dodge';

/**
 * What a bot does this step.
 *
 * It sees exactly what a human sees: the phase, and whether a swing is in the air. It is
 * told nothing about when the swing started beyond having watched it, and nothing at all
 * about the other seat's intentions.
 */
export function botAction(
  state: Readonly<State>,
  bot: BotState,
  profile: BotProfile,
  seat: SeatId,
  fixedDeltaSeconds: number,
  roll: number,
): BotAction {
  if (state.phase === 'ready' || state.phase === 'settling') {
    bot.watched = 0;
    return 'none';
  }

  if (seat === state.attacker) {
    bot.watched = 0;
    if (state.phase !== 'live') return 'none';
    // A per-second rate turned into a per-step chance, so the bot's timing does not
    // change with the step rate.
    return roll < profile.swingRate * fixedDeltaSeconds ? 'swing' : 'none';
  }

  // Defending.
  if (state.phase === 'live') {
    bot.watched = 0;
    if (state.dodgeCooldown > 0 || state.dodgeRemaining > 0) return 'none';
    return roll < profile.flinchRate * fixedDeltaSeconds ? 'dodge' : 'none';
  }

  // A swing is in the air. The bot may only act once it has watched it for its own
  // reaction time — the same delay a person needs, and never less.
  bot.watched += fixedDeltaSeconds;
  if (bot.watched < profile.reaction) return 'none';
  if (state.dodgeCooldown > 0 || state.dodgeRemaining > 0) return 'none';
  return 'dodge';
}
