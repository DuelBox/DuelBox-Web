import type { Metadata } from 'next';
import { SettingsPanel } from '@/components/SettingsPanel';
import { T } from '@/lib/i18n/T';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Settings',
  description:
    'Sound, volume and vibration, and everything DuelBox keeps on this device — exported, imported or erased in one press.',
};

/**
 * The one page whose controls outlive a match (#91).
 *
 * Everything on it writes to the browser's own storage and nowhere else, which is what
 * lets it offer to export and erase that data: there is no other copy, so a file the
 * player carries to another device is the whole story of moving house (#2448).
 *
 * Server rendered like every other page, with the panel as the client half. The panel
 * reads storage only once mounted, so the HTML the build machine writes and the browser's
 * first paint agree on the defaults, and the stored values replace them a frame later —
 * the pattern `PlaySurface.tsx` sets for the remembered setup.
 *
 * The heading and the lede go through `<T>` (#219), and this page is the one that proves what
 * that costs a server component: nothing on any script budget. `lib/i18n/T.tsx` explains the
 * mechanism; the check is that the lede's English appears in this route's exported HTML and
 * route payload and in no chunk under `_next/static`. The `metadata` above stays English on
 * purpose — it is read by crawlers and link unfurlers, which render no client component, and
 * `docs/i18n.md` lists it with the other things deliberately not translated. This file is in
 * `I18N_CLEAN` in `eslint.config.js`, so a bare literal added to its JSX fails lint.
 */
export default function SettingsPage() {
  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>
          <T id="Settings" />
        </h1>
        <p className={styles.lede}>
          <T id="Sound, vibration, and what this device remembers about how you play. Every change applies straight away and is kept in this browser only — nothing here is sent anywhere." />
        </p>
      </header>
      <SettingsPanel />
    </div>
  );
}
