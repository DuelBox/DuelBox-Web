/**
 * How long each class of file may be kept, and why the answer is not the same for all of
 * them (#188).
 *
 * `security-headers.mjs` next door is a flat set: nine headers, every path, no exceptions.
 * Caching cannot be written that way, because the right answer turns entirely on one
 * property of the URL — **does the URL change when the bytes change?** — and this export
 * contains both kinds of file. Confusing them is expensive in either direction: a year on a
 * document strands a visitor on a build that no longer exists, and ten minutes on a hashed
 * chunk makes every returning visitor pay a round trip per file to be told nothing changed.
 *
 * ## The two classes
 *
 * **`_next/static/*` — the URL carries the content.** Next names every chunk, stylesheet and
 * font by a hash of its own bytes: `chunks/1011.0aaf009eab96e5d7.js`,
 * `css/1614a6a4f9fdc41c.css`, `media/fredoka-latin.bca7023b.woff2`. Change a byte and the
 * name changes, so an old URL is never asked to serve new content — which is the entire
 * precondition for `immutable`, and it is a property of the build rather than a promise made
 * here. `check-headers.mjs` reads it back out of the export on every build rather than
 * believing it: **every file that rule matches must carry a hash in its name**, and nothing
 * outside `_next/static/` may be matched by it.
 *
 * `immutable` is not decoration on top of a long `max-age`. `max-age=31536000` alone still
 * sends a conditional request on a reload, because a browser treats an explicit reload as a
 * reason to revalidate everything on the page — so a returning visitor who presses reload
 * pays 177 round trips to be told 304 each time. `immutable` is the directive that says: do
 * not ask, not even then. That is 86 KB of fonts and 129 KB of shell neither re-fetched nor
 * re-checked, and it is what #188's "no revalidation of hashed assets" actually asks for.
 *
 * **Everything else — the URL is stable and the bytes are not.** Documents (`/`,
 * `/play/<slug>/`, all 223 of them), the router's `index.txt` payloads, `sw.js`,
 * `manifest.webmanifest`, `sitemap.xml`, `robots.txt`, the `.well-known` files, and
 * `_headers` and `vercel.json` themselves. Every one of those keeps its URL across a deploy
 * and gets new content, so a cached copy is last week's site. They get
 * `public, max-age=0, must-revalidate`: storable, and re-checked before reuse. Not
 * `no-store` — the file may be cached, it must be asked about, and a 304 costs one round
 * trip and no payload.
 *
 * ## Why there is no catch-all `Cache-Control` in `_headers`
 *
 * The obvious file is the one this was nearly written as:
 *
 *     /*
 *       Cache-Control: public, max-age=0, must-revalidate
 *     /_next/static/*
 *       Cache-Control: public, max-age=31536000, immutable
 *
 * It is wrong, and it is wrong in the way this repository keeps finding things wrong: it
 * passes every check you would think to write, and the feature does not work.
 * Cloudflare documents the semantics of an overlapping `_headers` rule and it is **not**
 * "the more specific one wins" — it is a join. From
 * <https://developers.cloudflare.com/workers/static-assets/headers/>, and word for word the
 * same on the Pages page: "An incoming request which matches multiple rules' URL patterns
 * will inherit all rules' headers", and "if a header is applied twice in the `_headers`
 * file, the values are joined with a comma separator."
 *
 * So a request for a hashed chunk would be answered
 * `Cache-Control: public, max-age=0, must-revalidate, public, max-age=31536000, immutable`,
 * and a recipient reading the first `max-age` it meets gets zero. The immutable half is
 * inert, every asset revalidates, the acceptance criterion is false, and `_headers` contains
 * the word `immutable` so any check that greps for it is green.
 *
 * A `_headers` file therefore cannot express "this everywhere, except there". Every rule it
 * contains must be **disjoint**, which is what `CACHE_RULES` below is, and which
 * `check-headers.mjs` enforces by resolving every exported file against the emitted rules
 * and failing if any path matches two of them.
 *
 * That leaves the documents without a rule of their own on those hosts, and the honest thing
 * is to say what they get instead rather than to imply it is unset. All three hosts that
 * read these files document the same default, and it is the value this module would have
 * written: Cloudflare sends `Cache-Control: public, max-age=0, must-revalidate` on a static
 * asset, and "headers defined in the `_headers` file override what Cloudflare ordinarily
 * sends"; Netlify's documented default for static assets is the identical string. The
 * enumeration that would make it explicit — one rule per top-level path, so that none of
 * them overlaps `/_next/` — comes to 45 rules that grow with every route added, and this
 * file already carries the story of a 150-rule design abandoned against the same 100-rule
 * limit. Two disjoint rules and a written-down default is the better trade, and
 * `docs/release-runbook.md` checks the default against the live origin, which is the only
 * place a default can be checked at all.
 *
 * `vercel.json` is not stuck with that, because Vercel's `source` is a path-to-regexp
 * pattern and can express a complement directly. So on Vercel the documents get the rule
 * written out, and the three sources there are disjoint by construction — see
 * `VERCEL_CACHE_RULES`. The server snippet has it easiest of all: nginx `location`, Apache
 * `<If>`/`<Else>` and a Caddy matcher are each exclusive, so the default and the exception
 * can be stated side by side without either qualifying the other.
 *
 * ## Why `sw.js` gets a rule of its own
 *
 * Because it is the one file where a wrong answer cannot be fixed from here, and because on
 * a host whose default is generous it would otherwise inherit it silently. `docs/deploy.md`
 * has the mechanism at length: the browser re-fetching `sw.js` and finding different bytes
 * is the *only* thing that tells a device which already has the site that a new build
 * exists. Serve it long and the deploy is live, correct, and invisible to everybody who
 * already has it. The 24-hour cap the specification puts on a worker script's own HTTP cache
 * bounds that damage; it is not a defence, and neither is `updateViaCache: 'imports'`, which
 * is a property of the registration rather than of the host. So the host is told explicitly,
 * in its own file, what this one file needs.
 *
 * ## Where none of this arrives
 *
 * GitHub Pages reads neither `_headers` nor `vercel.json`, so on the host this repository
 * actually deploys to these rules reach nobody — exactly as seven of the nine security
 * headers do, and for exactly the same reason. What makes a repeat visit free there is the
 * service worker (`e2e/offline.spec.ts`, "the second play of a game costs no network request
 * at all"), a different mechanism answering the same requirement, which needs no host
 * configuration at all. On a host that reads either file the CDN half applies too and the
 * two compose: the worker answers from the device, and what it does not hold comes back from
 * the edge without a revalidation.
 *
 * `Cache-Control` is deliberately **not** a member of `SECURITY_HEADERS`, so it does not
 * appear in `header-delivery.mjs`'s served-versus-discarded table — it is not a security
 * header and that table is about that set. The paragraph above is what would otherwise have
 * gone missing, and `docs/deploy.md` carries it where a reader will meet it.
 */

/**
 * Where the site is served from, if it is not the root — the fifth place a hand-built URL
 * has to carry it, after the four `apps/web/src/app/base-path.ts` names.
 *
 * Empty on every host that reads these files, because the variable exists for the GitHub
 * Pages project page and that host reads neither. Carried anyway: a rule path is absolute,
 * so a base-path build with a root-relative `/_next/static/*` in it would match nothing and
 * fail silently, which is the one failure this module exists to prevent.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** A year, and never ask. The second half is the part that matters; see above. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Storable, and re-checked before reuse. Everything whose URL outlives its bytes. */
export const REVALIDATE_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/** The prefix the immutable rule covers, named once so three renderers cannot disagree. */
export const HASHED_ASSET_PREFIX = `${BASE_PATH}/_next/static/`;

/** The worker script, named once for the same reason. */
export const SERVICE_WORKER_PATH = `${BASE_PATH}/sw.js`;

/**
 * The `_headers` rules: disjoint, because that file cannot express an exception (above).
 *
 * `why` is not decoration. The emit step prints it into the file as a comment, and it is
 * what a reader has instead of this module when they are looking at a `_headers` in an
 * export they did not build.
 */
export const CACHE_RULES = Object.freeze([
  Object.freeze({
    path: `${HASHED_ASSET_PREFIX}*`,
    value: IMMUTABLE_CACHE_CONTROL,
    why: 'content-hashed by Next: a changed byte is a changed URL, so this one cannot go stale',
  }),
  Object.freeze({
    path: SERVICE_WORKER_PATH,
    value: REVALIDATE_CACHE_CONTROL,
    why: 'the only signal a device that already has the site gets that a new build exists',
  }),
]);

/**
 * The same three classes for Vercel, whose `source` is path-to-regexp and can say "everything
 * except". The complement is written out rather than left to the platform default, and the
 * three patterns are mutually exclusive so nothing depends on a precedence rule Vercel does
 * not document.
 */
export const VERCEL_CACHE_RULES = Object.freeze([
  Object.freeze({
    source: `${HASHED_ASSET_PREFIX}(.*)`,
    value: IMMUTABLE_CACHE_CONTROL,
  }),
  Object.freeze({ source: SERVICE_WORKER_PATH, value: REVALIDATE_CACHE_CONTROL }),
  Object.freeze({
    source: `${BASE_PATH}/((?!_next/static/|sw\\.js).*)`,
    value: REVALIDATE_CACHE_CONTROL,
  }),
]);

/**
 * A filename that carries a hash of its own contents.
 *
 * Three shapes, all of them Next's: `name.0aaf009eab96e5d7.js`, `name-2f09f954abcd.js`, and
 * the bare `1614a6a4f9fdc41c.css` a stylesheet gets. Eight hex digits is the shortest of
 * them; the bound is higher for a bare name, because a whole filename of nothing but hex is
 * otherwise easy to write by accident.
 */
export const HASHED_FILENAME = /(?:[.-][0-9a-f]{8,}|^[0-9a-f]{16,})\.[a-z0-9]+$/;

/**
 * `_next/static/<buildId>/_buildManifest.js` and `_ssgManifest.js` — the two files under
 * `_next/static/` with no hash in the name, and the reason this is a function rather than
 * one more branch of the regex above.
 *
 * They are pages-router surface this app-router export never loads (`check-size.mjs` found
 * 94.8 KB of the same family and says so), but they are *served*, and the immutable rule
 * matches them. What makes that safe is not the filename, it is the directory: Next's build
 * id is a fresh random string per build, so the URL is new on every deploy and an old one is
 * never reused for different bytes — the same property the hashes give, one segment up.
 *
 * It stops being true the moment somebody pins `generateBuildId` in `next.config.ts` to get
 * reproducible builds, which is a reasonable thing to want and would leave these two URLs
 * stable across deploys with a year on them. `check-headers.mjs` reads the build id out of
 * `.next/BUILD_ID` and the config out of the source, and goes red on exactly that change
 * rather than leaving it to be discovered.
 */
export function isBuildIdFile(relativePath, buildId) {
  if (typeof buildId !== 'string' || buildId.length === 0) return false;
  const parts = relativePath.split('/');
  return parts.length === 2 && parts[0] === buildId;
}

/** Content-addressed: this URL cannot be asked to serve different bytes later. */
export function isContentAddressed(relativePath, buildId) {
  const name = relativePath.split('/').pop() ?? '';
  return HASHED_FILENAME.test(name) || isBuildIdFile(relativePath, buildId);
}

/** `/_next/static/*` as a matcher. `*` is the only metacharacter a `_headers` path has. */
export function globToRegExp(pattern) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

/** A Vercel `source` as a matcher. The patterns emitted here are their own regular expressions. */
export function sourceToRegExp(source) {
  return new RegExp(`^${source}$`);
}

/**
 * Every rule whose `Cache-Control` matches a path — a list, not a winner, because the
 * question worth asking of these files is whether two of them ever match the same path at
 * all. On Cloudflare two matches are joined rather than resolved, so a second match is the
 * bug, not a tie to be broken.
 *
 * Takes rules parsed out of the emitted file rather than the constants above, so what gets
 * checked is the artefact. Asserting that this module contains what this module contains
 * would pass happily on a build where the emit never ran.
 */
export function cachingRulesFor(rules, urlPath, toRegExp = globToRegExp) {
  return rules.filter((rule) => rule.value !== null && toRegExp(rule.path).test(urlPath));
}

/**
 * Read a `_headers` file back into rules. Deliberately narrow: a path line starts at column
 * zero, a header line is indented, everything else is a comment or a blank. That is the whole
 * grammar of the file this repository emits, and a parser that accepted more would be
 * accepting things the emit cannot produce.
 */
export function parseHeadersFile(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: new Map() });
      continue;
    }
    const separator = line.indexOf(':');
    const current = rules.at(-1);
    if (separator < 0 || current === undefined) continue;
    current.headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return rules.map((rule) => ({
    path: rule.path,
    value: rule.headers.get('Cache-Control') ?? null,
  }));
}

/** The same, for `vercel.json`. `path` is Vercel's `source`, matched as a regular expression. */
export function parseVercelJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed?.headers) ? parsed.headers : [];
  return entries.map((entry) => ({
    path: String(entry?.source ?? ''),
    value:
      (Array.isArray(entry?.headers) ? entry.headers : []).find(
        (header) => header?.key === 'Cache-Control',
      )?.value ?? null,
  }));
}
