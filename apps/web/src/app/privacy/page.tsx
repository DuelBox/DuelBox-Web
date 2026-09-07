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
 * description of the product, not an undertaking about it. `privacy-claims.test.ts` reads
 * this page against the code it describes, so a claim here that stops being true fails a
 * test rather than merely misleading a reader.
 *
 * Three of those claims were once not descriptions of anything (#2513), each wrong in the
 * direction of claiming *more* than the product then did. Two are now true because the code
 * caught up rather than because the prose was trimmed:
 *
 * - **"Scores and settings"**. Nothing stores a score. Exactly two modules write to
 *   `localStorage`: `lib/last-mode.ts` (`duelbox:last-mode`, the mode, bot tier and match
 *   length last chosen per game) and `lib/sound-preference.ts` (`duelbox:sound`, mute and
 *   volume). Neither writes a result of any match.
 * - **"works with no connection at all"**. Once an overstatement — a page already open kept
 *   working, but a reload with the network down failed because there was no service worker
 *   (#2445). One now ships (`public/sw.js`), so the site and every game already opened work
 *   offline, and the paragraphs below describe that cache rather than promise a backlog item.
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
        <p className={styles.updated}>Last updated 7 September 2026</p>
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
          A couple of small settings, kept in your browser&apos;s own storage on the device you
          played on: what you last chose for each game — whether you played a friend or a bot, how
          hard the bot tries, and how many rounds make a match — and whether sound is muted and how
          loud it is. Reopening a game offers you the same setup rather than starting from the
          defaults every time.
        </p>
        <p>
          Scores are not part of it. No result of any match is written down anywhere, on your device
          or ours — a running tally is held in memory while you play and is gone when you close the
          tab.
        </p>
        <p>
          Your browser also keeps a copy of the site itself, and of each game as you play it, so
          that everything you have opened still works with no connection. Those copies are files you
          already downloaded, held on your device and read from there. Clearing your browser&apos;s
          site data removes all of it — your settings included — and nothing else remembers any of
          it.
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
