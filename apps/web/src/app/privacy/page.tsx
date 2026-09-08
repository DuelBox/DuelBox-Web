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
 * - **"Scores and settings"**. Nothing stores a score. At the time there was one key,
 *   `duelbox:last-mode`, holding the mode, bot tier and match length last chosen per game.
 *   There are now seven — the setup, favourites, recent games, settings, the head-to-head
 *   record, the two names and a tournament in progress — and every one of them is written
 *   through `lib/local-store.ts`, the only module in the product that calls `localStorage`.
 *
 *   The section below lists all seven, and it fell behind at six the day the tournament
 *   (#157) added the seventh: `privacy-claims.test.ts` was watching the *funnel*, so a new
 *   store built on `local-store.ts` — which is every store, by construction — arrived
 *   without disturbing it, and the docstring here went on saying the list could not fall
 *   behind quietly. It now counts the items against `PLAYER_DATA_KEYS`, which is the same
 *   list export, import and erase walk, so a key that travels in an export and is not named
 *   here fails on every push. That is CLAUDE.md's tenth entry.
 *
 *   The head-to-head (#160, #162) is the one to read carefully, because it is the closest
 *   the product has come to keeping a result: it is a count of matches won, lost and drawn
 *   per game, and it is still not a score. No match's score, no date, no opponent and no
 *   individual result is written down — a tally of six wins does not say which six, or
 *   when, or by how much. The sentence below says so, and it is a description of
 *   `lib/head-to-head.ts` rather than a promise about it.
 * - **"works with no connection at all"**. When this was written it was true of a page
 *   already open and only that: there was no service worker, so a reload with the network
 *   down failed (#2445), and a privacy page is the wrong place to promise a feature that is
 *   on the backlog. The worker was built (#192), so the claim is now available — but it is
 *   still not the claim this page makes, because it is not true of every visitor: a game
 *   this device has never opened needs a connection. What the page says instead is what the
 *   cache actually holds, which is the only part of it a privacy page is really about.
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
        <p className={styles.updated}>Last updated 6 September 2026</p>
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
          Eight things, all kept in your browser&apos;s own storage under keys that start with{' '}
          <code>duelbox:</code>, and none of them ever sent anywhere:
        </p>
        <ul>
          <li>
            What you last chose for each game — whether you played a friend or a bot, how hard the
            bot tries, and how many rounds make a match — so that reopening a game offers you the
            same setup rather than starting from the defaults every time.
          </li>
          <li>The games you have marked as favourites.</li>
          <li>The last eight games you played.</li>
          <li>Your settings: whether sound is muted, the volume, and whether vibration is on.</li>
          <li>
            The head-to-head between the two seats, game by game: how many matches each seat has won
            and how many ended level, counted only when a match is played to the end. The settings
            page shows it and clears it.
          </li>
          <li>
            The two names you type for the seats, if you type any. They are shown on this device and
            never leave it.
          </li>
          <li>
            The keys you have chosen for each seat, if you change them from the defaults. The
            settings page shows them and puts either seat back to its defaults.
          </li>
          <li>
            A tournament you have started, while it lasts: which games were drawn, in what order,
            which side took each one that has been played, and whether you are playing each other or
            a bot. It is written down so that a tournament survives closing the tab — every leg is a
            different page — and it is erased the moment you finish or leave it.
          </li>
        </ul>
        <p>
          Scores are not part of it. No match&apos;s score is written down anywhere, on your device
          or ours — a running tally is held in memory while you play and is gone when you close the
          tab. The head-to-head above is a count of matches, not a record of any of them: it knows
          you have won six and not which six, when, or by how much. A tournament in progress is the
          one thing here that remembers who won a particular game, because a line-up nobody can
          score is not a tournament, and it goes when the tournament does.
        </p>
        <p>
          All of it is yours to move or remove. The settings page lets you export the lot as a file,
          import one you exported before, or erase everything in one press; clearing your
          browser&apos;s site data removes it too, and nothing else remembers it.
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
          bot and the physics all run on your device. Your browser also keeps a copy of the site,
          and of each game after you open it, so a game you have played before opens again with no
          connection at all. That cache holds this site&rsquo;s own files and nothing about you — no
          scores, no names, no identifier — it is never sent anywhere, and clearing your
          browser&rsquo;s site data removes it. A game you have never opened is not saved, and says
          so rather than showing an error.
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
