import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecent, readRecent, RECENT_CAP, RECENT_KEY, recordPlayed } from './recent';

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

describe('remembering recent games', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts empty', () => {
    expect(readRecent()).toEqual([]);
  });

  it('puts the most recent game first', () => {
    recordPlayed('chess');
    recordPlayed('pool');
    expect(recordPlayed('air-hockey')).toEqual(['air-hockey', 'pool', 'chess']);
    expect(readRecent()).toEqual(['air-hockey', 'pool', 'chess']);
  });

  it('moves a game played again to the front rather than listing it twice', () => {
    // Five matches of the same game tonight is one recent game, not five.
    recordPlayed('chess');
    recordPlayed('pool');
    recordPlayed('chess');
    expect(readRecent()).toEqual(['chess', 'pool']);
  });

  it('keeps only the last eight', () => {
    expect(RECENT_CAP).toBe(8);
    for (let index = 0; index < RECENT_CAP + 3; index += 1) recordPlayed(`game-${index}`);
    const recent = readRecent();
    expect(recent).toHaveLength(RECENT_CAP);
    expect(recent[0]).toBe(`game-${RECENT_CAP + 2}`);
    expect(recent).not.toContain('game-0');
  });

  it('stores a version under its own key', () => {
    recordPlayed('chess');
    const raw: unknown = JSON.parse(globalThis.localStorage.getItem(RECENT_KEY) ?? '{}');
    expect(RECENT_KEY).toBe('duelbox:recent');
    expect(raw).toEqual({ version: 1, slugs: ['chess'] });
  });

  it('clears the lot', () => {
    recordPlayed('chess');
    clearRecent();
    expect(readRecent()).toEqual([]);
    expect(globalThis.localStorage.getItem(RECENT_KEY)).toBeNull();
  });
});

describe('surviving whatever is actually in storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores unparseable content, the wrong shape and an unknown version', () => {
    for (const raw of [
      '{not json',
      '["chess"]',
      '{"version":1,"slugs":"chess"}',
      '{"version":2,"slugs":["chess"]}',
    ]) {
      install(fakeStorage({ [RECENT_KEY]: raw }));
      expect(readRecent(), raw).toEqual([]);
    }
  });

  it('drops entries that are not slugs and duplicates, and trims a list that is too long', () => {
    // A longer list written by another build, or by hand, is trimmed rather than trusted.
    const slugs = Array.from({ length: 20 }, (_, index) => `game-${index}`);
    install(
      fakeStorage({
        [RECENT_KEY]: JSON.stringify({ version: 1, slugs: [null, 'game-3', 7, ...slugs] }),
      }),
    );
    const recent = readRecent();
    expect(recent).toHaveLength(RECENT_CAP);
    expect(recent.slice(0, 3)).toEqual(['game-3', 'game-0', 'game-1']);
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readRecent()).toEqual([]);
    expect(recordPlayed('chess')).toEqual(['chess']);
    expect(() => {
      clearRecent();
    }).not.toThrow();
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(recordPlayed('chess')).toEqual(['chess']);
  });
});
