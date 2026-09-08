/**
 * The affine transform the WebGL renderer applies on the CPU (#16).
 *
 * A 2D context carries its own matrix stack and `save()`/`restore()` it for free. WebGL
 * has none: a rotation for the far seat or a shake offset has to be applied to every
 * vertex before it is written, or be a uniform that forces a draw call per transform
 * change. Applying it on the CPU keeps one vertex buffer for the whole frame — a seat
 * rotation in the middle of a frame does not split the batch — and the cost is six
 * multiplies per vertex, which is nothing next to the draw calls it saves.
 *
 * The stack is a preallocated `Float64Array` of six-element matrices in the browser's own
 * `[a, b, c, d, e, f]` order, so `push()` and `pop()` allocate nothing and a leaked push
 * is a depth counter the renderer reports, exactly as `Canvas2DRenderer` does. Depth is
 * bounded: a frame never opens more than a rotation, a shake and the viewport itself.
 */

/** How many nested pushes a frame may hold. Three are used; the rest is a floor under a leak. */
export const MAX_TRANSFORM_DEPTH = 16;

export class TransformStack {
  readonly #matrices = new Float64Array((MAX_TRANSFORM_DEPTH + 1) * 6);
  #depth = 0;

  constructor() {
    this.reset();
  }

  /** How many pushes are outstanding. */
  get depth(): number {
    return this.#depth;
  }

  /** Back to the identity with nothing pushed, at the start of every frame. */
  reset(): void {
    this.#depth = 0;
    this.#set(0, 1, 0, 0, 1, 0, 0);
  }

  #set(level: number, a: number, b: number, c: number, d: number, e: number, f: number): void {
    const m = this.#matrices;
    const o = level * 6;
    m[o] = a;
    m[o + 1] = b;
    m[o + 2] = c;
    m[o + 3] = d;
    m[o + 4] = e;
    m[o + 5] = f;
  }

  /**
   * Copy the current matrix up one level, so the next `pop()` returns to exactly this.
   *
   * @throws Error past {@link MAX_TRANSFORM_DEPTH}, which is a leak, not a use.
   */
  push(): void {
    if (this.#depth >= MAX_TRANSFORM_DEPTH) {
      throw new Error(
        `transform stack deeper than ${String(MAX_TRANSFORM_DEPTH)}: a push has leaked`,
      );
    }
    const m = this.#matrices;
    const from = this.#depth * 6;
    const to = from + 6;
    for (let i = 0; i < 6; i += 1) m[to + i] = m[from + i]!;
    this.#depth += 1;
  }

  /** @throws Error with nothing pushed. */
  pop(): void {
    if (this.#depth === 0) throw new Error('transform pop without a matching push');
    this.#depth -= 1;
  }

  /** Post-multiply the current matrix by a translation, as `ctx.translate` does. */
  translate(x: number, y: number): void {
    const m = this.#matrices;
    const o = this.#depth * 6;
    m[o + 4] = m[o]! * x + m[o + 2]! * y + m[o + 4]!;
    m[o + 5] = m[o + 1]! * x + m[o + 3]! * y + m[o + 5]!;
  }

  /** Post-multiply by a uniform scale, as `ctx.scale(s, s)` does. */
  scale(sx: number, sy: number): void {
    const m = this.#matrices;
    const o = this.#depth * 6;
    m[o] = m[o]! * sx;
    m[o + 1] = m[o + 1]! * sx;
    m[o + 2] = m[o + 2]! * sy;
    m[o + 3] = m[o + 3]! * sy;
  }

  /** Post-multiply by a rotation about the origin, as `ctx.rotate` does. */
  rotate(radians: number): void {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const m = this.#matrices;
    const o = this.#depth * 6;
    const a = m[o]!;
    const b = m[o + 1]!;
    const c = m[o + 2]!;
    const d = m[o + 3]!;
    m[o] = a * cos + c * sin;
    m[o + 1] = b * cos + d * sin;
    m[o + 2] = c * cos - a * sin;
    m[o + 3] = d * cos - b * sin;
  }

  /** The transformed x of a point under the current matrix. */
  x(px: number, py: number): number {
    const m = this.#matrices;
    const o = this.#depth * 6;
    return m[o]! * px + m[o + 2]! * py + m[o + 4]!;
  }

  /** The transformed y of a point under the current matrix. */
  y(px: number, py: number): number {
    const m = this.#matrices;
    const o = this.#depth * 6;
    return m[o + 1]! * px + m[o + 3]! * py + m[o + 5]!;
  }

  /** The current uniform scale, for choosing how many segments a circle needs on screen. */
  get scaleFactor(): number {
    const m = this.#matrices;
    const o = this.#depth * 6;
    return Math.hypot(m[o]!, m[o + 1]!);
  }
}
