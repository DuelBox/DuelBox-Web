import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MOTION,
  REDUCED_MOTION_SECONDS,
  motionDuration,
  standardEase,
} from '@duelbox/engine/motion';
import { colour, motion, seatColour } from './tokens.js';

/**
 * The CSS and TS token files are two copies of one palette: components read the CSS,
 * canvas code reads the TS. Nothing in the type system stops them drifting, so this
 * test does — a colour changed in one file and not the other fails the build.
 */

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

function cssVar(name: string): string {
  const match = new RegExp(`--db-${name}:\\s*([^;]+);`).exec(css);
  if (!match?.[1]) throw new Error(`--db-${name} is not defined in tokens.css`);
  return match[1].trim();
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
 * The motion signature is one set of numbers, and this is what holds it to one (#72).
 *
 * There are two motion layers in this product and they cannot share a mechanism. The shell
 * moves in CSS, timed by `--db-duration*` and eased by `--db-ease`, with the cascade as the
 * reduced-motion lever. Games move through `Tween` on the fixed timestep, in an engine that
 * has no DOM — lint forbids `window` and `document` in that package — so it can neither read
 * a custom property nor be handed one, and its durations are seconds rather than
 * milliseconds because that is what the timestep counts in.
 *
 * What they can share is the table. `MOTION` is authored in `@duelbox/engine`, because the
 * dependency only points one way: the engine cannot import this app and this app already
 * imports the engine. `tokens.ts` restates it in the spellings CSS wants, and this parses
 * `tokens.css` and fails when a value there has drifted from the table. Three copies, one
 * decision, and a failing test the moment that stops being true.
 *
 * Written as a function over a source string rather than as assertions over `css`, so the
 * check can be run against a stylesheet with a value planted in it — see the control below.
 * The twelfth entry in CLAUDE.md is about a guard whose greedy comment stripper made it pass
 * with the plant still in place, and the only reason that was caught is that it had a control
 * on real input.
 */
function motionDrift(source: string): string[] {
  const drift: string[] = [];
  const declared = (name: string): string | undefined =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(source)?.[1]?.trim();

  const durations: readonly (readonly [string, number])[] = [
    ['--db-duration-fast', MOTION.durationFastSeconds],
    ['--db-duration', MOTION.durationSeconds],
    ['--db-duration-slow', MOTION.durationSlowSeconds],
  ];
  for (const [name, seconds] of durations) {
    const want = `${String(Math.round(seconds * 1000))}ms`;
    const got = declared(name);
    if (got !== want) {
      drift.push(
        `${name} is ${got ?? 'undeclared'} in tokens.css and ${want} (${String(seconds)}s) in the engine MOTION table`,
      );
    }
  }

  const ease = declared('--db-ease');
  const wantEase = `cubic-bezier(${MOTION.ease.join(', ')})`;
  if (ease !== wantEase) {
    drift.push(
      `--db-ease is ${ease ?? 'undeclared'} in tokens.css and ${wantEase} in the engine MOTION table`,
    );
  }

  // The reduced-motion collapse is the same lever stated once more, and the JS layer's
  // `motionDuration` answers with the same number in seconds. A stylesheet that collapsed to
  // something else would leave the two halves disagreeing about what "instant" is.
  const reduced = source.slice(source.indexOf('prefers-reduced-motion'));
  const instant = `${String(Math.round(REDUCED_MOTION_SECONDS * 1000))}ms`;
  for (const [name] of durations) {
    if (!reduced.includes(`${name}: ${instant}`)) {
      drift.push(`${name} does not collapse to ${instant} under prefers-reduced-motion`);
    }
  }

  return drift;
}

describe('the motion signature is shared with the JS tween layer', () => {
  it('gives the stylesheet and the engine the same durations and curve', () => {
    expect(motionDrift(css)).toEqual([]);
  });

  it('reports a stylesheet that has drifted from the table', () => {
    // The control. `motionDrift` returning nothing is only evidence if it can return
    // something, and a duration changed by ten milliseconds is exactly the drift this is
    // here to catch: valid CSS, plausible, and invisible to every other check in this file.
    const planted = css.replace('--db-duration: 200ms', '--db-duration: 210ms');
    expect(planted, 'the plant did not apply — tokens.css has been rewritten').not.toBe(css);
    expect(motionDrift(planted)).toEqual([
      '--db-duration is 210ms in tokens.css and 200ms (0.2s) in the engine MOTION table',
    ]);

    const bent = css.replace('cubic-bezier(0.2, 0.8, 0.2, 1)', 'cubic-bezier(0.2, 0.8, 0.4, 1)');
    expect(bent).not.toBe(css);
    expect(motionDrift(bent)).toEqual([
      '--db-ease is cubic-bezier(0.2, 0.8, 0.4, 1) in tokens.css and cubic-bezier(0.2, 0.8, 0.2, 1) in the engine MOTION table',
    ]);

    const uncollapsed = css.replace('--db-duration-fast: 1ms', '--db-duration-fast: 120ms');
    expect(uncollapsed).not.toBe(css);
    expect(motionDrift(uncollapsed)).toEqual([
      '--db-duration-fast does not collapse to 1ms under prefers-reduced-motion',
    ]);
  });

  it('spells the table for CSS without rounding it away', () => {
    // `tokens.ts` multiplies by a thousand, and in IEEE 754 `0.12 * 1000` is
    // 120.00000000000001 — a token of `120.00000000000001ms` is valid CSS, and nothing else
    // in this file would have looked at it.
    expect(motion.durationFast).toBe(cssVar('duration-fast'));
    expect(motion.duration).toBe(cssVar('duration'));
    expect(motion.durationSlow).toBe(cssVar('duration-slow'));
    expect(motion.ease).toBe(cssVar('ease'));
    for (const value of [motion.durationFast, motion.duration, motion.durationSlow]) {
      expect(value).toMatch(/^\d+ms$/);
    }
  });

  it('eases exactly as the curve the stylesheet names', () => {
    // `standardEase` is the same four control points CSS is given, solved. Endpoints first,
    // because a tween that does not land exactly on its destination is the defect
    // `easeOutBack`'s docstring records; then the midpoint, which is where a bezier
    // implementation that solved `y(t)` directly instead of inverting `x` would differ.
    expect(standardEase(0)).toBe(0);
    expect(standardEase(1)).toBe(1);
    // 0.946 at the midpoint: `cubic-bezier(0.2, 0.8, 0.2, 1)` is a hard decelerate, and the
    // number is worth stating because it is the one a reader would guess wrong. Solved by
    // hand from `X(u) = u³ - 0.6u² + 0.6u = 0.5`, u = 0.7235, `Y(u) = 0.9456`.
    expect(standardEase(0.5)).toBeCloseTo(0.9461, 4);
    expect(standardEase(0.25)).toBeGreaterThan(0.25);
    for (let t = 0; t <= 1; t += 1 / 64) {
      expect(standardEase(t), `standardEase(${String(t)})`).toBeGreaterThanOrEqual(
        standardEase(Math.max(0, t - 1 / 64)),
      );
    }
  });

  it('collapses a JS duration the way the cascade collapses a CSS one', () => {
    expect(motionDuration(MOTION.durationSeconds, false)).toBe(MOTION.durationSeconds);
    expect(motionDuration(MOTION.durationSeconds, undefined)).toBe(MOTION.durationSeconds);
    expect(motionDuration(MOTION.durationSeconds, true)).toBe(REDUCED_MOTION_SECONDS);
    expect(Math.round(REDUCED_MOTION_SECONDS * 1000)).toBe(1);
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

/**
 * The layer ladder and the spacing grid, held the same way the palette is (#70).
 *
 * The spacing, radius and shadow tokens have existed since the first stylesheet. What did
 * not exist was any reason to use them, and the two halves of #70 are what that cost.
 *
 * **Layers.** Twelve `z-index` declarations across nine files, every one a bare number
 * chosen by whoever wrote the file: 2, 3, 4, 4, 5, 5, 6, 7, 40, 100, 100, 200. Nothing
 * named a layer, so nothing could be read without opening nine files and sorting them by
 * hand — and the ordering genuinely matters here, because `PlaySurface` is
 * `position: relative` with no `z-index`, which is not a stacking context: an overlay
 * inside the board and a bar fixed to the viewport are painted against each other. A
 * number picked by looking at the file next door is a number that works until the file
 * next door moves.
 *
 * **Spacing.** Five stylesheets carried raw-pixel padding on key caps and badges. Those
 * are small values and none of them was wrong, which is exactly the shape the colour guard
 * above records: a scale is only a scale while every use goes through it, and a copied
 * value is invisible in the diff of the file that matters.
 *
 * ## The escape hatch, and why it is a marker rather than a list
 *
 * Some values are deliberately not on the 4px grid. A key cap's 6px sits between two rungs
 * and belongs to the glyph rather than the layout; the 2px above a badge exists so the
 * badge does not grow the line it sits in; `.db-visually-hidden`'s `-1px` is half of a clip
 * rectangle and not spacing at all. A guard that refuses those is a guard somebody deletes,
 * and a guard with an allow-list of blessed pixel values is a second scale nobody named.
 *
 * So a raw pixel is allowed on a line that says `off-scale:` and why — the same shape as
 * `physical:` in `direction.test.ts`, and readable in the stylesheet rather than in here.
 * The marker excuses **its own line only**, which is the property worth testing: a stripper
 * or a regex that let a marker cover the rest of a rule would turn the whole check into a
 * pass, and that is the failure mode the twelfth CLAUDE.md entry was written about.
 *
 * ## The controls
 *
 * Neither branch has a file that is supposed to be full of what it looks for — the palette
 * could be run over `tokens.css`, and there is no equivalent here — so both are run over a
 * fixture that is: a raw `z-index: 5` and a `padding: 13px` must come back as two hits,
 * with their line numbers. That covers the patterns and the reporting.
 *
 * What a fixture cannot cover is whether the scanner reaches real declarations at all, and
 * a property regex that quietly matched nothing would look identical to a clean tree. So
 * the last control counts the excused lines in the real stylesheets: the shell has six, and
 * a run that finds none has stopped reading CSS rather than found it tidy.
 */

/** A rung of the ladder, or `auto`. `!important` is stripped before the comparison. */
const LAYER_TOKEN = /^var\(\s*--db-z-[a-z0-9-]+\s*\)$|^auto$/;

/** `padding`, `margin`, and every longhand either of them has. */
const SPACING_PROPERTY =
  /(?<![\w-])(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:([^;{}]*)/g;

/** A length in pixels, signed and possibly fractional, anywhere inside a value. */
const PIXELS = /-?\d*\.?\d+px/g;

/** The word that excuses a pixel, on the line the pixel is on and no other. */
const OFF_SCALE = 'off-scale:';

/** Every `z-index` in one stylesheet that is not a rung of the scale, as `file:line value`. */
function rawLayers(source: string, label: string): string[] {
  const code = withoutComments(source, false);
  const found: string[] = [];
  for (const match of code.matchAll(/(?<![\w-])z-index\s*:([^;{}]*)/g)) {
    const value = (match[1] ?? '').replace(/!important/g, '').trim();
    if (LAYER_TOKEN.test(value)) continue;
    found.push(`${label}:${String(lineOf(code, match.index))} z-index: ${value}`);
  }
  return found;
}

/**
 * Every raw pixel in a `padding` or `margin` in one stylesheet, as `file:line value`.
 *
 * Zero is always fine — `max(0px, var(--db-safe-left))` is a floor, not a measurement — and
 * so is anything on a line carrying the marker. The marker is looked for in the *original*
 * source, because blanking comments is what makes the scan possible in the first place.
 */
function rawSpacing(source: string, label: string): string[] {
  const code = withoutComments(source, false);
  const lines = source.split('\n');
  const found: string[] = [];
  for (const declaration of code.matchAll(SPACING_PROPERTY)) {
    const value = declaration[1] ?? '';
    const from = declaration.index + declaration[0].length - value.length;
    for (const pixels of value.matchAll(PIXELS)) {
      if (Number.parseFloat(pixels[0]) === 0) continue;
      const line = lineOf(code, from + pixels.index);
      if (lines[line - 1]?.includes(OFF_SCALE)) continue;
      const where = declaration[0].trim().replace(/\s+/g, ' ');
      found.push(`${label}:${String(line)} ${pixels[0]} in ${where}`);
    }
  }
  return found;
}

/** The lines a stylesheet has excused, so the escape hatch can be counted rather than trusted. */
function excused(source: string): number {
  return source.split('\n').filter((line) => line.includes(OFF_SCALE)).length;
}

const FIXTURE = [
  '.a {',
  '  z-index: 5;',
  '  padding: 13px;',
  '}',
  '.b {',
  '  z-index: var(--db-z-cover);',
  '  padding: 0 var(--db-space-2);',
  '  margin-left: max(0px, var(--db-safe-left)); /* physical: side of the device */',
  '  padding-block: 2px; /* off-scale: a key cap, between two rungs */',
  '}',
].join('\n');

describe('layers and spacing live in the scale', () => {
  const sheets = stylesheets(web).filter((path) => path !== PALETTE);

  it('can see a raw layer and a raw pixel at all, which is what the next tests rest on', () => {
    // No file in this repository is supposed to be full of either, so the pattern is proved
    // against one that is. An inert regex would otherwise be indistinguishable from a tidy
    // tree — see the header.
    expect(rawLayers(FIXTURE, 'fixture')).toEqual(['fixture:2 z-index: 5']);
    expect(rawSpacing(FIXTURE, 'fixture')).toEqual(['fixture:3 13px in padding: 13px']);
  });

  it('excuses a pixel only on the line that says why', () => {
    // The marker covers its own line. If it ever covered the rule, or the file, this check
    // would be the only thing between that and a guard that cannot fail.
    const leaky = '.a {\n  padding: 3px; /* off-scale: deliberate */\n  margin: 9px;\n}';
    expect(rawSpacing(leaky, 'probe')).toEqual(['probe:3 9px in margin: 9px']);
    // And it has to be *that* marker: `physical:` answers a different question.
    expect(rawSpacing('.a {\n  padding: 9px; /* physical: left edge */\n}', 'probe')).toEqual([
      'probe:2 9px in padding: 9px',
    ]);
  });

  it('reads a property name and not a word that contains one', () => {
    expect(rawSpacing('.a {\n  --card-padding: 13px;\n}', 'probe')).toEqual([]);
    expect(rawSpacing('.a {\n  scroll-margin: 13px;\n}', 'probe')).toEqual([]);
  });

  it('finds the stylesheets, and the off-scale lines they really carry', () => {
    expect(sheets.length, 'stylesheets to scan').toBeGreaterThan(5);
    const marked = sheets.map(read).reduce((total, css) => total + excused(css), 0);
    expect(
      marked,
      'no stylesheet excuses a pixel — the scan has stopped reading CSS',
    ).toBeGreaterThan(3);
  });

  it('and every z-index names a layer from styles/tokens.css', () => {
    const raw = sheets.flatMap((path) => rawLayers(read(path), named(path)));
    expect(
      raw,
      `use a var(--db-z-*) rung so the stacking order is readable in one file: ${raw.join(', ')}`,
    ).toEqual([]);
  });

  it('and no padding or margin is measured in raw pixels', () => {
    const raw = sheets.flatMap((path) => rawSpacing(read(path), named(path)));
    expect(
      raw,
      `use a var(--db-space-*) token, or say /* off-scale: why */ on the line: ${raw.join(', ')}`,
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
