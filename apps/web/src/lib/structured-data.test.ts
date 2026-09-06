import { describe, expect, it } from 'vitest';
import type { CatalogueEntry } from '../data/catalogue.generated';
import { serialiseJsonLd, videoGameJsonLd } from './structured-data';

const PAGE_URL = 'https://duelbox.github.io/DuelBox-Web/games/air-hockey/';

/** One catalogue entry, with the two fields these tests vary left open. */
function entry(
  modes: readonly string[],
  rule = 'Send the puck through the far mouth.',
): CatalogueEntry {
  return {
    id: 'air-hockey',
    slug: 'air-hockey',
    name: 'Air Hockey',
    category: 'Sports',
    archetype: 'rt-split',
    modes,
    roundSeconds: 90,
    tint: 'p2Tint',
    mark: 'split',
    rule,
  };
}

describe('the VideoGame block', () => {
  it('restates what the page already says', () => {
    expect(videoGameJsonLd(entry(['friend', 'bot']), PAGE_URL)).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: 'Air Hockey',
      description: 'Send the puck through the far mouth.',
      url: PAGE_URL,
      genre: 'Sports',
      applicationCategory: 'Game',
      gamePlatform: 'Web browser',
      operatingSystem: 'Any',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    });
  });

  it('claims no rating, because nothing measures one', () => {
    expect(videoGameJsonLd(entry(['friend', 'bot']), PAGE_URL)).not.toHaveProperty(
      'aggregateRating',
    );
  });

  it('needs two people when nothing can fill the other seat', () => {
    expect(videoGameJsonLd(entry(['friend']), PAGE_URL)['numberOfPlayers']).toEqual({
      '@type': 'QuantitativeValue',
      minValue: 2,
      maxValue: 2,
    });
  });

  it('needs one person when a bot or a solo mode fills it', () => {
    for (const modes of [['friend', 'bot'], ['friend', 'solo'], ['solo']]) {
      expect(videoGameJsonLd(entry(modes), PAGE_URL)['numberOfPlayers'], modes.join()).toEqual({
        '@type': 'QuantitativeValue',
        minValue: 1,
        maxValue: 2,
      });
    }
  });

  it('derives the play modes from the modes the catalogue offers', () => {
    const playModeFor = (modes: readonly string[]) =>
      videoGameJsonLd(entry(modes), PAGE_URL)['playMode'];
    expect(playModeFor(['friend'])).toEqual(['MultiPlayer']);
    expect(playModeFor(['friend', 'bot'])).toEqual(['MultiPlayer', 'SinglePlayer']);
    expect(playModeFor(['friend', 'solo'])).toEqual(['MultiPlayer', 'SinglePlayer']);
    expect(playModeFor(['friend', 'bot', 'solo'])).toEqual(['MultiPlayer', 'SinglePlayer']);
    expect(playModeFor(['solo'])).toEqual(['SinglePlayer']);
  });
});

describe('serialising for a script element', () => {
  it('cannot be ended early by a closing tag in the text', () => {
    const rule = 'A rule with </script><script>alert(1)</script> in it.';
    const out = serialiseJsonLd(videoGameJsonLd(entry(['friend'], rule), PAGE_URL));
    expect(out).not.toContain('<');
    expect(out).toContain('\\u003c/script>');
  });

  it('stays valid JSON that decodes to what went in', () => {
    const block = videoGameJsonLd(entry(['friend'], 'A rule where a < b.'), PAGE_URL);
    const decoded: unknown = JSON.parse(serialiseJsonLd(block));
    expect(decoded).toEqual(block);
  });
});
