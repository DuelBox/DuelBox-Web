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

/**
 * The one string that identifies the debug overlay in a bundle.
 *
 * It is the overlay element's `id`, not a constant declared for this check to find, so a
 * build that does contain the overlay cannot have shaken it out: if the module ships, the
 * marker ships with it. Class names are hashed by the CSS pipeline and identifiers are
 * mangled by the minifier; a string literal is the one thing that survives both intact.
 */
const DEBUG_OVERLAY_MARKER = 'duelbox-debug-overlay';

/**
 * Anything that would put gameplay behind a round trip.
 *
 * The first nine are HTTP and transport clients: the direct way to add a request. The rest
 * are backends-as-a-package, and they are here because a documented claim was resting on
 * nothing. `docs/cwe-top-25.md` says of this script, twice, that it "fails a build that adds
 * a server runtime or a DB client" — and until this line there was no DB client in this
 * list, so the second half of that sentence was enforced by no code at all. It was not an
 * idle claim either: `firebase` and `@supabase/supabase-js` are meant to be imported into a
 * browser bundle, they are the shape of thing somebody reaches for to add a leaderboard in
 * an afternoon, and either one turns a site that costs nothing to host into a site with a
 * bill and a data-protection surface. The server-side drivers are listed with them because
 * the cost of a name that never appears is nil and the cost of the one that does is a build
 * that ships it.
 *
 * This does not make the CWE table's sentence fully true on its own — a *server runtime* is
 * checked by `checkNoServerRuntime` and `checkNoDynamicRoutes`, and those were always real.
 * It makes the half about a client true.
 */
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
  'firebase',
  '@firebase/app',
  '@supabase/supabase-js',
  '@vercel/postgres',
  '@upstash/redis',
  '@prisma/client',
  'mongodb',
  'mysql2',
  'pg',
];

/** A literal that means itself inside a regular expression, metacharacters and all. */
function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

/**
 * How a package name is spelled when a file actually depends on it.
 *
 * This was `from ['"]<client>` — one import form out of four. Over the three gameplay
 * packages that was very nearly harmless: they are hand-written ES modules, every
 * dependency in them is a static `import … from`, and the shape had never had a chance to
 * be wrong. Widening the walk to `apps/web/src` removes that accident. The shell is a Next
 * application, `await import('…')` is the idiom it already uses for anything it wants kept
 * out of the first chunk, and a data-fetching client is exactly the sort of dependency
 * somebody reaches for that way — lazily, on an interaction, which is precisely the case
 * this rule exists to refuse.
 *
 * That is measured rather than argued: `await import('axios')` written into
 * `apps/web/src/lib/offline-state.ts` produced a completely clean run against the previous
 * pattern. So all four forms are matched — `from 'x'`, a bare `import 'x'`, `import('x')`
 * and `require('x')` — and a subpath or a sibling of the package with it (`ky/umd`,
 * `got-scraping`), which is the trailing `['"]|[-/]`.
 *
 * The quote has to sit immediately before the name, and that is what keeps the short
 * entries in the list above from becoming noise: `from './lib/got'` does not match, because
 * the character after the quote is a dot.
 */
function moduleSpecifier(client) {
  return new RegExp(
    `\\b(?:from|import|require)\\s*\\(?\\s*['"]${escapeRegExp(client)}(?:['"]|[-/])`,
  );
}

/**
 * The ways a browser asks a server for something, and the words that name them in source.
 *
 * One list, read by both halves of the network rule below — the blanket one that covers
 * everything this repository ships, and the worker's third property, which is the same
 * question asked of the one file allowed to answer it differently. Two lists would drift,
 * and the drift would be silent in exactly the direction that matters: a new way of
 * reaching a server added to the blanket list and forgotten in the worker's.
 */
const NETWORK_APIS = [
  [/\bfetch\s*\(/, 'calls fetch()'],
  [/\bXMLHttpRequest\b/, 'uses XMLHttpRequest'],
  [/\bWebSocket\b/, 'opens a WebSocket'],
  [/\bnavigator\.sendBeacon\b/, 'calls sendBeacon'],
  [/\bEventSource\b/, 'opens an EventSource'],
];

/**
 * Where the service worker is looked for, and why there are two of them.
 *
 * `apps/web/public/sw.js` is the source: `next build` copies `public/` verbatim into the
 * export, so this is the file a person edits. `apps/web/out/sw.js` is the copy the browser
 * actually registers, and `e2e/offline.spec.ts` names it by that path when it manufactures a
 * second deploy. Both are read, and both are held to the three properties, because the
 * emitting step writes the precache list into the second one — so the two are not guaranteed
 * to be the same bytes, and the one that runs on a player's device is the second.
 *
 * Whichever exist are checked; if neither does, that is a failure rather than a pass. A
 * search for a file that is not there comes back clean forever, and CLAUDE.md counts ten
 * guards that were green about nothing.
 */
const WORKER_FILES = [
  join(root, 'apps', 'web', 'public', 'sw.js'),
  join(root, 'apps', 'web', 'out', 'sw.js'),
];

/**
 * The events the worker may listen for, and the whole of the second property.
 *
 * An allowlist rather than a list of banned events, because the banned list is the one that
 * goes stale: `push`, `sync`, `periodicsync`, `backgroundfetchsuccess`, `notificationclick`
 * and whatever ships next all have the same shape — code that runs with no page open and no
 * person present. Naming the four that are page-driven says the property directly instead of
 * chasing the platform. `install` and `activate` are the browser setting the worker up,
 * `fetch` is the page asking for something, and `message` is the page talking to it (the
 * update prompt's `SKIP_WAITING`, which #194 needs).
 */
const WORKER_EVENTS = new Set(['install', 'activate', 'fetch', 'message']);

/**
 * Ways of doing work nobody asked for that do not need a listener to reach.
 *
 * The allowlist above catches the registration of a background event. These catch the rest
 * of the same intent: a worker that keeps a notification permission alive, posts a beacon on
 * its way out, or registers itself for a sync it will be woken for later. Each one is a
 * thing this product has no reason to do, and each one is how a service worker turns from a
 * cache into a resident program.
 */
const BACKGROUND_WORK = [
  [/\bshowNotification\s*\(|\bNotification\s*\(/, 'raises a notification'],
  [/\bsendBeacon\s*\(/, 'sends a beacon'],
  [/\bperiodicSync\b|\bPeriodicSyncEvent\b/, 'uses Periodic Background Sync'],
  [/\bregistration\s*\.\s*sync\b|\bSyncManager\b|\bSyncEvent\b/, 'uses Background Sync'],
  [/\bbackgroundFetch\b|\bBackgroundFetch\b/i, 'uses Background Fetch'],
  [/\bpushManager\b|\bPushManager\b|\bPushSubscription\b/, 'subscribes to push'],
];

/**
 * The idioms that count as refusing a cross-origin request, and nothing else does.
 *
 * A short list on purpose. The property is not "the worker mentions origins somewhere"; it
 * is that the fetch handler compares the origin of what it was handed against its own before
 * it does anything with it, and there are only so many ways to write that. That distinction
 * is now structural rather than aspirational: these patterns are tested against the code the
 * fetch handler can actually reach, not against the file, so a comparison sitting in a helper
 * nobody calls no longer counts as one. `registration.scope`
 * is the second one because it is stricter than the first — a worker served from `/DuelBox-Web/`
 * on a project page has a scope narrower than its origin, and a prefix test against it also
 * satisfies same-origin. Adding a third entry here is a deliberate act: it widens what counts
 * as a guard, and a guard this cannot recognise is a guard it cannot prove is there.
 */
const SAME_ORIGIN_GUARDS = [
  /(?:!==|===|!=|==)\s*(?:self\.)?location\.origin\b/,
  /(?:self\.)?location\.origin\s*(?:!==|===|!=|==)/,
  /\bstartsWith\s*\(\s*(?:self\.)?registration\.scope\b/,
];

/** The argument to `fetch()` that means "the request the page made", in the shapes it comes in. */
const THE_PAGES_REQUEST = /^[\w$.]*\b(?:request|req)\b/i;

const failures = [];

function fail(property, detail) {
  failures.push({ property, detail });
}

/**
 * Read a file a check cannot reason about anything without, or record why it could not.
 *
 * Three checks below open one named file and then draw conclusions from its contents, and a
 * bare `readFile` on a path that has moved ends the entire run in a stack trace — after the
 * checks above it have already printed their passes, and before a single failure collected
 * so far is reported. Nothing about that is quiet, so it is not the failure mode this file
 * is mostly built against; it is the wrong *shape* of answer. Watched on a tree with
 * `apps/web/src` emptied: two real violations were found, neither was printed, and what
 * came out was an ENOENT for `catalogue.generated.ts` with no indication that anything else
 * had gone wrong at all.
 *
 * A guard that cannot find its subject should name the file, say what it needed it for,
 * take its place in the list with every other failure, and let the rest of the run finish.
 */
async function readOrFail(path, property, why) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    fail(property, `${path.slice(root.length + 1)} could not be read, and ${why}`);
    return null;
  }
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

/**
 * Read a script the way the checks below need to see it, in one pass.
 *
 * Every check in this file used to strip comments with
 * `.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')`, and that is fine for asking
 * "does the word `fetch` appear outside a comment" and wrong for everything the service
 * worker needs. Two reasons, both of which bite exactly where this file is now looking. The
 * naive strip cannot tell a comment from a `//` inside a string, so the one literal a worker
 * must never contain — `'https://somewhere.else/'` — is cut down to `'https:` before anything
 * gets to look at it, and the check for it passes. And it cannot tell a comment from a `//`
 * inside a regular expression, so `/\/\//` swallows the rest of its line.
 *
 * So this walks the source once and returns three views of it:
 *
 * - `bare` — comments blanked, everything else left alone. What a search for an API name
 *   should read: it is the old behaviour with the two holes above closed.
 * - `code` — comments blanked *and* the contents of every string, template and regular
 *   expression blanked with it. What a structural question should read, because brackets
 *   inside a string are not brackets. Blanking `${` and `}` together keeps a template
 *   literal balanced, which is what lets the paren-matching below work at all.
 * - `literals` — the strings themselves, with their values intact, for the one property that
 *   is about what a string says rather than about what the code does.
 *
 * Blanking is length-preserving and keeps newlines, so an index into any of the three is an
 * index into the other two and into the original.
 */
function readScript(source) {
  const bare = [...source];
  const code = [...source];
  const literals = [];
  const blank = (target, from, to) => {
    for (let at = from; at < to && at < source.length; at += 1) {
      if (target[at] !== '\n') target[at] = ' ';
    }
  };
  // The character before a `/` decides whether it opens a regular expression or divides.
  // After a value — an identifier, a number, a closing bracket — it divides; after an
  // operator or a separator it opens one. Wrong only for `return /re/` and friends, and
  // wrong safely: an unrecognised regex is left as ordinary code rather than blanked away.
  const opensRegex = (previous) => previous === '' || '(,=:[!&|?{};+-*%^~<>'.includes(previous);
  let index = 0;
  let previous = '';
  while (index < source.length) {
    const char = source[index];
    const after = source[index + 1];
    if (char === '/' && after === '/') {
      let end = index;
      while (end < source.length && source[end] !== '\n') end += 1;
      blank(bare, index, end);
      blank(code, index, end);
      index = end;
      continue;
    }
    if (char === '/' && after === '*') {
      const close = source.indexOf('*/', index + 2);
      const end = close < 0 ? source.length : close + 2;
      blank(bare, index, end);
      blank(code, index, end);
      index = end;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      let end = index + 1;
      let value = '';
      while (end < source.length && source[end] !== char) {
        if (source[end] === '\\') {
          value += source[end + 1] ?? '';
          end += 2;
          continue;
        }
        value += source[end];
        end += 1;
      }
      literals.push({ value, index });
      blank(code, index + 1, end);
      index = Math.min(end + 1, source.length);
      previous = char;
      continue;
    }
    if (char === '/' && opensRegex(previous)) {
      let end = index + 1;
      let inClass = false;
      while (end < source.length) {
        const at = source[end];
        if (at === '\\') {
          end += 2;
          continue;
        }
        if (at === '\n') break;
        if (at === '[') inClass = true;
        else if (at === ']') inClass = false;
        else if (at === '/' && !inClass) break;
        end += 1;
      }
      if (source[end] === '/') {
        blank(code, index + 1, end);
        index = end + 1;
        previous = '/';
        continue;
      }
    }
    if (!/\s/.test(char)) previous = char;
    index += 1;
  }
  return { bare: bare.join(''), code: code.join(''), literals };
}

/**
 * The text between a call's parentheses, and where the closing one is.
 *
 * Given the index of an opening parenthesis in a `code` view — where every string, template
 * and regex has already been blanked — this is exact rather than approximate, which is what
 * makes "inside the install handler" a fact rather than a guess.
 */
function callArguments(code, open) {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === '(') depth += 1;
    else if (code[at] === ')') {
      depth -= 1;
      if (depth === 0) return { text: code.slice(open + 1, at), end: at };
    }
  }
  return null;
}

/** The text of a braced block, given the index of its opening brace. */
function blockBody(code, open) {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === '{') depth += 1;
    else if (code[at] === '}') {
      depth -= 1;
      if (depth === 0) return { start: open, end: at };
    }
  }
  return null;
}

/**
 * The name of the top-level declaration a piece of code sits inside, or null if it is not
 * inside one.
 *
 * Used for one thing: a precache that lives in a helper rather than inline in the install
 * handler. `self.addEventListener('install', (event) => event.waitUntil(precache()))` with
 * `async function precache()` at the bottom of the file is an ordinary and readable way to
 * write a worker, and a check that only accepted the inline form would be telling people to
 * write it worse. So the enclosing declaration is found by looking backwards for the last
 * one that starts at column zero — a nesting level this repository's style guarantees — and
 * the caller asks whether the install handler names it.
 *
 * **The `or null` is the whole of it, and the first version did not have it.** It returned
 * the last declaration that *started* before the index, without asking whether the index was
 * still inside it — so a `cache.addAll` appended to the bottom of the file, in a `message`
 * handler, in the exact shape of a worker that re-warms its cache whenever a page says
 * hello, was attributed to the `precache()` function above it and waved straight through.
 * That was watched happening, which is the only reason it is not still happening: the
 * violation this exists to catch was the one violation it could not see. The body is now
 * brace-matched, and a position outside every declaration belongs to no declaration.
 */
function enclosingDeclaration(code, index) {
  const pattern =
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  const declarations = [...code.slice(0, index).matchAll(pattern)];
  const last = declarations.at(-1);
  if (last === undefined) return null;
  const open = code.indexOf('{', last.index);
  if (open < 0 || open > index) return null;
  const body = blockBody(code, open);
  if (body === null || index > body.end) return null;
  return last[1] ?? last[2] ?? null;
}

/**
 * Every top-level declaration that has a body, with the body, so a handler's reach can be
 * followed instead of guessed at.
 *
 * The same column-zero convention `enclosingDeclaration` relies on, read in the other
 * direction: that one asks "which declaration is this index inside", this one asks "what
 * are all of them". Two checks below need the second question. Whether a same-origin guard
 * is in the code the fetch handler actually runs is not answerable by searching the file,
 * because a guard written and never called reads identically to one that guards; and
 * whether install's precache helper is install's alone is not answerable without knowing
 * where that helper's body stops.
 *
 * The `;` test is the one piece of care in it. A declaration's body is found by taking the
 * next `{` after its name, and a `const` bound to something with no block — `const CACHE =
 * \`duelbox-shell-${REVISION}\`;` — has no brace of its own, so the naive version reaches
 * past the semicolon and adopts the body of whatever function is declared next. That would
 * be worse than not looking: it would attribute a real function's code to a string
 * constant, and both of the checks that use this would then be reading a scope that does
 * not exist. A declaration whose brace is on the far side of a semicolon has no body, and
 * is skipped.
 */
function topLevelDeclarations(code) {
  const pattern =
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  const found = [];
  for (const match of code.matchAll(pattern)) {
    const name = match[1] ?? match[2] ?? null;
    if (name === null) continue;
    const open = code.indexOf('{', match.index);
    if (open < 0 || code.slice(match.index, open).includes(';')) continue;
    const body = blockBody(code, open);
    if (body === null) continue;
    found.push({
      name,
      at: code.indexOf(name, match.index),
      start: body.start,
      end: body.end,
      body: code.slice(body.start, body.end + 1),
    });
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

  const config = await readOrFail(
    join(root, 'apps', 'web', 'next.config.ts'),
    property,
    'it is the only place that says whether this site is exported or served',
  );
  if (config === null) return;
  // Comments stripped first: the config explains at length *why* it exports statically,
  // so a search of the raw text finds the setting in the prose and passes even when the
  // setting itself has been commented out.
  const configCode = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (!/output:\s*'export'/.test(configCode)) {
    fail(property, "next.config.ts no longer sets output: 'export' — the site would need a server");
  }
}

/**
 * Nothing this repository ships to a browser asks a server for anything — and the one file
 * that is allowed to is held to three properties instead.
 *
 * ## Why this widened, and what it took over
 *
 * It used to cover the three gameplay trees and nothing else: engine, SDK, games, `.ts`
 * only. That was enough while `e2e/offline.spec.ts` could do the other half dynamically —
 * it aborts every route after the page has loaded and asserts the list of blocked URLs is
 * empty, so a gameplay module that fetched something *appeared*, by name, as a URL nobody
 * could account for.
 *
 * The service worker takes that away, and the spec says so at the assertion it weakened.
 * `page.route` intercepts at the page's network layer; a request the worker answers never
 * reaches it. So a module that fetched something would now get a 504 out of the worker's own
 * cache-miss path and the spec would see an empty list — the same green tick, for a site that
 * had started depending on a server. The dynamic proof did not get weaker gradually or
 * visibly. It stopped covering that case on the day the worker landed, while continuing to
 * pass.
 *
 * A static check is what can take that job back, and it has to cover more ground than the
 * old one did to be worth having: `apps/web/src` as well as the packages, `.tsx` as well as
 * `.ts`, because the shell is what the worker is caching and a `fetch` in a React component
 * is exactly as expensive as a `fetch` in a game. What it gives up is the thing only the
 * dynamic test could ever do — proving a *behaviour* rather than an absence of a word — and
 * what it gains is that it cannot be intercepted.
 *
 * ## The one exemption
 *
 * `apps/web/public/sw.js` calls `fetch`, and has to: answering a request is the entire job.
 * It is exempt from the rule above and subject to `checkTheWorkerOnlyAnswers` below, which
 * is three checks that together say it may only ever answer a request the page already made.
 * Every other script in `public/` is held to the blanket rule, so "the single exempted file"
 * is a fact about this function rather than a sentence in a comment.
 */
async function checkNoNetworkInGameplay() {
  const property = 'Nothing shipped to a browser reaches the network';
  /**
   * Where to look, and what counts as a source file in each place.
   *
   * Two extension sets rather than one, because the last entry is not like the others.
   * `packages/games` is a whole package tree rather than a `src/` directory, so admitting
   * `.js` there would walk into whatever a build left behind and read a bundler's output as
   * though somebody had written it. `public/` is the opposite case and needs exactly that:
   * scripts dropped in there are served verbatim and are not compiled, bundled or
   * type-checked by anything, which makes it the easiest place in this repository to put a
   * call nobody reviews. The worker is the one file allowed to be there; everything else in
   * it is held to the same rule as the rest of the site.
   */
  const roots = [
    [join(root, 'packages', 'engine', 'src'), ['.ts', '.tsx']],
    [join(root, 'packages', 'game-sdk', 'src'), ['.ts', '.tsx']],
    [join(root, 'packages', 'games'), ['.ts', '.tsx']],
    [join(root, 'apps', 'web', 'src'), ['.ts', '.tsx']],
    [join(root, 'apps', 'web', 'public'), ['.js', '.mjs', '.cjs']],
  ];

  const sources = [];
  const breakdown = [];
  for (const [dir, extensions] of roots) {
    const relative = dir.slice(root.length + 1);
    const found = await walk(dir, (p) => extensions.includes(extname(p)));
    /**
     * A walk of a directory that is not there returns an empty list, and an empty list
     * satisfies every pattern below it, silently, for ever.
     *
     * That is the failure CLAUDE.md keeps a count of, and it is not hypothetical for this
     * function: symlinking `packages/games` out of the tree took this scan from 1020 files
     * to 156 and it still printed "all properties hold" — a hundred and eight games
     * unexamined, and a green tick over them. Nothing dramatic is needed to do it by
     * accident. A package renamed, a tree that grows a level, a `src/` that becomes
     * `source/`: the list above goes stale in the one direction that produces no error.
     *
     * So each root has to yield something. None of the five can legitimately be empty —
     * they hold the engine, the SDK, a hundred and eight games, the shell, and the worker —
     * and a root that has become empty is a fact about this list rather than about the
     * repository.
     */
    if (found.length === 0) {
      fail(
        property,
        `${relative} holds no ${extensions.join('/')} file, so walking it proves nothing.` +
          ' Either that tree moved and the list in checkNoNetworkInGameplay has to move' +
          ' with it, or it is gone — and either way this scan has been reporting success' +
          ' over a directory it never read.',
      );
      continue;
    }
    breakdown.push(`${relative} ${String(found.length)}`);
    sources.push(...found);
  }

  // Both test extensions. A `.test.tsx` describing a component's network behaviour names
  // these APIs in order to assert they are absent, and failing it for that would teach the
  // next person to write the assertion somewhere this cannot read.
  const checkable = sources.filter(
    (path) => !/\.test\.tsx?$/.test(path) && !WORKER_FILES.includes(path),
  );
  for (const path of checkable) {
    const relative = path.slice(root.length + 1);
    const { bare } = readScript(await readFile(path, 'utf8'));
    for (const [pattern, what] of NETWORK_APIS) {
      if (pattern.test(bare)) fail(property, `${relative} ${what}`);
    }
    for (const client of NETWORK_CLIENTS) {
      if (moduleSpecifier(client).test(bare)) {
        fail(property, `${relative} imports ${client}`);
      }
    }
  }
  console.log(
    `  network-free sources: ${String(checkable.length)} files checked of` +
      ` ${String(sources.length)} found — ${breakdown.join(', ')}`,
  );
}

/**
 * The service worker may only ever answer a request the page already made.
 *
 * That sentence is the whole of the exemption, and these are the three checks that hold it
 * to it. It is worth saying why a worker needs holding at all, because "it caches the site"
 * sounds harmless: a service worker is the only code this project ships that keeps running
 * after the tab is closed, that a person cannot see, and that survives a reload of the page
 * that would fix it. Every property this repository has — no server, no per-request cost, no
 * telemetry, nothing about a player leaving their device — is a property the worker is in a
 * position to break silently, from a file that is not bundled, not type-checked and not
 * imported by anything.
 *
 * **One: it only ever talks to this origin.** No absolute URL appears anywhere in it, and
 * its fetch handler compares the origin of what it was handed against its own. The first
 * half is what stops a CDN, a font host or an analytics endpoint arriving in the precache
 * list; the second is what stops the worker becoming a proxy that launders third-party
 * requests through a cache the page cannot see. Both, because either alone passes a worker
 * that reaches somewhere else: a URL built at runtime carries no literal, and a guard is no
 * use if there is a hard-coded host on the other side of it.
 *
 * **Two: nothing in it runs without a page.** The events it listens for are `install`,
 * `activate`, `fetch` and `message` — the browser setting it up, the page asking for
 * something, and the page talking to it — and none of the background APIs appear. This is
 * the property that keeps "answers a request the page already made" from being satisfied by
 * a worker that also wakes up at three in the morning to re-warm its cache. It is also the
 * privacy claim: `docs/privacy-policy.md` says nothing about this product ever reaches a
 * server unbidden, and a `push` or `periodicsync` listener is precisely a thing that does.
 *
 * **Three: it originates no request of its own, beyond precaching at install.** Every
 * `fetch` outside the install handler is handed the request the page made, rather than a URL
 * the worker built; and `cache.add`/`cache.addAll` — the two calls that make the *cache* go
 * to the network on the worker's behalf — happen only in install, or in a function install
 * names **and no other handler reaches**. That last clause is load-bearing and was missing:
 * a `precache()` helper called from install and again from a `message` handler put every
 * request in the precache list back on the wire on a schedule the page chose, with the
 * `addAll` still sitting inside the function install names, still exempt. The exemption
 * belongs to install, so the helper has to be install's alone.
 *
 * The exemption for install is the honest one and it is bounded: precaching is a
 * burst of requests at a moment the person is already loading the site, once per deploy, and
 * it is the thing that makes a cold offline start possible at all. Anything after that is
 * the worker spending somebody's bandwidth on its own initiative.
 *
 * What these three cannot do is prove the worker's *caching strategy* is right — that the
 * shell is cache-first and a navigation falls back to `/offline/`. That is behaviour, it is
 * what `e2e/offline.spec.ts` exists for, and no reading of the file can replace it. These
 * three are the half that survives the worker being able to intercept its own examiner.
 */
async function checkTheWorkerOnlyAnswers() {
  const property = 'The service worker only answers requests the page already made';
  const workers = [];
  for (const path of WORKER_FILES) {
    try {
      workers.push([path, await readFile(path, 'utf8')]);
    } catch {
      // Not at this path. Whether that is a problem is decided once, below.
    }
  }
  if (workers.length === 0) {
    fail(
      property,
      'no service worker at apps/web/public/sw.js or apps/web/out/sw.js. The site claims to' +
        ' open with no connection and e2e/offline.spec.ts asserts a worker installs, claims' +
        ' the page and precaches the shell — so either the worker has been deleted and those' +
        ' claims go with it, or the build that was supposed to emit it did not run. Nothing' +
        ' below can check a file that is not there.',
    );
    return;
  }

  for (const [path, source] of workers) {
    const where = path.slice(root.length + 1);
    const { bare, code, literals } = readScript(source);
    const declarations = topLevelDeclarations(code);

    /**
     * The argument list of `self.addEventListener('<event>', …)`, matched by its parentheses
     * rather than by its braces.
     *
     * `addEventListener('install', (e) => e.waitUntil(precache()))` has no braces at all,
     * and a span that only recognised the block form would send an exemption to the wrong
     * place. `open` is kept alongside the span because a position is judged to be inside a
     * handler by comparing against both ends.
     */
    const handlerOf = (event) => {
      const opener = new RegExp(`addEventListener\\s*\\(\\s*['"]${event}['"]`).exec(bare);
      if (opener === null) return null;
      const open = code.indexOf('(', opener.index);
      if (open < 0) return null;
      const span = callArguments(code, open);
      return span === null ? null : { open, text: span.text, end: span.end };
    };

    /**
     * Everything a handler can reach: its own body, plus the body of every top-level
     * declaration named anywhere in what it reaches, to a fixed point.
     *
     * An over-approximation of a call graph — a name mentioned is treated as a name called —
     * and over is the safe direction for the one question asked of it. It is used to decide
     * whether a guard is in the code that runs, and being generous about what runs can only
     * accept a guard that is there; it can never invent one.
     *
     * Transitive rather than one level down, because a worker is allowed to be written in
     * more than two layers. This one is: `fetch` names `respondToNavigation`, which names
     * `cached` and `save`, and a same-origin test factored into either of those is a real
     * guard in a real code path. Stopping at the first level would have failed that worker
     * and taught its author to inline a helper to satisfy a script.
     */
    const reachedBy = (handler) => {
      if (handler === null) return '';
      const reached = new Map();
      const frontier = [handler.text];
      while (frontier.length > 0) {
        const text = frontier.pop() ?? '';
        for (const declaration of declarations) {
          if (reached.has(declaration.name)) continue;
          if (!new RegExp(`\\b${escapeRegExp(declaration.name)}\\b`).test(text)) continue;
          reached.set(declaration.name, declaration.body);
          frontier.push(declaration.body);
        }
      }
      return [handler.text, ...reached.values()].join('\n');
    };

    /**
     * One registration per event, because every span below is scoped to the first.
     *
     * This is not a fourth property. It is the precondition that makes two of the three
     * checkable, and it is here because without it they would quietly stop being true.
     * `handlerOf` takes the first `addEventListener` for a name; a worker that registered a
     * second `fetch` listener would have that listener's whole body outside the span the
     * same-origin check reads, and a second `install` listener would put a precache outside
     * the one span the exemption is scoped to — so the guard would be looked for in the
     * wrong place and the exemption granted in the wrong place, both silently, both
     * reporting a pass.
     *
     * Refusing the second registration is a great deal more honest than half-scoping to it.
     * Nothing needs two: a worker with one job per event is also the only shape anybody
     * reading this file afterwards will expect.
     */
    const registrations = new Map();
    for (const match of bare.matchAll(/addEventListener\s*\(\s*['"]([a-z]+)['"]/gi)) {
      const event = (match[1] ?? '').toLowerCase();
      registrations.set(event, (registrations.get(event) ?? 0) + 1);
    }
    for (const [event, count] of registrations) {
      if (count > 1) {
        fail(
          property,
          `${where} registers ${String(count)} "${event}" listeners. The checks below scope` +
            ' themselves to the first one they find, so a second would put its body outside' +
            ' every span they can see — the same-origin guard looked for in the wrong place,' +
            ' and the precache exemption granted in the wrong place. One listener per event',
        );
      }
    }

    // One: same origin, and said so out loud.
    for (const { value } of literals) {
      if (/\bhttps?:\/\//i.test(value) || /^\/\/[^/]/.test(value)) {
        fail(
          property,
          `${where} contains the absolute URL "${value.slice(0, 60)}" — a worker that names` +
            ' another origin is a worker that can fetch from it, and nothing on the page can' +
            ' see it happen',
        );
      }
    }
    /**
     * The guard has to be in the code the fetch handler runs, not merely in the file.
     *
     * This searched the whole of `code` until it was watched passing the case it exists to
     * catch: delete the comparison out of the fetch handler, leave a `sameOrigin(url)`
     * helper at the bottom of the file that nothing calls, and the worker proxies every
     * cross-origin request it is handed while this reported the property held. Dead code
     * and a guard read identically to a search for a substring, and the failure message
     * underneath already said "its fetch handler must compare" — so the sentence was true
     * and the check under it was not, which is the exact shape CLAUDE.md says to distrust.
     *
     * A worker with no fetch handler at all fails here rather than passing vacuously. It
     * would satisfy this property in the strictest possible way, by answering nothing, and
     * it would also not be a service worker: `e2e/offline.spec.ts` asserts a cold start
     * from the cache, which is a fetch handler or it is nothing.
     */
    const fetchHandler = handlerOf('fetch');
    const fetchReach = reachedBy(fetchHandler);
    if (fetchHandler === null) {
      fail(
        property,
        `${where} registers no fetch handler this can find, so there is no code path to scope` +
          " the same-origin guard to. Register it as self.addEventListener('fetch', ...) —" +
          ' and if this worker genuinely answers nothing, it is not the worker that' +
          ' e2e/offline.spec.ts opens a game from with the network switched off',
      );
    } else if (!SAME_ORIGIN_GUARDS.some((pattern) => pattern.test(fetchReach))) {
      fail(
        property,
        `${where} has no same-origin guard in the code its fetch handler reaches. That handler` +
          " must compare the request's origin against self.location.origin, or test the URL" +
          ' against registration.scope, and return without handling anything that fails —' +
          ' otherwise it answers, caches and can rewrite responses from hosts this site does' +
          ' not control. A comparison written somewhere the handler never reaches is not a' +
          ' guard, and this no longer accepts one',
      );
    }

    // Two: nothing runs without a page.
    const handled = new Set([
      ...[...bare.matchAll(/addEventListener\s*\(\s*['"]([a-z]+)['"]/gi)].map((m) =>
        (m[1] ?? '').toLowerCase(),
      ),
      ...[...bare.matchAll(/\bself\s*\.\s*on([a-z]+)\s*=/gi)].map((m) =>
        (m[1] ?? '').toLowerCase(),
      ),
    ]);
    for (const event of handled) {
      if (!WORKER_EVENTS.has(event)) {
        fail(
          property,
          `${where} handles "${event}", which is not one of ${[...WORKER_EVENTS].join(', ')}.` +
            ' Those four are the ones a page drives; anything else is the worker running when' +
            ' nobody has opened the site, which is not something this product does',
        );
      }
    }
    for (const [pattern, what] of BACKGROUND_WORK) {
      if (pattern.test(code)) fail(property, `${where} ${what}, with no page and no person`);
    }

    // Three: no request of its own beyond the install precache.
    const install = handlerOf('install');
    if (install === null) {
      fail(
        property,
        `${where} registers no install handler this can find, so the exemption for precaching` +
          " cannot be scoped to it. Register it as self.addEventListener('install', ...) —" +
          ' the shape every check here and every worker in the wild uses',
      );
    }
    const inInstall = (at) => install !== null && at > install.open && at < install.end;
    // Every helper an exemption was granted through, so the grant can be audited below.
    const exempted = new Set();
    const namedByInstall = (at) => {
      if (install === null) return false;
      const declaration = enclosingDeclaration(code, at);
      if (declaration === null) return false;
      if (!new RegExp(`\\b${escapeRegExp(declaration)}\\b`).test(install.text)) return false;
      exempted.add(declaration);
      return true;
    };

    for (const match of code.matchAll(/\bfetch\s*\(/g)) {
      const at = code.indexOf('(', match.index);
      if (inInstall(at) || namedByInstall(at)) continue;
      const span = callArguments(code, at);
      // Decided on `code`, where a string's contents are blanked, so `fetch('/request')`
      // cannot pass by containing the word. Reported from `bare`, where they are not, so the
      // failure quotes the line as it is written rather than a row of spaces.
      const argument = (span?.text ?? '').trim();
      const quoted = (span === null ? '' : bare.slice(at + 1, span.end)).trim();
      if (!THE_PAGES_REQUEST.test(argument)) {
        fail(
          property,
          `${where} calls fetch(${quoted.slice(0, 40)}) outside its install handler. Outside` +
            ' install it may only pass on the request the page made — a URL it assembled' +
            ' itself is a request nobody asked for, paid for by the player, on a connection' +
            ' they may be paying for by the megabyte',
        );
      }
    }
    for (const match of code.matchAll(/(\w*)\s*\.\s*(addAll|add)\s*\(/g)) {
      const receiver = (match[1] ?? '').toLowerCase();
      // `.addAll` is the Cache API and nothing else; a bare `.add` is a Set as often as a
      // cache, so it counts only when the thing it is called on says it is a cache.
      if (match[2] === 'add' && !receiver.includes('cach')) continue;
      const at = code.indexOf('(', match.index);
      if (inInstall(at) || namedByInstall(at)) continue;
      fail(
        property,
        `${where} calls .${match[2] ?? 'add'}() outside its install handler. That is the cache` +
          " fetching on the worker's own behalf: precaching belongs at install, where the" +
          ' person is already loading the site, and a cache warmed at any other moment is' +
          ' bandwidth spent on somebody who did not ask for it',
      );
    }
    if (/\bimportScripts\s*\(/.test(code)) {
      fail(
        property,
        `${where} calls importScripts(), which fetches a script on every worker start-up —` +
          ' before any page has asked for anything, from a URL the page never named',
      );
    }

    /**
     * A helper install lends the exemption to has to be install's alone.
     *
     * The two scans above forgive a `fetch` or a `cache.addAll` that sits inside a function
     * the install handler names, and they have to: `event.waitUntil(precache())` with
     * `async function precache()` below it is the readable way to write a worker, and a
     * check that only accepted the inline form would be telling people to write it worse.
     * But the exemption is granted to a *position in the file*, and a function has more than
     * one caller available to it.
     *
     * So this was watched going past, in the shape that matters: add a `message` handler
     * that calls `precache()` when a page says hello, and every request in the precache list
     * goes out again, on a schedule the page chooses, on a connection somebody may be paying
     * for by the megabyte — with the `addAll` still sitting inside the function install
     * names, still exempt, still green. `enclosingDeclaration`'s own docstring records the
     * near-miss version of this being caught by brace-matching; that closed the case where
     * the offending call is appended *after* the helper, and left the case where it is
     * simply routed *through* it.
     *
     * The rule that closes it is the narrowest one that still permits the readable form: the
     * helper may be named by its own declaration, mentioned inside its own body, and called
     * from the install handler. A mention anywhere else means the exemption has left install,
     * and the line numbers say where to look.
     */
    for (const name of exempted) {
      const declaration = declarations.find((entry) => entry.name === name);
      const strayed = [...code.matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g'))]
        .map((match) => match.index)
        .filter((at) => !inInstall(at))
        .filter(
          (at) =>
            declaration === undefined ||
            (at !== declaration.at && (at < declaration.start || at > declaration.end)),
        );
      if (strayed.length > 0) {
        const lines = strayed.map((at) => String(code.slice(0, at).split('\n').length));
        fail(
          property,
          `${where} reaches ${name}() from line ${lines.join(', line ')} as well as from its` +
            ' install handler. Precaching is exempt because install is the one moment the' +
            ' person is already loading the site, once per deploy; a helper install shares' +
            ' with another handler carries that exemption out of install with it, and a cache' +
            " re-warmed on a message or a claim is the worker spending somebody's bandwidth" +
            ' on its own initiative',
        );
      }
    }
  }

  console.log(
    `  service worker: ${workers.map(([path]) => path.slice(root.length + 1)).join(', ')}` +
      ' held to three properties',
  );
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
  const html = await readOrFail(
    join(out, 'play', 'tic-tac-toe', 'index.html'),
    property,
    'it is the page this budget is measured against — one game, opened and played',
  );
  if (html === null) return;
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

  // The expected counts are read out of the catalogue rather than written down here. A
  // literal goes stale the day a game is added and nothing says so: this check asked for
  // "107 games plus the catalogue index itself" and a total of 108 while the catalogue
  // held 108 games, so it was already a page of slack before anything else touched it.
  const catalogue = await readOrFail(
    join(root, 'apps', 'web', 'src', 'data', 'catalogue.generated.ts'),
    property,
    'the page counts below are read out of it rather than written down here, so without it' +
      ' there is no number to hold the export against',
  );
  if (catalogue === null) return;
  const games = [...catalogue.matchAll(/"slug":\s*"[a-z0-9-]+"/g)].length;
  const categories = /export const CATEGORIES[^=]*=\s*\[([^\]]*)\]/.exec(catalogue);
  const hubs = categories === null ? 0 : [...categories[1].matchAll(/"[^"]+"/g)].length;
  if (games === 0 || hubs === 0) {
    fail(
      property,
      'catalogue.generated.ts did not parse, so the page counts below would prove nothing',
    );
    return;
  }

  // Two different kinds of page live under out/games/ since the category hubs of #200
  // landed, and they are counted apart because they fail apart. Against a single total,
  // eighteen missing game pages would be covered exactly by the eighteen hubs that
  // replaced them, and a guard a wrong build can satisfy is not guarding anything.
  const pages = await walk(join(out, 'games'), (p) => p.endsWith('index.html'));
  const hubRoot = join(out, 'games', 'category');
  const hubPages = pages.filter((p) => p.startsWith(hubRoot));
  const gamePages = pages.filter((p) => !p.startsWith(hubRoot));

  // Exactly, not at least. A page more than the catalogue accounts for means the export
  // and the catalogue disagree about what this site contains, which is worth the same
  // failure as a page missing.
  if (gamePages.length !== games + 1) {
    fail(
      property,
      `${String(gamePages.length)} pre-rendered game pages found, expected ${String(games + 1)}` +
        ` — one for each of the ${String(games)} games in the catalogue, plus /games/ itself`,
    );
  }
  if (hubPages.length !== hubs) {
    fail(
      property,
      `${String(hubPages.length)} pre-rendered category hubs found, expected ${String(hubs)}` +
        ` — one for each category the catalogue names`,
    );
  }
  if (gamePages.length === games + 1 && hubPages.length === hubs) {
    console.log(
      `  pre-rendered pages: ${String(games)} games + /games/ + ${String(hubs)} category hubs`,
    );
  }
}

/**
 * The debug overlay costs a player nothing, because it is not there (#119).
 *
 * The acceptance criterion for that issue is zero bytes in the production bundle, and zero
 * bytes is a property of the *build* rather than of the source. Nothing else in this
 * repository can tell the difference between an overlay that does not render and an overlay
 * that is not there: both look identical on the deployed site, and only one of them is free.
 * So the overlay is reached exclusively through an `import()` inside
 * `if (process.env.NODE_ENV !== 'production')`, which webpack folds to `if (false)` and
 * deletes before resolving what is inside it — and this is the check that the fold happened
 * rather than the argument that it should have.
 *
 * Three parts, and the first is the one that makes the other two mean anything. A search of
 * a build for a string that nothing has ever contained passes forever, which is the failure
 * mode CLAUDE.md records six of.
 */
async function checkDebugOverlayIsNotShipped() {
  const property = 'The debug overlay is not in the production bundle';
  const debugDir = join(root, 'apps', 'web', 'src', 'components', 'debug');
  const overlay = join(debugDir, 'DebugOverlay.ts');

  // One: the marker still identifies the overlay. If the overlay is genuinely gone, this
  // check has nothing left to do and should go with it rather than pass by default.
  let source;
  try {
    source = await readFile(overlay, 'utf8');
  } catch {
    fail(
      property,
      'apps/web/src/components/debug/DebugOverlay.ts is missing — if the overlay was removed,' +
        ' remove this check too rather than leaving it searching for nothing',
    );
    return;
  }
  if (!source.includes(DEBUG_OVERLAY_MARKER)) {
    fail(
      property,
      `DebugOverlay.ts no longer contains "${DEBUG_OVERLAY_MARKER}", so searching the build` +
        ' for it would prove nothing. Restore the marker or pick a new one here.',
    );
    return;
  }

  // Two: nothing reaches the overlay except through a dynamic import. A static import is
  // what puts a module in the graph regardless of any flag guarding its use, and it is
  // worth naming here — at the line that caused it — rather than leaving it to be found as
  // an unexplained string in a chunk. A `import type` is erased by the compiler and allowed.
  const sources = (
    await walk(join(root, 'apps', 'web', 'src'), (p) => ['.ts', '.tsx'].includes(extname(p)))
  ).filter((path) => !path.startsWith(debugDir));
  for (const path of sources) {
    // Comments come out first: this repository explains its reasoning at length, and the
    // module is named in prose in more than one place.
    const code = (await readFile(path, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const mentions = [...code.matchAll(/debug\/DebugOverlay/g)].length;
    if (mentions === 0) continue;
    const dynamic = [...code.matchAll(/import\(\s*['"][^'"]*debug\/DebugOverlay['"]\s*\)/g)].length;
    const typeOnly = [
      ...code.matchAll(/import\s+type\s[^;]*?from\s*['"][^'"]*debug\/DebugOverlay['"]/g),
    ].length;
    if (mentions !== dynamic + typeOnly) {
      fail(
        property,
        `${path.slice(root.length + 1)} reaches the overlay other than through a guarded` +
          ' import() — a static import ships it whatever the flag around its use says',
      );
    }
  }

  // Three: the build emitted nothing carrying it. HTML as well as scripts, because an
  // overlay rendered during the export would land in the served markup rather than a chunk.
  const emitted = await walk(out, (p) => ['.js', '.html'].includes(extname(p)));
  const scripts = emitted.filter((p) => extname(p) === '.js');
  if (scripts.length === 0) {
    fail(property, 'no scripts found in apps/web/out — run `pnpm build` first');
    return;
  }
  const carrying = [];
  for (const path of emitted) {
    if ((await readFile(path, 'utf8')).includes(DEBUG_OVERLAY_MARKER)) {
      carrying.push(path.slice(out.length + 1));
    }
  }
  if (carrying.length > 0) {
    fail(
      property,
      `the overlay is in ${String(carrying.length)} emitted file(s) — ${carrying.join(', ')}` +
        ' — so every player is downloading a development tool',
    );
  } else {
    console.log(
      `  debug overlay: absent from all ${String(scripts.length)} emitted script(s) and` +
        ` ${String(emitted.length - scripts.length)} exported page(s)`,
    );
  }
}

console.log('check-zero-cost:');
await checkNoServerRuntime();
await checkNoDynamicRoutes();
await checkNoNetworkInGameplay();
await checkTheWorkerOnlyAnswers();
await checkSessionBudget();
await checkPagesArePrerendered();
await checkDebugOverlayIsNotShipped();

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
