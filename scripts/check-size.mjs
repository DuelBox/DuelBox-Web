#!/usr/bin/env node
/**
 * The size budget rule 11 talks about, and the `pnpm size` the README has always
 * promised. Neither existed: the command resolved to the system `size(1)`, which
 * cheerfully reported on a non-existent `a.out` and exited without complaint.
 *
 * Three numbers matter to a player, and they are not the same number:
 *
 *   - **The shell** — everything the browser must have before anyone can pick a game.
 *     Every visitor pays it once.
 *   - **On demand** — the play route's own chunks, plus anything pulled by an
 *     `import()`. Nobody downloads it by arriving; you pay it when you commit.
 *   - **A game** — the marginal chunk for the one game they chose. One chunk per game is
 *     the whole point of the layout, and it is worth failing a build that quietly
 *     collapses that into the shell.
 *
 * Gzipped, because that is what crosses the wire.
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
import { join, relative } from 'node:path';
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
const isPostChoiceRoute = (route) => route.startsWith('/play/');

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
const alwaysEager = [...buildManifest.polyfillFiles, ...buildManifest.rootMainFiles];
const shellEager = new Set();
const postChoiceEager = new Set();
for (const [route, scripts] of Object.entries(appManifest.pages)) {
  const target = isPostChoiceRoute(route) ? postChoiceEager : shellEager;
  for (const script of [...scripts, ...alwaysEager]) {
    if (script.endsWith('.js')) target.add(onDisk(script));
  }
}
for (const file of shellEager) postChoiceEager.delete(file);

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
const biggestGame = Math.max(0, ...[...gameChunkFiles].map((file) => sizes.get(file) ?? 0));

console.log(
  `check-size: ${String(files.length)} shipped script(s), ${kb(totalJs)} gzipped in total`,
);
console.log(`check-size: shell (paid by every visitor) ${kb(shellBytes)}`);
console.log(`check-size: on demand (paid on choosing a game) ${kb(onDemandBytes)}`);
console.log(
  `check-size: worst case for one player ${kb(shellBytes + onDemandBytes + biggestGame)}` +
    ` = shell + on demand + the largest game`,
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

// Nothing may fall between the buckets. A chunk this script cannot place is a chunk it is
// not measuring, and the whole point of #2516 is that an unmeasured chunk is where the
// bytes go to hide.
const unclassified = files.filter(
  (file) =>
    !shellEager.has(file) &&
    !onDemand.has(file) &&
    !gameChunkFiles.has(file) &&
    !neverFetched.has(file),
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
if (onDemandBytes > BUDGET.onDemandBytes) {
  failures.push(
    `on-demand code is ${kb(onDemandBytes)}, over the ${kb(BUDGET.onDemandBytes)} budget`,
  );
}

if (failures.length > 0) {
  console.error('\ncheck-size: over budget\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nRaise the number in size-budget.json only with a reason worth the bytes.');
  process.exit(1);
}
console.log('check-size: within budget');
