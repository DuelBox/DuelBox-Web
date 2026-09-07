import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The dark theme (#76): it exists, it inverts the neutral ramp, and its two copies agree.
 *
 * The light palette is the bare `:root` and is covered by `tokens.test.ts`. This is about
 * the override: that a dark ground actually swaps the roles of ink and surface rather than
 * darkening a few odd tokens, and that the two selectors carrying the dark values — the
 * explicit `[data-theme='dark']` a scripted visitor takes and the `prefers-color-scheme`
 * fallback a scriptless one takes — hold the identical palette. Plain CSS cannot share one
 * declaration across a media-query boundary, so the file repeats it; this is the guard that
 * turns that duplication into something that cannot drift.
 */

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

/** The `{ … }` body that begins at `marker`, matched by brace depth so a nested rule (the
 *  media query wrapping the fallback block) does not end it early. */
function bodyAt(marker: string): string {
  const from = css.indexOf(marker);
  if (from < 0) throw new Error(`tokens.css has no ${marker}`);
  const open = css.indexOf('{', from);
  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
    i += 1;
  }
  return css.slice(open + 1, i - 1);
}

/** Every `--db-…` token and the `color-scheme` in a block, as a map of name to value. */
function tokens(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of block.matchAll(/(--db-[a-z0-9-]+|color-scheme):\s*([^;]+);/gi)) {
    const name = match[1];
    const value = match[2];
    if (name && value) map.set(name, value.trim());
  }
  return map;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

const light = tokens(bodyAt(':root {'));
const explicitDark = tokens(bodyAt("[data-theme='dark'] {"));
const fallbackDark = tokens(bodyAt('prefers-color-scheme: dark'));

describe('the light palette declares its scheme', () => {
  it('sets color-scheme: light so form controls and scrollbars follow it', () => {
    expect(light.get('color-scheme')).toBe('light');
  });
});

describe('the dark palette', () => {
  it('exists and switches the color-scheme', () => {
    expect(explicitDark.get('color-scheme')).toBe('dark');
    expect(explicitDark.size).toBeGreaterThan(20);
  });

  it('inverts the ramp: text becomes light, the ground becomes dark', () => {
    // In light, --db-ink is near-black text on a near-white --db-surface. Dark must reverse
    // both, or it is not a dark theme — a token or two nudged darker would pass a weaker
    // check and still read as a light page.
    const inkLight = light.get('--db-ink');
    const surfaceLight = light.get('--db-surface');
    const inkDark = explicitDark.get('--db-ink');
    const surfaceDark = explicitDark.get('--db-surface');
    expect(inkLight && surfaceLight && inkDark && surfaceDark).toBeTruthy();
    // Text and ground swap which is the lighter of the two.
    expect(luminance(inkLight as string)).toBeLessThan(luminance(surfaceLight as string));
    expect(luminance(inkDark as string)).toBeGreaterThan(luminance(surfaceDark as string));
  });

  it('keeps a card (paper) lighter than the page (surface), as depth reads on dark', () => {
    const paper = explicitDark.get('--db-paper');
    const surface = explicitDark.get('--db-surface');
    expect(luminance(paper as string)).toBeGreaterThan(luminance(surface as string));
  });

  it('is defined identically in the explicit block and the media-query fallback', () => {
    // The whole point of the guard: the two copies cannot drift. Every token one declares,
    // the other declares to the same value.
    expect(fallbackDark.size).toBe(explicitDark.size);
    for (const [name, value] of explicitDark) {
      expect(fallbackDark.get(name), `${name} differs between the two dark blocks`).toBe(value);
    }
  });
});
