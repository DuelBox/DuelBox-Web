import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Every control the product offers is big enough for a thumb (#178).
 *
 * `--db-touch-target` is 48px and the token's own comment says why it is larger than the
 * usual web guidance: this is a device two people hold between them at arm's length. The
 * token was applied control by control as each was written, which means it was applied
 * wherever somebody remembered — the header's navigation carried no target at all until
 * #2484, and it was found by a spec that walks a route rather than by review.
 *
 * So this walks them. Every `button`, `a`, `input`, `select` and anything wearing
 * `role="button"` or `role="switch"`, on every shell route, at the narrowest width the
 * definition of done names, and each one measured in both dimensions.
 *
 * ## 320px, not 360
 *
 * The same argument `e2e/safe-area.spec.ts` makes for its own header case: the definition of
 * done says 320px to 4K, and a layout that only holds at the widths current phones happen to
 * ship is a layout nobody has checked. 320 is also the width with the least room to grow a
 * control, so it is the width where a fix has to be real rather than incidental.
 *
 * ## Two engines, one width
 *
 * A minimum size is mostly a property of the stylesheet, which is the same everywhere — but
 * the box a browser draws for a *native* control is not. A range slider, a file chooser and
 * a search field are drawn by the engine, and the settings page has all three, so this runs
 * on Chromium and on real WebKit. It does not run on the second Chromium project or on the
 * landscape one, because both would re-measure an engine at a width this spec sets for
 * itself; `playwright.config.ts` carries the ignore.
 */

/** The routes that make up the shell — every page a visitor reaches without starting a match. */
const SHELL_ROUTES = [
  '/',
  '/games/',
  '/games/air-hockey/',
  '/games/category/board/',
  '/how-to-play/',
  '/settings/',
  '/privacy/',
  '/terms/',
] as const;

/** The narrowest screen the definition of done covers. */
const PHONE = { width: 320, height: 640 };

/**
 * Controls that are allowed to be smaller than the token, each by name and each with the
 * reason it is allowed.
 *
 * A named list rather than a size threshold, because "anything under 24px is fine" is not a
 * decision anybody made — it is a decision nobody made, applied to everything. Every entry
 * here is one control, and adding one means writing down which control and why.
 *
 * `where` is matched as a substring of the descriptor the walk builds, which is the
 * element's own semantics — an anchor's path, an input's type, a button's accessible name —
 * and never a CSS-module class, because those carry a per-build hash and an allowlist keyed
 * on one would go stale the next time its stylesheet changed.
 */
const EXEMPT: readonly { readonly where: string; readonly route?: string; readonly why: string }[] =
  [
    {
      where: 'a[href="/games/"] in a paragraph',
      route: '/how-to-play/',
      why:
        'The "Browse all games" link in the closing sentence of the guide. WCAG 2.2 SC 2.5.8 ' +
        'exempts a target "in a sentence or block of text" precisely because giving it a ' +
        '48px box would open a hole in the line it sits in — the text around it moves, and ' +
        'the paragraph stops reading as a paragraph. The header, the footer and the page ' +
        'itself all offer the same destination at full size, so nothing is only reachable ' +
        'through this one.',
    },
    {
      where: 'a[href="/privacy/"] in a paragraph',
      route: '/terms/',
      why:
        'The same case: a cross-reference inside the sentence "We do not have any. See ' +
        'Privacy, which is short for the same reason." SC 2.5.8, inline exception — and the ' +
        'footer of the same page carries Privacy as a full-sized target.',
    },
    {
      where: 'input[type="radio"]',
      why:
        'The bot tier and the match length. The radio itself is 1.15rem and the target is ' +
        'not the radio — `MatchOptions` wraps each one in its own `<label>`, which carries ' +
        'the token as a min-height and takes the press anywhere on the words. SC 2.5.5 ' +
        'measures the target, and for a label-wrapped input the label is the target. What ' +
        'this walk can still say about them is the overlap check below, which grows each ' +
        "radio's own box to the token and finds no neighbour inside it.",
    },
  ];

interface Target {
  readonly descriptor: string;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

function exemptionFor(target: Target, route: string): string | undefined {
  return EXEMPT.find(
    (entry) =>
      target.descriptor.includes(entry.where) &&
      (entry.route === undefined || entry.route === route),
  )?.why;
}

/**
 * Every visible interactive element on the page, with the box a finger has to hit.
 *
 * The skip link is excluded for the reason `safe-area.spec.ts` excludes it: it parks itself
 * off-screen until focused, so its box while unfocused describes nothing a thumb can reach.
 * Anything inside an `aria-hidden` subtree is excluded too — the HUD renders a second,
 * upside-down copy of itself for the player on the far side, and a decorative duplicate is
 * not a second target.
 */
async function targetsOn(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const SELECTOR = 'button, a[href], input, select, [role="button"], [role="switch"]';

    function descriptorFor(element: HTMLElement): string {
      if (element instanceof HTMLAnchorElement) {
        return `a[href="${new URL(element.href).pathname}"]`;
      }
      if (element instanceof HTMLInputElement) {
        return `input[type="${element.type}"]`;
      }
      const role = element.getAttribute('role');
      const name = (element.getAttribute('aria-label') ?? element.textContent)
        .trim()
        .replace(/\s+/g, ' ');
      const tag = element.tagName.toLowerCase();
      return `${tag}${role === null ? '' : `[role="${role}"]`} "${name}"`;
    }

    /**
     * Whether a control sits inside running text, which is the one structural fact an
     * exemption below turns on — and it has to be part of the descriptor rather than
     * checked in the entry, because the footer links to `/privacy/` and the sentence on
     * `/terms/` that cross-references it are otherwise the same string. Exempting the
     * sentence would have exempted the footer link on that page too.
     */
    function inProse(element: HTMLElement): boolean {
      return element.closest('p') !== null;
    }

    const found: Target[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (node.classList.contains('db-skip')) continue;
      if (node.closest('[aria-hidden="true"]') !== null) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      found.push({
        descriptor: `${descriptorFor(node)}${inProse(node) ? ' in a paragraph' : ''}`,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        x: rect.x,
        y: rect.y,
      });
    }
    return found;
  });
}

async function tokenOn(page: Page): Promise<number> {
  const token = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--db-touch-target'),
    ),
  );
  expect(token, 'the touch-target token is readable').toBeGreaterThan(0);
  return token;
}

/** The controls that miss the token in either dimension and have no exemption. */
function undersized(targets: readonly Target[], token: number, route: string): string[] {
  const bad: string[] = [];
  for (const target of targets) {
    if (target.width >= token && target.height >= token) continue;
    if (exemptionFor(target, route) !== undefined) continue;
    bad.push(`${target.descriptor} is ${String(target.width)}×${String(target.height)}`);
  }
  return bad;
}

/**
 * The hit area a finger needs, which for an undersized control is larger than the control.
 *
 * #178's second half asks that expanded hit areas do not overlap — a 20px link given a 48px
 * reach is a link that can be pressed by aiming at its neighbour. So each box is grown about
 * its own centre to at least the token and then checked against every other.
 *
 * A pair where one box contains the other is skipped, and that is the catalogue's star over
 * its card: the two are deliberately stacked, the star takes every press inside itself and
 * the card takes the rest, so there is no ambiguity for a thumb to land in. Touching edges
 * are fine; only a real intersection is a fault.
 */
function expanded(target: Target, token: number): { l: number; t: number; r: number; b: number } {
  const width = Math.max(target.width, token);
  const height = Math.max(target.height, token);
  const l = target.x + target.width / 2 - width / 2;
  const t = target.y + target.height / 2 - height / 2;
  return { l, t, r: l + width, b: t + height };
}

function contains(
  outer: { l: number; t: number; r: number; b: number },
  inner: { l: number; t: number; r: number; b: number },
): boolean {
  return outer.l <= inner.l && outer.t <= inner.t && outer.r >= inner.r && outer.b >= inner.b;
}

function overlaps(targets: readonly Target[], token: number): string[] {
  const boxes = targets.map((target) => ({ target, box: expanded(target, token) }));
  const clashes: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a === undefined || b === undefined) continue;
      if (contains(a.box, b.box) || contains(b.box, a.box)) continue;
      const apart =
        a.box.r <= b.box.l || b.box.r <= a.box.l || a.box.b <= b.box.t || b.box.b <= a.box.t;
      if (apart) continue;
      clashes.push(`${a.target.descriptor} overlaps ${b.target.descriptor}`);
    }
  }
  return clashes;
}

test.describe('every control is big enough for a thumb', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
  });

  for (const route of SHELL_ROUTES) {
    test(`nothing on ${route} is under the touch-target token`, async ({ page }) => {
      await page.goto(route);
      const token = await tokenOn(page);
      const targets = await targetsOn(page);
      expect(targets.length, `${route} has controls to measure`).toBeGreaterThan(0);
      expect(undersized(targets, token, route), `controls under ${String(token)}px`).toEqual([]);
      expect(overlaps(targets, token), `hit areas that overlap on ${route}`).toEqual([]);
    });
  }

  /**
   * The pre-match screen, which is the one page whose controls both players reach for at
   * once: the tier, the length and the two ways to start.
   */
  test('the play lobby is reachable by thumb', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
    const token = await tokenOn(page);
    const targets = await targetsOn(page);
    expect(undersized(targets, token, '/play/tic-tac-toe/'), 'controls under the token').toEqual(
      [],
    );
    expect(overlaps(targets, token), 'hit areas that overlap in the lobby').toEqual([]);
  });

  /**
   * A running match, which is where #178's "between seats" clause bites.
   *
   * Two people sit on opposite sides of one device, and the shell's own controls — the mute
   * and the pause — sit in the HUD between them. If either one's hit area had to grow to
   * reach the token, the room it grew into is the other seat's. Measuring them while a match
   * is live is the only way to see that: neither exists on the lobby.
   */
  test('the match HUD keeps both seats their own controls', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    const token = await tokenOn(page);
    const targets = await targetsOn(page);
    expect(targets.length, 'the HUD offers controls').toBeGreaterThan(0);
    expect(
      undersized(targets, token, '/play/tic-tac-toe/'),
      'HUD controls under the token',
    ).toEqual([]);
    expect(overlaps(targets, token), 'HUD hit areas that overlap').toEqual([]);
  });
});
