import { CATALOGUE } from '../../data/catalogue.generated';
import { CONTROLS } from '../../data/controls';
import { DISABLED_GAMES, killSwitchFor } from '../flags';

/**
 * The user-facing strings the extractor cannot see by reading call sites: data that reaches a
 * `t()` as a variable rather than as a literal (#219, filled in by #220).
 *
 * `extract.ts` finds a message by its shape at the call site — `t(messages, 'Mute sound')`,
 * `<T id="…" />`, a `plural()` forms object — and a string that arrives through a variable has
 * no shape to find. A game's `rule` from `catalogue.generated.ts` is the clear case: the
 * component writes `t(messages, entry.rule)`, and the 108 sentences it can resolve to live in a
 * generated data file, not in the component. The extractor needs to be told where such strings
 * come from, and this module is where it is told.
 *
 * A source returns the **exact** strings its call site can render, nothing more: a string
 * registered here that no screen shows is copy the site has stopped showing, and it would ride
 * into both pseudo-locale chunks and be paid for by whoever chose that language. So the controls
 * source skips a game the kill switch has taken off the site — that page renders no controls —
 * and the rules source skips an empty rule, which is the one thing `games/[slug]/page.tsx` does
 * not render. The other direction is the pseudo screens' job: a data string that reaches the DOM
 * and is *not* registered shows up in plain English under `en-XA`, which is what those locales
 * are for.
 *
 * Kept as functions rather than arrays so that the work of reading a data module is done when the
 * extractor asks and not when this module is loaded, and so the cost is paid by the extractor and
 * the unit suite, never by a page. The imports themselves are static because `strings()` is
 * synchronous and ESM has no synchronous import; nothing outside `extract.ts` imports this file,
 * so no page carries them.
 */

/** Every registered source: a name for the failure message, and the strings it contributes. */
export const DYNAMIC_SOURCES: readonly {
  readonly name: string;
  readonly strings: () => readonly string[];
}[] = [
  {
    // `<T id={game.rule} />` in `app/games/[slug]/page.tsx`. One sentence per game, written in
    // `data/catalog.yaml` and generated into the catalogue; a game with an empty rule renders
    // no paragraph at all, so an empty string is not a message.
    name: "each game's rule, rendered on its own page",
    strings: () => CATALOGUE.map((entry) => entry.rule).filter((rule) => rule.length > 0),
  },
  {
    // `<T id={controls.keyboard} />` and `<T id={controls.pointer} />` on the same page. The
    // strings live in each game's manifest, which is where the play route reads them from too,
    // so the landing page and the game cannot disagree about what the keys do.
    name: "each game's keyboard and pointer controls, rendered on its own page",
    strings: () => {
      const found: string[] = [];
      for (const [slug, controls] of CONTROLS) {
        // A game the kill switch has taken off the site shows the switch's own sentence
        // instead of its controls, so its controls are not strings this site can render.
        if (killSwitchFor(slug) !== null) continue;
        found.push(controls.keyboard);
        if (controls.pointer.length > 0) found.push(controls.pointer);
      }
      return found;
    },
  },
  {
    // `<T id={switchedOff.reason} />`, inside the sentence the same page shows in place of the
    // Play link. Empty in a healthy build — `DISABLED_GAMES` is empty — and registered anyway,
    // so that the day somebody switches a game off at speed, the sentence a player is shown is
    // extracted by the same command as everything else rather than being the one string on the
    // site that cannot be translated.
    name: 'the reason a switched-off game gives, on its own page',
    strings: () => DISABLED_GAMES.map((entry) => entry.reason),
  },
];

/** Every string every registered source contributes, in one list, unsorted and not yet unique. */
export function dynamicMessages(): readonly string[] {
  return DYNAMIC_SOURCES.flatMap((source) => source.strings());
}
