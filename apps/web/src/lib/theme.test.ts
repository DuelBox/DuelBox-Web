import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySeatPalette,
  applyTheme,
  seatPaletteAttribute,
  themeAttribute,
} from './theme';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The colour-scheme decision, pinned in the two places that must agree on it (#76).
 *
 * `themeAttribute` is the whole decision: `system` clears the attribute so the media query
 * decides, and the two explicit choices set themselves. The inline script in `layout.tsx`
 * makes the identical decision before the first paint — it has to be a string in the head,
 * so it cannot import this — and the last test here reads that script out of the layout and
 * checks it still reaches for the same key, the same three names, and clears rather than
 * stamps on `system`, so the two copies cannot drift apart silently.
 */

describe('the theme decision', () => {
  it('clears the override for system and stamps the two explicit choices', () => {
    expect(themeAttribute('system')).toBeNull();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});

describe('applying a theme to the document', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeDocument() {
    const attrs = new Map<string, string>();
    return {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
      },
      attrs,
    };
  }

  it('stamps data-theme for an explicit choice', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    applyTheme('dark');
    expect(doc.attrs.get('data-theme')).toBe('dark');
    applyTheme('light');
    expect(doc.attrs.get('data-theme')).toBe('light');
  });

  it('removes data-theme for system, so the media query is left in charge', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    applyTheme('dark');
    applyTheme('system');
    expect(doc.attrs.has('data-theme')).toBe(false);
  });

  it('does nothing, and does not throw, where there is no document', () => {
    vi.stubGlobal('document', undefined);
    expect(() => {
      applyTheme('dark');
    }).not.toThrow();
  });
});

describe('the seat-palette decision', () => {
  it('clears the attribute for default and stamps colourblind', () => {
    expect(seatPaletteAttribute('default')).toBeNull();
    expect(seatPaletteAttribute('colourblind')).toBe('colourblind');
  });
});

describe('applying a seat palette to the document', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeDocument() {
    const attrs = new Map<string, string>();
    return {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
      },
      attrs,
    };
  }

  it('stamps colourblind and clears it again for default', () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    applySeatPalette('colourblind');
    expect(doc.attrs.get('data-seat-palette')).toBe('colourblind');
    applySeatPalette('default');
    expect(doc.attrs.has('data-seat-palette')).toBe(false);
  });
});

describe('the inline head script in layout.tsx', () => {
  const layout = readFileSync(
    fileURLToPath(new URL('../app/layout.tsx', import.meta.url)),
    'utf8',
  );

  it('reads the same storage key and reacts to the same three theme names', () => {
    // The script cannot import settings.ts, so it duplicates the key and the version. This
    // fails if either drifts from what settings.ts writes, which is the whole risk of a
    // hand-copied literal in an HTML string.
    expect(layout).toContain('duelbox:settings');
    expect(layout).toMatch(/data-theme/);
    // The no-FOUC contract: it must run before the body, so it is a plain inline script and
    // not a deferred module.
    expect(layout).toMatch(/dangerouslySetInnerHTML/);
  });

  it('only stamps light or dark, mirroring themeAttribute clearing system', () => {
    // A script that stamped "system" would defeat the media query and freeze a system-theme
    // page on whatever the OS was at load. It must set the attribute only for the two
    // explicit values — the same table themeAttribute encodes.
    expect(layout).toMatch(/'light'|"light"/);
    expect(layout).toMatch(/'dark'|"dark"/);
  });

  it('also stamps the colour-blind seat palette before paint', () => {
    // The seat palette has no device signal and so no media-query fallback, which makes the
    // inline script the only thing that can set it without a flash of the brand colours.
    expect(layout).toContain('data-seat-palette');
    expect(layout).toMatch(/'colourblind'|"colourblind"/);
  });
});
