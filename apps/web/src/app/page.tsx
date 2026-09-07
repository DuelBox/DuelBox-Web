import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { CATEGORY_HUBS } from '@/lib/categories';
import {
  CATEGORIES_SECTION,
  FEATURED_SECTION,
  FREE_SECTION,
  START_SECTION,
  WAYS_SECTION,
  WAYS_TO_PLAY,
  WHAT_SECTION,
  featuredGames,
  gameCount,
  roundSpread,
} from '@/lib/landing';
import { SEAT_CHARACTERS } from '@/lib/seats';
import { GameCard } from '@/components/GameCard';
import { TileSprite } from '@/components/TileSprite';
import styles from './page.module.css';

/**
 * The landing page, and every word of it is in the served HTML (#102, #103).
 *
 * **There is no client component on this route and there must not be one.** The prose below
 * the hero is the product's whole answer to "what is this" for a search engine and for the
 * slice of people who browse with JavaScript off, and it is also the only content the shell
 * budget lets this page have: `size-budget.json` leaves the shell under two kilobytes of
 * headroom, so a section that cost script would be a section paid for by every visitor to
 * every non-play route. Server-rendered markup and CSS are free — `scripts/check-size.mjs`
 * walks JavaScript alone — which means the cheap way to build this page and the correct way
 * are the same way. `lib/landing.test.ts` walks this file's imports transitively and fails
 * on the first one that carries `'use client'`, and `e2e/no-javascript.spec.ts` reads the
 * whole page back with scripting switched off.
 *
 * The copy itself is in `lib/landing.ts`, held to the house voice by its own test, for the
 * reason the category hubs' copy is in `lib/categories.ts`: prose inside a component is
 * prose nothing checks.
 */
export default function HomePage() {
  const featured = featuredGames(
    CATALOGUE,
    CATEGORY_HUBS.map((hub) => hub.category),
  );
  const gamesIn = (category: string) =>
    CATALOGUE.filter((game) => game.category === category).length;

  return (
    <>
      <TileSprite games={featured} />
      <section className={styles.hero}>
        <div className="db-wrap">
          {/* Not "Works offline": there is no service worker, so a page that has not been
              loaded cannot be opened without a connection (#2445). The privacy page made
              the same claim and it was wrong there too (#2513). */}
          <p className={styles.eyebrow}>No download · No account · Runs on your device</p>
          <h1 className={styles.title}>
            {CATALOGUE.length} games
            <br />
            for two players
          </h1>
          {/* The lede said "play from your own device against a friend anywhere", which is
              the one thing on this page a visitor cannot do: the shell offers `friend` and
              `bot` and nothing else, and cross-device play is an engine seam with no
              pairing, no transport and no route behind it. The note on `WAYS_TO_PLAY`
              carries the evidence. */}
          <p className={styles.lede}>
            Share one phone or one laptop, two of you either side of the screen. No opponent around?{' '}
            {SEAT_CHARACTERS.p2} will take the other seat.
          </p>
          <div className={styles.actions}>
            <Link href="/games/" className={styles.primary}>
              Start playing
            </Link>
            {/* Labelled with the heading of the page it opens. It said "How it works",
                which is a fifth name for a page the header, the footer and the guide's own
                h1 all call How to play (#2513). */}
            <Link href="/how-to-play/" className={styles.secondary}>
              How to play
            </Link>
          </div>
        </div>
      </section>

      {/* Named by its own heading rather than by an `aria-label`, which is what it had. The
          three cards were the only thing under the h1 with no heading over them, so the
          page went h1 then nothing until "Popular right now" — the same defect the category
          hub had, fixed the same way, and the accessible name is unchanged because it is
          now the heading's own text. */}
      <section className={`db-wrap ${styles.section}`} aria-labelledby={WAYS_SECTION.id}>
        <h2 id={WAYS_SECTION.id} className={styles.sectionTitle}>
          {WAYS_SECTION.heading}
        </h2>
        {WAYS_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            {text}
          </p>
        ))}
        <div className={styles.ways}>
          {WAYS_TO_PLAY.map((way) => (
            <article key={way.badge} className={styles.way}>
              {/* The numeral is the label; the tint behind it comes from the stylesheet's
                  own `:nth-child`, so the copy module carries no colours and this page
                  carries no inline style. It used to hand each card a `tint` and an `ink`,
                  and one of the three inks was a raw hex — invisible to
                  `styles/tokens.test.ts`, which reads stylesheets. */}
              <span className={styles.badge} aria-hidden="true">
                {way.badge}
              </span>
              {/* A `div` and a `p`, not the `span` and `span` this was: a heading is flow
                  content and cannot live inside phrasing content, and the body is a
                  sentence. */}
              <div>
                <h3 className={styles.wayTitle}>{way.title}</h3>
                <p className={styles.wayBody}>{way.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`db-wrap ${styles.section}`} aria-labelledby={FEATURED_SECTION.id}>
        <div className={styles.sectionHead}>
          <h2 id={FEATURED_SECTION.id} className={styles.sectionTitle}>
            {FEATURED_SECTION.heading}
          </h2>
          <Link href="/games/">See all {CATALOGUE.length} →</Link>
        </div>
        {FEATURED_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            {text}
          </p>
        ))}
        <div className={styles.grid}>
          {featured.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      <section className={`db-wrap ${styles.section}`} aria-labelledby={WHAT_SECTION.id}>
        <h2 id={WHAT_SECTION.id} className={styles.sectionTitle}>
          {WHAT_SECTION.heading}
        </h2>
        {WHAT_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            {text}
          </p>
        ))}
        {/* From the catalogue's own `roundSeconds` rather than from a sentence somebody
            wrote once: the shortest game and the longest are both facts a new game can
            change, and a line that goes stale is worse than no line. */}
        <p className={styles.prose}>{roundSpread(CATALOGUE)}</p>
      </section>

      <section className={`db-wrap ${styles.section}`} aria-labelledby={FREE_SECTION.id}>
        <h2 id={FREE_SECTION.id} className={styles.sectionTitle}>
          {FREE_SECTION.heading}
        </h2>
        {FREE_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            {text}
          </p>
        ))}
      </section>

      {/*
        All eighteen hubs, from the page most people arrive on.

        The footer carries the six largest on every page and a game page links its own, which
        left the other twelve reachable only by first opening a game in them. A crawler that
        arrives at `/` and reads one page can now see the whole shelf.

        A list rather than a `<nav>`, deliberately: the footer already has a navigation
        landmark named "Game categories", and a second landmark with the same role and the
        same name is what axe's `landmark-unique` rule fires on. It would also add eighteen
        links to the walk `e2e/smoke.spec.ts` does over every nav on the page.
      */}
      <section className={`db-wrap ${styles.section}`} aria-labelledby={CATEGORIES_SECTION.id}>
        <h2 id={CATEGORIES_SECTION.id} className={styles.sectionTitle}>
          {CATEGORIES_SECTION.heading}
        </h2>
        {CATEGORIES_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            {text}
          </p>
        ))}
        <ul className={styles.categories}>
          {CATEGORY_HUBS.map((hub) => (
            <li key={hub.slug}>
              <Link href={`/games/category/${hub.slug}/`} className={styles.category}>
                {hub.category}
                <span className={styles.categoryCount}>{gameCount(gamesIn(hub.category))}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={`db-wrap ${styles.section}`} aria-labelledby={START_SECTION.id}>
        <h2 id={START_SECTION.id} className={styles.sectionTitle}>
          {START_SECTION.heading}
        </h2>
        {START_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            {text}
          </p>
        ))}
        {/* Not a second "Start playing": `e2e/smoke.spec.ts` reaches the catalogue by that
            exact name, and a strict locator that matches two links fails rather than picks
            one. The catalogue's own count is the more useful label here anyway. */}
        <div className={styles.actions}>
          <Link href="/games/" className={styles.primary}>
            Browse all {CATALOGUE.length} games
          </Link>
          <Link href="/how-to-play/" className={styles.secondary}>
            How to play
          </Link>
        </div>
      </section>
    </>
  );
}
