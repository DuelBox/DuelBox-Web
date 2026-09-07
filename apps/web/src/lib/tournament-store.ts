/**
 * Where a tournament in progress is written down (#157).
 *
 * Resumable progress is the whole acceptance criterion, and it is not really about a reload:
 * leg three is a different URL from leg two, so **every** advance through a tournament is a
 * page load. React state cannot span that, which is why this exists at all and why the
 * machine in `tournament.ts` was written to be serialisable before it was written to be
 * anything else.
 *
 * Read through `local-store.ts` like every other store, sanitised on the way out, never
 * throwing: what is under the key was written by another tab, an older build or somebody
 * with the console open, and the cost of junk there is a tournament the pair start again —
 * never a crashed play route.
 *
 * ## Why this file holds no rules
 *
 * It imports the machine's **types only**, and nothing else here reaches for it. That is a
 * size decision with a measurable edge: `lib/player-data.ts` joins every store's key so that
 * export, import and erase carry it, `/settings/` loads `player-data.ts` eagerly, and
 * `scripts/check-size.mjs` therefore bills anything it can reach to the **shell** — the
 * bytes every visitor pays before choosing a game. A value import from `tournament.ts` would
 * have put the whole reducer there for the sake of one string. So the key, the read, the
 * write and the sanitiser live here, the rules live next door, and the two are joined by a
 * type that costs nothing to erase.
 *
 * It also means this file cannot decide a phase, which is the right shape anyway: the phase
 * is derived from the line-up and the results by `resume()`, and a store that computed one
 * of its own would be a second answer able to disagree with the machine's.
 */

import {
  KEY_PREFIX,
  readVersioned,
  removeJson,
  uniqueStrings,
  writeVersioned,
} from './local-store';
import type { LegOutcome, TournamentRecord } from './tournament';

export const TOURNAMENT_KEY = `${KEY_PREFIX}tournament`;

/**
 * The shape written today: `{ version: 1, games: string[], results: string[], opponent }`.
 *
 * No phase, because the phase is arithmetic over the other three — see the note at the top
 * of `tournament.ts`. A future version is not something this build can interpret, and
 * `readVersioned` already treats one as no data at all rather than guessing.
 */
const VERSION = 1;

/**
 * The results a stored document can be trusted for, in order, truncated at the first entry
 * that is not an outcome.
 *
 * Truncated rather than filtered, and the difference matters because results are
 * **positional**: leg three's outcome is `results[2]`, so dropping a corrupt `results[1]`
 * would silently re-label every leg after it. A tournament that resumes having lost one
 * result is wrong about one game; one that renumbers the rest is wrong about all of them.
 *
 * `limit` is the line-up's length, because a document claiming more results than it has
 * games has already told us it is not to be trusted about the tail.
 */
function outcomesIn(value: unknown, limit: number): LegOutcome[] {
  if (!Array.isArray(value)) return [];
  const out: LegOutcome[] = [];
  for (const entry of value as unknown[]) {
    if (out.length >= limit) break;
    if (entry !== 'p1' && entry !== 'p2' && entry !== 'draw') break;
    out.push(entry);
  }
  return out;
}

/**
 * The tournament this browser has in progress, or `null` if it has none it can read.
 *
 * `null` for absent, for a version this build does not know, for storage throwing and for a
 * document with no usable line-up in it alike, because the caller does the same thing in all
 * four cases: there is no tournament, offer to start one.
 *
 * A record, not a state: the caller passes it through `resume()` to get the phase, which is
 * the one place a phase is decided.
 */
export function readTournament(): TournamentRecord | null {
  const stored = readVersioned(TOURNAMENT_KEY, VERSION);
  if (stored === null) return null;
  // Junk, duplicates and empty strings out of the line-up, in one call, by the same helper
  // the favourites and recently-played lists are read through. A repeated slug would break
  // the one promise the format makes about itself.
  const games = uniqueStrings(stored['games']);
  if (games.length === 0) return null;
  return {
    games,
    results: outcomesIn(stored['results'], games.length),
    // Anything that is not the bot is the other person, which is the safe way round: a
    // tournament wrongly labelled a friend match shows an unmarked seat name, while one
    // wrongly labelled a bot match would put a bot's wins on a person's record.
    //
    // Spelled out rather than imported from `match-setup.ts`, whose `isPlayMode` answers
    // exactly this question: that module is on the play route, and importing a predicate
    // from it would pull it into the shell — see the note at the top of this file.
    opponent: stored['opponent'] === 'bot' ? 'bot' : 'friend',
  };
}

/**
 * Writes the three fields a tournament is made of, and only those.
 *
 * A `TournamentState` is accepted — it is a record with a phase on it — and the phase is
 * dropped here rather than spread, so it cannot reach storage by accident and be believed
 * on the way back.
 *
 * The result is ignored, as in every other store: storage full, disabled or absent costs
 * the pair a tournament they can start again in one press, and there is nothing to retry.
 */
export function writeTournament(record: TournamentRecord): void {
  writeVersioned(TOURNAMENT_KEY, VERSION, {
    games: record.games,
    results: record.results,
    opponent: record.opponent,
  });
}

/** Forgets the tournament. Safe to call twice; safe with no storage at all. */
export function clearTournament(): void {
  removeJson(TOURNAMENT_KEY);
}
