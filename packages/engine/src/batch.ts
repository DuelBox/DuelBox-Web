/**
 * Sprite and line-batch primitives over a backend-neutral sink.
 *
 * The immediate-mode {@link Renderer} in `renderer.ts` is right for a HUD and a few
 * shapes. A field of hundreds of sprites or a mesh of trail lines wants batching:
 * accumulate the draw commands, group them by what the GPU (or canvas) can draw in
 * one call, and flush. Most games never need this — it exists for the particle-heavy
 * and trail-heavy ones (issue #16's "trails, particles").
 *
 * A {@link SpriteBatch} / {@link LineBatch} accumulates commands into pooled arrays
 * that grow only while warming up, so a steady frame of drawing allocates nothing
 * (an `allocations` counter proves it). `flush(sink)` walks the commands, coalescing
 * each run that shares a texture (or line style) so the sink issues one batch per run
 * rather than one call per command.
 *
 * The backend is the {@link SpriteSink} / {@link LineSink} the flush drives:
 * - {@link Canvas2DSpriteSink} draws each sprite with the canvas's own drawImage;
 * - {@link WebGLSpriteSink} packs a run's quads into a reused vertex buffer and
 *   issues a single draw per texture — the WebGL path, behind the sink choice.
 *
 * Nothing here selects a backend or reaches for a real GL context: the sinks take
 * structural interfaces a host wires up and a test fakes. **A WebGL sink is unused
 * until a game asks for it, so this closes as a tested primitive but "needs a
 * consuming game" to be exercised end to end.** All destination coordinates are
 * LOGICAL units; source rectangles are texture PIXELS, as a texture is measured in
 * texels.
 */

/** Destination coordinates are logical units; source coordinates are texture pixels. */
export interface SpriteSink {
  /** Begin a run of sprites that all share `textureId`. */
  beginTexture(textureId: number): void;
  /** One sprite: source rect in texture px, destination rect in logical units, plus rotation and alpha. */
  sprite(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    rotation: number,
    alpha: number,
  ): void;
  /** End the current texture run; a batching backend issues its draw call here. */
  endTexture(): void;
}

export class SpriteBatch {
  #tex: Int32Array;
  #sx: Float64Array;
  #sy: Float64Array;
  #sw: Float64Array;
  #sh: Float64Array;
  #dx: Float64Array;
  #dy: Float64Array;
  #dw: Float64Array;
  #dh: Float64Array;
  #rot: Float64Array;
  #alpha: Float64Array;

  #capacity: number;
  #count = 0;
  #allocations = 0;

  constructor(initialCapacity = 64) {
    if (!Number.isInteger(initialCapacity) || initialCapacity <= 0) {
      throw new RangeError('initialCapacity must be a positive integer');
    }
    this.#capacity = initialCapacity;
    this.#tex = new Int32Array(initialCapacity);
    this.#sx = new Float64Array(initialCapacity);
    this.#sy = new Float64Array(initialCapacity);
    this.#sw = new Float64Array(initialCapacity);
    this.#sh = new Float64Array(initialCapacity);
    this.#dx = new Float64Array(initialCapacity);
    this.#dy = new Float64Array(initialCapacity);
    this.#dw = new Float64Array(initialCapacity);
    this.#dh = new Float64Array(initialCapacity);
    this.#rot = new Float64Array(initialCapacity);
    this.#alpha = new Float64Array(initialCapacity);
  }

  get count(): number {
    return this.#count;
  }

  /** Structural growth events; flat once the batch has seen its peak size. */
  get allocations(): number {
    return this.#allocations;
  }

  /** Start a new frame's batch. Keeps every backing store. Allocation-free. */
  begin(): void {
    this.#count = 0;
  }

  /**
   * Queue a sprite. `rotation` is radians about the destination's top-left; `alpha`
   * is opacity in [0, 1]. Allocation-free once warm.
   */
  add(
    textureId: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    rotation = 0,
    alpha = 1,
  ): void {
    const i = this.#count;
    if (i === this.#capacity) this.#grow();
    this.#tex[i] = textureId;
    this.#sx[i] = sx;
    this.#sy[i] = sy;
    this.#sw[i] = sw;
    this.#sh[i] = sh;
    this.#dx[i] = dx;
    this.#dy[i] = dy;
    this.#dw[i] = dw;
    this.#dh[i] = dh;
    this.#rot[i] = rotation;
    this.#alpha[i] = alpha;
    this.#count = i + 1;
  }

  /**
   * Replay the queued sprites to `sink`, coalescing each consecutive run that shares
   * a texture into one begin/end pair. Returns the number of texture runs (draw
   * calls) issued — the batching win, measurable in a test. Allocation-free.
   */
  flush(sink: SpriteSink): number {
    const n = this.#count;
    if (n === 0) return 0;
    let runs = 0;
    let i = 0;
    while (i < n) {
      const tex = this.#tex[i]!;
      sink.beginTexture(tex);
      while (i < n && this.#tex[i] === tex) {
        sink.sprite(
          this.#sx[i]!,
          this.#sy[i]!,
          this.#sw[i]!,
          this.#sh[i]!,
          this.#dx[i]!,
          this.#dy[i]!,
          this.#dw[i]!,
          this.#dh[i]!,
          this.#rot[i]!,
          this.#alpha[i]!,
        );
        i += 1;
      }
      sink.endTexture();
      runs += 1;
    }
    return runs;
  }

  #grow(): void {
    const cap = this.#capacity * 2;
    this.#tex = growInt32(this.#tex, cap);
    this.#sx = growFloat64(this.#sx, cap);
    this.#sy = growFloat64(this.#sy, cap);
    this.#sw = growFloat64(this.#sw, cap);
    this.#sh = growFloat64(this.#sh, cap);
    this.#dx = growFloat64(this.#dx, cap);
    this.#dy = growFloat64(this.#dy, cap);
    this.#dw = growFloat64(this.#dw, cap);
    this.#dh = growFloat64(this.#dh, cap);
    this.#rot = growFloat64(this.#rot, cap);
    this.#alpha = growFloat64(this.#alpha, cap);
    this.#capacity = cap;
    this.#allocations += 1;
  }
}

/** A run of line segments sharing a stroke width and colour. */
export interface LineSink {
  beginStyle(widthLogical: number, colour: number): void;
  segment(x1: number, y1: number, x2: number, y2: number): void;
  endStyle(): void;
}

export class LineBatch {
  #x1: Float64Array;
  #y1: Float64Array;
  #x2: Float64Array;
  #y2: Float64Array;
  #width: Float64Array;
  #colour: Int32Array;

  #capacity: number;
  #count = 0;
  #allocations = 0;

  constructor(initialCapacity = 64) {
    if (!Number.isInteger(initialCapacity) || initialCapacity <= 0) {
      throw new RangeError('initialCapacity must be a positive integer');
    }
    this.#capacity = initialCapacity;
    this.#x1 = new Float64Array(initialCapacity);
    this.#y1 = new Float64Array(initialCapacity);
    this.#x2 = new Float64Array(initialCapacity);
    this.#y2 = new Float64Array(initialCapacity);
    this.#width = new Float64Array(initialCapacity);
    this.#colour = new Int32Array(initialCapacity);
  }

  get count(): number {
    return this.#count;
  }

  get allocations(): number {
    return this.#allocations;
  }

  begin(): void {
    this.#count = 0;
  }

  /** Queue a line. `colour` is an opaque numeric key the sink maps to a stroke style. */
  add(x1: number, y1: number, x2: number, y2: number, widthLogical: number, colour: number): void {
    const i = this.#count;
    if (i === this.#capacity) this.#grow();
    this.#x1[i] = x1;
    this.#y1[i] = y1;
    this.#x2[i] = x2;
    this.#y2[i] = y2;
    this.#width[i] = widthLogical;
    this.#colour[i] = colour;
    this.#count = i + 1;
  }

  /** Replay queued lines, coalescing consecutive runs of equal width+colour. Returns run count. */
  flush(sink: LineSink): number {
    const n = this.#count;
    if (n === 0) return 0;
    let runs = 0;
    let i = 0;
    while (i < n) {
      const w = this.#width[i]!;
      const c = this.#colour[i]!;
      sink.beginStyle(w, c);
      while (i < n && this.#width[i] === w && this.#colour[i] === c) {
        sink.segment(this.#x1[i]!, this.#y1[i]!, this.#x2[i]!, this.#y2[i]!);
        i += 1;
      }
      sink.endStyle();
      runs += 1;
    }
    return runs;
  }

  #grow(): void {
    const cap = this.#capacity * 2;
    this.#x1 = growFloat64(this.#x1, cap);
    this.#y1 = growFloat64(this.#y1, cap);
    this.#x2 = growFloat64(this.#x2, cap);
    this.#y2 = growFloat64(this.#y2, cap);
    this.#width = growFloat64(this.#width, cap);
    this.#colour = growInt32(this.#colour, cap);
    this.#capacity = cap;
    this.#allocations += 1;
  }
}

function growFloat64(src: Float64Array, cap: number): Float64Array {
  const next = new Float64Array(cap);
  next.set(src);
  return next;
}
function growInt32(src: Int32Array, cap: number): Int32Array {
  const next = new Int32Array(cap);
  next.set(src);
  return next;
}

// ---------------------------------------------------------------------------
// Canvas2D backend.
// ---------------------------------------------------------------------------

/** The slice of a 2D context a sprite sink needs. A real CanvasRenderingContext2D satisfies it. */
export interface DrawImageContext {
  globalAlpha: number;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

/** Resolves a numeric texture id to the drawable image the canvas draws. */
export type ImageResolver = (textureId: number) => unknown;

/** Draws a sprite batch onto a 2D canvas, one drawImage per sprite. */
export class Canvas2DSpriteSink implements SpriteSink {
  readonly #ctx: DrawImageContext;
  readonly #resolve: ImageResolver;
  #image: unknown = null;

  constructor(ctx: DrawImageContext, resolve: ImageResolver) {
    this.#ctx = ctx;
    this.#resolve = resolve;
  }

  beginTexture(textureId: number): void {
    this.#image = this.#resolve(textureId);
  }

  sprite(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    rotation: number,
    alpha: number,
  ): void {
    const ctx = this.#ctx;
    if (rotation === 0 && alpha === 1) {
      ctx.drawImage(this.#image, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(dx, dy);
    if (rotation !== 0) ctx.rotate(rotation);
    ctx.drawImage(this.#image, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  }

  endTexture(): void {
    // Canvas draws each sprite immediately; nothing to flush per texture.
  }
}

// ---------------------------------------------------------------------------
// WebGL backend (behind the sink choice; needs a consuming game to exercise).
// ---------------------------------------------------------------------------

/**
 * The slim slice of a GL device the WebGL sprite sink drives. A host adapts a real
 * WebGL2RenderingContext to it; a test records the calls. Kept minimal on purpose:
 * bind a texture, hand up a vertex buffer, draw it.
 */
export interface WebGLLike {
  readonly TRIANGLES: number;
  bindTexture(textureId: number): void;
  /** Upload `usedFloats` floats from `data` as the current vertex buffer. */
  bufferData(data: Float32Array, usedFloats: number): void;
  drawArrays(mode: number, first: number, count: number): void;
}

/** Floats per vertex: x, y, u, v. */
const FLOATS_PER_VERTEX = 4;
/** Six vertices (two triangles) per sprite quad. */
const VERTS_PER_SPRITE = 6;

/**
 * Packs each texture run's quads into one reused vertex buffer and issues a single
 * drawArrays per texture — the batching the WebGL path exists for. The vertex buffer
 * grows only to the largest run seen, then stays; a steady frame allocates nothing.
 */
export class WebGLSpriteSink implements SpriteSink {
  readonly #gl: WebGLLike;
  #buffer: Float32Array;
  #capacityFloats: number;
  #used = 0;
  #allocations = 0;

  constructor(gl: WebGLLike, initialSprites = 64) {
    if (!Number.isInteger(initialSprites) || initialSprites <= 0) {
      throw new RangeError('initialSprites must be a positive integer');
    }
    this.#gl = gl;
    this.#capacityFloats = initialSprites * VERTS_PER_SPRITE * FLOATS_PER_VERTEX;
    this.#buffer = new Float32Array(this.#capacityFloats);
  }

  get allocations(): number {
    return this.#allocations;
  }

  beginTexture(textureId: number): void {
    this.#gl.bindTexture(textureId);
    this.#used = 0;
  }

  sprite(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    rotation: number,
    alpha: number,
  ): void {
    // Opacity is a blend/uniform concern in this path, not a per-vertex attribute.
    void alpha;
    // Two triangles for the quad. Rotation is applied to the four corners about (dx,dy).
    const cos = rotation === 0 ? 1 : Math.cos(rotation);
    const sin = rotation === 0 ? 0 : Math.sin(rotation);
    // Corner destination positions (local corner then rotate then translate).
    const x0 = dx;
    const y0 = dy;
    const x1 = dx + dw * cos;
    const y1 = dy + dw * sin;
    const x2 = dx + dw * cos - dh * sin;
    const y2 = dy + dw * sin + dh * cos;
    const x3 = dx - dh * sin;
    const y3 = dy + dh * cos;
    // UVs from the source rect.
    const u0 = sx;
    const v0 = sy;
    const u1 = sx + sw;
    const v1 = sy + sh;

    if (this.#used + VERTS_PER_SPRITE * FLOATS_PER_VERTEX > this.#capacityFloats) this.#grow();
    const b = this.#buffer;
    let o = this.#used;
    // Triangle 1: corner 0, 1, 2.
    o = write(b, o, x0, y0, u0, v0);
    o = write(b, o, x1, y1, u1, v0);
    o = write(b, o, x2, y2, u1, v1);
    // Triangle 2: corner 0, 2, 3.
    o = write(b, o, x0, y0, u0, v0);
    o = write(b, o, x2, y2, u1, v1);
    o = write(b, o, x3, y3, u0, v1);
    this.#used = o;
  }

  endTexture(): void {
    if (this.#used === 0) return;
    this.#gl.bufferData(this.#buffer, this.#used);
    this.#gl.drawArrays(this.#gl.TRIANGLES, 0, this.#used / FLOATS_PER_VERTEX);
    this.#used = 0;
  }

  #grow(): void {
    const cap = this.#capacityFloats * 2;
    const next = new Float32Array(cap);
    next.set(this.#buffer);
    this.#buffer = next;
    this.#capacityFloats = cap;
    this.#allocations += 1;
  }
}

function write(
  buffer: Float32Array,
  offset: number,
  x: number,
  y: number,
  u: number,
  v: number,
): number {
  buffer[offset] = x;
  buffer[offset + 1] = y;
  buffer[offset + 2] = u;
  buffer[offset + 3] = v;
  return offset + FLOATS_PER_VERTEX;
}
