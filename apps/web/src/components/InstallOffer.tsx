'use client';

import type { BeforeInstallPromptEvent } from '@/lib/install-prompt-key';
import { t } from '@/lib/i18n/messages';
import { useMessages } from '@/lib/i18n/use-messages';
import type * as InstallStore from '@/lib/install-prompt';
import styles from './ServiceWorkerBridge.module.css';

/**
 * The two buttons of the install offer (#195), in a chunk of their own.
 *
 * `ServiceWorkerBridge` is in the root layout, so every byte of it is shell — paid by every
 * visitor on every route — and this offer is only ever shown on a result screen. Rendered
 * through `lazy()` it is an async chunk on the on-demand line instead, which is the budget
 * for code a visitor asked for. Measured with the buttons inline in the bridge: the shell
 * went 310 B over its budget; out here it fits.
 *
 * It renders *inside* the bridge's own `role="status"` bar rather than a bar of its own, so
 * the site keeps its single status region — the constraint `ServiceWorkerBridge.tsx` sets
 * out at length, and one `e2e/settings.spec.ts` and `e2e/record.spec.ts` both depend on.
 *
 * Its three strings were module constants, which is a shape the lint rule cannot see through
 * — `{INSTALL_LABEL}` is an expression to it — and they are `t()` calls at the point of use
 * now (#220). Nothing else imported them.
 */
export default function InstallOffer({
  event,
  store,
  onDone,
}: {
  event: BeforeInstallPromptEvent;
  store: typeof InstallStore;
  onDone: () => void;
}) {
  const messages = useMessages();
  const ask = (): void => {
    void event
      .prompt()
      .then(() => event.userChoice)
      .then(({ outcome }) => {
        if (outcome === 'accepted') store.rememberInstalled();
        else store.rememberDismissed(Date.now());
        onDone();
      });
  };
  const notNow = (): void => {
    store.rememberDismissed(Date.now());
    onDone();
  };
  return (
    <>
      <span>
        {t(
          messages,
          'Keep DuelBox on your home screen? It opens straight to the games, offline too.',
        )}
      </span>
      <button type="button" className={`db-net-do ${styles.reload}`} onClick={ask}>
        {t(messages, 'Add it')}
      </button>
      <button
        type="button"
        className={`db-net-do ${styles.reload} ${styles.quiet}`}
        onClick={notNow}
      >
        {t(messages, 'Not now')}
      </button>
    </>
  );
}
