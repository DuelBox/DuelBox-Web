import type { SeatId } from '@duelbox/engine';
import { resolve, type Outcome, type Tally, type WinCondition } from './win-conditions.js';

/**
 * The flow every match runs through, once, for all 107 games.
 *
 * Countdown, play, pause, round-over, match-over and rematch are identical in every game
 * in the catalog. Written per game they drift: one counts down from three and another
 * from five, one lets you rematch after a draw and another does not, and a pause in the
 * ninety-ninth game forgets to stop the clock. Games supply a win condition and report a
 * tally; everything below is the shell's.
 *
 * The machine is a pure reducer. It holds no timers, touches no DOM and never reads the
 * wall clock — the host feeds it `tick` from the same fixed loop that drives the
 * simulation, so a match steps identically on a phone and a laptop (CLAUDE.md rule 8).
 */

export type MatchPhase =
  /** Before anything starts, and where `quit` returns to. */
  | 'idle'
  /** Both seats can see the board; nobody can act yet. */
  | 'countdown'
  /** The simulation is running. */
  | 'playing'
  /** Stopped on purpose. The accumulator is not running. */
  | 'paused'
  /** A round was decided and the match continues. Only reachable in best-of matches. */
  | 'round-over'
  /** The match is decided. */
  | 'match-over';

export type MatchEventKind =
  | 'start'
  | 'tick'
  | 'pause'
  | 'resume'
  | 'score'
  | 'next-round'
  | 'rematch'
  | 'quit';

export type MatchEvent =
  /** Leave `idle` and begin the first countdown. */
  | { readonly kind: 'start' }
  /** Advance the countdown by one fixed step. Ignored outside `countdown`. */
  | { readonly kind: 'tick'; readonly seconds: number }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  /** The game's current tally. The machine decides whether that ends the round. */
  | {
      readonly kind: 'score';
      readonly tally: Tally;
      readonly timeExpired?: boolean;
      readonly eliminated?: readonly SeatId[];
      /**
       * An outcome the game has already decided, which overrides the win condition.
       *
       * Some games settle a round on a rule no generic condition expresses — a line of
       * three, a board with no legal move left. Those report the result rather than a
       * score the shell could compare. `undefined` means "you decide"; `null` means
       * "decided: still running".
       */
      readonly outcome?: Outcome;
    }
  | { readonly kind: 'next-round' }
  | { readonly kind: 'rematch' }
  | { readonly kind: 'quit' };

export interface MatchRules {
  /** Decides a single round from the tally the game reports. */
  readonly win: WinCondition;
  /**
   * Best-of-N rounds. Default 1, where winning the round wins the match and
   * `round-over` is never entered.
   */
  readonly rounds?: number;
  /** Seconds of countdown before the first step of a round. Default 3. */
  readonly countdownSeconds?: number;
}

export interface MatchState {
  readonly phase: MatchPhase;
  /** 1-based. */
  readonly round: number;
  /** Seconds left in the countdown; 0 in every other phase. */
  readonly countdownRemaining: number;
  /** The tally the game last reported for the current round. */
  readonly tally: Tally;
  /** Rounds won by each seat. */
  readonly roundWins: Tally;
  /** Who took the round just finished; null while one is in progress. */
  readonly roundOutcome: Outcome;
  /** Who took the match; null until `match-over`. */
  readonly matchOutcome: Outcome;
}

/**
 * Which events a phase accepts. This table is the single source of truth: `reduce`
 * consults it before doing anything, and the shell derives its buttons from
 * `legalEvents` so an illegal transition cannot be offered, let alone taken.
 */
const LEGAL: Readonly<Record<MatchPhase, readonly MatchEventKind[]>> = {
  idle: ['start'],
  countdown: ['tick', 'pause', 'quit'],
  playing: ['score', 'pause', 'quit'],
  paused: ['resume', 'quit'],
  'round-over': ['next-round', 'quit'],
  'match-over': ['rematch', 'quit'],
};

/** The events `phase` will act on. Anything else is ignored by `reduce`. */
export function legalEvents(phase: MatchPhase): readonly MatchEventKind[] {
  return LEGAL[phase];
}

export function canSend(phase: MatchPhase, kind: MatchEventKind): boolean {
  return LEGAL[phase].includes(kind);
}

const ZERO: Tally = { p1: 0, p2: 0 };

export function initialMatchState(): MatchState {
  return {
    phase: 'idle',
    round: 1,
    countdownRemaining: 0,
    tally: ZERO,
    roundWins: ZERO,
    roundOutcome: null,
    matchOutcome: null,
  };
}

function countdownSecondsOf(rules: MatchRules): number {
  const seconds = rules.countdownSeconds ?? 3;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`countdownSeconds must be a non-negative number, received ${String(seconds)}`);
  }
  return seconds;
}

function roundsOf(rules: MatchRules): number {
  const rounds = rules.rounds ?? 1;
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new RangeError(`rounds must be a positive integer, received ${String(rounds)}`);
  }
  return rounds;
}

/** Rounds needed to take a best-of-N: 1 of 1, 2 of 3, 3 of 5. */
export function roundsToWin(rules: MatchRules): number {
  return Math.ceil(roundsOf(rules) / 2);
}

/**
 * Apply one event. Pure: the same state and event always give the same result, and an
 * event the phase does not accept returns the *same object reference* so a caller can
 * tell nothing happened without a deep compare.
 */
export function reduce(state: MatchState, event: MatchEvent, rules: MatchRules): MatchState {
  if (!canSend(state.phase, event.kind)) return state;

  switch (event.kind) {
    case 'start':
      return beginRound(initialMatchState(), rules, 1, ZERO);

    case 'tick': {
      if (!Number.isFinite(event.seconds) || event.seconds < 0) {
        throw new RangeError(`tick seconds must be a non-negative number, received ${String(event.seconds)}`);
      }
      const remaining = state.countdownRemaining - event.seconds;
      if (remaining > 0) return { ...state, countdownRemaining: remaining };
      // Overshoot is dropped rather than carried into the first simulated step: the
      // round must start at exactly the same state on both devices.
      return { ...state, phase: 'playing', countdownRemaining: 0 };
    }

    case 'pause':
      return { ...state, phase: 'paused' };

    case 'resume':
      // Resuming replays the countdown rather than dropping straight back into play, so
      // neither player is ambushed by a board that is already moving.
      return { ...state, phase: 'countdown', countdownRemaining: countdownSecondsOf(rules) };

    case 'score': {
      const options: { timeExpired?: boolean; eliminated?: readonly SeatId[] } = {};
      if (event.timeExpired !== undefined) options.timeExpired = event.timeExpired;
      if (event.eliminated !== undefined) options.eliminated = event.eliminated;
      const roundOutcome =
        event.outcome !== undefined ? event.outcome : resolve(rules.win, event.tally, options);
      if (roundOutcome === null) return { ...state, tally: event.tally };

      const roundWins: Tally = {
        p1: state.roundWins.p1 + (roundOutcome === 'p1' ? 1 : 0),
        p2: state.roundWins.p2 + (roundOutcome === 'p2' ? 1 : 0),
      };
      const needed = roundsToWin(rules);
      const decided = roundWins.p1 >= needed || roundWins.p2 >= needed;
      // A drawn round still consumes one of the N, or a best-of-three of a game that
      // draws easily never ends.
      const exhausted = state.round >= roundsOf(rules);

      if (decided || exhausted) {
        return {
          ...state,
          phase: 'match-over',
          countdownRemaining: 0,
          tally: event.tally,
          roundWins,
          roundOutcome,
          matchOutcome: matchOutcomeOf(roundWins, roundOutcome, roundsOf(rules)),
        };
      }
      return {
        ...state,
        phase: 'round-over',
        countdownRemaining: 0,
        tally: event.tally,
        roundWins,
        roundOutcome,
      };
    }

    case 'next-round':
      return beginRound(state, rules, state.round + 1, state.roundWins);

    case 'rematch':
      return beginRound(initialMatchState(), rules, 1, ZERO);

    case 'quit':
      return initialMatchState();
  }
}

function beginRound(base: MatchState, rules: MatchRules, round: number, roundWins: Tally): MatchState {
  const countdown = countdownSecondsOf(rules);
  return {
    ...base,
    // A zero-second countdown is legal and starts play immediately, which is what a
    // turn-based game wants; there is nothing to be ready for.
    phase: countdown > 0 ? 'countdown' : 'playing',
    round,
    countdownRemaining: countdown,
    tally: ZERO,
    roundWins,
    roundOutcome: null,
    matchOutcome: null,
  };
}

function matchOutcomeOf(roundWins: Tally, roundOutcome: Outcome, rounds: number): Outcome {
  if (rounds === 1) return roundOutcome;
  if (roundWins.p1 > roundWins.p2) return 'p1';
  if (roundWins.p2 > roundWins.p1) return 'p2';
  return 'draw';
}

/**
 * Whether the simulation should be stepped in this phase. The host asks this rather than
 * comparing phases itself, so "does a paused match still move" has one answer.
 */
export function isSimulating(phase: MatchPhase): boolean {
  return phase === 'playing';
}

/** Whether the board should be drawn. A paused match stays visible behind its overlay. */
export function isBoardVisible(phase: MatchPhase): boolean {
  return phase !== 'idle';
}
