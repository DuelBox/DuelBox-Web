import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { CATEGORY_HUBS } from '@/lib/categories';
import { MIRROR_CLASS } from '@/lib/icons';
import {
  CATEGORIES_SECTION,
  FEATURED_SECTION,
  FREE_SECTION,
  START_SECTION,
  WAYS_SECTION,
  WAYS_TO_PLAY,
  WHAT_SECTION,
  featuredGames,
  roundSpread,
} from '@/lib/landing';
import { T } from '@/lib/i18n/T';
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
 *
 * ## Every word of it goes through `<T>` (#220), and it is still a server component
 *
 * `<T id="…" />` with no values renders the string itself, so the HTML this page exports in
 * English is byte for byte what it was; the lookup happens in the browser, for a visitor who
 * has chosen another language. The strings that come from `lib/landing.ts` — the six
 * headings, their paragraphs, the three ways to play — arrive here as variables, so they are
 * registered in `lib/i18n/sources.ts` as `landing copy` rather than extracted from a call
 * site, and the same entry carries the sentence `roundSpread` builds out of the catalogue's
 * own round lengths. Category names are registered once, from the catalogue, for all four
 * places the site renders one.
 *
 * Counts are the exception and take a placeholder — `{count} games`, not the rendered
 * `20 games` — because a number is not a word a translator should have to retype for every
 * value it can take. `lib/landing.ts`'s `gameCount` went with the last call site that
 * needed one; `landing.test.ts` records what it held.
 *
 * `T` is a client component, so this page's import graph now contains one — which is
 * exactly what `landing.test.ts`'s server-rendering guard exists to prevent. That test now
 * allows `lib/i18n/*` and nothing else, and says why: the locale provider is mounted in the
 * root layout, so those modules are on every route already and this page adds no chunk of
 * its own by using them. Any other client directive in the graph still fails it.
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
          {/* Still not "Works offline", and the reason has changed rather than gone away.
              There *is* a service worker now (#192), so a game this device has opened before
              does open with no connection — but a game it has never opened does not, and a
              flat "Works offline" on the page every visitor lands on would promise the second
              thing while delivering the first. The catalogue is where the distinction can be
              made per game, in words, and it is made there (#193). This eyebrow keeps to the
              three claims that are true of every visitor without qualification. */}
          <p className={styles.eyebrow}>
            <T id="No download · No account · Runs on your device" />
          </p>
          <h1 className={styles.title}>
            <T id="{count} games" values={{ count: CATALOGUE.length }} />
            <br />
            <T id="for two players" />
          </h1>
          {/* The lede said "play from your own device against a friend anywhere", which is
              the one thing on this page a visitor cannot do: the shell offers `friend` and
              `bot` and nothing else, and cross-device play is an engine seam with no
              pairing, no transport and no route behind it. The note on `WAYS_TO_PLAY`
              carries the evidence. */}
          {/* One sentence with the seat's name in it rather than three fragments: a
              translator needs the whole sentence to put the name where their grammar puts
              it. The name itself is not translated — `Pip` and `Bo` are names, like the
              games' own. */}
          <p className={styles.lede}>
            <T
              id="Share one phone or one laptop, two of you either side of the screen. No opponent around? {seat} will take the other seat."
              values={{ seat: SEAT_CHARACTERS.p2 }}
            />
          </p>
          <div className={styles.actions}>
            <Link href="/games/" className={styles.primary}>
              <T id="Start playing" />
            </Link>
            {/* Labelled with the heading of the page it opens. It said "How it works",
                which is a fifth name for a page the header, the footer and the guide's own
                h1 all call How to play (#2513). */}
            <Link href="/how-to-play/" className={styles.secondary}>
              <T id="How to play" />
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
          <T id={WAYS_SECTION.heading} />
        </h2>
        {WAYS_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            <T id={text} />
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
              <div className={styles.wayText}>
                <h3 className={styles.wayTitle}>
                  <T id={way.title} />
                </h3>
                <p className={styles.wayBody}>
                  <T id={way.body} />
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={`db-wrap ${styles.section}`} aria-labelledby={FEATURED_SECTION.id}>
        <div className={styles.sectionHead}>
          <h2 id={FEATURED_SECTION.id} className={styles.sectionTitle}>
            <T id={FEATURED_SECTION.heading} />
          </h2>
          <Link href="/games/">
            <T id="See all {count}" values={{ count: CATALOGUE.length }} />
            {/* A text arrow, not an `<Icon name="forward" />`: the sprite is not mounted in
                the layout (#74) and mounting it here alone would put fourteen symbols in the
                document every visitor loads for one glyph. U+2192 is not Bidi_Mirrored, so
                under `dir="rtl"` it would keep pointing right — towards the *start* of the
                line — and the class is what turns it round (#222): `globals.css` scales
                `MIRROR_CLASS` by `--db-inline-sign`. The link is `inline-flex`, so the span
                is a flex item and the space between the words and it is the `gap` in
                page.module.css. Hidden from assistive technology because the link's words
                already say where it goes; "rightwards arrow" read aloud after them is noise. */}
            <span className={MIRROR_CLASS} aria-hidden="true">
              →
            </span>
          </Link>
        </div>
        {FEATURED_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            <T id={text} />
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
          <T id={WHAT_SECTION.heading} />
        </h2>
        {WHAT_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            <T id={text} />
          </p>
        ))}
        {/* From the catalogue's own `roundSeconds` rather than from a sentence somebody
            wrote once: the shortest game and the longest are both facts a new game can
            change, and a line that goes stale is worse than no line. */}
        <p className={styles.prose}>
          <T id={roundSpread(CATALOGUE)} />
        </p>
      </section>

      <section className={`db-wrap ${styles.section}`} aria-labelledby={FREE_SECTION.id}>
        <h2 id={FREE_SECTION.id} className={styles.sectionTitle}>
          <T id={FREE_SECTION.heading} />
        </h2>
        {FREE_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            <T id={text} />
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
          <T id={CATEGORIES_SECTION.heading} />
        </h2>
        {CATEGORIES_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            <T id={text} />
          </p>
        ))}
        <ul className={styles.categories}>
          {CATEGORY_HUBS.map((hub) => (
            <li key={hub.slug}>
              <Link href={`/games/category/${hub.slug}/`} className={styles.category}>
                <T id={hub.category} />
                <span className={styles.categoryCount}>
                  <T
                    id={gamesIn(hub.category) === 1 ? '{count} game' : '{count} games'}
                    values={{ count: gamesIn(hub.category) }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={`db-wrap ${styles.section}`} aria-labelledby={START_SECTION.id}>
        <h2 id={START_SECTION.id} className={styles.sectionTitle}>
          <T id={START_SECTION.heading} />
        </h2>
        {START_SECTION.paragraphs.map((text) => (
          <p key={text} className={styles.prose}>
            <T id={text} />
          </p>
        ))}
        {/* Not a second "Start playing": `e2e/smoke.spec.ts` reaches the catalogue by that
            exact name, and a strict locator that matches two links fails rather than picks
            one. The catalogue's own count is the more useful label here anyway. */}
        <div className={styles.actions}>
          <Link href="/games/" className={styles.primary}>
            <T id="Browse all {count} games" values={{ count: CATALOGUE.length }} />
          </Link>
          <Link href="/how-to-play/" className={styles.secondary}>
            <T id="How to play" />
          </Link>
        </div>
      </section>
    </>
  );
}
