import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatRound } from './format';

describe('formatRound', () => {
  it('says one minute, not one minutes', () => {
    // This was rendering on 98 of the 107 catalogue pages.
    expect(formatRound(60)).toBe('about 1 minute');
    expect(formatRound(75)).toBe('about 1 minute');
  });

  it('says one second, not one seconds', () => {
    expect(formatRound(1)).toBe('about 1 second');
  });

  it('pluralises everything that is not one', () => {
    expect(formatRound(30)).toBe('about 30 seconds');
    expect(formatRound(45)).toBe('about 45 seconds');
    expect(formatRound(120)).toBe('about 2 minutes');
    expect(formatRound(300)).toBe('about 5 minutes');
  });

  it('reads correctly at every round length the catalogue uses', () => {
    for (const seconds of [20, 30, 45, 60, 75, 90, 120, 180, 240, 300, 600]) {
      expect(formatRound(seconds), `"${formatRound(seconds)}"`).not.toMatch(
        /\b1 (minutes|seconds)$/,
      );
    }
  });

  it('carries its own hedge, so no caller adds a second one', () => {
    // The card said "2 min" and the page it links to said "about 2 minutes", because the
    // hedge lived at one call site and not the other. It lives here now.
    expect(formatRound(120)).toMatch(/^about /);
  });
});

/**
 * The guard that keeps it one renderer.
 *
 * `GameCard` had a private `formatRound` of its own, four lines long, and the grid and the
 * game page disagreed for as long as it existed. Nothing in the type system objects to a
 * second copy, so this does.
 */
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

describe('the round formatter has one home', () => {
  const files = sources(web).filter((path) => path !== join(here, 'format.ts'));

  it('finds the shell to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('is defined once and imported everywhere else', () => {
    const declared = files.filter((path) =>
      /(function|const)\s+formatRound\b/.test(readFileSync(path, 'utf8')),
    );
    expect(
      declared.map((path) => relative(web, path)),
      'a second round formatter exists; import the one in lib/format.ts instead',
    ).toEqual([]);
  });
});
