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

  it('names both characters, so no screen has to invent a label', () => {
    expect(seatColour.p1.name).toBe('Pip');
    expect(seatColour.p2.name).toBe('Bo');
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
