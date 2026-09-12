import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ICON_ART,
  ICON_NAMES,
  iconSymbolId,
  shapeToSvg,
  spriteSymbols,
  symbolMarkup,
} from './icon-art.mjs';
import { ICONS, MIRRORED_ICONS, MIRROR_CLASS, iconClassName, iconId, type IconName } from './icons';

/**
 * The icon set holds together (#74), the way `tiles.test.ts` holds the tile set together.
 *
 * Two files describe the icons — `icon-art.mjs` draws them, `icons.ts` types them — and the
 * whole value of the split depends on them agreeing. These check that they do, that every
 * glyph is real geometry rather than an empty array, and that the ids a `<use>` will reach
 * for are unique.
 */

describe('the typed names and the geometry', () => {
  it('are the same set, so the type cannot claim an icon the art does not draw', () => {
    expect([...ICONS].sort()).toEqual([...ICON_NAMES].sort());
  });

  it('are the same order, so the type reads in the order the sprite emits', () => {
    expect([...ICONS]).toEqual([...ICON_NAMES]);
  });

  it('agree on the id a use points at', () => {
    for (const name of ICONS) {
      expect(iconId(name)).toBe(iconSymbolId(name));
      expect(iconId(name)).toBe(`db-icon-${name}`);
    }
  });
});

interface AnyShape {
  kind: string;
  points?: number[][];
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

const art: Record<string, AnyShape[]> = ICON_ART;

describe('every glyph', () => {
  it('is drawn from at least one primitive', () => {
    for (const name of ICON_NAMES) {
      expect(art[name]?.length, name).toBeGreaterThan(0);
    }
  });

  it('is built only from the known primitive kinds', () => {
    const kinds = new Set(['line', 'circle', 'rect', 'path', 'poly']);
    for (const shapes of Object.values(art)) {
      for (const shape of shapes) {
        expect(kinds.has(shape.kind), shape.kind).toBe(true);
      }
    }
  });

  it('stays inside the 24-unit grid at every explicit coordinate', () => {
    // A glyph whose points wandered off the viewBox would clip; the paths use arcs this
    // cannot read, so it checks the coordinates it can — points, lines, rect corners, circle
    // centres — which is where a fat-fingered edit lands.
    const inside = (value: number | undefined): boolean =>
      value !== undefined && value >= 0 && value <= 24;
    for (const [name, shapes] of Object.entries(art)) {
      for (const shape of shapes) {
        if (shape.kind === 'poly' && shape.points) {
          for (const [x, y] of shape.points) {
            expect(inside(x) && inside(y), `${name} point ${String(x)},${String(y)}`).toBe(true);
          }
        } else if (shape.kind === 'line') {
          expect(inside(shape.x1) && inside(shape.y1) && inside(shape.x2) && inside(shape.y2)).toBe(
            true,
          );
        } else if (shape.kind === 'circle') {
          expect(inside(shape.cx) && inside(shape.cy), name).toBe(true);
        } else if (shape.kind === 'rect') {
          expect(inside(shape.x) && inside(shape.y), name).toBe(true);
          expect(
            inside((shape.x ?? 0) + (shape.w ?? 0)) && inside((shape.y ?? 0) + (shape.h ?? 0)),
            name,
          ).toBe(true);
        }
      }
    }
  });

  it('emits a symbol with its id and the shared viewBox', () => {
    for (const name of ICON_NAMES) {
      const markup = symbolMarkup(name);
      expect(markup).toContain(`id="db-icon-${name}"`);
      expect(markup).toContain('viewBox="0 0 24 24"');
    }
  });
});

describe('the sprite the emitter builds', () => {
  it('has one symbol per glyph and no duplicate ids', () => {
    const symbols = spriteSymbols();
    const ids = [...symbols.matchAll(/id="(db-icon-[a-z-]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBe(ICON_NAMES.length);
    expect(new Set(ids).size).toBe(ICON_NAMES.length);
  });

  it('draws a filled star and an outlined star from the same points', () => {
    // The pair that proves a fill flag rather than two hand-drawn stars: same geometry, one
    // filled and one stroked.
    const filled = symbolMarkup('star-filled');
    const outline = symbolMarkup('star');
    const points = /points="([^"]+)"/;
    expect(points.exec(filled)?.[1]).toBe(points.exec(outline)?.[1]);
    expect(filled).toContain('fill="currentColor"');
    expect(outline).toContain('fill="none"');
  });
});

describe('rendering a primitive', () => {
  it('strokes by default and fills when told', () => {
    expect(shapeToSvg({ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 })).toContain(
      'stroke="currentColor"',
    );
    expect(shapeToSvg({ kind: 'circle', cx: 1, cy: 1, r: 1, fill: true })).toContain(
      'fill="currentColor"',
    );
  });

  it('throws on an unknown kind rather than emitting nothing', () => {
    expect(() => shapeToSvg({ kind: 'blob' })).toThrow(/unknown icon shape/);
  });
});

/**
 * Which glyphs turn round under a right-to-left shell (#222), held in both directions.
 *
 * The set is the decision and the class is how the stylesheet hears about it, so three
 * things have to agree: every member of the set is a real glyph; the members are exactly
 * the names that point along the line of reading, listed here by hand so a new arrow
 * cannot be added to `ICONS` and mirror by accident or fail to; and the component puts the
 * class on those and no others.
 *
 * The third is the one this file cannot run. `Icon.tsx` is JSX, `apps/web/tsconfig.json`
 * says `jsx: preserve` for Next, and Vitest's transform honours that and refuses the file
 * ("make sure to not set jsx to preserve") — the first draft of this test imported the
 * component and rendered it through `react-dom/server`, and that is the error it got. No
 * test under `apps/web/src` imports a `.tsx` for the same reason; the house pattern is a
 * pure function beside the component, tested by calling it, and the component held to
 * calling it by reading the source. So `iconClassName` is called for every name, and
 * `Icon.tsx` is read for the one line that hands its result to the `<svg>` — a read, and
 * said so here rather than in a sentence claiming a render. The other end of the seam, the
 * `[dir='rtl'] .db-mirror` rule in the built stylesheet, is measured in a browser by
 * `e2e/rtl.spec.ts`. Watched failing with `'play'` added to the set (the list check), with
 * `iconClassName` made to return the caller's class alone (the class check named `back`),
 * and with `Icon.tsx` handed `className` directly again (the source check).
 */
describe('the glyphs that mirror', () => {
  it('are all real glyphs', () => {
    for (const name of MIRRORED_ICONS) {
      expect(ICONS, name).toContain(name);
    }
  });

  it('are exactly the ones that point along the line of reading', () => {
    // `back` and `forward` mean "towards the start" and "towards the end". Play and pause
    // are media conventions, not directions — a mirrored play triangle is rewind — and the
    // rest are symmetric or have no direction to keep.
    expect([...MIRRORED_ICONS].sort()).toEqual(['back', 'forward']);
    const still: IconName[] = ICONS.filter((name) => !MIRRORED_ICONS.has(name));
    expect(still.sort()).toEqual(
      [
        'check',
        'close',
        'info',
        'pause',
        'play',
        'refresh',
        'settings',
        'sound-off',
        'sound-on',
        'star',
        'star-filled',
        'trophy',
      ].sort(),
    );
  });

  it('get the mirror class, and nothing else does', () => {
    for (const name of ICONS) {
      const classes = iconClassName(name)?.split(' ') ?? [];
      expect(classes.includes(MIRROR_CLASS), name).toBe(MIRRORED_ICONS.has(name));
    }
  });

  it("keeps the caller's class beside the mirror class", () => {
    expect(iconClassName('back', 'nav')).toBe(`nav ${MIRROR_CLASS}`);
    expect(iconClassName('back')).toBe(MIRROR_CLASS);
    expect(iconClassName('play', 'nav')).toBe('nav');
    expect(iconClassName('play')).toBeUndefined();
  });

  it('is what the component puts on the <svg>', () => {
    // Read, not rendered — see the note above. The one `className=` inside the `<svg …>` tag
    // must be the helper's answer, or the set above decides nothing.
    const source = readFileSync(new URL('../components/Icon.tsx', import.meta.url), 'utf8');
    const svg = /<svg\b([^>]*)>/.exec(source)?.[1] ?? '';
    expect(svg.match(/className=/g)).toHaveLength(1);
    expect(svg).toContain('className={iconClassName(name, className)}');
  });
});
