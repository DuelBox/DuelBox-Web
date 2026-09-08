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
 * The shape written today: `{ version: 1, games: string[], results: string[], opponent,
 * difficulty? }` — the tier only on a tournament against the bot (#2347).
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
 *
 * ## Why the caller has to say what this build can open
 *
 * A line-up is drawn once and then persisted, and the kill switch (#208) can take a game out
 * of the build between the draw and the next page load. A leg naming a game this build no
 * longer has is not merely untidy: `/play/<slug>/` is genuinely absent from the export, so
 * the "up next" link and the result screen's next link both point at a 404, and the leg can
 * only be reported from the route that no longer exists — so the tournament cannot advance
 * and leaving it is the only way out.
 *
 * `PLAYABLE` is not imported here, and that is a size decision rather than a preference:
 * this module is reachable from `lib/player-data.ts`, which `/settings/` loads eagerly, and
 * `data/registry.ts` is the one module no shell route may pull in. The play route already
 * has it, so the play route hands it over.
 *
 * **Only the legs not yet played are filtered.** Results are positional — leg three's
 * outcome is `results[2]` — so dropping a game the pair have already finished would re-label
 * every leg after it, which is the same trap `outcomesIn` above is truncated rather than
 * filtered for. A switched-off game already played is history and stays in the line-up; one
 * still to come is dropped, and a shorter tournament is what `pickTournamentGames` already
 * says a tournament with fewer games to draw from is.
 */
export function readTournament(playable: readonly string[]): TournamentRecord | null {
  const stored = readVersioned(TOURNAMENT_KEY, VERSION);
  if (stored === null) return null;
  // Junk, duplicates and empty strings out of the line-up, in one call, by the same helper
  // the favourites and recently-played lists are read through. A repeated slug would break
  // the one promise the format makes about itself.
  const written = uniqueStrings(stored['games']);
  const results = outcomesIn(stored['results'], written.length);
  const games = [
    ...written.slice(0, results.length),
    ...written.slice(results.length).filter((slug) => playable.includes(slug)),
  ];
  if (games.length === 0) return null;
  return {
    games,
    results,
    // Anything that is not the bot is the other person, which is the safe way round: a
    // tournament wrongly labelled a friend match shows an unmarked seat name, while one
    // wrongly labelled a bot match would put a bot's wins on a person's record.
    //
    // Spelled out rather than imported from `match-setup.ts`, whose `isPlayMode` answers
    // exactly this question: that module is on the play route, and importing a predicate
    // from it would pull it into the shell — see the note at the top of this file.
    opponent: stored['opponent'] === 'bot' ? 'bot' : 'friend',
    // The three tiers, spelled out for the same reason the opponent is: `isBotDifficulty`
    // lives in `match-setup.ts`, on the play route. Anything else — including a tier on a
    // tournament against a person — is dropped rather than trusted.
    ...(stored['opponent'] === 'bot' && isTier(stored['difficulty'])
      ? { difficulty: stored['difficulty'] }
      : {}),
  };
}

function isTier(value: unknown): value is 'easy' | 'normal' | 'hard' {
  return value === 'easy' || value === 'normal' || value === 'hard';
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
    // Written only when there is one: a document a build before #2347 wrote has no such
    // field, and one that reads it back should not grow a key it never had.
    ...(record.difficulty === undefined ? {} : { difficulty: record.difficulty }),
  });
}

/** Forgets the tournament. Safe to call twice; safe with no storage at all. */
export function clearTournament(): void {
  removeJson(TOURNAMENT_KEY);
}
