import type { Metadata } from 'next';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'DuelBox collects nothing. No accounts, no analytics, no cookies, no network.',
};

/**
 * A privacy page that can be short because the architecture made it short.
 *
 * Every claim here is a property the build enforces rather than a promise: the zero-cost
 * guard fails the build if gameplay touches the network or a server runtime appears, and
 * the bundle scan fails it if a credential-shaped string reaches shipped output. It is a
 * description of the product, not an undertaking about it.
 */
export default function PrivacyPage() {
  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>Privacy</h1>
        <p className={styles.updated}>Last updated 20 August 2026</p>
      </header>

      <div className={styles.prose}>
        <p className={styles.lead}>
          DuelBox collects nothing about you. There is no account to create, no analytics, no
          advertising and no tracking of any kind.
        </p>

        <h2>What we collect</h2>
        <p>
          Nothing. We have no server that receives anything from you while you play, so there is
          no data for us to hold, lose or be asked for.
        </p>

        <h2>What stays on your device</h2>
        <p>
          Scores and settings are kept in your browser&apos;s own storage on the device you played
          on. They are never sent anywhere. Clearing your browser&apos;s site data removes them,
          and nothing else remembers them.
        </p>

        <h2>Cookies</h2>
        <p>We do not set any cookies.</p>

        <h2>How the site is delivered</h2>
        <p>
          The pages and games are static files. Your browser downloads them from a content
          delivery network the same way it downloads any web page, and that network keeps its own
          ordinary server logs — the sort every web host keeps — which are outside our control and
          are not used to identify or profile anyone. Once a game has loaded it runs entirely on
          your device and works with no connection at all.
        </p>

        <h2>Children</h2>
        <p>
          The games are suitable for all ages. Since we collect no personal information from
          anyone, we collect none from children either.
        </p>

        <h2>Changes</h2>
        <p>
          If this ever changes it will change here first, with the date above updated. It will not
          change quietly.
        </p>
      </div>
    </div>
  );
}
