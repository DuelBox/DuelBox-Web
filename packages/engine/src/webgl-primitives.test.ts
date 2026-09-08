import { describe, expect, it } from 'vitest';
import { ColourCache, UnknownColourError, parseColour } from './webgl-colour.js';
import { FLOATS_PER_VERTEX, VertexWriter, circleSegments } from './webgl-geometry.js';
import { GlyphAtlas, LINE_BOX, type TextRasteriser } from './webgl-text.js';
import { MAX_TRANSFORM_DEPTH, TransformStack } from './webgl-transform.js';

/**
 * The parts of the WebGL backend that need no GPU (#16): colour parsing, the transform
 * stack, the vertex writer and the glyph atlas. Each is a pure structure over typed arrays
 * and maps, which is why they are separate modules — the renderer that drives a real
 * context is tested with a recording fake in `webgl-renderer.test.ts`, and the picture the
 * two backends make is compared pixel by pixel in `e2e/renderer-parity.spec.ts`.
 */

const rgba = (css: string): number[] => {
  const out = new Float32Array(4);
  expect(parseColour(css, out), css).toBe(true);
  return [...out].map((v) => Math.round(v * 255));
};

describe('colour strings, as the catalogue writes them', () => {
  it('reads six-digit hex, which is what the palette is written in', () => {
    expect(rgba('#ff5a4e')).toEqual([255, 90, 78, 255]);
    expect(rgba('#21B0E8')).toEqual([33, 176, 232, 255]);
  });

  it('reads three, four and eight digit hex', () => {
    expect(rgba('#fff')).toEqual([255, 255, 255, 255]);
    expect(rgba('#0008')).toEqual([0, 0, 0, 136]);
    expect(rgba('#12161c80')).toEqual([18, 22, 28, 128]);
  });

  it('reads rgba() with and without spaces, which 252 game literals use', () => {
    expect(rgba('rgba(0, 0, 0, 0.25)')).toEqual([0, 0, 0, 64]);
    expect(rgba('rgba(0,0,0,0.25)')).toEqual([0, 0, 0, 64]);
    expect(rgba('rgb(10 22 32 / 50%)')).toEqual([10, 22, 32, 128]);
    expect(rgba('rgb(100%, 0%, 0%)')).toEqual([255, 0, 0, 255]);
  });

  it('reads the named colours games use, and refuses the ones nobody does', () => {
    expect(rgba('black')).toEqual([0, 0, 0, 255]);
    expect(rgba('orange')).toEqual([255, 165, 0, 255]);
    const out = new Float32Array(4);
    expect(parseColour('papayawhip', out)).toBe(false);
    expect(parseColour('hsl(10 50% 50%)', out)).toBe(false);
    expect(parseColour('#12', out)).toBe(false);
    expect(parseColour('#gg0000', out)).toBe(false);
  });

  it('caches by string, hands back the same array, and asks the browser only when it must', () => {
    const asked: string[] = [];
    const cache = new ColourCache((css) => {
      asked.push(css);
      return css === 'papayawhip' ? '#ffefd5' : null;
    });
    const first = cache.get('#ff5a4e');
    expect(cache.get('#ff5a4e')).toBe(first);
    expect(cache.size).toBe(1);
    expect(asked).toEqual([]);
    expect([...cache.get('papayawhip')].map((v) => Math.round(v * 255))).toEqual([
      255, 239, 213, 255,
    ]);
    expect(asked).toEqual(['papayawhip']);
    expect(() => cache.get('hsl(1 2% 3%)')).toThrow(UnknownColourError);
  });

  it('refuses an unknown colour outright when there is no browser to ask', () => {
    expect(() => new ColourCache().get('papayawhip')).toThrow(UnknownColourError);
  });
});

describe('the transform stack', () => {
  it('starts at the identity and composes like a canvas', () => {
    const t = new TransformStack();
    expect(t.x(3, 4)).toBe(3);
    expect(t.y(3, 4)).toBe(4);
    t.scale(2, 2);
    t.translate(10, 20);
    // translate after scale is scaled, as ctx.scale then ctx.translate is.
    expect(t.x(0, 0)).toBe(20);
    expect(t.y(0, 0)).toBe(40);
    expect(t.x(1, 1)).toBe(22);
  });

  it('rotates a half turn about the origin the way ctx.rotate does', () => {
    const t = new TransformStack();
    t.rotate(Math.PI);
    expect(t.x(10, 0)).toBeCloseTo(-10);
    expect(t.y(0, 10)).toBeCloseTo(-10);
  });

  it('pushes and pops without allocating and restores exactly', () => {
    const t = new TransformStack();
    t.scale(3, 3);
    t.push();
    t.translate(5, 5);
    expect(t.x(0, 0)).toBe(15);
    t.pop();
    expect(t.x(0, 0)).toBe(0);
    expect(t.depth).toBe(0);
  });

  it('reports a leak at the ceiling and a pop with nothing pushed', () => {
    const t = new TransformStack();
    for (let i = 0; i < MAX_TRANSFORM_DEPTH; i += 1) t.push();
    expect(() => {
      t.push();
    }).toThrow(/leaked/);
    const fresh = new TransformStack();
    expect(() => {
      fresh.pop();
    }).toThrow(/without a matching push/);
  });

  it('knows its own scale, which is what sizes a circle on screen', () => {
    const t = new TransformStack();
    t.scale(2.5, 2.5);
    expect(t.scaleFactor).toBeCloseTo(2.5);
    t.rotate(0.7);
    expect(t.scaleFactor).toBeCloseTo(2.5);
  });
});

describe('the vertex writer', () => {
  const red = new Float32Array([1, 0, 0, 1]);

  it('writes a rectangle as two triangles, transformed', () => {
    const t = new TransformStack();
    t.translate(100, 200);
    const w = new VertexWriter(t, 8);
    w.rect(1, 2, 10, 20, red);
    expect(w.vertexCount).toBe(6);
    const b = w.buffer;
    // First vertex: top-left, translated.
    expect(b[0]).toBe(101);
    expect(b[1]).toBe(202);
    // Colour rides on every vertex.
    expect(b[4]).toBe(1);
    expect(b[7]).toBe(1);
    // Third vertex: bottom-right.
    expect(b[2 * FLOATS_PER_VERTEX]).toBe(111);
    expect(b[2 * FLOATS_PER_VERTEX + 1]).toBe(222);
  });

  it('grows geometrically and then stops, which is what a warm frame needs', () => {
    const w = new VertexWriter(new TransformStack(), 6);
    w.rect(0, 0, 1, 1, red);
    expect(w.allocations).toBe(0);
    w.rect(0, 0, 1, 1, red);
    expect(w.allocations).toBe(1);
    for (let i = 0; i < 100; i += 1) w.rect(0, 0, 1, 1, red);
    const grown = w.allocations;
    w.reset();
    for (let i = 0; i < 102; i += 1) w.rect(0, 0, 1, 1, red);
    expect(w.allocations).toBe(grown);
  });

  it('draws a stroke centred on the edge and a line with butt caps of the right width', () => {
    const w = new VertexWriter(new TransformStack(), 64);
    w.strokeRect(10, 10, 100, 50, 4, red);
    expect(w.vertexCount).toBe(24);
    // Top edge quad spans x from 8 to 112 and y from 8 to 12.
    expect(w.buffer[0]).toBe(8);
    expect(w.buffer[1]).toBe(8);
    w.reset();
    w.line(0, 0, 10, 0, 2, red);
    expect(w.vertexCount).toBe(6);
    // A horizontal line of width 2 spans y in [-1, 1] and x in [0, 10]: butt caps, no overhang.
    const ys = [0, 1, 2, 3, 4, 5].map((i) => w.buffer[i * FLOATS_PER_VERTEX + 1] ?? Number.NaN);
    const xs = [0, 1, 2, 3, 4, 5].map((i) => w.buffer[i * FLOATS_PER_VERTEX] ?? Number.NaN);
    expect(Math.min(...ys)).toBe(-1);
    expect(Math.max(...ys)).toBe(1);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(10);
    w.reset();
    w.line(5, 5, 5, 5, 2, red);
    expect(w.vertexCount, 'a zero-length line draws nothing rather than NaN').toBe(0);
  });

  it('draws a circle as a fan whose segment count follows its size on screen', () => {
    expect(circleSegments(1)).toBe(12);
    expect(circleSegments(50)).toBe(60);
    expect(circleSegments(1000)).toBe(96);
    expect(circleSegments(Number.NaN)).toBe(12);
    const t = new TransformStack();
    t.scale(2, 2);
    const w = new VertexWriter(t, 512);
    w.circle(0, 0, 25, red);
    expect(w.vertexCount).toBe(circleSegments(50) * 3);
    w.reset();
    w.strokeCircle(0, 0, 25, 2, red);
    expect(w.vertexCount).toBe(circleSegments(52) * 6);
  });
});

/** A rasteriser that records what it was asked to draw and measures seven px a character. */
function fakeRasteriser() {
  const drawn: { value: string; size: number; x: number; y: number }[] = [];
  let cleared = 0;
  const rasteriser: TextRasteriser = {
    measure: (value, size) => value.length * size * 0.5,
    draw: (value, size, _family, x, y) => {
      drawn.push({ value, size, x, y });
    },
    clear: () => {
      cleared += 1;
    },
  };
  return { rasteriser, drawn, cleared: () => cleared };
}

describe('the glyph atlas', () => {
  it('rasterises a string once and answers from the map after that', () => {
    const { rasteriser, drawn } = fakeRasteriser();
    const atlas = new GlyphAtlas(rasteriser, 256, 'sans');
    const a = atlas.entry('12', 20);
    const b = atlas.entry('12', 20);
    expect(b).toBe(a);
    expect(drawn).toHaveLength(1);
    expect(a.height).toBe(Math.ceil(20 * LINE_BOX));
    expect(atlas.generation).toBe(1);
    atlas.entry('12', 30);
    expect(drawn, 'a different size is a different raster').toHaveLength(2);
    expect(atlas.generation).toBe(2);
  });

  it('packs shelves left to right and top to bottom without overlap', () => {
    const { rasteriser } = fakeRasteriser();
    const atlas = new GlyphAtlas(rasteriser, 100, 'sans');
    const entries = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'].map((s) => atlas.entry(s, 20));
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i]!;
        const b = entries[j]!;
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart, `${String(i)} and ${String(j)} overlap`).toBe(true);
      }
    }
    expect(
      entries.some((e) => e.y > 0),
      'the shelf wrapped',
    ).toBe(true);
  });

  it('starts the page again when it is full, and says so', () => {
    const { rasteriser, cleared } = fakeRasteriser();
    const atlas = new GlyphAtlas(rasteriser, 64, 'sans');
    for (let i = 0; i < 40; i += 1) atlas.entry(`s${String(i)}`, 20);
    expect(atlas.resets).toBeGreaterThan(0);
    expect(cleared()).toBe(atlas.resets);
    expect(atlas.count).toBeLessThan(40);
  });

  it('refuses a string that could never fit, rather than looping', () => {
    const { rasteriser } = fakeRasteriser();
    const atlas = new GlyphAtlas(rasteriser, 32, 'sans');
    expect(() => atlas.entry('a very long string indeed', 20)).toThrow(RangeError);
  });
});
