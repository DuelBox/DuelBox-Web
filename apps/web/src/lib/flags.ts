import { GAME_IDS } from '../data/game-names.generated';

/**
 * The flags this build was compiled with, and the per-game kill switch (#208).
 *
 * A flag here is a constant baked into the artefact rather than a document fetched while
 * the page runs, and that is forced rather than preferred. Three facts about this product
 * decide it, and each one is checkable in the tree:
 *
 * - ADR 0001 makes the origin a directory of files that computes nothing, and
 *   `scripts/check-zero-cost.mjs` fails the build on anything that walks that back.
 * - Every page carries its own CSP, and `scripts/security-headers.mjs` sets
 *   `connect-src 'self'` — so the only origin a running page may ask anything of is the one
 *   this repository publishes.
 * - Publishing to that origin is a deploy. `.github/workflows/deploy.yml` builds the export
 *   and uploads it; there is no other way for a byte to get there.
 *
 * Together those say that "flip a flag without a deploy" has no implementation on this
 * site, rather than an expensive one: the only file a page is allowed to read is a file a
 * deploy put there. `docs/adr/0005-build-time-feature-flags.md` works through what a
 * runtime flag file would cost if the CSP were widened for it, and why it would still be
 * slower than the push it replaces.
 *
 * So switching a game off is an edit to {@link DISABLED_GAMES}, a push to `main`, and the
 * deploy workflow — which needs no review and runs no tests, so it is minutes rather than a
 * full gate. That ADR carries the runbook, written for somebody doing it at speed.
 *
 * Any later flag belongs in this file for the same reason this one does: it is the module
 * that is allowed to know what this build was compiled to do.
 */

/** One game switched off, with the reason a player is shown and the issue that will end it. */
export interface GameKillSwitch {
  /**
   * The game's slug — the word in its URL, which is what a bug report contains. Its package
   * id is accepted as well, because the string in front of somebody at two in the morning is
   * the string they will paste, and `data/registry.ts` has always answered to either.
   */
  readonly slug: string;
  /**
   * One sentence, shown on the game's own page, written for the player rather than for us:
   * what is wrong from their side, not which module threw. "The board can end a match with
   * both seats winning" is the register; a stack trace is not.
   */
  readonly reason: string;
  /**
   * Where the repair is tracked, as `#1234`. A switch with nowhere to point at is a game
   * quietly deleted, and the next person to read this list needs to know which it is.
   */
  readonly issue: string;
}

/**
 * The games this build refuses to offer, and the healthy state of this list is empty.
 *
 * An entry costs the player nothing to carry — the catalogue page it feeds is server-
 * rendered, and the size guard walks JavaScript alone — but it costs the game its route,
 * its place in the sitemap and its Play link, all of which come back by deleting the line.
 *
 * A switched-off game keeps everything else it had. Its loader stays in `data/registry.ts`
 * so `LOADERS_FOR_TEST` still names it and the balance, fuzz, parity and determinism suites
 * still play it — a game switched off because it is broken is precisely the game whose tests
 * must keep running.
 */
export const DISABLED_GAMES: readonly GameKillSwitch[] = [];

/**
 * The package behind a name, whichever of a game's two names was given.
 *
 * The same reconciliation `data/registry.ts` does, and here for the same reason: eighteen
 * games are routed under a slug that is not their package id, so a switch written one way
 * and a lookup written the other would half-work — the game gone from the catalogue and its
 * page still offering to start a match, or the reverse. Matching both sides through this
 * makes the two spellings the same question.
 */
function packageId(name: string): string {
  return GAME_IDS[name] ?? name;
}

/**
 * The switch that turns `name` off, or `null` if this build will happily play it.
 *
 * `switches` is a parameter so the guard over this mechanism can hand it a game that really
 * is switched off. A kill switch tested only against an empty list is a kill switch nobody
 * has seen work.
 */
export function killSwitchFor(
  name: string,
  switches: readonly GameKillSwitch[] = DISABLED_GAMES,
): GameKillSwitch | null {
  const id = packageId(name);
  return switches.find((entry) => packageId(entry.slug) === id) ?? null;
}
