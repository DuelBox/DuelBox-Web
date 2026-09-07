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
 * `tokens.css` is the exemption and the only one, because it is the file where a colour is
 * supposed to be a literal. It is also this guard's control: the scanner is run over it and
 * has to come back with the whole palette, which is what stops the comment-stripping below
 * from quietly turning the whole check into a pass over nothing.
 */

/** The palette itself, where a hex literal is the point rather than a leak. */
const PALETTE = join(web, 'styles/tokens.css');

/**
 * Hex colours, with comments taken out first.
 *
 * Comments are stripped rather than filtered afterwards because this repository writes issue
 * numbers as `#178` and `#2516`, and a scanner that could not tell those from a colour would
 * report ten false positives on its first run and be deleted by the end of the week.
 * Newlines are preserved so a reported line number is the line the reader will find.
 */
function hexColours(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  return [...code.matchAll(/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi)].map((match) => {
    const line = code.slice(0, match.index).split('\n').length;
    return `${path.slice(web.length + 1)}:${String(line)} ${match[0]}`;
  });
}

describe('colour lives in the palette', () => {
  const sheets = stylesheets(web);

  it('can see a hex literal at all, which is what makes the next test mean something', () => {
    // Run against the one file that is allowed to be full of them. If the regex or the
    // comment stripper ever stops working, this goes to nothing and says so here, rather
    // than letting the check below pass by finding nothing anywhere.
    expect(hexColours(PALETTE).length, 'hex literals in tokens.css').toBeGreaterThan(20);
  });

  it('and nowhere else writes one by hand', () => {
    const raw = sheets.filter((path) => path !== PALETTE).flatMap(hexColours);
    expect(
      raw,
      `write the colour as a var(--db-*) token from styles/tokens.css: ${raw.join(', ')}`,
    ).toEqual([]);
  });
});
