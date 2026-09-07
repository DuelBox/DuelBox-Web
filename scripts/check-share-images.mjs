#!/usr/bin/env node
/**
 * Every preview a page promises is a file the build actually emitted (#2453, #197).
 *
 * ## Why this is a build guard and not a unit test
 *
 * `share-image.test.ts` proves that every game in the catalogue has a card in the
 * generator's manifest. That is a claim about two lists agreeing with each other, and both
 * of them are source. It stays true if the images are never written, if `public/` is not
 * copied, if a base path lands in the URL twice, or if somebody renames the directory in
 * one place. None of those show up anywhere a person looks: a broken `og:image` is
 * invisible on the site itself and shows up only in somebody else's chat window, days
 * later, as a missing picture nobody reports.
 *
 * So this reads the export. The metadata comes out of the exported HTML, the files come off
 * the disk, and the dimensions come out of the PNG's own header rather than from the code
 * that wrote it — three independent places that have to agree.
 *
 * ## How it knows the site's address without being told
 *
 * It does not read `NEXT_PUBLIC_SITE_URL`, because then a mistake in that variable would be
 * a mistake in the guard too. Each page carries a canonical URL that ends with that page's
 * own route, so subtracting the route from the canonical leaves the site root — derived
 * from the build, per page, and required to be the same answer everywhere. A page whose
 * canonical does not end in its own route fails here, which is worth having on its own.
 *
 * ## Watched failing, on purpose
 *
 * Against an export built to be wrong six ways — `DUELBOX_EXPORT_DIR` is what made that
 * possible — this printed, one sabotage each:
 *
 *   - games/chess/index.html points at …/og/chess.png, which the build did not emit
 *   - games/sudoku/index.html declares no og:image, so sharing it shows a link with no picture
 *   - games/chess/index.html tells a platform 1200x675 and og/chess.png is 1200x630
 *   - /games/chess/ shares og/sudoku.png, which is not that game's own card
 *   - og/old-name.png is in the export and no page points at it
 *   - games/chess/index.html is served at /games/chess/ and calls itself canonical at
 *     …/games/chess
 *
 * and passed on the same export with the six repaired. CLAUDE.md counts seven guards in
 * this repository that turned out to enforce nothing; the cost of not being the eighth is
 * ten minutes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * The export to check. The variable exists so this guard could be watched failing against
 * exports built to be wrong — a renamed card, a page with the tag removed, a declared size
 * that does not match the file — which is the only way to know it fails for the reasons it
 * claims to. Nothing in the build sets it.
 */
const OUT = process.env.DUELBOX_EXPORT_DIR ?? join(ROOT, 'apps/web/out');
const IMAGE_DIR = 'og';

const failures = [];
const fail = (detail) => failures.push(detail);

function pages(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) pages(path, found);
    else if (entry.name === 'index.html') found.push(path);
  }
  return found;
}

/** `out/games/chess/index.html` → `/games/chess/`, which is the route it is served at. */
function routeOf(page) {
  const parts = relative(OUT, page).split(sep).slice(0, -1);
  return parts.length === 0 ? '/' : `/${parts.join('/')}/`;
}

function meta(html, attribute, name) {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}="${name}"[^>]*content="([^"]*)"|<meta[^>]+content="([^"]*)"[^>]*${attribute}="${name}"`,
    'g',
  );
  return [...html.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? '');
}

function canonicalOf(html) {
  const match = /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/.exec(html);
  return match === null ? null : match[1];
}

/** The width and height a PNG declares in its own IHDR, read here rather than trusted. */
function pngSize(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  if (bytes.readUInt32BE(12) !== 0x49484452) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

if (!existsSync(OUT)) {
  console.error('check-share-images: apps/web/out is missing — run `pnpm build` first.');
  process.exit(1);
}

const catalogue = JSON.parse(readFileSync(join(ROOT, 'data/catalog.generated.json'), 'utf8')).games;
// The embeddable /embed/<slug>/ frames (#2367) deliberately declare the game page as their
// canonical URL — an embed is a duplicate of the game it hosts, not its own address — and are
// never shared as content, so they carry no preview image of their own. They are therefore
// exempt from both the self-canonical derivation and the per-page share-image requirement
// below; the game page each one points at is checked in full.
const exported = pages(OUT).filter((page) => !routeOf(page).startsWith('/embed/'));
if (exported.length === 0) {
  console.error('check-share-images: no exported pages found — run `pnpm build` first.');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------
// The site's own address, from the pages themselves.
// ---------------------------------------------------------------------------------------
const roots = new Map();
for (const page of exported) {
  const html = readFileSync(page, 'utf8');
  const canonical = canonicalOf(html);
  if (canonical === null) continue;
  const route = routeOf(page);
  if (!canonical.endsWith(route)) {
    fail(`${relative(OUT, page)} is served at ${route} and calls itself canonical at ${canonical}`);
    continue;
  }
  const root = canonical.slice(0, canonical.length - route.length);
  roots.set(root, (roots.get(root) ?? 0) + 1);
}
if (roots.size !== 1) {
  fail(
    roots.size === 0
      ? 'no page carries a canonical URL, so the address the images are published under cannot be checked'
      : `the export names ${String(roots.size)} different site roots: ${[...roots.keys()].join(', ')}`,
  );
}
const [root = ''] = [...roots.keys()];

// ---------------------------------------------------------------------------------------
// Every preview a page names exists, is a PNG, and is the size the page says it is.
// ---------------------------------------------------------------------------------------
const referenced = new Set();
const previews = new Map();

for (const page of exported) {
  const html = readFileSync(page, 'utf8');
  const where = relative(OUT, page);
  const open = meta(html, 'property', 'og:image');
  const twitter = meta(html, 'name', 'twitter:image');
  if (open.length === 0) {
    fail(`${where} declares no og:image, so sharing it shows a link with no picture`);
    continue;
  }
  if (open.length > 1) {
    fail(
      `${where} declares ${String(open.length)} og:image tags; the width and height on the page cannot describe them all`,
    );
  }
  const declaredWidth = Number(meta(html, 'property', 'og:image:width')[0] ?? '0');
  const declaredHeight = Number(meta(html, 'property', 'og:image:height')[0] ?? '0');

  for (const url of new Set([...open, ...twitter])) {
    if (!url.startsWith(`${root}/`)) {
      fail(`${where} points at ${url}, which is not under this site's own address ${root}/`);
      continue;
    }
    const path = url.slice(root.length + 1);
    referenced.add(path);
    const file = join(OUT, path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      fail(`${where} points at ${url}, which the build did not emit (${relative(ROOT, file)})`);
      continue;
    }
    const size = pngSize(file);
    if (size === null) {
      fail(`${where} points at ${path}, which is not a PNG`);
      continue;
    }
    if (size.width !== declaredWidth || size.height !== declaredHeight) {
      fail(
        `${where} tells a platform ${String(declaredWidth)}x${String(declaredHeight)} and ${path}` +
          ` is ${String(size.width)}x${String(size.height)}`,
      );
    }
    previews.set(where, path);
  }
}

// ---------------------------------------------------------------------------------------
// Every game has one, and it is its own.
// ---------------------------------------------------------------------------------------
for (const game of catalogue) {
  const where = join('games', game.slug, 'index.html');
  const preview = previews.get(where);
  if (preview === undefined) {
    fail(
      `${game.slug} has no share image on its page — /games/${game.slug}/ shares as a bare link`,
    );
  } else if (preview !== `${IMAGE_DIR}/${game.slug}.png`) {
    fail(`/games/${game.slug}/ shares ${preview}, which is not that game's own card`);
  }
}

// ---------------------------------------------------------------------------------------
// And nothing is shipped that no page asks for.
// ---------------------------------------------------------------------------------------
const emitted = existsSync(join(OUT, IMAGE_DIR)) ? readdirSync(join(OUT, IMAGE_DIR)) : [];
if (emitted.length === 0) {
  fail(`apps/web/out/${IMAGE_DIR}/ is empty — the generator did not run before the export`);
}
for (const file of emitted) {
  if (!referenced.has(`${IMAGE_DIR}/${file}`)) {
    fail(
      `${IMAGE_DIR}/${file} is in the export and no page points at it — a card left behind by a` +
        ' rename is a picture of a game the site no longer has',
    );
  }
}

console.log(
  `check-share-images: ${String(exported.length)} exported page(s), ` +
    `${String(referenced.size)} distinct preview(s), ${String(emitted.length)} file(s) in /${IMAGE_DIR}/`,
);

if (failures.length > 0) {
  console.error(`\ncheck-share-images: ${String(failures.length)} problem(s)\n`);
  for (const detail of failures) console.error(`  - ${detail}`);
  console.error(
    '\nA share image is only ever seen somewhere else, so nothing on this site fails when one\n' +
      'is missing. That is why it is checked here. See scripts/generate-share-images.mjs.',
  );
  process.exit(1);
}
console.log('check-share-images: every page previews a picture the build emitted');
