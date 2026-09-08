import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The two backends draw the same picture (#16).
 *
 * Node has no WebGL, so this is the one place the WebGL renderer meets a GPU. It does not go
 * through the app at all: the published build has the flag off and ships no WebGL, and
 * building the export twice to compare backends would double the e2e job. Instead the
 * engine's own `dist` — the same ESM the app bundles — is served under a routed prefix on
 * the site's origin, a harness page imports `Canvas2DRenderer` and `WebGLRenderer` from it,
 * draws one scene with each into two canvases of the same size, and the pixels are compared.
 *
 * Chromium only, in `CHROMIUM_ONLY`: headless WebKit's WebGL is software-rendered when it is
 * available at all and its anti-aliasing differs enough to make a tolerance meaningless, and
 * the flag is off in every build WebKit users get.
 *
 * The tolerance is a fraction of pixels that differ by more than a threshold, not a hash:
 * a polygonal circle and an arc differ along their edge, and the browser's text rasteriser
 * places glyphs at subpixel offsets a texture cannot. Both are edges. What a real defect
 * looks like — a colour wrong, a shape missing, a rotation the wrong way, text upside down,
 * clipping absent — moves whole areas, and the sabotages below measure what that reads as.
 */

const ENGINE_DIST = join(process.cwd(), 'packages', 'engine', 'dist');
const PREFIX = '/__engine/';
const HARNESS = '/__parity/';

/** Width and height of both canvases, and the logical box, kept apart so the letterbox shows. */
const SCREEN = { width: 640, height: 480 };
const LOGICAL = { width: 400, height: 300 };

/**
 * Serve `packages/engine/dist/*.js` under {@link PREFIX} and the harness page at
 * {@link HARNESS}, both on the site's own origin so module imports and canvas readback are
 * same-origin and no Private Network Access rule refuses the request.
 */
async function serveHarness(page: Page, sabotage = ''): Promise<void> {
  await page.route(`**${PREFIX}*`, async (route) => {
    const name = new URL(route.request().url()).pathname.slice(PREFIX.length);
    try {
      const body = await readFile(join(ENGINE_DIST, name), 'utf8');
      await route.fulfill({ contentType: 'application/javascript', body });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route(`**${HARNESS}`, (route) =>
    route.fulfill({ contentType: 'text/html', body: harness(sabotage) }),
  );
}

/** The page: two canvases, one scene, drawn by both backends, pixels compared in-page. */
function harness(sabotage: string): string {
  return `<!doctype html><title>renderer parity</title>
<canvas id="a" width="${String(SCREEN.width)}" height="${String(SCREEN.height)}"></canvas>
<canvas id="b" width="${String(SCREEN.width)}" height="${String(SCREEN.height)}"></canvas>
<script type="module">
import { Canvas2DRenderer, SEAT_PALETTE } from '${PREFIX}index.js';
import { WebGLRenderer, GLYPH_PAGE_SIZE } from '${PREFIX}webgl-renderer.js';

const LOGICAL = ${JSON.stringify(LOGICAL)};
const SCREEN = ${JSON.stringify(SCREEN)};
const SABOTAGE = ${JSON.stringify(sabotage)};

// 400x300 into 640x480 is scale 1.6 exactly, no letterbox; the shake and rotation below
// are what sweep drawing outside the box and exercise the clip.
const scale = Math.min(SCREEN.width / LOGICAL.width, SCREEN.height / LOGICAL.height);
const view = {
  scale,
  offsetX: (SCREEN.width - LOGICAL.width * scale) / 2,
  offsetY: (SCREEN.height - LOGICAL.height * scale) / 2,
  width: LOGICAL.width * scale,
  height: LOGICAL.height * scale,
  logicalWidth: LOGICAL.width,
  logicalHeight: LOGICAL.height,
};

function scene(r, sabotage) {
  r.beginFrame();
  r.clear('#12161c');
  r.rect(20, 20, 120, 80, SEAT_PALETTE.p1.base);
  r.strokeRect(160, 20, 120, 80, 6, SEAT_PALETTE.p2.base);
  r.circle(80, 200, 40, '#f4f4f5');
  r.strokeCircle(220, 200, 40, 8, 'rgba(255, 90, 78, 0.6)');
  r.line(300, 20, 380, 280, 5, 'orange');
  r.rect(300, 120, 80, 60, 'rgba(33, 176, 232, 0.5)');
  r.text('12', 200, 150, 40, '#ffffff', 'centre');
  r.text('near', 20, 270, 24, SEAT_PALETTE.p1.base, 'left');
  r.text('far', 380, 270, 24, SEAT_PALETTE.p2.base, 'right');
  r.pushSeatRotation(sabotage !== 'no-rotation');
  r.rect(20, 20, 40, 40, '#34c77b');
  r.popSeatRotation();
  if (sabotage !== 'no-clip') {
    // Half off the box: the clip is what keeps it off the letterbox.
    r.pushShake(sabotage === 'no-shake' ? 0 : 30, 0);
    // Big enough that a shake that did not happen moves more pixels than the tolerance: a
    // 140x120 block shifted 30 logical units differs over 6% of the surface.
    r.rect(60, 110, 140, 120, '#5a6472');
    r.rect(370, 120, 60, 30, '#ffc53d');
    r.popShake();
  } else {
    r.rect(370, 120, 60, 30, '#ffc53d');
  }
  r.endFrame();
}

const a = document.getElementById('a');
const ctx = a.getContext('2d');
const two = new Canvas2DRenderer(ctx, LOGICAL);
two.setViewport(view);
// The reference is always the true scene; a sabotage is applied to the WebGL side alone.
scene(two, '');
// The 2D canvas leaves the letterbox transparent; compare against the same ground.
const flat = document.createElement('canvas');
flat.width = SCREEN.width; flat.height = SCREEN.height;
const fctx = flat.getContext('2d');
fctx.drawImage(a, 0, 0);
const expected = fctx.getImageData(0, 0, SCREEN.width, SCREEN.height).data;

const b = document.getElementById('b');
const gl = b.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
const page = document.createElement('canvas');
page.width = GLYPH_PAGE_SIZE; page.height = GLYPH_PAGE_SIZE;
const pctx = page.getContext('2d');
const text = {
  page,
  measure(value, size, family) { pctx.font = size + 'px ' + family; return pctx.measureText(value).width; },
  draw(value, size, family, x, y, height) {
    pctx.font = size + 'px ' + family; pctx.textAlign = 'left'; pctx.textBaseline = 'middle';
    pctx.fillStyle = '#ffffff'; pctx.fillText(value, x + 1, y + height / 2);
  },
  clear() { pctx.clearRect(0, 0, page.width, page.height); },
};
const three = new WebGLRenderer(gl, LOGICAL, { text });
three.setViewport(view);
three.setDevicePixelRatio(1);
scene(three, SABOTAGE);
// readPixels gives rows bottom-up and premultiplied; draw the GL canvas into a 2D one so
// both sides are read the same way by the same code.
const gctx = document.createElement('canvas');
gctx.width = SCREEN.width; gctx.height = SCREEN.height;
const g2 = gctx.getContext('2d');
g2.drawImage(b, 0, 0);
const actual = g2.getImageData(0, 0, SCREEN.width, SCREEN.height).data;

const THRESHOLD = 48;
let differing = 0;
let sumDelta = 0;
for (let i = 0; i < expected.length; i += 4) {
  const d = Math.max(
    Math.abs(expected[i] - actual[i]),
    Math.abs(expected[i + 1] - actual[i + 1]),
    Math.abs(expected[i + 2] - actual[i + 2]),
    Math.abs(expected[i + 3] - actual[i + 3]),
  );
  sumDelta += d;
  if (d > THRESHOLD) differing += 1;
}
const total = expected.length / 4;
window.parity = {
  differing,
  total,
  fraction: differing / total,
  meanDelta: sumDelta / total,
  drawCalls: three.drawCalls,
  webgl: gl !== null,
};
</script>`;
}

interface Parity {
  readonly differing: number;
  readonly total: number;
  readonly fraction: number;
  readonly meanDelta: number;
  readonly drawCalls: number;
  readonly webgl: boolean;
}

async function measure(page: Page, sabotage = ''): Promise<Parity> {
  await serveHarness(page, sabotage);
  await page.goto(HARNESS);
  await page.waitForFunction(() => 'parity' in window);
  const parity = await page.evaluate(() => (window as unknown as { parity: Parity }).parity);
  // Printed so a run's numbers are in the log beside the verdict: the tolerance below was set
  // from these, and the next person to move it should be looking at the same figures.
  console.log(
    `parity${sabotage === '' ? '' : ` (${sabotage})`}: ${(parity.fraction * 100).toFixed(2)}% of` +
      ` pixels differ, mean delta ${parity.meanDelta.toFixed(2)}, ${String(parity.drawCalls)} draw call(s)`,
  );
  return parity;
}

/**
 * The fraction of pixels that may differ by more than the threshold.
 *
 * Measured on a clean run at **0.09%** (mean channel delta 0.20 of 255) — the anti-aliased
 * edges of a dozen shapes and three strings on a 640x480 surface — and set at eleven times
 * that. The two controls below read **2.75%** (the far seat's rotation missing) and
 * **6.82%** (a shake that did not move the world), so the line sits clear of both by more than
 * twice: a defect is not a matter of luck against it, and neither is a clean run. The figures
 * are printed on every run, next to the verdict, so the next person to move this number is
 * looking at the same evidence.
 */
const TOLERANCE = 0.01;

test.describe('the WebGL backend against the 2D one', () => {
  test('draws the same scene, pixel for pixel within the edges', async ({ page }) => {
    const parity = await measure(page);
    expect(parity.webgl, 'this Chromium gave no WebGL context').toBe(true);
    expect(parity.total).toBe(SCREEN.width * SCREEN.height);
    expect(
      parity.fraction,
      `${String(parity.differing)} of ${String(parity.total)} pixels differ by more than the threshold`,
    ).toBeLessThan(TOLERANCE);
    // Solid shapes in a row are one draw call, text is another, the rotated rect a third
    // after the text, and the shaken rect rides in it. Four calls for the whole scene is the
    // batching the backend exists for.
    expect(parity.drawCalls).toBeLessThanOrEqual(4);
  });

  test('can tell when the far seat’s rotation is missing', async ({ page }) => {
    // The control: a scene that differs in one rotated rectangle must read as different, or
    // the tolerance above is a number that means nothing.
    const parity = await measure(page, 'no-rotation');
    expect(parity.fraction).toBeGreaterThan(TOLERANCE);
  });

  test('can tell when a shake did not move the world', async ({ page }) => {
    const parity = await measure(page, 'no-shake');
    expect(parity.fraction).toBeGreaterThan(TOLERANCE);
  });
});
