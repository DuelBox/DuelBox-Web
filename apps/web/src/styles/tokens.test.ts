import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colour, seatColour } from './tokens.js';

/**
 * The CSS and TS token files are two copies of one palette: components read the CSS,
 * canvas code reads the TS. Nothing in the type system stops them drifting, so this
 * test does — a colour changed in one file and not the other fails the build.
 */

// Comments stripped: a declaration is read as `--name: value;`, and the prose beside the seat
// aliases quotes one, so the first version of the swap guard matched a sentence.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/**
 * The first declaration of `--db-<name>`, with one `var()` hop resolved the same way.
 *
 * The seat colours are aliases since #161: `--db-p1` is `var(--db-seat-a)` and the hex lives on
 * the source, so that a swap can exchange the pair without a cycle. Following the hop keeps
 * this comparison what it always was — the value a `var(--db-p1)` in the shell actually paints
 * with, held to the TypeScript palette — rather than a comparison of one alias string.
 */
function cssVar(name: string): string {
  const match = new RegExp(`--db-${name}:\\s*([^;]+);`).exec(css);
  if (!match?.[1]) throw new Error(`--db-${name} is not defined in tokens.css`);
  const value = match[1].trim();
  const hop = /^var\(--db-([a-z0-9-]+)\)$/.exec(value);
  return hop?.[1] ? cssVar(hop[1]) : value;
}

/** camelCase in TS maps to kebab-case in CSS. */
function toCssName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

describe('design tokens', () => {
  it('defines every TypeScript colour in the stylesheet with the same value', () => {
    for (const [key, value] of Object.entries(colour)) {
      expect(cssVar(toCssName(key)), `--db-${toCssName(key)}`).toBe(value);
    }
  });

  it('uses lowercase six-digit hex everywhere, so string comparisons hold', () => {
    for (const [key, value] of Object.entries(colour)) {
      expect(value, key).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('maps each seat to a distinct player colour', () => {
    expect(seatColour.p1.base).toBe(colour.p1);
    expect(seatColour.p2.base).toBe(colour.p2);
    expect(seatColour.p1.base).not.toBe(seatColour.p2.base);
  });

  /**
   * The swap (#161) exchanges the whole pair and nothing else.
   *
   * Read from the stylesheet rather than from a browser: the two rules that define the seat
   * aliases are the only two, the plain one maps p1 to the warm source and p2 to the cool,
   * and the swapped one maps them the other way round — base, deep and tint alike, so a swap
   * that forgot the tint would leave a seat's fill and its territory wash in different pairs.
   * Watched failing with the tint line dropped from the swap rule.
   */
  it('exchanges every seat token under data-seat-swap, and only those', () => {
    const rule = (selector: string): Record<string, string> => {
      const block = new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
      const found: Record<string, string> = {};
      for (const match of css.matchAll(block)) {
        for (const line of (match[1] ?? '').matchAll(/(--db-p[12](?:-deep|-tint)?):\s*([^;]+);/g)) {
          if (line[1] && line[2]) found[line[1]] = line[2].trim();
        }
      }
      return found;
    };
    const plain = rule(':root');
    const swapped = rule(':root[data-seat-swap]');
    const parts = ['', '-deep', '-tint'];
    for (const part of parts) {
      expect(plain[`--db-p1${part}`]).toBe(`var(--db-seat-a${part})`);
      expect(plain[`--db-p2${part}`]).toBe(`var(--db-seat-b${part})`);
      expect(swapped[`--db-p1${part}`]).toBe(`var(--db-seat-b${part})`);
      expect(swapped[`--db-p2${part}`]).toBe(`var(--db-seat-a${part})`);
    }
    // No palette block declares the alias directly any more — a hex on `--db-p1` in the dark
    // or colour-blind block would win the cascade there and silently un-swap one theme.
    const direct = [...css.matchAll(/--db-p[12](?:-deep|-tint)?:\s*#/g)];
    expect(direct).toEqual([]);
  });

  it('carries colours and nothing else', () => {
    // The palette used to name the characters too, and that made it one of five places
    // in the shell able to say what a player is called. Names live in `lib/seats.ts`;
    // `seats.test.ts` fails if a second spelling appears anywhere. This fails if the
    // name comes back here, which is where it was.
    for (const entry of Object.values(seatColour)) {
      expect(Object.keys(entry).sort()).toEqual(['base', 'deep', 'tint']);
    }
  });

  it('keeps the touch target above the 44px web minimum', () => {
    // Two people share one device at arm's length, so the usual 44px floor is not enough.
    const target = Number.parseInt(cssVar('touch-target'), 10);
    expect(target).toBeGreaterThanOrEqual(48);
  });

  it('collapses motion durations under prefers-reduced-motion', () => {
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('--db-duration: 1ms');
    expect(reduced).toContain('--db-duration-slow: 1ms');
  });
});

/**
 * Every design token a stylesheet uses must actually exist.
 *
 * CSS fails silently: `background: var(--db-p1-soft)` where the token is really
 * `--db-p1-tint` does not warn, does not error, and does not paint — the declaration is
 * simply invalid and the element keeps whatever it had. That is exactly what happened to
 * the seat diagram on the How to play page, and it looked fine enough in a screenshot
 * that it could easily have shipped.
 *
 * There is no way to catch this in the cascade, so it is caught here.
 */
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) stylesheets(path, found);
    else if (path.endsWith('.css')) found.push(path);
  }
  return found;
}

/** Every custom property the stylesheets define, from anywhere. */
function definedTokens(sheets: string[]): Set<string> {
  const defined = new Set<string>();
  for (const path of sheets) {
    const css = readFileSync(path, 'utf8');
    for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
      const name = match[1];
      if (name) defined.add(name);
    }
  }
  return defined;
}

describe('the design tokens', () => {
  const sheets = stylesheets(web);
  const defined = definedTokens(sheets);

  it('finds the stylesheets to check', () => {
    expect(sheets.length).toBeGreaterThan(5);
    expect(defined.size, 'and the tokens they define').toBeGreaterThan(20);
  });

  it('is only ever asked for a token that exists', () => {
    const missing: string[] = [];
    for (const path of sheets) {
      const css = readFileSync(path, 'utf8');
      for (const match of css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        const name = match[1];
        // A `var()` with a fallback is fine even if the token is absent, because the
        // fallback is what paints — so only bare references are checked.
        if (!name || defined.has(name)) continue;
        const after = css.slice(match.index + match[0].length);
        if (after.startsWith(',')) continue;
        missing.push(`${path.slice(web.length + 1)} uses ${name}`);
      }
    }
    expect(missing, `undefined token: ${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * The palette is the only place a colour is written down.
 *
 * "CSS modules use the `var(--db-*)` tokens; no raw hex" has been a house rule for as long
 * as there have been house rules, and until this test it was enforced by nothing at all.
 * The block above only checks that a `var()` names a token that exists; a stylesheet that
 * declines to use `var()` and writes the colour out by hand walks past it, and past
 * `breakpoints.test.ts`, `motion.test.ts` and `safe-area.test.ts` too, none of which look at
 * colour. There is no stylelint in this repository to catch it either. It had already
 * drifted: thirteen `color: #fff` declarations across eight stylesheets on the day this was
 * written, every one of them the `--db-paper` white spelled a second way.
 *
 * That is not pedantry about spelling. A palette is only a palette while every use of it
 * goes through it — the moment a value is copied, changing the token stops changing the
 * page, and the copy is invisible in a diff of the file that matters. The same page already
 * carries the scar: `page.module.css` records a hand-copied `#a06f00` that shipped at
 * 3.93:1, below AA, because it was a colour nobody could see from the palette.
 *
 * ## What counts as writing one down
 *
 * The first version of this scanned for `#` and nothing else, and its own headline sentence
 * was false the day it was written twice over. `rgb()`, `hsl()`, `oklch()` and the CSS
 * colour keywords are colours a hand can write just as easily — `background: white` is the
 * thirteen-declaration drift above, spelled a third way — and there was already one live
 * `rgb(0 0 0 / 45%)` outside the palette when this was widened. And a colour is not only
 * written in CSS: `app/layout.tsx` carried `themeColor: '#4b3beb'`, the brand spelled a
 * second time in a TypeScript object, so changing `--db-brand` changed the page and left the
 * browser's own chrome on the old purple. So both halves are scanned: every colour form in a
 * stylesheet's *values*, and hex anywhere in the shell's TypeScript.
 *
 * Values rather than whole files, for the CSS half, because a class called `.gold` is a name
 * and not a colour. `transparent` and `currentColor` stay allowed: neither is a colour this
 * palette could hold — one is the absence of paint and the other is whatever the cascade
 * already decided — and `color-mix(in srgb, var(--db-ink) 62%, transparent)` is composing
 * tokens rather than inventing a value.
 *
 * ## The controls
 *
 * `tokens.css` and `styles/tokens.ts` are the exemptions and the only two, because they are
 * the files where a colour is supposed to be a literal. They are also this guard's controls:
 * the scanner is run over them and has to come back with the whole palette — hex *and* the
 * `rgb()` the shadow tokens are written in — which is what stops the comment-stripping below
 * from quietly turning the check into a pass over nothing. The keyword branch has no such
 * file to be run against, because nothing in this repository writes a keyword colour, so it
 * is controlled on two lines of input instead: one that is a colour and one, `white-space`,
 * that has a colour's name inside a property that is not one.
 */

/** The palette itself, where a colour literal is the point rather than a leak. */
const PALETTE = join(web, 'styles/tokens.css');

/** The same palette for canvas code, and exempt for the same reason. */
const PALETTE_TS = join(web, 'styles/tokens.ts');

/** `#abc`, `#abcd`, `#aabbcc`, `#aabbccdd` — every hex form CSS accepts. */
const HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

/**
 * Every function that names a colour rather than composing ones already named.
 *
 * `color-mix()` is deliberately absent and does not match `color\s*\(` either, the hyphen
 * seeing to that: mixing two tokens is using the palette, not going around it.
 */
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\([^)]*\)?/gi;

/**
 * The CSS named colours, all of them.
 *
 * All rather than the dozen anybody would actually type, because "which ones did whoever
 * wrote this think of?" is a question a reader should never have to ask of a guard. Not
 * `transparent` and not `currentcolor`, which are keywords rather than colours — see above.
 */
const NAMED_COLOURS =
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
  'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
  'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
  'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
  'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
  'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
  'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
  'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
  'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
  'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen ' +
  'linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
  'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
  'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
  'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
  'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
  'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
  'yellowgreen';

/**
 * A named colour as a whole word.
 *
 * The boundaries are `[\w-]` rather than `\b` on purpose: `\bwhite\b` matches the `white` in
 * `white-space`, which this file has seven of, and a guard that cries about `white-space:
 * nowrap` is a guard somebody deletes.
 */
const NAMED = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.split(' ').join('|')})(?![\\w-])`, 'gi');

/** Line numbers a reader can go to, counted in the same text the match was found in. */
function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length;
}

/**
 * Comments blanked out, newlines kept.
 *
 * Blanked rather than removed so that a reported line number is the line the reader will
 * find, and stripped rather than filtered afterwards because this repository writes issue
 * numbers as `#178` and `#2516`: a scanner that could not tell those from a colour would
 * report ten false positives on its first run and be deleted by the end of the week.
 */
function withoutComments(source: string, lineComments: boolean): string {
  const blank = (comment: string): string => comment.replace(/[^\n]/g, ' ');
  const blocks = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  return lineComments ? blocks.replace(/\/\/[^\n]*/g, blank) : blocks;
}

/**
 * Every colour written by hand in one stylesheet, as `file:line value`.
 *
 * Declaration values only — everything from a `:` to the end of the declaration — so a
 * selector, a property name and an `@media` feature are all outside it.
 */
function rawColours(source: string, label: string): string[] {
  const code = withoutComments(source, false);
  const found: string[] = [];
  for (const declaration of code.matchAll(/:[^;{}]*/g)) {
    for (const pattern of [HEX, COLOUR_FUNCTION, NAMED]) {
      for (const match of declaration[0].matchAll(pattern)) {
        const at = declaration.index + match.index;
        found.push(`${label}:${String(lineOf(code, at))} ${match[0].trim()}`);
      }
    }
  }
  return found;
}

/** The same question of a TypeScript file, where the form that has ever appeared is hex. */
function hexInSource(source: string, label: string): string[] {
  const code = withoutComments(source, true);
  return [...code.matchAll(HEX)].map(
    (match) => `${label}:${String(lineOf(code, match.index))} ${match[0]}`,
  );
}

/** Every module the shell is built from, tests aside: they hold fixtures, and fixtures hold colours. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

const named = (path: string): string => path.slice(web.length + 1);
const read = (path: string): string => readFileSync(path, 'utf8');

describe('colour lives in the palette', () => {
  const sheets = stylesheets(web);

  it('can see a colour at all, which is what makes the next tests mean something', () => {
    // Run against the two files that are allowed to be full of them. If a pattern or the
    // comment stripper ever stops working, this goes to nothing and says so here, rather
    // than letting the checks below pass by finding nothing anywhere.
    const palette = rawColours(read(PALETTE), 'tokens.css');
    expect(palette.filter((hit) => hit.includes('#')).length, 'hex in tokens.css').toBeGreaterThan(
      20,
    );
    expect(
      palette.filter((hit) => hit.includes('rgb(')).length,
      'rgb() in tokens.css — the shadow tokens, and the branch no hex control can cover',
    ).toBeGreaterThan(2);
    expect(hexInSource(read(PALETTE_TS), 'tokens.ts').length, 'hex in tokens.ts').toBeGreaterThan(
      20,
    );
  });

  it('can tell a colour keyword from a property that has one inside its name', () => {
    // The branch with no real file to be run against: nothing in this repository writes a
    // keyword colour, so a scan of the tree cannot prove this pattern works, and an inert
    // pattern would be indistinguishable from a clean result.
    expect(rawColours('.a { background: white; }', 'probe')).toEqual(['probe:1 white']);
    expect(rawColours('.a { white-space: nowrap; }', 'probe')).toEqual([]);
  });

  it('and no stylesheet writes one by hand', () => {
    const raw = sheets
      .filter((path) => path !== PALETTE)
      .flatMap((path) => rawColours(read(path), named(path)));
    expect(
      raw,
      `write the colour as a var(--db-*) token from styles/tokens.css: ${raw.join(', ')}`,
    ).toEqual([]);
  });

  it('and no module writes one either, where no stylesheet can see it', () => {
    const raw = sources(web)
      .filter((path) => path !== PALETTE_TS)
      .flatMap((path) => hexInSource(read(path), named(path)));
    expect(
      raw,
      `read the colour from styles/tokens.ts rather than spelling it again: ${raw.join(', ')}`,
    ).toEqual([]);
  });
});

describe("the catalogue card's seat marks", () => {
  // Rule 7 applies to the shell as much as to a game, and this is the seat signal a player
  // meets first. The greyscale harness in `apps/web/src/data` walks games and never looks
  // at a stylesheet, so nothing was holding this: both marks were 7px circles differing
  // only in `background` (#2518).
  const card = readFileSync(join(here, '../components/GameCard.module.css'), 'utf8');

  const radiusOf = (selector: string): string => {
    const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(card)?.[1] ?? '';
    return /border-radius:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? '';
  };

  it('gives each seat a different shape, not just a different colour', () => {
    const p1 = radiusOf('.p1');
    const p2 = radiusOf('.p2');
    expect(p1, '.p1 declares no border-radius').not.toBe('');
    expect(p2, '.p2 declares no border-radius').not.toBe('');
    expect(p2, `both seat marks are ${p1}, so colour is the only signal`).not.toBe(p1);
  });

  it('uses the same shapes as SeatGlyph, so the catalogue and the match agree', () => {
    // A disc and a rounded square. If SeatGlyph's language changes, this should too —
    // two visual languages for one seat is worse than one imperfect language.
    const glyph = readFileSync(join(here, '../components/SeatGlyph.tsx'), 'utf8');
    expect(glyph, 'SeatGlyph no longer draws p1 as a circle').toContain('<circle');
    expect(glyph, 'SeatGlyph no longer draws p2 as a rounded rect').toContain('<rect');
    expect(radiusOf('.p1'), 'p1 is the disc in both places').toBe('50%');
    expect(radiusOf('.p2'), 'p2 is the rounded square in both places').not.toBe('50%');
  });
});
