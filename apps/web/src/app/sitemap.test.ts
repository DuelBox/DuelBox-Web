import { describe, expect, it } from 'vitest';
import { CATALOGUE, CATEGORIES } from '../data/catalogue.generated';
import { PLAYABLE } from '../data/registry';
import { CATEGORY_HUBS } from '../lib/categories';
import { SITE_URL, absoluteUrl } from '../lib/site';
import robots from './robots';
import sitemap from './sitemap';

/**
 * The sitemap is derived from the lists the routes are derived from, so this checks the
 * derivation rather than a snapshot. A snapshot would need updating on every new game, which
 * is the maintenance the metadata route exists to remove (#199).
 */
const STATIC_ROUTES = ['/', '/games/', '/how-to-play/', '/privacy/', '/terms/'];

describe('the site address', () => {
  it('carries no trailing slash, so a joined route never has two', () => {
    expect(SITE_URL.endsWith('/')).toBe(false);
    expect(absoluteUrl('/games/chess/')).toBe(`${SITE_URL}/games/chess/`);
  });

  it('falls back to the Pages project URL, base path included', () => {
    // The deploy workflow sets NEXT_PUBLIC_SITE_URL; this suite does not, so this is the
    // address the export gets when nothing says otherwise.
    expect(SITE_URL).toBe('https://duelbox.github.io/DuelBox-Web');
  });
});

describe('the sitemap', () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);

  it('is addressed at the site, with the trailing slash every route has', () => {
    for (const url of urls) {
      expect(url.startsWith(`${SITE_URL}/`), url).toBe(true);
      expect(url.endsWith('/'), url).toBe(true);
    }
  });

  it('lists the five static pages', () => {
    for (const route of STATIC_ROUTES) expect(urls).toContain(`${SITE_URL}${route}`);
  });

  it('lists every catalogue page exactly once', () => {
    for (const game of CATALOGUE) {
      const page = `${SITE_URL}/games/${game.slug}/`;
      expect(
        urls.filter((url) => url === page),
        game.slug,
      ).toHaveLength(1);
    }
  });

  it('lists a hub for every category exactly once', () => {
    // The hubs are only worth building if a crawler is told they exist (#200), and the
    // count is checked against the catalogue's own category list rather than against
    // CATEGORY_HUBS, so a nineteenth category with no page written for it fails here.
    expect(CATEGORY_HUBS).toHaveLength(CATEGORIES.length);
    for (const hub of CATEGORY_HUBS) {
      const page = `${SITE_URL}/games/category/${hub.slug}/`;
      expect(
        urls.filter((url) => url === page),
        hub.category,
      ).toHaveLength(1);
    }
  });

  it('ranks a hub above the game pages it links to and below the catalogue', () => {
    const priorityOf = (url: string) => entries.find((entry) => entry.url === url)?.priority;
    const hub = `${SITE_URL}/games/category/${CATEGORY_HUBS[0]?.slug ?? ''}/`;
    expect(priorityOf(hub)).toBeLessThan(priorityOf(`${SITE_URL}/games/`) ?? 0);
    expect(priorityOf(hub)).toBeGreaterThan(priorityOf(`${SITE_URL}/games/chess/`) ?? 0);
  });

  it('lists a play route for every playable game and for nothing else', () => {
    const play = urls.filter((url) => url.startsWith(`${SITE_URL}/play/`)).sort();
    expect(play).toEqual(PLAYABLE.map((slug) => `${SITE_URL}/play/${slug}/`).sort());
  });

  it('lists nothing else, and nothing twice', () => {
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(
      STATIC_ROUTES.length + CATEGORY_HUBS.length + CATALOGUE.length + PLAYABLE.length,
    );
  });

  it('dates every entry', () => {
    for (const entry of entries) {
      const date = entry.lastModified;
      expect(date, entry.url).toBeInstanceOf(Date);
      if (date instanceof Date) expect(Number.isNaN(date.getTime()), entry.url).toBe(false);
    }
  });

  it('gives every entry one date, because every page changes on every deploy', () => {
    expect(new Set(entries.map((entry) => String(entry.lastModified))).size).toBe(1);
  });
});

describe('robots.txt', () => {
  it('allows everything and points at the sitemap', () => {
    const file = robots();
    expect(file.rules).toEqual({ userAgent: '*', allow: '/' });
    expect(file.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});
