#!/usr/bin/env node
/**
 * Guard the properties that make this site nearly free to host.
 *
 * They decay quietly. One convenient server call added during a busy week turns a free
 * site into a metered one, and nobody notices until the invoice — by which time the call
 * is load-bearing and removing it is a project rather than a revert.
 *
 * Every check below names the property it protects, so a failure explains itself to
 * whoever hits it rather than sending them to read this file.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');

/**
 * What one player may download to open a game and play it.
 *
 * Generous on purpose — it is a ratchet against drift, not a target to optimise toward.
 * Tightening it is a deliberate act; sliding past it silently is what this prevents.
 */
const SESSION_BUDGET_KB = 700;

/** Anything that would put gameplay behind a round trip. */
const NETWORK_CLIENTS = [
  'axios',
  'node-fetch',
  'superagent',
  'ky',
  'got',
  'socket.io-client',
  'graphql-request',
  '@tanstack/react-query',
  'swr',
];

const failures = [];

function fail(property, detail) {
  failures.push({ property, detail });
}

async function walk(dir, predicate, found = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, predicate, found);
    else if (predicate(path)) found.push(path);
  }
  return found;
}

/** The build is a directory of files, not a program. */
async function checkNoServerRuntime() {
  const property = 'The deployed output is files, not a server';
  // Only the *deployed* directory is checked. `.next/` is Next's intermediate build
  // output and always contains a `server/` folder even for a pure static export; it is
  // never uploaded, so treating its presence as a violation would be a false alarm.
  const forbidden = [
    ['out/api', 'an API route directory'],
    ['out/_next/server', 'a server-render bundle'],
  ];
  for (const [relative, what] of forbidden) {
    const path = join(root, 'apps', 'web', relative);
    try {
      await stat(path);
      fail(property, `${relative} exists — the build produced ${what}`);
    } catch {
      // Absent, which is the point.
    }
  }

  // A Next static export always writes these; their absence means the export did not run.
  try {
    await stat(join(out, 'index.html'));
  } catch {
    fail(
      property,
      'apps/web/out/index.html is missing — did `next build` run with output: export?',
    );
  }
}

/** A route that needs request-time work fails the build rather than adding a per-request cost. */
async function checkNoDynamicRoutes() {
  const property = 'No route opts into request-time rendering';
  const sources = await walk(join(root, 'apps', 'web', 'src'), (p) =>
    ['.ts', '.tsx'].includes(extname(p)),
  );
  for (const path of sources) {
    const text = await readFile(path, 'utf8');
    const relative = path.slice(root.length + 1);
    // `force-dynamic` and a zero revalidate both mean "render me on every request".
    if (/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(text)) {
      fail(property, `${relative} sets dynamic = 'force-dynamic'`);
    }
    if (/export\s+const\s+revalidate\s*=\s*0\b/.test(text)) {
      fail(property, `${relative} sets revalidate = 0`);
    }
    if (/export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(text)) {
      fail(property, `${relative} opts into the edge runtime, which bills per request`);
    }
  }

  const config = await readFile(join(root, 'apps', 'web', 'next.config.ts'), 'utf8');
  // Comments stripped first: the config explains at length *why* it exports statically,
  // so a search of the raw text finds the setting in the prose and passes even when the
  // setting itself has been commented out.
  const configCode = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (!/output:\s*'export'/.test(configCode)) {
    fail(property, "next.config.ts no longer sets output: 'export' — the site would need a server");
  }
}

/** Gameplay runs on the player's device, so gameplay code has no reason to reach the network. */
async function checkNoNetworkInGameplay() {
  const property = 'Gameplay never touches the network';
  const dirs = [
    join(root, 'packages', 'engine', 'src'),
    join(root, 'packages', 'game-sdk', 'src'),
    join(root, 'packages', 'games'),
  ];
  for (const dir of dirs) {
    const sources = (await walk(dir, (p) => extname(p) === '.ts')).filter(
      (p) => !p.endsWith('.test.ts'),
    );
    for (const path of sources) {
      const text = await readFile(path, 'utf8');
      const relative = path.slice(root.length + 1);
      // Strip comments: this file's own prose mentions fetch, and so does documentation.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const pattern of [
        [/\bfetch\s*\(/, 'calls fetch()'],
        [/\bXMLHttpRequest\b/, 'uses XMLHttpRequest'],
        [/\bWebSocket\b/, 'opens a WebSocket'],
        [/\bnavigator\.sendBeacon\b/, 'calls sendBeacon'],
        [/\bEventSource\b/, 'opens an EventSource'],
      ]) {
        if (pattern[0].test(code)) fail(property, `${relative} ${pattern[1]}`);
      }
      for (const client of NETWORK_CLIENTS) {
        if (new RegExp(`from\\s+['"]${client.replace(/[/@-]/g, '\\$&')}`).test(code)) {
          fail(property, `${relative} imports ${client}`);
        }
      }
    }
  }
}

/** What one player downloads to open a game and play it. */
async function checkSessionBudget() {
  const property = 'A play session fits the byte budget';
  const scripts = await walk(join(out, '_next'), (p) => extname(p) === '.js');
  if (scripts.length === 0) {
    fail(property, 'no scripts found in apps/web/out/_next — run `pnpm build` first');
    return;
  }
  // Read the scripts a play page actually references, rather than summing every chunk
  // in the build — most of those belong to other routes and no one player downloads
  // them. This measures what one person pulls to open a game and play it.
  const html = await readFile(join(out, 'play', 'tic-tac-toe', 'index.html'), 'utf8');
  const referenced = new Set(
    [...html.matchAll(/\/_next\/static\/[^"']+?\.js/g)].map((match) =>
      decodeURIComponent(match[0]),
    ),
  );
  if (referenced.size === 0) {
    fail(property, 'the play page references no scripts — did the build succeed?');
    return;
  }
  let bytes = 0;
  for (const reference of referenced) {
    const path = join(out, reference.replace(/^\//, ''));
    try {
      bytes += (await stat(path)).size;
    } catch {
      fail(property, `the play page references ${reference}, which the build did not emit`);
    }
  }
  const totalKb = Math.round(bytes / 1024);
  if (totalKb > SESSION_BUDGET_KB) {
    fail(
      property,
      `a play session downloads ${String(totalKb)}kB, over the ${String(SESSION_BUDGET_KB)}kB budget`,
    );
  } else {
    console.log(`  session weight: ${String(totalKb)}kB of ${String(SESSION_BUDGET_KB)}kB budget`);
  }
}

/** Every game page is in the served HTML, not fetched by the client. */
async function checkPagesArePrerendered() {
  const property = 'Every game page is in view-source';
  const pages = await walk(join(out, 'games'), (p) => p.endsWith('index.html'));
  // 107 games plus the catalogue index itself.
  if (pages.length < 108) {
    fail(property, `only ${String(pages.length)} pre-rendered game pages found, expected 108`);
  } else {
    console.log(`  pre-rendered pages: ${String(pages.length)}`);
  }
}

console.log('check-zero-cost:');
await checkNoServerRuntime();
await checkNoDynamicRoutes();
await checkNoNetworkInGameplay();
await checkSessionBudget();
await checkPagesArePrerendered();

if (failures.length > 0) {
  console.error(`\ncheck-zero-cost: ${String(failures.length)} property violated\n`);
  for (const { property, detail } of failures) {
    console.error(`  ✗ ${property}`);
    console.error(`      ${detail}`);
  }
  console.error(
    '\nThese properties are what make the site nearly free to host. See epic:zero-cost.',
  );
  process.exitCode = 1;
} else {
  console.log('check-zero-cost: all properties hold');
}
