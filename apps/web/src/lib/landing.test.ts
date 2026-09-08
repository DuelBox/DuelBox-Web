import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOGUE, type CatalogueEntry } from '../data/catalogue.generated';
import { isPlayable } from '../data/registry';
import { CATEGORY_HUBS } from './categories';
import { FAVOURITES_KEY } from './favourites';
import { formatRound } from './format';
import { HEAD_TO_HEAD_KEY } from './head-to-head';
import { AMERICAN, NEVER } from './house-voice';
import { LAST_MODE_KEY } from './last-mode';
import { BOT_DIFFICULTIES } from './match-setup';
import { PLAYER_DATA_KEYS } from './player-data';
import { CATALOGUE_KEY } from './catalogue-filter-key';
import { HINTS_SEEN_KEY } from './control-hints-key';
import { KEY_BINDINGS_KEY } from './key-bindings-key';
import { PLAYER_NAMES_KEY } from './player-names';
import { RECENT_KEY } from './recent';
import { SETTINGS_KEY } from './settings';
import { TOURNAMENT_LENGTH, legsToWin } from './tournament';
import { TOURNAMENT_KEY } from './tournament-store';
import * as landing from './landing';
import {
  FEATURED_COUNT,
  FREE_SECTION,
  LANDING_SECTIONS,
  WAYS_TO_PLAY,
  featuredGames,
  gameCount,
  roundSpread,
  type LandingSection,
} from './landing';

/**
 * The landing page's prose, held to the standard the rest of the product's prose is held to
 * — and then to the standard prose alone cannot meet.
 *
 * Two jobs, and the second is the one worth having. The first is the house voice: the same
 * `AMERICAN` and `NEVER` tables from `lib/house-voice.ts` that `data/catalogue-voice.test.ts`
 * and `lib/categories.test.ts` use, so a landing page cannot spell `color` or promise an
 * input no game in the collection reads. The second is the part that decides whether this
 * file is worth its lines: **every number this copy states is checked against the code that
 * decides it.** "Seven games drawn at random" is checked against `TOURNAMENT_LENGTH`, "takes
 * four" against `legsToWin`, "three strengths" against `BOT_DIFFICULTIES`, and no sentence
 * in the module is allowed to contain a digit at all, so a count that can change has to be
 * rendered from the thing that changes it rather than typed into a paragraph.
 *
 * That is the shape `lib/privacy-claims.test.ts` established: read the page against the code
 * it describes. It exists because a page of prose is exactly the kind of artefact nothing
 * looks at, and this landing page had two claims in it that nothing looked at — an offer to
 * "play from your own device against a friend anywhere", which no part of this build can do,
 * and a heading reading "Popular right now" over a dozen games chosen alphabetically by a
 * product that records nobody's play.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const pagePath = join(web, 'app', 'page.tsx');
const page = readFileSync(pagePath, 'utf8');

/** Every string in the module that a reader reads, with a name to fail under. */
const COPY: readonly { readonly where: string; readonly text: string }[] = [
  ...LANDING_SECTIONS.flatMap((section) => [
    { where: `${section.id} heading`, text: section.heading },
    ...section.paragraphs.map((text, index) => ({
      where: `${section.id} paragraph ${String(index + 1)}`,
      text,
    })),
  ]),
  ...WAYS_TO_PLAY.flatMap((way) => [
    { where: `way ${way.badge} title`, text: way.title },
    { where: `way ${way.badge} body`, text: way.body },
  ]),
];

/**
 * Words that sell rather than say, which #102 asks this copy to be free of.
 *
 * Local to this file rather than in `lib/house-voice.ts`, and the reason is a measurement
 * rather than a preference: all 108 catalogue rules and all 18 hub blurbs pass this table
 * today, so it *could* move there and be adopted by both — but moving it means editing the
 * two tests that own those surfaces, and this batch does not own them. The honest thing is
 * to write the table where it is used and say what it was measured against.
 *
 * Two obvious entries are deliberately absent. "Ultimate" is the name of a game in the
 * catalogue, and "best" is how the tournament describes itself in the hub copy ("Best of
 * three"), so both would fail sentences that are not selling anything. A guard that fires on
 * ordinary English is a guard somebody turns off.
 */
const PUFFERY: readonly string[] = [
  'amazing',
  'awesome',
  'incredible',
  'incredibly',
  'stunning',
  'gorgeous',
  'beautiful',
  'seamless',
  'effortless',
  'revolutionary',
  'unleash',
  'epic',
  'insane',
  'addictive',
  'unmissable',
  'world-class',
  'cutting-edge',
  'next-level',
  'game-changing',
  'thrilling',
  'exhilarating',
  'breathtaking',
  'endless',
  'blazing',
  'supercharged',
  'premium',
  'powerful',
  'simply',
  'truly',
  'absolutely',
  'extremely',
  'super',
  'ultra',
  'mega',
];

/** The numbers this copy is allowed to say, spelled the way it says them. */
const IN_WORDS: Readonly<Record<number, string>> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  12: 'twelve',
  18: 'eighteen',
};

function says(text: string, word: string): boolean {
  return new RegExp(String.raw`\b${word}\b`, 'i').test(text);
}

/**
 * A catalogue row to build a two-game fixture out of, for the sentences that are pinned
 * word for word.
 *
 * Hand-built rather than taken from `CATALOGUE`, so that the wording of a sentence and the
 * numbers the real catalogue happens to hold today are two separate tests: one of them
 * should fail when the copy changes, and neither should fail when a game's round length is
 * tuned.
 */
const FIXTURE: CatalogueEntry = {
  id: 'fixture',
  slug: 'fixture',
  name: 'Fixture',
  category: 'Board',
  archetype: 'turn-based',
  modes: ['friend', 'bot'],
  roundSeconds: 60,
  tint: 'p1Tint',
  mark: 'disc',
  rule: 'A fixture, not a game.',
};

describe('the landing copy is in the house voice', () => {
  it('has copy to check in the first place', () => {
    // A guard over an empty list passes forever. This is the line that fails if the module
    // is gutted rather than merely reworded.
    expect(COPY.length).toBeGreaterThan(12);
    expect(LANDING_SECTIONS.length).toBeGreaterThan(4);
    expect(WAYS_TO_PLAY.length).toBe(3);
  });

  it('never shouts', () => {
    const shouting = COPY.filter((entry) => entry.text.includes('!')).map((entry) => entry.where);
    expect(shouting, `the shell has no exclamation marks anywhere: ${shouting.join(', ')}`).toEqual(
      [],
    );
  });

  it('spells the way the rest of the shell spells', () => {
    const wrong: string[] = [];
    for (const entry of COPY) {
      for (const [american, british] of AMERICAN) {
        if (says(entry.text, american)) {
          wrong.push(`${entry.where}: "${american}" — the shell spells it "${british}"`);
        }
      }
    }
    expect(wrong, `American spellings on the landing page:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('never names an instrument no game in the collection has', () => {
    const wrong: string[] = [];
    for (const entry of COPY) {
      for (const [pattern, what] of NEVER) {
        if (pattern.test(entry.text)) wrong.push(`${entry.where}: names ${what}`);
      }
    }
    expect(wrong, `copy promising an input that does not exist:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('sells nothing', () => {
    const wrong: string[] = [];
    for (const entry of COPY) {
      for (const word of PUFFERY) {
        if (says(entry.text, word)) wrong.push(`${entry.where}: "${word}"`);
      }
    }
    expect(wrong, `adjectives doing the work a fact should do:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('reads as prose rather than as a caption', () => {
    const wrong: string[] = [];
    for (const section of LANDING_SECTIONS) {
      const { id, heading, paragraphs } = section;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) wrong.push(`${id}: not a URL fragment`);
      if (!/^[A-Z]/.test(heading)) wrong.push(`${id}: heading does not start with a capital`);
      if (/[.]$/.test(heading)) wrong.push(`${id}: a heading is not a sentence`);
      if (paragraphs.length === 0) wrong.push(`${id}: a heading with nothing under it`);
      for (const [index, text] of paragraphs.entries()) {
        const at = `${id} paragraph ${String(index + 1)}`;
        if (text !== text.trim()) wrong.push(`${at}: padded with whitespace`);
        if (/[\n\r\t]/.test(text)) wrong.push(`${at}: contains a line break`);
        if (/\s\s/.test(text)) wrong.push(`${at}: contains a double space`);
        if (!/^[A-Z]/.test(text)) wrong.push(`${at}: does not start with a capital`);
        if (!/[.]$/.test(text)) wrong.push(`${at}: does not end in a full stop`);
        // Long enough to say something, short enough that nobody is reading an essay
        // before they reach a game.
        if (text.length < 80) wrong.push(`${at}: ${String(text.length)} chars, too short`);
        if (text.length > 420) wrong.push(`${at}: ${String(text.length)} chars, too long`);
      }
    }
    expect(wrong, `copy that is not shaped like a section:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('gives every section its own heading and its own address', () => {
    const ids = LANDING_SECTIONS.map((section) => section.id);
    const headings = LANDING_SECTIONS.map((section) => section.heading);
    expect(new Set(ids).size, `two sections share an id: ${ids.join(', ')}`).toBe(ids.length);
    expect(new Set(headings).size, 'two sections share a heading').toBe(headings.length);
  });
});

describe('the numbers the landing copy states', () => {
  /**
   * The check with teeth, and the reason the copy spells its numbers out.
   *
   * A digit in a paragraph is a fact that has been copied out of the code, and a copied
   * fact is one that goes stale silently — the heading over the featured dozen said
   * "Popular right now" for as long as it did because nothing could tell that it was
   * describing something the product does not measure. Anything countable on this page is
   * either rendered from the catalogue by `app/page.tsx` or checked below against the
   * module that decides it.
   */
  it('writes no digit into a sentence', () => {
    const wrong = COPY.filter((entry) => /\d/.test(entry.text)).map(
      (entry) => `${entry.where}: ${entry.text}`,
    );
    expect(wrong, `a number in prose is a number nothing can check:\n${wrong.join('\n')}`).toEqual(
      [],
    );
  });

  /**
   * The words this page would use for each thing the site stores, one per key.
   *
   * A table rather than a scan for nouns, because "settings" appears in this section in a
   * sentence that is not a list — and it is held against `PLAYER_DATA_KEYS`, so a store
   * added through `lib/local-store.ts` fails the test below by having no wording here at
   * all. That is the half `lib/privacy-claims.test.ts` learned to check the hard way: one
   * writer means the keys are findable, and findable is not the same as found.
   */
  const STORE_WORDS: Readonly<Record<string, RegExp>> = {
    [LAST_MODE_KEY]: /setup you last|last used for each game/i,
    [FAVOURITES_KEY]: /\bfavourites\b/i,
    [RECENT_KEY]: /games you played last|recently played/i,
    [SETTINGS_KEY]: /your settings/i,
    [HEAD_TO_HEAD_KEY]: /head-to-head/i,
    [PLAYER_NAMES_KEY]: /names you (chose|gave)|names for the two seats/i,
    [TOURNAMENT_KEY]: /tournament/i,
    [KEY_BINDINGS_KEY]: /keys you (chose|picked)|keys for the two seats/i,
    [HINTS_SEEN_KEY]: /first-play hints|hints you have seen/i,
    [CATALOGUE_KEY]: /sorted the catalogue|catalogue order|sort order/i,
  };

  /**
   * The section that says what is kept on the device names all of the stores or none.
   *
   * It named four of seven — favourites, recently played, settings and the head-to-head —
   * and stayed at four while the chosen setup, the two seat names and a tournament in
   * progress were added, on the highest-traffic route on the site. The privacy page had the
   * identical drift and is now counted against `PLAYER_DATA_KEYS`; this paragraph is prose
   * rather than a list, so what it is held to is the honest pair of options: enumerate the
   * lot, or point at the page that does and enumerate nothing.
   */
  it('names every store the site writes, or none of them', () => {
    const unworded = PLAYER_DATA_KEYS.filter((key) => !(key in STORE_WORDS));
    expect(
      unworded,
      'a store with no wording in STORE_WORDS: add how this page would say it, then decide' +
        ' whether it belongs in the copy — this test cannot tell you which.',
    ).toEqual([]);

    const prose = FREE_SECTION.paragraphs.join(' ');
    const named = PLAYER_DATA_KEYS.filter((key) => STORE_WORDS[key]?.test(prose) === true);
    expect(
      named.length === 0 || named.length === PLAYER_DATA_KEYS.length,
      `"${FREE_SECTION.heading}" names ${String(named.length)} of the ${String(
        PLAYER_DATA_KEYS.length,
      )} things this site stores: ${named.join(', ')}. Name all of them or leave the list to` +
        ' the privacy page, which is counted against PLAYER_DATA_KEYS on every push.',
    ).toBe(true);
  });

  it('describes the tournament the machine actually runs', () => {
    const way = WAYS_TO_PLAY.find((entry) => entry.title.includes('winner'));
    expect(way, 'the tournament card has gone').toBeDefined();
    const body = way?.body ?? '';
    // Seven games and first to four, from `lib/tournament.ts` rather than from memory: a
    // line-up of another length would make both of these sentences wrong.
    expect(
      says(body, IN_WORDS[TOURNAMENT_LENGTH] ?? ''),
      `the tournament is ${String(TOURNAMENT_LENGTH)} games and the card does not say so`,
    ).toBe(true);
    expect(
      says(body, IN_WORDS[legsToWin(TOURNAMENT_LENGTH)] ?? ''),
      `it takes ${String(legsToWin(TOURNAMENT_LENGTH))} legs to win and the card does not say so`,
    ).toBe(true);
  });

  it('offers the bot tiers the shell offers', () => {
    const way = WAYS_TO_PLAY.find((entry) => entry.title.includes('bot'));
    expect(way, 'the bot card has gone').toBeDefined();
    expect(
      says(way?.body ?? '', `${IN_WORDS[BOT_DIFFICULTIES.length] ?? ''} strengths`),
      `the shell offers ${String(BOT_DIFFICULTIES.length)} tiers and the card does not say so`,
    ).toBe(true);
  });

  it('promises a mode only where every game in the catalogue has it', () => {
    // "Every game in the catalogue offers the first two of these": a second player and a
    // bot. `PlaySurface` offers a mode only when the game's manifest declares it, so a game
    // added without one would make that sentence false for exactly that game.
    const missing = CATALOGUE.filter(
      (game) => !game.modes.includes('friend') || !game.modes.includes('bot'),
    ).map((game) => `${game.slug}: ${game.modes.join(', ')}`);
    expect(missing, `games that do not offer both:\n${missing.join('\n')}`).toEqual([]);

    // And "any game can start the third": the tournament's only entry point is a game's
    // lobby, so a catalogue row with no build behind it offers none of the three.
    // `data/routing.test.ts` owns the catalogue-to-registry agreement in general; this is
    // the half of it the sentence on the landing page rests on.
    const unbuilt = CATALOGUE.filter((game) => !isPlayable(game.slug)).map((game) => game.slug);
    expect(unbuilt, `catalogue rows with no playable build:\n${unbuilt.join('\n')}`).toEqual([]);
  });

  it('shows a dozen games drawn from a dozen different categories', () => {
    expect(FEATURED_COUNT).toBe(12);
    // The heading spells the count out, so the two have to agree.
    const heading = LANDING_SECTIONS.find((section) => section.id === 'twelve-to-start')?.heading;
    expect(
      says(heading ?? '', IN_WORDS[FEATURED_COUNT] ?? ''),
      `the heading over the grid must spell ${String(FEATURED_COUNT)} out: "${heading ?? ''}"`,
    ).toBe(true);
    const featured = featuredGames(
      CATALOGUE,
      CATEGORY_HUBS.map((hub) => hub.category),
    );
    expect(featured).toHaveLength(FEATURED_COUNT);
    expect(new Set(featured.map((game) => game.category)).size).toBe(FEATURED_COUNT);
    expect(new Set(featured.map((game) => game.slug)).size).toBe(FEATURED_COUNT);
  });
});

describe('the sentences built from the catalogue', () => {
  it('names the shortest and the longest round the catalogue holds', () => {
    // Derived from the same data the sentence is, rather than the literal it produces today.
    // `app/page.tsx` renders this at build time, so the copy cannot go stale — but the
    // literal could, and it would have gone red on a routine catalogue edit: exactly one game
    // sits at each end (20s and 420s), and `scripts/generate_catalog.py` reads `roundSeconds`
    // out of each game's own manifest, so tuning one game's round length is enough. A test
    // that fails when nothing is broken is a test somebody deletes.
    const seconds = CATALOGUE.map((game) => game.roundSeconds);
    const shortest = formatRound(Math.min(...seconds));
    const longest = formatRound(Math.max(...seconds));
    expect(shortest, 'the catalogue holds two different round lengths').not.toBe(longest);
    expect(roundSpread(CATALOGUE)).toBe(`Rounds run from ${shortest} to ${longest}.`);
  });

  it('says it in the words the page prints, on a pair it cannot be reading from', () => {
    // The wording itself, pinned on a hand-built fixture rather than on the catalogue, so
    // that deriving the assertion above does not leave the sentence asserted nowhere.
    const games = [
      { ...FIXTURE, slug: 'quick', roundSeconds: 30 },
      { ...FIXTURE, slug: 'long', roundSeconds: 600 },
    ];
    expect(roundSpread(games)).toBe('Rounds run from about 30 seconds to about 10 minutes.');
  });

  it('says it once when every round reads the same length', () => {
    // 60 and 75 seconds both render as "about 1 minute", so comparing the numbers rather
    // than the words would produce "from about 1 minute to about 1 minute" — the silly
    // sentence the category hub already had to fix once.
    const games = CATALOGUE.filter((game) => game.roundSeconds === 60 || game.roundSeconds === 75);
    expect(games.length).toBeGreaterThan(1);
    expect(roundSpread(games)).toBe('Every round takes about 1 minute.');
  });

  it('counts a category with one game in it in the singular', () => {
    expect(gameCount(1)).toBe('1 game');
    expect(gameCount(0)).toBe('0 games');
    expect(gameCount(20)).toBe('20 games');
    // Four of the eighteen hold exactly one, which is why this is not academic.
    const singles = CATEGORY_HUBS.filter(
      (hub) => CATALOGUE.filter((game) => game.category === hub.category).length === 1,
    );
    expect(singles.length).toBeGreaterThan(0);
  });

  it('skips a category with nothing behind it rather than showing a gap', () => {
    const games = CATALOGUE.filter((game) => game.category === 'Board').slice(0, 3);
    expect(featuredGames(games, ['Sports', 'Board'], 2)).toHaveLength(1);
    expect(featuredGames(games, [], 2)).toEqual([]);
  });

  it('stops at the count it is asked for', () => {
    const categories = CATEGORY_HUBS.map((hub) => hub.category);
    expect(featuredGames(CATALOGUE, categories, 3)).toHaveLength(3);
    // More categories than games would be asked for: everything it can find, and no throw.
    expect(featuredGames(CATALOGUE, categories, 400).length).toBe(categories.length);
  });
});

describe('the landing page renders what the module declares', () => {
  /** The export name a section is published under, which is how the page refers to it. */
  function exportNameOf(section: LandingSection): string {
    const found = Object.entries(landing).find(([, value]) => value === section);
    expect(found, 'a section that is in LANDING_SECTIONS but is not exported').toBeDefined();
    return found?.[0] ?? '';
  }

  it('names every section by its own heading, in the order the module declares', () => {
    const positions: number[] = [];
    for (const section of LANDING_SECTIONS) {
      const name = exportNameOf(section);
      const marker = `aria-labelledby={${name}.id}`;
      const at = page.indexOf(marker);
      expect(at, `app/page.tsx does not render ${name} as a named section`).toBeGreaterThan(-1);
      expect(page, `${name} is not headed by its own heading`).toContain(`{${name}.heading}`);
      positions.push(at);
    }
    // Sorted is the order the module declares. The order is a claim the page makes — games
    // first, prose second, the way in last — and `e2e/no-javascript.spec.ts` reads the same
    // order out of the served HTML.
    expect(positions, 'the page renders the sections in a different order').toEqual(
      [...positions].sort((a, b) => a - b),
    );
  });

  it('renders every paragraph, rather than a chosen few', () => {
    for (const section of LANDING_SECTIONS) {
      const name = exportNameOf(section);
      expect(page, `${name} drops its paragraphs`).toContain(`{${name}.paragraphs.map(`);
    }
  });
});

/**
 * The landing page ships no JavaScript of its own, and this is what says so (#102, #103).
 *
 * The shell budget has under two kilobytes of headroom and every one of the six sections
 * above is on the route every visitor lands on, so a client component here is paid for by
 * everybody. It is also the whole of #103: a `'use client'` component renders its markup at
 * build time, so the defect it would introduce is invisible in the HTML and shows up only as
 * a control that does nothing — which is exactly the sort of thing that ships.
 *
 * Transitive rather than a look at this file's own import list, because the way a client
 * component arrives is through something that looked like a server one. `GameCard` and
 * `TileSprite` are the interesting cases: both are imported here, both reach the catalogue
 * and the tile geometry, and neither may ever gain a directive without this failing.
 */
describe('the landing page is server-rendered all the way down', () => {
  const SPECIFIER = /(?:from|import)\s*\(?\s*'([^']+)'/g;

  function resolveImport(from: string, specifier: string): string | null {
    if (specifier.endsWith('.css')) return null;
    let base: string;
    if (specifier.startsWith('@/')) base = join(web, specifier.slice(2));
    else if (specifier.startsWith('.')) base = join(dirname(from), specifier);
    // A package: `react`, `next/link`, `@duelbox/engine`. Not ours to walk.
    else return null;
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      base.replace(/\.js$/, '.ts'),
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    // Deliberately a throw and not a skip. A specifier this cannot resolve is a subtree
    // this stops walking, and a guard that quietly stops walking is the guard that passes
    // while the thing it guards is broken.
    throw new Error(`landing.test.ts cannot resolve "${specifier}" from ${relative(web, from)}`);
  }

  function graphFrom(entry: string): string[] {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const path = queue.pop();
      if (path === undefined || seen.has(path)) continue;
      seen.add(path);
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(SPECIFIER)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const resolved = resolveImport(path, specifier);
        if (resolved !== null) queue.push(resolved);
      }
    }
    return [...seen];
  }

  it('reaches the modules it is supposed to reach', () => {
    const graph = graphFrom(pagePath).map((path) => relative(web, path));
    // Not an assertion about the count. It is the assertion that the walk walked: the page
    // imports these three by different routes, and a walk that resolved nothing would pass
    // the test below having read one file.
    expect(graph).toContain('lib/landing.ts');
    expect(graph).toContain('components/GameCard.tsx');
    expect(graph).toContain('data/registry.ts');
    expect(graph.length).toBeGreaterThan(8);
  });

  it('imports nothing that carries a client directive', () => {
    const client = graphFrom(pagePath).filter((path) =>
      /^\s*(['"])use client\1/.test(readFileSync(path, 'utf8')),
    );
    expect(
      client.map((path) => relative(web, path)),
      'a client component on the landing page costs the shell budget and breaks #103',
    ).toEqual([]);
  });
});
