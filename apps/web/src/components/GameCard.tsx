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
