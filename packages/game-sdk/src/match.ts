import { Rng, otherSeat, type SeatId } from '@duelbox/engine';
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
 *
 * It also decides **who opens each round** — see {@link openingSeatFor}. That is here and
 * not in a game for the same reason the countdown is: written per game it drifts, and
 * written nowhere at all it means seat one opens forever and first-mover advantage never
 * washes out of a best-of.
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
  'start' | 'tick' | 'pause' | 'resume' | 'score' | 'next-round' | 'rematch' | 'quit';

export type MatchEvent =
  /**
   * Leave `idle` and begin the first countdown.
   *
   * `seed` is the match seed — the same number the host hands the game's {@link Rng} — and
   * the machine keeps it for the life of the match. It decides nothing about round one; it
   * only settles the odd-round-count tiebreak described on {@link openingSeatFor}. Omitted,
   * the seed already in state is kept, which is 0 for a fresh machine: a shell that never
   * threads one still gets a deterministic match, just always the same coin.
   */
  | { readonly kind: 'start'; readonly seed?: number }
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
  /**
   * Play the same rules again from round one.
   *
   * Carries a seed for the same reason `start` does, and the shell should pass a fresh one:
   * a rematch is a new match, and a pair playing five in a row must not have the same seat
   * take the surplus opening in all five.
   */
  | { readonly kind: 'rematch'; readonly seed?: number }
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
  /**
   * Which seat moves first in the current round. See {@link openingSeatFor}.
   *
   * Meaningful to a turn-based game and inert to a real-time one, which has no first move
   * to give away. The shell reads it and the game is told; a game deciding this for itself
   * is the bug this field exists to remove.
   */
  readonly openingSeat: SeatId;
  /**
   * The match seed, as handed to `start` or `rematch`. 0 until one is.
   *
   * Held so the opener is reproducible from the state alone: the same seed replays the
   * same sequence of openers, which is what makes a cross-device match agree about who
   * moves first without either device being asked.
   */
  readonly seed: number;
}

/**
 * Which seat opens round `round` of a match seeded with `seed`. 1-based, as `round` is.
 *
 * Seat one used to open every round of every match, so whatever first-mover advantage a
 * game has never washed out. Measured in Snakes & Ladders, seat one took 51.2% of matches
 * at `easy` and 55.0% at `hard` — the advantage *grows* with skill, because better play
 * shortens the race and leaves the trailing seat fewer turns to recover in. That is a
 * shell-level defect, not a per-game one: it applies to every turn-based game in the
 * catalogue, so it is fixed once, here, and no game opts in.
 *
 * The rule is: **the seat that has opened fewer rounds so far opens the next one; when
 * they are level the round goes to the seat the match's coin-flip named — except round
 * one, which is always seat one.**
 *
 * Round one is pinned deliberately. Every game in the catalogue opens with seat one today
 * and every test, screenshot and bot measurement was taken that way, so pinning it means
 * this change shifts nothing that already worked; it only decides rounds two and beyond,
 * which nobody was deciding at all.
 *
 * That pinning is also what forces the coin. Over an odd number of rounds one seat
 * necessarily opens once more than the other, and with round one fixed to seat one a plain
 * alternation — p1, p2, p1 — hands that surplus to seat one in every match ever played,
 * which is the original bug wearing a different hat. So the level rounds go to a seat drawn
 * from the match seed:
 *
 * - **heads** (level rounds to seat one): p1, p2, p1, p2, p1 … — seat one opens the extra.
 * - **tails** (level rounds to seat two): p1, p2, p2, p1, p2 … — seat two opens the extra.
 *
 * Tails repeats seat two once, across the round-two/round-three boundary, and that single
 * repeat is the whole cost of the fix. It has to fall somewhere: round one is pinned, so
 * the only way seat two ever gets the surplus is to break strict alternation exactly once.
 * Putting the repeat as early as possible is what makes the tiebreak work for a best-of-five
 * that ends after three rounds as well as one that goes the distance — after **any** odd
 * number of rounds the tails sequence has given seat two the extra opening, and after any
 * even number the two seats are level. Deferring the repeat to the last round would only
 * have been fair to a best-of-five that actually reached round five.
 *
 * The coin is drawn from a stream of its own rather than from the match seed directly,
 * because the game's own {@link Rng} is constructed from that same seed and would hand out
 * the identical first draw. Left unsalted, "seat two opens the extra round" would be the
 * same event as "seat one's first die was low", which is not a coin flip at all.
 *
 * @throws RangeError if `round` is not a positive integer or `seed` is not finite.
 */
export function openingSeatFor(round: number, seed: number): SeatId {
  if (!Number.isInteger(round) || round < 1) {
    throw new RangeError(`round must be a positive integer, received ${String(round)}`);
  }
  const alternating: SeatId = round % 2 === 1 ? 'p1' : 'p2';
  // Rounds one and two are the same under either coin — one seat each, nothing to break.
  if (round <= 2) return alternating;
  return levelRoundSeat(seed) === 'p1' ? alternating : otherSeat(alternating);
}

/**
 * ASCII "Open". Any constant would do; the point is only that the opener's stream is not
 * the game's stream, and a readable one says so at the call site.
 */
const OPENER_STREAM = 0x4f70_656e;

/** The coin: which seat takes a round the two are level on. Pure in `seed`. */
function levelRoundSeat(seed: number): SeatId {
  // Allocated once a round at most, never on a simulation step, so rule 5 is untroubled.
  return new Rng((seedOf(seed) | 0) ^ OPENER_STREAM).bool() ? 'p2' : 'p1';
}

function seedOf(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new RangeError(`match seed must be a finite number, received ${String(seed)}`);
  }
  return seed;
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
    // Round one belongs to seat one under every seed, so no seed is needed to say so.
    openingSeat: 'p1',
    seed: 0,
  };
}

function countdownSecondsOf(rules: MatchRules): number {
  const seconds = rules.countdownSeconds ?? 3;
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(
      `countdownSeconds must be a non-negative number, received ${String(seconds)}`,
    );
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
      return beginRound(initialMatchState(), rules, 1, ZERO, event.seed ?? state.seed);

    case 'tick': {
      if (!Number.isFinite(event.seconds) || event.seconds < 0) {
        throw new RangeError(
          `tick seconds must be a non-negative number, received ${String(event.seconds)}`,
        );
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
      return beginRound(state, rules, state.round + 1, state.roundWins, state.seed);

    case 'rematch':
      return beginRound(initialMatchState(), rules, 1, ZERO, event.seed ?? state.seed);

    case 'quit':
      // The seed goes with the match it belonged to. Quitting is not a rematch, and the
      // next `start` brings its own.
      return initialMatchState();
  }
}

function beginRound(
  base: MatchState,
  rules: MatchRules,
  round: number,
  roundWins: Tally,
  seed: number,
): MatchState {
  const countdown = countdownSecondsOf(rules);
  // Checked here rather than where it is first consulted, which is round three: a shell
  // that hands over a broken seed must hear about it as it starts the match, not two
  // rounds in.
  seedOf(seed);
  // Resolved here rather than read off a counter, so the opener depends on the round
  // number and the seed and on nothing that happened in between. A match rejoined
  // mid-way, or replayed from a trace, agrees about who moves first.
  const openingSeat = openingSeatFor(round, seed);
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
    openingSeat,
    seed,
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
