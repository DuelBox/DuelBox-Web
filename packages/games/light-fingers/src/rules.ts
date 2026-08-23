import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Light Fingers, as pure rules.
 *
 * Five pedestals under one display case. The case goes dark, the diamond is moved, and
 * when the lights come back up it is glinting on exactly one of them. Both thieves reach
 * for it at once; the first hand to close on the right pedestal takes the point.
 *
 * The two things that make it a game rather than a reaction test:
 *
 * 1. **A hand takes time to travel.** One pedestal per {@link MOVE_SECONDS}, for every
 *    instrument and every player. Where you were standing when the lights came up matters
 *    as much as how fast you saw it.
 * 2. **You may commit before the lights.** A grab armed in the dark fires the instant the
 *    case opens — a one-in-five gamble that pays a whole round of tempo when it lands. A
 *    grab that closes on the wrong pedestal trips the alarm and freezes that hand for
 *    {@link ALARM_SECONDS}, which is most of the round.
 *
 * So mashing loses: it arms in the dark, misses four times in five, and spends the round
 * locked. Waiting loses to somebody who guessed right. That is the whole design.
 *
 * No rendering, no timing, no DOM — the bot and the balance harness reuse this module.
 */

/** Pedestals in the case. Five is enough to make a guess a gamble and few enough to read. */
export const SLOT_COUNT = 5;

/** Points that win a match, from the observed rule: "First to 5 wins!". */
export const TARGET_POINTS = 5;

/**
 * How long a hand takes to move one pedestal.
 *
 * The single most important number here, because it is the same for a thumb and for a
 * key. A pointer names its destination in one gesture and a keyboard walks there, but the
 * *hand* travels at this rate either way, so neither instrument can out-reach the other.
 */
export const MOVE_SECONDS = 0.09;

/** Shortest and longest dark phase. A fixed wait would be learnable. */
export const MIN_CASING_SECONDS = 0.7;
export const MAX_CASING_SECONDS = 2.1;

/** How long the diamond stays exposed before the case slams shut on nobody. */
export const OPEN_SECONDS = 2.6;

/** How long a hand is frozen after closing on the wrong pedestal. */
export const ALARM_SECONDS = 0.75;

/** How long the board holds still after a round, so both players read what happened. */
export const SETTLE_SECONDS = 1;

/**
 * The backstop clock, in seconds of simulated play.
 *
 * A match is first-to-five and lands well inside a minute, but nothing in the round loop
 * *guarantees* a point: two players who never grab would bust every round for ever. The
 * clock is what makes termination a property of the rules rather than a hope about the
 * players — see the note at the top of `apps/web/src/data/termination.test.ts`.
 */
export const MATCH_SECONDS = 150;

/** Resolved by the SDK helper, never by a comparison written here. */
export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: TARGET_POINTS };

/**
 * The rail, in logical units.
 *
 * Geometry rather than rendering: the pointer names a pedestal by where it lands on the
 * rail, so the mapping from a logical x to a slot is part of the rules and is unit-tested
 * as such. Five slots of 96 centred in a 600-wide box leaves 60 either side.
 */
export const RAIL_LEFT = 60;
export const SLOT_WIDTH = 96;

/** Where both hands start: the middle pedestal, so neither seat begins nearer anything. */
export const START_SLOT = 2;

export type Phase =
  /** The case is dark. Hands may move; a grab armed now waits for the lights. */
  | 'casing'
  /** The diamond is showing. A grab that closes on it scores. */
  | 'open'
  /** The round is over and the board is holding still. */
  | 'settling';

export type RoundOutcome =
  /** Somebody closed on the diamond. */
  | 'steal'
  /** The case shut with the diamond still on its pedestal. */
  | 'bust'
  | null;

/** Who took the round. `'both'` is a genuine tie, not a tie-break nobody can see. */
export type Scorer = SeatId | 'both' | null;

export interface Hand {
  /** Which pedestal the hand is over, 0 to {@link SLOT_COUNT} − 1. */
  slot: number;
  /** Which pedestal it is travelling towards. */
  want: number;
  /** Seconds until the hand may move another pedestal. */
  moveTimer: number;
  /** Seconds the alarm has this hand frozen. */
  lock: number;
  /** A grab is committed and will close the moment the hand settles on its aim. */
  armed: boolean;
}

export interface State {
  phase: Phase;
  /** Seconds left in the current phase. */
  timer: number;
  /** Seconds of match played, which the backstop clock reads. */
  clock: number;
  /** Which pedestal holds the diamond, or −1 while the case is dark. */
  diamond: number;
  p1Hand: Hand;
  p2Hand: Hand;
  p1: number;
  p2: number;
  /** Who took the last round, for the renderer. */
  scorer: Scorer;
  outcome: RoundOutcome;
  /** Rounds finished, for the renderer and the tests. */
  round: number;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * The nearest real pedestal to a number.
 *
 * Defensive on purpose: a pointer coordinate reaches this after arithmetic, and the
 * storm in `input-fuzz` supplies coordinates far outside the box. Anything that is not a
 * number at all falls back to the middle rather than propagating a NaN into the state.
 */
export function clampSlot(slot: number): number {
  if (Number.isNaN(slot)) return START_SLOT;
  if (slot < 0) return 0;
  if (slot > SLOT_COUNT - 1) return SLOT_COUNT - 1;
  return Math.round(slot);
}

/** Centre of a pedestal on the rail, in logical units. */
export function slotCentreX(slot: number): number {
  return RAIL_LEFT + (clampSlot(slot) + 0.5) * SLOT_WIDTH;
}

/**
 * Which pedestal a logical x names.
 *
 * Anything left of the rail is the first pedestal and anything right of it is the last,
 * so a thumb on the bezel still means something rather than nothing — the storm in
 * `input-fuzz` puts pointers well outside the box and a person's thumb lands on the edge
 * often enough to matter.
 */
export function slotForX(x: number): number {
  return clampSlot(Math.floor((x - RAIL_LEFT) / SLOT_WIDTH));
}

function createHand(): Hand {
  return { slot: START_SLOT, want: START_SLOT, moveTimer: 0, lock: 0, armed: false };
}

function resetHand(hand: Hand): void {
  hand.slot = START_SLOT;
  hand.want = START_SLOT;
  hand.moveTimer = 0;
  hand.lock = 0;
  hand.armed = false;
}

/**
 * Clear a hand for the next round without moving it.
 *
 * Where you finished the last round is where you start the next one, and that is the
 * gamble: pre-positioning costs nothing and buys nothing, because the diamond is drawn
 * fresh every time the lights come up.
 */
function readyHand(hand: Hand): void {
  hand.want = hand.slot;
  hand.moveTimer = 0;
  hand.lock = 0;
  hand.armed = false;
}

/**
 * A fresh match.
 *
 * The generator is optional so the pure rules stay usable without one, but the game
 * always passes it: a first dark phase that was always the shortest one would make the
 * opening round of every match the same length, which is exactly the thing
 * {@link casingDelay} exists to prevent.
 */
export function createState(rng?: Rng): State {
  return {
    phase: 'casing',
    timer: rng === undefined ? MIN_CASING_SECONDS : casingDelay(rng),
    clock: 0,
    diamond: -1,
    p1Hand: createHand(),
    p2Hand: createHand(),
    p1: 0,
    p2: 0,
    scorer: null,
    outcome: null,
    round: 0,
  };
}

export function resetState(state: State, rng?: Rng): void {
  state.phase = 'casing';
  state.timer = rng === undefined ? MIN_CASING_SECONDS : casingDelay(rng);
  state.clock = 0;
  state.diamond = -1;
  resetHand(state.p1Hand);
  resetHand(state.p2Hand);
  state.p1 = 0;
  state.p2 = 0;
  state.scorer = null;
  state.outcome = null;
  state.round = 0;
}

/**
 * One seat's hand.
 *
 * `Readonly<State>` is shallow, so this serves the renderer and the rules alike rather
 * than forcing a second accessor that would only differ in its type.
 */
export function handOf(state: Readonly<State>, seat: SeatId): Hand {
  return seat === 'p1' ? state.p1Hand : state.p2Hand;
}

/** True while the alarm has this hand frozen. */
export function isLocked(hand: Readonly<Hand>): boolean {
  return hand.lock > 0;
}

/** Whether a seat may act at all this step. */
export function canAct(state: Readonly<State>, seat: SeatId): boolean {
  return state.phase !== 'settling' && !isLocked(handOf(state, seat));
}

/**
 * Point a hand at a pedestal, in one gesture.
 *
 * What a thumb does. The hand does not arrive here — it starts walking, one pedestal per
 * {@link MOVE_SECONDS}, which is exactly the pace a held key walks it at.
 */
export function reach(state: State, seat: SeatId, slot: number): boolean {
  if (!canAct(state, seat)) return false;
  const hand = handOf(state, seat);
  const next = clampSlot(slot);
  if (next === hand.want) return false;
  hand.want = next;
  return true;
}

/**
 * Nudge a hand one pedestal.
 *
 * What a key does, and the gate is the hand itself: the aim may not run ahead while the
 * hand is still travelling. That is what makes a held key and a thumb *exactly* equal
 * rather than nearly so. A separate repeat timer was the obvious first shape and it was
 * measurably worse — one pedestal per 6 steps against the hand's own 5.4, so a keyboard
 * crossed the rail 16 % slower than a pointer that named the far pedestal outright, which
 * is precisely the instrument advantage `control-parity.test.ts` exists to catch. Gating
 * on arrival makes the two runs step-for-step identical instead.
 */
export function nudge(state: State, seat: SeatId, direction: number): boolean {
  if (!canAct(state, seat)) return false;
  if (direction === 0 || !Number.isFinite(direction)) return false;
  const hand = handOf(state, seat);
  if (hand.want !== hand.slot) return false;
  const next = clampSlot(hand.want + (direction > 0 ? 1 : -1));
  if (next === hand.want) return false;
  hand.want = next;
  return true;
}

/**
 * Commit to a grab.
 *
 * It does not resolve here. The hand closes when it settles on the pedestal it is aiming
 * at, and if that happens while the case is still dark it waits for the lights — which is
 * the gamble the whole game turns on. Refused while the alarm holds the hand, and while
 * the board is settling.
 */
export function commit(state: State, seat: SeatId): boolean {
  if (!canAct(state, seat)) return false;
  const hand = handOf(state, seat);
  if (hand.armed) return false;
  hand.armed = true;
  return true;
}

/** Seconds the case stays dark. Seeded, never `Math.random`. */
export function casingDelay(rng: Rng): number {
  return MIN_CASING_SECONDS + rng.float() * (MAX_CASING_SECONDS - MIN_CASING_SECONDS);
}

/** True when this hand is about to close: committed, free, and settled on its aim. */
function closing(hand: Readonly<Hand>): boolean {
  return hand.armed && hand.lock <= 0 && hand.slot === hand.want;
}

function tripAlarm(hand: Hand): void {
  hand.armed = false;
  hand.lock = ALARM_SECONDS;
}

function advanceHand(hand: Hand, fixedDeltaSeconds: number): void {
  if (hand.lock > 0) {
    // A caught hand is frozen outright: it neither moves nor aims until the alarm stops.
    hand.lock = Math.max(0, hand.lock - fixedDeltaSeconds);
    return;
  }
  if (hand.slot === hand.want) {
    hand.moveTimer = 0;
    return;
  }
  hand.moveTimer -= fixedDeltaSeconds;
  // The remainder is carried rather than discarded, so the pace of a hand is the same at
  // 60 Hz and at 144 Hz instead of quantising to whatever the step happens to be.
  while (hand.moveTimer <= 0 && hand.slot !== hand.want) {
    hand.slot += hand.want > hand.slot ? 1 : -1;
    hand.moveTimer += MOVE_SECONDS;
  }
}

function enterCasing(state: State, rng: Rng): void {
  state.round += 1;
  state.phase = 'casing';
  state.timer += casingDelay(rng);
  state.diamond = -1;
  state.outcome = null;
  state.scorer = null;
  readyHand(state.p1Hand);
  readyHand(state.p2Hand);
}

function advancePhase(state: State, rng: Rng): void {
  if (state.phase === 'casing') {
    state.phase = 'open';
    // Drawn at the moment the lights come up and not a step before, so there is no hidden
    // number for a bot to read early — rule 6 held by construction rather than by promise.
    state.diamond = rng.int(0, SLOT_COUNT);
    state.timer += OPEN_SECONDS;
    state.outcome = null;
    state.scorer = null;
    return;
  }
  if (state.phase === 'open') {
    state.phase = 'settling';
    state.timer += SETTLE_SECONDS;
    state.outcome = 'bust';
    state.scorer = null;
    return;
  }
  enterCasing(state, rng);
}

/**
 * Resolve every hand that is closing this step.
 *
 * Both seats are read before either is applied. Two hands can close on the same pedestal
 * on the same step, and a step is 16.7 ms — inside the tolerance `resolveSimultaneous`
 * calls a genuine draw — so the round is shared rather than handed to whichever seat this
 * function happened to look at first.
 */
function resolveGrabs(state: State): void {
  if (state.phase !== 'open') return;
  const p1Closing = closing(state.p1Hand);
  const p2Closing = closing(state.p2Hand);
  if (!p1Closing && !p2Closing) return;

  const p1Steal = p1Closing && state.p1Hand.slot === state.diamond;
  const p2Steal = p2Closing && state.p2Hand.slot === state.diamond;
  if (p1Closing && !p1Steal) tripAlarm(state.p1Hand);
  if (p2Closing && !p2Steal) tripAlarm(state.p2Hand);
  if (!p1Steal && !p2Steal) return;

  if (p1Steal) {
    state.p1 += 1;
    state.p1Hand.armed = false;
  }
  if (p2Steal) {
    state.p2 += 1;
    state.p2Hand.armed = false;
  }
  state.scorer = p1Steal && p2Steal ? 'both' : p1Steal ? 'p1' : 'p2';
  state.outcome = 'steal';
  state.phase = 'settling';
  // Set rather than added: the rest of the open phase is thrown away when the diamond goes.
  state.timer = SETTLE_SECONDS;
}

/**
 * Advance one fixed step: hands travel, the phase clock runs, and grabs close.
 *
 * Grabs are resolved *after* the phase may have changed, so a hand parked on the diamond
 * with a grab armed in the dark closes on the very step the lights come up rather than
 * one step later.
 */
export function step(state: State, fixedDeltaSeconds: number, rng: Rng): void {
  state.clock += fixedDeltaSeconds;
  advanceHand(state.p1Hand, fixedDeltaSeconds);
  advanceHand(state.p2Hand, fixedDeltaSeconds);
  state.timer -= fixedDeltaSeconds;
  if (state.timer <= 0) advancePhase(state, rng);
  resolveGrabs(state);
}

/** True once the backstop clock has run out. */
export function timeExpired(state: Readonly<State>): boolean {
  return state.clock >= MATCH_SECONDS;
}

export function winnerOf(state: Readonly<State>): Outcome {
  return resolve(WIN_CONDITION, state, { timeExpired: timeExpired(state) });
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds the bot must watch an open case before it may act on what it sees.
   *
   * A simple visual reaction is about 0.25 s, so `hard` sits at the quick end of human
   * and never past it. Rule 6: a bot gets no speed a person could not have.
   */
  readonly reaction: number;
  /** Extra reaction drawn per round, because no human reacts to the same number twice. */
  readonly jitter: number;
  /** Chance of reaching for a pedestal beside the diamond rather than the diamond. */
  readonly slipChance: number;
  /** Chance per dark second of committing blind — the gamble, which mostly loses. */
  readonly gambleRate: number;
  /** Chance per dark second of wandering to another pedestal while the case is shut. */
  readonly driftRate: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.4, jitter: 0.3, slipChance: 0.3, gambleRate: 0.45, driftRate: 1.4 },
  normal: { reaction: 0.33, jitter: 0.26, slipChance: 0.16, gambleRate: 0.2, driftRate: 0.9 },
  hard: { reaction: 0.28, jitter: 0.22, slipChance: 0.09, gambleRate: 0.09, driftRate: 0.6 },
});

/** What a bot carries between steps. Nothing here is information a player lacks. */
export interface BotState {
  /** Seconds this bot has been looking at the open case. */
  watched: number;
  /** This round's reaction time, drawn when the lights come up; −1 before that. */
  delay: number;
  /** Whether it has already chosen a pedestal for this attempt. */
  decided: boolean;
}

export function createBotState(): BotState {
  return { watched: 0, delay: -1, decided: false };
}

export function resetBotState(bot: BotState): void {
  bot.watched = 0;
  bot.delay = -1;
  bot.decided = false;
}

/** A bot's move for one step, written into a preallocated record rather than returned. */
export interface BotIntent {
  /** Pedestal to reach for, or −1 to leave the aim where it is. */
  aim: number;
  /** Whether to commit to a grab this step. */
  commit: boolean;
}

export function createBotIntent(): BotIntent {
  return { aim: -1, commit: false };
}

/**
 * What a bot does this step.
 *
 * It reads the phase, the diamond once it is showing, and its own hand — exactly what is
 * on the screen in front of a person sitting in that seat. It is never told where the
 * diamond will be, because until the lights come up nothing knows: the draw happens in
 * `advancePhase` at the moment of the reveal.
 *
 * Writes into `out` so a per-step decision allocates nothing.
 */
export function botIntent(
  state: Readonly<State>,
  bot: BotState,
  profile: BotProfile,
  seat: SeatId,
  fixedDeltaSeconds: number,
  rng: Rng,
  out: BotIntent,
): void {
  out.aim = -1;
  out.commit = false;
  const hand = handOf(state, seat);

  if (state.phase === 'settling') {
    resetBotState(bot);
    return;
  }

  if (state.phase === 'casing') {
    bot.watched = 0;
    bot.delay = -1;
    bot.decided = false;
    if (hand.lock > 0) return;
    if (rng.float() < profile.driftRate * fixedDeltaSeconds) out.aim = rng.int(0, SLOT_COUNT);
    // The gamble. A weak tier takes it often and spends most rounds frozen for it.
    if (!hand.armed && rng.float() < profile.gambleRate * fixedDeltaSeconds) out.commit = true;
    return;
  }

  bot.watched += fixedDeltaSeconds;
  if (bot.delay < 0) bot.delay = profile.reaction + rng.float() * profile.jitter;
  if (hand.lock > 0) {
    // Frozen. When the alarm stops it will look again — it has been staring at an open
    // case the whole time, so there is nothing left to react to.
    bot.decided = false;
    return;
  }
  if (bot.watched < bot.delay) return;

  if (!bot.decided) {
    bot.decided = true;
    let target = state.diamond;
    if (rng.float() < profile.slipChance) {
      target = clampSlot(target + (rng.float() < 0.5 ? -1 : 1));
    }
    out.aim = target;
  }
  if (!hand.armed) out.commit = true;
}
