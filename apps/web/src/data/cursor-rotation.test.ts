/**
 * Every keyboard cursor turns with the same board its pointer does (#2521).
 *
 * ## The doubt this settles
 *
 * `GridCursor.step` takes a `rotated` flag and inverts both axes on it, and sixteen call
 * sites across the catalogue pass one. #2521 asked whether they were inverting *twice* — the
 * board has already been spun to face the active seat by the time the cursor is consulted —
 * and noted that the call sites did not agree: fourteen passed `this.#flip.rotated` and two
 * passed `false`, with one game passing both, in one file, at two call sites.
 *
 * The answer is in `packages/engine/src/seat.ts`: **it is one rotation asked in two places.**
 * The flip rotates the drawing; `toWorld` and `GridCursor` rotate *input into that drawing's
 * coordinates*. A tap and a key press are both device-space, so both reach a rotated board
 * through the same half turn, and `cursor.test.ts` holds the two against each other for a
 * single board.
 *
 * ## Why that is not enough on its own
 *
 * That test proves the *engine* composes correctly. It cannot see a game that hands the
 * cursor one answer and its own pointer another — which is precisely the disagreement the
 * issue found, and the reason it could not be settled by reading `cursor.ts`. This walks the
 * catalogue instead, and holds every call site to the rule the engine's docstring states:
 *
 * > every call site passes the same boolean here that it passes to `toWorld` for its pointer
 *
 * The two games that pass `false` are not exceptions to it. Sea Battle has **two boards** —
 * the placing board each seat reads upright on its own half, and the shared firing grid that
 * rotates — and passes `false` and `this.#flip.rotated` to the cursor at the two call sites
 * and to `toWorld` at the two beside them. Penalty Kicks has no rotated board at all: no
 * flip, no `toWorld`, a selector per seat on that seat's own half. A file with no `toWorld`
 * has nothing for a cursor to turn *into*, so `false` is the only answer that can be right,
 * and that is the second rule below.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GAMES = fileURLToPath(new URL('../../../../packages/games', import.meta.url));

/** Comments stripped, because half of this repository's prose quotes the code it is about. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The last argument of every `cursor.step(a, b, c, <here>)` in a file. */
function cursorRotations(source: string): string[] {
  return [...source.matchAll(/cursor\.step\([^)]*?,\s*([^,()]*?)\s*\)/g)].map((match) =>
    (match[1] ?? '').trim(),
  );
}

/** The last argument of every `toWorld(out, x, y, size, <here>)` in a file. */
function pointerRotations(source: string): string[] {
  return [...source.matchAll(/toWorld\([^)]*?,\s*([^,()]*?(?:\([^)]*\))?)\s*\)/g)].map((match) =>
    (match[1] ?? '').trim(),
  );
}

const games = readdirSync(GAMES)
  .map((slug) => ({ slug, file: join(GAMES, slug, 'src', 'game.ts') }))
  .filter((entry) => existsSync(entry.file) && statSync(entry.file).isFile())
  .map((entry) => ({ ...entry, source: code(readFileSync(entry.file, 'utf8')) }));

const withCursor = games.filter((game) => cursorRotations(game.source).length > 0);

describe('the keyboard cursor and the pointer read the same board', () => {
  it('found the games to check, and found cursors in them', () => {
    // The control. A regex that stopped matching would make every assertion below pass over
    // an empty list, which is the failure mode this repository keeps a tally of.
    expect(games.length).toBeGreaterThan(100);
    expect(withCursor.length).toBeGreaterThan(10);
  });

  it.each(withCursor.map((game) => [game.slug] as const))(
    '%s turns its cursor by something its pointer also turns by',
    (slug) => {
      const game = withCursor.find((entry) => entry.slug === slug);
      const cursor = new Set(cursorRotations(game?.source ?? ''));
      const pointer = new Set(pointerRotations(game?.source ?? ''));
      // A game with no `toWorld` has no rotated board for a cursor to turn into, so the only
      // answer that can be right is "do not turn". Penalty Kicks is that case.
      const allowed = pointer.size === 0 ? new Set(['false']) : new Set([...pointer, 'false']);
      const stray = [...cursor].filter((expression) => !allowed.has(expression));
      expect(
        stray,
        `${slug} turns its keyboard cursor by ${stray.join(', ')}, which its pointer never` +
          ' turns by. A key and a tap are both device-space and reach a rotated board through' +
          ' the same half turn — see seatRotated in packages/engine/src/seat.ts. One of the' +
          ' two is inverting for a reason the other does not share, which is #2521.',
      ).toEqual([]);
    },
  );
});
