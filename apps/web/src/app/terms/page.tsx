import type { Metadata } from 'next';
import Link from 'next/link';
import { T } from '@/lib/i18n/T';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The short version: play the games, have fun, expect nothing to be perfect.',
};

/**
 * The terms page, in the player's language (#220).
 *
 * A server component, so every string goes through `<T>` rather than `t()` — the English is
 * serialised into the route payload and rendered into the HTML exactly as the literal was, and
 * the catalogue lookup happens on the client. The two sentences with markup inside them keep
 * their markup as a value, so a translator gets the whole sentence and decides where the link
 * and the emphasis sit in it. `metadata` stays English for the reason `docs/i18n.md` gives.
 */
export default function TermsPage() {
  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>
          <T id="Terms of use" />
        </h1>
        <p className={styles.updated}>
          <T id="Last updated 20 August 2026" />
        </p>
      </header>

      <div className={styles.prose}>
        <p className={styles.lead}>
          <T id="Play the games. There is no account, no payment and nothing to agree to beyond the obvious." />
        </p>

        <h2>
          <T id="Using DuelBox" />
        </h2>
        <p>
          <T id="You may play the games here for free, for as long as you like, on any device. You may not misrepresent the site as your own, or redistribute its code or artwork as if it were." />
        </p>

        <h2>
          <T id="What we promise" />
        </h2>
        <p>
          <T id="Very little, honestly. The site is provided as it is, without warranty. Games may have bugs, may change, and may occasionally be taken away and rewritten. Nothing here is fit for any particular purpose beyond passing ten minutes with somebody." />
        </p>

        <h2>
          <T id="Our games are our own" />
        </h2>
        <p>
          <T
            id="The rules of Checkers, Reversi and Tic Tac Toe belong to nobody, and that is exactly why we can build them. Game {mechanics} are not protected and never have been. The code, artwork, names and layouts here are ours, written from scratch, and are not copied from any other product."
            values={{
              mechanics: (
                <em>
                  <T id="mechanics" />
                </em>
              ),
            }}
          />
        </p>

        <h2>
          <T id="Your data" />
        </h2>
        <p>
          <T
            id="We do not have any. See {privacy}, which is short for the same reason."
            values={{
              privacy: (
                <Link href="/privacy/">
                  <T id="Privacy" />
                </Link>
              ),
            }}
          />
        </p>

        <h2>
          <T id="Getting in touch" />
        </h2>
        <p>
          <T id="Problems and suggestions are welcome through the project's issue tracker, which is where all of the work on DuelBox happens in the open." />
        </p>
      </div>
    </div>
  );
}
