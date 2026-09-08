/**
 * What a card shows and how it moves (#82), read from the two files that decide it.
 *
 * The card is a server component and must stay one — `lib/landing.test.ts` walks the
 * landing page's import graph and fails on a client directive in it — so everything #82
 * asks for has to be markup or CSS. That is what makes it readable from here: there is no
 * component to mount, only a stylesheet with two media queries in it and a template with
 * five facts on it, and either can lose a line without a browser noticing.
 *
 * `styles/motion.test.ts` already proves the loop is timed by a token and has a
 * reduced-motion block. This holds the two things it does not look for: that the loop is
 * gated on hover *and* keyboard focus rather than hover alone, and that `prefers-reduced-data`
 * — which no other stylesheet in the shell mentions — switches it off too.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
const css = read('./GameCard.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
const tsx = read('./GameCard.tsx');

describe('the preview loop', () => {
  it('runs on hover and on keyboard focus, on the tile and not the card', () => {
    // `:focus-visible` rather than `:focus`: a card pressed with a thumb takes focus too, and
    // a loop that started under a finger would be a loop nobody asked for.
    // `animation: preview`, not merely `animation:` — the reduced-motion gate below uses the
    // same selector pair with `animation: none`, and the first draft of this assertion was
    // satisfied by that block alone with the loop itself deleted.
    expect(css).toMatch(
      /\.card:hover \.art use,\s*\.card:focus-visible \.art use\s*\{[^}]*animation: preview/,
    );
  });

  it('is timed by a duration token, so the reduced-motion block can collapse it', () => {
    const block = /\.card:focus-visible \.art use\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/animation:[^;]*var\(--db-duration/);
  });

  it('is switched off outright under reduced motion and under reduced data', () => {
    // Both preferences in one query list, and `animation: none` inside it. A loop at 1ms
    // would already be invisible; switching it off is what a reader of the file can see.
    const gate =
      /@media \(prefers-reduced-motion: reduce\), \(prefers-reduced-data: reduce\)\s*\{([\s\S]*?)\n\}/.exec(
        css,
      )?.[1];
    expect(gate, 'no combined reduced-motion / reduced-data block').toBeDefined();
    expect(gate).toMatch(
      /\.card:hover \.art use,\s*\.card:focus-visible \.art use\s*\{\s*animation: none;/,
    );
  });

  it('costs no asset and no script', () => {
    // The whole reason the preview can exist on 108 cards: it is the tile's own `<use>`
    // references moving. A `url(` here would be an image being fetched per card.
    expect(css).not.toMatch(/url\(/);
    expect(tsx).not.toMatch(/^'use client'/m);
    expect(tsx).not.toMatch(/onMouseEnter|onFocus|useEffect|useState/);
  });
});

describe('what the card says', () => {
  it('carries the name, the category, the round length and who can play', () => {
    expect(tsx).toContain('{game.name}');
    expect(tsx).toContain('{game.category}');
    expect(tsx).toContain('formatRound(game.roundSeconds)');
    expect(tsx).toContain('game.modes.map');
  });

  it('is one link, with nothing focusable inside it', () => {
    // One tab stop. The star is a sibling in `CatalogBrowser` for exactly this reason — a
    // button cannot live inside a link — so anything focusable rendered here would be a
    // second stop on every one of 108 cards.
    const body = tsx.slice(tsx.indexOf('<Link'), tsx.lastIndexOf('</Link>'));
    expect(body).not.toMatch(/<button|<input|<a |tabIndex/);
  });
});
