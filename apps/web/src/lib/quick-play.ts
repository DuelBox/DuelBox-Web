/**
 * Which game "Play something" opens (#163).
 *
 * A pure function of three things: what is playable, what was played recently, and one
 * number in [0, 1). The randomness is handed in rather than reached for so that the tests
 * can seed it and so that the rule below is provable rather than plausible — a picker
 * that calls `Math.random` itself can only be tested by running it a lot and hoping.
 *
 * The rule is two-tiered. The game that was played last is never offered again, unless it
 * is the only game there is: a player who presses the button has just finished something
 * and "the same thing again" is what the rematch button is for. The two before that are
 * offered, but at a quarter of the weight of everything else, so a pair working through
 * the catalogue on a long evening sees new games more often than not without the picker
 * ever refusing to return to something they liked.
 */

/** The weight of a game that is not among the last three played. */
const FRESH_WEIGHT = 4;

/** The weight of the second- and third-most-recent games. */
const RECENT_WEIGHT = 1;

/**
 * One candidate, chosen by a single weighted draw from `random`.
 *
 * `candidates` are the playable slugs; `recent` is most-recent-first, as `recent.ts`
 * keeps it; `random` yields a number in [0, 1). `undefined` only when there is nothing
 * to choose from. Always one of `candidates`, whatever `random` returns — a source that
 * misbehaves and yields 1 or NaN is caught by the final fallback rather than falling
 * off the end of the list.
 */
export function pickQuickPlay(
  candidates: readonly string[],
  recent: readonly string[],
  random: () => number,
): string | undefined {
  if (candidates.length === 0) return undefined;

  const previous = recent[0];
  const pool = candidates.filter((slug) => slug !== previous);
  // Everything on offer is the game just played — the only-candidate case, whether the
  // list has one entry or the same entry several times over.
  if (pool.length === 0) return candidates[0];

  const coolingDown = new Set(recent.slice(1, 3));
  const weights = pool.map((slug) => (coolingDown.has(slug) ? RECENT_WEIGHT : FRESH_WEIGHT));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let remaining = random() * total;
  for (let index = 0; index < pool.length; index += 1) {
    remaining -= weights[index] ?? 0;
    if (remaining < 0) return pool[index];
  }
  return pool[pool.length - 1];
}
