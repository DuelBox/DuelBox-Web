import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { formatRound } from '@/lib/format';
import { GameTile } from '@/components/GameTile';
import { GameCard } from '@/components/GameCard';
import styles from './page.module.css';

/**
 * One indexable page per game. Generated at build time — a client-rendered games portal
 * earns no organic traffic, and a static page costs nothing to serve.
 */
export function generateStaticParams() {
  return CATALOGUE.map((game) => ({ slug: game.slug }));
}

function find(slug: string) {
  return CATALOGUE.find((game) => game.slug === slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = find(slug);
  if (!game) return { title: 'Game not found' };
  const description = game.rule || `${game.name} — a two-player game you can play in the browser.`;
  return {
    title: game.name,
    description,
    openGraph: { title: `${game.name} — DuelBox`, description },
  };
}

const MODE_COPY: Record<string, { title: string; body: string }> = {
  friend: {
    title: 'Play together here',
    body: 'Two of you on this device, sharing the screen.',
  },
  bot: {
    title: 'Play against a bot',
    body: 'Pip or Bo takes the other seat, at three levels.',
  },
  solo: {
    title: 'Play solo',
    body: 'Chase your own best score, no opponent needed.',
  },
};

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = find(slug);
  if (!game) notFound();

  const related = CATALOGUE.filter(
    (other) => other.category === game.category && other.id !== game.id,
  ).slice(0, 6);

  return (
    <div className="db-wrap">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/games/">All games</Link>
        <span aria-hidden="true">/</span>
        <span>{game.name}</span>
      </nav>

      <div className={styles.top}>
        <div className={styles.art}>
          <GameTile tint={game.tint} mark={game.mark} name={game.name} />
        </div>

        <div className={styles.detail}>
          <p className={styles.eyebrow}>
            {game.category} · about {formatRound(game.roundSeconds)}
          </p>
          <h1 className={styles.title}>{game.name}</h1>
          {game.rule ? <p className={styles.rule}>{game.rule}</p> : null}

          <div className={styles.modes}>
            {game.modes.map((mode) => {
              const copy = MODE_COPY[mode];
              if (!copy) return null;
              return (
                <div key={mode} className={styles.mode}>
                  <strong>{copy.title}</strong>
                  <span>{copy.body}</span>
                </div>
              );
            })}
          </div>

          <p className={styles.soon}>
            This game is still being built. Its rules and controls are settled; the playable build
            lands with its milestone.
          </p>
        </div>
      </div>

      {related.length > 0 ? (
        <section className={styles.related}>
          <h2 className={styles.relatedTitle}>More {game.category.toLowerCase()} games</h2>
          <div className={styles.grid}>
            {related.map((other) => (
              <GameCard key={other.id} game={other} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
