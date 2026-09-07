/**
 * Seven games, one pair, one winner (#156, #157, #159).
 *
 * The format and the reasoning behind it are in `docs/tournament.md`; this is the machine
 * that runs it. It is written as a sibling of `packages/game-sdk/src/match.ts` on purpose —
 * an explicit state, a table of which events a phase accepts, and a pure `reduce` that
 * returns the *same object reference* for an event the phase does not take. A tournament is
 * a match's bigger relative, and the two should not read like they came from different
 * codebases.
 *
 * Nothing here touches storage, and that is the point of the split rather than a stylistic
 * preference. A tournament spans seven URLs — leg three is a different page from leg two —
 * so every transition it makes has to survive a reload, and a reducer that wrote its own
 * state down could not be tested through the transitions that matter. `tournament-store.ts`
 * does the persistence; this decides what the state means, and every case below is
 * reachable from a unit test.
 *
 * ## The phase is derived, never stored
 *
 * A tournament whose line-up and results are known is complete or still running by
 * arithmetic, so a stored phase would be a second copy of that answer able to disagree with
 * it — the same defect `lib/head-to-head.ts` avoids by summing `played` rather than keeping
 * it. {@link resume} is the one place a phase is computed and `reduce` goes through it, so a
 * tournament read back from storage and one that never left memory cannot be in different
 * states from the same facts.
 */

import { addOutcome, EMPTY_TALLY, type Opponent, type Tally } from './head-to-head';
import { uniqueStrings } from './local-store';
import { pickQuickPlay } from './quick-play';

/**
 * How one game of a tournament ended.
 *
 * The same three values a settled match reports and the same three the head-to-head record
 * counts — deliberately, because a leg *is* a match and it goes on that record like any
 * other.
 */
export type LegOutcome = 'p1' | 'p2' | 'draw';

export type TournamentPhase =
  /** No tournament. The state a fresh machine is in and where `abandon` returns to. */
  | 'idle'
  /** A line-up is running and one of its games is waiting to be played. */
  | 'playing'
  /** Decided: either somebody has a majority or every game has been played. */
  | 'complete';

export type TournamentEventKind = 'start' | 'report' | 'abandon';

export type TournamentEvent =
  /**
   * Draw a line under whatever came before and run `games`, in order, against `opponent`.
   *
   * Legal from `complete` as well as from `idle`, so the pair who have just finished one
   * can start another from the screen that told them who won. Making them abandon first
   * would be a state nobody asked to be in.
   */
  | {
      readonly kind: 'start';
      readonly games: readonly string[];
      readonly opponent: Opponent;
    }
  /** One game, settled. The machine decides whether that settles the tournament. */
  | { readonly kind: 'report'; readonly outcome: LegOutcome }
  /** Stop, and keep nothing. */
  | { readonly kind: 'abandon' };

/**
 * The part of a tournament that is written down: what is being played, what has happened,
 * and who the far seat belongs to.
 *
 * The phase is absent for the reason in the note at the top of this file, and the store
 * writes exactly these three fields.
 */
export interface TournamentRecord {
  /** The line-up, in playing order. Never repeats a game — see {@link pickTournamentGames}. */
  readonly games: readonly string[];
  /** One entry per game finished, in order. `results[2]` is the third game's outcome. */
  readonly results: readonly LegOutcome[];
  /** Who held the far seat, fixed for the whole tournament. */
  readonly opponent: Opponent;
}

export interface TournamentState extends TournamentRecord {
  readonly phase: TournamentPhase;
}

/**
 * Games in a tournament, as the reference app plays it — "a set of 7 random games".
 *
 * Read by the caller drawing a line-up and by nothing else: every rule below works off
 * `games.length`, so a tournament stored by a build that chose a different number still
 * resumes and still knows what winning it takes.
 */
export const TOURNAMENT_LENGTH = 7;

/** Rounds in one leg. A leg is a single match; the tournament is the best-of. */
export const TOURNAMENT_LEG_ROUNDS = 1;

/**
 * Which events a phase accepts, as `match.ts` does it: one table, consulted by `reduce`
 * before anything happens, so an illegal transition cannot be taken even if it is offered.
 */
const LEGAL: Readonly<Record<TournamentPhase, readonly TournamentEventKind[]>> = {
  idle: ['start'],
  playing: ['report', 'abandon'],
  complete: ['start', 'abandon'],
};

/** The events `phase` will act on. Anything else is ignored by {@link reduce}. */
export function legalEvents(phase: TournamentPhase): readonly TournamentEventKind[] {
  return LEGAL[phase];
}

export function canSend(phase: TournamentPhase, kind: TournamentEventKind): boolean {
  return LEGAL[phase].includes(kind);
}

/** No tournament: what a fresh machine holds, and what abandoning one leaves behind. */
export function initialTournament(): TournamentState {
  return { phase: 'idle', games: [], results: [], opponent: 'friend' };
}

/**
 * Games needed to take a tournament of `games` legs: a strict majority, so 4 of 7.
 *
 * `floor(n / 2) + 1` rather than the SDK's `ceil(n / 2)`, and the difference only shows on
 * an even line-up, which is exactly where it matters: three of six is level, not a win.
 * `match.ts` can use the other expression because the shell only ever offers it an odd
 * number of rounds; a line-up read back from storage carries no such promise.
 */
export function legsToWin(games: number): number {
  return Math.floor(games / 2) + 1;
}

/** Games each seat has taken, and the ones that ended level. */
export function tournamentScore(record: TournamentRecord): Tally {
  // The head-to-head store's own arithmetic, reused rather than repeated: it already owns
  // the answer to "what does one result do to a tally", and two copies of that is two
  // places for a scoreboard to start disagreeing with itself.
  return record.results.reduce<Tally>(addOutcome, EMPTY_TALLY);
}

/** Whether `record` is decided — a majority taken, or every game played. */
function isSettled(record: TournamentRecord): boolean {
  const score = tournamentScore(record);
  const needed = legsToWin(record.games.length);
  if (score.p1 >= needed || score.p2 >= needed) return true;
  // A drawn game still consumes one of the seven, or a pair who draw often would play a
  // tournament that never ends. Same rule, same reason, as a drawn round in `match.ts`.
  return record.results.length >= record.games.length;
}

/**
 * A written-down tournament, live again.
 *
 * The only place a phase is decided. `reduce` builds its results through this too, so the
 * state a reload produces and the state the machine was already in are the same state.
 */
export function resume(record: TournamentRecord): TournamentState {
  if (record.games.length === 0) return initialTournament();
  return { ...record, phase: isSettled(record) ? 'complete' : 'playing' };
}

/**
 * The game this tournament is waiting to have played, or `undefined` if it is waiting for
 * nothing.
 *
 * Positional: `results.length` games are behind it, so the next index is the current one.
 * Once a leg is reported this moves on immediately, which is what makes the result screen
 * of leg three able to offer leg four without a second transition to fire.
 */
export function currentGame(state: TournamentState): string | undefined {
  return state.phase === 'playing' ? state.games[state.results.length] : undefined;
}

/** How many games have been finished, so the one being played is this plus one. */
export function legsPlayed(record: TournamentRecord): number {
  return record.results.length;
}

/**
 * Whether `slug` is the game this tournament is waiting on.
 *
 * The guard that makes a result count once. A leg is reported only by the route the
 * tournament is waiting on, so playing a finished leg again — the Rematch button is still
 * there, and taking it away would be a worse answer — is a friendly game that goes on the
 * head-to-head record and not on the tournament.
 */
export function isCurrentLeg(state: TournamentState, slug: string): boolean {
  return currentGame(state) === slug;
}

/**
 * Who won, or `null` while it is still being played.
 *
 * A level tournament is a draw and there is no decider; `docs/tournament.md` says why. This
 * is the same answer `matchOutcomeOf` gives a level best-of, in the same words.
 */
export function tournamentOutcome(state: TournamentState): LegOutcome | null {
  if (state.phase !== 'complete') return null;
  const score = tournamentScore(state);
  if (score.p1 > score.p2) return 'p1';
  if (score.p2 > score.p1) return 'p2';
  return 'draw';
}

/**
 * Apply one event. Pure: the same state and event always give the same result, and an event
 * the phase does not accept returns the *same object reference*, so a caller can tell
 * nothing happened without a deep compare.
 */
export function reduce(state: TournamentState, event: TournamentEvent): TournamentState {
  if (!canSend(state.phase, event.kind)) return state;

  switch (event.kind) {
    case 'start': {
      // Deduplicated here as well as by the picker, because this is the one door a line-up
      // comes through: "a tournament never repeats a game within itself" is then a property
      // of the machine rather than a promise about whoever assembled the list.
      const games = uniqueStrings(event.games);
      // A line-up of nothing is not a tournament — it would be a state whose current game
      // never arrives — so the event does nothing rather than something unfinishable.
      if (games.length === 0) return state;
      return resume({ games, results: [], opponent: event.opponent });
    }

    case 'report':
      return resume({ ...state, results: [...state.results, event.outcome] });

    case 'abandon':
      return initialTournament();
  }
}

/**
 * A line-up: up to `count` distinct games drawn from `candidates`.
 *
 * The weighting is not this function's. It calls `pickQuickPlay` — the picker behind
 * "Surprise me" — once per leg, removing each pick from the pool before the next draw, so a
 * tournament reaches for the games a pair have not just played by exactly the same rule the
 * header button uses. A second weighted picker would have been a second rule to keep in
 * step with the first, for a difference nobody asked for.
 *
 * What this adds is sampling **without replacement**, which is #159's acceptance criterion.
 * `recent` is most-recent-first, as `recent.ts` keeps it; `random` yields a number in
 * [0, 1) and is handed in rather than reached for so the tests can seed it.
 *
 * Fewer than `count` games come back when the catalogue holds fewer than that, which no
 * player can reach with 108 playable games and every test can. Every rule in the machine
 * works off the line-up's length, so a short tournament is a shorter tournament rather than
 * a broken one.
 */
export function pickTournamentGames(
  candidates: readonly string[],
  recent: readonly string[],
  count: number,
  random: () => number,
): string[] {
  const chosen: string[] = [];
  let pool = uniqueStrings(candidates);
  while (chosen.length < count && pool.length > 0) {
    const pick = pickQuickPlay(pool, recent, random);
    // Only reachable for an empty pool, which the loop condition has already excluded. It
    // is checked because the signature says it can happen, and because a picker that ever
    // did return nothing must end this loop rather than spin in it.
    if (pick === undefined) break;
    chosen.push(pick);
    pool = pool.filter((slug) => slug !== pick);
  }
  return chosen;
}
