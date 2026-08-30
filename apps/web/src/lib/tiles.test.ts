import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../data/catalogue.generated';
import {
  CATEGORY_MARK,
  CHIPS,
  CHIP_ART,
  FIELDS,
  FIELD_ALPHA,
  FIELD_ART,
  INK,
  MARKS,
  MARK_ART,
  SLOTS_PER_MARK,
  TILES as ASSIGNED,
  groundFor,
  markFor,
  tileFor,
  tileGeometry,
} from './tiles';
import type { Shape, TileSpec } from './tiles';

/**
 * The guard on the artwork system (#2457).
 *
 * A tile system has exactly three ways to fail quietly, and all three are the kind of
 * failure a person scrolling a catalogue does not report as a bug — they just stop being
 * able to tell two games apart:
 *
 *   1. a game has no tile at all;
 *   2. two games draw the same tile;
 *   3. two games differ only in colour, which for a player who cannot separate those two
 *      colours, or who is looking at a greyscale screen, is case 2 wearing a hat.
 *
 * Each has its own assertion below, and **each was watched failing on purpose before this
 * file was trusted** — the habit CLAUDE.md asks for, after five guards in this repository
 * turned out to be enforcing nothing. What each sabotage was, and what it printed, is
 * recorded above the assertion it belongs to.
 */

const TILES = CATALOGUE.map((game) => ({ game, tile: tileFor(game) }));

/** Everything the tile draws, written down. No colour appears in it, which is the point. */
function geometryKey(spec: TileSpec): string {
  return tileGeometry(spec).map(shapeKey).join(' ');
}

function shapeKey(shape: Shape): string {
  if (shape.kind === 'rect') {
    return `rect(${String(shape.x)},${String(shape.y)},${String(shape.w)},${String(shape.h)},${String(shape.r)})`;
  }
  if (shape.kind === 'circle') {
    return `circle(${String(shape.cx)},${String(shape.cy)},${String(shape.r)})`;
  }
  if (shape.kind === 'ring') {
    return `ring(${String(shape.cx)},${String(shape.cy)},${String(shape.r)},${String(shape.weight)})`;
  }
  if (shape.kind === 'fill') return `fill(${shape.d})`;
  return `stroke(${shape.d},${String(shape.weight)})`;
}

/** What the tile looks like in full colour: the ground plus everything drawn on it. */
function renderKey(spec: TileSpec): string {
  return `${groundFor(spec.tint)} ${geometryKey(spec)}`;
}

function duplicates(keyed: readonly { readonly label: string; readonly key: string }[]): string[] {
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const { label, key } of keyed) {
    const first = seen.get(key);
    if (first === undefined) seen.set(key, label);
    else clashes.push(`${first} and ${label}`);
  }
  return clashes;
}

// --- greyscale ------------------------------------------------------------------------
// sRGB relative luminance and the WCAG contrast ratio, so "reads in greyscale" is a number
// rather than an opinion. A greyscale screen keeps luminance and throws away hue, so two
// colours at the same luminance are the same pixel there whatever their hex says.

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** What the eye sees where a partly transparent ink lies over a ground. */
function composite(ink: string, ground: string, alpha: number): string {
  const [ir, ig, ib] = rgb(ink);
  const [gr, gg, gb] = rgb(ground);
  const mix = (i: number, g: number) => Math.round(i * alpha + g * (1 - alpha));
  return `#${[mix(ir, gr), mix(ig, gg), mix(ib, gb)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

describe('the tile vocabulary', () => {
  it('has art for every mark, field and chip it offers', () => {
    expect(MARKS.filter((mark) => MARK_ART[mark].length === 0)).toEqual([]);
    expect(FIELDS.filter((field) => field !== 'plain' && FIELD_ART[field].length === 0)).toEqual(
      [],
    );
    expect(CHIPS.filter((chip) => CHIP_ART[chip].length === 0)).toEqual([]);
  });

  it('picks the mark from what the game is, not from where it sits in the list', () => {
    // A spot-check on the keyword table, so a reordering that silently sends Chess to the
    // archetype fallback fails here rather than being noticed by nobody.
    const marks = new Map(CATALOGUE.map((game) => [game.slug, markFor(game)]));
    expect(marks.get('chess')).toBe('grid');
    expect(marks.get('darts')).toBe('target');
    expect(marks.get('tennis')).toBe('paddle');
    expect(marks.get('dice-yatzy')).toBe('dice');
    expect(marks.get('money-grabber')).toBe('coin');
    expect(marks.get('disco-battle')).toBe('note');
    // Ordering traps that a plain keyword list gets wrong: each of these contains a word
    // that an earlier or later rule would otherwise claim.
    expect(marks.get('snakes-and-ladders')).toBe('dice');
    expect(marks.get('sword-throwing')).toBe('blade');
    expect(marks.get('cup-pong')).toBe('arc');
  });
});

describe('every game has a tile', () => {
  /**
   * The first shape of this assertion was `tileGeometry(tile).length === 0`, and it could
   * not fail: every tile draws a chip whatever else goes wrong, so the geometry is never
   * empty and the test was green by construction. That is the exact failure mode CLAUDE.md
   * lists five times over, caught here only because the sabotage below would not fire.
   *
   * ASSIGNED is what actually decides whether a game has a tile, so that is what is checked.
   */
  /**
   * Watched failing: `assignTiles` made to skip two games.
   *
   *   AssertionError: 2 game(s) with no tile of their own: chess, tennis
   */
  it('is in the catalogue-wide assignment', () => {
    const missing = CATALOGUE.filter((game) => ASSIGNED.get(game.slug) === undefined).map(
      (game) => game.slug,
    );
    expect(
      missing,
      `${String(missing.length)} game(s) with no tile of their own: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  /**
   * Watched failing: `note`'s art replaced with an empty array.
   *
   *   AssertionError: games whose mark draws nothing: disco-battle (note)
   */
  it('draws a mark, not just a ground', () => {
    const blank = TILES.filter(({ tile }) => MARK_ART[tile.mark].length === 0).map(
      ({ game, tile }) => `${game.slug} (${tile.mark})`,
    );
    expect(blank, `games whose mark draws nothing: ${blank.join(', ')}`).toEqual([]);
  });

  it('gives each one a mark, a field and a chip from the vocabulary', () => {
    const wrong = TILES.filter(
      ({ tile }) =>
        !MARKS.includes(tile.mark) || !FIELDS.includes(tile.field) || !CHIPS.includes(tile.chip),
    ).map(({ game, tile }) => `${game.slug} (${tile.mark}/${tile.field}/${tile.chip})`);
    expect(wrong, `tiles outside the vocabulary: ${wrong.join(', ')}`).toEqual([]);
  });

  /**
   * Watched failing: `Sports` deleted from `CATEGORY_MARK`.
   *
   *   AssertionError: categories with no mark of their own: Sports
   */
  it('has a mark for every category the catalogue uses', () => {
    // The category table is the last stop before the archetype fallback, and that fallback
    // is coarse: five marks for a hundred and eight games. A new category falling through
    // to it does not break anything, it just gets a duller tile and eats into one mark's
    // capacity — the sort of thing nobody notices. So: fail when one arrives unmarked.
    const uncovered = [...new Set(CATALOGUE.map((game) => game.category))].filter(
      (category) => CATEGORY_MARK[category] === undefined,
    );
    expect(uncovered, `categories with no mark of their own: ${uncovered.join(', ')}`).toEqual([]);
  });
});

/**
 * Watched failing three ways, because there are three ways to arrive here.
 *
 * Collision resolution deleted, so two games whose slugs hash to the same slot both keep
 * it:
 *
 *   AssertionError: two games draw the same tile: bowling and carrom, checkers and chess,
 *   cornhole and golf-football, checkers and maze-paint, bowling and mini-golf, colour-wars
 *   and reversi, knife-thrower and shuriken, ... (12 pairs)
 *
 * `FIELDS` cut to two and `CHIPS` to one, so a mark can only separate two games:
 *
 *   AssertionError: marks past capacity: paddle carries 4, steps carries 4, target carries
 *   6, dice carries 5, ball carries 5, arc carries 11, burst carries 5, grid carries 11, ...
 *
 * And a game dropped out of the assignment, so `tileFor` fell back to composing a plain
 * one on the spot and it landed on top of somebody else's:
 *
 *   AssertionError: two games draw the same tile: chess and ship-battle, ping-pong and
 *   tennis
 */
describe('no two games draw the same tile', () => {
  it('renders 108 different pictures', () => {
    const clashes = duplicates(
      TILES.map(({ game, tile }) => ({ label: game.slug, key: renderKey(tile) })),
    );
    expect(
      clashes,
      `two games draw the same tile: ${clashes.join(', ')}. ` +
        `Each mark can tell ${String(SLOTS_PER_MARK)} games apart; a mark carrying more than ` +
        'that needs splitting into two marks, not a wider palette.',
    ).toEqual([]);
  });

  it('keeps every mark inside the number of games it can separate', () => {
    const counts = new Map<string, number>();
    for (const { game } of TILES) {
      const mark = markFor(game);
      counts.set(mark, (counts.get(mark) ?? 0) + 1);
    }
    const over = [...counts]
      .filter(([, count]) => count > SLOTS_PER_MARK)
      .map(([mark, count]) => `${mark} carries ${String(count)}`);
    expect(over, `marks past capacity: ${over.join(', ')}`).toEqual([]);
  });
});

/**
 * Rule 7, applied to the catalogue rather than to a game: colour is never the only signal.
 *
 * Watched failing: mark, field and chip all pinned to one value, so the hundred and eight
 * tiles were one picture told apart by the tint alone.
 *
 *   AssertionError: these games differ only in colour, so they are the same tile in
 *   greyscale: air-hockey and animal-stack, air-hockey and archery, air-hockey and
 *   archery-master, ... (107 pairs)
 *
 * That run is also what shows this assertion is not a restatement of the one above it. The
 * same sabotage reported **104** pairs as "the same tile" and **107** as the same in
 * greyscale: the three-pair difference is games that share a picture but not a tint, which
 * the full-colour check passes and a player without colour cannot tell apart. Deleting
 * collision resolution showed the same split — 12 pairs against 15.
 */
describe('no tile is distinguishable by colour alone', () => {
  it('draws different geometry for every game, before any colour is applied', () => {
    const clashes = duplicates(
      TILES.map(({ game, tile }) => ({ label: game.slug, key: geometryKey(tile) })),
    );
    expect(
      clashes,
      `these games differ only in colour, so they are the same tile in greyscale: ` +
        `${clashes.join(', ')}`,
    ).toEqual([]);
  });

  /**
   * Watched failing: `INK` set to a saturated palette colour rather than near-black — the
   * tempting design, a gold mark on a gold ground, which is what {@link INK}'s own comment
   * is about.
   *
   *   AssertionError: marks that vanish in greyscale: air-hockey on p2Tint is 1.43:1,
   *   animal-stack on p2Tint is 1.43:1, archery on grassTint is 1.45:1, backgammon on
   *   sunTint is 1.41:1, ... (all 108)
   */
  it('draws the mark dark enough to survive a greyscale screen', () => {
    const faint = TILES.filter(({ tile }) => contrast(INK, groundFor(tile.tint)) < 4.5).map(
      ({ game, tile }) =>
        `${game.slug} on ${tile.tint} is ${contrast(INK, groundFor(tile.tint)).toFixed(2)}:1`,
    );
    expect(faint, `marks that vanish in greyscale: ${faint.join(', ')}`).toEqual([]);
  });

  /**
   * Watched failing: `FIELD_ALPHA` lightened from 0.34 to 0.12, which still looks like a
   * texture on a colour screen and is gone on a grey one.
   *
   *   AssertionError: fields that vanish in greyscale: air-hockey at 1.28:1, animal-stack
   *   at 1.28:1, archery at 1.28:1, backgammon at 1.27:1, ... (all 90 with a field)
   *
   * measured against the 2:1 floor this test first carried; the floor moved to 1.5 when
   * FIELD_ALPHA came down from 0.34 to 0.22, and the sabotage was re-run at 0.08 to confirm
   * it still fires:
   *
   *   AssertionError: fields that vanish in greyscale: air-hockey at 1.18:1, ... (all 90)
   */
  it('draws the field dark enough to still be a signal', () => {
    // The field is the tie-breaker between games that share a mark, so it has to be legible
    // without colour too — but it is a large flat texture behind a mark, not a second mark,
    // so it is held to being visible rather than to the 4.5:1 the mark and the chip both
    // clear. The palette sits at 1.61:1 to 1.65:1 at this alpha; the floor is just under, so
    // lightening the ink or the palette until the texture stops reading fails here.
    const faint = TILES.filter(({ tile }) => tile.field !== 'plain')
      .map(({ game, tile }) => {
        const ground = groundFor(tile.tint);
        return { game, ratio: contrast(composite(INK, ground, FIELD_ALPHA), ground) };
      })
      .filter(({ ratio }) => ratio < 1.5)
      .map(({ game, ratio }) => `${game.slug} at ${ratio.toFixed(2)}:1`);
    expect(faint, `fields that vanish in greyscale: ${faint.join(', ')}`).toEqual([]);
  });
});
