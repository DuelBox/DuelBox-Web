import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Reduced motion, guarded at the one place it can be lost.
 *
 * The mechanism is the cascade and it is a single lever: `tokens.css` collapses
 * `--db-duration-fast`, `--db-duration` and `--db-duration-slow` to 1ms under
 * `prefers-reduced-motion: reduce`, and every transition and animation in the shell is
 * timed by one of them. That is why there is no second mechanism — nothing in this
 * product needs a `motion-safe` class or a JavaScript kill switch to stop moving.
 *
 * It is also exactly why it is fragile. A stylesheet that writes `transition: opacity
 * 300ms ease` instead of reaching for a token is correct, readable, reviewable and
 * completely outside the lever, and nothing about it looks wrong — the only way to notice
 * is to have the preference set and to be looking at that one element. So this reads every
 * stylesheet in the app and fails on any timed declaration that is not either reaching for
 * a token the block zeroes, sitting inside a reduced-motion override of its own, or
 * already switched off.
 *
 * `breakpoints.test.ts` guards the other axis of the same problem, and this is written to
 * match it deliberately: a scale that CSS cannot enforce on itself gets enforced here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

function stylesheets(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) stylesheets(path, found);
    else if (path.endsWith('.css')) found.push(path);
  }
  return found;
}

/** A `[start, end)` span of a file, in character offsets. */
type Span = readonly [number, number];

/**
 * The bodies of every `@media` block that mentions `prefers-reduced-motion`.
 *
 * Found by matching braces rather than by regex: a media block holds whole rules, so the
 * closing brace is not the first one after the opening.
 */
function reducedSpans(css: string): Span[] {
  const spans: Span[] = [];
  for (const match of css.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{/g)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < css.length && depth > 0) {
      const char = css[i];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      i += 1;
    }
    spans.push([start, i - 1]);
  }
  return spans;
}

/**
 * Every declaration that puts a duration on something.
 *
 * Anchored on a `;`, a `{` or the start of the file so that `text-transform` — which is
 * in nine stylesheets and moves nothing — is not mistaken for one. `animation-name` and
 * `transition-property` carry no time and are not matched; `animation-duration` and
 * `transition-duration` are.
 */
const TIMED = /(?:^|[;{])\s*(transition|animation)(?:-duration)?\s*:\s*([^;}]+)/g;

/** A value that cannot animate whatever the preference says. */
function alreadyStill(value: string): boolean {
  return /^(none|0s|0ms|0)$/.test(value.trim());
}

interface Timed {
  readonly file: string;
  readonly property: string;
  readonly value: string;
  /** Whether the declaration sits inside a reduced-motion override of its own. */
  readonly overridden: boolean;
}

function timedDeclarations(path: string): Timed[] {
  const css = readFileSync(path, 'utf8');
  const spans = reducedSpans(css);
  const found: Timed[] = [];
  for (const match of css.matchAll(TIMED)) {
    const at = match.index + match[0].length;
    found.push({
      file: path.slice(web.length + 1),
      property: match[1] ?? '',
      value: (match[2] ?? '').replace(/\s+/g, ' ').trim(),
      overridden: spans.some(([start, end]) => at > start && at <= end),
    });
  }
  return found;
}

/** Every `--db-duration*` token a value reaches for. */
function tokensIn(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--db-duration[a-z-]*)/g)].map((match) => match[1] ?? '');
}

const sheets = stylesheets(web);
const declarations = sheets.flatMap(timedDeclarations);

describe('decorative motion', () => {
  it('finds the stylesheets and the moving things in them', () => {
    // A guard that matched nothing would pass forever, which is the failure mode every
    // other guard in this repository was found in.
    expect(sheets.length).toBeGreaterThan(5);
    expect(declarations.length, 'transitions and animations to check').toBeGreaterThan(5);
  });

  it('is always timed by a token the reduced-motion block can collapse', () => {
    const offenders = declarations
      .filter(
        (declaration) =>
          !declaration.overridden &&
          !alreadyStill(declaration.value) &&
          tokensIn(declaration.value).length === 0,
      )
      .map((declaration) => `${declaration.file}: ${declaration.property}: ${declaration.value}`);
    expect(
      offenders,
      `use a --db-duration token, or override it under prefers-reduced-motion: ${offenders.join(' | ')}`,
    ).toEqual([]);
  });

  it('reaches only for tokens the reduced-motion block actually zeroes', () => {
    // The half of the lever that lives in `tokens.css`. A fourth duration token added to
    // the palette and used in a transition, but never redefined in the block below it,
    // would pass the test above and move anyway.
    const tokens = readFileSync(join(web, 'styles', 'tokens.css'), 'utf8');
    const block = tokens.slice(tokens.indexOf('prefers-reduced-motion'));
    expect(block, 'tokens.css has a reduced-motion block').toContain('--db-duration');

    const used = new Set(declarations.flatMap((declaration) => tokensIn(declaration.value)));
    expect(used.size, 'duration tokens in use').toBeGreaterThan(0);
    for (const token of used) {
      const zeroed = new RegExp(`${token}:\\s*(0m?s|1ms)\\s*;`).test(block);
      expect(zeroed, `${token} is not collapsed under prefers-reduced-motion`).toBe(true);
    }
  });

  it('never leaves a keyframed animation running on a decorative element', () => {
    // Belt and braces, and worth having as a separate assertion: a keyframe sequence at
    // 1ms is imperceptible, but the two elements that carry one — the score bump and the
    // countdown pop — are informative enough that they also switch the animation off
    // outright, so a reader of either stylesheet can see the intent without reasoning
    // about the token. If that ever stops being true this fails and says so.
    const named = declarations.filter(
      (declaration) => declaration.property === 'animation' && !declaration.overridden,
    );
    for (const declaration of named) {
      const sheet = readFileSync(join(web, declaration.file), 'utf8');
      expect(
        reducedSpans(sheet).length,
        `${declaration.file} runs a keyframe animation and has no reduced-motion block`,
      ).toBeGreaterThan(0);
    }
  });
});
