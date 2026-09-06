import type { CatalogueEntry } from '../data/catalogue.generated';

/**
 * The schema.org description of one game, for the `<script type="application/ld+json">`
 * block on its page (#198).
 *
 * Built from the catalogue entry rather than written by hand, so a hundred and seven pages
 * cannot drift from the catalogue they describe and the hundred and eighth gets its block
 * for free. Everything in it is something the page already says in prose — the name, the
 * rule, the category, who it is for — restated in the vocabulary a search engine reads.
 *
 * No `aggregateRating`, deliberately. Nothing in this product measures one — there are no
 * accounts and no server to count anything with — and Google's Rich Results test flags an
 * invented rating rather than rewarding it.
 */
export function videoGameJsonLd(game: CatalogueEntry, url: string): Record<string, unknown> {
  // A bot or a solo mode can fill the other seat, so one person is enough; otherwise the
  // game needs two. Never more than two, whatever the mode — every game here is a duel.
  const single = game.modes.includes('bot') || game.modes.includes('solo');
  const playMode: string[] = [];
  if (game.modes.includes('friend')) playMode.push('MultiPlayer');
  if (single) playMode.push('SinglePlayer');

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.name,
    description: game.rule,
    url,
    genre: game.category,
    applicationCategory: 'Game',
    gamePlatform: 'Web browser',
    operatingSystem: 'Any',
    isAccessibleForFree: true,
    numberOfPlayers: {
      '@type': 'QuantitativeValue',
      minValue: single ? 1 : 2,
      maxValue: 2,
    },
    playMode,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

/**
 * JSON for embedding inside a `<script>` element.
 *
 * `JSON.stringify` alone is not safe there. The HTML parser ends a script block at the first
 * `</script>` whatever the JSON thinks, so a rule containing that text would close the
 * element early and hand the rest of the block to the parser as markup. Escaping every `<`
 * as `\u003c` keeps the output valid JSON — the escape decodes straight back to `<` — and
 * unable to end the block, whatever the catalogue says.
 */
export function serialiseJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
