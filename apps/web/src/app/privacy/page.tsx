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
        <p className={styles.updated}>Last updated 29 August 2026</p>
      </header>

      <div className={styles.prose}>
        <p className={styles.lead}>
          DuelBox collects nothing about you. There is no account to create, no analytics, no
          advertising and no tracking of any kind.
        </p>

        <h2>What we collect</h2>
        <p>
          Nothing. We have no server that receives anything from you while you play, so there is no
          data for us to hold, lose or be asked for.
        </p>

        <h2>What stays on your device</h2>
        <p>
          Your settings are kept in your browser&apos;s own storage on the device you played on:
          which mode you last chose, the bot difficulty and how many rounds. No scores, no names and
          no times are stored anywhere, by us or by your browser.
        </p>
        <p>
          Your browser also keeps a copy of the site itself, and of each game as you play it, so
          that everything you have opened still works with no connection. Those copies are files you
          already downloaded, held on your device and read from there. Clearing your browser&apos;s
          site data removes all of it, and nothing else remembers any of it.
        </p>

        <h2>Cookies</h2>
        <p>We do not set any cookies.</p>

        <h2>How the site is delivered</h2>
        <p>
          The pages and games are static files, served by GitHub Pages. Your browser downloads them
          the same way it downloads any web page, and GitHub keeps its own ordinary server logs —
          the sort every web host keeps, holding an address, a browser name and a path — which are
          outside our control and are not used by us to identify or profile anyone. That is the only
          place a byte about your visit goes anywhere.
        </p>
        <p>
          After the first visit your browser has the site saved, so it opens and plays with no
          connection at all — including a game you have played before, on a device that has been
          switched off since. A game you have never opened is not on your device yet and will say so
          rather than pretending. Nothing is fetched to make that work beyond the files the page
          itself asked for.
        </p>

        <h2>Children</h2>
        <p>
          The games are suitable for all ages. Since we collect no personal information from anyone,
          we collect none from children either.
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
