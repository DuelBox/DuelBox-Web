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
import { CATALOGUE } from '../data/catalogue.generated';
import { DYNAMIC_SOURCES } from '../lib/i18n/sources';

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

/**
 * The mode line is translated as one string, and the words it is built from live twice.
 *
 * The card joins `MODE_LABEL` with a middle dot and hands the joined line to `<T>`, so what a
 * locale translates is "Two players · vs Bot" rather than three words a page assembles — one
 * text node, as the export has always had. The extractor cannot see a variable, so the same
 * lines are computed in `lib/i18n/sources.ts`, and it cannot import this file to share the
 * labels: vitest transforms no JSX in this project, so a `.ts` importing a `.tsx` fails to
 * parse. That leaves two copies of three words, which is exactly the shape this repository
 * keeps finding rotted — so it is read rather than trusted. A label renamed on one side and
 * not the other fails here, in a second, rather than showing plain English on a
 * pseudo-localised card that nobody is looking at.
 */
describe('the mode line a locale translates', () => {
  /** The labels as written in the card, read out of the object literal. */
  function labels(source: string): Record<string, string> {
    const block = /const MODE_LABEL: Record<string, string> = \{([^}]*)\}/.exec(source)?.[1] ?? '';
    const found: Record<string, string> = {};
    for (const match of block.matchAll(/(\w+): '([^']*)'/g)) {
      const mode = match[1];
      const label = match[2];
      if (mode !== undefined && label !== undefined) found[mode] = label;
    }
    return found;
  }

  /** Every line the cards can show, from the labels this file actually holds. */
  function rendered(source: string): string[] {
    const map = labels(source);
    return [...new Set(CATALOGUE.map((game) => game.modes.map((m) => map[m] ?? m).join(' · ')))];
  }

  it('registers every line the 108 cards can render, and nothing else', () => {
    const map = labels(tsx);
    expect(Object.keys(map), 'MODE_LABEL is no longer an object of string literals').toContain(
      'friend',
    );
    const source = DYNAMIC_SOURCES.find((entry) => entry.name === 'catalogue mode lines');
    expect(source, 'sources.ts no longer registers the mode lines').toBeDefined();
    const registered = new Set(source?.strings() ?? []);
    const shown = rendered(tsx);
    expect(shown.length, 'the catalogue renders no mode line at all').toBeGreaterThan(0);
    expect(
      shown.filter((line) => !registered.has(line)),
      'the card renders a mode line sources.ts does not register: it will be plain English' +
        ' in every locale. Change both, or neither.',
    ).toEqual([]);
    expect(
      [...registered].filter((line) => !shown.includes(line)),
      'sources.ts registers a mode line no card renders, which i18n.test.ts calls an orphan',
    ).toEqual([]);
  });

  it('reads the labels rather than anything shaped like them', () => {
    expect(
      labels("const MODE_LABEL: Record<string, string> = {\n  friend: 'Two players',\n};"),
    ).toEqual({ friend: 'Two players' });
    // A reader that had stopped matching would return nothing and pass the test above by
    // comparing two empty lists.
    expect(labels('const SOMETHING_ELSE = { friend: 1 };')).toEqual({});
  });
});
