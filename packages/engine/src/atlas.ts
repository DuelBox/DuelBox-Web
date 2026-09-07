/**
 * Sprite-atlas frame manifest, runtime resolver, and a pure packing function.
 *
 * Loose PNGs mean dozens of requests and a texture swap per draw. Packing a game's
 * sprites into one atlas image with a typed frame manifest fixes both: one request,
 * one texture, and every frame reachable by name with autocompletion.
 *
 * This module is the *runtime* half — the manifest types, the {@link SpriteAtlas}
 * that resolves a frame by name against a loaded image, and {@link packShelf}, the
 * pure geometry that decides where each sprite sits. The build-time emitter that
 * reads the source PNGs, calls the packer, draws the combined image, and writes the
 * `.ts` manifest lives under `scripts/` and is OUT OF THIS PACKAGE'S TERRITORY; it is
 * deliberately not here. Keeping the packing pure means that emitter is a thin shell
 * over a function this module tests directly.
 *
 * Frame rectangles are in atlas-image PIXELS — this is the one place pixels are the
 * unit, because a texture is measured in texels, not logical units. A game still
 * draws in logical units; the renderer maps a frame's pixels onto them.
 */

import type { ImageLike } from './asset-loader.js';

/** A sub-rectangle of the atlas image, in pixels. */
export interface AtlasFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The typed manifest a build emits. `Name` is a string-literal union of the frame
 * names, so `frames` is exhaustive and a lookup autocompletes and type-checks.
 */
export interface AtlasManifest<Name extends string = string> {
  /** URL/name of the packed atlas image the loader fetches. */
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly frames: Readonly<Record<Name, AtlasFrame>>;
}

/**
 * A loaded atlas: the decoded image plus its manifest, with frames looked up by
 * name. Generic over the frame-name union so `frame('idle')` is checked at compile
 * time and offered by autocomplete.
 */
export class SpriteAtlas<Name extends string = string> {
  readonly #image: ImageLike;
  readonly #manifest: AtlasManifest<Name>;

  constructor(image: ImageLike, manifest: AtlasManifest<Name>) {
    this.#image = image;
    this.#manifest = manifest;
  }

  get image(): ImageLike {
    return this.#image;
  }

  get width(): number {
    return this.#manifest.width;
  }

  get height(): number {
    return this.#manifest.height;
  }

  has(name: Name): boolean {
    return Object.prototype.hasOwnProperty.call(this.#manifest.frames, name);
  }

  /** The frame rectangle for `name`. @throws Error if the manifest has no such frame. */
  frame(name: Name): AtlasFrame {
    // `Record` types every value as present, but a hand-written manifest can lie, so
    // read through a type that admits the gap and guard it at runtime.
    const frames = this.#manifest.frames as Readonly<Record<string, AtlasFrame | undefined>>;
    const frame = frames[name];
    if (frame === undefined) {
      throw new Error(`atlas has no frame named "${String(name)}"`);
    }
    return frame;
  }

  /** Every frame name in the manifest. */
  frameNames(): Name[] {
    return Object.keys(this.#manifest.frames) as Name[];
  }
}

/** One sprite handed to the packer: a name and its pixel dimensions. */
export interface PackInput {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export interface PackOptions {
  /** Maximum atlas width in pixels. A sprite wider than this throws. Default 1024. */
  readonly maxWidth?: number;
  /** Transparent gutter in pixels between frames, to stop bleeding. Default 0. */
  readonly padding?: number;
}

export interface PackResult {
  readonly width: number;
  readonly height: number;
  readonly frames: Record<string, AtlasFrame>;
}

/**
 * Shelf-pack sprites into an atlas, deterministically.
 *
 * Sprites are sorted by height (then name) so tall ones anchor a shelf and short
 * ones fill beside them — the classic shelf heuristic. Rows are laid left to right
 * up to `maxWidth`, then a new shelf opens below. The sort makes the result a pure
 * function of the input set, independent of the order it arrived in, which is what
 * lets a build reproduce the same atlas every time.
 *
 * Returns the atlas dimensions and a frame per sprite. Guaranteed: no two frames
 * overlap (padding included), and every frame lies within the returned bounds.
 *
 * @throws Error on a duplicate name, a non-positive dimension, or a sprite too wide
 * to fit `maxWidth`.
 */
export function packShelf(inputs: readonly PackInput[], options?: PackOptions): PackResult {
  const maxWidth = options?.maxWidth ?? 1024;
  const padding = options?.padding ?? 0;
  if (!Number.isInteger(maxWidth) || maxWidth <= 0) {
    throw new RangeError(`maxWidth must be a positive integer, received ${String(maxWidth)}`);
  }
  if (!Number.isInteger(padding) || padding < 0) {
    throw new RangeError(`padding must be a non-negative integer, received ${String(padding)}`);
  }

  const frames: Record<string, AtlasFrame> = {};
  if (inputs.length === 0) {
    return { width: 0, height: 0, frames };
  }

  // Sort a copy so the caller's array is untouched. Tallest first, name as tie-break.
  const sorted = inputs.slice().sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  const seen = new Set<string>();
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  let atlasWidth = 0;

  for (const sprite of sorted) {
    if (!Number.isInteger(sprite.width) || sprite.width <= 0 ||
        !Number.isInteger(sprite.height) || sprite.height <= 0) {
      throw new RangeError(`sprite "${sprite.name}" must have positive integer dimensions`);
    }
    if (seen.has(sprite.name)) {
      throw new Error(`duplicate sprite name "${sprite.name}"`);
    }
    seen.add(sprite.name);
    if (sprite.width > maxWidth) {
      throw new Error(`sprite "${sprite.name}" (${sprite.width}px) is wider than maxWidth ${maxWidth}`);
    }

    // Open a new shelf when this sprite would overflow the current row.
    const advance = shelfX === 0 ? sprite.width : padding + sprite.width;
    if (shelfX + advance > maxWidth) {
      shelfY += shelfHeight + (shelfHeight === 0 ? 0 : padding);
      shelfX = 0;
      shelfHeight = 0;
    }

    const x = shelfX === 0 ? 0 : shelfX + padding;
    frames[sprite.name] = { x, y: shelfY, width: sprite.width, height: sprite.height };
    shelfX = x + sprite.width;
    if (sprite.height > shelfHeight) shelfHeight = sprite.height;
    if (shelfX > atlasWidth) atlasWidth = shelfX;
  }

  return { width: atlasWidth, height: shelfY + shelfHeight, frames };
}
