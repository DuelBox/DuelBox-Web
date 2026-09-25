import { MAX_SURFACE_LOSSES } from './renderer.js';
import type { HostRenderer, SurfaceEvent, SurfaceEventTarget, TextAlign } from './renderer.js';
import { FONT_FAMILY } from './renderer.js';
import type { LogicalSize } from './seat.js';
import type { Viewport } from './viewport.js';
import { ColourCache, type ColourNormaliser } from './webgl-colour.js';
import { BYTES_PER_FLOAT, FLOATS_PER_VERTEX, VertexWriter } from './webgl-geometry.js';
import { GlyphAtlas, type TextRasteriser } from './webgl-text.js';
import { TransformStack } from './webgl-transform.js';

/**
 * {@link HostRenderer} backed by WebGL, behind a build flag and off by default (#16).
 *
 * ## What it is for, and what it is not
 *
 * Every game in the catalogue draws through `Renderer` with a few dozen shapes a frame, and
 * `Canvas2DRenderer` draws that faster than a player can tell (ADR 0003). This backend is
 * for the game that needs thousands of bodies or a full-screen effect — the trails and
 * particles #16 names — and no such game exists yet. So it ships behind
 * `NEXT_PUBLIC_RENDERER=webgl`, is reached only through `import()` when that is set, and
 * with the flag off **nothing in this file is in the bundle**: `scripts/check-renderer-flag.mjs`
 * reads the export and fails if {@link WEBGL_RENDERER_MARKER} is found in a chunk. The
 * claim in `docs/support-matrix.md` that no WebGL is required stays true.
 *
 * ## The shape of a frame
 *
 * The 2D backend hands each shape to the browser as it is called. This one turns each shape
 * into triangles in one interleaved vertex buffer — position, texture coordinate, colour,
 * eight floats a vertex — and uploads once per run of same-mode geometry: every solid shape
 * in a row is one draw call, every string in a row is another. Transforms (the viewport,
 * a seat rotation, a shake) are applied on the CPU as vertices are written, which is what
 * lets one buffer hold a frame that turns the board half way through.
 *
 * Nothing on the draw path allocates once warm (rule 5). The vertex buffer and the colour
 * cache grow to a game's peak and stay; the transform stack is fixed. What does allocate is
 * a *new* string on the text path — its atlas key, once — and the page upload when one
 * appears, and both are counted so a test can see them stop.
 *
 * ## The same contract, the same errors
 *
 * Every rule `Canvas2DRenderer` holds is held here in the same words: logical units in,
 * the frame clipped to the logical box (`gl.scissor`, since rule 9 lives on the letterbox),
 * `'centre'` spelled the engine's way, rotations snapped to rest under reduced motion,
 * pushes and pops balanced or reported by the pair that leaked, and the surface followed
 * through `webglcontextlost`/`webglcontextrestored` — which for WebGL is not a hazard by
 * analogy, as #101 found it was for a 2D context, but the API's own documented behaviour.
 */

/**
 * A string that survives minification and identifies this module in a built chunk. It is
 * the whole of the build guard's evidence: absent from every chunk when the flag is off,
 * present in exactly one when it is on.
 */
export const WEBGL_RENDERER_MARKER = 'duelbox-webgl-renderer';

/** How big the glyph page is, in device pixels on a side. */
export const GLYPH_PAGE_SIZE = 1024;

const HALF_TURN = Math.PI;

/** Vertex shader: device pixels in, clip space out, y flipped so the top is up as on a canvas. */
const VERTEX_SHADER = `
attribute vec2 aPosition;
attribute vec2 aUv;
attribute vec4 aColour;
uniform vec2 uResolution;
varying vec2 vUv;
varying vec4 vColour;
void main() {
  vec2 clip = (aPosition / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = aUv;
  vColour = aColour;
}
`;

/**
 * Fragment shader. Solid geometry is the vertex colour; text is the vertex colour with the
 * glyph page's alpha, which is what tints white glyphs. Output is premultiplied, to match the
 * blend function below and the compositor's expectation of a WebGL canvas.
 */
const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uPage;
uniform float uTextured;
varying vec2 vUv;
varying vec4 vColour;
void main() {
  float alpha = vColour.a;
  if (uTextured > 0.5) {
    alpha *= texture2D(uPage, vUv).a;
  }
  gl_FragColor = vec4(vColour.rgb * alpha, alpha);
}
`;

/**
 * The slice of a WebGL context this renderer drives, declared structurally so a test can
 * hand in a recording fake with no GPU and no DOM, the way `Canvas2DLike` lets
 * `renderer.test.ts` run without a canvas. A real `WebGLRenderingContext` satisfies it as it
 * stands. Method syntax throughout, so the real context's overloads are assignable.
 */
export interface WebGLContextLike {
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;

  readonly TRIANGLES: number;
  readonly FLOAT: number;
  readonly ARRAY_BUFFER: number;
  readonly DYNAMIC_DRAW: number;
  readonly VERTEX_SHADER: number;
  readonly FRAGMENT_SHADER: number;
  readonly COMPILE_STATUS: number;
  readonly LINK_STATUS: number;
  readonly TEXTURE_2D: number;
  readonly TEXTURE0: number;
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  readonly TEXTURE_MIN_FILTER: number;
  readonly TEXTURE_MAG_FILTER: number;
  readonly TEXTURE_WRAP_S: number;
  readonly TEXTURE_WRAP_T: number;
  readonly LINEAR: number;
  readonly CLAMP_TO_EDGE: number;
  readonly BLEND: number;
  readonly SCISSOR_TEST: number;
  readonly ONE: number;
  readonly ONE_MINUS_SRC_ALPHA: number;
  readonly COLOR_BUFFER_BIT: number;

  createShader(type: number): WebGLShader | null;
  shaderSource(shader: WebGLShader, source: string): void;
  compileShader(shader: WebGLShader): void;
  getShaderParameter(shader: WebGLShader, name: number): unknown;
  getShaderInfoLog(shader: WebGLShader): string | null;
  createProgram(): WebGLProgram | null;
  attachShader(program: WebGLProgram, shader: WebGLShader): void;
  linkProgram(program: WebGLProgram): void;
  getProgramParameter(program: WebGLProgram, name: number): unknown;
  getProgramInfoLog(program: WebGLProgram): string | null;
  useProgram(program: WebGLProgram | null): void;
  getAttribLocation(program: WebGLProgram, name: string): number;
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void;
  createBuffer(): WebGLBuffer | null;
  bindBuffer(target: number, buffer: WebGLBuffer | null): void;
  bufferData(target: number, data: ArrayBufferView, usage: number): void;
  createTexture(): WebGLTexture | null;
  bindTexture(target: number, texture: WebGLTexture | null): void;
  activeTexture(unit: number): void;
  texImage2D(
    target: number,
    level: number,
    internalformat: number,
    format: number,
    type: number,
    source: TexImageSource,
  ): void;
  texParameteri(target: number, name: number, value: number): void;
  uniform1i(location: WebGLUniformLocation | null, value: number): void;
  uniform1f(location: WebGLUniformLocation | null, value: number): void;
  uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void;
  enable(capability: number): void;
  disable(capability: number): void;
  blendFunc(source: number, destination: number): void;
  scissor(x: number, y: number, width: number, height: number): void;
  viewport(x: number, y: number, width: number, height: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
  drawArrays(mode: number, first: number, count: number): void;
}

/** The page the glyph rasteriser draws onto, as the texture upload takes it. */
export interface GlyphPage extends TextRasteriser {
  /** The canvas (or offscreen canvas) holding the page's pixels, for `texImage2D`. */
  readonly page: TexImageSource;
}

/** What the renderer needs from the host beyond the context: text, and a colour fallback. */
export interface WebGLRendererOptions {
  /** A 2D context on an offscreen canvas of {@link GLYPH_PAGE_SIZE} square. */
  readonly text: GlyphPage;
  /** The browser's own reading of a colour string this renderer cannot parse. */
  readonly normaliseColour?: ColourNormaliser;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${String(value)}`);
  }
}

/** What the program and its locations resolve to once compiled; rebuilt after a restore. */
interface CompiledProgram {
  readonly program: WebGLProgram;
  readonly buffer: WebGLBuffer;
  readonly page: WebGLTexture;
  readonly resolution: WebGLUniformLocation | null;
  readonly textured: WebGLUniformLocation | null;
}

const MODE_SOLID = 0;
const MODE_TEXT = 1;

export class WebGLRenderer implements HostRenderer {
  readonly #gl: WebGLContextLike;
  readonly #logicalWidth: number;
  readonly #logicalHeight: number;
  readonly #centreX: number;
  readonly #centreY: number;
  readonly #transform = new TransformStack();
  readonly #vertices: VertexWriter;
  readonly #colours: ColourCache;
  readonly #atlas: GlyphAtlas;
  readonly #text: GlyphPage;

  #compiled: CompiledProgram | null = null;
  #uploadedGeneration = -1;
  #mode = MODE_SOLID;
  #drawCalls = 0;
  #lastFrameDrawCalls = 0;

  #scale = 1;
  #offsetX = 0;
  #offsetY = 0;
  #dpr = 1;
  #rotationDepth = 0;
  #shakeDepth = 0;
  #reducedMotion = false;
  /** The device's effects switch (#190, #31); folded into `quiet` beside the player's preference. */
  #effectsEnabled = true;
  #inFrame = false;
  #surfaceLost = false;
  #surfaceLosses = 0;

  /**
   * @throws RangeError if either logical dimension is not a positive finite number.
   * @throws Error if the shaders do not compile, naming the log — the one thing that
   *   cannot be tested without a GPU and so is reported in full when it happens.
   */
  constructor(gl: WebGLContextLike, logical: LogicalSize, options: WebGLRendererOptions) {
    assertPositiveFinite(logical.width, 'logical.width');
    assertPositiveFinite(logical.height, 'logical.height');
    this.#gl = gl;
    this.#logicalWidth = logical.width;
    this.#logicalHeight = logical.height;
    this.#centreX = logical.width / 2;
    this.#centreY = logical.height / 2;
    this.#vertices = new VertexWriter(this.#transform);
    this.#colours = new ColourCache(options.normaliseColour ?? null);
    this.#text = options.text;
    this.#atlas = new GlyphAtlas(options.text, GLYPH_PAGE_SIZE, FONT_FAMILY);
    this.#compiled = this.#compile();
  }

  get seatRotationDepth(): number {
    return this.#rotationDepth;
  }

  get shakeDepth(): number {
    return this.#shakeDepth;
  }

  get reducedMotion(): boolean {
    return this.#reducedMotion || !this.#effectsEnabled;
  }

  get surfaceLost(): boolean {
    return this.#surfaceLost;
  }

  get surfaceAbandoned(): boolean {
    return this.#surfaceLosses >= MAX_SURFACE_LOSSES;
  }

  /** Draw calls the last complete frame issued — the batching, measurable in a test. */
  get drawCalls(): number {
    return this.#lastFrameDrawCalls;
  }

  /** Growths of the vertex store so far; flat once a game has drawn its busiest frame. */
  get allocations(): number {
    return this.#vertices.allocations;
  }

  /** Distinct colour strings parsed so far. */
  get coloursCached(): number {
    return this.#colours.size;
  }

  /** How many times the glyph page has been wiped and started again. */
  get glyphPageResets(): number {
    return this.#atlas.resets;
  }

  /**
   * The device-pixel ratio the backing store was sized with. The 2D host applies this to
   * its context with `setTransform` and the renderer never learns it; this backend has no
   * context transform to carry it, so it takes the number and folds it into the frame's
   * own transform. Called from the host's resize, beside where it sizes the canvas.
   */
  setDevicePixelRatio(dpr: number): void {
    assertPositiveFinite(dpr, 'dpr');
    this.#dpr = dpr;
  }

  /** @throws RangeError if `view` was fitted to a different logical box than this draws. */
  setViewport(view: Viewport): void {
    if (view.logicalWidth !== this.#logicalWidth || view.logicalHeight !== this.#logicalHeight) {
      throw new RangeError(
        `viewport was fitted to ${String(view.logicalWidth)}x${String(view.logicalHeight)}, ` +
          `but this renderer draws ${String(this.#logicalWidth)}x${String(this.#logicalHeight)}`,
      );
    }
    this.#scale = view.scale;
    this.#offsetX = view.offsetX;
    this.#offsetY = view.offsetY;
  }

  setReducedMotion(reduced: boolean): void {
    this.#reducedMotion = reduced;
  }

  /** See `HostRenderer.setEffectsEnabled`; the same path as reduced motion, from the device. */
  setEffectsEnabled(enabled: boolean): void {
    this.#effectsEnabled = enabled;
  }

  /**
   * Follow the drawing surface's lifetime on `target` (#101).
   *
   * The WebGL pair of events, `webglcontextlost` and `webglcontextrestored`, with the same
   * bookkeeping as the 2D backend's: cancel the loss so the browser offers the context back,
   * count it against {@link MAX_SURFACE_LOSSES}, forget the frame that was open. What differs
   * is what a restore has to rebuild — every GL object went with the context — and that is
   * done here rather than by the host, because the program, the buffer and the glyph texture
   * are this renderer's to know about. The host still owns the device-pixel ratio and calls
   * `setDevicePixelRatio` again from its own restore handler, as it re-applies its transform
   * for the 2D backend.
   */
  watchSurface(
    target: SurfaceEventTarget,
    onLost: (abandoned: boolean) => void,
    onRestored: () => void,
  ): () => void {
    const lost = (event: SurfaceEvent): void => {
      event.preventDefault();
      this.#surfaceLosses += 1;
      this.#surfaceLost = true;
      this.#inFrame = false;
      this.#rotationDepth = 0;
      this.#shakeDepth = 0;
      this.#transform.reset();
      this.#vertices.reset();
      this.#compiled = null;
      onLost(this.surfaceAbandoned);
    };
    const restored = (): void => {
      if (this.surfaceAbandoned) return;
      this.#compiled = this.#compile();
      this.#uploadedGeneration = -1;
      this.#surfaceLost = false;
      onRestored();
    };
    target.addEventListener('webglcontextlost', lost);
    target.addEventListener('webglcontextrestored', restored);
    return () => {
      target.removeEventListener('webglcontextlost', lost);
      target.removeEventListener('webglcontextrestored', restored);
    };
  }

  /** @throws Error if a frame is already open. */
  beginFrame(): void {
    if (this.#inFrame) {
      throw new Error('beginFrame called while a frame is already open; call endFrame first');
    }
    this.#inFrame = true;
    this.#drawCalls = 0;
    if (this.#surfaceLost) return;
    const gl = this.#gl;
    const dpr = this.#dpr;
    // The same composition the 2D host and backend arrive at between them: the device
    // ratio, then the letterbox offset, then the viewport scale.
    this.#transform.reset();
    this.#transform.scale(dpr, dpr);
    this.#transform.translate(this.#offsetX, this.#offsetY);
    this.#transform.scale(this.#scale, this.#scale);
    this.#vertices.reset();
    this.#mode = MODE_SOLID;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    // Confined to the logical box for the whole frame, as the 2D backend clips: rule 9
    // lives on the letterbox, and a board turning through the seat flip sweeps its corners
    // out by root two. GL's origin is the bottom-left, so the rectangle is flipped.
    const boxWidth = Math.round(this.#logicalWidth * this.#scale * dpr);
    const boxHeight = Math.round(this.#logicalHeight * this.#scale * dpr);
    const boxX = Math.round(this.#offsetX * dpr);
    const boxTop = Math.round(this.#offsetY * dpr);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(boxX, gl.drawingBufferHeight - boxTop - boxHeight, boxWidth, boxHeight);
  }

  /** @throws Error if no frame is open, or if either push/pop pair was left unbalanced. */
  endFrame(): void {
    if (this.#surfaceLost) {
      this.#inFrame = false;
      this.#rotationDepth = 0;
      this.#shakeDepth = 0;
      this.#transform.reset();
      return;
    }
    if (!this.#inFrame) {
      throw new Error('endFrame called without a matching beginFrame');
    }
    this.#flush();
    const rotations = this.#rotationDepth;
    const shakes = this.#shakeDepth;
    this.#rotationDepth = 0;
    this.#shakeDepth = 0;
    this.#transform.reset();
    this.#inFrame = false;
    this.#lastFrameDrawCalls = this.#drawCalls;
    if (rotations !== 0 || shakes !== 0) {
      const unbalanced: string[] = [];
      if (rotations !== 0)
        unbalanced.push(`${String(rotations)} unbalanced pushSeatRotation call(s)`);
      if (shakes !== 0) unbalanced.push(`${String(shakes)} unbalanced pushShake call(s)`);
      throw new Error(`endFrame with ${unbalanced.join(' and ')}`);
    }
  }

  clear(colour: string): void {
    // Whatever was queued before the clear is drawn before it, so the order a game called
    // things in is the order the screen shows them — the 2D backend gets this for free.
    this.#flush();
    const gl = this.#gl;
    const rgba = this.#colours.get(colour);
    // The scissor set in beginFrame confines this to the logical box, which is exactly the
    // 2D backend's clearRect-then-fillRect of that box. Premultiplied, like the shader.
    gl.clearColor(rgba[0]! * rgba[3]!, rgba[1]! * rgba[3]!, rgba[2]! * rgba[3]!, rgba[3]!);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#solid();
    this.#vertices.rect(x, y, width, height, this.#colours.get(colour));
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#solid();
    this.#vertices.strokeRect(x, y, width, height, lineWidth, this.#colours.get(colour));
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#solid();
    this.#vertices.circle(x, y, radius, this.#colours.get(colour));
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#solid();
    this.#vertices.strokeCircle(x, y, radius, lineWidth, this.#colours.get(colour));
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#solid();
    this.#vertices.line(x1, y1, x2, y2, lineWidth, this.#colours.get(colour));
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align: TextAlign = 'left',
  ): void {
    if (value.length === 0) return;
    if (this.#mode !== MODE_TEXT) {
      this.#flush();
      this.#mode = MODE_TEXT;
    }
    // Rasterised at the size it will be shown at, in device pixels, so the glyphs are drawn
    // by the browser at their final size rather than scaled up from a smaller raster.
    const devicePerLogical = this.#transform.scaleFactor;
    const deviceSize = Math.max(1, Math.round(sizePx * devicePerLogical));
    const entry = this.#atlas.entry(value, deviceSize);
    const page = this.#atlas.pageSize;
    // Back into logical units, so the quad is written through the same transform as
    // everything else and turns with the board.
    const widthLogical = entry.width / devicePerLogical;
    const heightLogical = entry.height / devicePerLogical;
    const left =
      align === 'centre' ? x - widthLogical / 2 : align === 'right' ? x - widthLogical : x;
    const top = y - heightLogical / 2;
    this.#vertices.quad(
      left,
      top,
      left + widthLogical,
      top,
      left + widthLogical,
      top + heightLogical,
      left,
      top + heightLogical,
      entry.x / page,
      entry.y / page,
      (entry.x + entry.width) / page,
      (entry.y + entry.height) / page,
      this.#colours.get(colour),
    );
  }

  /**
   * Width of `value` in logical units at `sizePx`, for laying out a HUD. Off the
   * {@link Renderer} interface for the reason the 2D backend gives: it is a layout-time
   * question, and the browser allocates per measurement.
   */
  measureText(value: string, sizePx: number): number {
    return this.#text.measure(value, sizePx, FONT_FAMILY);
  }

  pushSeatRotation(rotated: boolean): void {
    this.pushRotation(rotated ? HALF_TURN : 0);
  }

  pushRotation(radians: number): void {
    if (!Number.isFinite(radians)) {
      throw new RangeError(
        `rotation must be a finite number of radians, received ${String(radians)}`,
      );
    }
    const angle =
      this.#reducedMotion || !this.#effectsEnabled
        ? Math.round(radians / HALF_TURN) * HALF_TURN
        : radians;
    const t = this.#transform;
    t.push();
    this.#rotationDepth += 1;
    if (angle === 0) return;
    t.translate(this.#centreX, this.#centreY);
    t.rotate(angle);
    const fit = 1 / (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
    if (fit < 1 - 1e-9) t.scale(fit, fit);
    t.translate(-this.#centreX, -this.#centreY);
  }

  popSeatRotation(): void {
    if (this.#rotationDepth === 0) {
      throw new Error('popSeatRotation called without a matching pushSeatRotation');
    }
    this.#rotationDepth -= 1;
    this.#transform.pop();
  }

  pushShake(offsetX: number, offsetY: number): void {
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      throw new RangeError(
        `shake offset must be finite logical units, received ${String(offsetX)}, ${String(offsetY)}`,
      );
    }
    this.#transform.push();
    this.#shakeDepth += 1;
    if (this.#reducedMotion || !this.#effectsEnabled) return;
    if (offsetX === 0 && offsetY === 0) return;
    this.#transform.translate(offsetX, offsetY);
  }

  popShake(): void {
    if (this.#shakeDepth === 0) {
      throw new Error('popShake called without a matching pushShake');
    }
    this.#shakeDepth -= 1;
    this.#transform.pop();
  }

  /** Switch to solid geometry, flushing queued text first so draw order is preserved. */
  #solid(): void {
    if (this.#mode === MODE_SOLID) return;
    this.#flush();
    this.#mode = MODE_SOLID;
  }

  /** Upload what is queued and draw it in one call, in the current mode. */
  #flush(): void {
    const count = this.#vertices.vertexCount;
    if (count === 0) return;
    const compiled = this.#compiled;
    if (compiled === null) {
      this.#vertices.reset();
      return;
    }
    const gl = this.#gl;
    if (this.#mode === MODE_TEXT && this.#uploadedGeneration !== this.#atlas.generation) {
      gl.bindTexture(gl.TEXTURE_2D, compiled.page);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.#text.page);
      this.#uploadedGeneration = this.#atlas.generation;
    }
    gl.uniform1f(compiled.textured, this.#mode === MODE_TEXT ? 1 : 0);
    gl.uniform2f(compiled.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindBuffer(gl.ARRAY_BUFFER, compiled.buffer);
    // The typed array is handed over whole and the GPU reads `floatsUsed` of it; slicing
    // to the used length would allocate a view per flush.
    gl.bufferData(gl.ARRAY_BUFFER, this.#vertices.buffer, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    this.#drawCalls += 1;
    this.#vertices.reset();
  }

  /**
   * Compile the program and create the buffer and glyph texture. Once at construction and
   * again after a restore, because every GL object is gone with the context.
   *
   * @throws Error naming the shader log if compilation fails.
   */
  #compile(): CompiledProgram {
    const gl = this.#gl;
    const vertex = this.#shader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = this.#shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (program === null) throw new Error(`${WEBGL_RENDERER_MARKER}: could not create a program`);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      throw new Error(
        `${WEBGL_RENDERER_MARKER}: program did not link: ${gl.getProgramInfoLog(program) ?? ''}`,
      );
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    if (buffer === null) throw new Error(`${WEBGL_RENDERER_MARKER}: could not create a buffer`);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = FLOATS_PER_VERTEX * BYTES_PER_FLOAT;
    const position = gl.getAttribLocation(program, 'aPosition');
    const uv = gl.getAttribLocation(program, 'aUv');
    const colour = gl.getAttribLocation(program, 'aColour');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 2 * BYTES_PER_FLOAT);
    gl.enableVertexAttribArray(colour);
    gl.vertexAttribPointer(colour, 4, gl.FLOAT, false, stride, 4 * BYTES_PER_FLOAT);

    const page = gl.createTexture();
    if (page === null) throw new Error(`${WEBGL_RENDERER_MARKER}: could not create a texture`);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, page);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'uPage'), 0);

    // Premultiplied alpha in and out, which is what the shader writes and what a WebGL
    // canvas composites with by default.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    return {
      program,
      buffer,
      page,
      resolution: gl.getUniformLocation(program, 'uResolution'),
      textured: gl.getUniformLocation(program, 'uTextured'),
    };
  }

  #shader(type: number, source: string): WebGLShader {
    const gl = this.#gl;
    const shader = gl.createShader(type);
    if (shader === null) throw new Error(`${WEBGL_RENDERER_MARKER}: could not create a shader`);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      throw new Error(
        `${WEBGL_RENDERER_MARKER}: shader did not compile: ${gl.getShaderInfoLog(shader) ?? ''}`,
      );
    }
    return shader;
  }
}
