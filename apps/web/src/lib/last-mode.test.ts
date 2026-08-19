import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLastMode, writeLastMode } from './last-mode';

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

describe('remembering the last mode', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for a game never played', () => {
    expect(readLastMode('chess')).toBeNull();
  });

  it('remembers per game, not globally', () => {
    writeLastMode('chess', 'bot');
    writeLastMode('air-hockey', 'friend');
    expect(readLastMode('chess')).toBe('bot');
    expect(readLastMode('air-hockey')).toBe('friend');
  });

  it('overwrites rather than accumulating', () => {
    writeLastMode('chess', 'bot');
    writeLastMode('chess', 'friend');
    expect(readLastMode('chess')).toBe('friend');
  });
});

describe('surviving whatever is actually in storage', () => {
  it('ignores unparseable content', () => {
    install(fakeStorage({ 'duelbox:last-mode': '{not json' }));
    expect(readLastMode('chess')).toBeNull();
  });

  it('ignores a stored value of the wrong shape', () => {
    install(fakeStorage({ 'duelbox:last-mode': '["chess"]' }));
    expect(readLastMode('chess')).toBeNull();
  });

  it('ignores a mode it does not recognise, keeping the ones it does', () => {
    // Another tab, an older version, or a user with the console open.
    install(fakeStorage({ 'duelbox:last-mode': '{"chess":"telepathy","pool":"bot"}' }));
    expect(readLastMode('chess')).toBeNull();
    expect(readLastMode('pool')).toBe('bot');
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readLastMode('chess')).toBeNull();
    expect(() => {
      writeLastMode('chess', 'bot');
    }).not.toThrow();
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(() => {
      writeLastMode('chess', 'bot');
    }).not.toThrow();
  });

  it('survives a read throwing, as when storage is blocked by policy', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    install(storage);
    expect(readLastMode('chess')).toBeNull();
  });
});
