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
 * #220 fills it one territory at a time. Each entry names the module it reads and returns exactly
 * the strings some call site can resolve to: a registered string no screen renders is copy that
 * has gone to a pseudo-locale to be forgotten, and a rendered one that is not registered leaves a
 * gap in the pseudo screens, which is the way round the extraction is meant to fail. The
 * extractor concatenates them with what it found at call sites, and every pseudo-locale is then
 * complete by construction.
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
import { healthLevelLabel } from '../../components/health-bar';
import { CHANGE_REASONS } from '../match-changes';
import { BOT_DIFFICULTIES, DIFFICULTY_LABELS, ROUND_LABELS } from '../match-setup';
import { errorMessage } from '@duelbox/game-sdk';
import { OFFLINE_NOTICE, RELOAD_LABEL, UPDATE_NOTICE } from '../offline-state';
import { CATALOGUE, type CatalogueEntry } from '../../data/catalogue.generated';
import { CATEGORY_HUBS, gridHeading, roundLine } from '../categories';
import { formatRound } from '../format';
import { LANDING_SECTIONS, WAYS_TO_PLAY, roundSpread } from '../landing';
import { CONTROLS, MANIFESTS } from '../../data/controls';
import { DISABLED_GAMES, killSwitchFor } from '../flags';

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
  {
    /*
     * The three sentences the offline and update bar says (#192, #194), which
     * `components/ServiceWorkerBridge.tsx` renders as `t(messages, OFFLINE_NOTICE)` and so on.
     * They are constants rather than literals because `offline-state.test.ts` holds them
     * against the substrings `e2e/offline.spec.ts` greps for — the reason the module gives for
     * naming them — so the call sites have nothing for the extractor to read.
     */
    name: 'lib/offline-state.ts — the connection and update bar',
    strings: () => [OFFLINE_NOTICE, UPDATE_NOTICE, RELOAD_LABEL],
  },
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
  {
    // `components/GameOptionsPanel.tsx` renders `t(messages, option.label)` for every option a
    // game's manifest declares and `t(messages, choice.label)` for each choice of a select.
    // Empty today — no manifest declares an option — and registered anyway, so the first game
    // that does is extracted by the same command as everything else.
    name: "each game's option labels, on the play route (data/controls.ts)",
    strings: () =>
      MANIFESTS.flatMap((manifest) =>
        (manifest.options ?? []).flatMap((option) => [
          option.label,
          ...(option.type === 'select' ? option.choices.map((choice) => choice.label) : []),
        ]),
      ),
  },
];

/** Every string every registered source contributes, in one list, unsorted and not yet unique. */
export function dynamicMessages(): readonly string[] {
  return DYNAMIC_SOURCES.flatMap((source) => source.strings());
}
