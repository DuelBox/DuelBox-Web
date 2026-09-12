import { CATALOGUE, type CatalogueEntry } from '../../data/catalogue.generated';
import { CATEGORY_HUBS, gridHeading, roundLine } from '../categories';
import { formatRound } from '../format';
import { LANDING_SECTIONS, WAYS_TO_PLAY, roundSpread } from '../landing';

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
 * The rule every entry below is written to: **a source returns exactly the strings its call
 * sites can render, computed by the same function the call site calls.** A string registered here
 * that no screen shows is an orphan `i18n.test.ts` fails on; a string a screen shows that is
 * registered nowhere is missing from both pseudo-locales, which is what walking the site in
 * `?lang=en-XA` is for. Computing the set rather than listing it is what keeps the two equal as
 * the catalogue changes: `roundLine` below is the `roundLine` a hub page renders, over the games
 * that page selects, so eighteen sentences arrive without anybody retyping one.
 *
 * What is deliberately *not* here: anything that reaches a reader only through a route's
 * `metadata` or its JSON-LD. `CategoryHub.intent` is the clear case — it opens a hub's
 * `description` and appears nowhere on the page — and metadata stays English for the reason
 * `docs/i18n.md` gives, so registering it would be registering an orphan.
 *
 * Kept as functions rather than arrays so that a source can import a data module — a module
 * `extract.ts` should not have to know about — and so that the cost of that import is paid by the
 * extractor and the unit suite, never by a page. The imports are relative rather than `@/…`
 * because this module is read by vitest, which resolves no path alias.
 */

/**
 * What each mode is called on a catalogue card, and the second copy of that fact.
 *
 * `components/GameCard.tsx` holds the first, joins them with a middle dot and renders the joined
 * line through `<T>`; this joins them the same way, so the msgids are the lines the cards can
 * show. Two copies, because the extractor cannot import a `.tsx` — vitest transforms no JSX in
 * this project — and `game-card.test.ts` reads the labels back out of that file and fails when
 * the two stop agreeing, which is the only thing that stops this drifting.
 */
const MODE_LABEL: Readonly<Record<string, string>> = {
  friend: 'Two players',
  bot: 'vs Bot',
  solo: 'Solo',
};

/** The line under a game's name on its card: "Two players · vs Bot". */
function modeLine(modes: readonly string[]): string {
  return modes.map((mode) => MODE_LABEL[mode] ?? mode).join(' · ');
}

/** The games in one category, in catalogue order — what a hub page puts on screen. */
function gamesIn(category: string): CatalogueEntry[] {
  return CATALOGUE.filter((game) => game.category === category);
}

/** Every registered source: a name for the failure message, and the strings it contributes. */
export const DYNAMIC_SOURCES: readonly {
  readonly name: string;
  readonly strings: () => readonly string[];
}[] = [
  {
    // Registered once, here, for every place a category name is shown: the six links in the
    // footer, the chips and the group headings on `/games/`, a hub's crumb and the heading over
    // its grid, and the line under a game's name on its card. Taken from the games rather than
    // from `CATEGORIES`, because a category with no game in it is a chip nobody sees.
    name: 'catalogue category names',
    strings: () => [...new Set(CATALOGUE.map((game) => game.category))],
  },
  {
    // "about 90 seconds", on every card, and inside the two sentences that quote the shortest
    // and the longest a category holds. Fourteen distinct ones across the 108 games.
    name: 'catalogue round lengths',
    strings: () => CATALOGUE.map((game) => formatRound(game.roundSeconds)),
  },
  {
    name: 'catalogue mode lines',
    strings: () => CATALOGUE.map((game) => modeLine(game.modes)),
  },
  {
    // Every word of the landing page below the hero, and the sentence it builds out of the
    // catalogue's own round lengths.
    name: 'landing copy',
    strings: () => [
      ...LANDING_SECTIONS.flatMap((section) => [section.heading, ...section.paragraphs]),
      ...WAYS_TO_PLAY.flatMap((way) => [way.title, way.body]),
      roundSpread(CATALOGUE),
    ],
  },
  {
    // The eighteen hubs: the heading, the paragraph under it, the heading over the games grid
    // and the line about how long a round takes. `intent` is not here — see above.
    name: 'category hub copy',
    strings: () =>
      CATEGORY_HUBS.flatMap((hub) => [
        hub.title,
        hub.blurb,
        gridHeading(hub.category),
        roundLine(gamesIn(hub.category)),
      ]),
  },
];

/** Every string every registered source contributes, in one list, unsorted and not yet unique. */
export function dynamicMessages(): readonly string[] {
  return DYNAMIC_SOURCES.flatMap((source) => source.strings());
}
