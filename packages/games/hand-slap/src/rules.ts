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

/**
 * A fresh match.
 *
 * `opener` is the seat that attacks the first round, and it comes from
 * `context.openingSeat` rather than from here. Hard-coding `p1` was the whole of this
 * game's seat bias: see {@link resetState}.
 */
export function createState(opener: SeatId = 'p1'): State {
  return {
    phase: 'ready',
    attacker: opener,
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

/**
 * Reset in place, with `opener` attacking first.
 *
 * The attacker alternates strictly and {@link TARGET_POINTS} is odd, so the seat that
 * attacks round zero also attacks rounds two, four, six and eight - five of the nine
 * rounds a 5-4 match runs to. Whenever the role decides the round, that seat wins the
 * match, and starting every match from a literal `p1` handed it seat one every time. The
 * shell already flips the opening seat between the rounds of a best-of; this reads it.
 */
export function resetState(state: State, opener: SeatId = 'p1'): void {
  state.phase = 'ready';
  state.attacker = opener;
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
  if (state.dodgeCooldown > 0)
    state.dodgeCooldown = Math.max(0, state.dodgeCooldown - fixedDeltaSeconds);
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
   * The **middle** of the bot's reaction time, in seconds. Never the whole of it.
   *
   * A single number here was defect #2504. Whether a dodge beats a swing is decided by
   * `reaction` against {@link SWING_SECONDS}, and with both sides constant the comparison
   * has one answer for the whole match: `easy` sat above 0.34 s and its defender was hit
   * every single round; `normal` and `hard` sat below it and their defender was never hit
   * at all. The tier stopped being a difficulty and became a *verdict* — two equal bots
   * did not play, they alternated a decided role, and a match was settled the moment the
   * shell picked an opening seat. Nothing in a win-rate ladder can see that; the ladder
   * was monotone throughout.
   *
   * Each swing now draws its own reaction from `reaction ± {@link REACTION_JITTER_SECONDS}`,
   * so every tier's distribution **straddles** the swing rather than sitting on one side of
   * it, and every tier is a hit *rate*. See {@link jitteredReaction}.
   *
   * A human's simple visual reaction is about 0.25 s, so a bot faster than that is not a
   * better player, it is a machine — and rule 6 says a bot never gets speed a human cannot
   * have. What the rule constrains is the **fastest** the bot can ever be, which is
   * `reaction - REACTION_JITTER_SECONDS`, not the average: `hard` bottoms out at 0.22 s, the
   * quick end of human — which is the number `hard` used to hit on *every* swing, and is
   * now the best it can ever do.
   */
  readonly reaction: number;
  /** Chance per live second that the attacker chooses to swing. */
  readonly swingRate: number;
  /** Chance the defender panics and dodges with nothing in the air. */
  readonly flinchRate: number;
}

/**
 * How far a single swing's reaction may wander either side of the tier's middle.
 *
 * Chosen, not guessed. A dodge beats a swing when the reaction that swing drew comes in
 * under **0.35 s** — {@link SWING_SECONDS} rounded up to the next whole fixed step, because
 * the defender's last chance to act is the step before the slap lands. With the jitter
 * uniform over `reaction ± 0.10 s`, a tier's share of swings it dodges in time is
 * `(0.35 - reaction + 0.10) / 0.20`, which puts the three tiers at 15%, 40% and 65% —
 * twenty-five points apart, so no tier can be mistaken for its neighbour, and none of them
 * is 0% or 100%, which is the whole point of the fix.
 *
 * The width is squeezed from both ends. It has to be wide enough that the slowest tier can
 * still reach 0.35 s — `easy` is 0.42 s, so anything under ±0.07 s makes `easy` a verdict
 * again — and narrow enough that the quickest tier's floor, `reaction - jitter`, stays at a
 * speed a person can manage (rule 6). ±0.10 s clears both with room, and leaves the three
 * rates evenly spaced; at ±0.05 s these same centres give 0%, 30% and 80%, and `easy` is a
 * verdict again.
 */
export const REACTION_JITTER_SECONDS = 0.1;

/**
 * The tiers, as distributions.
 *
 * `easy` keeps the 0.42 s it always had; `normal` and `hard` moved out from 0.30 and 0.22
 * so that all three straddle the 0.35 s the dodge is decided at rather than two of them
 * sitting well under it. `hard`'s old constant 0.22 s survives as its **floor**. Every tier is slower on average than it was, which is the safe
 * direction under rule 6 — jitter can only ever cost the bot a swing it used to win.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.42, swingRate: 0.7, flinchRate: 0.55 },
  normal: { reaction: 0.37, swingRate: 1.1, flinchRate: 0.22 },
  hard: { reaction: 0.32, swingRate: 1.6, flinchRate: 0.04 },
});

/**
 * This swing's reaction time, from a seeded roll in `[0, 1)`.
 *
 * Uniform over `reaction ± REACTION_JITTER_SECONDS`. `roll` comes from the match generator
 * (rule 4 — never `Math.random`), and it is handed to the bot **by role rather than by
 * seat**, so a seed opened from one chair draws the same numbers as the same seed opened
 * from the other and a match and its mirror stay one match.
 */
export function jitteredReaction(profile: BotProfile, roll: number): number {
  return profile.reaction + (roll * 2 - 1) * REACTION_JITTER_SECONDS;
}

/** What a bot remembers between steps. Two numbers, allocated once (rule 5). */
export interface BotState {
  /** Seconds the current swing has been visible to the bot. */
  watched: number;
  /**
   * The reaction this bot drew for the swing it is watching, or 0 when it is watching
   * none. Drawn **once per swing**, not once per step: re-rolling every step would turn
   * the reaction into a per-step lottery that a long swing always eventually wins.
   */
  reaction: number;
}

export function createBotState(): BotState {
  return { watched: 0, reaction: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.watched = 0;
  bot.reaction = 0;
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
    bot.reaction = 0;
    return 'none';
  }

  if (seat === state.attacker) {
    bot.watched = 0;
    bot.reaction = 0;
    if (state.phase !== 'live') return 'none';
    // A per-second rate turned into a per-step chance, so the bot's timing does not
    // change with the step rate.
    return roll < profile.swingRate * fixedDeltaSeconds ? 'swing' : 'none';
  }

  // Defending.
  if (state.phase === 'live') {
    bot.watched = 0;
    bot.reaction = 0;
    if (state.dodgeCooldown > 0 || state.dodgeRemaining > 0) return 'none';
    return roll < profile.flinchRate * fixedDeltaSeconds ? 'dodge' : 'none';
  }

  // A swing is in the air, and this is the first step the bot has seen it: draw the
  // reaction it will need for *this* swing. One roll per swing, from the seeded stream,
  // and a plain number assigned into state the bot already owns - no allocation (rule 5).
  if (bot.watched === 0) bot.reaction = jitteredReaction(profile, roll);

  // The bot may only act once it has watched the swing for that reaction time — the same
  // delay a person needs, and never less.
  bot.watched += fixedDeltaSeconds;
  if (bot.watched < bot.reaction) return 'none';
  if (state.dodgeCooldown > 0 || state.dodgeRemaining > 0) return 'none';
  return 'dodge';
}
