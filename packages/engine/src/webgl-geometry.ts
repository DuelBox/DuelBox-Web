import type { TransformStack } from './webgl-transform.js';

/**
 * Shapes as triangles, written into one growable vertex buffer (#16).
 *
 * The 2D backend hands a shape to the browser and the browser rasterises it. Here every
 * shape becomes triangles in a single interleaved buffer — position, texture coordinate,
 * colour — so that a whole frame of rectangles, circles, lines and glyphs is one upload and
 * as few draw calls as there are texture changes. The buffer grows geometrically to the
 * largest frame seen and then stays: after the first frame at a game's peak, a frame
 * allocates nothing (rule 5). `allocations` counts the growths so a test can prove it.
 *
 * Coordinates are transformed through the {@link TransformStack} as they are written, in
 * logical units in and device pixels out, so the shader is a fixed orthographic map and a
 * seat rotation in the middle of a frame never splits the batch.
 */

/** x, y, u, v, r, g, b, a. */
export const FLOATS_PER_VERTEX = 8;

/** Bytes per float in the buffer the GPU reads. */
export const BYTES_PER_FLOAT = 4;

/**
 * How finely a circle is drawn, as a function of its on-screen radius.
 *
 * Twelve segments on a pip a few pixels wide and ninety-six on a board-sized disc: the
 * bound above is where the polygon becomes indistinguishable from the arc at any radius a
 * game draws, and the one below is where a circle stops being a circle. Between them the
 * count follows the circumference, so the segment length stays roughly a couple of device
 * pixels — the same visual error at every size.
 */
export function circleSegments(radiusPx: number): number {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) return 12;
  const byArc = Math.ceil(radiusPx * 1.2);
  return Math.max(12, Math.min(96, byArc));
}

export class VertexWriter {
  #buffer: Float32Array;
  #capacity: number;
  #used = 0;
  #allocations = 0;
  readonly #transform: TransformStack;

  constructor(transform: TransformStack, initialVertices = 4096) {
    if (!Number.isInteger(initialVertices) || initialVertices <= 0) {
      throw new RangeError('initialVertices must be a positive integer');
    }
    this.#transform = transform;
    this.#capacity = initialVertices * FLOATS_PER_VERTEX;
    this.#buffer = new Float32Array(this.#capacity);
  }

  /** The live buffer; `floatsUsed` of it are meaningful. Not to be kept across a grow. */
  get buffer(): Float32Array {
    return this.#buffer;
  }

  get floatsUsed(): number {
    return this.#used;
  }

  get vertexCount(): number {
    return this.#used / FLOATS_PER_VERTEX;
  }

  /** Structural growths so far; flat once a game has drawn its busiest frame. */
  get allocations(): number {
    return this.#allocations;
  }

  /** Forget the frame's vertices, keeping the store. */
  reset(): void {
    this.#used = 0;
  }

  #ensure(vertices: number): void {
    const need = this.#used + vertices * FLOATS_PER_VERTEX;
    if (need <= this.#capacity) return;
    let cap = this.#capacity * 2;
    while (cap < need) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.#buffer);
    this.#buffer = next;
    this.#capacity = cap;
    this.#allocations += 1;
  }

  /** One vertex at logical (x, y), transformed, with texture coordinate (u, v) and colour. */
  #vertex(x: number, y: number, u: number, v: number, colour: Float32Array): void {
    const t = this.#transform;
    const b = this.#buffer;
    const o = this.#used;
    b[o] = t.x(x, y);
    b[o + 1] = t.y(x, y);
    b[o + 2] = u;
    b[o + 3] = v;
    b[o + 4] = colour[0]!;
    b[o + 5] = colour[1]!;
    b[o + 6] = colour[2]!;
    b[o + 7] = colour[3]!;
    this.#used = o + FLOATS_PER_VERTEX;
  }

  /** Two triangles for a quad given as four logical corners in order, with corner UVs. */
  quad(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    colour: Float32Array,
  ): void {
    this.#ensure(6);
    this.#vertex(x0, y0, u0, v0, colour);
    this.#vertex(x1, y1, u1, v0, colour);
    this.#vertex(x2, y2, u1, v1, colour);
    this.#vertex(x0, y0, u0, v0, colour);
    this.#vertex(x2, y2, u1, v1, colour);
    this.#vertex(x3, y3, u0, v1, colour);
  }

  /** An axis-aligned filled rectangle in logical units. Solid: UVs are zero. */
  rect(x: number, y: number, width: number, height: number, colour: Float32Array): void {
    this.quad(x, y, x + width, y, x + width, y + height, x, y + height, 0, 0, 0, 0, colour);
  }

  /**
   * A rectangle's outline, drawn as four rectangles centred on the edge the way a canvas
   * stroke is: half the line width falls inside the rectangle and half outside.
   */
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: Float32Array,
  ): void {
    const h = lineWidth / 2;
    this.rect(x - h, y - h, width + lineWidth, lineWidth, colour);
    this.rect(x - h, y + height - h, width + lineWidth, lineWidth, colour);
    this.rect(x - h, y + h, lineWidth, height - lineWidth, colour);
    this.rect(x + width - h, y + h, lineWidth, height - lineWidth, colour);
  }

  /** A filled disc as a fan of triangles about its centre. */
  circle(cx: number, cy: number, radius: number, colour: Float32Array): void {
    const segments = circleSegments(radius * this.#transform.scaleFactor);
    this.#ensure(segments * 3);
    const step = (Math.PI * 2) / segments;
    let px = cx + radius;
    let py = cy;
    for (let i = 1; i <= segments; i += 1) {
      const angle = i * step;
      const nx = cx + radius * Math.cos(angle);
      const ny = cy + radius * Math.sin(angle);
      this.#vertex(cx, cy, 0, 0, colour);
      this.#vertex(px, py, 0, 0, colour);
      this.#vertex(nx, ny, 0, 0, colour);
      px = nx;
      py = ny;
    }
  }

  /** A ring of width `lineWidth` centred on `radius`, as a canvas stroke is. */
  strokeCircle(
    cx: number,
    cy: number,
    radius: number,
    lineWidth: number,
    colour: Float32Array,
  ): void {
    const outer = radius + lineWidth / 2;
    const inner = Math.max(0, radius - lineWidth / 2);
    const segments = circleSegments(outer * this.#transform.scaleFactor);
    this.#ensure(segments * 6);
    const step = (Math.PI * 2) / segments;
    let cos = 1;
    let sin = 0;
    for (let i = 1; i <= segments; i += 1) {
      const angle = i * step;
      const ncos = Math.cos(angle);
      const nsin = Math.sin(angle);
      const ox0 = cx + outer * cos;
      const oy0 = cy + outer * sin;
      const ix0 = cx + inner * cos;
      const iy0 = cy + inner * sin;
      const ox1 = cx + outer * ncos;
      const oy1 = cy + outer * nsin;
      const ix1 = cx + inner * ncos;
      const iy1 = cy + inner * nsin;
      this.#vertex(ox0, oy0, 0, 0, colour);
      this.#vertex(ox1, oy1, 0, 0, colour);
      this.#vertex(ix1, iy1, 0, 0, colour);
      this.#vertex(ox0, oy0, 0, 0, colour);
      this.#vertex(ix1, iy1, 0, 0, colour);
      this.#vertex(ix0, iy0, 0, 0, colour);
      cos = ncos;
      sin = nsin;
    }
  }

  /** A line segment as a quad of `lineWidth` across it, with butt caps like a canvas stroke. */
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    lineWidth: number,
    colour: Float32Array,
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const nx = (-dy / len) * (lineWidth / 2);
    const ny = (dx / len) * (lineWidth / 2);
    this.quad(
      x1 + nx,
      y1 + ny,
      x2 + nx,
      y2 + ny,
      x2 - nx,
      y2 - ny,
      x1 - nx,
      y1 - ny,
      0,
      0,
      0,
      0,
      colour,
    );
  }
}
