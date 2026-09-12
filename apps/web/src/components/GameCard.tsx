import Link from 'next/link';
import type { CatalogueEntry } from '@/data/catalogue.generated';
import { isPlayable } from '@/data/registry';
import { formatRound } from '@/lib/format';
import { T } from '@/lib/i18n/T';
import { GameTile } from './GameTile';
import styles from './GameCard.module.css';

/**
 * One game in the grid, and the one component in this repository that is a server component
 * on purpose rather than by default.
 *
 * ## Why there is no `'use client'` here, and why there must never be one
 *
 * This card is on the landing page twelve times and on `/games/` a hundred and eight times,
 * and it reaches `data/catalogue.generated.ts` (the rule text for every game), `lib/tiles.ts`
 * (the tile geometry) and `data/registry.ts` (a dynamic import per game). As a server
 * component all of that is build-time: what a browser receives is finished markup, and the
 * shell budget in `size-budget.json` pays nothing at all for it. A `'use client'` directive
 * at the top of this file moves the whole of that graph into the chunks every visitor
 * downloads before they have chosen anything, against a budget with under two kilobytes of
 * headroom — `_raised_2026_09_06` records the split being worth about sixty kilobytes of
 * catalogue text alone.
 *
 * That is not left to be remembered. `apps/web/src/lib/landing.test.ts` walks the landing
 * page's import graph transitively, fails on any file in it carrying a client directive, and
 * **names the offending file**; it asserts `components/GameCard.tsx` is in the graph it
 * walked, so the guard cannot go quiet by failing to reach this file. Run it before believing
 * anything in this docstring.
 *
 * ## What that costs, and how the offline annotation is paid for anyway
 *
 * A server component knows nothing about the device it is rendering for. Whether a game is
 * saved on *this* browser is a fact about Cache Storage that is minutes old and different on
 * the phone and the laptop the same pair played on last night, so it cannot be rendered into
 * static HTML — and #193 asks for exactly that fact, on the card, in words.
 *
 * So the card renders the two things a server *can* render, and a client component elsewhere
 * supplies the one thing it cannot:
 *
 * - **The place for the answer.** `data-offline-ready`, rendered empty, which is a third
 *   state and not a synonym for "no": empty means nobody has looked yet, `0` means the cache
 *   was read and the game is not in it. A build that shipped `0` would be a server asserting
 *   something about a device it has never seen, and it would be wrong on precisely the cards
 *   the feature exists for — the games this pair has already played.
 * - **Both words, both hidden.** `GameCard.module.css` reveals one of them from the value of
 *   that attribute, so choosing between them costs no JavaScript and no re-render. The
 *   unchosen one is `display: none`, which takes it out of the accessibility tree as well as
 *   off the screen, so a screen reader hears one claim about the card rather than two
 *   contradictory ones.
 *
 * The value is written by `lib/offline-ready.ts`, called from `CatalogBrowser` — the client
 * component `/games/` already loads — over the subtree it rendered. Only that route is
 * annotated. The landing page, the category hubs and a game's own page render the same cards
 * and leave them in the empty state, because putting a client component on any of those to
 * fill it in is the exact cost this whole arrangement exists to avoid; an unannotated card
 * says nothing rather than something wrong, which is why the empty state has to mean
 * "unknown".
 *
 * ## The words
 *
 * "On this device" and "Not on this device". Two things were rejected and the reasons are the
 * decision: **"Available offline"** is a promise about how the next tap will behave, and this
 * cannot promise that — `lib/offline-ready.ts` sets out the gap, which is that a page can see
 * a game's *document* in the cache and cannot tell which numbered chunk is its code.
 * **"Downloaded"** is nearly honest and quietly wrong in the same direction: nobody
 * downloaded anything, the worker kept a copy of a page that was opened. What is actually
 * known is that something is stored here, so that is what the card says.
 *
 * They are words rather than a dot, a tint or a border, because rule 7 is the point of this
 * feature rather than a condition on it: the pair deciding what to play with no signal are
 * reading the card, and a grey card among coloured ones tells somebody who cannot see the
 * difference nothing at all. The colours on the two words are decoration over a distinction
 * the text already makes.
 *
 * ## The same shape, elsewhere
 *
 * #162 (per-game statistics) is the same problem and is still half-unmet for the same reason:
 * how many times this pair has played a game lives in `lib/head-to-head.ts`, in this
 * browser's own storage, so a card rendered at build time cannot carry it either. If it is
 * ever wanted on a card, it wants this arrangement — a place rendered here, filled in by the
 * client component that owns the grid — and not a directive at the top of this file.
 */

/**
 * What each mode is called on the card, joined with a middle dot into one line.
 *
 * The joined line is what a locale translates, not the three words separately, and it is
 * registered in `lib/i18n/sources.ts` as `catalogue mode lines` — the catalogue holds two
 * combinations, so that is two strings rather than 108. Registered rather than extracted
 * because the extractor reads literals at call sites and this arrives as a variable
 * (`docs/i18n.md`), and joined rather than rendered a word at a time because a word at a
 * time would put three text nodes and two comment markers where the export has one string,
 * on every one of 108 cards, for a line whose separator is punctuation.
 *
 * That leaves the labels written here and the labels `sources.ts` joins as two copies of
 * one fact. `game-card.test.ts` reads both and fails when they stop agreeing, because a
 * registered string the card does not render is an orphan `i18n.test.ts` refuses, and a
 * rendered one nobody registered shows in plain English on a pseudo-localised screen.
 */
const MODE_LABEL: Record<string, string> = {
  friend: 'Two players',
  bot: 'vs Bot',
  solo: 'Solo',
};

/**
 * One card in the grid, and — measured for #185 — the cheapest link on the site to press.
 *
 * There is deliberately no hover or touch-start prefetching here, because nearly all of it
 * already happens without us. `next/link` prefetches the route payload for every card
 * within 200px of the viewport, and that payload names the play route's client chunks, so
 * React fetches those with it. By the time anybody presses a card the match flow, the
 * engine and the audio are already in the browser, and the press costs exactly one script:
 * that game's own chunk, 2.6 to 6.8 KB gzipped. `e2e/prefetch.spec.ts` holds that count,
 * from both sides — it fails if the warming stops and it fails if a game stops having a
 * chunk of its own.
 *
 * Prefetching that last chunk on intent needs a client component here, to reach the
 * dynamic import in `data/registry.ts`. This card is on the landing page, and
 * `lib/landing.test.ts` fails on any client directive in that page's import graph, naming
 * this file as it does so. What the component would buy is about 4 KB arriving one round
 * trip early; what it would cost is the guard that keeps the route every visitor lands on
 * free of script. Making that trade is a change to the landing page first, not to this
 * card.
 *
 * The same measurement found the other half of #185 unaddressed, and it is not this file's
 * to fix either: those route payloads are 4.6 KB gzipped each, and browsing all 108 cards
 * fetches all 108 of them — 487 KB speculated on a visitor who presses one. `prefetch`
 * here is the switch, but it is not a free one, because Next 15 turns hover and
 * touch-start prefetching off along with the viewport kind rather than in place of it.
 * That figure is now `speculatedBytes` in `size-budget.json`, held from the build by
 * `check-size.mjs` and from a real browse by `e2e/prefetch.spec.ts`, so it cannot grow
 * while the decision waits. Nothing else changed: it is bounded, not fixed.
 *
 * The 3.7 KB and 397 KB this paragraph first carried were measured a day earlier, against
 * main at 4333bc7. Merging main moved the payload to 4.6 KB without touching this file or
 * any card: the root layout now carries two before-paint inline scripts, and every one of
 * the 108 payloads carries the whole root-layout tree, so the pair costs 67.6 KB
 * speculated. `size-budget.json` records the measurement; #2545 holds the cost. Which is
 * the point — the number moved under the file that quotes it, and only the budget saw.
 *
 * ## What this card does not show, and why
 *
 * #162 asks for the head-to-head record "on the game card and game page". Only the game
 * page has it, in `components/GameRecord.tsx`, and that is a decision rather than an
 * oversight: a record is read from this device's storage, so a card that showed one would
 * be a client component — 108 of them on the catalogue route and twelve on the landing
 * page, each pulling `lib/head-to-head` into the shell bundle every visitor downloads,
 * against a budget with under a kilobyte spare. `lib/landing.test.ts` names this file in
 * the landing page's import graph and fails on a client directive in it, which is the same
 * argument enforced. So the card half of #162 is **not met**, and the issue should say so
 * rather than be closed on the page half alone.
 */
export function GameCard({ game }: { game: CatalogueEntry }) {
  const playable = isPlayable(game.slug);
  return (
    <Link
      href={playable ? `/play/${game.slug}/` : `/games/${game.slug}/`}
      className={styles.card}
      // Written as a literal rather than from `OFFLINE_READY_ATTRIBUTE`, because a computed
      // JSX attribute name has to be spread and this file's imports are the landing page's
      // imports. `lib/offline-ready.test.ts` reads this file, the stylesheet and that module
      // and fails when the three stop agreeing on the string — nothing in a browser would.
      data-offline-ready={playable ? '' : undefined}
    >
      <div className={styles.art}>
        <GameTile game={game} />
        <span className={styles.seats} aria-hidden="true">
          <i className={styles.p1} />
          <i className={styles.p2} />
        </span>
        {playable ? (
          <span className={styles.playable}>
            <T id="Play" />
          </span>
        ) : null}
      </div>
      {/* The name is not translated: `scripts/check-game-names.mjs` holds every one of them
          against the reference app's, so a translated name is a second name nobody has
          cleared (`docs/i18n.md`). The category and the round length are, and both arrive
          as data — registered in `lib/i18n/sources.ts` from the catalogue itself. */}
      <span className={styles.name}>{game.name}</span>
      <span className={styles.meta}>
        <T id={game.category} /> · <T id={formatRound(game.roundSeconds)} />
      </span>
      <span className={styles.modes}>
        <T id={game.modes.map((mode) => MODE_LABEL[mode] ?? mode).join(' · ')} />
      </span>
      {/* Both claims, neither shown until the attribute above has a value. A card that
          cannot be played is not annotated at all: its link goes to the game's page rather
          than into a match, and "On this device" on it would be read as a statement about
          the game rather than about the page a tap would open. */}
      {playable ? (
        <>
          <span className={styles.stored}>
            <T id="On this device" />
          </span>
          <span className={styles.missing}>
            <T id="Not on this device" />
          </span>
        </>
      ) : null}
    </Link>
  );
}
