import Link from 'next/link';
import { CATEGORY_HUBS } from '@/lib/categories';
import { T } from '@/lib/i18n/T';
import styles from './SiteFooter.module.css';

/**
 * The six largest category hubs, linked from the footer of every page (#200).
 *
 * A hub that only the sitemap knows about is a page a crawler reaches once and a reader
 * never does. Six rather than eighteen because a footer is navigation, not a directory —
 * and `CATEGORY_HUBS` is ordered by how many games the category holds, so these six are the
 * ones with the most behind them and the remaining twelve are one link further away,
 * through the heading above the games list on any page of a game in that category.
 *
 * Not through the catalogue: `/games/` groups by category but its chips are filter buttons
 * and its group headings are plain text, so it links no hub at all. This note used to say
 * otherwise, which is how four single-game categories came to have a hub with no inbound
 * link anywhere — a claimed second route is worse than no second route, because nobody
 * checks a route the comment says exists. `lib/categories.test.ts` now counts the link
 * sites rather than trusting this paragraph.
 *
 * Every word below goes through `<T>` (#220), the six category names included: a category
 * name is data, so it is registered in `lib/i18n/sources.ts` rather than extracted from a
 * call site, and it is registered once for all four places the site renders one — these
 * links, the catalogue's chips and group headings, a hub's crumb and heading, and the line
 * under a game's name on its card. The two `aria-label`s are the exception and stay English
 * for the reason `SiteHeader.tsx` sets out: an attribute cannot render an element, and this
 * footer is in the root layout, where a client boundary is paid in all 108 play payloads.
 */
const FOOTER_HUBS = CATEGORY_HUBS.slice(0, 6);

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`db-wrap ${styles.inner}`}>
        <p className={styles.line}>
          <T id="DuelBox — 108 games for two players. Runs in your browser; nothing to install." />
        </p>
        {/* eslint-disable-next-line duelbox/no-untranslated-text -- a landmark name is an
            attribute, and this file is in the root layout; see the note above. */}
        <nav className={styles.links} aria-label="Footer">
          <Link href="/how-to-play/">
            <T id="How to play" />
          </Link>
          <Link href="/settings/">
            <T id="Settings" />
          </Link>
          <Link href="/privacy/">
            <T id="Privacy" />
          </Link>
          <Link href="/terms/">
            <T id="Terms of use" />
          </Link>
          <Link href="/attribution/">
            <T id="Attribution" />
          </Link>
          <Link href="/dmca/">
            <T id="DMCA" />
          </Link>
          {/*
            Report a bug (#233): opens the GitHub new-issue form pre-selected to the bug
            template, which already requires the game, seat, input family, device and viewport —
            so a report arrives with the context a game bug needs.

            The template's field ids (`game`, `device`, `size`) can be pre-filled from the URL:
            `?template=bug.yml&game=<slug>&device=<userAgent>&size=<w>x<h>`. This footer is a
            server component rendered identically on every page, so it cannot know the current
            game slug, viewport or user-agent — those are client-only. Filling them in is a small
            client enhancement (a `'use client'` link, or the same link placed in the pause/result
            overlay where the slug is already known); it is intentionally left to that surface
            rather than converting this shared footer to a client component. The static link below
            still lands the reporter on the right form with the right required fields.
          */}
          <a
            href="https://github.com/DuelBox/DuelBox-Web/issues/new?template=bug.yml"
            rel="noopener noreferrer"
            target="_blank"
          >
            <T id="Report a bug" />
          </a>
        </nav>
        {/* eslint-disable-next-line duelbox/no-untranslated-text -- as above. */}
        <nav className={styles.hubs} aria-label="Game categories">
          {FOOTER_HUBS.map((hub) => (
            <Link key={hub.slug} href={`/games/category/${hub.slug}/`}>
              <T id={hub.category} />
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
