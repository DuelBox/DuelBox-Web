import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
