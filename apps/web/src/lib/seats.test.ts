import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEATS } from '@duelbox/engine';
import { SEAT_CHARACTERS, SEAT_KEYS, seatNamesFor } from './seats.js';

describe('seat names', () => {
  it('names both seats, never one of them', () => {
    // The reported bug is a HUD reading "Pip vs Player two": a shell that named seat two
    // and left seat one to a fallback somewhere else. A total record cannot express that.
    for (const bots of [undefined, {}, { p1: 'hard' }, { p2: 'hard' }, { p1: 1, p2: 1 }]) {
      const names = seatNamesFor(bots);
      for (const seat of SEATS) {
        expect(names[seat], `${seat} with bots ${JSON.stringify(bots)}`).toBeTruthy();
      }
      expect(Object.keys(names).sort()).toEqual([...SEATS].sort());
    }
  });

  it('gives the two seats different names', () => {
    const names = seatNamesFor();
    expect(names.p1).not.toBe(names.p2);
  });

  it('keeps a seat its name when a bot is sitting in it', () => {
    // A bot is marked, not renamed. The player is still playing Bo.
    const names = seatNamesFor({ p2: 'normal' });
    expect(names.p1).toBe(SEAT_CHARACTERS.p1);
    expect(names.p2).toContain(SEAT_CHARACTERS.p2);
    expect(names.p2).not.toBe(SEAT_CHARACTERS.p2);
  });

  it('gives each seat its own keys', () => {
    expect(SEAT_KEYS.map((entry) => entry.seat)).toEqual([...SEATS]);
    expect(SEAT_KEYS[0]?.action).not.toBe(SEAT_KEYS[1]?.action);
    expect(SEAT_KEYS[0]?.move).not.toBe(SEAT_KEYS[1]?.move);
  });
});

/**
 * The guard the fix is actually worth.
 *
 * Fixing the HUD string alone would have left five places able to name a seat, and the
 * sixth would have been written next week. This fails the moment a seat name is spelled
 * anywhere but {@link SEAT_CHARACTERS} — which is how every one of the five started.
 *
 * Comments are stripped first: prose about Pip and Bo is documentation, and the shape of
 * the defect is a *rendered* name, not a mention of one.
 */
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

/** This file and the module it guards are the two places the names may appear. */
const ALLOWED = new Set([join(here, 'seats.ts'), join(here, 'seats.test.ts')]);

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

/** Block and line comments removed, so only code and rendered text is left. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('the seat names have one home', () => {
  const files = sources(web).filter((path) => !ALLOWED.has(path));

  it('finds the shell to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('is never spelled out anywhere else', () => {
    const names = SEATS.map((seat) => SEAT_CHARACTERS[seat]);
    const pattern = new RegExp(`\\b(${names.join('|')})\\b`);
    const offenders: string[] = [];
    for (const path of files) {
      const code = stripComments(readFileSync(path, 'utf8'));
      if (pattern.test(code)) offenders.push(relative(web, path));
    }
    expect(
      offenders,
      `a seat name is spelled outside lib/seats.ts: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
