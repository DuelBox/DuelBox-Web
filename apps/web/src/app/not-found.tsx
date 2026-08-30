import Link from 'next/link';
import styles from './not-found.module.css';

/**
 * The 404 page.
 *
 * There was none, so every wrong address in the product — a renamed slug, a typo, a stale
 * link from somewhere else — was answered by Next's built-in default: black Helvetica on
 * white, no header, no footer, no way onward except the back button (#2513). A static
 * export serves this as `out/404.html`, which is the file GitHub Pages reaches for, so it
 * covers unknown game slugs as well as unknown routes.
 *
 * It offers the two destinations that are always the right answer here rather than trying
 * to guess what was meant: a wrong slug is not a search query, and a page that pretends to
 * know what you wanted is worse than one that admits it does not.
 */
export default function NotFound() {
  return (
    <div className="db-wrap">
      <div className={styles.panel}>
        <p className={styles.code} aria-hidden="true">
          404
        </p>
        <h1 className={styles.title}>That page is not here</h1>
        <p className={styles.body}>
          The address may have a typo in it, or the page may have moved since something linked to
          it. Nothing is lost — every game in the catalogue is one press away.
        </p>
        <div className={styles.actions}>
          <Link href="/games/" className={styles.primary}>
            All games
          </Link>
          <Link href="/how-to-play/" className={styles.secondary}>
            How to play
          </Link>
        </div>
      </div>
    </div>
  );
}
