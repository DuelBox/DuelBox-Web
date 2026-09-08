/**
 * Every exported page names itself as canonical, once, and declares no locale pair it does
 * not have (#201).
 *
 * ## Why this runs on the export and not on the source
 *
 * The canonical is declared in `app/layout.tsx` as a relative `./` that Next resolves per
 * page, and three routes declare their own absolute one on top. Whether the two mechanisms
 * agree, whether a route quietly ends up with two, or with none, is a fact about the HTML a
 * crawler fetches — so that is what this reads, beside `check-headers.mjs` and
 * `check-structured-data.mjs`, which read the same files for the same reason.
 *
 * ## hreflang, and why the check is "none" rather than "all"
 *
 * The issue asks for hreflang pairs across locales. There is one locale. A page that declares
 * `hreflang` links for languages the site does not serve would be sending crawlers to 404s,
 * which is worse than the duplicate-content problem hreflang exists to prevent. So the rule
 * today is the honest inverse: no page carries an `hreflang` link, and when a second locale
 * lands (#219), this check is the one that fails first and turns into "every page carries a
 * pair for every locale, plus `x-default`". The failure message says so.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');

/**
 * The origin and base path every canonical must start with.
 *
 * Read from the export rather than from `lib/site.ts`, because this runs in Node and the
 * site module is TypeScript; the landing page's own canonical is the reference the rest are
 * held against, and a landing page with no canonical fails before anything is compared.
 */
async function pages(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await pages(full)));
    else if (entry.name === 'index.html') found.push(full);
  }
  return found;
}

const canonicalsIn = (html) =>
  [...html.matchAll(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"[^>]*>/g)].map((m) => m[1]);
const hreflangsIn = (html) => [...html.matchAll(/<link[^>]*hreflang="([^"]*)"[^>]*>/g)].length;

const failures = [];
const all = await pages(out);
if (all.length === 0) failures.push('no exported pages under apps/web/out — nothing to check');

const landing = all.find((page) => relative(out, page) === 'index.html');
const landingHtml = landing === undefined ? '' : await readFile(landing, 'utf8');
const [siteRoot] = canonicalsIn(landingHtml);
if (siteRoot === undefined) {
  failures.push('the landing page has no canonical, so there is no site root to hold the rest to');
}

const served = new Set(all);
let checked = 0;
for (const page of all) {
  const where = relative(out, page);
  const html = await readFile(page, 'utf8');
  const canonicals = canonicalsIn(html);
  if (where === join('404', 'index.html') || where === '404.html') {
    // The page that says a page does not exist names no canonical: `not-found.tsx` sets it
    // to null, because the inherited relative one resolved to `/_not-found/`, which the
    // export never serves.
    if (canonicals.length !== 0) {
      failures.push(`${where} is the 404 page and carries a canonical (${String(canonicals[0])})`);
    }
    continue;
  }
  if (canonicals.length !== 1) {
    failures.push(
      `${where} has ${String(canonicals.length)} canonical link(s); a page has exactly one`,
    );
    continue;
  }
  if (siteRoot !== undefined) {
    const canonical = String(canonicals[0]);
    const path = dirname(where) === '.' ? '' : `${dirname(where).split(sep).join('/')}/`;
    const own = `${siteRoot}${path}`;
    const noindex = /<meta[^>]*name="robots"[^>]*content="[^"]*noindex/.test(html);
    if (noindex) {
      // A page that asks not to be indexed may name another page as the one to index — the
      // embed surface does, pointing at the game's own page — but that page has to exist in
      // this export, or the canonical is a claim about a 404.
      if (!canonical.startsWith(siteRoot)) {
        failures.push(`${where} is noindex and points its canonical off-site: ${canonical}`);
      } else {
        const target = join(
          out,
          ...canonical.slice(siteRoot.length).split('/').filter(Boolean),
          'index.html',
        );
        if (!served.has(target)) {
          failures.push(
            `${where} points its canonical at ${canonical}, which this export does not serve`,
          );
        }
      }
    } else if (canonical !== own) {
      // `games/chess/index.html` must say `<root>games/chess/` — its own address, trailing
      // slash included, because that is the URL the export serves it at.
      failures.push(`${where} claims canonical ${canonical} but is served at ${own}`);
    }
  }
  const pairs = hreflangsIn(html);
  if (pairs > 0) {
    failures.push(
      `${where} carries ${String(pairs)} hreflang link(s) and the site has one locale — a pair for` +
        ' a language the site does not serve sends crawlers to 404s. When a second locale lands,' +
        ' rewrite this check to demand a pair for every locale plus x-default.',
    );
  }
  checked += 1;
}

if (failures.length > 0) {
  console.error(`check-canonicals: ${String(failures.length)} problem(s)\n`);
  for (const failure of failures.slice(0, 20)) console.error(`  ✗ ${failure}`);
  if (failures.length > 20) console.error(`  … and ${String(failures.length - 20)} more`);
  process.exitCode = 1;
} else {
  console.log(
    `check-canonicals: ${String(checked)} page(s) each name themselves once, under ${String(siteRoot)}`,
  );
}
