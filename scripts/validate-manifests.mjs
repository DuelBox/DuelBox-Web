#!/usr/bin/env node
/**
 * Validate every game manifest at build time.
 *
 * `parseGameManifest` is a runtime Zod parse. It only runs when a game module is
 * imported, and the web app imports games dynamically in the browser — so `pnpm build`
 * validated nothing. `tsc --build` executes no code, and `parseGameManifest` takes
 * `unknown`, so a manifest missing `logical` type-checked cleanly. Today the parse
 * happens at all only because seven test files happen to import their own manifest,
 * and `create-game.mjs` scaffolds no such test: a newly added game's manifest would
 * never have been parsed in CI.
 *
 * This walks the packages directly rather than the registry, so a game that exists but
 * is not yet wired into the shell is still checked.
 */

import { readdir, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const gamesDir = join(root, 'packages', 'games');

/** Simulation runs in these units and the renderer scales them; a silly box is a bug. */
const MIN_LOGICAL = 100;
const MAX_LOGICAL = 10_000;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { parseGameManifest } = await import(
    pathToFileURL(join(root, 'packages', 'game-sdk', 'dist', 'index.js')).href
  );

  const entries = await readdir(gamesDir, { withFileTypes: true });
  const packages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  if (packages.length === 0) {
    console.error('validate-manifests: no game packages found — is this the right repo?');
    process.exitCode = 1;
    return;
  }

  const failures = [];
  let checked = 0;

  for (const name of packages) {
    const distManifest = join(gamesDir, name, 'dist', 'manifest.js');
    if (!(await exists(distManifest))) {
      failures.push(`${name}: no built manifest at dist/manifest.js — run \`pnpm build\` first`);
      continue;
    }

    let manifest;
    try {
      ({ manifest } = await import(pathToFileURL(distManifest).href));
    } catch (error) {
      failures.push(`${name}: manifest module failed to load — ${String(error)}`);
      continue;
    }

    if (manifest === undefined) {
      failures.push(`${name}: dist/manifest.js has no \`manifest\` export`);
      continue;
    }

    let parsed;
    try {
      parsed = parseGameManifest(manifest);
    } catch (error) {
      failures.push(`${name}: ${String(error).replace(/\s+/g, ' ').slice(0, 400)}`);
      continue;
    }

    // The schema already requires a positive integer box. These are the extra facts a
    // schema cannot express: that the numbers are sane, and that the declared id
    // matches the directory it lives in, so a copy-pasted manifest cannot go unnoticed.
    const { width, height } = parsed.logical;
    for (const [axis, value] of [
      ['width', width],
      ['height', height],
    ]) {
      if (value < MIN_LOGICAL || value > MAX_LOGICAL) {
        failures.push(
          `${name}: logical.${axis} is ${String(value)}, outside ${String(MIN_LOGICAL)}..${String(MAX_LOGICAL)}`,
        );
      }
    }

    if (parsed.id !== name) {
      failures.push(
        `${name}: manifest id is "${parsed.id}" but the package directory is "${name}"`,
      );
    }

    checked += 1;
  }

  if (failures.length > 0) {
    console.error(`validate-manifests: ${String(failures.length)} problem(s)\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`validate-manifests: ${String(checked)} game manifest(s) valid`);
}

await main();
