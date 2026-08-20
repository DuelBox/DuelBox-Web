import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The device-class scale, guarded.
 *
 * Seven ad-hoc breakpoints were in use before `docs/responsive.md` named five classes.
 * Nothing stopped an eighth appearing in one stylesheet and never propagating to the
 * others, which is how a layout ends up correct at four widths and subtly wrong at a
 * fifth that only one component knows about.
 *
 * CSS cannot use a custom property inside a media query, so the scale cannot be enforced
 * by the cascade. This enforces it instead.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

/** The named classes from docs/responsive.md. A sixth belongs in the doc first. */
const ALLOWED = new Set(['30rem', '40rem', '64rem', '90rem']);

/**
 * Height queries get the same treatment, and there is exactly one class.
 *
 * Guarding width alone left the other axis wide open, which is not a theoretical gap: a
 * phone held sideways is short rather than narrow, and every portrait game rendered its
 * board about 85px wide there because the two scoreboards took the height. The fix needed
 * a height breakpoint, and a height breakpoint needs the same discipline as a width one.
 */
const ALLOWED_HEIGHT = new Set(['30rem']);

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) stylesheets(path, found);
    else if (path.endsWith('.css')) found.push(path);
  }
  return found;
}

describe('the device-class scale', () => {
  const sheets = stylesheets(web);

  it('finds the stylesheets to check', () => {
    expect(sheets.length).toBeGreaterThan(5);
  });

  it('uses only the named breakpoints in width media queries', () => {
    const offenders: string[] = [];
    for (const path of sheets) {
      const css = readFileSync(path, 'utf8');
      for (const match of css.matchAll(/@media[^{]*?\(\s*(?:min|max)-width:\s*([^)\s]+)\s*\)/g)) {
        const width = match[1];
        if (width && !ALLOWED.has(width)) {
          offenders.push(`${path.slice(web.length + 1)} uses ${width}`);
        }
      }
    }
    expect(offenders, `add it to docs/responsive.md first: ${offenders.join(', ')}`).toEqual([]);
  });

  it('uses only the named breakpoint in height media queries', () => {
    const offenders: string[] = [];
    for (const path of sheets) {
      const css = readFileSync(path, 'utf8');
      for (const match of css.matchAll(/@media[^{]*?\(\s*(?:min|max)-height:\s*([^)\s]+)\s*\)/g)) {
        const height = match[1];
        if (height && !ALLOWED_HEIGHT.has(height)) {
          offenders.push(`${path.slice(web.length + 1)} uses ${height}`);
        }
      }
    }
    expect(offenders, `add it to docs/responsive.md first: ${offenders.join(', ')}`).toEqual([]);
  });

  it('documents each class as a token, so the scale has one home', () => {
    const tokens = readFileSync(join(web, 'styles', 'tokens.css'), 'utf8');
    for (const name of ['phone', 'tablet', 'laptop', 'wide', 'short']) {
      expect(tokens).toContain(`--db-bp-${name}:`);
    }
  });

  it('keeps the tokens and the allowed set in step', () => {
    const tokens = readFileSync(join(web, 'styles', 'tokens.css'), 'utf8');
    for (const match of tokens.matchAll(/--db-bp-[a-z]+:\s*([^;]+);/g)) {
      const value = match[1]?.trim();
      expect(
        ALLOWED.has(value ?? '') || ALLOWED_HEIGHT.has(value ?? ''),
        `token value ${String(value)} is not in the allowed set`,
      ).toBe(true);
    }
  });
});
