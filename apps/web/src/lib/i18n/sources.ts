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
 * Empty today, on purpose. Nothing this batch converts renders a data string, and registering a
 * source whose call site does not exist yet would put 108 rules into the pseudo-locales that no
 * screen shows — which is exactly the orphan `i18n.test.ts` fails on. #220 adds the rules, the
 * category names and hub copy, and whatever else it finds, one function per source, each
 * returning the exact strings the site can render. The extractor concatenates them with what it
 * found at call sites, and every pseudo-locale is then complete by construction.
 *
 * Kept as functions rather than arrays so that a source can import a data module — a module
 * `extract.ts` should not have to know about — and so that the cost of that import is paid by the
 * extractor and the unit suite, never by a page. Nothing a browser downloads imports this file.
 */

import { errorMessage } from '@duelbox/game-sdk';

/** Every registered source: a name for the failure message, and the strings it contributes. */
export const DYNAMIC_SOURCES: readonly {
  readonly name: string;
  readonly strings: () => readonly string[];
}[] = [
  {
    /*
     * What `components/GameErrorBoundary.tsx` shows when a game threw something with no
     * message of its own: `errorMessage` in the SDK supplies the sentence, and the boundary
     * renders `<T id={errorMessage(error)} />` — an id no call site spells out. Taken from the
     * function rather than copied, so a reworded fallback cannot leave this behind. The two
     * sentences the shell itself throws are `t()` calls in `PlaySurface` and `GameHost` and
     * need no entry here; a message a game threw is that game's own string and is not a msgid.
     */
    name: '@duelbox/game-sdk errorMessage — the fallback the recovery screen shows',
    strings: () => [errorMessage(undefined)],
  },
];

/** Every string every registered source contributes, in one list, unsorted and not yet unique. */
export function dynamicMessages(): readonly string[] {
  return DYNAMIC_SOURCES.flatMap((source) => source.strings());
}
