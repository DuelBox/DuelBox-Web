import { describe, expect, it } from 'vitest';
import { MAX_SURFACE_LOSSES } from './renderer.js';
import type { SurfaceEvent, SurfaceEventTarget } from './renderer.js';
import type { Viewport } from './viewport.js';
import type { LogicalSize } from './seat.js';
import { FLOATS_PER_VERTEX } from './webgl-geometry.js';
import { WEBGL_RENDERER_MARKER, WebGLRenderer } from './webgl-renderer.js';
import type { GlyphPage, WebGLContextLike } from './webgl-renderer.js';

/**
 * The WebGL backend against a recording fake of the context (#16), the way
 * `renderer.test.ts` drives the 2D backend against a recording `Canvas2DLike`. No GPU, no
 * DOM: what is observable from here is every call the renderer makes, the vertex buffer it
 * uploads, and the bookkeeping the 2D backend is held to — balanced pushes, a viewport
 * fitted to the right box, a surface that can be lost twice. What is *not* observable is
 * the picture, which is `e2e/renderer-parity.spec.ts`'s job.
 */

const LOGICAL: LogicalSize = { width: 800, height: 600 };

/** 800x600 fitted into 2000x1200: scale 2, letterboxed 200 either side. */
const VIEW: Viewport = {
  scale: 2,
  offsetX: 200,
  offsetY: 0,
  width: 1600,
  height: 1200,
  logicalWidth: 800,
  logicalHeight: 600,
};

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

class FakeGl implements WebGLContextLike {
  readonly calls: Call[] = [];
  /** A copy of the last uploaded vertex buffer, `floatsUsed` of it, per drawArrays. */
  readonly uploads: Float32Array[] = [];
  drawingBufferWidth = 2000;
  drawingBufferHeight = 1200;
  compiles = true;

  readonly TRIANGLES = 4;
  readonly FLOAT = 5126;
  readonly ARRAY_BUFFER = 34962;
  readonly DYNAMIC_DRAW = 35048;
  readonly VERTEX_SHADER = 35633;
  readonly FRAGMENT_SHADER = 35632;
  readonly COMPILE_STATUS = 35713;
  readonly LINK_STATUS = 35714;
  readonly TEXTURE_2D = 3553;
  readonly TEXTURE0 = 33984;
  readonly RGBA = 6408;
  readonly UNSIGNED_BYTE = 5121;
  readonly TEXTURE_MIN_FILTER = 10241;
  readonly TEXTURE_MAG_FILTER = 10240;
  readonly TEXTURE_WRAP_S = 10242;
  readonly TEXTURE_WRAP_T = 10243;
  readonly LINEAR = 9729;
  readonly CLAMP_TO_EDGE = 33071;
  readonly BLEND = 3042;
  readonly SCISSOR_TEST = 3089;
  readonly ONE = 1;
  readonly ONE_MINUS_SRC_ALPHA = 771;
  readonly COLOR_BUFFER_BIT = 16384;

  #pending: Float32Array | null = null;

  #log(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }
  ops(op: string): Call[] {
    return this.calls.filter((c) => c.op === op);
  }

  createShader(type: number): WebGLShader | null {
    this.#log('createShader', type);
    return { type };
  }
  shaderSource(): void {
    this.#log('shaderSource');
  }
  compileShader(): void {
    this.#log('compileShader');
  }
  getShaderParameter(): unknown {
    return this.compiles;
  }
  getShaderInfoLog(): string {
    return 'fake shader log';
  }
  createProgram(): WebGLProgram | null {
    this.#log('createProgram');
    return {};
  }
  attachShader(): void {
    this.#log('attachShader');
  }
  linkProgram(): void {
    this.#log('linkProgram');
  }
  getProgramParameter(): unknown {
    return true;
  }
  getProgramInfoLog(): string {
    return '';
  }
  useProgram(): void {
    this.#log('useProgram');
  }
  getAttribLocation(_program: WebGLProgram, name: string): number {
    return name === 'aPosition' ? 0 : name === 'aUv' ? 1 : 2;
  }
  getUniformLocation(_program: WebGLProgram, name: string): WebGLUniformLocation | null {
    return { name };
  }
  enableVertexAttribArray(index: number): void {
    this.#log('enableVertexAttribArray', index);
  }
  vertexAttribPointer(...args: unknown[]): void {
    this.#log('vertexAttribPointer', ...args);
  }
  createBuffer(): WebGLBuffer | null {
    this.#log('createBuffer');
    return {};
  }
  bindBuffer(): void {
    this.#log('bindBuffer');
  }
  bufferData(_target: number, data: ArrayBufferView): void {
    this.#log('bufferData', data.byteLength);
    this.#pending = new Float32Array(
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength / 4,
    );
  }
  createTexture(): WebGLTexture | null {
    this.#log('createTexture');
    return {};
  }
  bindTexture(): void {
    this.#log('bindTexture');
  }
  activeTexture(): void {
    this.#log('activeTexture');
  }
  texImage2D(): void {
    this.#log('texImage2D');
  }
  texParameteri(): void {
    this.#log('texParameteri');
  }
  uniform1i(): void {
    this.#log('uniform1i');
  }
  uniform1f(location: WebGLUniformLocation | null, value: number): void {
    this.#log('uniform1f', (location as unknown as { name: string }).name, value);
  }
  uniform2f(location: WebGLUniformLocation | null, x: number, y: number): void {
    this.#log('uniform2f', (location as unknown as { name: string }).name, x, y);
  }
  enable(cap: number): void {
    this.#log('enable', cap);
  }
  disable(cap: number): void {
    this.#log('disable', cap);
  }
  blendFunc(s: number, d: number): void {
    this.#log('blendFunc', s, d);
  }
  scissor(x: number, y: number, w: number, h: number): void {
    this.#log('scissor', x, y, w, h);
  }
  viewport(x: number, y: number, w: number, h: number): void {
    this.#log('viewport', x, y, w, h);
  }
  clearColor(r: number, g: number, b: number, a: number): void {
    this.#log('clearColor', r, g, b, a);
  }
  clear(mask: number): void {
    this.#log('clear', mask);
  }
  drawArrays(mode: number, first: number, count: number): void {
    this.#log('drawArrays', mode, first, count);
    const pending = this.#pending;
    if (pending !== null) this.uploads.push(pending.slice(0, count * FLOATS_PER_VERTEX));
  }
}

function fakePage(): GlyphPage & { drawn: string[]; cleared: number } {
  const page = {
    page: {} as TexImageSource,
    drawn: [] as string[],
    cleared: 0,
    measure: (value: string, size: number) => value.length * size * 0.6,
    draw(value: string) {
      page.drawn.push(value);
    },
    clear() {
      page.cleared += 1;
    },
  };
  return page;
}

function make(gl = new FakeGl()) {
  const text = fakePage();
  const renderer = new WebGLRenderer(gl, LOGICAL, { text });
  renderer.setViewport(VIEW);
  renderer.setDevicePixelRatio(1);
  return { gl, text, renderer };
}

/** The (x, y) of vertex `i` of the last upload. */
function vertex(gl: FakeGl, upload: number, i: number): [number, number] {
  const u = gl.uploads[upload]!;
  return [u[i * FLOATS_PER_VERTEX]!, u[i * FLOATS_PER_VERTEX + 1]!];
}

describe('construction', () => {
  it('compiles one program, one buffer and one glyph texture, and enables blending', () => {
    const { gl } = make();
    expect(gl.ops('createProgram')).toHaveLength(1);
    expect(gl.ops('createBuffer')).toHaveLength(1);
    expect(gl.ops('createTexture')).toHaveLength(1);
    expect(gl.ops('blendFunc')[0]?.args).toEqual([gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
    expect(gl.ops('enable').map((c) => c.args[0])).toContain(gl.BLEND);
  });

  it('names the marker in a shader failure, so the build guard and the error agree', () => {
    const gl = new FakeGl();
    gl.compiles = false;
    expect(() => new WebGLRenderer(gl, LOGICAL, { text: fakePage() })).toThrow(
      WEBGL_RENDERER_MARKER,
    );
  });

  it('refuses a non-positive logical box and a viewport fitted to another box', () => {
    expect(
      () => new WebGLRenderer(new FakeGl(), { width: 0, height: 1 }, { text: fakePage() }),
    ).toThrow(RangeError);
    const { renderer } = make();
    expect(() => {
      renderer.setViewport({ ...VIEW, logicalWidth: 801 });
    }).toThrow(RangeError);
    expect(() => {
      renderer.setDevicePixelRatio(0);
    }).toThrow(RangeError);
  });
});

describe('a frame', () => {
  it('clips to the logical box with a scissor in device pixels, flipped for GL', () => {
    const { gl, renderer } = make();
    renderer.setDevicePixelRatio(1);
    renderer.beginFrame();
    // 800x600 at scale 2 is 1600x1200 at x=200; GL's y runs up, and the box fills the height.
    expect(gl.ops('scissor')[0]?.args).toEqual([200, 0, 1600, 1200]);
    expect(gl.ops('viewport')[0]?.args).toEqual([0, 0, 2000, 1200]);
    renderer.endFrame();
  });

  it('folds the device-pixel ratio into the transform, as the host folds it into a 2D context', () => {
    const gl = new FakeGl();
    gl.drawingBufferWidth = 4000;
    gl.drawingBufferHeight = 2400;
    const { renderer } = make(gl);
    renderer.setDevicePixelRatio(2);
    renderer.beginFrame();
    expect(gl.ops('scissor')[0]?.args).toEqual([400, 0, 3200, 2400]);
    renderer.rect(0, 0, 10, 10, '#ff0000');
    renderer.endFrame();
    // Logical (0,0) is at CSS (200,0), which is device (400,0) at 2x; the 10-unit rect is
    // 10 * 2 (scale) * 2 (dpr) = 40 device pixels across.
    expect(vertex(gl, 0, 0)).toEqual([400, 0]);
    expect(vertex(gl, 0, 2)).toEqual([440, 40]);
  });

  it('draws every solid shape in one call and text in another, in the order called', () => {
    const { gl, renderer } = make();
    renderer.beginFrame();
    renderer.clear('#000000');
    renderer.rect(0, 0, 10, 10, '#ff0000');
    renderer.circle(50, 50, 5, '#00ff00');
    renderer.line(0, 0, 10, 10, 2, '#0000ff');
    renderer.text('12', 100, 100, 20, '#ffffff', 'centre');
    renderer.rect(20, 20, 10, 10, '#ff0000');
    renderer.endFrame();
    expect(renderer.drawCalls).toBe(3);
    const textured = gl
      .ops('uniform1f')
      .filter((c) => c.args[0] === 'uTextured')
      .map((c) => c.args[1]);
    expect(textured).toEqual([0, 1, 0]);
    // The clear is flushed before it clears, so it happens first in GL order too.
    const order = gl.calls.map((c) => c.op).filter((op) => op === 'clear' || op === 'drawArrays');
    expect(order).toEqual(['clear', 'drawArrays', 'drawArrays', 'drawArrays']);
  });

  it('clears the box with the colour premultiplied, under the scissor', () => {
    const { gl, renderer } = make();
    renderer.beginFrame();
    renderer.clear('rgba(255, 0, 0, 0.5)');
    renderer.endFrame();
    const [r, g, b, a] = gl.ops('clearColor')[0]!.args as number[];
    expect(r).toBeCloseTo(0.5);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBeCloseTo(0.5);
    expect(gl.ops('clear')).toHaveLength(1);
  });

  it('allocates nothing once warm: the second identical frame grows no buffer', () => {
    const { renderer } = make();
    const frame = (): void => {
      renderer.beginFrame();
      for (let i = 0; i < 300; i += 1) renderer.circle(i, i, 20, '#123456');
      renderer.text('score 12', 10, 10, 24, '#ffffff');
      renderer.endFrame();
    };
    frame();
    const grown = renderer.allocations;
    const colours = renderer.coloursCached;
    frame();
    frame();
    expect(renderer.allocations).toBe(grown);
    expect(renderer.coloursCached).toBe(colours);
  });

  it('uploads the glyph page only when a new string appears', () => {
    const { gl, text, renderer } = make();
    const frame = (value: string): void => {
      renderer.beginFrame();
      renderer.text(value, 0, 0, 20, '#fff');
      renderer.endFrame();
    };
    frame('a');
    frame('a');
    expect(gl.ops('texImage2D')).toHaveLength(1);
    frame('b');
    expect(gl.ops('texImage2D')).toHaveLength(2);
    expect(text.drawn).toEqual(['a', 'b']);
  });

  it('places text by the engine spelling of alignment and its vertical centre', () => {
    const { gl, renderer } = make();
    renderer.beginFrame();
    renderer.text('ab', 100, 50, 10, '#fff', 'centre');
    renderer.endFrame();
    // At scale 2 the string is rasterised at 20px: 2 chars * 20 * 0.6 = 24 + gutter 2 = 26
    // device px wide, 28 tall; in logical units that is 13 by 14, centred on (100, 50).
    expect(vertex(gl, 0, 0)).toEqual([200 + (100 - 6.5) * 2, (50 - 7) * 2]);
    expect(vertex(gl, 0, 2)).toEqual([200 + (100 + 6.5) * 2, (50 + 7) * 2]);
  });

  it('refuses a second beginFrame and an endFrame with nothing open', () => {
    const { renderer } = make();
    renderer.beginFrame();
    expect(() => {
      renderer.beginFrame();
    }).toThrow(/already open/);
    renderer.endFrame();
    expect(() => {
      renderer.endFrame();
    }).toThrow(/without a matching beginFrame/);
  });
});

describe('seat rotation and shake', () => {
  it('turns the world half a turn about the centre of the logical box', () => {
    const { gl, renderer } = make();
    renderer.beginFrame();
    renderer.pushSeatRotation(true);
    renderer.rect(0, 0, 10, 10, '#fff');
    renderer.popSeatRotation();
    renderer.endFrame();
    // Logical (0,0) rotated about (400,300) lands on (800,600), i.e. CSS (200+1600, 1200).
    const [x, y] = vertex(gl, 0, 0);
    expect(x).toBeCloseTo(1800);
    expect(y).toBeCloseTo(1200);
  });

  it('snaps a part-way rotation to rest under reduced motion, and shakes not at all', () => {
    const { gl, renderer } = make();
    renderer.setReducedMotion(true);
    renderer.beginFrame();
    renderer.pushRotation(0.4);
    renderer.pushShake(30, 30);
    renderer.rect(0, 0, 10, 10, '#fff');
    renderer.popShake();
    renderer.popSeatRotation();
    renderer.endFrame();
    expect(vertex(gl, 0, 0)).toEqual([200, 0]);
    expect(renderer.reducedMotion).toBe(true);
  });

  it('applies a shake as a displacement in logical units', () => {
    const { gl, renderer } = make();
    renderer.beginFrame();
    renderer.pushShake(3, -2);
    renderer.rect(0, 0, 10, 10, '#fff');
    renderer.popShake();
    renderer.endFrame();
    expect(vertex(gl, 0, 0)).toEqual([206, -4]);
  });

  it('reports the pair that leaked, by name, and repairs the stack', () => {
    const { renderer } = make();
    renderer.beginFrame();
    renderer.pushShake(1, 1);
    renderer.pushSeatRotation(false);
    expect(() => {
      renderer.endFrame();
    }).toThrow(/1 unbalanced pushSeatRotation call\(s\) and 1 unbalanced pushShake call\(s\)/);
    expect(renderer.seatRotationDepth).toBe(0);
    expect(renderer.shakeDepth).toBe(0);
    renderer.beginFrame();
    renderer.endFrame();
  });

  it('refuses a pop with nothing pushed and a rotation that is not a number', () => {
    const { renderer } = make();
    renderer.beginFrame();
    expect(() => {
      renderer.popSeatRotation();
    }).toThrow(/without a matching pushSeatRotation/);
    expect(() => {
      renderer.popShake();
    }).toThrow(/without a matching pushShake/);
    expect(() => {
      renderer.pushRotation(Number.NaN);
    }).toThrow(RangeError);
    expect(() => {
      renderer.pushShake(Number.POSITIVE_INFINITY, 0);
    }).toThrow(RangeError);
    renderer.endFrame();
  });
});

/** A canvas element stand-in that remembers its listeners so a test can fire them. */
class FakeSurface implements SurfaceEventTarget {
  readonly listeners = new Map<string, (event: SurfaceEvent) => void>();
  addEventListener(type: string, listener: (event: SurfaceEvent) => void): void {
    this.listeners.set(type, listener);
  }
  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }
  fire(type: string): { cancelled: boolean } {
    const result = { cancelled: false };
    this.listeners.get(type)?.({
      preventDefault: () => {
        result.cancelled = true;
      },
    });
    return result;
  }
}

describe('losing the surface (#101), by WebGL’s own events', () => {
  it('listens for the WebGL pair, cancels the loss, and rebuilds everything on restore', () => {
    const { gl, renderer } = make();
    const surface = new FakeSurface();
    const seen: string[] = [];
    renderer.watchSurface(
      surface,
      (abandoned) => seen.push(`lost:${String(abandoned)}`),
      () => seen.push('restored'),
    );
    expect([...surface.listeners.keys()]).toEqual(['webglcontextlost', 'webglcontextrestored']);
    const programsBefore = gl.ops('createProgram').length;
    expect(surface.fire('webglcontextlost').cancelled).toBe(true);
    expect(renderer.surfaceLost).toBe(true);
    expect(seen).toEqual(['lost:false']);
    // Drawing while lost is swallowed, not queued for a context that no longer exists.
    renderer.beginFrame();
    renderer.rect(0, 0, 1, 1, '#fff');
    renderer.endFrame();
    expect(gl.ops('drawArrays')).toHaveLength(0);
    surface.fire('webglcontextrestored');
    expect(renderer.surfaceLost).toBe(false);
    expect(seen).toEqual(['lost:false', 'restored']);
    expect(gl.ops('createProgram')).toHaveLength(programsBefore + 1);
    // And the glyph page is uploaded again, because the texture went with the context.
    renderer.beginFrame();
    renderer.text('x', 0, 0, 10, '#fff');
    renderer.endFrame();
    expect(gl.ops('texImage2D').length).toBeGreaterThanOrEqual(1);
  });

  it('gives up after MAX_SURFACE_LOSSES and ignores a later restore', () => {
    const { renderer } = make();
    const surface = new FakeSurface();
    const seen: string[] = [];
    renderer.watchSurface(
      surface,
      (abandoned) => seen.push(`lost:${String(abandoned)}`),
      () => seen.push('restored'),
    );
    for (let i = 0; i < MAX_SURFACE_LOSSES; i += 1) {
      surface.fire('webglcontextlost');
      if (i < MAX_SURFACE_LOSSES - 1) surface.fire('webglcontextrestored');
    }
    expect(seen.at(-1)).toBe('lost:true');
    expect(renderer.surfaceAbandoned).toBe(true);
    surface.fire('webglcontextrestored');
    expect(seen.at(-1)).toBe('lost:true');
    expect(renderer.surfaceLost).toBe(true);
  });

  it('forgets a frame that was open when the surface went, so nothing leaks into the next', () => {
    const { renderer } = make();
    const surface = new FakeSurface();
    renderer.watchSurface(
      surface,
      () => undefined,
      () => undefined,
    );
    renderer.beginFrame();
    renderer.pushSeatRotation(true);
    surface.fire('webglcontextlost');
    expect(renderer.seatRotationDepth).toBe(0);
    renderer.endFrame();
    surface.fire('webglcontextrestored');
    renderer.beginFrame();
    renderer.endFrame();
  });

  it('unsubscribes both listeners when the host tears down', () => {
    const { renderer } = make();
    const surface = new FakeSurface();
    const stop = renderer.watchSurface(
      surface,
      () => undefined,
      () => undefined,
    );
    stop();
    expect(surface.listeners.size).toBe(0);
  });
});
