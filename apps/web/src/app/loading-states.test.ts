import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two halves of one change: what a route shows while it is still coming (#93) and what it
 * does when it arrives (#94).
 *
 * They are asserted together because they share a constraint that is the interesting part
 * of both — neither may ship behaviour to the client. A loading state that shipped a
 * component would bill every visitor for the moment before somebody else's game, and a
 * transition driven by a navigation listener would bill them for a fade.
 *
 * "Not a byte of client JavaScript" is what that used to say, and it was false in one of
 * the two directions. The transition really is free, because a keyframe is not code. The
 * fallback is not: Next emits a chunk for a route segment however empty it is, so its floor
 * is 132 gzipped bytes and being a server component is not what buys it — see the guard
 * below, which is there because the first version of that file paid 363. So the bar is
 * "imports nothing", measured, rather than "server", assumed.
 *
 * What a file cannot answer is whether the animation ever stands between a navigation and
 * the first press, and whether the swap from the fallback to the page moves the layout under
 * it. Those are the two issues' real acceptance criteria and both need a browser:
 * `e2e/page-transition.spec.ts` carries them.
 */

const app = dirname(fileURLToPath(import.meta.url));

/** Every file with this name anywhere under `app/`, as paths relative to it. */
function routeFiles(name: string, dir: string = app, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) routeFiles(name, path, found);
    else if (entry === name) found.push(relative(app, path));
  }
  return found;
}

const read = (name: string): string => readFileSync(join(app, name), 'utf8');

/** The one route a static export can genuinely show a loading state on. */
const SKELETON = join('play', '[slug]', 'loading.tsx');

/**
 * A file's code with the comments taken out.
 *
 * An assertion about literals must not be answered by the prose explaining them: to a
 * regular expression an issue number is a hex colour and a size in the reasoning is a size
 * in the markup.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * The body of a top-level CSS block, found by the line that opens it.
 *
 * `prettier` is the first thing the gate runs, so a top-level closing brace is in column
 * one and the first `\n}` after the opening ends the block. That is enough here, and it is
 * a great deal shorter than matching braces.
 */
function blockBody(css: string, opening: RegExp): string {
  const start = opening.exec(css);
  if (start === null) return '';
  const from = start.index + start[0].length;
  const end = css.indexOf('\n}', from);
  return end === -1 ? '' : css.slice(from, end);
}

describe('the routes that show a loading state', () => {
  const loadings = routeFiles('loading.tsx');
  const skeleton = read(SKELETON);

  it('is the play route, and deliberately no other', () => {
    // The guard has to be able to fail, so it is worth saying what it is choosing between:
    // there are several routes here and all but one of them have nothing, on purpose. A
    // static export writes every route's HTML at build time, so a loading state is only
    // seen while a *client* navigation waits — and the content routes are markup the router
    // has usually prefetched before the press. The play route is the one with client code
    // of its own behind it and the one `QuickPlay` pushes to without anything having
    // prefetched it. A second entry in this list needs that same argument made for it.
    //
    // Said plainly, because this list is exact and therefore forbids what it excludes:
    // #93's actions name "skeletons for the catalog grid and the game page" and only the
    // second was built. The catalogue skeleton is **declined**, not forgotten — its
    // navigation is prefetched markup with no chunk behind it, so the fallback would be
    // seen by nobody and maintained by everybody, which `play/[slug]/loading.tsx` argues at
    // its head. Whoever disagrees changes this assertion and writes the argument down
    // beside it; nobody removes the assertion to make room.
    expect(routeFiles('page.tsx').length, 'routes to choose between').toBeGreaterThan(5);
    expect(loadings, 'a new loading.tsx needs a navigation that genuinely waits').toEqual([
      SKELETON,
    ]);
  });

  it('is a server component', () => {
    expect(skeleton, 'a fallback must not put a component in the shell budget').not.toContain(
      'use client',
    );
  });

  it('imports nothing, which is what being a server component is not enough for', () => {
    // Being server-rendered is not on its own free, and this file learned that the
    // expensive way. A CSS module is a JavaScript import, and Next emits a client chunk for
    // any route segment that has one whether or not a client component is anywhere near it:
    // the first version of this fallback imported `PlaySurface.module.css` and shipped 363
    // gzipped bytes of class-name map on the on-demand budget, fetched during the very
    // navigation it exists to smooth, carrying no behaviour at all.
    //
    // So the bar here is "nothing", not "nothing that runs". If a later change genuinely
    // needs an import, the number to check is `pnpm size`'s on-demand line before and after
    // it — not this file's word "server".
    const source = code(skeleton);
    expect(source, 'a CSS module is a JavaScript import like any other').not.toMatch(
      /\.module\.css/,
    );
    expect(source, 'an import here is a chunk on the on-demand budget').not.toMatch(
      /^\s*import\s/m,
    );
  });

  it('holds the shell in the layout the page arrives into', () => {
    // `:has(.db-fill)` is what fixes the shell's height and stands the footer down on the
    // play route. A fallback without it raises a footer for as long as it is up and drops
    // it again when the page lands, which is a layout shift the skeleton itself caused.
    expect(skeleton).toContain('db-wrap');
    expect(skeleton).toContain('db-fill');
  });

  it('is the panel it becomes, rather than a second copy of one', () => {
    // What replaces it is `PlaySurface`'s own loading panel, not the lobby: the game's
    // chunk is fetched after that component mounts. Both draw the panel in one class,
    // defined once in the stylesheet every route already has, which is what makes the swap
    // invisible — and what stops a stylesheet the fallback may not import (see above) from
    // being copied into a second one that would then have to be kept in step by hand.
    const surface = read(join('..', 'components', 'PlaySurface.tsx'));
    const module = read(join('..', 'components', 'PlaySurface.module.css'));
    expect(skeleton, 'the fallback draws the panel').toContain('db-panel');
    expect(surface, 'and so does what replaces it').toContain('db-panel');
    expect(
      read('globals.css').match(/^\.db-panel \{/gm) ?? [],
      'defined once, where a server component can reach it without importing anything',
    ).toHaveLength(1);
    expect(module, 'the geometry left here, rather than being duplicated').not.toMatch(
      /^\.state\b/m,
    );
  });

  it('leaves no phase of the play route without a heading', () => {
    // The page beside it renders a hidden `h1` for exactly this reason, and a loading
    // phase is a phase.
    expect(skeleton).toMatch(/<h1[^>]*db-visually-hidden/);
  });

  it('reaches for the tokens rather than writing values down', () => {
    const source = code(skeleton);
    expect(source, 'a colour here is a colour the tokens cannot reach').not.toMatch(
      /#[0-9a-f]{3,8}\b/i,
    );
    expect(source, 'an inline style is a value outside the stylesheets').not.toMatch(/style=\{\{/);
    expect(source, 'a size here is a size the spacing scale does not know about').not.toMatch(
      /\b\d+(?:\.\d+)?(?:px|rem|em|ms|s)\b/,
    );
  });
});

describe('the page entry animation', () => {
  const globals = read('globals.css');
  const rule = blockBody(globals, /\n\.db-main > \*:not\(\.db-fill\) \{/);

  it('runs on the arriving route, not on the landmark that outlives it', () => {
    // `<main>` belongs to the root layout, and the router keeps a layout mounted across
    // navigations — an animation on it would run once, on the first load, and never again.
    // Each route's own root element is remounted on arrival, which is what makes a rule
    // with no JavaScript behind it a page transition rather than a page-load effect.
    expect(blockBody(globals, /\n\.db-main \{/), '.db-main outlives the navigation').not.toContain(
      'animation',
    );
    expect(rule).toMatch(/animation:\s*db-page-in\s+var\(--db-duration/);
  });

  it('animates opacity and nothing that could move a control or swallow a press', () => {
    const frames = blockBody(globals, /@keyframes db-page-in \{/);
    expect(frames).toContain('opacity');
    // Everything below either moves the arriving page under a finger already aiming at it,
    // or takes the control out of the hit test for the length of the animation. Either one
    // is the delay #94 exists to forbid.
    for (const forbidden of [
      'transform',
      'translate',
      'scale',
      'visibility',
      'display',
      'width',
      'height',
      'inset',
      'margin',
    ]) {
      expect(frames, `${forbidden} would delay the first press`).not.toContain(forbidden);
    }
    expect(rule, 'pointer-events is the delay in its plainest form').not.toContain(
      'pointer-events',
    );
  });

  it('is switched off outright when the player has asked for less motion', () => {
    // The token collapses to a millisecond on its own, so this is belt and braces — and it
    // is the house pattern for motion that carries no information, which a reader of the
    // stylesheet can then see without reasoning about the cascade.
    const reduced = blockBody(globals, /@media \(prefers-reduced-motion: reduce\) \{/);
    // The same selector, character for character, and not merely one that also matches.
    // `.db-main > *` is a specificity below `.db-main > *:not(.db-fill)`, so an override
    // written the shorter way would lose the cascade and animate anyway.
    expect(reduced).toContain('.db-main > *:not(.db-fill)');
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it('stands down on the one route where a fallback and a page both arrive', () => {
    // The play route is the only route with a `loading.tsx`, so it is the only navigation
    // that mounts two children of `<main>`: the Suspense fallback, and then the page, which
    // React mounts as a fresh node rather than reusing the fallback's. Both matched the
    // rule, so the panel faded in, dropped back to transparent when the payload landed, and
    // faded in again — on the one navigation the skeleton was added to smooth.
    //
    // The exemption is keyed on `db-fill` because both roots already carry it and nothing
    // else in the product does. That is what makes this assertion able to fail: give either
    // root a different class and the flicker comes back, and this test says so.
    expect(rule, 'the rule is still the one the fallback and the page are excused from').toMatch(
      /animation:\s*db-page-in/,
    );
    const skeleton = read(join('play', '[slug]', 'loading.tsx'));
    const page = read(join('play', '[slug]', 'page.tsx'));
    expect(skeleton, 'the fallback wears the class the rule excuses').toContain('db-fill');
    expect(page, 'and so does what replaces it').toContain('db-fill');
    expect(
      globals.match(/^\.db-main > \*[^{]*\{/gm) ?? [],
      'one selector for the entry animation, so the exemption cannot be half applied',
    ).toEqual(['.db-main > *:not(.db-fill) {']);
  });
});
