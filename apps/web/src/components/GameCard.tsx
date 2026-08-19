import Link from 'next/link';
import type { CatalogueEntry } from '@/data/catalogue.generated';
import { GameTile } from './GameTile';
import styles from './GameCard.module.css';

const MODE_LABEL: Record<string, string> = {
  friend: 'Two players',
  bot: 'vs Bot',
  solo: 'Solo',
};

export function GameCard({ game }: { game: CatalogueEntry }) {
  return (
    <Link href={`/games/${game.slug}/`} className={styles.card}>
      <div className={styles.art}>
        <GameTile tint={game.tint} mark={game.mark} name={game.name} />
        <span className={styles.seats} aria-hidden="true">
          <i className={styles.p1} />
          <i className={styles.p2} />
        </span>
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

function formatRound(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return `${String(minutes)} min`;
}
