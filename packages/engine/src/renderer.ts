import type { LogicalSize } from './seat.js';
import type { Viewport } from './viewport.js';

/**
 * The drawing surface every game sees.
 *
 * Games draw through {@link Renderer} and never touch a canvas context, so a WebGL
 * backend can be added later without editing a single game.
 *
 * Every coordinate, radius, line width and text size crossing this interface is in
 * LOGICAL units — the same units the simulation uses — never device pixels. The
 * renderer owns the conversion: it holds the fitted {@link Viewport} and applies the
 * scale and letterbox offset itself, so the identical draw calls produce the identical
 * picture on a 320px phone and a 4K desktop.
 */

const TAU = Math.PI * 2;

/** A seat sitting opposite reads the device upside down: exactly half a turn. */
const HALF_TURN = Math.PI;

/**
 * One family for the whole engine. Games choose a size, never a face, so that text
 * metrics stay predictable and the font string cache only has to key on size.
 */
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** British spelling at the API edge; the canvas spelling never leaks into a game. */
export type TextAlign = 'left' | 'centre' | 'right';

export interface Renderer {
  /** Fill the whole logical play area, discarding whatever the last frame drew. */
  clear(colour: string): void;
  rect(x: number, y: number, width: number, height: number, colour: string): void;
  /** `lineWidth` is logical too, so outlines thicken with the viewport rather than hairline out. */
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void;
  circle(x: number, y: number, radius: number, colour: string): void;
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void;
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void;
  /**
   * `sizePx` is a logical size despite the name — it is scaled by the viewport like
   * every other measurement here. `y` is the vertical centre of the line, not its
   * baseline, so a HUD number sits where the game put it whatever glyphs it contains.
   */
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void;
  /**
   * Draw the next shapes for a seat that may be reading the device upside down.
   * `rotated === true` turns the world half a turn about the centre of the logical
   * area so that seat reads its own half upright. Always pair with
   * {@link Renderer.popSeatRotation}, including when `rotated` is false.
   */
  pushSeatRotation(rotated: boolean): void;
  /**
   * Turn the world by an arbitrary angle about the centre of the logical area.
   *
   * The continuous form of {@link Renderer.pushSeatRotation}, for the part-way
   * orientations a seat flip passes through. Pair with
   * {@link Renderer.popSeatRotation} exactly as with the boolean form.
   */
  pushRotation(radians: number): void;
  popSeatRotation(): void;
}

/**
 * The narrow slice of CanvasRenderingContext2D that {@link Canvas2DRenderer} uses.
 *
 * Declared structurally rather than imported so tests can pass a recording fake with
 * no DOM at all. The property types are the browser's own unions (a real context
 * accepts a gradient or a pattern for a style) so that a genuine
 * CanvasRenderingContext2D satisfies this interface without a cast.
 */
export interface Canvas2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;

  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, width: number, height: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  /** Only `width` is used, so a fake need not model the rest of TextMetrics. */
  measureText(text: string): { readonly width: number };
  clearRect(x: number, y: number, width: number, height: number): void;
  /** Confines drawing to the current path. Used once a frame, to the logical box. */
  clip(): void;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${String(value)}`);
  }
}

/** Canvas spells the centred alignment the American way; the engine's API does not. */
function canvasAlign(align: TextAlign): CanvasTextAlign {
  if (align === 'centre') return 'center';
  if (align === 'right') return 'right';
  return 'left';
}

/**
 * {@link Renderer} backed by a 2D canvas context.
 *
 * The viewport transform is applied once per frame rather than once per draw call, so
 * a frame is one save/restore pair however many shapes it contains. The transform
 * composes with whatever is already on the context, which is what lets the host apply
 * the device-pixel-ratio scale once at canvas-resize time and never think about it again.
 *
 * No method allocates. The only string built at all is a font declaration, and those
 * are cached per size.
 */
export class Canvas2DRenderer implements Renderer {
  readonly #context: Canvas2DLike;
  readonly #logicalWidth: number;
  readonly #logicalHeight: number;
  readonly #centreX: number;
  readonly #centreY: number;
  /**
   * Font declarations by size. `${size}px ${family}` would allocate a fresh string on
   * every text() call and the HUD draws text many times a frame, so each distinct size
   * is built once and reused. Games use a small fixed set of sizes; an animated size
   * would defeat the cache and allocate per distinct value.
   */
  readonly #fonts = new Map<number, string>();

  #scale = 1;
  #offsetX = 0;
  #offsetY = 0;
  #rotationDepth = 0;
  #reducedMotion = false;
  #inFrame = false;

  /**
   * `logical` is the play area the game simulates in, and stays authoritative for the
   * centre that {@link Canvas2DRenderer.pushSeatRotation} turns about.
   *
   * @throws RangeError if either logical dimension is not a positive finite number.
   */
  constructor(context: Canvas2DLike, logical: LogicalSize) {
    assertPositiveFinite(logical.width, 'logical.width');
    assertPositiveFinite(logical.height, 'logical.height');
    this.#context = context;
    this.#logicalWidth = logical.width;
    this.#logicalHeight = logical.height;
    this.#centreX = logical.width / 2;
    this.#centreY = logical.height / 2;
  }

  /** Outstanding pushSeatRotation calls. Diagnostic; zero everywhere a frame is balanced. */
  get seatRotationDepth(): number {
    return this.#rotationDepth;
  }

  /**
   * Adopt a fitted viewport. Called on resize and orientation change, not per draw.
   *
   * A collapsed viewport (scale 0, during a rotation or a keyboard opening) is applied
   * as-is rather than rejected: the frame simply draws nothing visible.
   *
   * @throws RangeError if `view` was fitted to a different logical box than this
   * renderer draws — the two would disagree about where the centre of rotation is, and
   * the far seat would be drawn about the wrong point.
   */
  setViewport(view: Viewport): void {
    if (view.logicalWidth !== this.#logicalWidth || view.logicalHeight !== this.#logicalHeight) {
      throw new RangeError(
        `viewport was fitted to ${view.logicalWidth}x${view.logicalHeight}, ` +
          `but this renderer draws ${this.#logicalWidth}x${this.#logicalHeight}`,
      );
    }
    this.#scale = view.scale;
    this.#offsetX = view.offsetX;
    this.#offsetY = view.offsetY;
  }

  /**
   * Open a frame: save the context state and apply the letterbox offset and scale, so
   * every draw call between here and endFrame() is in logical units.
   *
   * @throws Error if a frame is already open.
   */
  beginFrame(): void {
    if (this.#inFrame) {
      throw new Error('beginFrame called while a frame is already open; call endFrame first');
    }
    this.#inFrame = true;
    const ctx = this.#context;
    ctx.save();
    ctx.translate(this.#offsetX, this.#offsetY);
    ctx.scale(this.#scale, this.#scale);
    // Confined to the logical box for the whole frame.
    //
    // Without this the letterbox bars are fair game, and a game that draws outside its
    // declared box paints over them. It is not only untidy: rule 9 says neither player may
    // ever see more of the play area than the other, and the letterbox *is* where that
    // boundary lives — so anything spilling past it is showing one player more of the
    // world. A board turning through the seat flip does exactly that, because a square
    // rotating about its centre sweeps its corners out by a factor of root two.
    ctx.beginPath();
    ctx.rect(0, 0, this.#logicalWidth, this.#logicalHeight);
    ctx.clip();
  }

  /**
   * Close the frame, restoring the context to exactly the state beginFrame() found.
   *
   * A seat rotation the game left open is unwound first: a leaked save() would corrupt
   * every later frame rather than only this one, so the stack is repaired and then the
   * bug is reported.
   *
   * @throws Error if no frame is open, or if seat rotations were left unbalanced.
   */
  endFrame(): void {
    if (!this.#inFrame) {
      throw new Error('endFrame called without a matching beginFrame');
    }
    const ctx = this.#context;
    const leaked = this.#rotationDepth;
    for (let i = 0; i < leaked; i += 1) {
      ctx.restore();
    }
    this.#rotationDepth = 0;
    ctx.restore();
    this.#inFrame = false;
    if (leaked !== 0) {
      throw new Error(`endFrame with ${leaked} unbalanced pushSeatRotation call(s)`);
    }
  }

  clear(colour: string): void {
    const ctx = this.#context;
    // Cleared before filling so a translucent colour composites onto an empty surface
    // rather than onto the previous frame, which would smear over time.
    ctx.clearRect(0, 0, this.#logicalWidth, this.#logicalHeight);
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, this.#logicalWidth, this.#logicalHeight);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    const ctx = this.#context;
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, width, height);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    const ctx = this.#context;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colour;
    ctx.stroke();
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    const ctx = this.#context;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    const ctx = this.#context;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.closePath();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colour;
    ctx.stroke();
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    const ctx = this.#context;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = colour;
    ctx.stroke();
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align: TextAlign = 'left',
  ): void {
    const ctx = this.#context;
    ctx.font = this.#fontFor(sizePx);
    ctx.textAlign = canvasAlign(align);
    // Set every call rather than once per frame: the host shares the context with its
    // own chrome, so nothing here may assume state survives between draws.
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colour;
    ctx.fillText(value, x, y);
  }

  /**
   * Width of `value` in logical units at `sizePx`, for laying out a HUD.
   *
   * Deliberately not part of {@link Renderer}: measuring is a layout-time question, and
   * the browser allocates a TextMetrics per call, so this must not run inside a frame.
   */
  measureText(value: string, sizePx: number): number {
    const ctx = this.#context;
    ctx.font = this.#fontFor(sizePx);
    return ctx.measureText(value).width;
  }

  pushSeatRotation(rotated: boolean): void {
    this.pushRotation(rotated ? HALF_TURN : 0);
  }

  /**
   * Draw part-way rotations as their settled orientation.
   *
   * Set from `prefers-reduced-motion` by the host. It lives here rather than in a game
   * because no game code may branch on the device (CLAUDE.md rule 10) — and because the
   * flip must still *step* identically everywhere, or two devices would disagree about
   * when input reopens. Reduced motion changes what is drawn, never what is simulated.
   */
  setReducedMotion(reduced: boolean): void {
    this.#reducedMotion = reduced;
  }

  pushRotation(radians: number): void {
    if (!Number.isFinite(radians)) {
      throw new RangeError(
        `rotation must be a finite number of radians, received ${String(radians)}`,
      );
    }
    // Snap to the nearest half turn: the board arrives the instant the turn changes
    // rather than sweeping there, and never rests at an angle nobody can read.
    const angle = this.#reducedMotion ? Math.round(radians / HALF_TURN) * HALF_TURN : radians;
    const ctx = this.#context;
    // Saved whether or not there is any rotation, so pushes and pops balance for both
    // seats and the caller never has to branch on which one it is drawing.
    ctx.save();
    this.#rotationDepth += 1;
    if (angle === 0) return;
    ctx.translate(this.#centreX, this.#centreY);
    ctx.rotate(angle);
    // Tucked in while it turns, so the corners stay inside the box.
    //
    // A rectangle rotated off-axis needs `|cos| + |sin|` times its own extent — root two
    // at forty-five degrees — and the frame is clipped to the logical box, so without this
    // the corners of a turning board are simply cut off and the pieces standing in them
    // vanish for a few frames. The factor is 1 at every resting angle, so a settled board
    // is never scaled: it only breathes in through the turn and back out at the end.
    const fit = 1 / (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
    // Skipped entirely at a resting angle, where the factor is 1 to within rounding: a
    // settled board must produce the same calls it always did.
    if (fit < 1 - 1e-9) ctx.scale(fit, fit);
    ctx.translate(-this.#centreX, -this.#centreY);
  }

  /** @throws Error if there is no matching push; the context stack is left untouched. */
  popSeatRotation(): void {
    if (this.#rotationDepth === 0) {
      throw new Error('popSeatRotation called without a matching pushSeatRotation');
    }
    this.#rotationDepth -= 1;
    this.#context.restore();
  }

  #fontFor(sizePx: number): string {
    const cached = this.#fonts.get(sizePx);
    if (cached !== undefined) return cached;
    const font = `${sizePx}px ${FONT_FAMILY}`;
    this.#fonts.set(sizePx, font);
    return font;
  }
}
