#!/usr/bin/env node
/**
 * The size budget rule 11 talks about, and the `pnpm size` the README has always
 * promised. Neither existed: the command resolved to the system `size(1)`, which
 * cheerfully reported on a non-existent `a.out` and exited without complaint.
 *
 * Two numbers matter to a player, and they are not the same number:
 *
 *   - **The shell** — everything the browser must have before anyone can pick a game.
 *     Every visitor pays it once.
 *   - **A game** — the marginal chunk for the one game they chose. One chunk per game is
 *     the whole point of the layout, and it is worth failing a build that quietly
 *     collapses that into the shell.
 *
 * Gzipped, because that is what crosses the wire.
 */
/**
 * ## Notes for whoever is next over the shell budget
 *
 * Three things were learned the expensive way on 29 August 2026, while getting the audio
 * subsystem's 4.1 KB back under the line. Two are techniques that work and one is a trap.
 *
 * ### The trap: `"sideEffects": false`
 *
 * Adding it to `@duelbox/engine` and `@duelbox/game-sdk` is an *accurate* declaration —
 * neither package has a top-level statement outside a declaration, so nothing is lost by
 * dropping an unused module — and it appears to save 0.9 KB of shell. **It makes players
 * worse off.** Measured:
 *
 * | | shell | total | tic-tac-toe | sudoku | solitaire |
 * |---|---|---|---|---|---|
 * | without | 280.0 KB | 759.7 KB | 2.9 KB | 6.2 KB | 6.0 KB |
 * | with | 279.1 KB | 874.1 KB | 4.8 KB | 8.2 KB | 8.0 KB |
 *
 * It moves engine code out of the shared chunk and inlines a copy into each of the 108
 * game chunks. A player downloads shell + one game, so they pay about 1 KB more while the
 * budgeted number improves. Watch the **total** as well as the shell: a change that moves
 * the shell down and the total up by a hundred kilobytes has not saved anything.
 *
 * ### A frozen table ships its prose to every visitor
 *
 * `Object.freeze` is a call, so no bundler can prove the statement droppable, so a
 * `const TABLE = Object.freeze({...})` ships **even when nothing imports it**. A
 * documentation table read only by tests — ten cues with a sentence of English each — was
 * costing 600 bytes that way. `/*#__PURE__*\/ Object.freeze({...})` fixes it and is
 * understood by webpack, Rollup, esbuild and SWC alike. Worth grepping for; it recurs.
 *
 * ### A client component that derives a value from a build-time table ships the table
 *
 * `PlaySurface` looked up one display name from `GAME_NAMES` and so carried all 108 of
 * them, 1.4 KB, into every visitor's bundle. The play route is statically exported per
 * slug and the lookup depended on nothing else, so the server already had the answer.
 * `game-names.generated.ts` records the same mistake one level out, with `CATALOGUE`.
 * The fix is always the same: compute it on the server, pass the answer as a prop.
 *
 * ### And one thing that looks obvious and is not
 *
 * `apps/web/src/data/controls.ts` imports the whole 43.9 KB catalogue to build an id→slug
 * map. It costs nothing: its only consumer is `app/games/[slug]/page.tsx`, a server
 * component, whose client chunk is 510 bytes. Measure the built chunk before you refactor
 * anything — several candidates here look wasteful in the source and ship no bytes at all.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'apps/web/out');
const BUDGET = JSON.parse(readFileSync(join(ROOT, 'size-budget.json'), 'utf8'));

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

// Which chunks belong to a single game? A game's own chunk is the one that names it and
// names no other game — a chunk naming several has stopped being one-chunk-per-game.
// From the dynamic-import specifiers, not the object keys: five of the keys in the
// registry are unquoted (`reversi:` rather than `'reversi':`), so reading keys with a
// regex silently found eighteen of the twenty-three games and reported success.
//
// And a chunk *names* a game by carrying its manifest id, `id:"ping-pong"`, not by
// containing the word anywhere. That distinction cost a build: the id `match` appears as a
// bare substring in eleven chunks — `String.prototype.match` is in most bundles — so a
// 38.5 KB shared chunk was attributed to a 3 KB game, failed the budget, and took 35 KB
// off the shell's number at the same time. Exactly one chunk carries `id:"match"`.
const registry = readFileSync(join(ROOT, 'apps/web/src/data/registry.ts'), 'utf8');
const playable = [...registry.matchAll(/import\('@duelbox\/game-([a-z0-9-]+)'\)/g)]
  .map((match) => match[1])
  .filter((slug, index, all) => all.indexOf(slug) === index);

const sizes = new Map(files.map((file) => [file, gzipped(file)]));
const totalJs = [...sizes.values()].reduce((sum, size) => sum + size, 0);

const gameChunks = new Map();
for (const file of files) {
  if (file.includes(`${'app'}/`)) continue; // route shells, not game chunks
  const source = readFileSync(file, 'utf8');
  const named = playable.filter(
    (slug) => source.includes(`id:"${slug}"`) || source.includes(`id:'${slug}'`),
  );
  if (named.length === 1) gameChunks.set(named[0], file);
}

const failures = [];
const report = [];

for (const [slug, file] of [...gameChunks].sort()) {
  const size = sizes.get(file) ?? 0;
  report.push(`  ${slug.padEnd(22)} ${kb(size).padStart(9)}  ${relative(OUT, file)}`);
  if (size > BUDGET.gameChunkBytes) {
    failures.push(`${slug} is ${kb(size)}, over the ${kb(BUDGET.gameChunkBytes)} game budget`);
  }
}

// What every visitor pays: everything shipped that is not one game's own chunk. Budget
// this rather than the total across all chunks — the total grows with every game added
// and nobody ever downloads more than one of them, so it would punish the wrong thing.
const gameChunkFiles = new Set(gameChunks.values());

// The service worker is measured on its own line. It is not part of "what a visitor must
// have before they can choose a game": it is registered on `load`, fetched off the critical
// path by a browser that is already showing the page, and on the visit after this one it is
// the reason the shell costs nothing at all. Adding it to the number it exists to reduce
// would be arithmetic that punishes the fix. It is still budgeted — see size-budget.json —
// because a worker that quietly grows into a framework is exactly the drift this file is
// for, and because a missing file must fail rather than score zero.
const workerFile = join(OUT, 'sw.js');
const workerBytes = files.includes(workerFile) ? (sizes.get(workerFile) ?? 0) : null;

const shellBytes = files
  .filter((file) => !gameChunkFiles.has(file) && file !== workerFile)
  .reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0);

console.log(
  `check-size: ${String(files.length)} shipped script(s), ${kb(totalJs)} gzipped in total`,
);
console.log(`check-size: shell (paid by every visitor) ${kb(shellBytes)}`);
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

if (shellBytes > BUDGET.shellBytes) {
  failures.push(`the shell is ${kb(shellBytes)}, over the ${kb(BUDGET.shellBytes)} budget`);
}

if (workerBytes === null) {
  failures.push(
    'apps/web/out/sw.js is missing — the site claims to be offline-capable in CLAUDE.md, in ' +
      'ADR 0002 and on the privacy page, and without this file that claim is false the moment ' +
      'a tab is closed',
  );
} else {
  console.log(
    `check-size: service worker ${kb(workerBytes)} (budget ${kb(BUDGET.serviceWorkerBytes)})`,
  );
  if (workerBytes > BUDGET.serviceWorkerBytes) {
    failures.push(
      `sw.js is ${kb(workerBytes)}, over the ${kb(BUDGET.serviceWorkerBytes)} service-worker budget`,
    );
  }
}

if (failures.length > 0) {
  console.error('\ncheck-size: over budget\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nRaise the number in size-budget.json only with a reason worth the bytes.');
  process.exit(1);
}
console.log('check-size: within budget');
