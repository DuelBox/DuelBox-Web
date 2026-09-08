#!/usr/bin/env node
/**
 * The size budget rule 11 talks about, and the `pnpm size` the README has always
 * promised. Neither existed: the command resolved to the system `size(1)`, which
 * cheerfully reported on a non-existent `a.out` and exited without complaint.
 *
 * Four numbers matter to a player, and they are not the same number:
 *
 *   - **The shell** — everything the browser must have before anyone can pick a game.
 *     Every visitor pays it once.
 *   - **On demand** — the play route's own chunks, plus anything pulled by an
 *     `import()`. Nobody downloads it by arriving; you pay it when you commit.
 *   - **A game** — the marginal chunk for the one game they chose. One chunk per game is
 *     the whole point of the layout, and it is worth failing a build that quietly
 *     collapses that into the shell.
 *   - **Speculated** — the route payloads the router fetches for links nobody has pressed.
 *     Not JavaScript, and therefore invisible here until #185 measured it: see below.
 *
 * Gzipped, because that is what crosses the wire.
 *
 * ## The bytes this script could not see, and now can
 *
 * Every number above is a `.js` file, because `walk()` collects nothing else — and the
 * largest download on this site is not JavaScript. `next/link` prefetches the route payload
 * for every catalogue card within 200px of the viewport, and a catalogue browse passes all
 * 108 of them under that observer: 108 requests for `/play/<slug>/index.txt`, which the
 * build writes as the router's payload for each play route. Measured on the build this
 * guard was written against, that is **more than twice ADR 0001's whole 182 KB first-session
 * budget**, spent before anybody has pressed anything, on a metered connection as readily as
 * on any other — `next/link` in the app router has no save-data bail-out.
 *
 * The point of #2516 was that an unmeasured chunk is where the bytes go to hide, and a file
 * extension this script filtered out is the same hiding place one layer over. So the total
 * is budgeted here, where a build fails over it, rather than described in a docstring. What
 * the number does *not* do is bless the arrangement: `e2e/prefetch.spec.ts` carries the
 * argument about what to do next, and `size-budget.json`'s note carries the arithmetic.
 *
 * ## What "shell" is, and what it was
 *
 * Until #2516 the shell was computed as *everything that is not one game's own chunk*:
 * `walk(out)` minus the 108 game chunks. That counted, against the number described as
 * "paid by every visitor":
 *
 *   - `app/play/[slug]/page-*.js` and its shared chunk — 36.2 KB that only somebody who
 *     has already chosen a game ever fetches. The audio synthesiser lives in there;
 *     a visitor reading the catalogue was being billed for it.
 *   - `framework-*.js`, `main-*.js`, `pages/_app-*.js`, `pages/_error-*.js` and the two
 *     `_buildManifest`/`_ssgManifest` files — 94.8 KB of pages-router surface that Next
 *     emits unconditionally and that this app-router-only export never loads. Grep all
 *     223 exported HTML files: not one references them.
 *
 * That is 131 KB of the 278.2 KB the guard was defending, and worse than merely
 * inaccurate — it inverted the incentive. Deferring work into an async chunk left the
 * chunk inside `!gameChunkFiles.has(file)`, so the shell number did not move; webpack's
 * per-chunk boilerplate made it move *up*. The one optimisation the layout exists to
 * reward was the one the budget punished.
 *
 * ## How a chunk is classified now
 *
 * From the build's own manifests, not from filenames. `.next/app-build-manifest.json`
 * lists, per route, the scripts that route loads eagerly; `.next/build-manifest.json`
 * carries the polyfills and root files every app route loads, and the pages-router
 * surface nothing here loads. Async chunks are followed through the webpack runtime:
 * `__webpack_require__.u` maps a chunk id to its filename, and `.e(<id>)` in a chunk's
 * source is that chunk asking for another one.
 *
 * Every emitted script must land in exactly one bucket. If one does not, the build fails
 * — an unclassified chunk means this script has stopped understanding the build output,
 * and a guard that has stopped understanding its input must not report success.
 *
 * ## A trap worth recording, from #2516
 *
 * `"sideEffects": false` on `@duelbox/engine` and `@duelbox/game-sdk` is an *accurate*
 * declaration, and it reads as a clean win against the old number:
 *
 *   |         | shell    | total    | tic-tac-toe | sudoku | solitaire |
 *   |---------|----------|----------|-------------|--------|-----------|
 *   | without | 280.0 KB | 759.7 KB | 2.9 KB      | 6.2 KB | 6.0 KB    |
 *   | with    | 279.1 KB | 874.1 KB | 4.8 KB      | 8.2 KB | 8.0 KB    |
 *
 * It moves engine code out of the shared chunk and inlines a copy into each of 108 game
 * chunks. A player downloads the shell *plus one game*, so they end up about 1 KB worse
 * off while the budgeted number improves by 0.9 KB. Tried, measured, reverted. The
 * per-game budget below is the thing that would have caught it; judge a change by the
 * player's total, which this script prints, not by whichever line moved.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'apps/web');
const OUT = join(WEB, 'out');
// Mirrors `distDir` in apps/web/next.config.ts: `pnpm dev` builds into `.next-dev` so a
// production build never deletes the manifests a running dev server is serving from.
const DIST = join(WEB, process.env.NEXT_DIST_DIR ?? '.next');
const BUDGET = JSON.parse(readFileSync(join(ROOT, 'size-budget.json'), 'utf8'));

// The routes a visitor reaches only after choosing a game. Everything else is the shell.
// `/play/[slug]` is the one; if a second post-choice route appears, it belongs here, and
// the shell number should drop when it is added rather than rise.
const isPostChoiceRoute = (route) => route.startsWith('/play/') || route.startsWith('/embed/');

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (entry.endsWith('.js')) found.push(full);
  }
  return found;
}

function gzipped(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

let files;
try {
  files = walk(OUT);
} catch {
  console.error('check-size: apps/web/out is missing — run `pnpm build` first.');
  process.exit(1);
}

let appManifest;
let buildManifest;
try {
  appManifest = JSON.parse(readFileSync(join(DIST, 'app-build-manifest.json'), 'utf8'));
  buildManifest = JSON.parse(readFileSync(join(DIST, 'build-manifest.json'), 'utf8'));
} catch {
  console.error(
    `check-size: ${relative(ROOT, DIST)} has no build manifests — run \`pnpm build\` first.`,
  );
  process.exit(1);
}

const sizes = new Map(files.map((file) => [file, gzipped(file)]));
const totalJs = [...sizes.values()].reduce((sum, size) => sum + size, 0);
const emitted = new Set(files);
// Manifest paths are URLs under `_next/`, relative to the export root. `basePath` changes
// the URL a browser asks for, never where the file lands on disk.
const onDisk = (path) => join(OUT, '_next', path);
const bytesOf = (group) => [...group].reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0);

// ---------------------------------------------------------------------------------
// Eager: what a route's HTML loads with a <script> tag, straight from the manifests.
// ---------------------------------------------------------------------------------
const alwaysEager = [...buildManifest.rootMainFiles];
const shellEager = new Set();
const postChoiceEager = new Set();
for (const [route, scripts] of Object.entries(appManifest.pages)) {
  const target = isPostChoiceRoute(route) ? postChoiceEager : shellEager;
  for (const script of [...scripts, ...alwaysEager]) {
    if (script.endsWith('.js')) target.add(onDisk(script));
  }
}
for (const file of shellEager) postChoiceEager.delete(file);

// ---------------------------------------------------------------------------------
// The legacy polyfills, which are a bucket of their own because nobody supported fetches
// them.
// ---------------------------------------------------------------------------------
// Next emits `polyfills-*.js` and references it as `<script nomodule>`. Every engine that
// understands `<script type=module>` — which is every engine in tiers 1 and 2 of
// `docs/support-matrix.md`, and has been since 2018 — skips it without a request. Only an
// engine the matrix puts in tier 3 ("Internet Explorer, legacy EdgeHTML, UC Browser …",
// explicitly not tested and not designed for) ever downloads it.
//
// It was in `shellEager` until now, so **38.5 KB of the 164 KB "paid by every visitor" was
// paid by nobody** — 23% of the number rule 11 defends, on a line whose whole claim is that
// it describes a real download. That is the same mistake #2516 fixed for the pages-router
// files four lines below, and it survived because `polyfillFiles` sits in the same manifest
// array as `rootMainFiles`, which every route really does load.
//
// It gets a budget rather than an exemption: this file is Next's, not ours, and a framework
// upgrade that doubles it should be seen. And the exclusion is *checked*, not assumed —
// `nomodule` is the entire argument, so if Next ever stops writing it the bucket becomes a
// lie and the build fails instead.
const legacyPolyfills = new Set(
  buildManifest.polyfillFiles.filter((script) => script.endsWith('.js')).map(onDisk),
);
for (const file of legacyPolyfills) {
  shellEager.delete(file);
  postChoiceEager.delete(file);
}

// The manifests describe the build in `.next`; the bytes measured are the ones in `out`.
// If a build failed after writing its manifests, the two disagree, and every number below
// would be computed against a mixture of two builds. Say so instead.
const stale = [...shellEager, ...postChoiceEager].filter((file) => !emitted.has(file));
if (stale.length > 0) {
  console.error(
    `check-size: ${relative(ROOT, OUT)} is stale — ${String(stale.length)} script(s) the build` +
      ` manifests list are not there, starting with ${relative(OUT, stale[0])}.` +
      ' Run `pnpm build` again.',
  );
  process.exit(1);
}

// Emitted for the pages router, which an app-router-only static export never loads. Kept
// out of every budget deliberately: no visitor fetches these, so billing them to the
// shell was billing bytes nobody downloads.
const neverFetched = new Set(
  [...Object.values(buildManifest.pages).flat(), ...buildManifest.lowPriorityFiles]
    .filter((script) => script.endsWith('.js'))
    .map(onDisk)
    .filter((file) => !shellEager.has(file) && !postChoiceEager.has(file)),
);

// ---------------------------------------------------------------------------------
// Async: follow `import()` through the webpack runtime.
// ---------------------------------------------------------------------------------
// `__webpack_require__.u` is the chunk-id → filename map, minified to something like
// `.u=e=>"static/chunks/"+e+"."+({8:"8e3b...",26:"2726...";})[e]+".js"`. Read the object
// that follows the literal rather than matching the whole expression, so a minifier
// reshuffling the arithmetic around it does not silently yield an empty map.
const runtime = [...emitted].find((file) => /(^|\/)webpack-[^/]*\.js$/.test(file));
const chunkFileById = new Map();
if (runtime !== undefined) {
  const source = readFileSync(runtime, 'utf8');
  const anchor = source.indexOf('"static/chunks/"');
  const map = anchor === -1 ? '' : source.slice(anchor, source.indexOf('}', anchor));
  for (const [, id, hash] of map.matchAll(/(\d+):"([0-9a-z]+)"/g)) {
    chunkFileById.set(id, onDisk(`static/chunks/${id}.${hash}.js`));
  }
}

function importedBy(file) {
  const source = readFileSync(file, 'utf8');
  const pulled = new Set();
  for (const [, id] of source.matchAll(/\.e\((\d{1,7})\)/g)) {
    const chunk = chunkFileById.get(id);
    if (chunk !== undefined && emitted.has(chunk)) pulled.add(chunk);
  }
  return pulled;
}

function reachableFrom(roots) {
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    for (const chunk of importedBy(queue.pop())) {
      if (!seen.has(chunk)) {
        seen.add(chunk);
        queue.push(chunk);
      }
    }
  }
  return seen;
}

const shellReachable = reachableFrom(shellEager);
const postChoiceReachable = reachableFrom(postChoiceEager);
// On demand: the play route's own eager chunks, plus every chunk any reachable code
// `import()`s. Deferring work out of the shell moves bytes from the first budget to the
// second, which is exactly the trade the second budget exists to price.
const onDemand = new Set(postChoiceEager);
for (const chunk of [...shellReachable, ...postChoiceReachable]) {
  if (!shellEager.has(chunk)) onDemand.add(chunk);
}

// ---------------------------------------------------------------------------------
// Which chunks belong to a single game?
// ---------------------------------------------------------------------------------
// A game's own chunk is an on-demand chunk that names it and names no other game — a
// chunk naming several has stopped being one-chunk-per-game.
//
// From the dynamic-import specifiers, not the object keys: five of the keys in the
// registry are unquoted (`reversi:` rather than `'reversi':`), so reading keys with a
// regex silently found eighteen of the twenty-three games and reported success.
//
// And a chunk *names* a game by carrying its manifest id, `id:"ping-pong"`, not by
// containing the word anywhere. That distinction cost a build: the id `match` appears as a
// bare substring in eleven chunks — `String.prototype.match` is in most bundles — so a
// 38.5 KB shared chunk was attributed to a 3 KB game, failed the budget, and took 35 KB
// off the shell's number at the same time. Exactly one chunk carries `id:"match"`.
const registry = readFileSync(join(WEB, 'src/data/registry.ts'), 'utf8');
const playable = [...registry.matchAll(/import\('@duelbox\/game-([a-z0-9-]+)'\)/g)]
  .map((match) => match[1])
  .filter((slug, index, all) => all.indexOf(slug) === index);

const gameChunks = new Map();
for (const file of onDemand) {
  const source = readFileSync(file, 'utf8');
  const named = playable.filter(
    (slug) => source.includes(`id:"${slug}"`) || source.includes(`id:'${slug}'`),
  );
  if (named.length === 1) gameChunks.set(named[0], file);
}
const gameChunkFiles = new Set(gameChunks.values());
for (const file of gameChunkFiles) onDemand.delete(file);

const failures = [];
const report = [];

for (const [slug, file] of [...gameChunks].sort()) {
  const size = sizes.get(file) ?? 0;
  report.push(`  ${slug.padEnd(22)} ${kb(size).padStart(9)}  ${relative(OUT, file)}`);
  if (size > BUDGET.gameChunkBytes) {
    failures.push(`${slug} is ${kb(size)}, over the ${kb(BUDGET.gameChunkBytes)} game budget`);
  }
}

const shellBytes = bytesOf(shellEager);
const onDemandBytes = bytesOf(onDemand);
const legacyPolyfillBytes = bytesOf(legacyPolyfills);
const biggestGame = Math.max(0, ...[...gameChunkFiles].map((file) => sizes.get(file) ?? 0));

// The one fact the bucket above rests on, read from the export rather than believed. A
// polyfill script that is *not* `nomodule` is fetched by everybody, and would then belong in
// the shell — so this fails the build rather than quietly under-reporting 38 KB.
const exportedPages = (dir) => {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...exportedPages(full));
    else if (entry.endsWith('.html')) found.push(full);
  }
  return found;
};
const htmlFiles = exportedPages(OUT);
const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const file of legacyPolyfills) {
  const url = `/${relative(OUT, file).replaceAll('\\', '/')}`;
  const referencing = htmlFiles.filter((page) => readFileSync(page, 'utf8').includes(url));
  if (referencing.length === 0) {
    failures.push(
      `${relative(OUT, file)} is in the polyfill bucket and no exported page references it` +
        ' — the bucket is measuring a file nothing loads',
    );
    continue;
  }
  const guarded = new RegExp(`<script[^>]*${escapeForRegExp(url)}[^>]*nomodule`, 'i');
  const unguarded = referencing.filter((page) => !guarded.test(readFileSync(page, 'utf8')));
  if (unguarded.length > 0) {
    failures.push(
      `${relative(OUT, file)} is loaded without \`nomodule\` by ${String(unguarded.length)}` +
        ` page(s), starting with ${relative(OUT, unguarded[0])} — every browser fetches it,` +
        ' so it is shell, and this bucket is no longer honest',
    );
  }
}

// ---------------------------------------------------------------------------------
// Speculated: the route payloads a browse of the catalogue fetches for links nobody
// pressed. One `index.txt` per play route, which is one per card in the grid.
// ---------------------------------------------------------------------------------
// From the export rather than from a browser, so this runs in the same second as the rest
// of the build; `e2e/prefetch.spec.ts` is the half that watches a real router fetch them,
// and it holds the total against this same budget so the two cannot drift.
function routePayloads(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routePayloads(full));
    else if (entry === 'index.txt') found.push(full);
  }
  return found;
}

const payloads = routePayloads(join(OUT, 'play'));
const speculatedBytes = payloads.reduce((sum, file) => sum + gzipped(file), 0);

console.log(
  `check-size: ${String(files.length)} shipped script(s), ${kb(totalJs)} gzipped in total`,
);
console.log(`check-size: shell (paid by every visitor) ${kb(shellBytes)}`);
console.log(
  `check-size: legacy polyfills (nomodule — only a tier-3 engine fetches these)` +
    ` ${kb(legacyPolyfillBytes)}`,
);
console.log(`check-size: on demand (paid on choosing a game) ${kb(onDemandBytes)}`);
console.log(
  `check-size: worst case for one player ${kb(shellBytes + onDemandBytes + biggestGame)}` +
    ` = shell + on demand + the largest game, on an engine this site supports`,
);
console.log(
  `check-size: speculated (paid for browsing, pressing nothing) ${kb(speculatedBytes)}` +
    ` across ${String(payloads.length)} route payload(s)`,
);
if (neverFetched.size > 0) {
  console.log(
    `check-size: ${String(neverFetched.size)} script(s) emitted and never fetched,` +
      ` ${kb(bytesOf(neverFetched))} — pages-router surface this export does not use`,
  );
}
if (report.length > 0) {
  console.log(`check-size: ${String(gameChunks.size)} game chunk(s):`);
  console.log(report.join('\n'));
} else {
  failures.push('no per-game chunks found at all — code splitting has broken');
}

// Every playable game must have a chunk of its own. A game that has quietly been folded
// into the shell costs every visitor, including the ones who never open it.
const unsplit = playable.filter((slug) => !gameChunks.has(slug));
if (unsplit.length > 0) {
  failures.push(`no chunk of its own for: ${unsplit.join(', ')}`);
}

// ---------------------------------------------------------------------------------
// The service worker, which is a class of its own and belongs in none of the others.
// ---------------------------------------------------------------------------------
// `sw.js` is emitted by `emit-service-worker.mjs` after the export, so it is a shipped
// script that no page's import graph reaches: the page hands its URL to
// `navigator.serviceWorker.register` and the browser fetches it. That makes every existing
// bucket the wrong answer. It is not shell — no route loads it, and calling it shell would
// charge it against a budget it has nothing to do with. It is not on demand — nobody
// chooses it. It is not a game chunk, and it is emphatically not "never fetched", which is
// the bucket it would otherwise fall into and the one that would have hidden it.
//
// So it is weighed on a line of its own. What that line means is different from the others
// and worth stating: a visitor pays it once, and then again only when its bytes change,
// which is the mechanism by which anything is ever fixed on a device that has been here
// before. It is small and it should stay small, but the reason to hold it is not the same
// reason the shell is held.
const workerFiles = files.filter((file) => basename(file) === 'sw.js');
const workerBytes = bytesOf(new Set(workerFiles));
if (workerFiles.length > 1) {
  failures.push(
    `${String(workerFiles.length)} files named sw.js in the export; there can be exactly one`,
  );
}
console.log(`check-size: service worker (paid once, and again on every deploy) ${kb(workerBytes)}`);

// ---------------------------------------------------------------------------------
// Sessions: what a phone downloads, rather than what the build emits (#2446, #2419).
// ---------------------------------------------------------------------------------
// Every line above is a fact about JavaScript, and a session is not made of JavaScript. A
// first visit fetches a document, its stylesheets, three self-hosted faces, the shell, the
// worker, the play route's code and one game's chunk; a browse of the catalogue fetches a
// document twice the size and 108 route payloads instead of a game. Neither total existed
// anywhere: `check-zero-cost.mjs` prints a "session weight", and that figure is the *raw*
// size of the scripts one play page references — polyfills nobody fetches included, the
// game chunk that arrives by `import()` excluded, and no document, stylesheet or font at
// all. It is a ratchet on one page's script tags, which is what it was written to be. These
// three are the wire bytes of a whole session, gzipped like everything else here.
//
// Fonts are counted at their file size, not re-gzipped: a woff2 is Brotli-compressed
// internally and gzip adds about 0.1% to it, so the file size is the wire size. Only the
// base subsets are counted as fetched — `unicode-range` on each `@font-face` means the
// `-latin-ext` faces are requested only when a glyph in that range is rendered, which no
// English page does; they are reported beside the total rather than hidden in it.
//
// Not counted, and why: the share image (`/og/…png`) is fetched by link unfurlers, never by
// a browser rendering the page; the `latin-ext` faces, for the reason above; and the dozen
// route payloads the landing page's own cards prefetch, which are the browsing line's
// concern and are already inside `speculatedBytes`.
function documentAt(route) {
  const file = join(OUT, ...route.split('/').filter(Boolean), 'index.html');
  try {
    return { file, html: readFileSync(file, 'utf8') };
  } catch {
    failures.push(`${route} is not in the export, so no session that starts there can be measured`);
    return { file, html: '' };
  }
}

/** The stylesheets a document links, on disk. */
function stylesheetsOf(html) {
  return [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((match) =>
    join(OUT, (match[1] ?? '').replace(/^\//, '')),
  );
}

/** The font files a set of stylesheets declares, split into base subsets and conditional ones. */
function fontsOf(stylesheets) {
  const base = new Set();
  const conditional = new Set();
  for (const sheet of stylesheets) {
    let css;
    try {
      css = readFileSync(sheet, 'utf8');
    } catch {
      continue;
    }
    for (const match of css.matchAll(/url\(([^)]+?\.woff2)\)/g)) {
      const url = (match[1] ?? '').replace(/^["']|["']$/g, '');
      const file = join(OUT, url.replace(/^\//, ''));
      (url.includes('-latin-ext') ? conditional : base).add(file);
    }
  }
  return { base: [...base], conditional: [...conditional] };
}

const fileBytes = (file) => {
  try {
    return statSync(file).size;
  } catch {
    failures.push(`${relative(OUT, file)} is referenced by a page and not in the export`);
    return 0;
  }
};
const sum = (files, weigh) => files.reduce((total, file) => total + weigh(file), 0);

const landing = documentAt('/');
const catalogue = documentAt('/games/');
const landingSheets = stylesheetsOf(landing.html);
const catalogueSheets = stylesheetsOf(catalogue.html);
const landingFonts = fontsOf(landingSheets);
const catalogueFonts = fontsOf(catalogueSheets);

// The controls, before any total is believed. A stylesheet parse that stopped matching would
// count zero fonts and zero CSS, and the totals below would read as a saving.
if (landingSheets.length === 0)
  failures.push('the landing page links no stylesheet — the parse has stopped matching');
if (landingFonts.base.length === 0)
  failures.push(
    'no font file is declared by the landing stylesheets — the parse has stopped matching',
  );
if (gzipped(catalogue.file) < 10_000 && catalogue.html !== '') {
  failures.push(
    'the catalogue document is under 10 KB gzipped — the grid has stopped rendering into it',
  );
}

const landingDocument = landing.html === '' ? 0 : gzipped(landing.file);
const catalogueDocument = catalogue.html === '' ? 0 : gzipped(catalogue.file);
const landingCss = sum(landingSheets, gzipped);
const catalogueCss = sum(catalogueSheets, gzipped);
const landingFontBytes = sum(landingFonts.base, fileBytes);
const catalogueFontBytes = sum(catalogueFonts.base, fileBytes);

/** Arrive, pick a game, play it: the landing page, then one play route and its game. */
const firstSessionBytes =
  landingDocument +
  landingCss +
  landingFontBytes +
  shellBytes +
  onDemandBytes +
  biggestGame +
  workerBytes;
/** Arrive at the catalogue and scroll to the end of it, pressing nothing. */
const browsingSessionBytes =
  catalogueDocument +
  catalogueCss +
  catalogueFontBytes +
  shellBytes +
  speculatedBytes +
  workerBytes;
/** What the grid costs to be on screen at all, before the first card comes near the viewport. */
const catalogueBytes = catalogueDocument + catalogueCss + catalogueFontBytes + shellBytes;

console.log(
  `check-size: first session (arrive, pick a game, play it) ${kb(firstSessionBytes)} =` +
    ` document ${kb(landingDocument)} + css ${kb(landingCss)} + fonts ${kb(landingFontBytes)}` +
    ` + shell ${kb(shellBytes)} + on demand ${kb(onDemandBytes)} + largest game ${kb(biggestGame)}` +
    ` + worker ${kb(workerBytes)}`,
);
console.log(
  `check-size: browsing session (scroll the whole catalogue) ${kb(browsingSessionBytes)} =` +
    ` document ${kb(catalogueDocument)} + css ${kb(catalogueCss)} + fonts ${kb(catalogueFontBytes)}` +
    ` + shell ${kb(shellBytes)} + speculated ${kb(speculatedBytes)} + worker ${kb(workerBytes)}`,
);
console.log(
  `check-size: catalogue on screen (before any prefetch) ${kb(catalogueBytes)};` +
    ` ${String(landingFonts.conditional.length)} latin-ext face(s) fetched only for a glyph in that range,` +
    ` ${kb(sum(landingFonts.conditional, fileBytes))} not counted`,
);

// Nothing may fall between the buckets. A chunk this script cannot place is a chunk it is
// not measuring, and the whole point of #2516 is that an unmeasured chunk is where the
// bytes go to hide.
const unclassified = files.filter(
  (file) =>
    !shellEager.has(file) &&
    !legacyPolyfills.has(file) &&
    !onDemand.has(file) &&
    !gameChunkFiles.has(file) &&
    !neverFetched.has(file) &&
    !workerFiles.includes(file),
);
if (unclassified.length > 0) {
  failures.push(
    `cannot account for ${String(unclassified.length)} chunk(s), so the budget means nothing: ` +
      unclassified.map((file) => relative(OUT, file)).join(', '),
  );
}

if (shellBytes > BUDGET.shellBytes) {
  failures.push(`the shell is ${kb(shellBytes)}, over the ${kb(BUDGET.shellBytes)} budget`);
}
if (legacyPolyfillBytes > BUDGET.legacyPolyfillBytes) {
  failures.push(
    `the legacy polyfills are ${kb(legacyPolyfillBytes)}, over the` +
      ` ${kb(BUDGET.legacyPolyfillBytes)} budget — nobody supported fetches them, but this` +
      " file is the framework's and a version that doubles it should be argued about",
  );
}
if (onDemandBytes > BUDGET.onDemandBytes) {
  failures.push(
    `on-demand code is ${kb(onDemandBytes)}, over the ${kb(BUDGET.onDemandBytes)} budget`,
  );
}
// A floor as well as a ceiling. Every card in the grid links a play route, so a build that
// suddenly speculates far less has stopped exporting payloads rather than got thriftier —
// and this number would then read as a win while `e2e/prefetch.spec.ts`'s count of what a
// browse fetches went to nothing.
if (payloads.length === 0) {
  failures.push('no route payloads at all — the export has stopped writing index.txt files');
}
if (speculatedBytes > BUDGET.speculatedBytes) {
  failures.push(
    `browsing the catalogue speculates ${kb(speculatedBytes)} of route payloads, over the` +
      ` ${kb(BUDGET.speculatedBytes)} budget`,
  );
}

// A budget that is not in the file is not a budget: `x > undefined` is false, so a missing
// key would pass every build in silence. Named rather than defaulted.
for (const key of ['firstSessionBytes', 'browsingSessionBytes', 'catalogueBytes']) {
  if (typeof BUDGET[key] !== 'number') failures.push(`size-budget.json has no ${key}`);
}
if (firstSessionBytes > BUDGET.firstSessionBytes) {
  failures.push(
    `a first session is ${kb(firstSessionBytes)}, over the ${kb(BUDGET.firstSessionBytes)} budget`,
  );
}
if (browsingSessionBytes > BUDGET.browsingSessionBytes) {
  failures.push(
    `a browsing session is ${kb(browsingSessionBytes)}, over the` +
      ` ${kb(BUDGET.browsingSessionBytes)} budget`,
  );
}
if (catalogueBytes > BUDGET.catalogueBytes) {
  failures.push(
    `the catalogue costs ${kb(catalogueBytes)} to put on screen, over the` +
      ` ${kb(BUDGET.catalogueBytes)} budget`,
  );
}

if (failures.length > 0) {
  console.error('\ncheck-size: over budget\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nRaise the number in size-budget.json only with a reason worth the bytes.');
  process.exit(1);
}
console.log('check-size: within budget');
