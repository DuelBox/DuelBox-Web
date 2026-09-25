'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { t } from '@/lib/i18n/messages';
import { useMessages } from '@/lib/i18n/use-messages';
import { T } from '@/lib/i18n/T';
import styles from './not-found.module.css';

/**
 * The error boundary, and the other half of #2513's "every 404 is Next's unstyled default".
 *
 * A route that throws used to land on the same black-Helvetica page a wrong address did —
 * no header, no footer, no way onward, and no hint that the match you were in is
 * recoverable. This is the same panel the 404 uses, deliberately: two different failures
 * should not teach a player two different visual languages for "something went wrong".
 *
 * `reset()` is what makes this an error *boundary* rather than an error *page*. Next
 * re-renders the segment in place, so a transient failure — a chunk that did not arrive, a
 * game module that threw once on load — costs a button press rather than a full reload,
 * which is what #92 asks for.
 *
 * **Nothing is reported anywhere, on purpose.** #92's third action item is "report errors to
 * tracking", and this product has no tracking to report to: the privacy page says so, the
 * CSP's `connect-src` is `'self'`, and `check-zero-cost` fails the build if a beacon
 * appears. Sending errors off-device would contradict all three. The digest below is the
 * honest substitute — it is the same identifier the server-side render logged, so a person
 * can quote it without us collecting anything.
 *
 * The digest line is a `<T>` rather than a `t()` because the code is a `<code>` element inside
 * the sentence, and a translator has to be able to move it (#220). The digest itself is not
 * copy: it is an identifier, and it is passed as a value.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const messages = useMessages();

  useEffect(() => {
    // The console is the only sink this site has. It reaches a developer with the page open
    // and nobody else, which is the correct audience for a stack trace.
    console.error('[duelbox] route error', error);
  }, [error]);

  return (
    <div className="db-wrap">
      <div className={styles.panel}>
        <p className={styles.code} aria-hidden="true">
          !
        </p>
        <h1 className={styles.title}>{t(messages, 'Something went wrong here')}</h1>
        <p className={styles.body}>
          {t(
            messages,
            'This page stopped part-way. It is usually momentary — trying again reloads just this part, not the whole site, and nothing about your games is stored anywhere to lose.',
          )}
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={reset} className={styles.primary}>
            {t(messages, 'Try again')}
          </button>
          <Link href="/games/" className={styles.secondary}>
            {t(messages, 'All games')}
          </Link>
        </div>
        {error.digest !== undefined && (
          <p className={styles.body}>
            <T
              id="If it keeps happening, this code identifies it: {code}"
              values={{ code: <code>{error.digest}</code> }}
            />
          </p>
        )}
      </div>
    </div>
  );
}
