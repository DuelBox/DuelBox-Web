import type { Metadata } from 'next';
import { CATALOGUE, CATEGORIES } from '@/data/catalogue.generated';
import { GameCard } from '@/components/GameCard';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'All games',
  description: `Browse all ${String(CATALOGUE.length)} two-player games by category, length and mode.`,
};

export default function GamesPage() {
  const byCategory = CATEGORIES.map((category) => ({
    category,
    games: CATALOGUE.filter((game) => game.category === category),
  }))
    .filter((group) => group.games.length > 0)
    .sort((a, b) => b.games.length - a.games.length);

  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>All games</h1>
        <p className={styles.count}>
          {CATALOGUE.length} games across {byCategory.length} categories. Every one plays with two
          people on one device, and most also play across two devices or against a bot.
        </p>
      </header>

      {byCategory.map((group) => (
        <section key={group.category} className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {group.category}
            <span className={styles.sectionCount}>{group.games.length}</span>
          </h2>
          <div className={styles.grid}>
            {group.games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
