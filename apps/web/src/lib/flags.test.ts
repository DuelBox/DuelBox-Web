import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGUE } from '../data/catalogue.generated';
import { isPlayable } from '../data/registry';
import { DISABLED_GAMES, killSwitchFor } from './flags';
import type { GameKillSwitch } from './flags';
import type * as Flags from './flags';

/**
 * The kill switch, exercised against a game that is actually switched off.
 *
 * `DISABLED_GAMES` is empty in a healthy build and must stay that way, so every assertion
 * here that matters runs against an injected switch instead. That is the whole point of the
 * `switches` parameter on `killSwitchFor` and of the module mock below: a kill switch tested
 * only against an empty list is a kill switch nobody has ever seen work, which is the shape
 * of guard CLAUDE.md now counts ten of.
 *
 * Watched failing on purpose before it was trusted: with the `AVAILABLE` filter taken back
 * out of `data/registry.ts` — the one line this mechanism is — three of the four wiring
 * assertions below fail, naming the game they expected to be gone.
 */

/** A game whose two names differ, which is the case a switch is most likely to get wrong. */
const RENAMED = CATALOGUE.find((entry) => entry.id !== entry.slug && isPlayable(entry.slug));

/** A second playable game, never switched off here, so an assertion that everything is off fails. */
const CONTROL = CATALOGUE.find((entry) => entry.slug !== RENAMED?.slug && isPlayable(entry.slug));

function switchOff(slug: string): GameKillSwitch {
  return { slug, reason: 'The scores can disagree between the two seats.', issue: '#208' };
}

/**
 * `data/registry.ts` with `lib/flags.ts` replaced by the same module holding `switches`.
 *
 * The real matching function does the matching — only the list is injected — so what this
 * proves about a switched-off game is what a switched-off game would really do.
 */
async function registryWith(switches: readonly GameKillSwitch[]) {
  vi.resetModules();
  const real = await vi.importActual<typeof Flags>('./flags');
  vi.doMock('./flags', () => ({
    ...real,
    DISABLED_GAMES: switches,
    killSwitchFor: (name: string) => real.killSwitchFor(name, switches),
  }));
  return import('../data/registry');
}

afterEach(() => {
  vi.doUnmock('./flags');
  vi.resetModules();
});

describe('the list of switched-off games', () => {
  /** Whether the catalogue has heard of a name, under either of the two a game has. */
  const known = (name: string) => CATALOGUE.some((e) => e.slug === name || e.id === name);

  it('names a real game in every entry', () => {
    const strays = DISABLED_GAMES.filter((entry) => !known(entry.slug)).map((entry) => entry.slug);
    expect(
      strays,
      `these switches name nothing in the catalogue, so they switch nothing off: ${strays.join(', ')}`,
    ).toEqual([]);

    // The check above is vacuous while the list is empty, so here is the predicate meeting a
    // switch that names nothing and one that names something. Without this pair, an entry
    // with a typo in it would pass this test on the day it mattered most.
    expect(known('tic-tac-toe')).toBe(true);
    expect(known('tic-tac-toe-classic')).toBe(false);
  });

  it('gives every entry a reason to show and an issue to point at', () => {
    for (const entry of DISABLED_GAMES) {
      expect(entry.reason.trim(), `${entry.slug} is switched off with no reason given`).not.toBe(
        '',
      );
      expect(entry.issue, `${entry.slug} is switched off with nowhere to follow it up`).toMatch(
        /^#\d+$/,
      );
    }
  });

  it('is empty here, and a build where it is not is a build with a game switched off', () => {
    // Not a gate on the mechanism — a switch is allowed and this test says so rather than
    // failing. It reports, so that a list left set after a repair is visible in a run.
    const off = DISABLED_GAMES.map((entry) => `${entry.slug} (${entry.issue})`);
    expect(off.length, `games switched off in this build: ${off.join(', ')}`).toBeLessThan(
      CATALOGUE.length,
    );
  });
});

describe('finding the switch for a game', () => {
  it('matches whichever of the two names a game has', () => {
    expect(RENAMED, 'no built game has a slug that differs from its package id').toBeDefined();
    const renamed = RENAMED!;
    const switches = [switchOff(renamed.slug)];
    expect(killSwitchFor(renamed.slug, switches)?.slug).toBe(renamed.slug);
    expect(killSwitchFor(renamed.id, switches)?.slug).toBe(renamed.slug);

    // And the other way round: written with the package id, found by the slug the site routes
    // by. An emergency edit is made from whatever string is in front of somebody.
    const byId = [switchOff(renamed.id)];
    expect(killSwitchFor(renamed.slug, byId)?.slug).toBe(renamed.id);
  });

  it('leaves every other game alone', () => {
    expect(CONTROL).toBeDefined();
    expect(killSwitchFor(CONTROL!.slug, [switchOff(RENAMED!.slug)])).toBeNull();
  });

  it('reads this build’s own list when it is not given one', () => {
    for (const entry of DISABLED_GAMES) {
      expect(killSwitchFor(entry.slug)).toEqual(entry);
    }
  });
});

describe('the scaffold that adds a game', () => {
  /**
   * `scripts/register-game.mjs` finds the end of the loader table by searching `registry.ts`
   * for a literal, and the kill switch was written into exactly that gap first: the marker
   * stopped matching and the scaffold could no longer add a game, failing with "could not
   * find the end of LOADERS in apps/web/src/data/registry.ts".
   *
   * The repair was a comment in `registry.ts` saying nothing may go there, and a comment is
   * the sentence this repository has learned to distrust. So the rule is checked, and it is
   * checked against the marker read out of the script rather than a copy of it, which is the
   * other half of the same lesson — a copy passes for as long as the two agree and stops
   * meaning anything the moment they do not.
   *
   * It belongs beside `registry.ts` rather than here. It is here because the change that
   * broke it is this one.
   */
  it('can still find the end of the loader table', () => {
    const root = join(__dirname, '../../../..');
    const script = readFileSync(join(root, 'scripts/register-game.mjs'), 'utf8');
    const declared = /const marker = '((?:[^'\\]|\\.)*)'/.exec(script);
    expect(
      declared,
      'register-game.mjs no longer declares a marker; this test is searching for nothing',
    ).not.toBeNull();
    // The escapes in that literal are the ones JSON uses, so this reads the string the
    // script will actually search with rather than a hand-written second copy of it.
    const marker = JSON.parse(`"${declared?.[1] ?? ''}"`) as string;
    expect(marker, 'the marker is not the one this test was written about').toContain(
      'The loader table',
    );
    expect(
      readFileSync(join(root, 'apps/web/src/data/registry.ts'), 'utf8'),
      'something was written between the end of LOADERS and the comment after it, so' +
        ' scripts/register-game.mjs can no longer add a game to the registry',
    ).toContain(marker);
  });
});

describe('a game the switch is set for', () => {
  it('is gone from the list the routes and the sitemap are built from', async () => {
    const registry = await registryWith([switchOff(RENAMED!.slug)]);
    expect(registry.PLAYABLE).not.toContain(RENAMED!.slug);
    // The control is what makes the line above mean something: the filter removed one game
    // rather than emptying the list.
    expect(registry.PLAYABLE).toContain(CONTROL!.slug);
  });

  it('is unplayable under either of its names, so no card can offer it', async () => {
    const registry = await registryWith([switchOff(RENAMED!.slug)]);
    expect(registry.isPlayable(RENAMED!.slug)).toBe(false);
    expect(registry.isPlayable(RENAMED!.id)).toBe(false);
    expect(registry.isPlayable(CONTROL!.slug)).toBe(true);
  });

  it('refuses to load, so a stale tab cannot start a match', async () => {
    const registry = await registryWith([switchOff(RENAMED!.slug)]);
    await expect(registry.loadGame(RENAMED!.slug)).rejects.toThrow(/No playable build/);
    await expect(registry.loadGame(RENAMED!.id)).rejects.toThrow(/No playable build/);
  });

  it('is still in the table the deep suites iterate, so its tests keep running', async () => {
    // Deliberate, and the reverse of what the three assertions above want. A game switched
    // off because it is broken is the game whose balance, fuzz, parity and determinism runs
    // most need to keep happening; `LOADERS_FOR_TEST` therefore names every build, not every
    // offer. ADR 0005 records what that costs.
    const registry = await registryWith([switchOff(RENAMED!.slug)]);
    expect(registry.LOADERS_FOR_TEST).toHaveProperty(RENAMED!.id);
  });
});
