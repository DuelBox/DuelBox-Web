import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFavourites,
  FAVOURITES_KEY,
  isFavourite,
  readFavourites,
  toggleFavourite,
} from './favourites';

/** A minimal localStorage, so these tests do not need a DOM. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: () => null,
    length: 0,
  } as Storage;
}

function install(storage: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

describe('marking favourites', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with none', () => {
    expect(readFavourites()).toEqual([]);
    expect(isFavourite('chess')).toBe(false);
  });

  it('adds on the first toggle and removes on the second', () => {
    expect(toggleFavourite('chess')).toEqual(['chess']);
    expect(isFavourite('chess')).toBe(true);
    expect(toggleFavourite('chess')).toEqual([]);
    expect(isFavourite('chess')).toBe(false);
  });

  it('keeps the order they were marked in', () => {
    // The tile a thumb has learned the position of must not move because a game with an
    // earlier name was starred later.
    toggleFavourite('pool');
    toggleFavourite('air-hockey');
    toggleFavourite('chess');
    expect(readFavourites()).toEqual(['pool', 'air-hockey', 'chess']);
    toggleFavourite('air-hockey');
    expect(readFavourites()).toEqual(['pool', 'chess']);
  });

  it('stores a version under its own key', () => {
    toggleFavourite('chess');
    const raw: unknown = JSON.parse(globalThis.localStorage.getItem(FAVOURITES_KEY) ?? '{}');
    expect(FAVOURITES_KEY).toBe('duelbox:favourites');
    expect(raw).toEqual({ version: 1, slugs: ['chess'] });
  });

  it('clears the lot', () => {
    toggleFavourite('chess');
    toggleFavourite('pool');
    clearFavourites();
    expect(readFavourites()).toEqual([]);
    expect(globalThis.localStorage.getItem(FAVOURITES_KEY)).toBeNull();
  });
});

describe('surviving whatever is actually in storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores unparseable content and a value of the wrong shape', () => {
    for (const raw of ['{not json', '["chess"]', '{"version":1,"slugs":"chess"}', 'null']) {
      install(fakeStorage({ [FAVOURITES_KEY]: raw }));
      expect(readFavourites(), raw).toEqual([]);
    }
  });

  it('ignores a version it has never heard of', () => {
    install(fakeStorage({ [FAVOURITES_KEY]: '{"version":2,"slugs":["chess"]}' }));
    expect(readFavourites()).toEqual([]);
  });

  it('drops entries that are not slugs and keeps the ones that are, once each', () => {
    install(
      fakeStorage({
        [FAVOURITES_KEY]: '{"version":1,"slugs":["chess",3,null,"pool","chess","",{"a":1}]}',
      }),
    );
    expect(readFavourites()).toEqual(['chess', 'pool']);
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readFavourites()).toEqual([]);
    // What the player sees should be what they just did, even when nothing remembers it.
    expect(toggleFavourite('chess')).toEqual(['chess']);
    expect(() => {
      clearFavourites();
    }).not.toThrow();
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(toggleFavourite('chess')).toEqual(['chess']);
  });
});
