/**
 * The user-facing strings the extractor cannot see by reading call sites: data that reaches a
 * `t()` as a variable rather than as a literal (#219, for #220 to fill in).
 *
 * `extract.ts` finds a message by its shape at the call site — `t(messages, 'Mute sound')`,
 * `<T id="…" />`, a `plural()` forms object — and a string that arrives through a variable has
 * no shape to find. A game's `rule` from `catalogue.generated.ts` is the clear case: the
 * component writes `t(messages, entry.rule)`, and the 108 sentences it can resolve to live in a
 * generated data file, not in the component. The extractor needs to be told where such strings
 * come from, and this module is where it is told.
 *
 * One entry per source, each returning the exact strings the site can render from that module.
 * The extractor concatenates them with what it found at call sites, and every pseudo-locale is
 * then complete by construction. A string registered here that no call site can render is an
 * orphan `i18n.test.ts` refuses, so an entry is deleted the moment its render site is.
 *
 * Kept as functions rather than arrays so that a source can import a data module — a module
 * `extract.ts` should not have to know about — and so that the cost of that import is paid by the
 * extractor and the unit suite, never by a page.
 */

import { healthLevelLabel } from '../../components/health-bar';
import { CHANGE_REASONS } from '../match-changes';
import { BOT_DIFFICULTIES, DIFFICULTY_LABELS, ROUND_LABELS } from '../match-setup';

/** Every registered source: a name for the failure message, and the strings it contributes. */
export const DYNAMIC_SOURCES: readonly {
  readonly name: string;
  readonly strings: () => readonly string[];
}[] = [
  // --- The play route (#220): the match overlay, the HUD and the tournament track. ---
  {
    /**
     * The bot tier said mid-sentence — "Round 2 of 3 · easy", "Bot skill: easy for all 7
     * games". The union member *is* the word, so the ids are the members themselves and
     * `MatchHud`/`TournamentTrack` render `t(messages, tier)`.
     */
    name: 'the bot tier, said mid-sentence (MatchHud, TournamentTrack)',
    strings: () => [...BOT_DIFFICULTIES],
  },
  {
    /**
     * The same three tiers capitalised, plus the three match lengths, as the pre-match and
     * between-rounds radios name them. `MatchOptions` renders `t(messages, choice.label)`.
     */
    name: 'the tier and length labels on the match-options radios',
    strings: () => [...Object.values(DIFFICULTY_LABELS), ...Object.values(ROUND_LABELS)],
  },
  {
    /**
     * Why a match refuses to change something about itself. `MatchOverlay` renders
     * `t(messages, verdict.reason)` on the pause panel and under the round result.
     */
    name: 'the reasons a match refuses a change (lib/match-changes.ts)',
    strings: () => CHANGE_REASONS,
  },
  {
    /** The health bar's state word, beside the bar and inside its `aria-label`. */
    name: 'the health-bar level words (components/health-bar.ts)',
    strings: () => (['ok', 'low', 'critical'] as const).map(healthLevelLabel),
  },
];

/** Every string every registered source contributes, in one list, unsorted and not yet unique. */
export function dynamicMessages(): readonly string[] {
  return DYNAMIC_SOURCES.flatMap((source) => source.strings());
}
