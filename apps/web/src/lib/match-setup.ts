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

export type PlayMode = 'friend' | 'bot';

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
  return value === 'friend' || value === 'bot';
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
  return mode === 'bot' ? { p2: difficulty } : undefined;
}
