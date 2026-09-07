/**
 * The bot difficulty, as a structured value rather than a bare string.
 *
 * Difficulty was three strings — `'easy' | 'normal' | 'hard'` — passed through
 * {@link GameContext.botDifficulty}, and every game turned that string into its own numbers
 * privately. Written per game they drift, and worse, they drift *silently*: a tier that does
 * nothing looks exactly like a tier that does, which is the bug {@link misjudgement} in
 * `bot-judgement.ts` was written to stop being rediscovered. This gives the three tiers one
 * set of numbers, expressed in the terms a bot actually consumes.
 *
 * A difficulty is three levers, and only three, because these are the three a person varies:
 *
 * - **reaction delay** — how long the bot waits before it acts on a new situation, the floor
 *   passed to {@link commit} in `bot-judgement.ts`. A better player reacts sooner.
 * - **error magnitude** — the spread of the symmetric error drawn once and held, in [0, 1],
 *   handed to {@link misjudgement} as its `spread`. A better player is more accurate.
 * - **blunder rate** — the probability, in [0, 1], that a given decision is an outright
 *   mistake rather than a small misjudgement. A better player blunders less often.
 *
 * None of the three is information, speed, or physics a human cannot get (CLAUDE.md rule 6):
 * a slower reaction, a wider error and a higher chance of a blunder are all *handicaps*, so a
 * harder bot is a less handicapped one and the ceiling is a bot that reacts at once, never
 * errs and never blunders — which is still only playing the position it can see.
 *
 * This is a **type and a table**, deliberately not a rewrite of every game's bot. A game that
 * already tunes its own tiers keeps doing so; {@link difficultyForTier} is the shared answer
 * for the games that want one and the vocabulary the rest can be migrated to without the
 * string enum changing under them.
 */

/** The three tiers every game in the catalogue offers, as the shell's string enum names them. */
export const BOT_TIERS = ['easy', 'normal', 'hard'] as const;

export type BotTier = (typeof BOT_TIERS)[number];

/** One tier's three levers, in the units a bot consumes them in. */
export interface BotDifficulty {
  /** Seconds the bot waits before acting on a new situation. Lower is stronger. */
  readonly reactionSeconds: number;
  /** Spread of the held symmetric error, in [0, 1]. Lower is stronger. */
  readonly errorMagnitude: number;
  /** Probability a decision is an outright blunder, in [0, 1]. Lower is stronger. */
  readonly blunderRate: number;
}

/**
 * The three tiers as structured values.
 *
 * The numbers are a starting table rather than a measured optimum for any one game — a game
 * that has measured its own keeps them (see the note above) — but they are monotonic on every
 * lever, which is the property {@link isStronger} and the tests assert: `hard` reacts faster,
 * errs less and blunders less than `normal`, and `normal` than `easy`. A non-monotonic table
 * would reproduce exactly the "a lever that ran backwards" defect the HANDOFF records finding
 * three times.
 */
export const BOT_DIFFICULTIES: Readonly<Record<BotTier, BotDifficulty>> = {
  easy: { reactionSeconds: 0.5, errorMagnitude: 0.35, blunderRate: 0.25 },
  normal: { reactionSeconds: 0.28, errorMagnitude: 0.18, blunderRate: 0.1 },
  hard: { reactionSeconds: 0.12, errorMagnitude: 0.06, blunderRate: 0.02 },
};

/** Whether `value` names one of the three tiers. */
export function isBotTier(value: unknown): value is BotTier {
  return typeof value === 'string' && (BOT_TIERS as readonly string[]).includes(value);
}

/**
 * The structured difficulty for a tier — the adapter from the string enum every game and the
 * shell already speak. `botDifficulty(seat)` returns the string; a game hands it here and gets
 * numbers, so no game breaks and no game has to change its `GameContext` signature.
 *
 * @throws RangeError if `tier` is not one of the three.
 */
export function difficultyForTier(tier: BotTier): BotDifficulty {
  const difficulty = BOT_DIFFICULTIES[tier];
  if (difficulty === undefined) {
    throw new RangeError(`unknown bot tier: ${String(tier)}`);
  }
  return difficulty;
}

/**
 * Whether tier `a` plays strictly stronger than tier `b` on every lever.
 *
 * Exposed because "harder is better on all three" is the invariant the table has to keep, and
 * a game composing its own difficulty from these parts can assert it kept it too.
 */
export function isStronger(a: BotDifficulty, b: BotDifficulty): boolean {
  return (
    a.reactionSeconds < b.reactionSeconds &&
    a.errorMagnitude < b.errorMagnitude &&
    a.blunderRate < b.blunderRate
  );
}
