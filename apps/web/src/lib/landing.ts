import type { CatalogueEntry } from '../data/catalogue.generated';
import { formatRound } from './format';

/**
 * Everything the landing page says below its hero (#102).
 *
 * The page is not decoration. This is a static export whose entire discovery strategy is
 * server-rendered content — ADR 0001 and PLAN.md both say so in as many words — so what a
 * search engine, and a reader with JavaScript switched off, find here is the whole of what
 * the product has to say for itself before it asks anybody to press anything.
 *
 * The prose lives in a module rather than inside the JSX for the reason the category hubs'
 * does: copy that exists only inside a component is copy no test can hold to a standard,
 * and `lib/categories.ts` beside `lib/categories.test.ts` is the arrangement that already
 * works here. `landing.test.ts` holds every string below to the tables in
 * `lib/house-voice.ts` — the same two tables the catalogue rules and the hub blurbs are
 * held to — and then does the part a voice table cannot: it checks the claims that could
 * quietly stop being true, against the catalogue that would make them false.
 *
 * Nothing here reaches a browser. This module is imported by `app/page.tsx`, which is a
 * server component, so every sentence below is HTML by the time it is served and costs the
 * shell budget nothing. That is a requirement of #102 rather than a happy result, and
 * `landing.test.ts` fails if the landing page grows an import that carries `'use client'`.
 *
 * ## The one thing #102 asks for that is deliberately absent
 *
 * Its second acceptance line asks that the sections "reveal on scroll via
 * IntersectionObserver". They do not. **That line is not met, and the reason is cost rather
 * than impossibility** — this said the two acceptance lines could not both be met, and that
 * was simply untrue. A section rendered visible in the served HTML with an observer adding a
 * reveal class on top satisfies both: the crawler and the JavaScript-off reader are handed
 * finished content, and the observer is pure enhancement. Only the naive form, where the
 * hidden state ships in the HTML, shows anybody an empty box. Written down because an
 * impossibility claim is the sentence a future reader takes as settled, and this one would
 * have closed the question for somebody who came back with the budget to spend.
 *
 * What it costs is the thing to weigh. It would be the first client component on a non-play
 * route added for decoration, and `size-budget.json` leaves the shell under two kilobytes;
 * those bytes are paid by every visitor to every non-play route, for an effect the cascade
 * mostly already gives — `globals.css` animates a page entry in one declaration precisely
 * because it knows a navigation happened and needs no listener told. So it is declined on
 * the budget, which is a decision that can be revisited when the budget changes, and #102
 * should be closed listing this line as not met rather than as met.
 */

/** One section below the hero: the heading a reader sees, and the prose under it. */
export interface LandingSection {
  /**
   * The id its own `<h2>` carries, so the `<section>` is named by the heading rather than
   * by an `aria-label` that can drift away from the words on screen. The category hub
   * learnt this the expensive way: its games grid was named by `aria-label` alone, which
   * left the page with exactly one heading in it.
   */
  readonly id: string;
  readonly heading: string;
  /** The section's own paragraphs, in the order they are read. */
  readonly paragraphs: readonly string[];
}

/** One of the three ways two people actually get a game going. */
export interface LandingWay {
  /** The numeral on the badge. Three alternatives, enumerated, not three steps in order. */
  readonly badge: string;
  readonly title: string;
  readonly body: string;
}

/**
 * The three ways, and every one of them is something the shipped build does.
 *
 * The second card used to read "Two devices, anywhere — Open a link on the other device and
 * play across the room or the world", which is a feature this build does not have. The
 * engine holds the half of it that is hard: `lockstep.ts` steps two devices through one
 * match, `transport.ts` is the seam the frames would cross, and
 * `data/presentation-parity.test.ts` exercises the single-seat presentation. None of that
 * is reachable by a player. `PlayMode` in `lib/match-setup.ts` is `'friend' | 'bot'`,
 * `PlaySurface` offers exactly those two, there is no pairing route, no signalling and no
 * concrete transport anywhere in `apps/web`, and the per-game "Wire up cross-device remote
 * play" issues are open in the backlog. So the card promised the one thing on the landing
 * page a visitor could not do, in the same family as the offline claim #2445 took out of
 * the hero and the "with no connection at all" line #2513 took out of the privacy page.
 *
 * The tournament takes its place, because it is real, it is reachable from any game's
 * lobby, and `docs/tournament.md` is the design it was built to.
 */
export const WAYS_TO_PLAY: readonly LandingWay[] = [
  {
    badge: '1',
    title: 'Two of you, one device',
    body:
      'Put the phone or the laptop down between you and take a side each. A touch belongs to ' +
      'the side it began on even when a finger crosses the middle, and in games played turn by ' +
      'turn the board turns round so that whoever is to move reads it upright.',
  },
  {
    badge: '2',
    title: 'One of you, and a bot',
    body:
      'Every game has a bot, at three strengths. It sees no more than you can see and moves no ' +
      'faster than a person could; what changes from one strength to the next is how far ahead ' +
      'it looks and how often it slips.',
  },
  {
    badge: '3',
    title: 'Seven games, one winner',
    body:
      'A tournament is seven games drawn at random, one match each, beginning with the game you ' +
      'started it from. Whoever takes four has won it, and the line-up is written down on your ' +
      'device, so it survives closing the tab.',
  },
];

export const WAYS_SECTION: LandingSection = {
  id: 'ways-to-play',
  heading: 'Three ways to play',
  paragraphs: [
    'Every game in the catalogue offers the first two of these, and any game can start the third.',
  ],
};

export const FEATURED_SECTION: LandingSection = {
  id: 'twelve-to-start',
  heading: 'Twelve to start with',
  paragraphs: [
    'One game from each of twelve categories, so what you meet first is twelve different sorts ' +
      'of game rather than twelve versions of one.',
  ],
};

export const WHAT_SECTION: LandingSection = {
  id: 'what-this-is',
  heading: 'What this is',
  paragraphs: [
    'DuelBox is a collection of small games for two people sharing one screen, and nothing ' +
      'else. There is no feed, no levels to work through and no lobby full of strangers: two of ' +
      'you, one device, and a game that finishes soon enough to play another.',
    'Every game is built to the same shape, which is what makes the second one easy. The ' +
      'countdown, the score, the pause, the result and the rematch all come from the site ' +
      'rather than from the game, so they sit in the same place and behave the same way ' +
      'whichever one you opened. Esc pauses, for either player, in all of them.',
  ],
};

export const FREE_SECTION: LandingSection = {
  id: 'nothing-to-install',
  heading: 'Nothing to install, nothing to sign up for',
  paragraphs: [
    'There is no app to download and no store to visit. A link opens a game, and the person you ' +
      'hand the device to needs nothing at all: no account, no invitation, no name typed in.',
    'Nothing you do here is sent anywhere, because there is nowhere to send it. The games, the ' +
      'bots and the physics all run in your own browser, and there is no advertising, no ' +
      'analytics and not one cookie.',
    // Deliberately no list. This sentence used to name four of the seven things the site
    // stores, and it went on naming four while a fifth, a sixth and a seventh were added
    // through `lib/local-store.ts` — the same drift the privacy page had, on the page far
    // more people read. The exhaustive list belongs where something counts it: the privacy
    // page enumerates all seven and `lib/privacy-claims.test.ts` fails on the day a key is
    // added without a bullet. `landing.test.ts` holds this paragraph to naming all of them
    // or none of them, so a half-list cannot come back quietly.
    // "On your device" and not "on your own device": the second is one of the cross-device
    // phrasings `app/metadata-claims.test.ts` holds this repository to never using again,
    // and it caught this paragraph the first time it was rewritten.
    'What the site remembers, it remembers on your device, and one page has all of it: the ' +
      'settings page lists everything kept here, writes it out to a file you can take with ' +
      'you, and erases the lot in one press.',
    'One limit, stated rather than buried. Once a page has loaded, playing it needs nothing ' +
      'further from the network — but there is no offline cache yet, so opening the site, or ' +
      'reloading it, does need a connection.',
  ],
};

export const CATEGORIES_SECTION: LandingSection = {
  id: 'browse-by-category',
  heading: 'Browse by category',
  paragraphs: [
    'Every category has a page of its own that says what its games have in common, names the ' +
      'ones worth starting with, and tells you how long a round of one takes. If you know the ' +
      'sort of game you want before you know which game, that is where to begin.',
  ],
};

export const START_SECTION: LandingSection = {
  id: 'start-a-game',
  heading: 'Start a game',
  paragraphs: [
    'Nothing needs setting up. Pick a game and it opens, or read the guide first — it is one ' +
      'page, and it covers the seats, the keys, and what to do when there is only one of you.',
  ],
};

/**
 * The sections in the order the page renders them, which is the order they are read in.
 *
 * Ordered rather than a bag, because the order is a claim the page makes and
 * `e2e/no-javascript.spec.ts` checks the served HTML against this array: show the games
 * first, explain second, and offer the way in last. A section moved here without being
 * moved in `app/page.tsx` fails there.
 */
export const LANDING_SECTIONS: readonly LandingSection[] = [
  WAYS_SECTION,
  FEATURED_SECTION,
  WHAT_SECTION,
  FREE_SECTION,
  CATEGORIES_SECTION,
  START_SECTION,
];

/** How many games the landing page shows. Twelve, which is what its heading says in words. */
export const FEATURED_COUNT = 12;

/**
 * The dozen on the landing page: the first game of each of the twelve categories with the
 * most games behind them.
 *
 * It was `CATALOGUE.slice(0, 12)` under a heading reading "Popular right now", and both
 * halves were wrong. Nothing in this product records what anybody played — no server, no
 * analytics, and `lib/recent.ts` is this device's own last eight and never leaves it — so
 * there is no popularity to be right about, and the heading was a claim the build cannot
 * make. That is the same defect as the two the slice already carried: it once began
 * `.filter((game) => game.researched)`, which selected nothing useful because `researched`
 * was generated as "has a one-line rule blurb" and was true for all 108 games while 107
 * research issues were open (#2514).
 *
 * Alphabetical order is also a poor dozen. The first twelve by name were four Sports games,
 * two of them both called Archery. One per category, taking the categories in
 * `CATEGORY_HUBS` order — which is by how many games each holds — is deterministic, needs
 * no popularity, and puts twelve genuinely different games in front of somebody who has
 * arrived knowing nothing.
 *
 * `categories` is passed in rather than imported so this stays a pure function of its
 * arguments: the caller is the page, which already holds both lists.
 */
export function featuredGames(
  games: readonly CatalogueEntry[],
  categories: readonly string[],
  count: number = FEATURED_COUNT,
): CatalogueEntry[] {
  const picked: CatalogueEntry[] = [];
  for (const category of categories) {
    if (picked.length >= count) break;
    const first = games.find((game) => game.category === category);
    if (first !== undefined) picked.push(first);
  }
  return picked;
}

/**
 * "Rounds run from about 20 seconds to about 7 minutes", from the catalogue's own numbers.
 *
 * Compared as *rendered* strings rather than as seconds, which is the difference between a
 * useful line and a silly one — the category hub learnt this on a category holding a
 * 60-second game and a 75-second one, both of which render as "about 1 minute", so
 * comparing the numbers produced "Rounds run from about 1 minute to about 1 minute".
 * `formatRound` is the one place that decides how a length reads, so it is the thing to ask.
 */
export function roundSpread(games: readonly CatalogueEntry[]): string {
  const seconds = games.map((game) => game.roundSeconds);
  const shortest = formatRound(Math.min(...seconds));
  const longest = formatRound(Math.max(...seconds));
  return shortest === longest
    ? `Every round takes ${shortest}.`
    : `Rounds run from ${shortest} to ${longest}.`;
}

/**
 * "20 games", and "1 game" for the four categories that hold one.
 *
 * `app/games/category/[slug]/page.tsx` carries a private `countLine` doing exactly this.
 * Two copies of a pluraliser is one too many and they belong together in `lib/format.ts`,
 * which already owns how a round length reads — but merging them edits that route's file,
 * and this batch does not own it, so the duplicate is written down here rather than taken
 * quietly.
 */
export function gameCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'game' : 'games'}`;
}
