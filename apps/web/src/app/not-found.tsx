import type { Metadata } from 'next';
import Link from 'next/link';
import { T } from '@/lib/i18n/T';
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
 *
 * Its four strings go through `<T>` (#220) — a player who chose another language and then
 * mistyped an address should not be answered in English. The `404` above the heading does
 * not: it is a number, it is `aria-hidden`, and it is the same number in every language.
 * The `title` in `metadata` stays English with the rest of this site's metadata.
 */
/**
 * No canonical on the page that says a page does not exist (#201).
 *
 * The root layout gives every route a relative canonical that Next resolves against the
 * page being rendered, and for this one that resolved to `/_not-found/` — an address the
 * export never serves. A canonical pointing at a 404 is a claim about the wrong thing, and
 * `scripts/check-canonicals.mjs` holds every exported page to a canonical that exists.
 * `null` here overrides the inherited value rather than merging with it.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <div className="db-wrap">
      <div className={styles.panel}>
        <p className={styles.code} aria-hidden="true">
          404
        </p>
        <h1 className={styles.title}>
          <T id="That page is not here" />
        </h1>
        <p className={styles.body}>
          <T id="The address may have a typo in it, or the page may have moved since something linked to it. Nothing is lost — every game in the catalogue is one press away." />
        </p>
        <div className={styles.actions}>
          <Link href="/games/" className={styles.primary}>
            <T id="All games" />
          </Link>
          <Link href="/how-to-play/" className={styles.secondary}>
            <T id="How to play" />
          </Link>
        </div>
      </div>
    </div>
  );
}
