#!/usr/bin/env node
/**
 * Wire an already-scaffolded game into the four places the shell reads.
 *
 *   node scripts/register-game.mjs <id>
 *
 * `create-game` ends by printing four manual steps, and every one of them is the kind
 * that fails silently: a game missing from `registry.ts` is simply not playable, and one
 * missing from `controls.ts` loses its keyboard legend without erroring. Doing them by
 * hand thirty-two times was survivable; doing it seventy-five more is not.
 *
 * Idempotent — running it twice changes nothing, so it is safe to re-run after a rebase.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  process.stderr.write(`register-game: ${message}\n`);
  process.exit(1);
}

const id = process.argv[2];
if (!id) fail('usage: node scripts/register-game.mjs <id>');
if (!existsSync(join(ROOT, 'packages', 'games', id)))
  fail(`packages/games/${id} does not exist — run \`pnpm create-game ${id}\` first`);

/** `four-in-a-row` → `fourInARow`, which is what the manifest imports are named. */
const camel = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/** A key only needs quoting when it is not a plain identifier. Prettier strips the rest. */
const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id) ? id : `'${id}'`;

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');
const write = (relative, contents) => writeFileSync(join(ROOT, relative), contents);

const changed = [];

// 1. tsconfig.json project reference, so `tsc --build` builds it.
{
  const path = 'tsconfig.json';
  const config = JSON.parse(read(path));
  const reference = `./packages/games/${id}`;
  if (!config.references.some((entry) => entry.path === reference)) {
    config.references.push({ path: reference });
    write(path, JSON.stringify(config, null, 2) + '\n');
    changed.push(path);
  }
}

// 2. The web app's dependency, so the workspace link exists.
{
  const path = 'apps/web/package.json';
  const pkg = JSON.parse(read(path));
  const name = `@duelbox/game-${id}`;
  if (!(name in pkg.dependencies)) {
    pkg.dependencies = Object.fromEntries(
      Object.entries({ ...pkg.dependencies, [name]: 'workspace:*' }).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
    write(path, JSON.stringify(pkg, null, 2) + '\n');
    changed.push(path);
  }
}

// 3. The lazy loader, which is what makes the game playable at all.
{
  const path = 'apps/web/src/data/registry.ts';
  let source = read(path);
  if (!source.includes(`@duelbox/game-${id}'`)) {
    const line = `  ${key}: () => import('@duelbox/game-${id}').then((m) => m.default),\n`;
    const marker = '\n};\n\n/**\n * The loader table';
    if (!source.includes(marker)) fail(`could not find the end of LOADERS in ${path}`);
    source = source.replace(marker, `\n${line}};\n\n/**\n * The loader table`);
    write(path, source);
    changed.push(path);
  }
}

// 4. The manifest list the landing page reads for controls.
{
  const path = 'apps/web/src/data/controls.ts';
  let source = read(path);
  if (!source.includes(`@duelbox/game-${id}'`)) {
    const importLine = `import { manifest as ${camel} } from '@duelbox/game-${id}';\n`;
    const anchor = "import type { GameManifest } from '@duelbox/game-sdk';";
    if (!source.includes(anchor)) fail(`could not find the type import in ${path}`);
    source = source.replace(anchor, importLine + anchor);

    const listStart = 'export const MANIFESTS: readonly GameManifest[] = [\n';
    const listEnd = source.indexOf('];', source.indexOf(listStart));
    if (listEnd < 0) fail(`could not find the MANIFESTS array in ${path}`);
    const head = source.slice(0, listStart.length + source.indexOf(listStart));
    const body = source.slice(head.length, listEnd);
    const entries = body
      .split('\n')
      .map((entry) => entry.trim().replace(/,$/, ''))
      .filter(Boolean);
    entries.push(camel);
    entries.sort((a, b) => a.localeCompare(b));
    source = head + entries.map((entry) => `  ${entry},\n`).join('') + source.slice(listEnd);
    write(path, source);
    changed.push(path);
  }
}

process.stdout.write(
  changed.length === 0
    ? `register-game: ${id} was already registered everywhere\n`
    : `register-game: ${id} added to ${changed.join(', ')}\n` +
        'Next: pnpm install && pnpm format && pnpm typecheck && pnpm test\n',
);
