/**
 * The WebGL backend is in the bundle exactly when the build asked for it (#16).
 *
 * `docs/support-matrix.md` says no WebGL is required, and the way that stays true with a
 * WebGL renderer in the repository is that the renderer is reached only through an
 * `import()` inside `if (process.env.NEXT_PUBLIC_RENDERER === 'webgl')`, which the build
 * folds to `if (false)` and deletes. This is the check that the fold happened, in the same
 * three parts `check-zero-cost.mjs` uses for the debug overlay, because a search of a build
 * for a string that nothing has ever contained passes forever.
 *
 * One: the marker still identifies the module in source. Two: with the flag off, no emitted
 * chunk contains it, and no chunk asks a canvas for a WebGL context. Three: with the flag on,
 * exactly one chunk contains it — the async one — so the guard has been seen to find the
 * thing it looks for, on a build where it should.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const chunks = join(root, 'apps', 'web', 'out', '_next', 'static', 'chunks');
const source = join(root, 'packages', 'engine', 'src', 'webgl-renderer.ts');

/** The literal `webgl-renderer.ts` exports as `WEBGL_RENDERER_MARKER` and puts in its errors. */
const MARKER = 'duelbox-webgl-renderer';
/** What the host asks a canvas for when the flag is on; absent from every chunk when it is off. */
const CONTEXT_REQUEST = /getContext\(["']webgl["']/;

const enabled = process.env.NEXT_PUBLIC_RENDERER === 'webgl';

async function scripts(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await scripts(full)));
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

const failures = [];

// One: the marker is still what it says it is, or this check searches for nothing.
const engineSource = await readFile(source, 'utf8').catch(() => '');
if (!engineSource.includes(`'${MARKER}'`)) {
  failures.push(
    `packages/engine/src/webgl-renderer.ts no longer contains '${MARKER}', so searching the` +
      ' build for it proves nothing. Restore the marker or change it here too.',
  );
}

const files = await scripts(chunks);
if (files.length === 0) failures.push('no chunks under apps/web/out — build first');

const carrying = [];
const asking = [];
for (const file of files) {
  const text = await readFile(file, 'utf8');
  if (text.includes(MARKER)) carrying.push(relative(chunks, file));
  if (CONTEXT_REQUEST.test(text)) asking.push(relative(chunks, file));
}

if (!enabled) {
  // Two: off means off. Not "unfetched", not "small" — absent.
  for (const file of carrying) {
    failures.push(
      `${file} carries the WebGL renderer with NEXT_PUBLIC_RENDERER unset — the import() was` +
        ' not folded away, so every play visitor pays for a backend nobody switched on',
    );
  }
  for (const file of asking) {
    failures.push(`${file} asks a canvas for a WebGL context with the flag off`);
  }
} else {
  // Three: on means exactly one async chunk, and the host asks for the context.
  if (carrying.length !== 1) {
    failures.push(
      `NEXT_PUBLIC_RENDERER=webgl and ${String(carrying.length)} chunk(s) carry the renderer;` +
        ' it should be exactly one — the async chunk the import() makes' +
        (carrying.length > 0 ? `: ${carrying.join(', ')}` : ''),
    );
  }
  if (asking.length === 0) {
    failures.push('NEXT_PUBLIC_RENDERER=webgl and no chunk asks a canvas for a WebGL context');
  }
}

if (failures.length > 0) {
  console.error(`check-renderer-flag: ${String(failures.length)} problem(s)\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else if (enabled) {
  console.log(`check-renderer-flag: WebGL renderer in one chunk (${carrying[0] ?? '?'}), as asked`);
} else {
  console.log(
    `check-renderer-flag: no WebGL in any of ${String(files.length)} chunk(s); the flag is off`,
  );
}
