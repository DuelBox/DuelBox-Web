import type { Metadata } from 'next';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'DuelBox collects nothing. No accounts, no analytics, no cookies, no server.',
};

/**
 * A privacy page that can be short because the architecture made it short.
 *
 * Every claim here is a property the build enforces rather than a promise: the zero-cost
 * guard fails the build if gameplay touches the network or a server runtime appears, and
 * the bundle scan fails it if a credential-shaped string reaches shipped output. It is a
 * description of the product, not an undertaking about it.
 *
 * Three of those claims were not descriptions of anything (#2513), and each was wrong in
 * the direction of claiming *more* than the product does:
 *
 * - **"Scores and settings"**. Nothing stores a score. `lib/last-mode.ts` writes one key,
 *   `duelbox:last-mode`, holding the mode, bot tier and match length last chosen per game,
 *   and there is no other call to `localStorage` in the product.
 * - **"works with no connection at all"**. True of a page already open, and only that:
 *   there is no service worker, so a reload with the network down fails (#2445). A privacy
 *   page is the wrong place to promise a feature that is on the backlog.
 * - **"a content delivery network"**. It is GitHub Pages. Naming the host is the whole
 *   value of the paragraph — a reader deciding whether to trust it needs to know whose
 *   logs their request lands in, and "a content delivery network" names nobody.
 *
 * An overstatement is a smaller failure than an understatement here, and it is still a
 * privacy page saying something untrue about what it keeps.
 */
export default function PrivacyPage() {
  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>Privacy</h1>
        <p className={styles.updated}>Last updated 30 August 2026</p>
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
          One thing: what you last chose for each game — whether you played a friend or a bot, how
          hard the bot tries, and how many rounds make a match. It is kept in your browser&apos;s
          own storage under a single key, so that reopening a game offers you the same setup rather
          than starting from the defaults every time.
        </p>
        <p>
          Scores are not part of it. No result of any match is written down anywhere, on your device
          or ours — a running tally is held in memory while you play and is gone when you close the
          tab. Clearing your browser&apos;s site data removes the setup too, and nothing else
          remembers it.
        </p>

        <h2>Cookies</h2>
        <p>We do not set any cookies.</p>

        <h2>How the site is delivered</h2>
        <p>
          The pages and games are static files, hosted on GitHub Pages. Your browser downloads them
          from GitHub the same way it downloads any web page, and GitHub keeps its own ordinary
          server logs — the sort every web host keeps — which are outside our control and are not
          used by us to identify or profile anyone.
        </p>
        <p>
          Once a page has loaded, playing it needs nothing further from the network: the game, the
          bot and the physics all run on your device. That is not the same as working offline. There
          is no offline cache yet, so reloading the page or opening it fresh does need a connection.
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
