/**
 * Every `<img>` in the export declares its width and height (#2419, #186).
 *
 * A bitmap without dimensions is laid out at zero height until it arrives and then pushes
 * everything below it down, which is the whole of the CLS a catalogue of thumbnails would
 * produce. `docs/performance-budgets.md` holds CLS to 0.1 and says the two usual causes are
 * "already designed out" — the fonts are self-hosted and the tiles are inline SVG with fixed
 * geometry. This is the check that keeps the second half true when the first bitmap lands.
 *
 * ## What it found, and why that is worth writing down
 *
 * **Zero.** There is no `<img>` anywhere in the exported pages: every catalogue tile is
 * three `<use>` elements pointing into one same-document `<symbol>` sprite (`TileSprite.tsx`),
 * every icon is the same, and the share image is fetched by link unfurlers rather than by a
 * browser. So #2419's "serve modern formats with correct sizing per device class" has nothing
 * to serve, "lazy-load only what is on screen" has nothing to lazy-load, and the catalogue's
 * image payload is the document that carries the sprite — which `check-size.mjs` now weighs
 * as `catalogueBytes`.
 *
 * A check that finds nothing is the shape this repository keeps a tally of, so it says the
 * count out loud on every build rather than reporting a clean pass, and it was watched
 * failing with an `<img>` injected into a page. The day a thumbnail ships as a bitmap, this
 * is what asks for its dimensions.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');

async function pages(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await pages(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

const files = await pages(out);
const failures = [];
let images = 0;
if (files.length === 0)
  failures.push('no exported pages under apps/web/out — run `pnpm build` first');

for (const file of files) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    images += 1;
    const tag = match[0];
    const hasWidth = /\swidth=["']?\d/.test(tag);
    const hasHeight = /\sheight=["']?\d/.test(tag);
    if (!hasWidth || !hasHeight) {
      failures.push(
        `${relative(out, file)}: an <img> without ${!hasWidth && !hasHeight ? 'width or height' : !hasWidth ? 'a width' : 'a height'}` +
          ` — it will lay out at nothing and then push the page down when it arrives: ${tag.slice(0, 100)}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`check-images: ${String(failures.length)} problem(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `check-images: ${String(images)} <img> in ${String(files.length)} page(s), every one with its dimensions` +
      (images === 0 ? ' — nothing bitmapped ships; the tiles are inline SVG' : ''),
  );
}
