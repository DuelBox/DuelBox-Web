import { describe, expect, it } from 'vitest';
import { SpriteAtlas, packShelf } from './atlas.js';
import type { AtlasManifest, PackInput } from './atlas.js';
import type { ImageLike } from './asset-loader.js';

type HeroFrame = 'idle' | 'run' | 'jump';

const HERO_MANIFEST: AtlasManifest<HeroFrame> = {
  image: '/hero.png',
  width: 96,
  height: 32,
  frames: {
    idle: { x: 0, y: 0, width: 32, height: 32 },
    run: { x: 32, y: 0, width: 32, height: 32 },
    jump: { x: 64, y: 0, width: 32, height: 32 },
  },
};

const IMAGE: ImageLike = { width: 96, height: 32 };

describe('SpriteAtlas resolution', () => {
  it('resolves a frame by name', () => {
    const atlas = new SpriteAtlas(IMAGE, HERO_MANIFEST);
    expect(atlas.frame('run')).toEqual({ x: 32, y: 0, width: 32, height: 32 });
    expect(atlas.has('jump')).toBe(true);
    expect(atlas.frameNames().sort()).toEqual(['idle', 'jump', 'run']);
    expect(atlas.image.width).toBe(96);
  });

  it('throws for a frame the manifest does not contain', () => {
    // Cast to reach past the compile-time name check and prove the runtime guard.
    const atlas = new SpriteAtlas(IMAGE, HERO_MANIFEST) as SpriteAtlas<string>;
    expect(() => atlas.frame('missing')).toThrow();
  });
});

describe('packShelf geometry', () => {
  const SPRITES: PackInput[] = [
    { name: 'a', width: 40, height: 40 },
    { name: 'b', width: 30, height: 20 },
    { name: 'c', width: 50, height: 50 },
    { name: 'd', width: 20, height: 20 },
    { name: 'e', width: 60, height: 30 },
  ];

  function overlaps(
    p: { x: number; y: number; width: number; height: number },
    q: { x: number; y: number; width: number; height: number },
  ): boolean {
    return (
      p.x < q.x + q.width && p.x + p.width > q.x && p.y < q.y + q.height && p.y + p.height > q.y
    );
  }

  it('places every sprite within the reported bounds', () => {
    const result = packShelf(SPRITES, { maxWidth: 100 });
    for (const name of Object.keys(result.frames)) {
      const f = result.frames[name]!;
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.width).toBeLessThanOrEqual(result.width);
      expect(f.y + f.height).toBeLessThanOrEqual(result.height);
    }
  });

  it('never overlaps two frames, padding included', () => {
    const result = packShelf(SPRITES, { maxWidth: 100, padding: 2 });
    const names = Object.keys(result.frames);
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        expect(
          overlaps(result.frames[names[i]!]!, result.frames[names[j]!]!),
          `${names[i]} overlaps ${names[j]}`,
        ).toBe(false);
      }
    }
  });

  it('is deterministic and order-independent', () => {
    const a = packShelf(SPRITES, { maxWidth: 100 });
    const shuffled = [...SPRITES].reverse();
    const b = packShelf(shuffled, { maxWidth: 100 });
    expect(b).toEqual(a);
  });

  it('opens a new shelf when a row fills, so height grows past one row', () => {
    // maxWidth forces at most two of the 40-60px sprites per row.
    const result = packShelf(SPRITES, { maxWidth: 100 });
    expect(result.height).toBeGreaterThan(50); // more than a single shelf's height
    expect(result.width).toBeLessThanOrEqual(100);
  });

  it('rejects a sprite wider than the atlas, a duplicate name, and bad dimensions', () => {
    expect(() => packShelf([{ name: 'x', width: 200, height: 10 }], { maxWidth: 100 })).toThrow();
    expect(() =>
      packShelf([
        { name: 'x', width: 10, height: 10 },
        { name: 'x', width: 10, height: 10 },
      ]),
    ).toThrow();
    expect(() => packShelf([{ name: 'x', width: 0, height: 10 }])).toThrow();
  });

  it('returns an empty atlas for no sprites', () => {
    expect(packShelf([])).toEqual({ width: 0, height: 0, frames: {} });
  });
});
