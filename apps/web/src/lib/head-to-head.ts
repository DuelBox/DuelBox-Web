/**
 * Who is winning, game by game, across every sitting (#160, #162).
 *
 * A pair who share a device keep score of each other for months, and the tally the shell
 * kept lived in React state: five matches on Tuesday were gone by Wednesday, and gone the
 * moment anybody reloaded. This is that tally written down, and it is the only thing the
 * site records about a match having happened.
 *
 * **One store for both issues.** #160 asks for an overall head-to-head and #162 for
 * per-game statistics, and those are the same numbers summed differently. Two stores would
 * be two shapes, two sets of failure paths, and two chances to disagree about a match that
 * one of them counted and the other did not.
 *
 * So one count per outcome per game is stored and everything else is derived on read. The
 * overall record is the sum of the games rather than a second copy kept beside them, and
 * `played` is the sum of a game's three counts rather than a fourth count — a number
 * stored twice is a number that can disagree with itself, and a scoreboard that
 * contradicts itself is worse than one that is a match behind. Summing two entries costs
 * nothing at the sizes a pair of people can reach by playing.
 *
 * **A bot's wins are not the far seat's wins.** The store used to key a tally by slug
 * alone, so ten losses to the hard bot came back on the next friend match's result screen
 * as ten wins for the person in the far seat — the same stored number labelled two
 * contradictory ways by nothing more than which mode ran last. A head-to-head is between
 * the two people who share the device, so matches against the bot are counted under a map
 * of their own and summed back in only where the number being shown is "how much have we
 * played this", never "who is ahead".
 *
 * A match is counted once, when the match machine settles it. Nothing else reaches here:
 * an abandoned match is not a loss, and a pair who quit because the bus came should not
 * find one recorded against them.
 *
 * Read through `local-store.ts` like every other store and validated on the way out, for
 * the same reason: what is under the key was written by another tab, an older build or
 * somebody with the console open, and a count of -3, of 1.5 or of "seven" costs the
 * player that count rather than a crashed result screen.
 */

import { isRecord, KEY_PREFIX, readVersioned, removeJson, writeVersioned } from './local-store';

export const HEAD_TO_HEAD_KEY = `${KEY_PREFIX}head-to-head`;

/**
 * The shape written today: `{ version: 1, games: {…}, bots: {…} }`.
 *
 * The version is unchanged by the split because the split is additive: a document written
 * before it has no `bots`, which reads as "no bot matches" and is exactly what the two maps
 * mean. Bumping it would have thrown away every record on every device to relabel a number
 * the pair can see is theirs.
 */
const VERSION = 1;

/** Who held the far seat: the other person, or the shell's bot. */
export type Opponent = 'friend' | 'bot';

/** Both kinds, for the reads that want the whole of what this device has played. */
const OPPONENTS: readonly Opponent[] = ['friend', 'bot'];

/** Matches each seat has won, and the ones that ended level. */
export interface Tally {
  readonly p1: number;
  readonly p2: number;
  readonly draws: number;
}

export interface GameRecord extends Tally {
  /**
   * Matches finished, which is the three counts above added up.
   *
   * Only a match the machine settles is counted, so a match somebody walked out of is not
   * in here — "played" means played to the end.
   */
  readonly played: number;
}

export const EMPTY_TALLY: Tally = { p1: 0, p2: 0, draws: 0 };

const EMPTY_RECORD: GameRecord = { ...EMPTY_TALLY, played: 0 };

/**
 * One stored count, or zero if it is not a count at all.
 *
 * `Number.isInteger` answers three of the four cases on its own: a NaN, an Infinity and a
 * 1.5 are all rejected by it, and the sign is the fourth. Half a win is not a thing a
 * match can produce, so a stored one can only be junk.
 */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function sanitise(value: unknown): Tally {
  if (!isRecord(value)) return EMPTY_TALLY;
  return { p1: count(value['p1']), p2: count(value['p2']), draws: count(value['draws']) };
}

/** The derived half of a game's record, added at the boundary rather than stored. */
function withPlayed(tally: Tally): GameRecord {
  return { ...tally, played: tally.p1 + tally.p2 + tally.draws };
}

/**
 * One finished match added to a tally.
 *
 * Exported because the result screen needs the number *before* the write lands: the panel
 * is committed in the same render as the phase change, so a screen that waited for the
 * effect painted the score as it stood before the match the players just watched end. One
 * function decides what a result does to a tally, so what is shown and what is stored
 * cannot be two different arithmetics.
 */
export function addOutcome(tally: Tally, outcome: 'p1' | 'p2' | 'draw'): Tally {
  return {
    p1: tally.p1 + (outcome === 'p1' ? 1 : 0),
    p2: tally.p2 + (outcome === 'p2' ? 1 : 0),
    draws: tally.draws + (outcome === 'draw' ? 1 : 0),
  };
}

/** Two tallies added together, for the reads that want both kinds of match at once. */
function merge(a: Tally, b: Tally): Tally {
  return { p1: a.p1 + b.p1, p2: a.p2 + b.p2, draws: a.draws + b.draws };
}

/**
 * Every game with something recorded against it, as the counts actually written.
 *
 * A game whose entry sanitises to nothing is dropped rather than carried forward, so one
 * junk value under the key does not become a permanent empty row in every later write.
 */
function tidy(value: unknown): Record<string, Tally> {
  if (!isRecord(value)) return {};
  const out: Record<string, Tally> = {};
  for (const [slug, entry] of Object.entries(value)) {
    const tally = sanitise(entry);
    if (tally.p1 + tally.p2 + tally.draws > 0) out[slug] = tally;
  }
  return out;
}

/**
 * Both maps, read together, because a write has to put both back.
 *
 * `games` is the two seats and `bots` is the bot. The friend map keeps the name it was
 * written under before the split, which is the whole reason a version-1 document written
 * then still reads as the head-to-head it was called at the time.
 */
function readAll(): Record<Opponent, Record<string, Tally>> {
  const stored = readVersioned(HEAD_TO_HEAD_KEY, VERSION);
  return { friend: tidy(stored?.['games']), bot: tidy(stored?.['bots']) };
}

/**
 * The whole record: the head-to-head between the two seats, the per-game breakdown behind
 * it, and how many matches this device has finished altogether.
 *
 * `overall` is summed here rather than read from storage, which is the point of the comment
 * at the top of this file — it cannot fall out of step with the games because it is the
 * games. It counts the matches the two people played each other and no others: a bot's
 * wins belong to nobody at this device.
 *
 * `matches` is the other question — how much has been played here at all — and that one
 * does include the bot, because it is what the settings page shows beside the button that
 * erases the lot.
 */
export function readRecord(): {
  readonly overall: Tally;
  readonly games: Readonly<Record<string, GameRecord>>;
  readonly matches: number;
} {
  const all = readAll();
  let overall = EMPTY_TALLY;
  const games: Record<string, GameRecord> = {};
  for (const [slug, tally] of Object.entries(all.friend)) {
    overall = merge(overall, tally);
    games[slug] = withPlayed(tally);
  }
  let matches = overall.p1 + overall.p2 + overall.draws;
  for (const tally of Object.values(all.bot)) {
    matches += tally.p1 + tally.p2 + tally.draws;
  }
  return { overall, games, matches };
}

/**
 * This game's record against one kind of opponent, all zeros for a pairing that has never
 * finished a match.
 *
 * The kind is required rather than defaulted: every caller knows which match it is about,
 * and a default is how the two got mixed in the first place.
 */
export function readGameRecord(slug: string, opponent: Opponent): GameRecord {
  const tally = readAll()[opponent][slug];
  return tally === undefined ? EMPTY_RECORD : withPlayed(tally);
}

/**
 * Counts one finished match and hands back the game's new record against that opponent.
 *
 * Returned rather than left to the caller to re-read, so what the result screen shows is
 * what was written — one call, one match, one number. A caller that increments its own
 * copy as well is the double count this shape exists to make impossible.
 */
export function recordResult(
  slug: string,
  outcome: 'p1' | 'p2' | 'draw',
  opponent: Opponent,
): GameRecord {
  const all = readAll();
  const next = addOutcome(all[opponent][slug] ?? EMPTY_TALLY, outcome);
  all[opponent][slug] = next;
  // The result is ignored, as in every other store: storage being full or disabled costs
  // the pair a record they can rebuild by playing, and there is nothing to retry.
  writeVersioned(HEAD_TO_HEAD_KEY, VERSION, { games: all.friend, bots: all.bot });
  return withPlayed(next);
}

export function clearRecord(): void {
  removeJson(HEAD_TO_HEAD_KEY);
}

/**
 * The games this pair have played most, most played first, for the settings page.
 *
 * Both kinds of match, added together, because the question this list answers is which
 * games get reached for rather than who is ahead at them — a game the pair only ever play
 * against the bot is still one of the games they play. The settings page says so in a line
 * of its own beside the numbers, because a tally with no legend is a tally a reader is
 * entitled to read the other way round.
 *
 * Ties break on the slug so the list is stable: two games on four matches each should not
 * swap places between two reads of the same storage, because a list that reorders itself
 * for no reason reads as a bug in the counting.
 */
export function mostPlayed(limit: number): readonly { slug: string; record: GameRecord }[] {
  const all = readAll();
  const merged = new Map<string, Tally>();
  for (const opponent of OPPONENTS) {
    for (const [slug, tally] of Object.entries(all[opponent])) {
      merged.set(slug, merge(merged.get(slug) ?? EMPTY_TALLY, tally));
    }
  }
  return [...merged]
    .map(([slug, tally]) => ({ slug, record: withPlayed(tally) }))
    .sort((a, b) => {
      if (a.record.played !== b.record.played) return b.record.played - a.record.played;
      return a.slug < b.slug ? -1 : 1;
    })
    .slice(0, Math.max(0, limit));
}
