import type { CatalogueEntry } from '../../data/catalogue.generated';
import { colour } from '../../styles/tokens';
import {
  CHIP_ART,
  FIELD_ALPHA,
  FIELD_ART,
  INK,
  MARK_ART,
  MARK_INSET,
  RADIUS,
  groundFor,
  tileFor,
} from '../tiles';
import type { Shape, TileSpec } from '../tiles';
import { encodePng } from './png';
import {
  concat,
  createCanvas,
  fillRect,
  intersect,
  maskFor,
  paint,
  parseColour,
  scaleAbout,
  shapePolygons,
} from './raster';
import type { Canvas, Mask, Transform } from './raster';

/**
 * The share card: one picture per game, composed at build time (#2453, #197).
 *
 * ## What it is made of, and why that was the only option
 *
 * A hundred and eight preview images is a hundred and eight commissions this repository
 * cannot pay for and a hundred and eight chances to break rule 1, which is the argument
 * `lib/tiles.ts` opens with and it applies here word for word. So the card is drawn from
 * the vocabulary that file already holds: the game's own tile — its ground tint, its field
 * texture, its mark and its chip — enlarged onto a 1200x630 frame, with the two seat glyphs
 * `GameCard` puts on every catalogue card and a bar in the brand colour along the bottom.
 * Every coordinate in it is either in `tiles.ts` or below. Nothing is traced, nothing is
 * licensed, and a game added tomorrow has a card the moment its catalogue row exists.
 *
 * ## Why there are no words on it
 *
 * Because there is no honest way to put them there, and because the words are already
 * somewhere better. Drawing type means rasterising a font: the three families this site
 * serves are variable WOFF2, and a pure implementation of that is a Brotli stream, a
 * transformed `glyf` table and a variation model — several hundred lines of binary parsing
 * whose output nobody in this repository can eyeball. Handing the job to a system
 * rasteriser instead makes the picture depend on which fonts a machine has installed, which
 * is exactly the determinism the tile system refuses to give up.
 *
 * And the words are not missing from the preview. Every platform that renders one of these
 * draws the `og:title` and `og:description` beside the image, in its own type, at a size it
 * chose — where a screen reader and a translator can both reach them. `tiles.ts` made the
 * same call for the same reason: "the game's name never appears inside the art; it sits
 * beside the tile, in text".
 *
 * ## Why the tile is centred
 *
 * Because a share image is cropped by whoever shows it. The Twitter card this site declares
 * is `summary`, which crops to a square; several other platforms crop to 1.91:1 from the
 * centre. A composition whose subject sits in the middle 630 pixels survives all of them,
 * and one with the subject off to a side does not.
 */

/** The size every platform's documentation asks for, and the one they all crop from. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** The brand bar along the bottom. The one place on the card that is not tile vocabulary. */
const BAND_HEIGHT = 22;

/** The enlarged tile on a game's own card. */
const TILE_SIZE = 470;

/** Tiles down and across on the card that stands in for the site rather than a game. */
const MONTAGE_COLUMNS = 3;
const MONTAGE_TILE = 170;
const MONTAGE_GUTTER = 24;

/** The tile grid `tiles.ts` draws in. Every constant in that file is in these units. */
const GRID = 64;

/**
 * The two seats, in tile units, matching what `GameCard.module.css` puts over a catalogue
 * tile: a disc for one seat and a rounded square for the other, so the pair is told apart
 * by shape and not only by colour (rule 7). They sit inside the corner the marks are inset
 * to clear — see `MARK_INSET` — so no mark can collide with them.
 */
const SEAT_DIAMETER = 4;
const SEAT_INSET = 4;
const SEAT_GAP = 2;

const ink = parseColour(INK);

/**
 * Rasterised symbols, kept between cards.
 *
 * A hundred and eight cards draw from a vocabulary of twenty-four marks, six fields and
 * three chips, so all but the first few of the three hundred and twenty-four symbol
 * rasterisations a naive loop would do are the same picture again. Keyed by size as well as
 * by name because the montage draws the same tiles smaller.
 */
const symbolCache = new Map<string, Mask>();

function cached(key: string, build: () => Mask): Mask {
  const found = symbolCache.get(key);
  if (found) return found;
  const built = build();
  symbolCache.set(key, built);
  return built;
}

/** The transform from the 64-unit tile grid onto a `size`-pixel tile at the origin. */
function tileTransform(size: number): Transform {
  return { scale: size / GRID, dx: 0, dy: 0 };
}

function groundMask(size: number): Mask {
  return cached(`ground:${String(size)}`, () => {
    const t = tileTransform(size);
    return maskFor(
      shapePolygons({ kind: 'rect', x: 0, y: 0, w: GRID, h: GRID, r: RADIUS }, t),
      size,
      size,
    );
  });
}

function shapesMask(key: string, shapes: readonly Shape[], size: number, t: Transform): Mask {
  return cached(key, () =>
    maskFor(
      shapes.flatMap((shape) => shapePolygons(shape, t)),
      size,
      size,
    ),
  );
}

/**
 * One game's tile, drawn onto the canvas exactly as `GameTile` draws it: a ground in the
 * catalogue's tint, the field texture in ink at {@link FIELD_ALPHA} clipped to the rounded
 * corners, the mark, and the corner chip.
 */
function drawTile(canvas: Canvas, spec: TileSpec, x: number, y: number, size: number): void {
  const t = tileTransform(size);
  const ground = groundMask(size);
  paint(canvas, ground, x, y, parseColour(groundFor(spec.tint)));

  if (spec.field !== 'plain') {
    const field = cached(`field:${spec.field}:${String(size)}`, () =>
      intersect(
        maskFor(
          FIELD_ART[spec.field].flatMap((shape) => shapePolygons(shape, t)),
          size,
          size,
        ),
        ground,
      ),
    );
    paint(canvas, field, x, y, ink, FIELD_ALPHA);
  }

  // The same inset `TileSprite` applies to every mark, for the same reason: a glyph drawn
  // edge to edge on the 64 grid would run into the rounded corners and the seat glyphs.
  const markTransform = concat(t, scaleAbout(MARK_INSET, GRID / 2, GRID / 2));
  paint(
    canvas,
    shapesMask(`mark:${spec.mark}:${String(size)}`, MARK_ART[spec.mark], size, markTransform),
    x,
    y,
    ink,
  );
  paint(
    canvas,
    shapesMask(`chip:${spec.chip}:${String(size)}`, CHIP_ART[spec.chip], size, t),
    x,
    y,
    ink,
  );
}

/** The seat pair over a tile's top-left corner, in the seat colours and the seat shapes. */
function drawSeats(canvas: Canvas, x: number, y: number, size: number): void {
  const t = tileTransform(size);
  const radius = SEAT_DIAMETER / 2;
  const first = cached(`seat:p1:${String(size)}`, () =>
    maskFor(
      shapePolygons(
        { kind: 'circle', cx: SEAT_INSET + radius, cy: SEAT_INSET + radius, r: radius },
        t,
      ),
      size,
      size,
    ),
  );
  const second = cached(`seat:p2:${String(size)}`, () =>
    maskFor(
      shapePolygons(
        {
          kind: 'rect',
          x: SEAT_INSET + SEAT_DIAMETER + SEAT_GAP,
          y: SEAT_INSET,
          w: SEAT_DIAMETER,
          h: SEAT_DIAMETER,
          r: SEAT_DIAMETER / 3,
        },
        t,
      ),
      size,
      size,
    ),
  );
  paint(canvas, first, x, y, parseColour(colour.p1));
  paint(canvas, second, x, y, parseColour(colour.p2));
}

function blankCard(): Canvas {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT, parseColour(colour.surface));
  fillRect(
    canvas,
    0,
    CARD_HEIGHT - BAND_HEIGHT,
    CARD_WIDTH,
    BAND_HEIGHT,
    parseColour(colour.brand),
  );
  return canvas;
}

/** Where the enlarged tile sits, which `card.test.ts` needs in order to look at it. */
export const TILE_ORIGIN = {
  x: Math.round((CARD_WIDTH - TILE_SIZE) / 2),
  y: Math.round((CARD_HEIGHT - BAND_HEIGHT - TILE_SIZE) / 2),
  size: TILE_SIZE,
} as const;

/**
 * One game's card as pixels.
 *
 * Separate from the PNG so the composition can be checked by looking at it. Comparing
 * encoded bytes proves two cards differ; it cannot say whether the seat glyphs are on the
 * tile or whether the band is the brand colour, and those are the parts of this card that
 * would be wrong quietly.
 */
export function composeGameCard(game: CatalogueEntry): Canvas {
  const canvas = blankCard();
  const { x, y, size } = TILE_ORIGIN;
  drawTile(canvas, tileFor(game), x, y, size);
  drawSeats(canvas, x, y, size);
  return canvas;
}

/** One game's share card, as PNG bytes. */
export function renderGameCard(game: CatalogueEntry): Uint8Array {
  return encodePng(composeGameCard(game));
}

/**
 * The nine games the site's own card shows.
 *
 * Spread evenly through the catalogue in slug order rather than taken from the front, so
 * the montage samples the whole of it — nine marks, nine tints, nine textures — instead of
 * nine games whose names begin with A. Deterministic, like everything else here: the same
 * catalogue produces the same nine.
 */
export function montageGames(games: readonly CatalogueEntry[]): CatalogueEntry[] {
  const count = MONTAGE_COLUMNS * MONTAGE_COLUMNS;
  const ordered = [...games].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (ordered.length <= count) return ordered;
  const picked: CatalogueEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const entry = ordered[Math.round((i * (ordered.length - 1)) / (count - 1))];
    if (entry) picked.push(entry);
  }
  return picked;
}

/**
 * The card for everything that is not one game — the home page, the catalogue, the hubs,
 * the settings and policy pages. Nine tiles, because what the site is is a lot of games.
 */
export function composeDefaultCard(games: readonly CatalogueEntry[]): Canvas {
  const canvas = blankCard();
  const picked = montageGames(games);
  const block = MONTAGE_COLUMNS * MONTAGE_TILE + (MONTAGE_COLUMNS - 1) * MONTAGE_GUTTER;
  const left = Math.round((CARD_WIDTH - block) / 2);
  const top = Math.round((CARD_HEIGHT - BAND_HEIGHT - block) / 2);
  picked.forEach((game, index) => {
    const column = index % MONTAGE_COLUMNS;
    const row = Math.floor(index / MONTAGE_COLUMNS);
    const x = left + column * (MONTAGE_TILE + MONTAGE_GUTTER);
    const y = top + row * (MONTAGE_TILE + MONTAGE_GUTTER);
    drawTile(canvas, tileFor(game), x, y, MONTAGE_TILE);
  });
  return canvas;
}

/** The same, as PNG bytes. */
export function renderDefaultCard(games: readonly CatalogueEntry[]): Uint8Array {
  return encodePng(composeDefaultCard(games));
}
