import Link from 'next/link';
import { Wordmark } from './Wordmark';
import styles from './SiteHeader.module.css';

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`db-wrap ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="DuelBox home">
          <Wordmark />
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/games/">Games</Link>
          <Link href="/tournament/">Tournament</Link>
          <Link href="/how-to-play/">How to play</Link>
        </nav>
        <Link href="/games/" className={styles.cta}>
          Play now
        </Link>
      </div>
    </header>
  );
}
