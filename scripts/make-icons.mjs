#!/usr/bin/env node
/**
 * Draw the app icons, from the site's own wordmark, with no dependencies.
 *
 * Run by hand — `node scripts/make-icons.mjs` — not by the build. The output is committed
 * to `apps/web/public/icons/` and licensed in `apps/web/assets.license.json`, because rule 3
 * is that every shipped asset says where it came from, and `check-asset-licenses.mjs` only
 * looks at tracked files. An icon generated into `out/` at build time would ship unlicensed
 * and unexamined, which is the arrangement that rule exists to prevent.
 *
 * ## Why it is drawn rather than exported from a design tool
 *
 * Rule 1 is original assets only, and the strongest form of "original" available to a
 * repository is a shape defined by arithmetic that anybody can re-run. The geometry is
 * `apps/web/src/components/Wordmark.tsx` — a rounded square in the brand colour with two
 * seats on it — at the same proportions, so the installed icon and the header mark are the
 * same object.
 *
 * ## The one place it departs from the wordmark, deliberately
 *
 * The wordmark draws both seats as filled discs. Here the second seat is a ring. Rule 7
 * says colour is never the only signal, and `#ff5a4e` and `#21b0e8` sit close enough in
 * luminance that a greyscale home screen — or a person who does not separate red from blue
 * — would see two identical dots. A disc and a ring stay two different things with the
 * colour taken away.
 *
 * ## Maskable
 *
 * A maskable icon is cropped to whatever shape the platform likes, and the guaranteed-safe
 * region is the circle of radius 40% of the icon. So the maskable variant fills its square
 * edge to edge with the brand colour — no rounding, because the platform rounds it — and
 * shrinks the seats to 55%, which keeps every drawn pixel inside that circle.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'apps/web/public/icons');

/** Straight from `apps/web/src/styles/tokens.ts`. */
const BRAND = [0x4b, 0x3b, 0xeb];
const SEAT_ONE = [0xff, 0x5a, 0x4e];
const SEAT_TWO = [0x21, 0xb0, 0xe8];

/** The wordmark's own 40-unit grid. */
const GRID = 40;
const CORNER = 11 / GRID;
const SEAT_R = 6.5 / GRID;
const RING_R = 3.4 / GRID;
const SEAT_ONE_X = 14.5 / GRID;
const SEAT_TWO_X = 25.5 / GRID;
const SEAT_Y = 20 / GRID;

/** Samples per pixel per axis. Four is plenty for shapes this smooth and costs nothing. */
const SUPERSAMPLE = 4;

/** Signed coverage helpers, each returning 1 inside the shape and 0 outside. */
const insideDisc = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const insideRing = (x, y, cx, cy, outer, inner) =>
  insideDisc(x, y, cx, cy, outer) && !insideDisc(x, y, cx, cy, inner);

/** A rounded square in the unit box, radius `r`. `r === 0` gives the square itself. */
function insideRoundedSquare(x, y, r) {
  if (r <= 0) return x >= 0 && x <= 1 && y >= 0 && y <= 1;
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * One icon as raw RGBA, in unit coordinates so every size is the same drawing.
 *
 * `corner` is the background rounding and `scale` shrinks the seats about the centre; the
 * two of them are the whole difference between the plain and the maskable variants.
 */
function draw(size, { corner, scale }) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);
  const at = (v) => (v - 0.5) / scale + 0.5;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bg = 0;
      let one = 0;
      let two = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step;
          const y = (py * SUPERSAMPLE + sy + 0.5) * step;
          if (!insideRoundedSquare(x, y, corner)) continue;
          bg += 1;
          const gx = at(x);
          const gy = at(y);
          if (insideDisc(gx, gy, SEAT_ONE_X, SEAT_Y, SEAT_R)) one += 1;
          else if (insideRing(gx, gy, SEAT_TWO_X, SEAT_Y, SEAT_R, RING_R)) two += 1;
        }
      }
      const total = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (py * size + px) * 4;
      if (bg === 0) continue;
      // Composite the seats over the brand background, then the whole thing over
      // transparency. Coverage is a fraction of the samples, so the edges are antialiased.
      const seat = one + two;
      const brandPart = (bg - seat) / total;
      const onePart = one / total;
      const twoPart = two / total;
      const alpha = bg / total;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          (BRAND[channel] * brandPart + SEAT_ONE[channel] * onePart + SEAT_TWO[channel] * twoPart) /
            alpha,
        );
      }
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

/* ---- The smallest PNG encoder that is still a correct one. ------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 are compression, filter and interlace methods, all zero, all only-one-choice.

  // Filter type 0 (None) on every scanline. The shapes are large flat areas, so the
  // cleverer filters buy little and cost a lot of code to get subtly wrong.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- The same drawing as SVG, for the browser tab and anywhere resolution-free. ---- */

function svg() {
  const round = (v) => Number((v * GRID).toFixed(2));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(GRID)} ${String(GRID)}" width="${String(GRID)}" height="${String(GRID)}" role="img" aria-label="DuelBox">
  <rect width="${String(GRID)}" height="${String(GRID)}" rx="${String(round(CORNER))}" fill="#4b3beb"/>
  <circle cx="${String(round(SEAT_ONE_X))}" cy="${String(round(SEAT_Y))}" r="${String(round(SEAT_R))}" fill="#ff5a4e"/>
  <circle cx="${String(round(SEAT_TWO_X))}" cy="${String(round(SEAT_Y))}" r="${String(round((SEAT_R + RING_R) / 2))}" fill="none" stroke="#21b0e8" stroke-width="${String(round(SEAT_R - RING_R))}"/>
</svg>
`;
}

const VARIANTS = [
  ['icon-192.png', 192, { corner: CORNER, scale: 1 }],
  ['icon-512.png', 512, { corner: CORNER, scale: 1 }],
  // Full bleed, seats pulled inside the 40%-radius safe circle. See the note above.
  ['maskable-512.png', 512, { corner: 0, scale: 0.55 }],
  // iOS masks it itself and dislikes transparency, so this one is square too.
  ['apple-touch-icon.png', 180, { corner: 0, scale: 0.82 }],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, options] of VARIANTS) {
  const png = encodePng(size, draw(size, options));
  writeFileSync(join(OUT, name), png);
  console.log(`  ${name.padEnd(24)} ${String(size)}px  ${String(png.length)} bytes`);
}
writeFileSync(join(OUT, 'icon.svg'), svg());
console.log(`  ${'icon.svg'.padEnd(24)} scalable`);
console.log(
  `make-icons: ${String(VARIANTS.length + 1)} files in ${dirname(join(OUT, 'x')).slice(ROOT.length)}`,
);
