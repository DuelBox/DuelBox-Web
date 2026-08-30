import { CATALOGUE } from '../data/catalogue.generated';
import type { CatalogueEntry } from '../data/catalogue.generated';
import { colour } from '../styles/tokens';

/**
 * The per-game artwork system (#2457).
 *
 * ## Why generated rather than drawn
 *
 * A hundred and eight games need a hundred and eight pictures. Drawing them is three
 * problems this repository cannot afford. It is a hundred and eight commissions, which is
 * money nobody has. It is a hundred and eight files, which is bytes on a budget with
 * hundreds of spare bytes in it, not hundreds of kilobytes. And it is a hundred and eight
 * separate opportunities for rule 1 to be broken, because the fastest way to draw a
 * recognisable Air Hockey tile is to look at somebody else's Air Hockey tile.
 *
 * A tile composed at build time out of this repository's own vocabulary has none of those
 * problems. It is original by construction — there is nothing to trace, because nothing is
 * traced; every coordinate below was typed here. It costs no files. And a new game gets a
 * tile the moment its catalogue row exists, with no asset step at all.
 *
 * ## The anatomy
 *
 * Four layers on one 64x64 grid, one shared stroke weight, one shared corner radius, so
 * the hundred and eight read as one set:
 *
 *   1. **Ground** — a flat tint from the palette, taken from the catalogue's own `tint`.
 *   2. **Field** — a bold geometric texture in ink at {@link FIELD_ALPHA}, clipped to the
 *      tile's rounded rect. One of {@link FIELDS}.
 *   3. **Mark** — one bold central glyph that says what the game is. One of {@link MARKS}.
 *   4. **Chip** — a small solid shape in the bottom-right corner. One of {@link CHIPS}.
 *
 * The game's name never appears inside the art; it sits beside the tile, in text, where a
 * screen reader and a translator can both reach it.
 *
 * ## Why four layers and not one
 *
 * Rule 7: colour is never the only signal. That rule is usually read as a statement about
 * seats, but it decides this file. Twenty-four marks cannot separate a hundred and eight
 * games on their own, and separating the leftovers by tint would mean two games that are
 * the same picture in two colours — indistinguishable to a player who cannot tell the two
 * colours apart, and identical in greyscale, which the definition of done requires to be
 * playable. So the field and the chip carry the rest of the load, and both are shape.
 *
 * The consequence, stated so it can be tested: **every visible difference between any two
 * tiles is a difference in geometry.** The ink is one near-black for all hundred and eight,
 * so the tint decorates and never discriminates. `tiles.test.ts` fails the build if that
 * stops being true.
 *
 * ## Determinism
 *
 * The mark is a function of the game's own words — its slug, its name, its category, its
 * archetype — so it says something about the game rather than about its position in a list.
 * The field and chip are a function of a hash of the slug, resolved against the other games
 * that share the mark so that no two of them collide. Same catalogue in, same tiles out,
 * on every machine and every build. Nothing here reads a clock, a random number, or the
 * device.
 *
 * ## Where the bytes go
 *
 * Not into any JavaScript chunk. Every consumer of this module is a **server** component, so
 * the tiles are composed during `next build` and land in the static HTML — no image files, no
 * request-time work (#2453 asks for exactly that discipline), and nothing for a browser to
 * fetch. Measured against the same build without them, the 131 emitted scripts are
 * byte-identical: shell 146.9 KB and on-demand 36.2 KB, unmoved, against budgets of 148.0 KB
 * and 37.0 KB.
 *
 * What they do cost is markup, and that is not nothing: **+134 KB gzipped across all 223
 * exported pages**, from 970.8 KB to 1104.3 KB. Per page, +2.0 KB on the home page, +3.1 KB
 * on the catalogue, and +1.1 to +1.7 KB on each of the 108 game pages. That is why
 * {@link TileSprite} exists — the geometry is emitted once per page as `<symbol>`s and each
 * tile is three `<use>` elements, roughly a third of what inlining every path 108 times
 * would cost. No guard in this repository measures HTML, so nothing would have failed if it
 * had been three times worse; the number is written here because it was measured, not
 * because something forced it to be.
 */

/** The mark vocabulary. Twenty-four flat glyphs on a shared grid. */
export const MARKS = [
  'arc',
  'ball',
  'blade',
  'bolt',
  'burst',
  'card',
  'chevron',
  'cog',
  'coin',
  'crown',
  'dice',
  'drop',
  'eye',
  'grid',
  'net',
  'note',
  'paddle',
  'star',
  'steps',
  'stones',
  'swirl',
  'target',
  'wave',
  'wing',
] as const;
export type MarkName = (typeof MARKS)[number];

/** The background texture. Six, all of them shape rather than shade. */
export const FIELDS = ['plain', 'stripes', 'checks', 'dots', 'bars', 'corner'] as const;
export type FieldName = (typeof FIELDS)[number];

/** The corner chip. Three distinct silhouettes, deliberately not three sizes of one. */
export const CHIPS = ['disc', 'square', 'wedge'] as const;
export type ChipName = (typeof CHIPS)[number];

/** How many distinct (field, chip) pairs one mark can distinguish between. */
export const SLOTS_PER_MARK = FIELDS.length * CHIPS.length;

export interface TileSpec {
  readonly slug: string;
  /** Palette token naming the ground colour. Decorative: it never distinguishes a tile. */
  readonly tint: string;
  readonly mark: MarkName;
  readonly field: FieldName;
  readonly chip: ChipName;
}

/**
 * One drawing primitive. The art below is *data*, not JSX, for two reasons: the guard has to
 * be able to compare what two tiles draw without rendering React, and a single generic
 * `Shape -> element` mapping in the component means a new mark cannot drift away from the
 * geometry the guard checked.
 */
export type Shape =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly r: number;
    }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | {
      readonly kind: 'ring';
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly weight: number;
    }
  | { readonly kind: 'fill'; readonly d: string }
  | { readonly kind: 'stroke'; readonly d: string; readonly weight: number };

/** One stroke weight for the whole set. A mark drawn thinner reads as a different family. */
export const STROKE = 5;

/** The tile's corner radius, shared by the ground, the clip and the square chip. */
export const RADIUS = 10;

/**
 * The field is a texture, not a second mark.
 *
 * It was 0.34 first, chosen on the contrast arithmetic alone, and rendering the catalogue
 * showed why that is not enough of a test: at that weight the checks and stripes were the
 * loudest thing on the tile and the mark had to compete with its own background. The fix is
 * both halves — lighter ink *and* finer shapes, so the coverage falls without the texture
 * becoming a wash. See the floor `tiles.test.ts` holds it to.
 */
export const FIELD_ALPHA = 0.22;

/**
 * The marks are drawn edge to edge on the 64 grid and then inset, so a glyph that fills its
 * box does not run into the tile's rounded corners or sit under the seat dots the card puts
 * over the top-left. Applied once per symbol rather than once per tile: the sprite is
 * emitted a few times a page, the tiles a hundred and eight times.
 */
export const MARK_INSET = 0.82;

const rect = (x: number, y: number, w: number, h: number, r = 0): Shape => ({
  kind: 'rect',
  x,
  y,
  w,
  h,
  r,
});
const circle = (cx: number, cy: number, r: number): Shape => ({ kind: 'circle', cx, cy, r });
const ring = (cx: number, cy: number, r: number, weight = STROKE): Shape => ({
  kind: 'ring',
  cx,
  cy,
  r,
  weight,
});
const fill = (d: string): Shape => ({ kind: 'fill', d });
const stroke = (d: string, weight = STROKE): Shape => ({ kind: 'stroke', d, weight });

/** A rounded-rect outline as a path, so it can be stroked like every other line. */
function boxPath(x: number, y: number, w: number, h: number, r: number): string {
  const hw = w - 2 * r;
  const hh = h - 2 * r;
  return (
    `M${String(x + r)} ${String(y)}h${String(hw)}a${String(r)} ${String(r)} 0 0 1 ${String(r)} ${String(r)}` +
    `v${String(hh)}a${String(r)} ${String(r)} 0 0 1 ${String(-r)} ${String(r)}` +
    `h${String(-hw)}a${String(r)} ${String(r)} 0 0 1 ${String(-r)} ${String(-r)}` +
    `v${String(-hh)}a${String(r)} ${String(r)} 0 0 1 ${String(r)} ${String(-r)}z`
  );
}

/**
 * The marks. Each is drawn inside x,y in [12, 50] so it clears the seat dots the card puts
 * over the top-left corner, the "Play" badge over the top-right, and the chip in the
 * bottom-right.
 */
export const MARK_ART: Readonly<Record<MarkName, readonly Shape[]>> = {
  /** A lobbed trajectory between two points: throwing, potting, rolling at something. */
  arc: [stroke('M14 45q17-32 34 0'), circle(14, 45, 4), circle(48, 45, 4)],
  /** A seamed ball. */
  ball: [ring(32, 31, 17), stroke('M15 31h34'), stroke('M32 14q10 17 0 34')],
  /** A thrown blade, edge-on. */
  blade: [fill('M32 11l11 20-11 20-11-20z')],
  /** Reaction: the thing you have to beat. */
  bolt: [fill('M36 12L19 33h11l-4 17 18-24H32z')],
  /** Something going off. */
  burst: [stroke('M32 12v38'), stroke('M13 31h38'), stroke('M18 17l28 28'), stroke('M46 17L18 45')],
  /** Two cards, one face down. */
  card: [fill(boxPath(14, 14, 20, 28, 4)), stroke(boxPath(28, 20, 20, 28, 4))],
  /** Going forward, fast. */
  chevron: [stroke('M20 15l14 16-14 16'), stroke('M34 15l14 16-14 16')],
  /** Machinery. */
  cog: [
    ring(32, 31, 12, 6),
    rect(28, 11, 8, 8, 2),
    rect(28, 43, 8, 8, 2),
    rect(12, 27, 8, 8, 2),
    rect(44, 27, 8, 8, 2),
  ],
  /** Money. */
  coin: [ring(32, 31, 17), rect(29, 20, 6, 22, 3)],
  /** Who is winning. */
  crown: [fill('M14 45V19l9 9 9-15 9 15 9-9v26z')],
  /** A three of a kind. */
  dice: [
    stroke(boxPath(14, 13, 36, 36, 8)),
    circle(24, 23, 3.5),
    circle(32, 31, 3.5),
    circle(40, 39, 3.5),
  ],
  /** Water, or paint. */
  drop: [fill('M32 11c9 12 14 19 14 25a14 14 0 0 1-28 0c0-6 5-13 14-25z')],
  /** Watching, or being watched. */
  eye: [fill('M13 31q19-17 38 0q-19 17-38 0z'), circle(32, 31, 6)],
  /** A board. */
  grid: [stroke('M24 13V49'), stroke('M40 13V49'), stroke('M13 24H49'), stroke('M13 40H49')],
  /** A hoop with a ball under it. */
  net: [stroke('M14 19h36'), stroke('M19 21l3 13h20l3-13'), circle(32, 45, 5)],
  /** Sound. */
  note: [circle(22, 42, 8), rect(28, 12, 5, 30, 2), rect(28, 12, 18, 6, 3)],
  /** A bat and a ball. */
  paddle: [rect(19, 13, 16, 23, 8), rect(24, 34, 6, 15, 3), circle(44, 42, 6)],
  /** Something to catch. */
  star: [
    fill(
      'M32 12L36.7 24.5L50.1 25.1L39.6 33.5L43.2 46.4L32 39L20.8 46.4L24.4 33.5L13.9 25.1L27.3 24.5Z',
    ),
  ],
  /** A stack that can fall over. */
  steps: [rect(15, 38, 34, 11, 3), rect(19, 26, 26, 11, 3), rect(24, 14, 16, 11, 3)],
  /** Two pieces, one each. */
  stones: [circle(24, 25, 10), ring(40, 38, 10)],
  /** Spin. */
  swirl: [stroke('M49 31a17 17 0 1 1-17-17a11 11 0 1 0 11 11a5 5 0 1 1-5-5')],
  /** What you are aiming at. */
  target: [ring(32, 31, 17), circle(32, 31, 7)],
  /** Something long that moves through water or grass. */
  wave: [stroke('M13 36q9.5-18 19 0t19 0'), circle(49, 36, 4.5)],
  /** Getting off the ground. */
  wing: [stroke('M13 44q11-31 36-30'), fill('M50 13l-11 3 8 8z')],
};

/** The textures. Drawn past the edges on purpose: the tile clips them to its rounded rect. */
export const FIELD_ART: Readonly<Record<FieldName, readonly Shape[]>> = {
  plain: [],
  stripes: [-60, -40, -20, 0, 20].map((x) => stroke(`M${String(x)} 80L${String(x + 80)} 0`, 6)),
  checks: [0, 1, 2, 3].flatMap((row) =>
    [0, 1, 2, 3]
      .filter((col) => (row + col) % 2 === 0)
      .map((col) => rect(col * 16, row * 16, 16, 16)),
  ),
  dots: [12, 32, 52].flatMap((y) => [12, 32, 52].map((x) => circle(x, y, 4))),
  bars: [rect(7, 28, 7, 36), rect(21, 16, 7, 48), rect(35, 34, 7, 30), rect(49, 22, 7, 42)],
  corner: [fill('M0 64V38A26 26 0 0 0 26 64Z')],
};

/** The chips. Three silhouettes, tucked into the corner the card leaves free. */
export const CHIP_ART: Readonly<Record<ChipName, readonly Shape[]>> = {
  disc: [circle(53, 53, 5)],
  square: [rect(48, 48, 10, 10, 2)],
  wedge: [fill('M46 58L53 45L60 58Z')],
};

/** Ground colours, by the palette token the catalogue names. */
const GROUND: Readonly<Record<string, string>> = {
  sunTint: colour.sunTint,
  grassTint: colour.grassTint,
  p1Tint: colour.p1Tint,
  p2Tint: colour.p2Tint,
  brandTint: colour.brandTint,
  surface: colour.surface,
};

/**
 * One ink for all hundred and eight marks.
 *
 * It was tempting to draw each mark in the saturated version of its own tint — a sun mark
 * on a sun ground. That reads well in colour and is close to invisible without it: gold on
 * pale gold is 1.2:1, so the whole set would vanish in greyscale and for anyone whose
 * vision does not separate those two. Near-black on every ground is 17:1 on the palest of
 * them, and it makes the tint honestly decorative, which is what rule 7 wants.
 */
export const INK = colour.ink;

export function groundFor(tint: string): string {
  return GROUND[tint] ?? colour.surface;
}

/**
 * The mark vocabulary applied to a game, in order, first match winning.
 *
 * Order carries meaning and is load-bearing: `snakes-and-ladders` is a dice game before it
 * is a snake, `sword-throwing` is a blade before it is a throw, and `cup-pong` is a lob
 * before `ping-pong` claims every slug containing "pong".
 */
const MARK_RULES: readonly (readonly [MarkName, readonly string[]])[] = [
  ['dice', ['dice', 'yatzy', 'yahtzee', 'ludo', 'backgammon', 'ladders', 'shut-the-box']],
  ['note', ['disco', 'rhythm', 'music', 'dance']],
  ['eye', ['guard', 'thief', 'guess', 'stealth', 'hide']],
  ['card', ['memory', 'solitaire', 'card', 'pizza']],
  ['cog', ['robot', 'nuts-and-bolts', 'machine']],
  ['coin', ['money', 'coin', 'fingers', 'grab']],
  ['blade', ['knife', 'sword', 'shuriken', 'spike', 'sashimi']],
  ['net', ['basketball', 'hoop']],
  ['target', ['archery', 'darts', 'target', 'cannon', 'shoot']],
  [
    'grid',
    [
      'tic-tac-toe',
      'chess',
      'checkers',
      'sudoku',
      'maze',
      'sliding',
      'dots-and-boxes',
      'sea-battle',
      'ship-battle',
      'tiles',
      'puzzle',
    ],
  ],
  [
    'stones',
    [
      'reversi',
      'mancala',
      'drop-four',
      'colour-wars',
      'color-wars',
      'pop-it',
      'rock-paper',
      'match',
    ],
  ],
  ['steps', ['stack', 'lumberjack', 'blocks', 'tower', 'wobble']],
  [
    'chevron',
    ['racing', 'race', 'cars', 'wheelie', 'traffic', 'taxi', 'road', 'crash', 'stampede'],
  ],
  ['wing', ['bird', 'flappy', 'jump', 'frog', 'chicken', 'gravity', 'beak']],
  ['wave', ['snake', 'fish', 'piranha', 'tongue']],
  ['crown', ['king', 'sumo', 'wrestle', 'rope']],
  ['drop', ['water', 'paint', 'frozen', 'ice']],
  ['swirl', ['spin', 'pinball']],
  ['burst', ['explosive', 'blast', 'brick', 'siege', 'dung', 'battle', 'potato']],
  ['bolt', ['slap', 'math', 'whack', 'duel']],
  [
    'arc',
    [
      'bowling',
      'cornhole',
      'cup-pong',
      'golf',
      'pool',
      'carrom',
      'sling',
      'throw',
      'hammer',
      'snowball',
    ],
  ],
  ['paddle', ['ping-pong', 'tennis', 'air-hockey', 'hockey', 'cricket']],
  ['ball', ['ball', 'soccer', 'penalty', 'volley', 'football', 'kick']],
  ['star', ['star', 'catcher']],
];

/** What a game gets when nothing in its name says what it is. */
export const CATEGORY_MARK: Readonly<Record<string, MarkName>> = {
  Arcade: 'burst',
  Arena: 'crown',
  Board: 'grid',
  Deduction: 'eye',
  Dice: 'dice',
  Memory: 'card',
  Party: 'star',
  Platform: 'wing',
  Puzzle: 'grid',
  Racing: 'chevron',
  'Racing & Trails': 'wave',
  Reaction: 'bolt',
  Rhythm: 'note',
  Shooter: 'target',
  Solo: 'grid',
  Sports: 'ball',
  Stealth: 'eye',
  Survival: 'blade',
};

/** And what it gets when its category is new too, so a tile always exists. */
const ARCHETYPE_MARK: Readonly<Record<string, MarkName>> = {
  'turn-board': 'grid',
  'turn-aim': 'target',
  'rt-split': 'paddle',
  'rt-arena': 'burst',
  'rt-race': 'chevron',
};

/** The mark this game's own words earn it. Total: every entry gets one. */
export function markFor(entry: CatalogueEntry): MarkName {
  const words = `${entry.slug} ${entry.name.toLowerCase()}`;
  for (const [mark, keywords] of MARK_RULES) {
    if (keywords.some((keyword) => words.includes(keyword))) return mark;
  }
  return CATEGORY_MARK[entry.category] ?? ARCHETYPE_MARK[entry.archetype] ?? 'grid';
}

/** FNV-1a, 32-bit. A stable hash that does not depend on a runtime's string hashing. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Give every game a tile.
 *
 * Games are grouped by the mark their own words earned them, and inside a group each one
 * takes a (field, chip) slot: the one its hash prefers if it is free, otherwise the next
 * free one. Hashing first means adding a game usually disturbs nobody; probing means two
 * games that hash the same still end up different, which a bare hash would not guarantee.
 *
 * A group larger than {@link SLOTS_PER_MARK} would exhaust its slots and hand two games the
 * same tile. That is not silently patched over here — `tiles.test.ts` fails, naming both
 * games, because the repair is to split the group with a new mark, and a tile system that
 * quietly duplicates is worse than one that stops.
 */
function assignTiles(entries: readonly CatalogueEntry[]): ReadonlyMap<string, TileSpec> {
  const groups = new Map<MarkName, CatalogueEntry[]>();
  const ordered = [...entries].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const entry of ordered) {
    const mark = markFor(entry);
    const group = groups.get(mark);
    if (group) group.push(entry);
    else groups.set(mark, [entry]);
  }

  const tiles = new Map<string, TileSpec>();
  for (const [mark, group] of groups) {
    const taken = new Set<number>();
    for (const entry of group) {
      const preferred = hash(entry.slug) % SLOTS_PER_MARK;
      let slot = preferred;
      for (let step = 1; step <= SLOTS_PER_MARK && taken.has(slot); step += 1) {
        slot = (preferred + step) % SLOTS_PER_MARK;
      }
      taken.add(slot);
      tiles.set(entry.slug, {
        slug: entry.slug,
        tint: entry.tint,
        mark,
        field: FIELDS[slot % FIELDS.length] ?? 'plain',
        chip: CHIPS[Math.floor(slot / FIELDS.length)] ?? 'disc',
      });
    }
  }
  return tiles;
}

/** Every game's tile, computed once at build time from the catalogue. */
export const TILES: ReadonlyMap<string, TileSpec> = assignTiles(CATALOGUE);

/**
 * The tile for one game.
 *
 * Falls back to composing one on the spot for an entry the catalogue does not contain,
 * so a caller can never render a card with a hole where the art should be.
 */
export function tileFor(entry: CatalogueEntry): TileSpec {
  const known = TILES.get(entry.slug);
  if (known) return known;
  return { slug: entry.slug, tint: entry.tint, mark: markFor(entry), field: 'plain', chip: 'disc' };
}

/** Everything a tile draws, in order. Colour is not part of it, and that is the point. */
export function tileGeometry(spec: TileSpec): readonly Shape[] {
  return [...FIELD_ART[spec.field], ...MARK_ART[spec.mark], ...CHIP_ART[spec.chip]];
}
