/**
 * Every exported page that should carry schema.org markup does, and it parses (#198, #200).
 *
 * ## Why this exists as a build step rather than a unit test
 *
 * `lib/structured-data.ts` builds the objects and `structured-data.test.ts` holds their
 * shape — both real checks, and **neither of them can fail if a page stops rendering the
 * block**. The function would go on returning a perfect `VideoGame` for a page that no
 * longer prints one, which is the shape CLAUDE.md keeps a tally of: a guard aimed at the
 * thing beside the thing.
 *
 * What a search engine reads is the exported HTML, so that is what this reads. It runs in
 * `pnpm build` after the export, beside `check-headers.mjs` and for the same reason.
 *
 * ## What it will not do
 *
 * It does not validate against the Rich Results test. That is an external service, this
 * build has no network, and a check that silently passes when a fetch fails is worse than
 * no check. What it holds is everything a validator would fail on that can be seen from
 * here: the block exists, it is valid JSON, it is the right `@type`, and the properties
 * Google's VideoGame documentation marks required are present and non-empty.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'apps', 'web', 'out');

/** Every `<script type="application/ld+json">` payload in a page, parsed. */
function blocksIn(html) {
  const found = [];
  for (const match of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    found.push(match[1] ?? '');
  }
  return found;
}

/**
 * The directories directly under `out/<section>/`, which is one per game or per hub.
 *
 * `skip` names the directories that are parents rather than pages: `out/games/category/` holds
 * the eighteen hubs and is not itself exported. Named rather than inferred from "has no
 * index.html", because that inference is what would let a page that stopped being exported
 * pass as a directory nobody meant to check — the first draft of this file did exactly that
 * and reported 109 pages while examining 108.
 */
async function pagesUnder(section, skip = []) {
  const base = join(out, section);
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const pages = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || skip.includes(entry.name)) continue;
    pages.push(join(base, entry.name, 'index.html'));
  }
  return pages;
}

const failures = [];
const must = (ok, message) => {
  if (!ok) failures.push(message);
};

/**
 * The properties a `VideoGame` result needs to be a result rather than a link.
 *
 * From Google's own documentation for the type. `name` and `description` are what the card
 * shows; `url` is what makes the block about *this* page rather than about the site.
 */
const VIDEO_GAME_REQUIRED = ['name', 'description', 'url'];

async function check(section, type, required, skip = []) {
  const pages = await pagesUnder(section, skip);
  must(pages.length > 0, `no pages under out/${section}/ — the export has stopped writing them`);
  for (const page of pages) {
    const where = relative(out, page);
    let html;
    try {
      html = await readFile(page, 'utf8');
    } catch {
      failures.push(`${where} is not in the export — a route that used to be exported is gone`);
      continue;
    }
    const blocks = blocksIn(html);
    if (blocks.length === 0) {
      failures.push(`${where} carries no schema.org block, so it is a plain link in a result`);
      continue;
    }
    let parsed;
    try {
      parsed = blocks.map((block) => JSON.parse(block));
    } catch (error) {
      failures.push(`${where} has a schema.org block that is not valid JSON: ${String(error)}`);
      continue;
    }
    const match = parsed.find((block) => block?.['@type'] === type);
    if (match === undefined) {
      failures.push(
        `${where} has a schema.org block but none of type ${type} — found ` +
          parsed.map((block) => String(block?.['@type'])).join(', '),
      );
      continue;
    }
    must(
      match['@context'] === 'https://schema.org',
      `${where}'s ${type} block has no schema.org @context, so nothing will read it`,
    );
    for (const property of required) {
      const value = match[property];
      must(
        typeof value === 'string' ? value.length > 0 : value !== undefined && value !== null,
        `${where}'s ${type} block has no ${property}`,
      );
    }
  }
  return pages.length;
}

const games = await check('games', 'VideoGame', VIDEO_GAME_REQUIRED, ['category']);
const hubs = await check(join('games', 'category'), 'CollectionPage', ['name', 'url']);

// The catalogue index lives under `out/games/` too and is not a game, so it is checked as a
// page that must NOT claim to be one rather than left unexamined.
const index = await readFile(join(out, 'games', 'index.html'), 'utf8').catch(() => '');
must(
  !blocksIn(index).some((block) => {
    try {
      return JSON.parse(block)?.['@type'] === 'VideoGame';
    } catch {
      return false;
    }
  }),
  'out/games/index.html claims to be a VideoGame; it is the catalogue, not a game',
);

if (failures.length > 0) {
  console.error(`check-structured-data: ${String(failures.length)} problem(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `check-structured-data: ${String(games)} game page(s) and ${String(hubs)} hub(s) carry a` +
      ' valid block',
  );
}
