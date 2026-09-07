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

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve, extname, sep } from 'node:path';
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

/**
 * The one file allowed to call `fetch()`, and what it must prove in exchange.
 *
 * A service worker's whole job is to answer a `fetch` event, and it answers it by calling
 * `fetch`. So the rule above and the feature are in genuine conflict, and there are exactly
 * two ways to resolve it. One is to soften the pattern — drop `.js`, skip `public/`, allow
 * `fetch` where a comment says it is fine — and that is the worst available outcome: a
 * security guard widened to fit a feature stays wide for everything that comes after,
 * including the thing it was written to stop.
 *
 * The other is this. The exemption is one path, and it is not a free pass: it swaps the
 * blanket ban for three narrower properties that say *what kind* of network code is allowed,
 * and the build fails if the file stops satisfying them. The claim being protected is
 * `docs/adr/0002` property 4 and the privacy page's "no server that receives anything from
 * you" — a cache is compatible with both; a client is not.
 *
 * Each check was watched failing on purpose, by editing `sw.js` to break it and running the
 * build. A guard nobody has seen fail is a guard nobody has seen.
 */
const NETWORK_EXEMPT = new Map([
  [
    'apps/web/public/sw.js',
    (code, withLineComments) => {
      const problems = [];
      // 1. It must refuse to intercept anything cross-origin. Without this line the worker
      //    could observe, copy or rewrite a request to any other origin the page makes.
      if (!/url\.origin\s*!==\s*self\.location\.origin/.test(code)) {
        problems.push(
          'no longer bails out on a cross-origin request — a service worker that intercepts ' +
            'other origins is a client, and this one is only allowed to be a cache',
        );
      }
      // 2. It must name no remote host at all. Every URL it touches has to be one the page
      //    asked for, and a literal `https://…` in here is the shape of the thing this
      //    repository has no server for.
      //
      //    Read from the text with only *block* comments removed, not the fully stripped
      //    code. The caller's line-comment stripper is a regex, and `'https://example.com'`
      //    contains `//`: it turns the string into `'https:` and the check can never fire on
      //    the exact literal it exists to catch. Found by inserting one and watching this
      //    pass. Line comments are left in because the pattern needs a quote immediately
      //    before the scheme, so a bare URL in prose is not a match.
      const remote = /['"`]https?:\/\//.exec(withLineComments);
      if (remote !== null) {
        problems.push(`names a remote origin: ${remote[0]} — it may only serve this one`);
      }
      // 3. It must fetch only what it was handed. A `fetch` on a URL the worker composed
      //    itself, rather than on the event's own request or a member of the precache list,
      //    is a request the page never made.
      for (const call of code.matchAll(/\bfetch\s*\(([^)]*)\)/g)) {
        const argument = (call[1] ?? '').trim();
        if (!/^request$/.test(argument)) {
          problems.push(
            `calls fetch(${argument}) — the exemption covers answering the page's own ` +
              'request and nothing else',
          );
        }
      }
      return problems;
    },
  ],
]);

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
  // `docs/threat-model.md` requirement 5 and CLAUDE.md both say this is enforced, so it has
  // to actually be. Two gaps made that an over-claim:
  //
  //   - **`apps/web/src` was not scanned at all**, so the entire shell - the thing that
  //     loads and hosts every game - was outside a rule written about gameplay.
  //   - **`extname(p) === '.ts'` excludes every `.tsx` file**, which is every React
  //     component in the repository. A `fetch` in a component passed the build.
  //
  // Widening it found no violation, which is the good outcome and also the point: the
  // property was true and unenforced, and "true today" is not what a guard is for. This is
  // the seventh time this repository has found a rule it believed was checked and was not.
  //
  // `apps/web/public` joined the list when the service worker was written, and it is the
  // more interesting half of that change. A new directory of shipped code that no guard
  // scanned is precisely the blind spot this function had twice already, and adding the
  // worker without adding its directory would have created a third one on the same day it
  // was closed.
  //
  // Extensions are per directory rather than global. `packages/games` contains each
  // package's `dist/`, so scanning `.js` there would read a hundred bundles to learn
  // nothing; `apps/web/public` is plain JavaScript and there is nothing else to read.
  const dirs = [
    [join(root, 'packages', 'engine', 'src'), ['.ts', '.tsx']],
    [join(root, 'packages', 'game-sdk', 'src'), ['.ts', '.tsx']],
    [join(root, 'packages', 'games'), ['.ts', '.tsx']],
    [join(root, 'apps', 'web', 'src'), ['.ts', '.tsx']],
    [join(root, 'apps', 'web', 'public'), ['.js']],
  ];
  // `walk` returns [] for a directory that is not there, so a path listed above that stops
  // existing - or never existed - would scan nothing and report success. That is the same
  // shape as the bug this function just had, one line further up, and it is worth failing
  // on: `packages/ui` was in this list for exactly as long as it took to discover that
  // CLAUDE.md's layout table describes a directory the repository has never had.
  for (const [dir] of dirs) {
    if (!existsSync(dir)) {
      fail(property, `${dir.slice(root.length + 1)} is configured for scanning but does not exist`);
    }
  }
  // An exemption for a file that is no longer there is a hole nobody is watching. Fail on it
  // for the same reason a directory that stopped existing fails above.
  for (const exempt of NETWORK_EXEMPT.keys()) {
    if (!existsSync(join(root, exempt))) {
      fail(property, `${exempt} is exempted from the network rule but does not exist`);
    }
  }
  for (const [dir, extensions] of dirs) {
    const sources = (await walk(dir, (p) => extensions.includes(extname(p)))).filter(
      (p) => !p.endsWith('.test.ts') && !p.endsWith('.test.tsx'),
    );
    for (const path of sources) {
      const text = await readFile(path, 'utf8');
      const relative = path.slice(root.length + 1);
      // Strip comments: this file's own prose mentions fetch, and so does documentation.
      const blockStripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
      const code = blockStripped.replace(/\/\/.*$/gm, '');
      const exemption = NETWORK_EXEMPT.get(relative.split(sep).join('/'));
      if (exemption) {
        for (const problem of exemption(code, blockStripped)) {
          fail(property, `${relative} ${problem}`);
        }
      }
      for (const pattern of [
        // The exempt file is exempt from this one line and nothing else below it: it may
        // answer a request the page made, and it still may not open a socket, a peer
        // connection or a beacon.
        ...(exemption ? [] : [[/\bfetch\s*\(/, 'calls fetch()']]),
        [/\bXMLHttpRequest\b/, 'uses XMLHttpRequest'],
        [/\bWebSocket\b/, 'opens a WebSocket'],
        [/\bnavigator\.sendBeacon\b/, 'calls sendBeacon'],
        [/\bEventSource\b/, 'opens an EventSource'],
        // Missing until now, and the one that matters most for what comes next: remote play
        // arrives as a data channel, and it must arrive through a reviewed transport rather
        // than inside a game.
        [/\bRTCPeerConnection\b/, 'opens an RTCPeerConnection'],
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
