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
    (slug) => source.includes(`"${slug}"`) || source.includes(`'${slug}'`),
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
const shellBytes = files
  .filter((file) => !gameChunkFiles.has(file))
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

if (failures.length > 0) {
  console.error('\ncheck-size: over budget\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('\nRaise the number in size-budget.json only with a reason worth the bytes.');
  process.exit(1);
}
console.log('check-size: within budget');
