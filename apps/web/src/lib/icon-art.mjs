/**
 * The interface glyph set, as geometry (#74).
 *
 * ## Why this shape
 *
 * This mirrors `lib/tiles.ts`: an original set of pictures composed at build time out of
 * this repository's own primitives, so there is nothing to trace (rule 1), no files to
 * ship, and one shared stroke weight and grid holding the set together. Where the tiles are
 * emitted once per page as same-document `<symbol>`s by `TileSprite.tsx`, the icons are
 * emitted once for the whole app by `scripts/emit-icon-sprite.mjs` into
 * `components/icon-sprite.generated.ts`, and `IconSprite` drops that one `<svg>` into the
 * document so every `<Icon>` is a two-hundred-byte `<use>` rather than a fresh copy of the
 * path.
 *
 * ## Why a plain module, not TypeScript
 *
 * The build-time emitter is a `.mjs` Node script and cannot import a `.ts` source without a
 * compile step, and the geometry is the one thing the emitter and the typed `icons.ts` must
 * agree on exactly. So the geometry lives here, in plain JS, and both sides import it — the
 * same arrangement `scripts/credential-formats.mjs` uses, and the same reason `tokens.ts`
 * mirrors `tokens.css`. `icons.ts` adds the types and `icons.test.ts` pins the two together.
 *
 * ## The grid
 *
 * A 24-unit square, a single 2-unit stroke, round caps and joins. `currentColor`
 * throughout: the `<use>` that references a symbol sets `color`, and the content inherits
 * it, so one symbol serves an icon in any colour. Every visible glyph is geometry — no
 * text, so a screen reader reads the `<Icon>`'s label, not a letter baked into a path.
 */

export const ICON_VIEWBOX = 24;
export const ICON_STROKE = 2;

/** The id a symbol is emitted under, and a `<use>` points at. */
export function iconSymbolId(name) {
  return `db-icon-${name}`;
}

/** The points of a regular star, computed so the geometry is exact rather than eyeballed. */
function starPoints(cx, cy, outer, inner, tips) {
  const points = [];
  for (let i = 0; i < tips * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / tips) * i - Math.PI / 2;
    const x = Math.round((cx + radius * Math.cos(angle)) * 100) / 100;
    const y = Math.round((cy + radius * Math.sin(angle)) * 100) / 100;
    points.push([x, y]);
  }
  return points;
}

const STAR = starPoints(12, 12, 8.5, 3.4, 5);

/**
 * One glyph as an array of primitives. Each primitive is stroked in `currentColor` unless it
 * carries `fill: true`, in which case it is filled. Kinds: `line`, `poly` (an open or closed
 * run of points), `circle`, `rect`, `path`.
 */
export const ICON_ART = {
  play: [{ kind: 'poly', points: [[8, 5], [8, 19], [19, 12]], closed: true, fill: true }],
  pause: [
    { kind: 'rect', x: 7, y: 5, w: 3.5, h: 14, r: 1, fill: true },
    { kind: 'rect', x: 13.5, y: 5, w: 3.5, h: 14, r: 1, fill: true },
  ],
  'sound-on': [
    {
      kind: 'poly',
      points: [[3, 9.5], [7, 9.5], [11, 5.5], [11, 18.5], [7, 14.5], [3, 14.5]],
      closed: true,
      fill: true,
    },
    { kind: 'path', d: 'M15 9.5a4 4 0 0 1 0 5' },
    { kind: 'path', d: 'M17.5 7a7.5 7.5 0 0 1 0 10' },
  ],
  'sound-off': [
    {
      kind: 'poly',
      points: [[3, 9.5], [7, 9.5], [11, 5.5], [11, 18.5], [7, 14.5], [3, 14.5]],
      closed: true,
      fill: true,
    },
    { kind: 'line', x1: 15, y1: 9.5, x2: 20, y2: 14.5 },
    { kind: 'line', x1: 20, y1: 9.5, x2: 15, y2: 14.5 },
  ],
  settings: [
    { kind: 'line', x1: 4, y1: 7, x2: 20, y2: 7 },
    { kind: 'line', x1: 4, y1: 12, x2: 20, y2: 12 },
    { kind: 'line', x1: 4, y1: 17, x2: 20, y2: 17 },
    { kind: 'circle', cx: 9, cy: 7, r: 2.2, fill: true },
    { kind: 'circle', cx: 16, cy: 12, r: 2.2, fill: true },
    { kind: 'circle', cx: 8, cy: 17, r: 2.2, fill: true },
  ],
  close: [
    { kind: 'line', x1: 6, y1: 6, x2: 18, y2: 18 },
    { kind: 'line', x1: 18, y1: 6, x2: 6, y2: 18 },
  ],
  back: [{ kind: 'poly', points: [[14.5, 5], [7.5, 12], [14.5, 19]], closed: false }],
  forward: [{ kind: 'poly', points: [[9.5, 5], [16.5, 12], [9.5, 19]], closed: false }],
  star: [{ kind: 'poly', points: STAR, closed: true }],
  'star-filled': [{ kind: 'poly', points: STAR, closed: true, fill: true }],
  trophy: [
    { kind: 'path', d: 'M7 4h10v5a5 5 0 0 1-10 0z' },
    { kind: 'path', d: 'M7 5H4v2a3 3 0 0 0 3 3' },
    { kind: 'path', d: 'M17 5h3v2a3 3 0 0 1-3 3' },
    { kind: 'line', x1: 12, y1: 14, x2: 12, y2: 17 },
    { kind: 'rect', x: 8, y: 17, w: 8, h: 2.5, r: 1, fill: true },
  ],
  refresh: [
    { kind: 'path', d: 'M18 8a7 7 0 1 0 1.5 5' },
    { kind: 'poly', points: [[18, 3.5], [18, 8.5], [13, 8.5]], closed: true, fill: true },
  ],
  check: [{ kind: 'poly', points: [[5, 12.5], [10, 17.5], [19, 7]], closed: false }],
  info: [
    { kind: 'circle', cx: 12, cy: 12, r: 8.5 },
    { kind: 'line', x1: 12, y1: 11, x2: 12, y2: 16.5 },
    { kind: 'circle', cx: 12, cy: 7.8, r: 1, fill: true },
  ],
};

/** The canonical name order — object insertion order, so two builds emit the same sprite. */
export const ICON_NAMES = Object.keys(ICON_ART);

const n = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
};

/** One primitive as an SVG element string. Shared by the emitter so nothing draws twice. */
export function shapeToSvg(shape) {
  const stroke = shape.fill
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-width="' +
      ICON_STROKE +
      '" stroke-linecap="round" stroke-linejoin="round"';
  switch (shape.kind) {
    case 'line':
      return `<line x1="${n(shape.x1)}" y1="${n(shape.y1)}" x2="${n(shape.x2)}" y2="${n(shape.y2)}" ${stroke}/>`;
    case 'circle':
      return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}" ${stroke}/>`;
    case 'rect':
      return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.w)}" height="${n(shape.h)}" rx="${n(shape.r ?? 0)}" ${stroke}/>`;
    case 'path':
      return `<path d="${shape.d}" ${stroke}/>`;
    case 'poly': {
      const points = shape.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
      const tag = shape.closed ? 'polygon' : 'polyline';
      return `<${tag} points="${points}" ${stroke}/>`;
    }
    default:
      throw new Error(`unknown icon shape: ${String(shape.kind)}`);
  }
}

/** One glyph as a `<symbol>`. */
export function symbolMarkup(name) {
  const art = ICON_ART[name];
  if (!art) throw new Error(`no icon named ${name}`);
  const body = art.map(shapeToSvg).join('');
  return `<symbol id="${iconSymbolId(name)}" viewBox="0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}">${body}</symbol>`;
}

/** The whole set as same-document `<symbol>`s, ready to sit inside one hidden `<svg>`. */
export function spriteSymbols(names = ICON_NAMES) {
  return names.map(symbolMarkup).join('');
}
