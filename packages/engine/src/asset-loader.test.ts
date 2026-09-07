import { describe, expect, it } from 'vitest';
import { AssetLoadError, AssetLoader } from './asset-loader.js';
import type { AssetDescriptor, AssetIO, AudioLike, ImageLike } from './asset-loader.js';

/** A fake IO whose per-url behaviour a test scripts. Records wait() calls instead of sleeping. */
class FakeIO implements AssetIO {
  readonly waits: number[] = [];
  /** Number of load attempts made per url, so a test can assert retries happened. */
  readonly attempts = new Map<string, number>();
  /** url -> how many times it should fail before succeeding. */
  readonly failuresBeforeSuccess = new Map<string, number>();
  /** urls that never succeed. */
  readonly alwaysFail = new Set<string>();

  #bump(url: string): number {
    const n = (this.attempts.get(url) ?? 0) + 1;
    this.attempts.set(url, n);
    return n;
  }

  #maybeFail(url: string): void {
    const attempt = this.#bump(url);
    if (this.alwaysFail.has(url)) throw new Error(`always fails: ${url}`);
    const failFor = this.failuresBeforeSuccess.get(url) ?? 0;
    if (attempt <= failFor) throw new Error(`transient failure ${attempt} for ${url}`);
  }

  loadImage(url: string): Promise<ImageLike> {
    this.#maybeFail(url);
    return Promise.resolve({ width: 16, height: 16 });
  }
  loadAudio(url: string): Promise<AudioLike> {
    this.#maybeFail(url);
    return Promise.resolve({ duration: 1.5 });
  }
  loadJson(url: string): Promise<unknown> {
    this.#maybeFail(url);
    return Promise.resolve({ url });
  }
  wait(ms: number): Promise<void> {
    this.waits.push(ms);
    // Resolve immediately — no real clock.
    return Promise.resolve();
  }
}

const MANIFEST: AssetDescriptor[] = [
  { name: 'hero', url: '/hero.png', kind: 'image' },
  { name: 'ping', url: '/ping.mp3', kind: 'audio' },
  { name: 'level', url: '/level.json', kind: 'json' },
];

describe('combined progress', () => {
  it('climbs monotonically and reaches exactly 1 when finished', async () => {
    const io = new FakeIO();
    const seen: number[] = [];
    const loader = new AssetLoader(io, { onProgress: (f) => seen.push(f) });
    await loader.load(MANIFEST);

    expect(loader.progress).toBe(1);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    // Three assets -> the final fractions are 1/3, 2/3, 3/3.
    expect(seen).toContain(1 / 3);
    expect(seen).toContain(2 / 3);
  });

  it('is immediately complete for an empty manifest', async () => {
    const io = new FakeIO();
    const loader = new AssetLoader(io);
    const bundle = await loader.load([]);
    expect(loader.progress).toBe(1);
    expect(bundle.has('anything')).toBe(false);
  });
});

describe('typed lookup', () => {
  it('returns each asset by name and kind', async () => {
    const io = new FakeIO();
    const bundle = await new AssetLoader(io).load(MANIFEST);
    expect(bundle.image('hero').width).toBe(16);
    expect(bundle.audio('ping').duration).toBe(1.5);
    expect(bundle.json<{ url: string }>('level').url).toBe('/level.json');
  });

  it('throws when an asset is read as the wrong kind or is missing', async () => {
    const io = new FakeIO();
    const bundle = await new AssetLoader(io).load(MANIFEST);
    expect(() => bundle.audio('hero')).toThrow();
    expect(() => bundle.image('nope')).toThrow();
  });
});

describe('retry with backoff', () => {
  it('recovers from a transient failure without failing the load', async () => {
    const io = new FakeIO();
    io.failuresBeforeSuccess.set('/ping.mp3', 1); // fails once, then succeeds
    const loader = new AssetLoader(io, { backoffMs: 100 });
    const bundle = await loader.load(MANIFEST);
    expect(bundle.audio('ping').duration).toBe(1.5);
    expect(io.attempts.get('/ping.mp3')).toBe(2); // one failure + one success
    expect(io.waits).toEqual([100]); // exactly one backoff, at the base delay
    expect(loader.progress).toBe(1);
  });

  it('retries exactly twice with doubling backoff before giving up', async () => {
    const io = new FakeIO();
    io.alwaysFail.add('/hero.png');
    const loader = new AssetLoader(io, { backoffMs: 50, retries: 2 });
    await expect(loader.load(MANIFEST)).rejects.toBeInstanceOf(AssetLoadError);
    // First attempt + 2 retries = 3 attempts on the failing asset.
    expect(io.attempts.get('/hero.png')).toBe(3);
    // Backoff before retry 1 and retry 2: 50, then 100.
    expect(io.waits).toEqual([50, 100]);
  });

  it('names the failing asset in the error', async () => {
    const io = new FakeIO();
    io.alwaysFail.add('/level.json');
    try {
      await new AssetLoader(io).load(MANIFEST);
      expect.unreachable('load should have rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(AssetLoadError);
      expect((error as AssetLoadError).assetName).toBe('level');
    }
  });
});

describe('deterministic ordering', () => {
  it('loads assets strictly in manifest order', async () => {
    const order: string[] = [];
    const io = new FakeIO();
    const wrapped: AssetIO = {
      loadImage: (u) => {
        order.push(u);
        return io.loadImage(u);
      },
      loadAudio: (u) => {
        order.push(u);
        return io.loadAudio(u);
      },
      loadJson: (u) => {
        order.push(u);
        return io.loadJson(u);
      },
      wait: (ms) => io.wait(ms),
    };
    await new AssetLoader(wrapped).load(MANIFEST);
    expect(order).toEqual(['/hero.png', '/ping.mp3', '/level.json']);
  });
});
