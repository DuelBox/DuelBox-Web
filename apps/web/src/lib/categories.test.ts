import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOGUE, CATEGORIES } from '../data/catalogue.generated';
import { CATEGORY_HUBS, categorySlug, hubFor } from './categories';
import { AMERICAN, NEVER } from './house-voice';

/**
 * The hubs, checked against the catalogue they describe and against the house voice.
 *
 * Two different jobs, and the second is the one worth having. The first — every category
 * has a hub, no two hubs share an address — is the sort of thing a mapping either does or
 * does not do. The second is the acceptance criterion of #200: a hub that is a template
 * with the category name substituted in is thin duplicate content, and thin duplicate
 * content is a set of pages a search engine declines to index. So the prose is held to the
 * same shape `data/catalogue-voice.test.ts` holds the catalogue rules to, plus the one
 * check a template cannot pass: every blurb names real games from its own category.
 */

/** Every game in a category, as the hub page itself gathers them. */
function gamesIn(category: string) {
  return CATALOGUE.filter((game) => game.category === category);
}

describe('the mapping from a category to an address', () => {
  it('lower-cases and hyphenates, and keeps the ampersand out of the URL', () => {
    expect(categorySlug('Board')).toBe('board');
    expect(categorySlug('Racing & Trails')).toBe('racing-trails');
  });

  it('gives every category in the catalogue a hub', () => {
    expect([...CATEGORY_HUBS].map((hub) => hub.category).sort()).toEqual([...CATEGORIES].sort());
  });

  it('gives no two categories the same address', () => {
    // The derivation collapses punctuation, so "Racing" and "Racing & Trails" are the pair
    // that could collide, and a future "Board!" would be the next one. A collision would
    // silently give one category the other's page rather than failing anything.
    const slugs = CATEGORIES.map(categorySlug);
    expect(new Set(slugs).size, slugs.join(', ')).toBe(slugs.length);
  });

  it('spells every address the way a URL is spelled', () => {
    for (const hub of CATEGORY_HUBS) {
      expect(hub.slug, hub.category).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(hub.slug, hub.category).toBe(categorySlug(hub.category));
    }
  });

  it('finds a hub by its address and nothing by a wrong one', () => {
    expect(hubFor('racing-trails')?.category).toBe('Racing & Trails');
    expect(hubFor('board')?.category).toBe('Board');
    expect(hubFor('Board')).toBeUndefined();
    expect(hubFor('racing--trails')).toBeUndefined();
    expect(hubFor('')).toBeUndefined();
  });

  it('lists every hub with games behind it', () => {
    for (const hub of CATEGORY_HUBS) {
      expect(gamesIn(hub.category).length, hub.category).toBeGreaterThan(0);
    }
  });

  /**
   * Every hub has a page that links to it, and the previous test is half of the argument.
   *
   * The footer carries the six largest, and the only other link site in the product is the
   * heading above a game page's related games. That heading used to be inside the
   * `related.length > 0` guard, and `related` is the category's other games — so Rhythm,
   * Stealth, Deduction and Racing & Trails, which hold one game each, rendered no heading
   * and therefore no link, and their hubs were reachable from the sitemap and nothing else.
   * The catalogue is not the second route the footer's note used to claim: its chips are
   * filter buttons and its group headings are plain text.
   *
   * So: every category has at least one game (above), every game page links its own hub
   * (here), and eighteen hubs have a way in. This reads the source because the page is a
   * server component with no DOM to render into; `e2e/category-hubs.spec.ts` walks all
   * eighteen against the real static build, which is the check with teeth.
   */
  it('links a hub from every game page, not only from pages with related games', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const page = readFileSync(join(here, '..', 'app', 'games', '[slug]', 'page.tsx'), 'utf8');
    expect(page, 'the game page no longer links a category hub at all').toContain(
      'href={`/games/category/${categorySlug(game.category)}/`}',
    );
    expect(
      page,
      'the hub link is back inside the related-games guard, which orphans the four ' +
        'single-game categories',
    ).not.toMatch(/related\.length\s*>\s*0\s*\?\s*\(\s*<section/);
  });

  /**
   * The footer links the first six from every page in the site, so this order decides which
   * hubs a crawler reaches cheapest. Non-increasing rather than a fixed list, because Sports
   * and Party are both twenty and a rule that broke on a tie would be a rule about the tie.
   */
  it('is ordered by how many games the category holds, largest first', () => {
    const counts = CATEGORY_HUBS.map((hub) => gamesIn(hub.category).length);
    for (let index = 1; index < counts.length; index += 1) {
      const previous = counts[index - 1] ?? 0;
      const current = counts[index] ?? 0;
      expect(
        current,
        `${CATEGORY_HUBS[index]?.category ?? ''} is out of order`,
      ).toBeLessThanOrEqual(previous);
    }
  });
});

describe('the hub copy is written per category rather than generated', () => {
  it('gives every hub its own heading, blurb and search intent', () => {
    for (const field of ['title', 'blurb', 'intent'] as const) {
      const values = CATEGORY_HUBS.map((hub) => hub[field]);
      expect(new Set(values).size, `two hubs share a ${field}`).toBe(values.length);
    }
  });

  /**
   * The check a template cannot pass. Naming the games is what makes a hub about its own
   * category — it is also the part that goes stale, so it is checked against the catalogue
   * rather than against a list written here.
   */
  it('names real games from its own category, two of them where there are two', () => {
    const wrong: string[] = [];
    for (const hub of CATEGORY_HUBS) {
      const games = gamesIn(hub.category);
      const named = games.filter((game) => hub.blurb.includes(game.name));
      const wanted = Math.min(2, games.length);
      if (named.length < wanted) {
        wrong.push(`${hub.category}: names ${String(named.length)}, wanted ${String(wanted)}`);
      }
    }
    expect(wrong, `blurbs that do not name their own games:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('names no game that is not in the category', () => {
    // A blurb naming a game from elsewhere is a hub describing the wrong shelf, and it is
    // the mistake copying one blurb to write the next makes.
    const wrong: string[] = [];
    for (const hub of CATEGORY_HUBS) {
      for (const game of CATALOGUE) {
        if (game.category === hub.category) continue;
        // A shorter name inside a longer one is not a mention: "Archery" sits inside
        // "Archery Master", and "Tennis" inside nothing, but the next pair added might.
        const alsoHere = gamesIn(hub.category).some((own) => own.name.includes(game.name));
        if (!alsoHere && hub.blurb.includes(game.name)) {
          wrong.push(`${hub.category} names ${game.name}, which is ${game.category}`);
        }
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});

/** A hub's whole copy, which is what every check below reads. */
function copyOf(hub: (typeof CATEGORY_HUBS)[number]): string {
  return `${hub.title} ${hub.intent} ${hub.blurb}`;
}

/**
 * The same shape `data/catalogue-voice.test.ts` holds the catalogue rules to, and now
 * literally the same tables.
 *
 * These strings go into an `<h1>`, a paragraph and a `<meta name="description">`, which is
 * exactly where the catalogue rules go — so the failure modes are the same ones, and there
 * is no reason for the guard to be weaker here than there. It was weaker in three ways: a
 * spelling table of thirteen against twenty, an instrument table of eleven against
 * fourteen, and an instrument check that read the blurb while the spelling check read the
 * title and the intent as well. Both tables now come from `lib/house-voice.ts` and both
 * checks read `copyOf`, so "the same shape" is a fact rather than a claim.
 */
describe('the hub copy is in the house voice', () => {
  it('never shouts', () => {
    const shouting = CATEGORY_HUBS.filter(
      (hub) => hub.blurb.includes('!') || hub.title.includes('!') || hub.intent.includes('!'),
    ).map((hub) => hub.category);
    expect(shouting, `the shell has no exclamation marks anywhere: ${shouting.join(', ')}`).toEqual(
      [],
    );
  });

  it('reads as prose that can stand alone in a search result', () => {
    const wrong: string[] = [];
    for (const hub of CATEGORY_HUBS) {
      const { blurb, title, intent } = hub;
      if (blurb !== blurb.trim()) wrong.push(`${hub.category}: blurb padded with whitespace`);
      if (/[\n\r\t]/.test(blurb)) wrong.push(`${hub.category}: blurb contains a line break`);
      if (/\s\s/.test(blurb)) wrong.push(`${hub.category}: blurb contains a double space`);
      if (!/^[A-Z]/.test(blurb)) wrong.push(`${hub.category}: blurb does not start with a capital`);
      if (!/[.]$/.test(blurb)) wrong.push(`${hub.category}: blurb does not end in a full stop`);
      // Two or three sentences: long enough to say something only this category could say,
      // short enough that nobody is reading an essay to reach the grid.
      if (blurb.length < 160) wrong.push(`${hub.category}: blurb ${String(blurb.length)} chars`);
      if (blurb.length > 460) wrong.push(`${hub.category}: blurb ${String(blurb.length)} chars`);
      if (!/^[A-Z]/.test(title)) wrong.push(`${hub.category}: title does not start with a capital`);
      if (/[.]$/.test(title)) wrong.push(`${hub.category}: a heading is not a sentence`);
      // The intent opens the meta description, so it is a phrase with a capital and no stop.
      if (!/^[A-Z]/.test(intent)) wrong.push(`${hub.category}: intent does not open a sentence`);
      if (/[.!?]$/.test(intent)) wrong.push(`${hub.category}: intent is punctuated as a sentence`);
    }
    expect(wrong, `copy that is not shaped like a hub:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('spells the way the rest of the shell spells', () => {
    const wrong: string[] = [];
    for (const hub of CATEGORY_HUBS) {
      const copy = copyOf(hub);
      for (const [american, british] of AMERICAN) {
        if (new RegExp(String.raw`\b${american}\b`, 'i').test(copy)) {
          wrong.push(`${hub.category}: "${american}" — the shell spells it "${british}"`);
        }
      }
    }
    expect(wrong, `American spellings in the hub copy:\n${wrong.join('\n')}`).toEqual([]);
  });

  /**
   * No game in this collection reads a stick, a pad or a pointing device. A hub promising
   * one is describing a different product, which is how the catalogue rules acquired
   * forty-seven of them before anybody counted.
   *
   * Over the whole of a hub's copy, not the blurb alone: the title goes in an `h1` and the
   * intent opens the `meta` description, so an intent of "Two player gamepad games" is the
   * version of this mistake a search engine sees first.
   */
  it('never names an instrument no game in the collection has', () => {
    const wrong: string[] = [];
    for (const hub of CATEGORY_HUBS) {
      const copy = copyOf(hub);
      for (const [pattern, what] of NEVER) {
        if (pattern.test(copy)) wrong.push(`${hub.category}: names ${what}`);
      }
    }
    expect(wrong, `copy promising an input that does not exist:\n${wrong.join('\n')}`).toEqual([]);
  });
});
