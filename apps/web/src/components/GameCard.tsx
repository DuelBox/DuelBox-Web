import Link from 'next/link';
import type { CatalogueEntry } from '@/data/catalogue.generated';
import { isPlayable } from '@/data/registry';
import { formatRound } from '@/lib/format';
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

const MODE_LABEL: Record<string, string> = {
  friend: 'Two players',
  bot: 'vs Bot',
  solo: 'Solo',
};

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
        {playable ? <span className={styles.playable}>Play</span> : null}
      </div>
      <span className={styles.name}>{game.name}</span>
      <span className={styles.meta}>
        {game.category} · {formatRound(game.roundSeconds)}
      </span>
      <span className={styles.modes}>
        {game.modes.map((mode) => MODE_LABEL[mode] ?? mode).join(' · ')}
      </span>
      {/* Both claims, neither shown until the attribute above has a value. A card that
          cannot be played is not annotated at all: its link goes to the game's page rather
          than into a match, and "On this device" on it would be read as a statement about
          the game rather than about the page a tap would open. */}
      {playable ? (
        <>
          <span className={styles.stored}>On this device</span>
          <span className={styles.missing}>Not on this device</span>
        </>
      ) : null}
    </Link>
  );
}
