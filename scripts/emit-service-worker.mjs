#!/usr/bin/env node
/**
 * Give the service worker its precache list and its revision, and refuse to ship one that
 * cannot work.
 *
 * ## Why this is a build step
 *
 * Every build asset is content-hashed — `_next/static/chunks/main-app-7b3ade607f7a3637.js`
 * — so the list of things worth precaching is different after every change and cannot be
 * written by hand in `apps/web/public/sw.js`. The alternatives are worse: a worker that
 * discovers its own manifest at runtime has to fetch and parse HTML to do it, and one that
 * precaches nothing cannot serve a cold start, which is the entire point.
 *
 * ## What goes in the list, and what deliberately does not
 *
 * **In:** every emitted build asset that is not one game's own chunk, plus the six routes
 * that exist whatever games ship. That set is exactly `check-size.mjs`'s definition of the
 * shell — the bytes every visitor pays before choosing anything — so the promise the
 * precache makes is "the site works offline", stated in the same units the budget is.
 *
 * **Out:** the 108 game chunks and the 214 per-game pages. Precaching them is several
 * megabytes to make offline a game this player has never opened, and this repository does
 * not do that to somebody's data allowance. They are cached on play. `docs/pwa.md` has the
 * argument in full.
 *
 * ## The revision, and why it is a digest of contents rather than a version number
 *
 * The browser re-fetches `sw.js` on navigation and byte-compares it; a difference is the
 * only thing that starts an update. So the file has to differ whenever anything it serves
 * differs — including a change to a page's *text*, which changes no filename at all because
 * HTML is not content-hashed. A digest over the bytes of everything precached catches that;
 * a hand-maintained version number catches it only when somebody remembers, and the failure
 * mode is a site that can never be fixed for the people who already have it.
 *
 * ## The checks
 *
 * All four exist because each describes a way to ship a worker that looks installed and is
 * not: the file never copied, a placeholder never replaced, an empty precache list, or a
 * registration nobody put in the pages. Every one of them was watched failing on purpose
 * before this was called done.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The routes that exist whatever games ship, precached as documents.
 *
 * `/offline/` is here because it is what a navigation falls back to; a fallback page that
 * is itself only available online would be a joke played on somebody with no signal.
 */
const SHELL_ROUTES = ['/', '/games/', '/how-to-play/', '/privacy/', '/terms/', '/offline/'];

/** Copied verbatim from `apps/web/public/`, so they are named rather than discovered. */
const PUBLIC_ASSETS = [
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

/** How `service-worker-client.ts` is recognised in an emitted page. See the check below. */
const REGISTRATION_MARKER = 'serviceWorker.register(';

const failures = [];

async function walk(dir, found = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, found);
    else found.push(path);
  }
  return found;
}

/** `out/_next/static/chunks/x.js` becomes `<base>/_next/static/chunks/x.js`. */
function urlOf(file) {
  return base + file.slice(out.length).split(sep).join('/');
}

/**
 * Which chunks belong to one game, by the same rule `check-size.mjs` uses: a chunk carries
 * a game's manifest id, `id:"ping-pong"`, and names no other game's.
 *
 * Deliberately the same rule and deliberately not shared code — one is a budget and one is
 * a cache, and they should be able to disagree about a chunk without one silently changing
 * the other. What they must not do is drift, which is why the rule is stated here in full
 * rather than referred to.
 */
async function gameChunkFiles(files) {
  const registry = await readFile(join(root, 'apps', 'web', 'src', 'data', 'registry.ts'), 'utf8');
  const playable = [...registry.matchAll(/import\('@duelbox\/game-([a-z0-9-]+)'\)/g)].map(
    (match) => match[1],
  );
  const chunks = new Set();
  for (const file of files) {
    if (!file.endsWith('.js') || file.includes(`${sep}app${sep}`)) continue;
    const source = await readFile(file, 'utf8');
    const named = playable.filter(
      (slug) => source.includes(`id:"${slug}"`) || source.includes(`id:'${slug}'`),
    );
    if (named.length === 1) chunks.add(file);
  }
  return chunks;
}

/**
 * What is left at the top of the emitted file, for whoever opens it in devtools.
 */
const BANNER = `/* DuelBox service worker. Generated by scripts/emit-service-worker.mjs from
   apps/web/public/sw.js — edit that, not this. Why it does what it does: docs/pwa.md. */
`;

/**
 * Ship the code and leave the reasoning in the source.
 *
 * This file is downloaded by every visitor, and this repository writes long comments on
 * purpose — the worker's own explanation of why HTML is cache-first and why 108 game chunks
 * are not precached runs to two thirds of the file. That belongs in `apps/web/public/sw.js`,
 * where it costs nothing and where the next person will actually look for it, not on the
 * wire. Stripped, the worker is a little over half the size and the same program.
 *
 * Only comments that *start a line* are removed, which is the conservative version: a `/*`
 * or `//` inside a string literal is never at the start of a line in this file, so no regex
 * has to understand JavaScript to be right about it. If that ever stops being true the
 * worker breaks loudly and `e2e/offline.spec.ts` says so on the next run — which is the
 * failure mode to want from a transformation like this.
 */
function stripComments(source) {
  return source
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/\n/gm, '')
    .replace(/^[ \t]*\/\/.*\n/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

async function main() {
  const files = await walk(out);
  if (files.length === 0) {
    console.error('emit-service-worker: apps/web/out is missing — run `pnpm build` first.');
    process.exitCode = 1;
    return;
  }

  const workerPath = join(out, 'sw.js');
  let worker;
  try {
    worker = await readFile(workerPath, 'utf8');
  } catch {
    console.error(
      'emit-service-worker: apps/web/out/sw.js is missing. It is copied verbatim from\n' +
        'apps/web/public/sw.js — either that file has gone or the export did not copy public/.',
    );
    process.exitCode = 1;
    return;
  }

  const games = await gameChunkFiles(files);
  const buildAssets = files
    .filter((file) => file.includes(`${sep}_next${sep}static${sep}`) && !games.has(file))
    .map(urlOf);

  const documents = [];
  for (const route of SHELL_ROUTES) {
    const dir = join(out, ...route.split('/').filter(Boolean));
    const page = join(dir, 'index.html');
    if (!files.includes(page)) {
      failures.push(`the shell route ${route} has no index.html in the export`);
      continue;
    }
    documents.push(base + route);
    // The router fetches this instead of the HTML when navigating client-side, and without
    // it an offline navigation between two precached pages still hits the network.
    const payload = join(dir, 'index.txt');
    if (files.includes(payload)) documents.push(`${base}${route}index.txt`);
  }

  const extras = PUBLIC_ASSETS.filter((asset) =>
    files.includes(join(out, ...asset.split('/').filter(Boolean))),
  ).map((asset) => base + asset);
  for (const asset of PUBLIC_ASSETS) {
    if (!extras.includes(base + asset)) failures.push(`${asset} is not in the export`);
  }

  const precache = [...new Set([...documents, ...extras, ...buildAssets])].sort();
  if (precache.length === 0) failures.push('the precache list came out empty');

  // The digest covers *contents*, not names, so a change to a page's text — which changes no
  // filename, because HTML is not content-hashed — still produces a new worker.
  const digest = createHash('sha256');
  let precacheBytes = 0;
  for (const url of precache) {
    const path = join(out, ...url.slice(base.length).split('/').filter(Boolean));
    const body = await readFile(url.endsWith('/') ? join(path, 'index.html') : path);
    precacheBytes += body.length;
    digest.update(url).update(createHash('sha256').update(body).digest());
  }
  const revision = digest.digest('hex').slice(0, 16);

  const filled = stripComments(worker)
    .replace('__DUELBOX_REVISION__', revision)
    .replace('__DUELBOX_BASE__', base)
    .replace("'__DUELBOX_PRECACHE__'", precache.map((url) => JSON.stringify(url)).join(',\n  '));

  if (filled.includes('__DUELBOX_')) {
    failures.push(
      'a __DUELBOX_ placeholder survived the substitution — apps/web/public/sw.js and this ' +
        'script disagree about what is injected, and the worker would ship inert',
    );
  }

  // A worker nobody registers is a worker nobody has, and it would fail silently and
  // completely: every check above would pass and no visitor would ever get an offline site.
  const pages = files.filter((file) => file.endsWith('.html'));
  const unregistered = [];
  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    if (!html.includes(REGISTRATION_MARKER)) unregistered.push(page.slice(out.length));
  }
  if (unregistered.length > 0) {
    failures.push(
      `${String(unregistered.length)} of ${String(pages.length)} page(s) do not register the ` +
        `service worker — first: ${unregistered[0] ?? '?'}`,
    );
  }

  if (failures.length > 0) {
    console.error(`emit-service-worker: ${String(failures.length)} problem(s)\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }

  await writeFile(workerPath, BANNER + filled);

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(
    `emit-service-worker: revision ${revision}, ` +
      `${String(precache.length)} precached URL(s) (${kb(precacheBytes)} uncompressed): ` +
      `${String(documents.length)} document(s), ${String(extras.length)} public asset(s), ` +
      `${String(buildAssets.length)} build asset(s)`,
  );
  console.log(
    `emit-service-worker: ${String(games.size)} game chunk(s) deliberately left out — ` +
      'they are cached on play, not downloaded up front',
  );
}

await main();
