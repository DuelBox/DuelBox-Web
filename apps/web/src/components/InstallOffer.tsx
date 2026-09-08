'use client';

import type { BeforeInstallPromptEvent } from '@/lib/install-prompt-key';
import type * as InstallStore from '@/lib/install-prompt';
import styles from './ServiceWorkerBridge.module.css';

const INSTALL_NOTICE =
  'Keep DuelBox on your home screen? It opens straight to the games, offline too.';
const INSTALL_LABEL = 'Add it';
const NOT_NOW_LABEL = 'Not now';

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
      <span>{INSTALL_NOTICE}</span>
      <button type="button" className={`db-net-do ${styles.reload}`} onClick={ask}>
        {INSTALL_LABEL}
      </button>
      <button
        type="button"
        className={`db-net-do ${styles.reload} ${styles.quiet}`}
        onClick={notNow}
      >
        {NOT_NOW_LABEL}
      </button>
    </>
  );
}
