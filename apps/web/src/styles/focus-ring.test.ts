import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The focus ring clears 3:1 on every background the site puts a control on (#176).
 *
 * WCAG 2.4.11 asks a focus indicator for a 3:1 contrast against the adjacent colours. A
 * single-colour ring cannot give that everywhere at once: the brand indigo the site drew
 * before this reached 1:1 on the indigo brand button and 2.5:1 on a dark surface, both
 * below the bar and both real controls. So the ring is two colours — `--db-focus-ring` as
 * the outline against the page and `--db-focus-halo` as a casing against the control — and
 * the property that makes the pair sufficient is that for **every** background token at
 * least one of the two clears 3:1. That is what globals.css relies on and what this checks,
 * in both the light and the dark palette, because the tokens differ between them.
 *
 * Parsed from `tokens.css` rather than hard-coded, so a value edited there is judged here
 * rather than silently diverging — the same reason `tokens.test.ts` reads the stylesheet.
 */

// Comments stripped: the alias block's prose names tokens in the same shape as a declaration.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The declarations inside `:root { … }` — the light palette, which is defined first. */
function lightBlock(): string {
  const start = css.indexOf(':root {');
  // The first `}` at the start of a line closes the bare `:root` block; the tokens inside
  // never sit at column zero, so this cannot end early on a nested brace.
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

/** The declarations inside the explicit `:root[data-theme='dark'] { … }` block. */
function darkBlock(): string {
  const start = css.indexOf("[data-theme='dark'] {");
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

/** A token's value within a block of declarations, or the light value as a fallback. */
function tokenIn(block: string, name: string): string {
  const match = new RegExp(`--db-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (match?.[1]) return match[1];
  // Dark overrides only a subset; anything it does not touch keeps the light value.
  const light = new RegExp(`--db-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(lightBlock());
  if (light?.[1]) return light[1];
  // The seat tokens are aliases since #161 — `--db-p1` is `var(--db-seat-a)`, one hop from
  // a hex — so a `var()` is followed, in the same block first, like `tokens.test.ts` does.
  // The first alias in the file is the un-swapped one; the swap crosses the same two
  // colours over, so judging that pair against every background judges both orders.
  const alias = new RegExp(`--db-${name}:\\s*var\\(--db-([a-z0-9-]+)\\)`).exec(css);
  if (alias?.[1]) return tokenIn(block, alias[1]);
  throw new Error(`--db-${name} is not a hex token in tokens.css`);
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every token a focusable control, or the page immediately around it, may present as its
 * background. Canvas games draw no DOM focus ring, so this is the shell's control palette:
 * paper and surface grounds, the brand and seat fills a button or chip can take, the tinted
 * washes a selected control sits on, and the status colours.
 */
const BACKGROUNDS = [
  'paper',
  'surface',
  'brand',
  'brand-deep',
  'brand-tint',
  'p1',
  'p2',
  'p1-tint',
  'p2-tint',
  'sun',
  'grass',
  'ink',
  'body',
  'danger',
  'success',
] as const;

const MIN = 3;

describe.each([
  ['the light palette', lightBlock()],
  ['the dark palette', darkBlock()],
])('the focus ring against %s', (_label, block) => {
  const ring = tokenIn(block, 'focus-ring');
  const halo = tokenIn(block, 'focus-halo');

  it('names two distinct ring colours', () => {
    expect(ring).not.toBe(halo);
  });

  it('clears 3:1 with at least one of its two colours on every background', () => {
    const failures: string[] = [];
    for (const name of BACKGROUNDS) {
      const bg = tokenIn(block, name);
      const best = Math.max(contrast(ring, bg), contrast(halo, bg));
      if (best < MIN) failures.push(`--db-${name} (${bg}): best ${best.toFixed(2)}:1`);
    }
    expect(failures, `focus ring below ${String(MIN)}:1 on: ${failures.join(', ')}`).toEqual([]);
  });

  it('is a genuine two-colour rescue, not one colour doing all the work', () => {
    // If a single colour already cleared every background, the second would be decoration
    // and a regression that broke it would pass unnoticed. This proves the pair is load
    // bearing: on some background each colour is the one below the bar.
    const ringAlonePasses = BACKGROUNDS.every(
      (name) => contrast(ring, tokenIn(block, name)) >= MIN,
    );
    const haloAlonePasses = BACKGROUNDS.every(
      (name) => contrast(halo, tokenIn(block, name)) >= MIN,
    );
    expect(ringAlonePasses || haloAlonePasses, 'one colour alone covers every background').toBe(
      false,
    );
  });
});
