import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Safe-area handling, guarded at the source.
 *
 * The four `--db-safe-*` tokens were declared correctly from `env(safe-area-inset-*)`
 * and then consumed in exactly one place — a runtime read inside the game host that
 * double-counted them — while every piece of chrome that can actually land under a
 * notch used none of them. Nothing failed, because nothing looked. These assert that
 * the tokens exist and that the surfaces which touch a screen edge consume them.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

function read(relative: string): string {
  return readFileSync(join(web, relative), 'utf8');
}

/** Declarations only. A rule about what the CSS *does* must not match a comment. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const EDGES = ['top', 'right', 'bottom', 'left'] as const;

describe('the safe-area tokens', () => {
  it('declares all four from env(), with a zero fallback', () => {
    const tokens = read('styles/tokens.css');
    for (const edge of EDGES) {
      expect(tokens).toContain(`--db-safe-${edge}: env(safe-area-inset-${edge}, 0px)`);
    }
  });

  it('opts the document into drawing under the cutout, or env() is always zero', () => {
    // Without viewport-fit=cover the browser letterboxes the page away from the notch
    // and every inset reports 0px, which makes the whole mechanism silently inert.
    expect(read('app/layout.tsx')).toContain("viewportFit: 'cover'");
  });
});

describe('the surfaces that touch a screen edge', () => {
  const cases: ReadonlyArray<{ file: string; what: string; edges: readonly string[] }> = [
    {
      file: 'app/globals.css',
      what: 'the page gutters and the skip link',
      edges: ['left', 'right'],
    },
    { file: 'components/SiteFooter.module.css', what: 'the footer', edges: ['bottom'] },
    {
      file: 'components/MatchOverlay.module.css',
      what: 'the pause and result panels',
      edges: ['top', 'right', 'bottom', 'left'],
    },
  ];

  for (const { file, what, edges } of cases) {
    it(`${what} clears the cutout`, () => {
      const css = read(file);
      for (const edge of edges) {
        expect(css, `${file} must inset its ${edge} edge`).toContain(`var(--db-safe-${edge})`);
      }
    });
  }

  it('always uses max(), so an inset can only widen a gutter and never narrow it', () => {
    for (const file of cases.map((c) => c.file)) {
      const css = withoutComments(read(file));
      for (const match of css.matchAll(/var\(--db-safe-(top|right|bottom|left)\)/g)) {
        const line = css.slice(0, match.index).split('\n').pop() ?? '';
        expect(line, `${file}: "${line.trim()}" should use max()`).toContain('max(');
      }
    }
  });
});

describe('the viewport height unit', () => {
  it('uses svh so browser chrome cannot resize a running match, with a vh fallback', () => {
    const globals = withoutComments(read('app/globals.css'));
    expect(globals).toContain('min-height: 100vh');
    expect(globals).toContain('min-height: 100svh');
    // dvh tracks the address bar sliding in and out, which is exactly the resize the
    // play area must not suffer mid-match.
    expect(globals).not.toContain('dvh');
  });
});
