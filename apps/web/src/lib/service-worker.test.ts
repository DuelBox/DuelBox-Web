import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The build step that finishes the service worker, run for real against a tree it cannot break.
 *
 * `apps/web/public/sw.js` ships with three placeholders in it and is useless until
 * `scripts/emit-service-worker.mjs` has filled them: a revision, the precache list, and the
 * URL of the offline page. Neither file is imported by anything, neither is type-checked,
 * neither is bundled — the worker is a classic script fetched by URL and the emitter is a
 * plain Node program — so the entire feedback loop for both of them was, until this file,
 * `pnpm build && pnpm e2e`: six minutes, four browsers, and a failure that says a cache had
 * the wrong number of entries rather than which build step put it there.
 *
 * ## What this holds, and why it is these things
 *
 * Everything here is a property of the *artefact* that a build can get wrong silently, and
 * nothing here is a property of a browser. The split is not tidiness. `check-zero-cost.mjs`
 * says it plainly at the end of its own docstring — what a static reading cannot do is prove
 * the caching strategy is right, and that is what `e2e/offline.spec.ts` is for. So this file
 * deliberately does not mock a `ServiceWorkerGlobalScope` and assert that a navigation is
 * answered from a cache: a fake CacheStorage that agreed with a wrong worker would be a guard
 * that is green about nothing, which is the failure CLAUDE.md counts ten of.
 *
 * What it does hold is every fact `e2e/offline.spec.ts` asserts about the *list*, moved to the
 * cheapest place that can still fail:
 *
 * - the source still has the three placeholders, and one of each. A renamed placeholder
 *   leaves a worker that is syntactically perfect and semantically empty — a cache called
 *   `duelbox-shell-__REVISION__` that is the same on every deploy, so no device ever updates.
 * - the list contains `/` and `/offline/` and more than twenty entries, which is the spec's
 *   first test restated where a failure names the build step.
 * - the 108 play documents are **not** in it. That is #196's job and it is not this change;
 *   a rule that quietly started matching them would multiply a first visit's install by a
 *   hundred and nothing else in the repository would notice.
 * - the revision is a pure function of the content of what is precached, in all four
 *   directions that matters in: the same tree twice, the same content at a different path,
 *   a changed byte, and — the one `e2e/offline.spec.ts` actually depends on — a comment
 *   appended to the emitted worker itself.
 * - `NEXT_PUBLIC_BASE_PATH` reaches every URL in the list. A GitHub Pages project page serves
 *   from `/<repo>/`, so a list of `/_next/…` URLs would 404 on every entry, `addAll` would
 *   reject as a unit, install would fail, and the worker would never activate — on the
 *   deployed host only, while passing everywhere it was tested.
 * - the three ways the emitter is supposed to refuse, each checked by watching it refuse.
 *
 * ## Why the fixture, and why the script is spawned rather than imported
 *
 * `apps/web/out` does not exist when this runs. CI runs `pnpm test` before `pnpm build`, so a
 * guard that needed a real export would be a guard that never ran on the machine of the person
 * who broke it. The fixture below is a small export with the same shape as a real one — nested
 * documents, hashed asset names, a stylesheet whose `url()` is the only mention of a font, a
 * manifest naming an icon no page has a tag for, three `@font-face` blocks differing only in
 * their `unicode-range` — which is enough to exercise every rule the emitter has.
 *
 * It is spawned as a child process because `scripts/emit-service-worker.mjs` is a program
 * rather than a module: it reads `process.argv`, sets `process.exitCode`, and writes its
 * failures to stderr. Importing it would run it on import, against the real `apps/web/out`,
 * at collection time. Spawning also means what is under test is the exact entry point
 * `pnpm build` invokes — not a re-export of its internals, which is how a guard comes to pass
 * against code the build does not run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const emitter = join(root, 'scripts', 'emit-service-worker.mjs');
const source = join(root, 'apps', 'web', 'public', 'sw.js');

/**
 * The routes the fixture export contains, one directory each with an `index.html` in it.
 *
 * Twenty-two of them plus the root, because the rule the emitter applies is "every
 * `index.html` at the top level or one directory down" and the number of entries that
 * produces is itself one of the things asserted below. `offline` and `games` are in the list
 * by name: the first is the fallback the worker cannot do without, and the second is there so
 * a document can link to it and the link can be shown to be skipped rather than precached.
 */
const ROUTES = [
  'offline',
  'games',
  'how-to-play',
  'settings',
  'privacy',
  'terms',
  'dmca',
  'attribution',
  '404',
  'about',
  'accessibility',
  'changelog',
  'contact',
  'credits',
  'faq',
  'feedback',
  'help',
  'licences',
  'press',
  'roadmap',
  'sitemap',
  'support',
];

const temporary: string[] = [];

afterEach(() => {
  while (temporary.length > 0) {
    const path = temporary.pop();
    if (path !== undefined) rmSync(path, { recursive: true, force: true });
  }
});

/**
 * A static export in miniature, written to a fresh temporary directory.
 *
 * The documents all reference the same stylesheet, chunk, manifest and icon, so the emitter's
 * de-duplication is exercised; the stylesheet's only content is a `url()`, because that is the
 * one reference in a real export that no amount of reading the HTML would find; and the
 * manifest names a second icon that no page has a tag for, which is the other one.
 *
 * `basePath` is prefixed onto every URL in the markup exactly as `next build` does with
 * `NEXT_PUBLIC_BASE_PATH` set, so a caller can hand the same value to the emitter and compare.
 */
function buildExport(basePath = '', routes: readonly string[] = ROUTES): string {
  const out = mkdtempSync(join(tmpdir(), 'duelbox-sw-'));
  temporary.push(out);

  const write = (relative: string, body: string): void => {
    const path = join(out, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  };

  const document = (title: string): string =>
    [
      '<!DOCTYPE html><html lang="en"><head>',
      `<title>${title}</title>`,
      `<link rel="stylesheet" href="${basePath}/_next/static/css/shell.a1b2c3.css"/>`,
      `<link rel="manifest" href="${basePath}/manifest.webmanifest"/>`,
      `<link rel="icon" href="${basePath}/icons/icon.svg" type="image/svg+xml"/>`,
      `<meta property="og:image" content="${basePath}/og/share.png"/>`,
      `<script src="${basePath}/_next/static/chunks/shell.d4e5f6.js" defer=""></script>`,
      '</head><body>',
      // A link to a route: a directory, not a file, and so not an asset to precache.
      `<a href="${basePath}/games/">Games</a>`,
      // A link two directories down: one of the 108 the shell deliberately leaves out.
      `<a href="${basePath}/play/chess/">Chess</a>`,
      '</body></html>',
    ].join('');

  write('index.html', document('DuelBox'));
  for (const route of routes) write(join(route, 'index.html'), document(route));
  write('play/chess/index.html', document('Chess'));

  // Three faces, one per rule the emitter applies to a `@font-face`: no `unicode-range` at
  // all, a range that reaches printable ASCII, and a range that does not. The third is the
  // one #224 turned on, and the one whose real files are 118 KB and 166 KB.
  write(
    '_next/static/css/shell.a1b2c3.css',
    `@font-face{font-family:F;src:url(${basePath}/_next/static/media/face.9a8b7c.woff2)}` +
      `@font-face{font-family:L;src:url(${basePath}/_next/static/media/latin.1c2d3e.woff2);` +
      'unicode-range:U+0000-00FF,U+2000-206F}' +
      `@font-face{font-family:S;src:url(${basePath}/_next/static/media/script.4f5a6b.woff2);` +
      'unicode-range:U+0900-097F,U+20B9,U+25CC}',
  );
  write('_next/static/chunks/shell.d4e5f6.js', 'console.log("shell");\n');
  write('_next/static/media/face.9a8b7c.woff2', 'not really a font');
  write('_next/static/media/latin.1c2d3e.woff2', 'not really a latin font');
  // On disk even though it is never precached: the emitter checks that a face it leaves out
  // exists, because a stylesheet naming a file the build did not emit is a broken export
  // whichever cache it was going to land in.
  write('_next/static/media/script.4f5a6b.woff2', 'not really a script font');
  write(
    'manifest.webmanifest',
    JSON.stringify({ name: 'DuelBox', icons: [{ src: `${basePath}/icons/maskable.svg` }] }),
  );
  write('icons/icon.svg', '<svg/>');
  write('icons/maskable.svg', '<svg/>');
  // Referenced only by an `og:image` meta, which the emitter must not follow: the 109 share
  // images are for other people's link previews and no visitor to this site fetches one.
  write('og/share.png', 'not really a png');

  return out;
}

interface Emitted {
  readonly ok: boolean;
  readonly output: string;
}

/** Run the build step the way `pnpm build` runs it, and report rather than throw. */
function emit(out: string, basePath = ''): Emitted {
  const run = spawnSync(process.execPath, [emitter, out], {
    encoding: 'utf8',
    env: { ...process.env, NEXT_PUBLIC_BASE_PATH: basePath },
  });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
}

/** The emitted worker, as a browser would receive it. */
function worker(out: string): string {
  return readFileSync(join(out, 'sw.js'), 'utf8');
}

/**
 * The precache list the emitted worker actually holds.
 *
 * Read back out of the file rather than out of the emitter's console summary, because the
 * file is what a browser installs and the summary is what a human reads. The array holds URL
 * string literals and nothing else, so a `]` ends it.
 */
function precacheOf(text: string): readonly string[] {
  const block = /const PRECACHE = \[([^\]]*)\]/.exec(text);
  expect(block, 'the emitted worker declares a PRECACHE array').not.toBeNull();
  return [...(block?.[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? '');
}

/** The revision the emitted worker names its caches for. */
function revisionOf(text: string): string {
  const found = /const REVISION = "([^"]*)";/.exec(text);
  expect(found, 'the emitted worker declares a REVISION string').not.toBeNull();
  return found?.[1] ?? '';
}

describe('the worker source', () => {
  /**
   * The three placeholders, one of each.
   *
   * `substitute` in the emitter already insists on exactly one and fails the build otherwise,
   * so this is not a second copy of that check — it is the same fact held at the *source*, in
   * the file a person edits, where a rename is caught by `pnpm test` rather than by a build
   * step that runs after everything else has passed. The quotes are part of each pattern
   * because the emitter substitutes them too: it replaces `'__REVISION__'` with a JSON string,
   * so a placeholder that lost its quotes would leave an undeclared identifier behind.
   */
  it('carries exactly one of each placeholder the emitter substitutes', () => {
    const text = readFileSync(source, 'utf8');
    for (const placeholder of ["'__REVISION__'", "'__OFFLINE__'", "['__PRECACHE__']"]) {
      expect(text.split(placeholder), `sw.js contains one ${placeholder}`).toHaveLength(2);
    }
  });

  /**
   * A classic worker script, not a module in the application's build graph.
   *
   * It is served verbatim out of `public/`, registered by URL and run in its own realm, so an
   * `import` in it is a syntax error in every browser and a `require` is an undefined
   * identifier. Neither `tsc` nor the bundler will ever look at this file, which is precisely
   * why it is worth saying here.
   */
  it('is plain script JavaScript with no module syntax', () => {
    const text = readFileSync(source, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/^\s*export\s/m);
    expect(text).not.toMatch(/\brequire\s*\(/);
  });
});

describe('the precache list', () => {
  it('holds the home page, the offline fallback and more than twenty entries', () => {
    const out = buildExport();
    expect(emit(out).ok).toBe(true);

    const urls = precacheOf(worker(out));
    expect(urls).toContain('/');
    expect(urls).toContain('/offline/');
    // The number `e2e/offline.spec.ts` asserts, held where a failure can name the build step.
    expect(urls.length).toBeGreaterThan(20);
    // A list is only atomic if it has no duplicates: `cache.addAll` rejects on two equal URLs,
    // and a rejected install is a worker that never activates.
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('leaves the play documents out, because saving every game is #196', () => {
    const out = buildExport();
    expect(emit(out).ok).toBe(true);

    const urls = precacheOf(worker(out));
    expect(urls.filter((url) => url.startsWith('/play/'))).toEqual([]);
  });

  /**
   * The two references that are invisible to any amount of reading of the HTML, and the one
   * that must stay invisible.
   *
   * A `url()` inside a stylesheet is how the self-hosted typefaces of #2469 are reached — no
   * document mentions them — and the maskable icon exists for a launcher, a surface only the
   * manifest knows about. The `og:image` is the other way round: it is in the markup, in a
   * `content` attribute, and following it would put 109 share images nobody on this site ever
   * fetches into every visitor's first install.
   */
  it('follows stylesheets and the manifest, and does not follow og:image', () => {
    const out = buildExport();
    expect(emit(out).ok).toBe(true);

    const urls = precacheOf(worker(out));
    expect(urls).toContain('/_next/static/media/face.9a8b7c.woff2');
    expect(urls).toContain('/icons/maskable.svg');
    expect(urls).toContain('/manifest.webmanifest');
    expect(urls.filter((url) => url.startsWith('/og/'))).toEqual([]);
  });

  /**
   * The rule #224 rests on, held at the cheapest place it can be held.
   *
   * A face whose `unicode-range` excludes printable ASCII is one no English page ever asks
   * for, so precaching it would install bytes the visit is never going to draw — 287,340 of
   * them for the two script faces alone, against a precache that is 375 KB over the wire.
   * `check-size.mjs` holds the same rule against the emitted worker on every build, but only
   * against the real export: this is the half that runs before a build exists, and the half
   * that can fail in both directions on a fixture whose faces were chosen to differ in
   * exactly the descriptor under test.
   *
   * Both directions, because only one of them is about bytes. A range-gated face in the list
   * is a first install a hundred kilobytes heavier than it looks; a *base* face left out of
   * it is a return visit with no connection rendering in the system face, which is the
   * failure #2469 shipped and the reason this list follows stylesheets at all.
   */
  it('leaves a range-gated face out and keeps the faces an English page fetches', () => {
    const out = buildExport();
    expect(emit(out).ok).toBe(true);

    const urls = precacheOf(worker(out));
    expect(urls).not.toContain('/_next/static/media/script.4f5a6b.woff2');
    expect(urls).toContain('/_next/static/media/latin.1c2d3e.woff2');
    // And the face with no `unicode-range` at all, which nothing gates.
    expect(urls).toContain('/_next/static/media/face.9a8b7c.woff2');
  });

  /**
   * `app/base-path.ts` names the precache list as a caller that has to carry the base path,
   * and this is the only thing that checks it does. The failure it prevents is invisible
   * everywhere it would be looked for: a project page at `/<repo>/` would 404 on every
   * `/_next/…` entry, `addAll` would reject as a unit, and the site would simply have no
   * working worker — on the deployed host, and on no development machine.
   */
  it('carries NEXT_PUBLIC_BASE_PATH onto every URL', () => {
    const base = '/DuelBox-Web';
    const out = buildExport(base);
    expect(emit(out, base).ok).toBe(true);

    const text = worker(out);
    const urls = precacheOf(text);
    expect(urls.length).toBeGreaterThan(20);
    for (const url of urls) expect(url.startsWith(`${base}/`), `${url} carries ${base}`).toBe(true);
    expect(urls).toContain(`${base}/`);
    expect(urls).toContain(`${base}/offline/`);
    // And the fallback the worker reaches for by name, which is a separate substitution.
    expect(text).toContain(`const OFFLINE_URL = "${base}/offline/";`);
  });
});

describe('the revision', () => {
  /**
   * A fingerprint of the content, and of nothing else.
   *
   * Two builds of the same tree have to produce the same worker, byte for byte. If they do
   * not, every redeploy of an unchanged site renames both caches, `activate` deletes the
   * previous ones, and every returning visitor re-downloads half a megabyte of a site that
   * did not change. A clock, a random, a counter or the path the export happens to sit at
   * would each break that, and the last of those is the one a `mkdtemp` fixture can catch:
   * the second export below has identical content at a different absolute path.
   */
  it('is the same for the same content, at a different path and on a second run', () => {
    const first = buildExport();
    const second = buildExport();
    expect(emit(first).ok).toBe(true);
    expect(emit(second).ok).toBe(true);
    const once = revisionOf(worker(first));

    expect(revisionOf(worker(second))).toBe(once);
    expect(emit(first).ok).toBe(true);
    expect(revisionOf(worker(first))).toBe(once);
  });

  /**
   * The property `e2e/offline.spec.ts` manufactures a second deploy with.
   *
   * It appends a trailing comment to `apps/web/out/sw.js` — which changes the bytes the
   * browser compares, the only thing that triggers an update — and then depends on the
   * revision being unchanged, so `activate` deletes nothing and the other Playwright workers
   * sharing that directory get a worker that behaves exactly like the one they would have
   * got. That holds only because the emitter reads `public/sw.js` and hashes the precached
   * files: the worker can never hash itself. A future emitter that folded its own output into
   * the digest would pass every other test in this file and break that spec, at a distance,
   * with a failure about cache counts.
   */
  it('does not change when a comment is appended to the emitted worker', () => {
    const out = buildExport();
    expect(emit(out).ok).toBe(true);
    const before = revisionOf(worker(out));

    const path = join(out, 'sw.js');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n// a new deploy\n`);
    expect(emit(out).ok).toBe(true);

    expect(revisionOf(worker(out))).toBe(before);
  });

  /**
   * And the half without which the two above would pass for a constant.
   *
   * "Same input, same revision" is satisfied by returning the letter `a`. What makes the
   * revision a fingerprint rather than a name is that a changed byte of anything precached
   * changes it — which is the whole update mechanism, since the cache names are derived from
   * it and `activate` deletes every cache that is not this one.
   */
  it('changes when a precached file changes', () => {
    const out = buildExport();
    expect(emit(out).ok).toBe(true);
    const before = revisionOf(worker(out));

    writeFileSync(join(out, '_next', 'static', 'chunks', 'shell.d4e5f6.js'), 'console.log("2");\n');
    expect(emit(out).ok).toBe(true);

    expect(revisionOf(worker(out))).not.toBe(before);
  });

  /** The cache names are the revision, which is what makes a deploy replace a device's copy. */
  it('names both caches', () => {
    const out = buildExport();
    expect(emit(out).ok).toBe(true);

    const text = worker(out);
    const revision = revisionOf(text);
    expect(revision).toMatch(/^[0-9a-f]{16}$/);
    expect(text).toContain('const SHELL_CACHE = `duelbox-shell-${REVISION}`;');
    expect(text).toContain('const RUNTIME_CACHE = `duelbox-runtime-${REVISION}`;');
    expect(text).not.toContain('__REVISION__');
    expect(text).not.toContain('__PRECACHE__');
    expect(text).not.toContain('__OFFLINE__');
  });
});

/**
 * The three ways it is supposed to refuse, watched refusing.
 *
 * A worker with a bad precache list cannot install at all — `cache.addAll` rejects as a unit —
 * so a site that shipped one would have a worker that could never activate and no symptom
 * beyond the feature quietly not existing. Every one of these therefore writes **nothing**
 * rather than something that would fail in a browser, and that is asserted alongside the exit
 * code: a non-zero exit that had already overwritten `out/sw.js` would leave the next `pnpm
 * build --continue` shipping the broken file.
 */
describe('when the export cannot support a worker', () => {
  const refuses = (out: string, naming: string): void => {
    const run = emit(out);
    expect(run.ok, `the emitter refuses:\n${run.output}`).toBe(false);
    expect(run.output).toContain(naming);
    expect(() => worker(out)).toThrow();
  };

  it('refuses an export with no offline page', () => {
    refuses(
      buildExport(
        '',
        ROUTES.filter((route) => route !== 'offline'),
      ),
      '/offline/ is not in the export',
    );
  });

  it('refuses an export with no home page', () => {
    const out = buildExport();
    rmSync(join(out, 'index.html'));
    refuses(out, '/ is not in the precache list');
  });

  it('refuses a list too short for what the spec asserts', () => {
    refuses(buildExport('', ['offline', 'games']), 'e2e/offline.spec.ts requires more than 20');
  });
});
