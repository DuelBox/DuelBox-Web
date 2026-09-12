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
 * #220 fills it one territory at a time. Each entry names the module it reads and returns exactly
 * the strings some call site can resolve to: a registered string no screen renders is copy that
 * has gone to a pseudo-locale to be forgotten, and a rendered one that is not registered leaves a
 * gap in the pseudo screens, which is the way round the extraction is meant to fail. The
 * extractor concatenates them with what it found at call sites, and every pseudo-locale is then
 * complete by construction.
 *
 * Kept as functions rather than arrays so that a source can import a data module — a module
 * `extract.ts` should not have to know about — and so that the cost of that import is paid by the
 * extractor and the unit suite, never by a page.
 *
 * Two constraints on what a source may read, both found by trying. A source must be a `.ts`
 * module, never a `.tsx` one: this repository compiles with `jsx: preserve` for Next, so
 * Vitest — which is what runs the extractor — cannot transform a `.tsx` file imported from
 * here, which is why the settings panel's key names and its import refusals live beside the
 * store in `lib/player-data.ts` rather than in the component that shows them. And the import
 * is a plain top-level one rather than something deferred inside `strings`, because `strings`
 * is synchronous: `import()` returns a promise and `require` does not exist in an ES module.
 * Nothing is shipped by that import — `extract.ts` is the only file that may name this module,
 * and the guard in `i18n.test.ts` holds it to being imported by its own test alone.
 */

import { IMPORT_ERRORS, PLAYER_DATA_KEY_NAMES } from '../player-data';

/** Every registered source: a name for the failure message, and the strings it contributes. */
export const DYNAMIC_SOURCES: readonly {
  readonly name: string;
  readonly strings: () => readonly string[];
}[] = [
  {
    // `SettingsPanel.tsx` shows one of these for every store an import restored, through
    // `t(messages, name)` in `describeImport`. Every value is reachable: the panel names a
    // key it has a name for, and shows the raw key for the four that have none.
    name: 'the stored data a settings import names (lib/player-data.ts)',
    strings: () => Object.values(PLAYER_DATA_KEY_NAMES),
  },
  {
    // `SettingsPanel.tsx` renders a refusal as `t(messages, result.error, result.values)`, and
    // `importPlayerData` returns exactly these five.
    name: 'why a settings import was refused (lib/player-data.ts)',
    strings: () => Object.values(IMPORT_ERRORS),
  },
];

/** Every string every registered source contributes, in one list, unsorted and not yet unique. */
export function dynamicMessages(): readonly string[] {
  return DYNAMIC_SOURCES.flatMap((source) => source.strings());
}
