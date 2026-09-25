/**
 * Text for a backend that has none (#16).
 *
 * WebGL draws triangles. The choice for text was between a glyph atlas — every character
 * rasterised once and words assembled from quads — and rasterising each *string* once. The
 * second was chosen, and the reason is parity: a string drawn by the browser's own text
 * engine has the browser's kerning, hinting and subpixel positioning, and the 2D backend is
 * the reference this one is held to (`e2e/renderer-parity.spec.ts`). Assembling glyphs by
 * hand reproduces none of that, and the HUD is exactly the place a player would notice.
 *
 * A string at a size is rasterised by the host's 2D context — the engine never touches the
 * DOM (lint bans `document` here), so the host injects a {@link TextRasteriser} built on an
 * offscreen canvas — into one texture page, shelf-packed, and drawn as a textured quad tinted
 * by the colour. White glyphs, tinted in the shader, mean a string is rasterised once
 * whatever colours it is drawn in.
 *
 * ## Why the page resets rather than evicts
 *
 * Strings a game draws are a small fixed set plus the score, and the score is at most a few
 * hundred distinct values a match. A page of 2048 device pixels square holds thousands of
 * HUD strings. When it is full, everything is forgotten and re-rasterised on demand: a reset
 * is one frame of re-uploading what is on screen, an LRU is bookkeeping on the render path
 * every frame. `resets` is counted so a test can see it happen and a host can see that it
 * never does in practice.
 */

/** What the host's 2D context does for this module. The engine never sees the canvas. */
export interface TextRasteriser {
  /** Width of `value` at `sizePx`, in the page's device pixels. */
  measure(value: string, sizePx: number, family: string): number;
  /**
   * Draw `value` in white, vertically centred in a box `height` device pixels tall whose
   * top-left is at (x, y) on the page.
   */
  draw(value: string, sizePx: number, family: string, x: number, y: number, height: number): void;
  /** Wipe the page, because the atlas is starting again. */
  clear(): void;
}

/** Where a rasterised string sits on the page, in device pixels. */
export interface GlyphEntry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The box a line of text gets, as a multiple of its size: room for ascenders and descenders. */
export const LINE_BOX = 1.4;

/** Pixels between entries, so bilinear sampling never bleeds a neighbour in. */
const GUTTER = 2;

export class GlyphAtlas {
  readonly #rasteriser: TextRasteriser;
  readonly #size: number;
  readonly #family: string;
  readonly #entries = new Map<string, GlyphEntry>();
  #shelfX = 0;
  #shelfY = 0;
  #shelfHeight = 0;
  #resets = 0;
  /** Bumped when the page's pixels change and the texture needs re-uploading. */
  #generation = 0;

  constructor(rasteriser: TextRasteriser, pageSize: number, family: string) {
    if (!Number.isInteger(pageSize) || pageSize <= 0) {
      throw new RangeError('pageSize must be a positive integer');
    }
    this.#rasteriser = rasteriser;
    this.#size = pageSize;
    this.#family = family;
  }

  /** How many times the page has been wiped and started again. */
  get resets(): number {
    return this.#resets;
  }

  /** Changes whenever the page's pixels do; a renderer re-uploads when it moves. */
  get generation(): number {
    return this.#generation;
  }

  get pageSize(): number {
    return this.#size;
  }

  /** Distinct strings on the page right now. */
  get count(): number {
    return this.#entries.size;
  }

  /**
   * Where `value` at `sizePx` (device pixels) is on the page, rasterising it if it is not.
   *
   * The key is a template literal, so a lookup allocates one short string; it is the one
   * allocation on the text path and it is the same size whether the string is on the page
   * or not. A glyph cache keyed without building a string would need a two-level map, and
   * the HUD draws a handful of strings a frame — the trade was measured as not worth it.
   */
  entry(value: string, sizePx: number): GlyphEntry {
    const key = `${String(sizePx)} ${value}`;
    const cached = this.#entries.get(key);
    if (cached !== undefined) return cached;
    const height = Math.ceil(sizePx * LINE_BOX);
    const width = Math.ceil(this.#rasteriser.measure(value, sizePx, this.#family)) + GUTTER;
    if (width > this.#size || height > this.#size) {
      throw new RangeError(
        `"${value}" at ${String(sizePx)}px does not fit a ${String(this.#size)}px glyph page`,
      );
    }
    if (this.#shelfX + width > this.#size) {
      this.#shelfX = 0;
      this.#shelfY += this.#shelfHeight + GUTTER;
      this.#shelfHeight = 0;
    }
    if (this.#shelfY + height > this.#size) {
      this.#reset();
    }
    const placed: GlyphEntry = { x: this.#shelfX, y: this.#shelfY, width, height };
    this.#rasteriser.draw(value, sizePx, this.#family, placed.x, placed.y, height);
    this.#entries.set(key, placed);
    this.#shelfX += width + GUTTER;
    if (height > this.#shelfHeight) this.#shelfHeight = height;
    this.#generation += 1;
    return placed;
  }

  #reset(): void {
    this.#rasteriser.clear();
    this.#entries.clear();
    this.#shelfX = 0;
    this.#shelfY = 0;
    this.#shelfHeight = 0;
    this.#resets += 1;
  }
}
