import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng, readPngSize } from './png';
import { createCanvas, fillRect } from './raster';
import type { Canvas } from './raster';

/**
 * The encoder is checked by decoding.
 *
 * Asserting that a PNG "looks like a PNG" is the kind of test that passes on a file no
 * viewer can open. So the test reads the bytes back the way a decoder does — inflate the
 * IDAT, undo the row filters, compare the pixels — which is the only way to find out
 * whether the filter this encoder chose per row is the filter it then wrote down.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Chunks, in order, as (type, body) pairs. */
function chunks(png: Uint8Array): { type: string; body: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: { type: string; body: Uint8Array }[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    found.push({ type, body: png.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  return found;
}

/** The pixels a decoder would recover, as RGB triples. */
function decode(png: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  const size = readPngSize(png);
  if (size === null) throw new Error('not a PNG');
  const parts = chunks(png);
  const data = parts.find((part) => part.type === 'IDAT');
  if (!data) throw new Error('no IDAT');
  const raw = new Uint8Array(inflateSync(data.body));
  const stride = size.width * 3;
  const rgb = new Uint8Array(stride * size.height);
  for (let y = 0; y < size.height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[y * (stride + 1) + 1 + i] ?? 0;
      const left = i >= 3 ? (rgb[y * stride + i - 3] ?? 0) : 0;
      const above = y > 0 ? (rgb[(y - 1) * stride + i] ?? 0) : 0;
      const restored = filter === 0 ? value : filter === 1 ? value + left : value + above;
      rgb[y * stride + i] = restored & 0xff;
    }
  }
  return { width: size.width, height: size.height, rgb };
}

function sample(): Canvas {
  const canvas = createCanvas(9, 5, { r: 240, g: 240, b: 250 });
  fillRect(canvas, 2, 1, 4, 3, { r: 20, g: 22, b: 31 });
  fillRect(canvas, 0, 4, 9, 1, { r: 75, g: 59, b: 235 });
  return canvas;
}

describe('the PNG encoder', () => {
  it('writes the signature and the three chunks a decoder needs', () => {
    const png = encodePng(sample());
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
    expect(chunks(png).map((part) => part.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('declares the size it was given', () => {
    expect(readPngSize(encodePng(createCanvas(1200, 630, { r: 0, g: 0, b: 0 })))).toEqual({
      width: 1200,
      height: 630,
    });
  });

  /**
   * Sabotage: chose a filter per row and then wrote `0` in every row's filter byte.
   *
   *   AssertionError: expected [ 240, 240, 250, +0, +0, +0, …(129) ] to deeply equal [ Array(135) ]
   *
   * The file was still a valid PNG of the right size, and every pixel below the first row
   * was wrong. Nothing but decoding it would have said so.
   */
  it('round-trips every pixel', () => {
    const canvas = sample();
    const decoded = decode(encodePng(canvas));
    expect(decoded.width).toBe(canvas.width);
    expect(decoded.height).toBe(canvas.height);
    expect([...decoded.rgb]).toEqual([...canvas.rgb]);
  });

  /** The same canvas twice, so a rebuild of the same commit produces the same files. */
  it('is deterministic', () => {
    expect([...encodePng(sample())]).toEqual([...encodePng(sample())]);
  });

  /**
   * Flat colour is what these cards are made of, and the row filters exist to make deflate
   * cheap on it. A 1200x630 field of one colour is 2.3 MB raw; if this ever stops being a
   * couple of kilobytes, a filter has stopped being chosen.
   */
  it('compresses flat colour to almost nothing', () => {
    const png = encodePng(createCanvas(1200, 630, { r: 247, g: 248, b: 252 }));
    expect(png.length).toBeLessThan(8 * 1024);
  });

  it('rejects bytes that are not a PNG', () => {
    expect(readPngSize(new Uint8Array(4))).toBeNull();
    expect(readPngSize(new Uint8Array(64))).toBeNull();
  });
});
