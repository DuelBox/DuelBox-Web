/**
 * What a player settles before a match starts: who they are playing, how hard the bot
 * tries, and how many rounds it takes to win.
 *
 * The vocabulary lives here rather than in the pre-match screen because three separate
 * places need to agree about it — the control that offers the choice, the store that
 * remembers it, and the match rules the shell hands the state machine. Written in the
 * component, the store would have had to re-declare which strings are legal, and the two
 * lists would have drifted the first time a tier was renamed.
 *
 * Nothing here touches storage or the DOM, so all of it is directly testable.
 */

import type { SeatId } from '@duelbox/engine';
import type { MatchRules } from '@duelbox/game-sdk';

export type PlayMode = 'friend' | 'bot' | 'solo';

/**
 * The same two modes written as a value, because a union cannot be walked and three readers
 * need to walk it.
 *
 * `isPlayMode` used to carry its own copy of the two strings, `offeredModes` below narrows a
 * game's declaration down to this list, and `scripts/validate-manifests.mjs` reads this array
 * out of this file at build time to decide whether a game is declaring a mode the product has
 * no way to run (#1749). Three copies of two strings is a drift waiting for the fourth mode.
 *
 * The union above is deliberately still written out in literals rather than derived from this
 * array. `app/metadata-claims.test.ts` parses `export type PlayMode = …` out of this very file
 * to work out what a visitor is offered — that is the fact behind CLAUDE.md's ninth entry, the
 * `<meta>` description promising a match across two devices — and `(typeof PLAY_MODES)[number]`
 * gives its reader nothing to read. So the two spellings both stay and are held together:
 * `satisfies` rejects a member here that the union does not have, and `match-setup.test.ts`
 * reads both declarations out of this file's source and compares the sets in both directions.
 *
 * `solo` joined the list with #1750. It was absent on purpose before that — six manifests
 * declared it and nothing in `apps/web` could start one — and the rule that kept it out is
 * the same one that let it in: a button is drawn only for a mode with a branch behind it.
 * {@link botSeatsFor} and {@link isSolo} are that branch, and `PlaySurface` seats one player
 * alone on it.
 */
export const PLAY_MODES = ['friend', 'bot', 'solo'] as const satisfies readonly PlayMode[];

/**
 * The three tiers every game in the catalogue implements.
 *
 * They are not decoration: each game tunes them separately, `bot-parity.test.ts` proves
 * per game that a tier genuinely reaches the simulation, and roughly a hundred SPEC.md
 * files record the measured win rate of each. Until #2485 no player could pick one.
 */
export const BOT_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;

export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

/**
 * Best-of lengths the shell offers.
 *
 * Odd only, so a best-of cannot be split down the middle, and short: this is a game two
 * people play standing up, and a best-of-seven is a commitment rather than a round.
 */
export const ROUND_CHOICES = [1, 3, 5] as const;

/** The tier a player who expresses no preference gets. */
export const DEFAULT_DIFFICULTY: BotDifficulty = 'normal';

/**
 * Best of three, and deliberately not one.
 *
 * One round was hardcoded, which meant `round-over` was unreachable in the whole product:
 * the SDK implements best-of, `match.test.ts` covers it, the HUD draws round pips and the
 * overlay has a "Next round" screen, and no player could ever see any of it. It also hid
 * the opening-seat rotation from #2466, which only decides rounds two and beyond — so the
 * fix for first-mover advantage was shipped switched off.
 *
 * Three rather than five because a best-of-three is decided in two rounds when one player
 * is better, which is the common case against a bot.
 */
export const DEFAULT_ROUNDS = 3;

/** Everything the pre-match screen remembers about one game. */
export interface MatchSetup {
  /** What the player chose last time, used to order the buttons. Never auto-started. */
  readonly mode: PlayMode | null;
  readonly difficulty: BotDifficulty;
  readonly rounds: number;
}

export const DEFAULT_SETUP: MatchSetup = {
  mode: null,
  difficulty: DEFAULT_DIFFICULTY,
  rounds: DEFAULT_ROUNDS,
};

export function isPlayMode(value: unknown): value is PlayMode {
  return (PLAY_MODES as readonly unknown[]).includes(value);
}

/**
 * The modes a game declares, narrowed to the ones the shell can actually start.
 *
 * A manifest's `modes` and this list are not the same set and must never be assumed to be.
 * The SDK's vocabulary and the shell's agree today — `friend | bot | solo` — and that is a
 * fact this function exists to stop being assumed: the day the SDK grows a fourth word, a
 * manifest that declares it gets no button until the shell has a branch for it.
 *
 * `solo` was the case for a long time. Six games declared it, nothing in `apps/web` could
 * start one, and each of the six pages advertised a mode its lobby did not offer (#1749).
 * The rule this puts a name on is that a button is drawn for the **intersection** and never
 * for the declaration: a button for a mode with no branch behind it does nothing when it is
 * pressed, and a dead button is the defect. #1750 built the branch, and the six buttons came
 * back through this same filter rather than through an exception to it.
 *
 * Order is the game's own, so a caller that wants the remembered mode first sorts afterwards
 * rather than getting a second ordering rule buried in here.
 *
 * Returning an empty array is a real answer and means a game page with no way to begin — see
 * the catalogue-wide assertion in `match-setup.test.ts`, which is the thing that would notice.
 */
export function offeredModes(declared: readonly string[]): readonly PlayMode[] {
  return declared.filter(isPlayMode);
}

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return BOT_DIFFICULTIES.includes(value as BotDifficulty);
}

/** Whether `value` is one of the lengths the shell actually offers. */
export function isRoundChoice(value: unknown): value is number {
  return ROUND_CHOICES.includes(value as (typeof ROUND_CHOICES)[number]);
}

/**
 * The rules for a match of `rounds` rounds.
 *
 * The win condition is `first-to-1` because every game in the catalogue settles its own
 * round and reports the winner; the shell resolves a condition only for a game that
 * declares one. What the shell decides is how many of those rounds make a match.
 */
export function matchRulesFor(rounds: number): MatchRules {
  return {
    win: { kind: 'first-to', target: 1 },
    rounds: isRoundChoice(rounds) ? rounds : DEFAULT_ROUNDS,
    countdownSeconds: 3,
  };
}

/**
 * Which seats a bot holds, and at what tier — the object the game host turns into
 * `GameContext.botDifficulty`.
 *
 * `undefined` for a friend match, so the host is told there is no bot at all rather than
 * being handed an empty object it would have to interpret.
 *
 * The caller must keep the returned object's identity stable for the life of a match:
 * the host's setup effect depends on it, and a fresh object every render tore the game
 * down mid-countdown once already.
 */
export function botSeatsFor(
  mode: PlayMode,
  difficulty: BotDifficulty,
): Partial<Record<SeatId, BotDifficulty>> | undefined {
  // `solo` is `undefined` here on purpose, the same answer as `friend`: nobody is in the far
  // seat, and "no bot" is the truth of it. What is different about solo is not who holds the
  // far seat but that nobody does, which is {@link isSolo}'s question and not this one's.
  return mode === 'bot' ? { p2: difficulty } : undefined;
}

/**
 * Whether a mode seats one player alone (#1750).
 *
 * The one question three readers ask about a mode that {@link botSeatsFor} cannot answer:
 * the host hands it to the game as `GameContext.solo`, the HUD draws one seat instead of two,
 * and the result screen shows a score against a best rather than a winner. A solo run is
 * always a single round — a best-of is two people taking turns to lose, and there is nobody
 * to take turns with — which is why {@link soloRules} exists beside `matchRulesFor`.
 */
export function isSolo(mode: PlayMode): mode is 'solo' {
  return mode === 'solo';
}

/** The rules for a solo run: one round, decided by the game, counted in. */
export function soloRules(): MatchRules {
  return { win: { kind: 'first-to', target: 1 }, rounds: 1, countdownSeconds: 3 };
}
