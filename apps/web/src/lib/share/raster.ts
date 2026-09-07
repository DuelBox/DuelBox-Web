import type { Shape } from '../tiles';

/**
 * A polygon rasteriser, written here rather than installed (#2453).
 *
 * ## Why this exists at all
 *
 * The share images have to be raster — every social platform that matters renders PNG and
 * effectively none of them render SVG — and this repository had nothing that turns a shape
 * into pixels. The lockfile was searched before any of this was designed: `sharp` is in it,
 * but only as an optional dependency of `next` that nothing installs into a place a script
 * can reach, and it rasterises SVG through whichever libvips and librsvg the machine
 * happens to carry. That is the property that ruled it out rather than the install: the
 * tile system's whole claim is "same catalogue in, same tiles out, on every machine and
 * every build", and a picture whose pixels depend on a system library's version is not
 * that. Everything below is integer and float arithmetic in this file, so a card composed
 * on a laptop and a card composed on a CI runner are the same picture.
 *
 * ## What it does
 *
 * One entry point that matters: {@link maskFor} turns a list of polygons into a coverage
 * mask — one float per pixel saying how much of that pixel the shape covers. Colour never
 * enters here. {@link paint} is what puts a colour through a mask onto a canvas, so the
 * same mask serves a tile in a red tint and the identical tile in a blue one, and — much
 * more to the point — the thirty-three symbols in the tile vocabulary are rasterised once
 * each and composited into a hundred and eight cards.
 *
 * ## How the coverage is computed
 *
 * A scanline fill with the non-zero winding rule, four sample rows per pixel row, and exact
 * horizontal coverage within each span. That asymmetry is deliberate: horizontal coverage
 * is analytic and free, so the only place sampling error can show is a near-horizontal
 * edge, and four sub-rows put that below what a viewer can see at this size.
 *
 * The non-zero rule is also what makes strokes work. A stroked path becomes a quadrilateral
 * per segment and a disc per join, all wound the same way; non-zero treats the union of
 * overlapping same-wound shapes as solid, so the pieces fuse instead of cancelling at the
 * overlaps. `raster.test.ts` holds that property down, because getting the winding of one
 * piece backwards produces a hole rather than an error.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A closed ring of points. Everything drawn here is one of these by the time it is filled. */
export type Polygon = readonly Point[];

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A uniform scale and a translation. Nothing here needs rotation or skew. */
export interface Transform {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

/** Coverage in 0..1, one entry per pixel, row-major. */
export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

/** Packed RGB triples, row-major. No alpha: a share card is opaque by construction. */
export interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8ClampedArray;
}

/** Sample rows per pixel row. Four is where the diagonal marks stop looking stepped. */
const SUBSAMPLES = 4;

/**
 * How finely a curve is chopped into straight lines, in device pixels per segment.
 *
 * Half a pixel rather than one: the marks are drawn at nearly a third of the card's height,
 * so a curve that is smooth on a 64-pixel tile is eight times longer here and a per-pixel
 * chord would show as facets on the discs.
 */
const FLATNESS = 0.5;

export function transformed(t: Transform, x: number, y: number): Point {
  return { x: x * t.scale + t.dx, y: y * t.scale + t.dy };
}

/** `inner` applied first, then `outer`. Uniform scales compose by multiplying. */
export function concat(outer: Transform, inner: Transform): Transform {
  return {
    scale: outer.scale * inner.scale,
    dx: outer.dx + inner.dx * outer.scale,
    dy: outer.dy + inner.dy * outer.scale,
  };
}

/** Scaling about a point, which is the one transform the tile vocabulary asks for. */
export function scaleAbout(factor: number, centreX: number, centreY: number): Transform {
  return { scale: factor, dx: centreX * (1 - factor), dy: centreY * (1 - factor) };
}

export function parseColour(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

// ---------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------

/**
 * A run of points, and whether the path closed itself.
 *
 * Closure is carried rather than assumed because it changes what a *stroke* draws: an open
 * run gets a round cap at each end, a closed one gets a join between its last point and its
 * first. `tiles.ts` has both — the rounded box the `dice` mark strokes is closed, the arc
 * under the `arc` mark is not.
 */
export interface SubPath {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

// Every SVG path command letter, including the ones below refuse to draw. Splitting on the
// full set is what makes an unimplemented command an error instead of a silent mangling:
// with `S` missing from the delimiters, `M0 0S10 10 20 20` parsed as a move with four extra
// parameters and drew two lines nobody asked for.
const COMMANDS = /([MmZzLlHhVvCcSsQqTtAa])([^MmZzLlHhVvCcSsQqTtAa]*)/g;
const NUMBERS = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/**
 * The SVG path subset `tiles.ts` actually uses, flattened to polylines.
 *
 * Every command in the vocabulary is handled — move, line, horizontal, vertical, cubic,
 * quadratic, smooth quadratic, elliptical arc and close — because the marks were drawn
 * with whichever was shortest to type, and a parser that silently ignored one would drop
 * part of a glyph rather than fail. An unknown command throws for the same reason.
 */
export function flattenPath(d: string, scale: number): SubPath[] {
  const paths: SubPath[] = [];
  let points: Point[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The reflected control point that `t` needs, or null when the previous command was not
  // a quadratic — in which case the spec says the control point coincides with the cursor.
  let lastQuadratic: Point | null = null;

  const push = (px: number, py: number) => {
    points.push({ x: px, y: py });
  };
  const finish = (closed: boolean) => {
    if (points.length > 1) paths.push({ points, closed });
    points = [];
  };

  for (const [, letter = '', rest = ''] of d.matchAll(COMMANDS)) {
    const args = [...rest.matchAll(NUMBERS)].map((match) => Number(match[0]));
    const relative = letter === letter.toLowerCase();
    let index = 0;
    const next = () => args[index++] ?? 0;

    if (letter === 'Z' || letter === 'z') {
      finish(true);
      x = startX;
      y = startY;
      lastQuadratic = null;
      continue;
    }

    // A command letter may carry several parameter sets; `M 1 2 3 4` is a move and a line.
    let first = true;
    while (index < args.length) {
      const fromX = x;
      const fromY = y;
      switch (letter.toUpperCase()) {
        case 'M': {
          const nx = next();
          const ny = next();
          x = relative ? x + nx : nx;
          y = relative ? y + ny : ny;
          if (first) {
            finish(false);
            startX = x;
            startY = y;
            push(x, y);
          } else {
            push(x, y);
          }
          break;
        }
        case 'L': {
          const nx = next();
          const ny = next();
          x = relative ? x + nx : nx;
          y = relative ? y + ny : ny;
          push(x, y);
          break;
        }
        case 'H': {
          const nx = next();
          x = relative ? x + nx : nx;
          push(x, y);
          break;
        }
        case 'V': {
          const ny = next();
          y = relative ? y + ny : ny;
          push(x, y);
          break;
        }
        case 'C': {
          const c1x = (relative ? x : 0) + next();
          const c1y = (relative ? y : 0) + next();
          const c2x = (relative ? x : 0) + next();
          const c2y = (relative ? y : 0) + next();
          const ex = (relative ? x : 0) + next();
          const ey = (relative ? y : 0) + next();
          cubic(push, fromX, fromY, c1x, c1y, c2x, c2y, ex, ey, scale);
          x = ex;
          y = ey;
          break;
        }
        case 'Q': {
          const cx = (relative ? x : 0) + next();
          const cy = (relative ? y : 0) + next();
          const ex = (relative ? x : 0) + next();
          const ey = (relative ? y : 0) + next();
          quadratic(push, fromX, fromY, cx, cy, ex, ey, scale);
          lastQuadratic = { x: cx, y: cy };
          x = ex;
          y = ey;
          break;
        }
        case 'T': {
          // Annotated because the assignment to `lastQuadratic` a few lines down makes
          // its inferred type depend on these two, and these two on it.
          const cx: number = lastQuadratic === null ? x : 2 * x - lastQuadratic.x;
          const cy: number = lastQuadratic === null ? y : 2 * y - lastQuadratic.y;
          const ex = (relative ? x : 0) + next();
          const ey = (relative ? y : 0) + next();
          quadratic(push, fromX, fromY, cx, cy, ex, ey, scale);
          lastQuadratic = { x: cx, y: cy };
          x = ex;
          y = ey;
          break;
        }
        case 'A': {
          const rx = next();
          const ry = next();
          const rotation = next();
          const largeArc = next() !== 0;
          const sweep = next() !== 0;
          const ex = (relative ? x : 0) + next();
          const ey = (relative ? y : 0) + next();
          arc(push, fromX, fromY, rx, ry, rotation, largeArc, sweep, ex, ey, scale);
          x = ex;
          y = ey;
          break;
        }
        default:
          throw new Error(`share/raster: unsupported path command "${letter}" in "${d}"`);
      }
      if (letter.toUpperCase() !== 'Q' && letter.toUpperCase() !== 'T') lastQuadratic = null;
      first = false;
    }
  }
  finish(false);
  return paths;
}

/** Segments to chop a curve into, from its rough length in device pixels. */
function steps(length: number, scale: number): number {
  return Math.min(256, Math.max(4, Math.ceil((length * scale) / FLATNESS)));
}

function quadratic(
  push: (x: number, y: number) => void,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  scale: number,
): void {
  const length = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
  const n = steps(length, scale);
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
  }
}

function cubic(
  push: (x: number, y: number) => void,
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
  scale: number,
): void {
  const length =
    Math.hypot(c1x - x0, c1y - y0) +
    Math.hypot(c2x - c1x, c2y - c1y) +
    Math.hypot(x1 - c2x, y1 - c2y);
  const n = steps(length, scale);
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    push(
      u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1,
      u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1,
    );
  }
}

/**
 * An elliptical arc, endpoint form to centre form, exactly as SVG's implementation notes
 * F.6.5 and F.6.6 set it out — including the radius correction, which the `swirl` mark
 * needs: its three arcs are written with radii that only just span their endpoints.
 */
function arc(
  push: (x: number, y: number) => void,
  x0: number,
  y0: number,
  rx: number,
  ry: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
  scale: number,
): void {
  if (rx === 0 || ry === 0) {
    push(x1, y1);
    return;
  }
  let a = Math.abs(rx);
  let b = Math.abs(ry);
  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x0 - x1) / 2;
  const dy2 = (y0 - y1) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (a * a) + (y1p * y1p) / (b * b);
  if (lambda > 1) {
    const scaleUp = Math.sqrt(lambda);
    a *= scaleUp;
    b *= scaleUp;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = a * a * b * b - a * a * y1p * y1p - b * b * x1p * x1p;
  const denominator = a * a * y1p * y1p + b * b * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator) / denominator);
  const cxp = (coefficient * (a * y1p)) / b;
  const cyp = (coefficient * -(b * x1p)) / a;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const angle = Math.acos(Math.min(1, Math.max(-1, dot / length)));
    return ux * vy - uy * vx < 0 ? -angle : angle;
  };
  const startAngle = angleOf(1, 0, (x1p - cxp) / a, (y1p - cyp) / b);
  let delta = angleOf((x1p - cxp) / a, (y1p - cyp) / b, (-x1p - cxp) / a, (-y1p - cyp) / b);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const n = steps(Math.abs(delta) * Math.max(a, b), scale);
  for (let i = 1; i <= n; i += 1) {
    const angle = startAngle + (delta * i) / n;
    const ex = Math.cos(angle) * a;
    const ey = Math.sin(angle) * b;
    push(cosPhi * ex - sinPhi * ey + cx, sinPhi * ex + cosPhi * ey + cy);
  }
}

// ---------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------

/** Points around a circle. `winding` picks the direction, which is what makes rings hollow. */
function discPolygon(cx: number, cy: number, r: number, scale: number, winding: 1 | -1): Polygon {
  const n = Math.min(512, Math.max(12, Math.ceil((2 * Math.PI * r * scale) / FLATNESS)));
  const points: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (winding * 2 * Math.PI * i) / n;
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return points;
}

function roundedRectPolygon(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  scale: number,
): Polygon {
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }
  const points: Point[] = [];
  const corners: readonly (readonly [number, number, number])[] = [
    [x + w - radius, y + radius, -Math.PI / 2],
    [x + w - radius, y + h - radius, 0],
    [x + radius, y + h - radius, Math.PI / 2],
    [x + radius, y + radius, Math.PI],
  ];
  const n = Math.min(64, Math.max(4, Math.ceil((radius * scale) / FLATNESS)));
  for (const [cx, cy, from] of corners) {
    for (let i = 0; i <= n; i += 1) {
      const angle = from + (Math.PI / 2) * (i / n);
      points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    }
  }
  return points;
}

/**
 * A stroked polyline as filled polygons: a quadrilateral per segment and a disc per joint.
 *
 * This is the round cap and the round join `TileSprite` sets on every stroked mark, arrived
 * at from the other end — a disc at a vertex *is* a round join, and a disc at an end *is* a
 * round cap. All the pieces are wound the same way so the non-zero rule fuses them; see the
 * note at the top about why that matters.
 */
function strokePolygons(path: SubPath, weight: number, scale: number): Polygon[] {
  const half = weight / 2;
  const polygons: Polygon[] = [];
  const points = path.points;
  const segments = path.closed ? points.length : points.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    // A zero-length segment has no direction to offset along, and its round cap is already
    // covered by the joint disc below.
    if (length < 1e-9) continue;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    polygons.push([
      { x: from.x + nx, y: from.y + ny },
      { x: to.x + nx, y: to.y + ny },
      { x: to.x - nx, y: to.y - ny },
      { x: from.x - nx, y: from.y - ny },
    ]);
  }
  // A disc at every point: at an interior vertex that is the round join, at either end of
  // an open run it is the round cap. Both are what `TileSprite` asks the browser for.
  for (const point of points) polygons.push(discPolygon(point.x, point.y, half, scale, -1));
  return polygons;
}

/**
 * One shape from the tile vocabulary as polygons in device space.
 *
 * The single mapping `TileSprite.draw` is for SVG, this is for pixels, and they are held to
 * the same geometry by `tiles.ts` being the only place either reads.
 */
export function shapePolygons(shape: Shape, t: Transform): Polygon[] {
  const at = (x: number, y: number) => transformed(t, x, y);
  switch (shape.kind) {
    case 'rect': {
      const corner = at(shape.x, shape.y);
      return [
        roundedRectPolygon(
          corner.x,
          corner.y,
          shape.w * t.scale,
          shape.h * t.scale,
          shape.r * t.scale,
          1,
        ),
      ];
    }
    case 'circle': {
      const centre = at(shape.cx, shape.cy);
      return [discPolygon(centre.x, centre.y, shape.r * t.scale, 1, 1)];
    }
    case 'ring': {
      const centre = at(shape.cx, shape.cy);
      const outer = (shape.r + shape.weight / 2) * t.scale;
      const inner = (shape.r - shape.weight / 2) * t.scale;
      return [
        discPolygon(centre.x, centre.y, outer, 1, 1),
        discPolygon(centre.x, centre.y, inner, 1, -1),
      ];
    }
    case 'fill':
      return flattenPath(shape.d, t.scale).map((path) => path.points.map((p) => at(p.x, p.y)));
    case 'stroke':
      return flattenPath(shape.d, t.scale).flatMap((path) =>
        strokePolygons(
          { points: path.points.map((p) => at(p.x, p.y)), closed: path.closed },
          shape.weight * t.scale,
          1,
        ),
      );
  }
}

// ---------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------

interface Edge {
  readonly x: number;
  readonly y: number;
  readonly slope: number;
  readonly top: number;
  readonly bottom: number;
  readonly direction: 1 | -1;
}

/** Coverage for a set of polygons, filled with the non-zero winding rule. */
export function maskFor(polygons: readonly Polygon[], width: number, height: number): Mask {
  const data = new Float32Array(width * height);
  const edges: Edge[] = [];
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i += 1) {
      const from = polygon[i];
      const to = polygon[(i + 1) % polygon.length];
      if (from === undefined || to === undefined || from.y === to.y) continue;
      const upward = to.y > from.y;
      edges.push({
        x: from.x,
        y: from.y,
        slope: (to.x - from.x) / (to.y - from.y),
        top: Math.min(from.y, to.y),
        bottom: Math.max(from.y, to.y),
        direction: upward ? 1 : -1,
      });
      top = Math.min(top, from.y, to.y);
      bottom = Math.max(bottom, from.y, to.y);
    }
  }
  if (edges.length === 0) return { width, height, data };

  const firstRow = Math.max(0, Math.floor(top));
  const lastRow = Math.min(height - 1, Math.ceil(bottom));
  const weight = 1 / SUBSAMPLES;
  const hits: { x: number; direction: number }[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const base = row * width;
    for (let sample = 0; sample < SUBSAMPLES; sample += 1) {
      const y = row + (sample + 0.5) / SUBSAMPLES;
      hits.length = 0;
      for (const edge of edges) {
        if (y < edge.top || y >= edge.bottom) continue;
        hits.push({ x: edge.x + (y - edge.y) * edge.slope, direction: edge.direction });
      }
      if (hits.length === 0) continue;
      hits.sort((a, b) => a.x - b.x);
      let winding = 0;
      let spanStart = 0;
      for (const hit of hits) {
        const before = winding;
        winding += hit.direction;
        if (before === 0 && winding !== 0) spanStart = hit.x;
        else if (before !== 0 && winding === 0)
          addSpan(data, base, width, spanStart, hit.x, weight);
      }
    }
  }
  for (let i = 0; i < data.length; i += 1) {
    if (data[i]! > 1) data[i] = 1;
  }
  return { width, height, data };
}

/** One horizontal run of coverage, with the part-covered pixel at each end done exactly. */
function addSpan(
  data: Float32Array,
  base: number,
  width: number,
  from: number,
  to: number,
  weight: number,
): void {
  const left = Math.max(from, 0);
  const right = Math.min(to, width);
  if (right <= left) return;
  const firstPixel = Math.floor(left);
  const lastPixel = Math.min(width - 1, Math.ceil(right) - 1);
  for (let pixel = firstPixel; pixel <= lastPixel; pixel += 1) {
    const covered = Math.min(right, pixel + 1) - Math.max(left, pixel);
    if (covered > 0) data[base + pixel] = data[base + pixel]! + covered * weight;
  }
}

/** Coverage of both, which is how the field texture gets clipped to the tile's corners. */
export function intersect(mask: Mask, clip: Mask): Mask {
  const data = new Float32Array(mask.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = mask.data[i]! * clip.data[i]!;
  return { width: mask.width, height: mask.height, data };
}

// ---------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------

export function createCanvas(width: number, height: number, background: Rgb): Canvas {
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0; i < rgb.length; i += 3) {
    rgb[i] = background.r;
    rgb[i + 1] = background.g;
    rgb[i + 2] = background.b;
  }
  return { width, height, rgb };
}

/** Source-over compositing of one colour through a mask, at an offset on the canvas. */
export function paint(
  canvas: Canvas,
  mask: Mask,
  offsetX: number,
  offsetY: number,
  colour: Rgb,
  alpha = 1,
): void {
  for (let y = 0; y < mask.height; y += 1) {
    const canvasY = y + offsetY;
    if (canvasY < 0 || canvasY >= canvas.height) continue;
    for (let x = 0; x < mask.width; x += 1) {
      const coverage = mask.data[y * mask.width + x]!;
      if (coverage <= 0) continue;
      const canvasX = x + offsetX;
      if (canvasX < 0 || canvasX >= canvas.width) continue;
      const a = coverage * alpha;
      const index = (canvasY * canvas.width + canvasX) * 3;
      canvas.rgb[index] = colour.r * a + canvas.rgb[index]! * (1 - a);
      canvas.rgb[index + 1] = colour.g * a + canvas.rgb[index + 1]! * (1 - a);
      canvas.rgb[index + 2] = colour.b * a + canvas.rgb[index + 2]! * (1 - a);
    }
  }
}

/** An axis-aligned block of solid colour, for the parts of the card that are not artwork. */
export function fillRect(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: Rgb,
): void {
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(canvas.width, Math.round(x + width));
  const bottom = Math.min(canvas.height, Math.round(y + height));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const index = (row * canvas.width + column) * 3;
      canvas.rgb[index] = colour.r;
      canvas.rgb[index + 1] = colour.g;
      canvas.rgb[index + 2] = colour.b;
    }
  }
}
