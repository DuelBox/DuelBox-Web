import Link from 'next/link';
import styles from './SiteFooter.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`db-wrap ${styles.inner}`}>
        <p className={styles.line}>
          DuelBox — 108 games for two players. Runs in your browser; nothing to install.
        </p>
        <nav className={styles.links} aria-label="Footer">
          <Link href="/how-to-play/">How to play</Link>
          <Link href="/privacy/">Privacy</Link>
          <Link href="/terms/">Terms of use</Link>
        </nav>
      </div>
    </footer>
  );
}
