#!/usr/bin/env node
/**
 * Finish the service worker: give it the list of URLs that make up this build's shell, and
 * a revision computed from their contents.
 *
 * The source is `apps/web/public/sw.js` and it ships with three placeholders in it, because
 * the two facts it needs cannot be known before the export exists. Chunk names carry a hash
 * of their own contents, so the list is different every time anything changes; and the
 * revision has to be a fingerprint of *what is being cached*, which is not knowable from
 * the source of the worker either. `next build` copies `public/` into `out/` verbatim, so
 * `out/sw.js` starts life as the source with its placeholders intact and this rewrites it
 * in place. `docs/deploy.md` records that, in the same words it uses for the three
 * generated host-config files: do not edit it in `out/`, it is overwritten on every build.
 *
 * ## Where this belongs in the build, and why it is exactly there
 *
 * Straight after `emit:host-config`, and before every `check:` step.
 *
 * After `emit:host-config` because that step **rewrites every exported HTML file** — it
 * hashes each page's inline scripts and injects a `<meta http-equiv="Content-Security-Policy">`
 * and a referrer meta into the markup. Those documents are precached here, and the revision
 * is computed from their bytes. Run before that step and the revision would be a
 * fingerprint of the pre-injection pages: a deploy that changed nothing but the security
 * policy would produce the same revision, `activate` would keep the old caches, and every
 * returning visitor would go on being served pages carrying the previous policy from their
 * own device. The rule generalises past that one case — **the revision must be computed
 * after the last step that changes a byte of anything precached** — and today
 * `emit:host-config` is that step. Anything added later that touches `out/` has to go
 * before this, or the hash stops describing what is served.
 *
 * Before the checks because they are checks: `check-zero-cost.mjs` walks `apps/web/out`
 * and reads the emitted JavaScript, and the file it should be reading is the finished
 * worker rather than a copy still full of placeholders. Emitting, then checking, keeps
 * every guard looking at the artefact that will actually be uploaded.
 *
 * ## What goes in the precache list
 *
 * One rule for the documents and one for everything else, both derived from the export
 * rather than listed here, because a list of hashed filenames is wrong by the next build
 * and a list of routes is wrong by the next route.
 *
 * **Documents: every `index.html` at the top level or one directory down.** That is `/`
 * and `/games/`, `/how-to-play/`, `/settings/`, `/privacy/`, `/terms/`, `/dmca/`,
 * `/attribution/`, `/404/` and `/offline/` — the routes a visitor moves through before
 * they have chosen anything. The depth rule is what keeps the three large families out
 * without naming them: `/play/<slug>/`, `/embed/<slug>/`, `/games/<slug>/` and
 * `/games/category/<name>/` all sit two or more directories down, so 108 play documents,
 * 108 embed documents, 108 game pages and 18 category hubs are excluded by construction. A
 * new top-level route joins the shell automatically, which is the right default: a route
 * that is one segment deep is a route the site's own navigation reaches.
 *
 * That leaves the deliberate gap this change does not close. The play documents are not
 * precached, so a game that has never been opened is not on the device, and asking for one
 * offline gets `/offline/` rather than the game. Saving all 108 up front is #196 — it needs
 * a quota strategy and a way for a person to decline half a gigabyte of games they will
 * never open — and a game a player actually opens is saved by the worker's runtime path,
 * which is the promise that can be kept without asking anybody anything.
 *
 * **Everything those documents reference**, followed one level further where a reference
 * is not visible in HTML: the scripts and stylesheets in their `src`/`href` attributes,
 * the `url()` targets inside those stylesheets (which is how the self-hosted typefaces of
 * #2469 are found — no HTML mentions them), any non-`_next` `src`/`href` that resolves to
 * a real file rather than a route (the manifest and the icons; a link to `/games/` is a
 * directory and is skipped), and the `icons[].src` entries inside the manifest itself.
 *
 * **Except the faces a first visit does not fetch.** A `@font-face` whose `unicode-range`
 * excludes printable ASCII is a face the browser requests only when a page renders a glyph
 * in that range — a diacritic in a player's name, or the Hindi and Arabic that #224 added
 * faces for — and no English page does. Precaching it would install, on every first visit,
 * a file the visit is never going to draw: the two script faces alone are 287,340 bytes
 * (281 KB) against a shell precache that was 411 KB over the wire before them. So
 * `referencesInCss` leaves those faces out, and the worker's runtime path (`respondToAsset`
 * in `sw.js`) saves one the first time a page needs it, which is the same promise the play
 * documents get: what you have drawn is what you keep. The same rule, applied to the same
 * stylesheet, also takes the three `latin-ext` faces out of the precache — they were in it
 * until #224, 37 KB of a first install that an English page never draws either — so the
 * precache went from 52 URLs and 411 KB over the wire to 49 and 375 KB on the build that
 * added the two script faces, and the summary line at the end reports five faces left to
 * the runtime path rather than two. The cost of that promise is honest and recorded in `docs/fonts.md` — a page
 * in one of those scripts has to have been drawn once while connected before its face is on
 * the device, and the runtime cache is renamed on every deploy, so that is once per deploy.
 * The rule is the one `scripts/check-size.mjs` classifies fonts by, function for function,
 * and that script reads the worker this one emits and fails the build if the two disagree.
 *
 * Every URL is checked against the export before it is written. A precache list with one
 * bad URL in it is worse than no worker at all: `cache.addAll` rejects as a unit, install
 * fails, and the site has a worker that can never activate — so the failure belongs here,
 * at the build, where it names the file.
 *
 * ## Why the revision is a hash of contents
 *
 * Not a timestamp and not a random. Two builds of the same tree have to produce the same
 * worker, byte for byte, or a redeploy of an unchanged site would rename every cache and
 * throw away the copy on every visitor's device. `e2e/offline.spec.ts` depends on precisely
 * that property to test the update path at all: it manufactures a second deploy by
 * appending a comment to `out/sw.js` — which changes the bytes the browser compares, the
 * only thing that triggers an update — and then asserts that the revision is unchanged so
 * `activate` deletes nothing and the other Playwright workers sharing that directory are
 * unaffected. That works because the revision is computed from the precached files and the
 * worker is not one of them: it can never hash itself.
 *
 * ## The output directory argument
 *
 * The build passes none and gets `apps/web/out`. `apps/web/src/lib/service-worker.test.ts`
 * passes a fixture, which is what lets a unit test run this script for real — the same
 * entry point the build runs, not a copy of its logic — against a tree it controls, before
 * any build has happened. CI runs `pnpm test` before `pnpm build`, so a guard that needed
 * a real export would be a guard that never ran.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = join(root, 'apps', 'web', 'public', 'sw.js');

/**
 * The same environment variable `next.config.ts` and `apps/web/src/app/base-path.ts` read,
 * read the same way and at the same moment — there is no request time to read it at.
 *
 * `base-path.ts` names "the service worker's scope, its precache list" as the callers that
 * have to carry it, and this is the precache list. A GitHub Pages project page serves at
 * `/<repo>/`, so a list of URLs beginning `/_next/` would 404 on every one of them and the
 * install would fail on the deployed host while passing everywhere it was tested. Read
 * here rather than imported because `base-path.ts` is TypeScript in the application's
 * build graph and this is a plain Node script; the variable is the shared thing, and it is
 * the one the export was produced with.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The URL a navigation falls back to. Precached, so the fallback is itself offline. */
const OFFLINE_ROUTE = `${BASE_PATH}/offline/`;

/**
 * The home page, which `e2e/offline.spec.ts` asserts by name and this did not.
 *
 * Checked here rather than left to the entry count, and the gap that closes is narrow and
 * would have been expensive to find. `shellDocuments` adds `/` only when `out/index.html`
 * exists, and `precacheList` fails only when *no* document at all was found — so an export
 * that emitted the sub-directory routes and not the root would sail through the count check
 * with well over twenty entries, produce a worker that installs cleanly, and fail six minutes
 * later in a browser on `expect(state.home).toBe(true)`, with nothing in the build log to say
 * which step had gone wrong. Every other thing that spec asserts about the list was already
 * held here by name; this one was the exception, and an exception in a guard is where the
 * next defect goes.
 */
const HOME_ROUTE = `${BASE_PATH}/`;

/**
 * What the spec asserts, restated here so a build cannot ship a list that would fail it.
 *
 * `e2e/offline.spec.ts` opens the shell cache and expects more than twenty entries. A run
 * that quietly precached four files would pass every other check in this script — the URLs
 * would all resolve, the revision would be stable — and fail six minutes later in a browser
 * with nothing to say about which build step went wrong.
 */
const MINIMUM_ENTRIES = 21;

const failures = [];

/** The faces left out of the precache by the range rule, URL → path, for the summary. */
const rangeGated = new Map();

function fail(detail) {
  failures.push(detail);
}

/** A URL under this site, as a path on disk. Query and fragment are not part of a file. */
function diskPath(out, url) {
  const path = url.split(/[?#]/)[0];
  if (!path.startsWith(`${BASE_PATH}/`)) return null;
  return join(out, path.slice(BASE_PATH.length));
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The exported documents that make up the shell: `index.html` at the top level, and one in
 * each directory directly beneath it. See the rule and its justification in the header.
 */
async function shellDocuments(out) {
  const routes = [];
  if (await isFile(join(out, 'index.html'))) routes.push(`${BASE_PATH}/`);
  let entries;
  try {
    entries = await readdir(out, { withFileTypes: true });
  } catch {
    return routes;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await isFile(join(out, entry.name, 'index.html')))
      routes.push(`${BASE_PATH}/${entry.name}/`);
  }
  return routes.sort();
}

/**
 * References out of one exported document.
 *
 * Only `src` and `href`, so an `og:image` in a `<meta content="...">` is not dragged in —
 * the 109 share images of #2453 are for other people's link previews and no visitor to this
 * site ever fetches one. Absolute paths only: a static export writes them that way, and
 * anything relative would need resolving against the document's own URL for no gain.
 */
function referencesIn(html) {
  const found = new Set();
  for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) found.add(url);
  return found;
}

/**
 * The code points a `unicode-range` descriptor covers, as `[first, last]` pairs, or `null` if
 * a token cannot be read. The same function as in `scripts/check-size.mjs`, for the reason
 * given there: both files are programs, so neither can import the other, and the emitted
 * worker is checked against the classification by that script on every build.
 */
function parseUnicodeRange(descriptor) {
  const ranges = [];
  for (const token of descriptor.split(',')) {
    const match = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(token.trim());
    if (match === null) return null;
    const [, first, last] = match;
    if (first.includes('?')) {
      if (last !== undefined) return null;
      ranges.push([
        parseInt(first.replaceAll('?', '0'), 16),
        parseInt(first.replaceAll('?', 'f'), 16),
      ]);
    } else {
      ranges.push([parseInt(first, 16), parseInt(last ?? first, 16)]);
    }
  }
  return ranges;
}

/** Does the range reach printable ASCII (U+0020–U+007E), the code points every English page renders? */
const coversBasicLatin = (ranges) => ranges.some(([first, last]) => first <= 0x7e && last >= 0x20);

const CSS_URL = /url\(\s*["']?(\/[^)"']+?)["']?\s*\)/g;

/**
 * References out of one stylesheet — which is where the typefaces are, and only there —
 * minus the faces a first visit never fetches, which the header explains.
 *
 * A face with no `unicode-range`, or one this cannot read, is kept: precaching a file that
 * was not needed costs bytes, leaving out one that was costs a return visit its typeface,
 * and `check-size.mjs` fails the build on an unreadable range anyway. The excluded URLs are
 * returned beside the kept ones so the summary at the end can say what was left out.
 */
function referencesInCss(css) {
  const left = new Set();
  for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const descriptor = /unicode-range\s*:\s*([^;}]+)/i.exec(block);
    if (descriptor === null) continue;
    const ranges = parseUnicodeRange(descriptor[1]);
    if (ranges === null || coversBasicLatin(ranges)) continue;
    for (const [, url] of block.matchAll(CSS_URL)) left.add(url);
  }
  const found = new Set();
  for (const [, url] of css.matchAll(CSS_URL)) if (!left.has(url)) found.add(url);
  return { found, left };
}

/**
 * Assemble the precache list: what to store, and where each entry is on disk.
 *
 * Returns URL/path pairs in URL order, so the revision below is computed over a stable
 * sequence and two runs of the same tree cannot disagree because a directory listing came
 * back in a different order.
 */
async function precacheList(out) {
  const entries = new Map();

  const add = async (url) => {
    if (entries.has(url)) return true;
    const path = diskPath(out, url);
    if (path === null || !(await isFile(path))) return false;
    entries.set(url, path);
    return true;
  };

  const documents = await shellDocuments(out);
  if (documents.length === 0) {
    fail(`${out} holds no exported documents — did \`next build\` run with output: 'export'?`);
    return [];
  }

  for (const route of documents) {
    const path = join(out, route.slice(BASE_PATH.length), 'index.html');
    entries.set(route, path);
    const html = await readFile(path, 'utf8');
    for (const url of referencesIn(html)) {
      if (url.startsWith(`${BASE_PATH}/_next/`)) {
        // A hashed asset the export promised. Missing means the export is incomplete, and
        // saying so here is far cheaper than an install that fails in a browser.
        if (!(await add(url))) fail(`${route} references ${url}, which the build did not emit`);
      } else {
        // A route link resolves to a directory and is skipped; a real file is an asset the
        // shell needs — the manifest and the icons.
        await add(url);
      }
    }
  }

  // Stylesheets are followed after the documents, because what they reference is invisible
  // to any amount of reading of the HTML.
  for (const [url, path] of [...entries]) {
    if (!url.endsWith('.css')) continue;
    const { found, left } = referencesInCss(await readFile(path, 'utf8'));
    for (const asset of found) {
      if (!(await add(asset))) fail(`${url} references ${asset}, which the build did not emit`);
    }
    for (const asset of left) {
      // Left to the runtime path, but it still has to exist: a face the stylesheet names and
      // the build did not emit is a broken export whichever cache it was going to land in.
      const onDisk = diskPath(out, asset);
      if (onDisk === null || !(await isFile(onDisk)))
        fail(`${url} references ${asset}, which the build did not emit`);
      else rangeGated.set(asset, onDisk);
    }
  }

  // And the manifest names icons that no page has a tag for: the maskable one exists so a
  // launcher can crop it, which is a surface only the manifest knows about.
  const manifest = entries.get(`${BASE_PATH}/manifest.webmanifest`);
  if (manifest !== undefined) {
    const icons = JSON.parse(await readFile(manifest, 'utf8')).icons ?? [];
    for (const icon of icons) {
      if (typeof icon.src === 'string' && !(await add(icon.src))) {
        fail(`manifest.webmanifest names the icon ${icon.src}, which the build did not emit`);
      }
    }
  }

  if (!entries.has(HOME_ROUTE)) {
    fail(
      `${HOME_ROUTE} is not in the precache list, so the one page every visitor reaches by` +
        ' typing the domain would be the one page that needs a connection. See the note on' +
        ' HOME_ROUTE for how an export can produce that and pass every other check here.',
    );
  }

  if (!entries.has(OFFLINE_ROUTE)) {
    fail(
      `${OFFLINE_ROUTE} is not in the export, so a navigation to a page this device has` +
        ' never held would fall back to nothing. The route is the offline fallback' +
        ' e2e/offline.spec.ts asks for by its heading, "Not saved to this device" (#193).',
    );
  }

  return [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A fingerprint of the shell, from the shell.
 *
 * Each entry contributes its URL as well as its contents, so a build that renames a file
 * without changing a byte of it — the export's own hashed names moving, a base path being
 * introduced — is a different revision, which it must be: the list a worker holds is part
 * of what a worker *is*. Truncated to sixteen hex characters, which is a cache name a human
 * can compare at a glance and still one in 2^64.
 */
function revisionOf(entries, contents) {
  const digest = createHash('sha256');
  for (const [index, [url]] of entries.entries()) {
    digest.update(url);
    digest.update('\0');
    digest.update(createHash('sha256').update(contents[index]).digest('hex'));
    digest.update('\n');
  }
  return digest.digest('hex').slice(0, 16);
}

/**
 * Substitute one placeholder, and insist it was there exactly once.
 *
 * Not a tolerant replace. A placeholder that has been renamed or removed in the source
 * would otherwise leave a worker that is syntactically fine and semantically empty — an
 * empty precache list, or a cache named `duelbox-shell-__REVISION__` that never changes
 * between deploys — and nothing downstream would notice until a device somewhere would not
 * update. This is the one moment the mismatch is visible.
 */
function substitute(text, placeholder, replacement) {
  const parts = text.split(placeholder);
  if (parts.length !== 2) {
    fail(
      `apps/web/public/sw.js contains ${String(parts.length - 1)} copies of the placeholder` +
        ` ${placeholder}, expected exactly one — the worker source and this script have` +
        ' drifted apart',
    );
    return text;
  }
  return parts.join(replacement);
}

async function emit(out) {
  const entries = await precacheList(out);
  if (failures.length > 0) return null;
  if (entries.length < MINIMUM_ENTRIES) {
    fail(
      `the precache list has ${String(entries.length)} entries, and e2e/offline.spec.ts` +
        ` requires more than ${String(MINIMUM_ENTRIES - 1)}. Either the export is incomplete` +
        ' or the rule that picks the shell has stopped picking it.',
    );
    return null;
  }

  const contents = await Promise.all(entries.map(([, path]) => readFile(path)));
  const revision = revisionOf(entries, contents);
  const urls = entries.map(([url]) => url);

  let worker = await readFile(source, 'utf8');
  worker = substitute(worker, "'__REVISION__'", JSON.stringify(revision));
  worker = substitute(worker, "'__OFFLINE__'", JSON.stringify(OFFLINE_ROUTE));
  worker = substitute(
    worker,
    "['__PRECACHE__']",
    `[\n${urls.map((url) => `  ${JSON.stringify(url)},`).join('\n')}\n]`,
  );
  if (failures.length > 0) return null;

  // Compile what is about to be written, without running it. A botched substitution is the
  // one failure this script can cause that every later check would sail past: `pnpm build`
  // would pass, `check-headers` and `check-size` never parse this file, and the first thing
  // to notice would be a browser refusing to register the worker on the deployed site.
  try {
    new Function(worker);
  } catch (error) {
    fail(`the emitted worker is not valid JavaScript: ${String(error)}`);
    return null;
  }

  await writeFile(join(out, 'sw.js'), worker);
  const raw = contents.reduce((sum, body) => sum + body.length, 0);
  const wire = contents.reduce((sum, body) => sum + gzipSync(body).length, 0);
  let gatedBytes = 0;
  for (const path of rangeGated.values()) gatedBytes += (await stat(path)).size;
  return { revision, entries: urls.length, raw, wire, gated: rangeGated.size, gatedBytes };
}

const out =
  process.argv[2] === undefined ? join(root, 'apps', 'web', 'out') : resolve(process.argv[2]);

console.log('emit-service-worker:');
const emitted = await emit(out);

if (emitted === null) {
  console.error('\nemit-service-worker: the worker was not written\n');
  for (const detail of failures) console.error(`  ✗ ${detail}`);
  console.error(
    '\nA worker with a bad precache list cannot install at all, so nothing is written' +
      ' rather than something that would fail in a browser. See docs/deploy.md.',
  );
  process.exitCode = 1;
} else {
  const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
  console.log(`  revision ${emitted.revision}`);
  console.log(
    `  precache: ${String(emitted.entries)} URL(s), ${kb(emitted.raw)} on disk,` +
      ` ${kb(emitted.wire)} over the wire — what a first visit installs`,
  );
  console.log(
    `  left to the runtime path: ${String(emitted.gated)} range-gated face(s),` +
      ` ${kb(emitted.gatedBytes)} — saved the first time a page draws a glyph in their range`,
  );
}
