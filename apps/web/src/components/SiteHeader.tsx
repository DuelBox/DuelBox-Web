import Link from 'next/link';
import { PLAYABLE } from '@/data/registry';
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
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`db-wrap ${styles.inner}`}>
        <Link href="/" className={styles.brand} aria-label="DuelBox home">
          <Wordmark />
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <Link href="/games/">Games</Link>
          <Link href="/how-to-play/">How to play</Link>
        </nav>
        {/* Buttons, and outside the nav, deliberately: the smoke test walks every link
            inside a nav and expects a page behind it, and neither the random game (#163)
            nor the mute (#171) is a page. */}
        <div className={styles.tools}>
          <QuickPlay slugs={PLAYABLE} className={styles.quick} />
          <SoundToggle className={styles.sound} />
          <Link href="/games/" className={styles.cta}>
            Play now
          </Link>
        </div>
      </div>
    </header>
  );
}
