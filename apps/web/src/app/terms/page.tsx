import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The short version: play the games, have fun, expect nothing to be perfect.',
};

export default function TermsPage() {
  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>Terms of use</h1>
        <p className={styles.updated}>Last updated 20 August 2026</p>
      </header>

      <div className={styles.prose}>
        <p className={styles.lead}>
          Play the games. There is no account, no payment and nothing to agree to beyond the
          obvious.
        </p>

        <h2>Using DuelBox</h2>
        <p>
          You may play the games here for free, for as long as you like, on any device. You may not
          misrepresent the site as your own, or redistribute its code or artwork as if it were.
        </p>

        <h2>What we promise</h2>
        <p>
          Very little, honestly. The site is provided as it is, without warranty. Games may have
          bugs, may change, and may occasionally be taken away and rewritten. Nothing here is fit
          for any particular purpose beyond passing ten minutes with somebody.
        </p>

        <h2>Our games are our own</h2>
        <p>
          The rules of Checkers, Reversi and Tic Tac Toe belong to nobody, and that is exactly why
          we can build them. Game <em>mechanics</em> are not protected and never have been. The
          code, artwork, names and layouts here are ours, written from scratch, and are not copied
          from any other product.
        </p>

        <h2>Your data</h2>
        <p>
          We do not have any. See <Link href="/privacy/">Privacy</Link>, which is short for the same
          reason.
        </p>

        <h2>Getting in touch</h2>
        <p>
          Problems and suggestions are welcome through the project&apos;s issue tracker, which is
          where all of the work on DuelBox happens in the open.
        </p>
      </div>
    </div>
  );
}
