/**
 * Asset loader with combined progress, retries, and per-game scoping.
 *
 * A game that pops in half-loaded looks broken, so the shell needs a real 0..1
 * progress signal to show and a guarantee that loading has actually finished before
 * a match starts. This loader gives both: it works a per-game manifest in order,
 * reports a combined progress that reaches *exactly* 1 when every asset is in, and
 * retries a failed fetch twice with growing backoff so a transient network blip
 * recovers without a reload.
 *
 * It touches no browser API. Static export builds run on the server, where `window`
 * and `document` do not exist, so nothing here — least of all at module scope — may
 * reach for them. The browser specifics (Image decode, fetch, AudioContext) live
 * behind the injected {@link AssetIO} seam, which the host supplies and a test fakes,
 * so the whole loader runs in plain Node. The wait between retries is injected the
 * same way, which is also what makes the backoff schedule deterministic and testable
 * rather than a real timer.
 *
 * Loading is sequential in manifest order, so both the progress sequence and the
 * order effects happen are deterministic run to run.
 */

export type AssetKind = 'image' | 'audio' | 'json';

/** One entry in a game's manifest. `name` is how the game later looks the asset up. */
export interface AssetDescriptor {
  readonly name: string;
  readonly url: string;
  readonly kind: AssetKind;
}

/** The minimal shape the loader needs of a decoded image. A real HTMLImageElement satisfies it. */
export interface ImageLike {
  readonly width: number;
  readonly height: number;
}

/** The minimal shape the loader needs of decoded audio. A real AudioBuffer satisfies it. */
export interface AudioLike {
  readonly duration: number;
}

/**
 * The browser seam. Every method returns a promise and may reject; the loader owns
 * the retry policy, so an implementation just tries once. `wait` is the only timer
 * in the whole system and is injected so tests need no real clock.
 */
export interface AssetIO {
  loadImage(url: string): Promise<ImageLike>;
  loadAudio(url: string): Promise<AudioLike>;
  loadJson(url: string): Promise<unknown>;
  /** Resolve after roughly `ms` milliseconds. The loader uses it only between retries. */
  wait(ms: number): Promise<void>;
}

export interface AssetLoaderOptions {
  /** Extra attempts after the first, each preceded by a wait. Default 2 (three tries total). */
  readonly retries?: number;
  /** First backoff in ms; each further retry doubles it. Default 100. */
  readonly backoffMs?: number;
  /** Called after each asset lands with the combined progress in [0, 1]. */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * A decoded asset of unknown kind. It is an {@link ImageLike}, an {@link AudioLike},
 * or parsed JSON, but nothing downstream needs to discriminate on the union — the
 * bundle's typed accessors narrow it — so it is simply `unknown` at this seam.
 */
type LoadedValue = unknown;

interface LoadedEntry {
  readonly kind: AssetKind;
  readonly value: LoadedValue;
}

/** Thrown when an asset still fails after every retry. Names the asset that gave up. */
export class AssetLoadError extends Error {
  readonly assetName: string;
  readonly url: string;
  constructor(assetName: string, url: string, cause: unknown) {
    super(`asset "${assetName}" (${url}) failed to load after retries`);
    this.name = 'AssetLoadError';
    this.assetName = assetName;
    this.url = url;
    this.cause = cause;
  }
}

/**
 * The resolved assets of one game, looked up by name. The typed accessors assert the
 * asset exists and is of the kind asked for, so a game never silently reads an image
 * as JSON.
 */
export class AssetBundle {
  readonly #entries: ReadonlyMap<string, LoadedEntry>;

  constructor(entries: ReadonlyMap<string, LoadedEntry>) {
    this.#entries = entries;
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  image(name: string): ImageLike {
    return this.#require(name, 'image') as ImageLike;
  }

  audio(name: string): AudioLike {
    return this.#require(name, 'audio') as AudioLike;
  }

  json<T = unknown>(name: string): T {
    return this.#require(name, 'json') as T;
  }

  #require(name: string, kind: AssetKind): LoadedValue {
    const entry = this.#entries.get(name);
    if (entry === undefined) {
      throw new Error(`asset "${name}" is not in this bundle`);
    }
    if (entry.kind !== kind) {
      throw new Error(`asset "${name}" is a ${entry.kind}, not a ${kind}`);
    }
    return entry.value;
  }
}

export class AssetLoader {
  readonly #io: AssetIO;
  readonly #retries: number;
  readonly #backoffMs: number;
  readonly #onProgress: ((fraction: number) => void) | undefined;

  #progress = 0;

  constructor(io: AssetIO, options?: AssetLoaderOptions) {
    const retries = options?.retries ?? 2;
    const backoffMs = options?.backoffMs ?? 100;
    if (!Number.isInteger(retries) || retries < 0) {
      throw new RangeError(`retries must be a non-negative integer, received ${String(retries)}`);
    }
    if (!Number.isFinite(backoffMs) || backoffMs < 0) {
      throw new RangeError(`backoffMs must be a non-negative number, received ${String(backoffMs)}`);
    }
    this.#io = io;
    this.#retries = retries;
    this.#backoffMs = backoffMs;
    this.#onProgress = options?.onProgress;
  }

  /** Combined progress in [0, 1]. 1 once a load has fully completed; 0 before one starts. */
  get progress(): number {
    return this.#progress;
  }

  /**
   * Load a game's manifest. Resolves to a bundle once every asset is in, with
   * progress at exactly 1. Rejects with {@link AssetLoadError} if any asset never
   * loads, having retried it the configured number of times with backoff.
   */
  async load(descriptors: readonly AssetDescriptor[]): Promise<AssetBundle> {
    const total = descriptors.length;
    const entries = new Map<string, LoadedEntry>();
    if (total === 0) {
      this.#setProgress(1);
      return new AssetBundle(entries);
    }
    this.#setProgress(0);

    for (let i = 0; i < total; i += 1) {
      const descriptor = descriptors[i]!;
      const value = await this.#loadOneWithRetry(descriptor);
      entries.set(descriptor.name, { kind: descriptor.kind, value });
      // Count-based, so progress climbs the same way every run and lands on exactly 1.
      this.#setProgress((i + 1) / total);
    }
    return new AssetBundle(entries);
  }

  async #loadOneWithRetry(descriptor: AssetDescriptor): Promise<LoadedValue> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      if (attempt > 0) {
        // Exponential backoff: 1x, 2x, 4x ... of the base delay.
        await this.#io.wait(this.#backoffMs * 2 ** (attempt - 1));
      }
      try {
        return await this.#loadOne(descriptor);
      } catch (error) {
        lastError = error;
      }
    }
    throw new AssetLoadError(descriptor.name, descriptor.url, lastError);
  }

  #loadOne(descriptor: AssetDescriptor): Promise<LoadedValue> {
    switch (descriptor.kind) {
      case 'image':
        return this.#io.loadImage(descriptor.url);
      case 'audio':
        return this.#io.loadAudio(descriptor.url);
      case 'json':
        return this.#io.loadJson(descriptor.url);
    }
  }

  #setProgress(fraction: number): void {
    this.#progress = fraction;
    this.#onProgress?.(fraction);
  }
}
