import { deflateSync } from 'node:zlib';
import type { Canvas } from './raster';

/**
 * A PNG encoder, in about a hundred lines (#2453).
 *
 * PNG is a short specification for the case this needs: a signature, three chunks, and one
 * filter byte in front of every row. Writing it here rather than installing an encoder buys
 * three things this repository already cares about. It ships nothing to a browser — this
 * module is reached only by the build-time generator, so no route imports it and no chunk
 * carries it. It has no native dependency, so the build has nothing to compile and nothing
 * that can be missing on one platform. And it makes the output ours: the bytes below are a
 * spec being followed, not an image being processed by something else's decoder.
 *
 * Truecolour rather than a palette, deliberately. The cards are flat colour over flat
 * colour, but every edge in them is antialiased, so the mark's outline alone runs through
 * a few hundred blends of ink into tint — enough that a 256-entry palette would have to
 * quantise, and a visible band across a smooth curve is a poor trade for bytes that
 * deflate is going to take back anyway. Measured: about 20 kB a card.
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel in the only colour type this writes: 8-bit RGB, no alpha. */
const CHANNELS = 3;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
  return out;
}

/**
 * Row filters, and why only three of the five.
 *
 * A filter's job is to turn a row into something deflate can compress, and on flat artwork
 * `Sub` (this pixel minus the one to its left) collapses every run of one colour to zeros
 * and `Up` (minus the pixel above) collapses every row that repeats the one above it —
 * which between them is most of a card. `Average` and `Paeth` earn their keep on
 * photographs and cost a pass over every row of every image to find that out here. The
 * heuristic is the one the PNG specification suggests: pick the filter whose output has the
 * smallest sum of absolute signed values.
 */
const FILTERS = [0, 1, 2] as const;

function filterRow(
  row: Uint8ClampedArray,
  previous: Uint8ClampedArray | null,
  filter: number,
  out: Uint8Array,
): number {
  let cost = 0;
  for (let i = 0; i < row.length; i += 1) {
    const raw = row[i]!;
    const left = i >= CHANNELS ? row[i - CHANNELS]! : 0;
    const above = previous === null ? 0 : previous[i]!;
    const value = filter === 0 ? raw : filter === 1 ? raw - left : raw - above;
    const byte = value & 0xff;
    out[i] = byte;
    cost += byte < 128 ? byte : 256 - byte;
  }
  return cost;
}

/** The canvas as PNG bytes. Same pixels in, same bytes out, on any machine. */
export function encodePng(canvas: Canvas): Uint8Array {
  const stride = canvas.width * CHANNELS;
  const raw = new Uint8Array((stride + 1) * canvas.height);
  const candidate = new Uint8Array(stride);
  let previous: Uint8ClampedArray | null = null;

  for (let y = 0; y < canvas.height; y += 1) {
    const row = canvas.rgb.subarray(y * stride, (y + 1) * stride);
    let bestFilter = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const filter of FILTERS) {
      const cost = filterRow(row, previous, filter, candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestFilter = filter;
      }
    }
    const target = y * (stride + 1);
    raw[target] = bestFilter;
    filterRow(row, previous, bestFilter, candidate);
    raw.set(candidate, target + 1);
    previous = row;
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, canvas.width);
  view.setUint32(4, canvas.height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // deflate, the only compression PNG defines
  header[11] = 0; // adaptive filtering, the only filter method PNG defines
  header[12] = 0; // not interlaced

  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));
  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/**
 * The width and height a PNG declares, read back out of its own header.
 *
 * The guard that checks the export needs this: a card whose metadata says 1200x630 and
 * whose file says something else is exactly the kind of disagreement nobody notices until a
 * platform crops the preview strangely, and the only honest way to check it is to read the
 * file rather than the code that wrote it.
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null; // "IHDR"
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
