import Link from 'next/link';
import type { CatalogueEntry } from '@/data/catalogue.generated';
import { isPlayable } from '@/data/registry';
import { formatRound } from '@/lib/format';
import { GameTile } from './GameTile';
import styles from './GameCard.module.css';

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
 * to fix either: those route payloads are 3.7 KB gzipped each, and browsing all 108 cards
 * fetches all 108 of them — 390 KB speculated on a visitor who presses one. `prefetch`
 * here is the switch, but it is not a free one, because Next 15 turns hover and
 * touch-start prefetching off along with the viewport kind rather than in place of it.
 */
export function GameCard({ game }: { game: CatalogueEntry }) {
  const playable = isPlayable(game.slug);
  return (
    <Link href={playable ? `/play/${game.slug}/` : `/games/${game.slug}/`} className={styles.card}>
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
    </Link>
  );
}
