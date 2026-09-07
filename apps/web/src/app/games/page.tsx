import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CATALOGUE, CATEGORIES } from '@/data/catalogue.generated';
import { PLAYABLE, isPlayable } from '@/data/registry';
import { groupByCategory, type CatalogueIndexEntry } from '@/lib/catalogue-filter';
import { CatalogBrowser } from '@/components/CatalogBrowser';
import { GameCard } from '@/components/GameCard';
import { QuickPlay } from '@/components/QuickPlay';
import { TileSprite } from '@/components/TileSprite';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'All games',
  description: `Browse all ${String(CATALOGUE.length)} two-player games by category, length and mode.`,
};

/**
 * The catalogue. A server component, and the split with `CatalogBrowser` is the point.
 *
 * Every card is rendered here, once, and handed to the browser as a finished element; the
 * browser gets an index of five fields per game beside it. That keeps the catalogue's rule
 * text and the tile geometry where they have always been — in the HTML, at no cost to the
 * shell budget — while the search, the chips and the stars run in the browser on the
 * index alone. The playable list goes in as a plain array for the same reason: the
 * registry it comes from carries a loader for every game.
 */
export default function GamesPage() {
  const entries: CatalogueIndexEntry[] = CATALOGUE.map((game) => ({
    slug: game.slug,
    name: game.name,
    category: game.category,
    roundSeconds: game.roundSeconds,
    playable: isPlayable(game.slug),
  }));
  const cards: Record<string, ReactNode> = {};
  for (const game of CATALOGUE) cards[game.slug] = <GameCard game={game} />;
  const categoryCount = groupByCategory(entries, CATEGORIES).length;

  return (
    <div className="db-wrap">
      <TileSprite games={CATALOGUE} />
      <header className={styles.head}>
        <div className={styles.headRow}>
          <h1>All games</h1>
          <QuickPlay slugs={PLAYABLE} className={styles.surprise} />
        </div>
        {/* "Most also play across two devices" was the third site of the claim #102 took off
            the landing page, and the only one on a route a visitor reaches by pressing
            something. It was wrong twice over: there is no cross-device play in this build at
            all, and "most" understated the half that is true — every one of the 108 carries
            `bot`, not most of them. `app/metadata-claims.test.ts` counts the catalogue and
            fails this sentence if a game ever arrives without one. */}
        <p className={styles.count}>
          {CATALOGUE.length} games across {categoryCount} categories. Every one plays with two
          people on one device, and every one also takes a bot in the second seat.
        </p>
      </header>

      <CatalogBrowser entries={entries} categories={CATEGORIES} cards={cards} />
    </div>
  );
}
