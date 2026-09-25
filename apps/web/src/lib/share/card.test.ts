import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../data/catalogue.generated';
import type { CatalogueEntry } from '../../data/catalogue.generated';
import { colour } from '../../styles/tokens';
import { groundFor, tileFor } from '../tiles';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  TILE_ORIGIN,
  composeGameCard,
  montageGames,
  renderDefaultCard,
  renderGameCard,
} from './card';
import { readPngSize } from './png';
import { parseColour } from './raster';
import type { Canvas } from './raster';

/**
 * The composition, checked for the things that would go wrong on all hundred and eight
 * cards at once.
 *
 * Whether a card is *handsome* is not something a test can hold, and this file does not
 * pretend otherwise. What it can hold is that every layer of the tile reaches the picture,
 * that the frame is the size every platform crops from, and that the same commit composes
 * the same bytes twice — the last being the claim `raster.ts` opens with, and the one that
 * makes rebuilding an unchanged commit produce an unchanged export.
 *
 * The layer tests work by comparing a game's card with the card for the *same entry under a
 * slug the catalogue does not contain*. `tileFor` falls back to a plain field and a disc
 * chip for an unknown slug while keeping the tint and the mark, so the pair differs in
 * exactly one layer and nothing else — which is how a single dropped layer can be named
 * rather than merely noticed.
 */

const chess = CATALOGUE.find((game) => game.slug === 'chess')!;

/** The same game as far as `markFor` is concerned, and unknown to the tile assignment. */
function unregistered(game: CatalogueEntry): CatalogueEntry {
  return { ...game, slug: `${game.slug}-unregistered` };
}

function pixel(canvas: Canvas, x: number, y: number): string {
  const index = (y * canvas.width + x) * 3;
  return [canvas.rgb[index], canvas.rgb[index + 1], canvas.rgb[index + 2]]
    .map((value) => (value ?? 0).toString(16).padStart(2, '0'))
    .join('');
}

const hex = (token: string): string => token.replace('#', '');

function differs(a: CatalogueEntry, b: CatalogueEntry): boolean {
  return !Buffer.from(renderGameCard(a)).equals(Buffer.from(renderGameCard(b)));
}

describe('the share card', () => {
  it('is composed in the frame the platforms crop from', () => {
    expect([CARD_WIDTH, CARD_HEIGHT]).toEqual([1200, 630]);
    expect(readPngSize(renderGameCard(chess))).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
  });

  it('composes the same bytes from the same game twice', () => {
    expect(Buffer.from(renderGameCard(chess)).equals(Buffer.from(renderGameCard(chess)))).toBe(
      true,
    );
  });

  it('draws a different picture for each game', () => {
    const sudoku = CATALOGUE.find((game) => game.slug === 'sudoku')!;
    expect(differs(chess, sudoku)).toBe(true);
  });
});

describe('every layer of the tile reaches the card', () => {
  /**
   * Sabotage: took the mark out of `drawTile`, leaving the ground, the field and the chip.
   *
   *   AssertionError: expected false to be true // Object.is equality
   *
   * Comparing two real games would not have caught it — two games almost always differ in
   * tint or texture as well — which is why the comparison here is against the same entry
   * with its tile assignment removed.
   */
  it('draws the mark', () => {
    const plain = unregistered(chess);
    expect(tileFor(plain).mark).toBe(tileFor(chess).mark);
    const other = { ...plain, slug: 'dice-unregistered', name: 'Dice' };
    expect(tileFor(other).mark).not.toBe(tileFor(plain).mark);
    expect(differs(plain, other)).toBe(true);
  });

  it('draws the field texture', () => {
    const textured = CATALOGUE.find((game) => {
      const tile = tileFor(game);
      return tile.field !== 'plain' && tile.chip === 'disc';
    });
    expect(textured, 'no game has a texture and the default chip').toBeDefined();
    expect(differs(textured!, unregistered(textured!))).toBe(true);
  });

  it('draws the corner chip', () => {
    const chipped = CATALOGUE.find((game) => {
      const tile = tileFor(game);
      return tile.field === 'plain' && tile.chip !== 'disc';
    });
    expect(chipped, 'no game has the default texture and another chip').toBeDefined();
    expect(differs(chipped!, unregistered(chipped!))).toBe(true);
  });

  /**
   * The ground, the two seats and the brand bar, read off the pixels.
   *
   * Byte comparisons cannot see any of these: a card with its seat glyphs missing, or with
   * the bar in the wrong colour, differs from every other card exactly as much as a correct
   * one does. The seat positions are the ones `GameCard` uses — a disc for one seat and a
   * rounded square for the other, so the pair is told apart without colour (rule 7).
   */
  it('paints the ground, the seats and the brand bar', () => {
    const plain = CATALOGUE.find((game) => tileFor(game).field === 'plain')!;
    const canvas = composeGameCard(plain);
    const { x, y, size } = TILE_ORIGIN;
    const unit = size / 64;

    expect(pixel(canvas, 4, 4)).toBe(hex(colour.surface));
    expect(pixel(canvas, CARD_WIDTH - 4, CARD_HEIGHT - 4)).toBe(hex(colour.brand));
    // Inside the tile, below the seats and clear of the mark, so it is the ground itself.
    expect(pixel(canvas, x + Math.round(6 * unit), y + Math.round(32 * unit))).toBe(
      hex(groundFor(plain.tint)),
    );
    expect(pixel(canvas, x + Math.round(6 * unit), y + Math.round(6 * unit))).toBe(hex(colour.p1));
    expect(pixel(canvas, x + Math.round(12 * unit), y + Math.round(6 * unit))).toBe(hex(colour.p2));
  });

  /** Ink, at the one opacity the field is drawn at, over the game's own ground. */
  it('draws the field at the texture opacity rather than solid', () => {
    const textured = CATALOGUE.find((game) => tileFor(game).field === 'checks')!;
    const canvas = composeGameCard(textured);
    const ground = parseColour(groundFor(textured.tint));
    const ink = parseColour('#14161f');
    const expected = [ground.r, ground.g, ground.b]
      .map((channel, index) =>
        Math.round(channel * 0.78 + [ink.r, ink.g, ink.b][index]! * 0.22)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
    // The top-left 16x16 cell of the `checks` field, well inside it.
    const { x, y, size } = TILE_ORIGIN;
    expect(pixel(canvas, x + Math.round((8 * size) / 64), y + Math.round((8 * size) / 64))).toBe(
      expected,
    );
  });
});

describe('the site card', () => {
  it('is one picture of nine games rather than any one of them', () => {
    const png = renderDefaultCard(CATALOGUE);
    expect(readPngSize(png)).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT });
    expect(Buffer.from(png).equals(Buffer.from(renderGameCard(chess)))).toBe(false);
  });

  it('samples the whole catalogue rather than the front of it', () => {
    const picked = montageGames(CATALOGUE);
    expect(picked.length).toBe(9);
    expect(new Set(picked.map((game) => game.slug)).size).toBe(9);
    const ordered = CATALOGUE.map((game) => game.slug).sort();
    expect(picked[0]?.slug).toBe(ordered[0]);
    expect(picked.at(-1)?.slug).toBe(ordered.at(-1));
  });

  it('copes with a catalogue smaller than the grid', () => {
    expect(montageGames(CATALOGUE.slice(0, 4)).length).toBe(4);
  });
});
