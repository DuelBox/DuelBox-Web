import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `/.well-known/security.txt` has to survive the deploy, not merely the build.
 *
 * `emit-host-config.mjs` wrote both the canonical path and the legacy root copy, and had
 * done since the script was written. The canonical one still answered 404 on the live
 * origin while the root one answered 200 (#2513), because the gap is not in the build:
 *
 *   `actions/upload-pages-artifact` archives the output with
 *   `tar --exclude='.[^/]*'` unless `include-hidden-files: true` is set, and its default
 *   is `false`. Every dot-path in `apps/web/out` was dropped on the way to Pages —
 *   `.well-known/` and, silently, the `.nojekyll` the workflow touches on the line above.
 *
 * That is the failure this repository keeps finding: a step that runs, reports success, and
 * produces nothing. The build-side assertion below would have passed throughout, so it is
 * the workflow this mainly checks.
 */

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const OUT = join(ROOT, 'apps/web/out');
const DEPLOY = join(ROOT, '.github/workflows/deploy.yml');

/** RFC 9116 §3. The root copy is the legacy location, not a substitute for this one. */
const CANONICAL = '.well-known/security.txt';

describe('the deploy workflow', () => {
  const workflow = readFileSync(DEPLOY, 'utf8');

  it('uploads the output that the build produced', () => {
    expect(workflow).toContain('actions/upload-pages-artifact');
    expect(workflow).toContain('path: apps/web/out');
  });

  it('does not throw away the dot-paths the build wrote', () => {
    // Without this line the canonical security.txt and the .nojekyll are both excluded
    // from the artifact, and nothing anywhere says so.
    expect(
      /include-hidden-files:\s*true/.test(workflow),
      'upload-pages-artifact excludes dot-paths by default — set include-hidden-files: true',
    ).toBe(true);
  });
});

describe('the emitted security.txt', () => {
  const emitter = readFileSync(join(ROOT, 'scripts/emit-host-config.mjs'), 'utf8');

  it('is written to the canonical path as well as the legacy one', () => {
    expect(emitter).toContain(".well-known'");
    expect(emitter).toContain("'security.txt'");
  });

  /**
   * Skipped rather than failed when there is no export: `pnpm test` runs on a clean
   * checkout with no `out/`, and a test that demanded one would be a test people learn to
   * ignore. After `pnpm build` it is the assertion that matters.
   */
  it.skipIf(!existsSync(OUT))('exists in the export, byte-identical to the root copy', () => {
    const canonical = join(OUT, CANONICAL);
    expect(existsSync(canonical), `${CANONICAL} is missing from apps/web/out`).toBe(true);
    expect(readFileSync(canonical, 'utf8')).toBe(readFileSync(join(OUT, 'security.txt'), 'utf8'));
  });

  it.skipIf(!existsSync(OUT))('has not expired', () => {
    const body = readFileSync(join(OUT, CANONICAL), 'utf8');
    const expires = /^Expires:\s*(.+)$/m.exec(body)?.[1];
    expect(expires, 'RFC 9116 requires an Expires field').toBeDefined();
    expect(new Date(expires ?? '').getTime()).toBeGreaterThan(Date.now());
  });
});
