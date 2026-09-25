import { Canvas2DRenderer, type HostRenderer, type LogicalSize } from '@duelbox/engine';
import { colour } from '@/styles/tokens';
// Type-only, so both are erased: the module itself is reached only through the import() below.
import type { GlyphPage } from '@duelbox/engine/webgl';
import type * as WebGL from '@duelbox/engine/webgl';

/**
 * Which renderer the host builds, decided once at build time (#16).
 *
 * `Canvas2DRenderer` is the renderer of every published build and of every game in the
 * catalogue. The WebGL backend exists for the game that one day needs thousands of bodies or
 * a full-screen effect (ADR 0003 said it would arrive with that game, ADR 0006 says why it
 * arrived before it), and it is reached in exactly one way: `NEXT_PUBLIC_RENDERER=webgl` at
 * build time, which turns the `import()` below into a chunk, and nothing else. With the
 * variable at its default the comparison is `'canvas2d' === 'webgl'`, webpack folds it to
 * `false`, and the `import()` inside is deleted before it is resolved — no chunk is emitted
 * and no WebGL string is in any bundle. `scripts/check-renderer-flag.mjs` reads the export
 * to be sure of that, the way `check-zero-cost.mjs` is sure of the debug overlay, because
 * "the fold should have happened" is the sentence this repository has learnt not to trust.
 *
 * Read `process.env.NEXT_PUBLIC_RENDERER` inline, every time, rather than through a
 * constant: a constant is a variable to the minifier and the fold is not guaranteed
 * through one. `GameHost` does the same for `process.env.NODE_ENV`.
 *
 * ## Why the host builds the text page and the colour fallback
 *
 * The engine may not touch the DOM (lint bans `document` and `navigator` under `packages/`,
 * with `loop.ts` as the one reader of the device). WebGL has no text, so the backend
 * rasterises each string through a 2D context the host hands it; and a CSS colour the
 * backend's own parser does not know — nothing in the catalogue today — is put to the same
 * context, which is the browser's own answer rather than a guess.
 */

type WebGLModule = typeof WebGL;

let webgl: WebGLModule | null = null;

/** Whether this build was made with the WebGL backend switched on. A literal after the fold. */
export function webglRendererEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RENDERER === 'webgl';
}

/**
 * Fetch the WebGL module ahead of building a renderer. Resolves at once in a build made
 * without the flag, where there is nothing to fetch and the `import()` is not in the bundle.
 */
export async function preloadRendererBackend(): Promise<void> {
  // The `import()` sits directly inside the folded condition, as the debug overlay's does.
  // Behind an early return instead, it was emitted: webpack decides what an `import()` means
  // when it parses the module, and it evaluates a static `if` but not the control flow around
  // a `return` — `check-renderer-flag.mjs` found chunk 8136 shipping with the flag off, which
  // is the run that wrote this comment.
  if (process.env.NEXT_PUBLIC_RENDERER === 'webgl') {
    webgl = await import('@duelbox/engine/webgl');
  }
}

export interface RendererBackend {
  readonly renderer: HostRenderer;
  /** Which backend was actually built, for the host's own reporting. */
  readonly kind: 'canvas2d' | 'webgl';
  /**
   * Apply the device-pixel ratio the backing store was sized with. For the 2D backend this
   * is the context transform the host has always set; for WebGL it is handed to the renderer,
   * which has no context transform to carry it.
   */
  setDevicePixelRatio(dpr: number): void;
}

/**
 * Build the renderer for `canvas`, or null if the canvas can give no context at all.
 *
 * WebGL, when the flag is on and the module has been preloaded and the browser grants a
 * context; the 2D backend otherwise, including when a WebGL build meets a browser that
 * refuses WebGL — which is the one case where the flag does not decide, and it is reported
 * in `kind` rather than hidden.
 */
export function createRendererBackend(
  canvas: HTMLCanvasElement,
  logical: LogicalSize,
): RendererBackend | null {
  if (process.env.NEXT_PUBLIC_RENDERER === 'webgl' && webgl !== null) {
    const backend = createWebGLBackend(canvas, logical, webgl);
    if (backend !== null) return backend;
  }
  const context = canvas.getContext('2d');
  if (!context) return null;
  const renderer = new Canvas2DRenderer(context, logical);
  return {
    renderer,
    kind: 'canvas2d',
    setDevicePixelRatio(dpr) {
      // Draw in CSS pixels; the backing store carries the device ratio.
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
  };
}

function createWebGLBackend(
  canvas: HTMLCanvasElement,
  logical: LogicalSize,
  module: WebGLModule,
): RendererBackend | null {
  // `preserveDrawingBuffer` off, as the default: the frame is drawn whole and composited once,
  // and readback is not something a match does. The parity harness asks for its own context.
  const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
  if (gl === null) return null;
  const page = document.createElement('canvas');
  page.width = module.GLYPH_PAGE_SIZE;
  page.height = module.GLYPH_PAGE_SIZE;
  const text = page.getContext('2d');
  if (text === null) return null;
  const renderer = new module.WebGLRenderer(gl, logical, {
    text: glyphPage(page, text),
    normaliseColour: (css) => {
      // The browser's own parse: assigning a valid colour normalises it to `#rrggbb` or
      // `rgba(...)`, and an invalid one leaves the previous value in place — so set a known
      // value first and read whether it moved. Two palette colours rather than a sentinel
      // spelled here (`tokens.test.ts` refuses a hex in a module): if `css` reads as the
      // first, it is either invalid or that very colour, and the second probe tells which.
      text.fillStyle = colour.ink;
      text.fillStyle = css;
      const first = text.fillStyle;
      if (typeof first !== 'string') return null;
      if (first !== colour.ink) return first;
      text.fillStyle = colour.paper;
      text.fillStyle = css;
      return text.fillStyle === colour.paper ? null : first;
    },
  });
  return {
    renderer,
    kind: 'webgl',
    setDevicePixelRatio(dpr) {
      renderer.setDevicePixelRatio(dpr);
    },
  };
}

/**
 * The 2D context as the glyph atlas wants it: white text, vertically centred in the box it
 * is given, on a page it can wipe. The gutter the atlas leaves either side of an entry is
 * where the one-pixel inset comes from.
 */
function glyphPage(page: HTMLCanvasElement, ctx: CanvasRenderingContext2D): GlyphPage {
  return {
    page,
    measure(value, sizePx, family) {
      ctx.font = `${String(sizePx)}px ${family}`;
      return ctx.measureText(value).width;
    },
    draw(value, sizePx, family, x, y, height) {
      ctx.font = `${String(sizePx)}px ${family}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // The page is white glyphs on nothing; the colour is applied in the shader.
      ctx.fillStyle = colour.paper;
      ctx.fillText(value, x + 1, y + height / 2);
    },
    clear() {
      ctx.clearRect(0, 0, page.width, page.height);
    },
  };
}
