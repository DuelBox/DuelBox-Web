import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../data/catalogue.generated';
import {
  DEFAULT_SHARE_IMAGE_FILE,
  SHARE_IMAGE_FILES,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
} from '../data/share-images.generated';
import { SITE_SHARE_IMAGE, shareImageFor } from './share-image';
import { SITE_URL } from './site';

/**
 * The half of #2453 that can be checked without a build: every game has a picture, and the
 * addresses of those pictures are the addresses of files the generator says it wrote.
 *
 * The other half — that the files are really in the export, at the size the metadata claims
 * — belongs to `scripts/check-share-images.mjs`, which reads the built site. Both were
 * watched failing on purpose before either was trusted; what was broken and what it printed
 * is recorded above each assertion, which is the habit CLAUDE.md asks for.
 */
describe('share images', () => {
  /**
   * Sabotage: deleted `'chess.png'` from `SHARE_IMAGE_FILES`.
   *
   *   AssertionError: expected [ 'chess' ] to deeply equal []
   *
   * The realistic version of that is a game added to the catalogue while the generator is
   * not re-run, which is the same thing with a different cause — the manifest is a record
   * of what was emitted, so a game missing from it is a game with no card.
   */
  it('gives every game in the catalogue a card', () => {
    const missing = CATALOGUE.filter((game) => shareImageFor(game.slug, game.name) === null).map(
      (game) => game.slug,
    );
    expect(missing).toEqual([]);
  });

  /**
   * Sabotage: made `shareImageFor` look up one fixed file rather than the game's own.
   *
   *   AssertionError: expected 1 to be 108 // Object.is equality
   *
   * Two games sharing a card is the failure that makes a preview actively misleading: the
   * link says one game and the picture shows another.
   */
  it('gives each game a card of its own', () => {
    const urls = new Set(
      CATALOGUE.map((game) => shareImageFor(game.slug, game.name)?.url).filter(
        (url) => url !== undefined,
      ),
    );
    expect(urls.size).toBe(CATALOGUE.length);
    expect(urls.has(SITE_SHARE_IMAGE.url)).toBe(false);
  });

  /**
   * The manifest is the generator's own record, so an entry with no game behind it is a
   * card the export is still shipping for a game that has been renamed or removed.
   * `check-share-images.mjs` fails on the same file from the other direction, by finding it
   * in the export with nothing pointing at it.
   */
  it('ships no card that belongs to no game', () => {
    const expected = new Set([
      DEFAULT_SHARE_IMAGE_FILE,
      ...CATALOGUE.map((game) => `${game.slug}.png`),
    ]);
    expect(SHARE_IMAGE_FILES.filter((file) => !expected.has(file))).toEqual([]);
  });

  /**
   * Sabotage: renamed every emitted card to `game-<slug>.png`, which is what changing the
   * generator's naming looks like from here.
   *
   *   AssertionError: expected [ Array(108) ] to deeply equal []
   *   AssertionError: game-air-hockey.png names no game: expected undefined to be defined
   *   — and four more, on every assertion in this file that touches a game's card.
   *
   * That is the whole argument for the manifest existing. Had this module composed
   * `og/${slug}.png` for itself, every one of those assertions would have passed while the
   * export served a hundred and eight files under different names — a URL built out of a
   * slug is always well-formed and can always be wrong.
   */
  it('addresses the file the generator actually wrote', () => {
    for (const file of SHARE_IMAGE_FILES) {
      if (file === DEFAULT_SHARE_IMAGE_FILE) continue;
      const slug = file.replace(/\.png$/, '');
      const game = CATALOGUE.find((entry) => entry.slug === slug);
      expect(game, `${file} names no game`).toBeDefined();
      expect(shareImageFor(slug, game?.name ?? '')?.url).toBe(`${SITE_URL}/og/${file}`);
    }
  });

  it('publishes absolute addresses under this site', () => {
    const images = [
      SITE_SHARE_IMAGE,
      ...CATALOGUE.map((game) => shareImageFor(game.slug, game.name)),
    ];
    for (const image of images) {
      expect(image?.url.startsWith(`${SITE_URL}/`)).toBe(true);
      expect(image?.url.endsWith('.png')).toBe(true);
      expect(image?.type).toBe('image/png');
    }
  });

  /**
   * The dimensions are declared to the platform in the metadata and are what it lays the
   * card out with before it has fetched the image. They come from the generator's manifest
   * so they cannot drift from the frame the cards are actually composed in.
   */
  it('declares the size the cards are composed at', () => {
    expect([SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT]).toEqual([1200, 630]);
    const image = shareImageFor('chess', 'Chess');
    expect(image?.width).toBe(SHARE_IMAGE_WIDTH);
    expect(image?.height).toBe(SHARE_IMAGE_HEIGHT);
  });

  /** Alt text is the only thing a screen reader gets from a preview, so it names the game. */
  it('describes the picture in words', () => {
    expect(shareImageFor('chess', 'Chess')?.alt).toBe('The DuelBox tile for Chess.');
    expect(SITE_SHARE_IMAGE.alt.length).toBeGreaterThan(10);
  });

  /** A slug with no card gets nothing rather than a plausible URL that 404s. */
  it('refuses to invent an address', () => {
    expect(shareImageFor('a-game-that-does-not-exist', 'Nope')).toBeNull();
  });
});
