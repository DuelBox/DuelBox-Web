/**
 * One game, every named device class, both orientations, photographed and measured (#1891).
 *
 * Checking 107 games by hand at eight viewports is 856 manual checks, which is why nobody
 * did it. This is the command that does it for one game: `pnpm responsive <slug>`.
 *
 * ## What it opens, and why three states rather than one
 *
 * A game has three layouts and they fail independently. `/games/<slug>/` is the landing
 * page — prose, a hero, a play button — and it is the one a search engine sends people to.
 * `/play/<slug>/` before anybody presses anything is the **lobby**, which is where the mode
 * buttons live and where the per-game differences in the shell actually show up. And
 * `/play/<slug>/` with a match running is the layout that matters most: the board, the two
 * scoreboards and the pause button, which is the only state where a control under a notch
 * costs somebody a match. The match is started the way `e2e/resize.spec.ts` starts one —
 * press "Play together here", wait for the countdown to clear — so this measures the same
 * page that suite measures.
 *
 * ## The cells are the named classes and nothing else
 *
 * `docs/responsive.md` names five width classes and exactly one height class, and
 * `apps/web/src/styles/breakpoints.test.ts` fails a breakpoint outside that set. A matrix
 * with a sixth width in it would be measuring a screen the stylesheet has no opinion about,
 * so the table below is that document's table and is not allowed to grow a row on its own.
 *
 * Eleven cells: five classes in portrait, the same five with the axes swapped, and `short`,
 * which is a phone held sideways and is a height class rather than a width — 844x390, the
 * viewport `docs/responsive.md` records a 600x1000 board collapsing to 85px wide in.
 *
 * ## The insets are injected, because Playwright has none to offer
 *
 * A device descriptor sets a viewport, not a cutout: `env(safe-area-inset-*)` resolves to
 * zero in every headless run, on an iPhone profile as much as on a desktop one. So the
 * classes a notched phone actually occupies get the same treatment `e2e/safe-area.spec.ts`
 * gives a running match — the `--db-safe-*` tokens the whole layout is built on are set to a
 * real iPhone's values, and the question becomes whether the layout honours them, which is
 * the part we can be wrong about. Confirming the insets themselves arrive still needs a
 * physical device (#1885).
 *
 * Two classes get insets and the rest get zero, and which two is a fact about the device
 * rather than a preference. `playwright.config.ts`'s notched projects are `iPhone 14 Pro`,
 * 393x852 and 852x393 — the first is in the `compact` band (320px up to 480) and the second
 * is `short` by height. No tablet, laptop or wide screen has a cutout to clear, and
 * `e2e/safe-area.spec.ts` records why inventing one is worse than none: a layout that fails
 * an inset no device has is failing an imaginary device.
 *
 * ## What counts as a failure
 *
 * Horizontal overflow at any cell, and any visible interactive element outside the viewport
 * or inside the inset band. Those are the two the issue asks to fail automatically, and both
 * are bugs rather than preferences. The board's box is measured at every cell and printed,
 * and a board that hangs off an edge fails as well — `e2e/resize.spec.ts` already asserts
 * that for one game on every push, and there is no reading on which it is acceptable for the
 * other hundred and six.
 *
 * The bottom edge is the one that needs a qualifier, and the qualifier is per element rather
 * than per page: a control below the fold of a scroller is reachable and is not a finding,
 * while the same control in a container that *clips* is a control nobody can press. The play
 * route's scroller is `.db-main` and not the document, so asking the document alone reports
 * every mode button on a 320px lobby as buried under the home indicator. It does not.
 *
 * ## Dependencies
 *
 * `@playwright/test` and the Node standard library. The static server below is thirty lines
 * rather than a package because the thing being served is a directory of files.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const exportDir = join(root, 'apps', 'web', 'out');

/**
 * The five width classes of `docs/responsive.md`, portrait-first, with the height each is
 * measured at. Landscape is the same cell with its axes swapped, which is what turning a
 * device does. `notched` marks the classes a phone with a cutout actually reaches.
 */
const CLASSES = [
  { name: 'compact', width: 320, height: 568, notched: true },
  { name: 'phone', width: 480, height: 854, notched: false },
  { name: 'tablet', width: 640, height: 1024, notched: false },
  { name: 'laptop', width: 1024, height: 1366, notched: false },
  { name: 'wide', width: 1440, height: 2160, notched: false },
];

/**
 * The one height class. It has no second orientation: `short` *is* the sideways one, and a
 * 390x844 portrait phone is already the `phone` class above.
 */
const SHORT = { name: 'short', width: 844, height: 390, notched: true };

/**
 * Real insets, not a worst case no device has — the same values and the same reasoning as
 * `e2e/safe-area.spec.ts`. An iPhone insets the short edges: portrait the notch at the top
 * and the home indicator at the bottom, landscape the notch on both sides.
 */
function insetsFor(width, height) {
  return width > height
    ? { top: 0, right: 59, bottom: 21, left: 59 }
    : { top: 59, right: 0, bottom: 34, left: 0 };
}

const NO_INSET = { top: 0, right: 0, bottom: 0, left: 0 };

/** Every cell of the matrix, in the order they are photographed. */
function cells() {
  const out = [];
  for (const cls of CLASSES) {
    out.push({
      class: cls.name,
      orientation: 'portrait',
      width: cls.width,
      height: cls.height,
      inset: cls.notched ? insetsFor(cls.width, cls.height) : NO_INSET,
    });
    out.push({
      class: cls.name,
      orientation: 'landscape',
      width: cls.height,
      height: cls.width,
      inset: cls.notched ? insetsFor(cls.height, cls.width) : NO_INSET,
    });
  }
  out.push({
    class: SHORT.name,
    orientation: 'landscape',
    width: SHORT.width,
    height: SHORT.height,
    inset: insetsFor(SHORT.width, SHORT.height),
  });
  return out;
}

/** The three layouts a game has. `match` is the one that has to be driven to reach. */
const STATES = [
  { name: 'landing', path: (slug) => `/games/${slug}/`, play: false },
  { name: 'lobby', path: (slug) => `/play/${slug}/`, play: false },
  { name: 'match', path: (slug) => `/play/${slug}/`, play: true },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** Serves `apps/web/out` as plain files, the way a static host would. */
async function serveExport() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const wanted = decodeURIComponent(url.pathname);
    const candidates = wanted.endsWith('/')
      ? [join(wanted, 'index.html')]
      : [wanted, join(wanted, 'index.html'), `${wanted}.html`];
    void (async () => {
      for (const candidate of candidates) {
        const file = join(exportDir, normalize(candidate));
        // A traversal out of the export is a 403 rather than a read.
        if (!file.startsWith(exportDir + sep)) break;
        try {
          const info = await stat(file);
          if (!info.isFile()) continue;
          response.writeHead(200, {
            'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
            'content-length': String(info.size),
          });
          createReadStream(file).pipe(response);
          return;
        } catch {
          // Try the next shape.
        }
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
    })();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { origin: `http://127.0.0.1:${String(port)}`, close: () => server.close() };
}

/**
 * Everything one cell has to say, read in the page.
 *
 * Kept in one `evaluate` so the measurement is a single snapshot of one layout rather than
 * four round trips across a page that may still be settling.
 */
const MEASURE = (inset) => {
  const doc = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const overflow = doc.scrollWidth - doc.clientWidth;

  /**
   * Whether this element can be scrolled into view.
   *
   * Asked per element rather than once per page, because the play route's scroller is not
   * the document: `globals.css` gives `.db-main` `overflow: auto` so a viewport too short
   * for the board scrolls honestly rather than collapsing it, and the document itself stays
   * exactly one viewport tall. A page-level check reads that as "does not scroll" and then
   * reports every mode button below the fold as buried under the home indicator, which is
   * the false positive this exists to avoid. A container that clips instead — `hidden`,
   * with content past its edge — is not scrollable and is still a finding.
   */
  const reachable = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        node.scrollHeight - node.clientHeight > 1
      ) {
        return true;
      }
    }
    return doc.scrollHeight - doc.clientHeight > 1;
  };

  const offenders = [];
  const targets = document.querySelectorAll('button, a, [role="button"], input, select');
  for (const node of targets) {
    const el = /** @type {HTMLElement} */ (node);
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    // The skip link parks itself off-screen until focused; that is deliberate.
    if (el.classList.contains('db-skip')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const past = [];
    if (r.left < inset.left - 1) past.push('left');
    if (r.top < inset.top - 1) past.push('top');
    if (r.right > vw - inset.right + 1) past.push('right');
    if (r.bottom > vh - inset.bottom + 1 && !reachable(el)) past.push('bottom');
    if (past.length === 0) continue;
    const first = String(el.className || '').split(' ')[0];
    offenders.push(
      `${el.tagName.toLowerCase()}${first ? `.${first}` : ''} past ${past.join('+')} ` +
        `(${String(Math.round(r.left))},${String(Math.round(r.top))} → ` +
        `${String(Math.round(r.right))},${String(Math.round(r.bottom))})`,
    );
  }

  const canvas = document.querySelector('canvas');
  const box = canvas ? canvas.getBoundingClientRect() : null;
  return {
    overflow,
    viewport: { width: vw, height: vh },
    offenders,
    board: box
      ? {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        }
      : null,
  };
};

/** Presses the mode button and waits out the countdown, as `e2e/resize.spec.ts` does. */
async function startMatch(page) {
  await page.getByRole('button', { name: 'Play together here' }).click({ timeout: 15_000 });
  await page
    .getByRole('status')
    .filter({ hasText: /^[0-9]$|^Go$/ })
    .waitFor({ state: 'hidden', timeout: 15_000 });
}

async function measureCell(browser, origin, slug, state, cell, engine, outDir) {
  const context = await browser.newContext({
    viewport: { width: cell.width, height: cell.height },
    deviceScaleFactor: 1,
    baseURL: origin,
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}${state.path(slug)}`, { waitUntil: 'load' });
    if (cell.inset.top + cell.inset.right + cell.inset.bottom + cell.inset.left > 0) {
      await page.addStyleTag({
        content: `:root {
          --db-safe-top: ${String(cell.inset.top)}px;
          --db-safe-right: ${String(cell.inset.right)}px;
          --db-safe-bottom: ${String(cell.inset.bottom)}px;
          --db-safe-left: ${String(cell.inset.left)}px;
        }`,
      });
    }
    if (state.play) await startMatch(page);
    // One frame for the layout to settle under the viewport and the injected insets.
    await page.waitForTimeout(250);

    const probe = await page.evaluate(MEASURE, cell.inset);
    const shot = join(outDir, state.name, `${cell.class}-${cell.orientation}-${engine}.png`);
    await mkdir(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });

    const violations = [];
    if (probe.overflow > 0) {
      violations.push(`the page scrolls sideways by ${String(probe.overflow)}px`);
    }
    for (const offender of probe.offenders) violations.push(offender);
    if (probe.board) {
      const b = probe.board;
      if (b.width <= 40 || b.height <= 40) violations.push('the board collapsed');
      else if (b.x < -1 || b.y < -1) violations.push('the board starts off screen');
      else if (b.x + b.width > cell.width + 1 || b.y + b.height > cell.height + 1) {
        violations.push('the board ends off screen');
      }
    }
    return { ...probe, violations, shot };
  } catch (error) {
    return {
      overflow: 0,
      viewport: { width: cell.width, height: cell.height },
      offenders: [],
      board: null,
      violations: [`could not be measured: ${String(error).split('\n')[0]}`],
      shot: '',
    };
  } finally {
    await context.close();
  }
}

/** A fixed-width table, so a matrix pasted into an issue still lines up. */
function table(headers, rows) {
  const widths = headers.map((head, column) =>
    Math.max(head.length, ...rows.map((row) => String(row[column] ?? '').length)),
  );
  const line = (cellsIn) =>
    cellsIn
      .map((value, column) => String(value ?? '').padEnd(widths[column]))
      .join('  ')
      .trimEnd();
  return [
    line(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map((row) => line(row)),
  ].join('\n');
}

function usage(message) {
  process.stderr.write(`${message}\n\n`);
  process.stderr.write('  pnpm responsive <slug> [--engine=webkit] [--all-engines]\n\n');
  process.stderr.write(
    'Photographs and measures one game at every device class in `docs/responsive.md`,\n' +
      'in both orientations, on its landing page, its lobby and a running match.\n',
  );
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((arg) => !arg.startsWith('-'));
  if (!slug) usage('Name the game to check.');

  const engines = args.includes('--all-engines')
    ? ['chromium', 'webkit']
    : args.includes('--engine=webkit')
      ? ['webkit']
      : ['chromium'];

  // The export, not a dev server: what this measures has to be what ships.
  try {
    await stat(join(exportDir, 'index.html'));
  } catch {
    usage(`No static export at ${exportDir}. Run \`pnpm build\` first.`);
  }
  try {
    await stat(join(exportDir, 'play', slug, 'index.html'));
  } catch {
    usage(
      `This build has no /play/${slug}/ route. Check the slug against ` +
        '`apps/web/src/data/registry.ts` (PLAYABLE), and rebuild if it is new.',
    );
  }

  const outDir = join(root, 'responsive-matrix', slug);
  const server = await serveExport();
  const grid = cells();
  const rows = [];
  const bad = [];

  try {
    for (const engine of engines) {
      const browser = await (engine === 'webkit' ? webkit : chromium).launch();
      try {
        for (const state of STATES) {
          for (const cell of grid) {
            const result = await measureCell(
              browser,
              server.origin,
              slug,
              state,
              cell,
              engine,
              outDir,
            );
            const board = result.board
              ? `${String(result.board.width)}x${String(result.board.height)} at ` +
                `${String(result.board.x)},${String(result.board.y)}`
              : '—';
            rows.push([
              engine,
              state.name,
              cell.class,
              cell.orientation,
              `${String(cell.width)}x${String(cell.height)}`,
              result.overflow > 0 ? `+${String(result.overflow)}px` : 'none',
              String(result.offenders.length),
              board,
              result.violations.length === 0 ? 'ok' : 'FAIL',
            ]);
            for (const violation of result.violations) {
              bad.push([
                engine,
                state.name,
                `${cell.class}-${cell.orientation}`,
                `${String(cell.width)}x${String(cell.height)}`,
                violation,
              ]);
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
  }

  process.stdout.write(`\nResponsive matrix — ${slug}\n\n`);
  process.stdout.write(
    table(
      ['engine', 'state', 'class', 'orientation', 'viewport', 'overflow', 'outside', 'board', ''],
      rows,
    ),
  );
  process.stdout.write(`\n\nScreenshots: ${outDir}\n`);

  if (bad.length > 0) {
    process.stdout.write(`\n${String(bad.length)} violation(s)\n\n`);
    process.stdout.write(table(['engine', 'state', 'cell', 'viewport', 'what'], bad));
    process.stdout.write('\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\n${String(rows.length)} cells, no violations.\n`);
}

await main();
