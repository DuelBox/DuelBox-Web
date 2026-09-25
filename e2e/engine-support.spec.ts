import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * A browser that runs script and still cannot draw (#225).
 *
 * `docs/support-matrix.md` promises an unsupported browser a clear message rather than a
 * broken page. `e2e/no-javascript.spec.ts` holds one half of that — scripting off. This is
 * the other: an engine modern enough to execute the bundle and too old to give it a canvas.
 * Before the probe, `createRendererBackend` returned null, `GameHost` returned from its
 * mount effect on that null, and the player who pressed Play watched an empty rectangle
 * with nothing anywhere saying why.
 *
 * ## Stubbing, not emulating
 *
 * There is no browser build available here that lacks a 2D context, so the capability is
 * taken away instead: `HTMLCanvasElement.prototype.getContext` is made to return null in an
 * init script, which runs before any page script and is exactly what the probe would meet on
 * such an engine. One capability, because the probe's other five are unit-tested in
 * `apps/web/src/lib/engine-support.test.ts` against fakes; what a real browser adds is the
 * two things a fake cannot show — that the panel renders, and that the game chunk is not
 * fetched.
 *
 * ## The control is the point
 *
 * The last test loads the same route with nothing stubbed and reaches the lobby. Without it
 * every assertion here would pass on a probe that refused every browser on earth, which is
 * the failure mode a capability check actually has.
 */

/** `getContext` answers null for everything, as an engine with no 2D support does. */
const NO_CANVAS_CONTEXT = `
  HTMLCanvasElement.prototype.getContext = function () {
    return null;
  };
`;

/**
 * The built chunk for one game, found the way `scripts/check-size.mjs` finds all 108: by the
 * `id:"<slug>"` its manifest carries, not by its filename, which is a content hash.
 *
 * A request counter that matched `/chunks/` would count the route's own scripts and prove
 * nothing; this names the one file whose arrival means the game itself was downloaded.
 */
function gameChunkName(slug: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '../apps/web/out/_next/static/chunks');
  const named = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((entry) => {
    if (!entry.endsWith('.js')) return false;
    const source = readFileSync(join(dir, entry), 'utf8');
    return source.includes(`id:"${slug}"`) || source.includes(`id:'${slug}'`);
  });
  // Exactly one, or the identification is wrong and every assertion below is vacuous.
  expect(named, `no single built chunk carries id:"${slug}"`).toHaveLength(1);
  return named[0] as string;
}

test.describe('a browser that cannot give the page a canvas', () => {
  test('is told so, and is never sent the game', async ({ page }) => {
    const chunk = gameChunkName('tic-tac-toe');
    const fetched: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes(chunk)) fetched.push(request.url());
    });

    await page.addInitScript(NO_CANVAS_CONTEXT);
    await page.goto('/play/tic-tac-toe/');

    const panel = page.getByRole('alert');
    await expect(
      panel.getByRole('heading', { name: 'This browser cannot run the games' }),
    ).toBeVisible();
    // The reason, in words a visitor can act on. Its text is `REASON_TEXT.canvas`.
    await expect(panel.getByText('It will not give this page a drawing surface')).toBeVisible();

    // Both ways out of the panel, and where each goes.
    await expect(panel.getByRole('link', { name: 'Tic Tac Toe' })).toHaveAttribute(
      'href',
      '/games/tic-tac-toe/',
    );
    await expect(panel.getByRole('link', { name: 'How to play' })).toHaveAttribute(
      'href',
      '/how-to-play/',
    );

    // Nothing starts. No lobby, so no countdown, so no canvas that never begins.
    await expect(page.getByRole('button', { name: 'Play together here' })).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);

    // The whole point of probing before `loadGame`: a browser that cannot play is not
    // charged for the game it cannot play.
    expect(fetched, `the game chunk ${chunk} was fetched anyway`).toEqual([]);
  });

  /**
   * The control. Same route, nothing stubbed: the panel is absent, the game chunk *is*
   * fetched and the lobby is reached — so a probe that had begun refusing everybody would
   * fail here rather than pass everywhere.
   */
  test('while a browser that can draw still reaches the lobby', async ({ page }) => {
    const chunk = gameChunkName('tic-tac-toe');
    const fetched: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes(chunk)) fetched.push(request.url());
    });

    await page.goto('/play/tic-tac-toe/');
    await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'This browser cannot run the games' }),
    ).toHaveCount(0);
    expect(fetched.length, 'the game chunk was never fetched on a healthy browser').toBeGreaterThan(
      0,
    );
  });
});
