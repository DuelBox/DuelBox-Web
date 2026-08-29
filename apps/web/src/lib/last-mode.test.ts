import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLastMode, readSetup, writeLastMode, writeSetup } from './last-mode';

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

/**
 * The rest of the setup: the bot's tier and the match length.
 *
 * Remembered in the same key and the same blob as the mode, because a second store would
 * be a second set of these failure paths to get right — and this file is mostly failure
 * paths.
 */
describe('remembering the whole pre-match setup', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('hands back the defaults for a game never played', () => {
    expect(readSetup('chess')).toEqual({ mode: null, difficulty: 'normal', rounds: 3 });
  });

  it('remembers a tier and a length per game', () => {
    writeSetup('chess', { difficulty: 'hard', rounds: 5 });
    writeSetup('air-hockey', { difficulty: 'easy' });
    expect(readSetup('chess')).toEqual({ mode: null, difficulty: 'hard', rounds: 5 });
    expect(readSetup('air-hockey')).toEqual({ mode: null, difficulty: 'easy', rounds: 3 });
  });

  it('patches one field without disturbing the others', () => {
    // Two controls and a pair of mode buttons all write to one entry, so a write that
    // replaced the entry would lose whichever choice was made first.
    writeSetup('chess', { mode: 'bot' });
    writeSetup('chess', { difficulty: 'hard' });
    writeSetup('chess', { rounds: 1 });
    expect(readSetup('chess')).toEqual({ mode: 'bot', difficulty: 'hard', rounds: 1 });
  });

  it('stores a version, as #152 asks', () => {
    writeSetup('chess', { difficulty: 'hard' });
    const raw: unknown = JSON.parse(globalThis.localStorage.getItem('duelbox:last-mode') ?? '{}');
    expect(raw).toMatchObject({ version: 1, games: { chess: { difficulty: 'hard' } } });
  });

  it('keeps a mode chosen before the setup was versioned', () => {
    // The shape the site wrote until this change: a bare map of slug to mode. A player
    // upgrading mid-sitting keeps what they chose rather than being quietly reset.
    install(fakeStorage({ 'duelbox:last-mode': '{"chess":"bot","pool":"friend"}' }));
    expect(readSetup('chess')).toEqual({ mode: 'bot', difficulty: 'normal', rounds: 3 });
    expect(readLastMode('pool')).toBe('friend');

    // And the next write migrates it, without losing the games it did not touch.
    writeSetup('chess', { difficulty: 'hard' });
    expect(readSetup('chess')).toEqual({ mode: 'bot', difficulty: 'hard', rounds: 3 });
    expect(readLastMode('pool')).toBe('friend');
  });

  it('ignores a version it has never heard of', () => {
    // A future shape is not something this build can interpret, and guessing at it is how
    // one tab corrupts another's settings.
    install(
      fakeStorage({ 'duelbox:last-mode': '{"version":99,"games":{"chess":{"mode":"bot"}}}' }),
    );
    expect(readSetup('chess')).toEqual({ mode: null, difficulty: 'normal', rounds: 3 });
  });

  it('drops a field it does not recognise and keeps the ones it does', () => {
    install(
      fakeStorage({
        'duelbox:last-mode':
          '{"version":1,"games":{"chess":{"mode":"bot","difficulty":"telepathy","rounds":4}}}',
      }),
    );
    // Four rounds is not a length the shell offers, and an unknown tier is not one any
    // game implements — but neither should cost the player their mode.
    expect(readSetup('chess')).toEqual({ mode: 'bot', difficulty: 'normal', rounds: 3 });
  });

  it('never hands back a length no game would be asked to play', () => {
    // Checked on the way out rather than on the way in: whatever is in storage is
    // untrusted whoever wrote it, so the read is the gate and there is only one of them.
    writeSetup('chess', { rounds: 4 });
    expect(readSetup('chess').rounds).toBe(3);
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readSetup('chess')).toEqual({ mode: null, difficulty: 'normal', rounds: 3 });
    expect(() => {
      writeSetup('chess', { difficulty: 'hard' });
    }).not.toThrow();
  });

  it('survives an entry of the wrong shape entirely', () => {
    install(fakeStorage({ 'duelbox:last-mode': '{"version":1,"games":{"chess":"bot"}}' }));
    expect(readSetup('chess')).toEqual({ mode: null, difficulty: 'normal', rounds: 3 });
  });
});
