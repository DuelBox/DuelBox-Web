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
  /**
   * Displace everything drawn until the matching {@link Renderer.popShake} by an offset in
   * logical units — screen shake, and nothing else (#114). Under reduced motion the
   * displacement is dropped and the calls still balance, exactly as
   * {@link Renderer.pushRotation} still saves and restores when it snaps a board to rest.
   *
   * Reach it through `applyShake`/`releaseShake` in `juice.ts` rather than calling it here:
   * this pair is optional, and those two are where the optionality is dealt with once.
   */
  pushShake?(offsetX: number, offsetY: number): void;
  popShake?(): void;
  /**
   * Whether the player has asked their system for reduced motion, as of this frame.
   *
   * The live answer, not a snapshot. `GameContext.reducedMotion` is read once when a game is
   * handed its context and can never be corrected, so a player who turns the preference on
   * halfway through a match is not heard until the next one; the host updates this one
   * through `setReducedMotion` whenever the media query changes. It is also the safer of the
   * two by construction: a renderer only exists inside `render()`, so a preference read from
   * here is unreachable from `update()` and cannot get into the simulation.
   *
   * Optional for the reason `GameContext.reducedMotion` is optional: this interface is
   * implemented by hand in more than fifty games' test doubles, and a required member is a
   * breaking change to all of them at once. Absent means full motion, which is what a device
   * with no preference set reports. It satisfies `MotionPreference`, so it can be handed
   * straight to `Tween.valueFor`, `Flash.levelFor` and `HitStop.holdingFor`.
   */
  readonly reducedMotion?: boolean;
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

/**
 * How many times a drawing surface may be taken away and rebuilt before
 * {@link Canvas2DRenderer} stops trying to get it back.
 *
 * Losing a canvas once is an ordinary event on a phone with several tabs open — the
 * browser reclaims the backing store, hands it back a moment later, and the honest
 * response is to rebuild and carry on. A surface that goes twice inside one match is not
 * an incident but a device that cannot hold this canvas, and the third rebuild would be
 * taken away too. So the renderer stops after the second and says so, and the host puts
 * something a player can read where the board was.
 *
 * Two is the number #101 names. It is a policy rather than a measurement, and nothing in
 * this repository has measured how often a second loss follows a first; what can be said
 * is that the cost of being wrong is asymmetric. Give up too early and a player who would
 * have got their match back reads a message instead. Never give up and they watch a
 * rectangle that keeps dying, which is the failure this whole path exists to avoid.
 */
export const MAX_SURFACE_LOSSES = 2;

/**
 * The one thing {@link Canvas2DRenderer.watchSurface} needs of the event it is handed.
 *
 * `preventDefault` is not politeness here, it is the entire mechanism: a `contextlost`
 * the page does not cancel tells the browser that nobody intends to redraw, and
 * `contextrestored` is then never fired at all. Declared structurally, like
 * {@link Canvas2DLike}, so a test can fire a plain object and assert the cancellation
 * with no DOM anywhere in sight.
 */
export interface SurfaceEvent {
  preventDefault(): void;
}

/**
 * The slice of a canvas element {@link Canvas2DRenderer.watchSurface} subscribes to.
 *
 * `type` is a bare string rather than the two literals this actually listens for. A real
 * HTMLCanvasElement has to satisfy this by structure alone, and its own `addEventListener`
 * is a stack of overloads keyed on an event map; narrowing here buys a little safety
 * inside one method and costs a cast at the only call site that matters.
 */
export interface SurfaceEventTarget {
  addEventListener(type: string, listener: (event: SurfaceEvent) => void): void;
  removeEventListener(type: string, listener: (event: SurfaceEvent) => void): void;
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
  /**
   * Outstanding pushShake calls, counted apart from the rotations.
   *
   * One counter would unwind a leaked frame just as correctly — both pairs are a save and a
   * restore, and the context stack does not care which of them opened a level. Two exist for
   * the diagnostics: a shake left open used to be reported as an unbalanced
   * `pushSeatRotation`, which sends the author to the seat-flip code, and that code is
   * balanced. The counter is cheap; the wrong noun costs somebody an afternoon.
   */
  #shakeDepth = 0;
  #reducedMotion = false;
  /**
   * Whether non-essential effects run this frame (#190, #31).
   *
   * Two switches, one answer. `#reducedMotion` is the player's preference; this is the
   * device's situation — a battery running low, or an adaptive-quality rung with effects
   * off — and either alone puts the renderer on its quiet path. Kept apart so a device that
   * recovers does not take the player's preference with it, and read together through
   * {@link Canvas2DRenderer.quiet} so there is one place the two are combined.
   */
  #effectsEnabled = true;
  #inFrame = false;
  /**
   * Whether the surface this renderer draws into is unusable as of now (#101).
   *
   * Kept apart from the count below because the two answer different questions: this one
   * is "is there anywhere to draw this frame", which flips back the moment the browser
   * hands the canvas over again, and the count is "has this device shown it cannot keep
   * one", which never unwinds.
   */
  #surfaceLost = false;
  /** Losses so far, counted against {@link MAX_SURFACE_LOSSES}. */
  #surfaceLosses = 0;

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

  /**
   * Outstanding pushSeatRotation calls, and nothing else. Diagnostic; zero everywhere a
   * frame is balanced.
   *
   * A shake is not counted here even though it opens the same kind of level, because a
   * debug overlay reading this is asking which seat the world is turned for.
   */
  get seatRotationDepth(): number {
    return this.#rotationDepth;
  }

  /** Outstanding pushShake calls. The other half of {@link seatRotationDepth}. */
  get shakeDepth(): number {
    return this.#shakeDepth;
  }

  /**
   * The live answer to "draw the cheap version of this", for the juice primitives that are
   * levels rather than transforms.
   *
   * True for the player's reduced-motion preference *or* for a device that has asked for
   * effects off — a low battery (#190) or an adaptive-quality rung with `effectsEnabled`
   * false (#31). Both reach the games through this one member because this is the member
   * every flash, hit-stop and shake already reads: a preference switch that fifty games
   * honour is a switch a low battery can throw without any of them being edited.
   */
  get reducedMotion(): boolean {
    return this.quiet;
  }

  /** Whether non-essential effects are currently allowed by the device, as distinct from the player. */
  get effectsEnabled(): boolean {
    return this.#effectsEnabled;
  }

  /** The player's preference or the device's situation, whichever is asking for less. */
  private get quiet(): boolean {
    return this.#reducedMotion || !this.#effectsEnabled;
  }

  /**
   * Whether the surface is unusable right now: nothing drawn this frame would be seen.
   *
   * A host reads this rather than keeping a copy of its own, so that "is there anywhere to
   * draw" has exactly one answer and a match cannot be stepping against the other one. It
   * returns a boolean field untouched, so a loop may consult it on every step without
   * allocating (rule 5).
   */
  get surfaceLost(): boolean {
    return this.#surfaceLost;
  }

  /**
   * Whether the renderer has given up on this surface for good ({@link MAX_SURFACE_LOSSES}).
   *
   * Once this is true a `contextrestored` is still heard and deliberately not acted on. By
   * then the host has been told to put something readable where the board was, and a board
   * flickering back underneath that message — for however long this device manages it —
   * would be worse than the message, because it invites the player back into a match that
   * is about to vanish again.
   */
  get surfaceAbandoned(): boolean {
    return this.#surfaceLosses >= MAX_SURFACE_LOSSES;
  }

  /**
   * Follow the drawing surface's lifetime on `target` — the canvas element whose context
   * this renderer was built from (#101).
   *
   * The issue that asked for this said WebGL, and there is none: this repository renders
   * every game through this class and the only `getContext` calls in it ask for `'2d'`.
   * The hazard is not WebGL's, though. A 2D context is lost the same way and fires the
   * same pair of events under the names `contextlost` and `contextrestored`: a phone under
   * memory pressure takes the backing store away, and from that moment every call made
   * against the context is silently ignored. Unhandled, the player is left looking at the
   * blank rectangle the issue is about, with a match still stepping behind it.
   *
   * The renderer does only the bookkeeping half and the host owns the rest. `onLost` is
   * told whether this was the loss that used up {@link MAX_SURFACE_LOSSES}: `false` means
   * stop stepping and expect to come back, `true` means the board is not coming back and
   * something honest has to take its place. `onRestored` fires only when there is a live
   * surface again, and it is where the host re-applies what belongs to the *context*
   * rather than to this renderer — the device-pixel-ratio transform above all, which a
   * restore resets to the identity and which a host that caches its last measured size
   * will otherwise never set again, so the picture comes back at 1/dpr in a corner.
   *
   * Nothing else this renderer holds needs re-establishing, and that is worth stating
   * because the obvious guess is wrong twice. The font cache is a map of strings, and
   * `text()` writes `ctx.font` on every call regardless, so it was never context state.
   * The viewport's scale and letterbox offset are re-applied by `beginFrame` on every
   * frame rather than held on the context, so the first frame after a restore sets them
   * itself. What actually went with the surface is the context's save stack, and that is
   * the one thing cleared below.
   *
   * @returns a function that unsubscribes both listeners; call it when the host tears down.
   */
  watchSurface(
    target: SurfaceEventTarget,
    onLost: (abandoned: boolean) => void,
    onRestored: () => void,
  ): () => void {
    const lost = (event: SurfaceEvent): void => {
      // Cancelling the event is what asks for the surface back. Skip this and it is the
      // last of the two events that will ever arrive, and the fallback below becomes the
      // only outcome this code can reach.
      event.preventDefault();
      this.#surfaceLosses += 1;
      this.#surfaceLost = true;
      // The context's save stack went with the surface, so these depths now describe
      // saves that no longer exist and `#inFrame` describes a `beginFrame` whose save() is
      // gone. Cleared rather than unwound: calling restore() against a stack that is not
      // there is exactly the corruption endFrame's repair loop exists to prevent, one
      // level further down.
      this.#inFrame = false;
      this.#rotationDepth = 0;
      this.#shakeDepth = 0;
      onLost(this.surfaceAbandoned);
    };
    const restored = (): void => {
      if (this.surfaceAbandoned) return;
      this.#surfaceLost = false;
      onRestored();
    };
    target.addEventListener('contextlost', lost);
    target.addEventListener('contextrestored', restored);
    return () => {
      target.removeEventListener('contextlost', lost);
      target.removeEventListener('contextrestored', restored);
    };
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
   * While the surface is lost the frame is opened in this renderer's books and nowhere
   * else, so a host that draws anyway paints into a context that ignores it rather than
   * leaving a save() behind. That is a floor under a mistake, not the mechanism: a host
   * reads {@link surfaceLost} and does not render at all.
   *
   * @throws Error if a frame is already open.
   */
  beginFrame(): void {
    if (this.#inFrame) {
      throw new Error('beginFrame called while a frame is already open; call endFrame first');
    }
    this.#inFrame = true;
    if (this.#surfaceLost) return;
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
   * A seat rotation or a shake the game left open is unwound first: a leaked save() would
   * corrupt every later frame rather than only this one, so the stack is repaired and then
   * the bug is reported.
   *
   * The report names the pair that is actually unbalanced. It used to say
   * `pushSeatRotation` whichever had leaked, because both counted on one depth, and a
   * leaked shake is easy to write in exactly the shape `juice.ts` recommends — read
   * `HitStop` at the top of `render()` and return, having already applied the shake. The
   * author was then sent to the seat-flip code, which was balanced.
   *
   * While the surface is lost this closes quietly and reports nothing, including when no
   * frame is open. Both of those are deliberate. A frame that was open when the surface
   * went had its counters cleared underneath it, so a game that balanced its pushes
   * perfectly would still arrive here looking like a leak; and the missing-frame check is
   * a guard on a caller's bookkeeping, which stops being meaningful when the surface it
   * was keeping books about is gone. Neither concession outlives the loss: the moment
   * `contextrestored` clears it, both checks are back.
   *
   * @throws Error if no frame is open, or if either pair was left unbalanced.
   */
  endFrame(): void {
    if (this.#surfaceLost) {
      this.#inFrame = false;
      this.#rotationDepth = 0;
      this.#shakeDepth = 0;
      return;
    }
    if (!this.#inFrame) {
      throw new Error('endFrame called without a matching beginFrame');
    }
    const ctx = this.#context;
    const rotations = this.#rotationDepth;
    const shakes = this.#shakeDepth;
    for (let i = 0; i < rotations + shakes; i += 1) {
      ctx.restore();
    }
    this.#rotationDepth = 0;
    this.#shakeDepth = 0;
    ctx.restore();
    this.#inFrame = false;
    if (rotations !== 0 || shakes !== 0) {
      // Built from whichever leaked, so the message never names a method the game did not
      // call. Both, when both did.
      const unbalanced: string[] = [];
      if (rotations !== 0) unbalanced.push(`${rotations} unbalanced pushSeatRotation call(s)`);
      if (shakes !== 0) unbalanced.push(`${shakes} unbalanced pushShake call(s)`);
      throw new Error(`endFrame with ${unbalanced.join(' and ')}`);
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

  /**
   * Switch non-essential effects on or off from the device's side (#190, #31).
   *
   * Set by the host from the battery reading and the adaptive-quality level, never from a
   * game. It takes exactly the path reduced motion takes — the flash reads as steady, the
   * hit-stop as nothing, the shake and the board's mid-turn sweep as their resting frames —
   * because that path is already the one every game honours and already proven to change
   * nothing the simulation reads. It does not touch the player's own preference: a device
   * back on charge sees its effects return, and a player who asked for reduced motion keeps it.
   */
  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
  }

  pushRotation(radians: number): void {
    if (!Number.isFinite(radians)) {
      throw new RangeError(
        `rotation must be a finite number of radians, received ${String(radians)}`,
      );
    }
    // Snap to the nearest half turn: the board arrives the instant the turn changes
    // rather than sweeping there, and never rests at an angle nobody can read.
    const angle = this.quiet ? Math.round(radians / HALF_TURN) * HALF_TURN : radians;
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

  /**
   * Shift the world for a screen shake, in logical units.
   *
   * Under reduced motion the offset is dropped and the world is drawn where it belongs. The
   * switch is here rather than on `Shake` for the reason `flip.ts` gives at length: this is
   * the one place that hears the preference change mid-match, so a board and a shake stop
   * moving at the same instant instead of one of them waiting for the next match.
   *
   * The frame is clipped to the logical box, so a shake moves the play area within its
   * letterbox rather than spilling out over it — which matters beyond tidiness, because the
   * letterbox is where rule 9's "neither player sees more of the play area than the other"
   * is enforced. Call it after `clear()` so the background stays put and the world moves
   * against it.
   *
   * @throws RangeError if either offset is not a finite number.
   */
  pushShake(offsetX: number, offsetY: number): void {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      throw new RangeError(
        `shake offset must be finite logical units, received ${String(offsetX)}, ${String(offsetY)}`,
      );
    }
    const ctx = this.#context;
    // Saved whether or not anything moves, so the pair balances on every device and the
    // caller never branches on the preference.
    ctx.save();
    this.#shakeDepth += 1;
    if (this.quiet) return;
    if (offsetX === 0 && offsetY === 0) return;
    ctx.translate(offsetX, offsetY);
  }

  /**
   * Undo the most recent {@link Canvas2DRenderer.pushShake}.
   *
   * The same context stack the rotations use — both are a save and a restore — but its own
   * depth, so that a leak is reported against the pair that leaked. It used to delegate
   * here, which meant a `releaseShake` with no `applyShake` was answered by a sentence
   * naming two methods the game had never called.
   *
   * @throws Error if there is no matching push; the context stack is left untouched.
   */
  popShake(): void {
    if (this.#shakeDepth === 0) {
      throw new Error('popShake called without a matching pushShake');
    }
    this.#shakeDepth -= 1;
    this.#context.restore();
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
