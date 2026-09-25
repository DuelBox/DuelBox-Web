import { BEST_SCORES_KEY } from './best-scores-key';
import { isRecord, readVersioned, writeVersioned } from './local-store';

/**
 * The best score this device has seen for each solo game (#1750).
 *
 * A solo run has no opponent, so it has no head-to-head — `lib/head-to-head.ts` counts wins
 * between two seats and a run has one. What a returning player wants from a score-attack is
 * the number to beat, and that is all this keeps: one integer per game, the highest, and
 * nothing about when or how many attempts it took. Scores are otherwise not stored anywhere
 * on this site (the privacy page says so), which is why this store is named there.
 *
 * Reads go through `local-store.ts` like every store here, so absent, malformed, full or
 * blocked storage hands back "no best yet" and never throws.
 */
export { BEST_SCORES_KEY };

const VERSION = 1;

/** The stored map: `{ version: 1, games: { [slug]: best } }`, sanitised on the way out. */
function readAll(): Record<string, number> {
  const stored = readVersioned(BEST_SCORES_KEY, VERSION);
  const games = stored?.['games'];
  if (!isRecord(games)) return {};
  const out: Record<string, number> = {};
  for (const [slug, value] of Object.entries(games)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      out[slug] = Math.floor(value);
    }
  }
  return out;
}

/** This device's best for a game, or null when it has never finished a solo run of it. */
export function readBestScore(slug: string): number | null {
  const best = readAll()[slug];
  return best === undefined ? null : best;
}

/** What a finished run is told about itself. */
export interface RunResult {
  /** The score this run made. */
  readonly score: number;
  /** The best on this device after this run, this one included. */
  readonly best: number;
  /** Whether this run set it — a first run always does, and a tie does not. */
  readonly isNewBest: boolean;
}

/**
 * Record a finished run, keeping the higher of it and what was stored.
 *
 * A negative or non-finite score is a game reporting nonsense and is clamped to zero rather
 * than refused: the run still happened, and the honest number for it is nothing.
 */
export function recordRunScore(slug: string, score: number): RunResult {
  const made = Number.isFinite(score) && score > 0 ? Math.floor(score) : 0;
  const all = readAll();
  const previous = all[slug];
  const isNewBest = previous === undefined || made > previous;
  const best = isNewBest ? made : previous;
  if (isNewBest) {
    all[slug] = best;
    // The result is ignored, as in every store: storage refusing the write costs the player a
    // number they can beat again, and there is nothing to retry.
    writeVersioned(BEST_SCORES_KEY, VERSION, { games: all });
  }
  return { score: made, best, isNewBest };
}
