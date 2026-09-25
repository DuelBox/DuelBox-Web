import Link from 'next/link';
import { PLAYABLE } from '@/data/registry';
import { T } from '@/lib/i18n/T';
import { QuickPlay } from './QuickPlay';
import { SoundToggle } from './SoundToggle';
import { Wordmark } from './Wordmark';
import styles from './SiteHeader.module.css';

/**
 * The header on every page: the brand, the navigation, and the controls that are not
 * navigation.
 *
 * `PLAYABLE` is resolved here, in a server component, and handed down as a plain array:
 * the button that picks a random game needs a list of slugs and nothing else, and the
 * registry — with its loaders for a hundred and eight game chunks — is not something a
 * button in the header should have an opinion about.
 *
 * The three links go through `<T>` (#220), which renders the English string itself when the
 * catalogue is empty, so the served HTML is byte for byte what it was. The two `aria-label`s
 * do not, and cannot: an attribute takes a string, `t()` needs the context only a client
 * component can read, and this header is in the root layout — every element in it is
 * serialised into all 108 play-route payloads, which is the most expensive place in the
 * repository to spend a byte (`size-budget.json`). Lifting the brand link and the nav into
 * client components to translate two landmark names would be paid 108 times over for two
 * words a sighted visitor never sees. They are left in English, named in the pull request,
 * and are the one thing on this file `docs/i18n.md`'s list of untranslated copy does not
 * yet cover.
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`db-wrap ${styles.inner}`}>
        {/* eslint-disable-next-line duelbox/no-untranslated-text -- a server component
            cannot call t(), and a client boundary here is paid in all 108 play payloads;
            see the note above. */}
        <Link href="/" className={styles.brand} aria-label="DuelBox home">
          <Wordmark />
        </Link>
        {/* eslint-disable-next-line duelbox/no-untranslated-text -- as above: the landmark's
            name is an attribute, and this file is in the root layout. */}
        <nav className={styles.nav} aria-label="Main">
          <Link href="/games/">
            <T id="Games" />
          </Link>
          <Link href="/how-to-play/">
            <T id="How to play" />
          </Link>
        </nav>
        {/* Buttons, and outside the nav, deliberately: the smoke test walks every link
            inside a nav and expects a page behind it, and neither the random game (#163)
            nor the mute (#171) is a page. */}
        <div className={styles.tools}>
          <QuickPlay slugs={PLAYABLE} className={styles.quick} />
          <SoundToggle className={styles.sound} />
          <Link href="/games/" className={styles.cta}>
            <T id="Play now" />
          </Link>
        </div>
      </div>
    </header>
  );
}
