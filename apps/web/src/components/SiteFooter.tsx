import Link from 'next/link';
import { CATEGORY_HUBS } from '@/lib/categories';
import styles from './SiteFooter.module.css';

/**
 * The six largest category hubs, linked from the footer of every page (#200).
 *
 * A hub that only the sitemap knows about is a page a crawler reaches once and a reader
 * never does. Six rather than eighteen because a footer is navigation, not a directory —
 * and `CATEGORY_HUBS` is ordered by how many games the category holds, so these six are the
 * ones with the most behind them and the remaining twelve are one link further away,
 * through the heading above the games list on any page of a game in that category.
 *
 * Not through the catalogue: `/games/` groups by category but its chips are filter buttons
 * and its group headings are plain text, so it links no hub at all. This note used to say
 * otherwise, which is how four single-game categories came to have a hub with no inbound
 * link anywhere — a claimed second route is worse than no second route, because nobody
 * checks a route the comment says exists. `lib/categories.test.ts` now counts the link
 * sites rather than trusting this paragraph.
 */
const FOOTER_HUBS = CATEGORY_HUBS.slice(0, 6);

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`db-wrap ${styles.inner}`}>
        <p className={styles.line}>
          DuelBox — 108 games for two players. Runs in your browser; nothing to install.
        </p>
        <nav className={styles.links} aria-label="Footer">
          <Link href="/how-to-play/">How to play</Link>
          <Link href="/settings/">Settings</Link>
          <Link href="/privacy/">Privacy</Link>
          <Link href="/terms/">Terms of use</Link>
        </nav>
        <nav className={styles.hubs} aria-label="Game categories">
          {FOOTER_HUBS.map((hub) => (
            <Link key={hub.slug} href={`/games/category/${hub.slug}/`}>
              {hub.category}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
