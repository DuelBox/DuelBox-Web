import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { SEAT_CHARACTERS } from '@/lib/seats';
import { GameCard } from '@/components/GameCard';
import styles from './page.module.css';

const WAYS = [
  {
    badge: '1',
    title: 'One device, together',
    body: 'Put the phone between you and share the screen.',
    tint: 'var(--db-sun-tint)',
    ink: '#a06f00',
  },
  {
    badge: '2',
    title: 'Two devices, anywhere',
    body: 'Open a link on the other device and play across the room or the world.',
    tint: 'var(--db-p2-tint)',
    ink: 'var(--db-p2-deep)',
  },
  {
    badge: '3',
    title: 'On your own',
    body: 'A bot takes the other seat, at three levels.',
    tint: 'var(--db-p1-tint)',
    ink: 'var(--db-p1-deep)',
  },
];

export default function HomePage() {
  const featured = CATALOGUE.filter((g) => g.researched).slice(0, 12);
  return (
    <>
      <section className={styles.hero}>
        <div className="db-wrap">
          {/* Not "Works offline": there is no service worker, so a page that has not been
              loaded cannot be opened without a connection (#2445). The privacy page made
              the same claim and it was wrong there too (#2513). */}
          <p className={styles.eyebrow}>No download · No account · Runs on your device</p>
          <h1 className={styles.title}>
            {CATALOGUE.length} games
            <br />
            for two players
          </h1>
          <p className={styles.lede}>
            Share one phone, or play from your own device against a friend anywhere. No opponent
            around? {SEAT_CHARACTERS.p2} will take the other seat.
          </p>
          <div className={styles.actions}>
            <Link href="/games/" className={styles.primary}>
              Start playing
            </Link>
            {/* Labelled with the heading of the page it opens. It said "How it works",
                which is a fifth name for a page the header, the footer and the guide's own
                h1 all call How to play (#2513). */}
            <Link href="/how-to-play/" className={styles.secondary}>
              How to play
            </Link>
          </div>
        </div>
      </section>

      <section className={`db-wrap ${styles.ways}`} aria-label="Ways to play">
        {WAYS.map((way) => (
          <article key={way.badge} className={styles.way}>
            <span className={styles.badge} style={{ background: way.tint, color: way.ink }}>
              {way.badge}
            </span>
            <span>
              <strong className={styles.wayTitle}>{way.title}</strong>
              <span className={styles.wayBody}>{way.body}</span>
            </span>
          </article>
        ))}
      </section>

      <section className="db-wrap">
        <div className={styles.sectionHead}>
          <h2>Popular right now</h2>
          <Link href="/games/">See all {CATALOGUE.length} →</Link>
        </div>
        <div className={styles.grid}>
          {featured.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>
    </>
  );
}
