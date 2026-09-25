import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlayerNames,
  MAX_NAME_LENGTH,
  PLAYER_NAMES_KEY,
  readPlayerNames,
  writePlayerName,
} from './player-names';

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

describe('naming the two seats', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('starts with neither seat named, so both keep their own names', () => {
    expect(readPlayerNames()).toEqual({});
  });

  it('names one seat without touching the other', () => {
    writePlayerName('p1', 'Ada');
    expect(readPlayerNames()).toEqual({ p1: 'Ada' });
    writePlayerName('p2', 'Grace');
    expect(readPlayerNames()).toEqual({ p1: 'Ada', p2: 'Grace' });
  });

  it('overwrites rather than accumulating', () => {
    writePlayerName('p1', 'Ada');
    writePlayerName('p1', 'Alan');
    expect(readPlayerNames()).toEqual({ p1: 'Alan' });
  });

  it('trims the ends and collapses the middle', () => {
    // A name is typed into a text field, so this is where the stray spaces come from.
    writePlayerName('p1', '  Ada   B  ');
    expect(readPlayerNames()).toEqual({ p1: 'Ada B' });
  });

  it('caps a long name, and does not leave it ending in a space', () => {
    writePlayerName('p1', 'Bartholomew the Third');
    const stored = readPlayerNames().p1 ?? '';
    expect(stored.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(stored).toBe('Bartholomew');
  });

  it('takes an empty name as clearing that seat back to its own', () => {
    writePlayerName('p1', 'Ada');
    writePlayerName('p2', 'Grace');
    writePlayerName('p1', '   ');
    expect(readPlayerNames()).toEqual({ p2: 'Grace' });
  });

  it('leaves nothing stored once both seats are cleared', () => {
    // An export from a browser where nobody typed a name should say so, rather than
    // carrying an envelope with no names in it.
    writePlayerName('p1', 'Ada');
    writePlayerName('p1', '');
    expect(globalThis.localStorage.getItem(PLAYER_NAMES_KEY)).toBeNull();
  });

  it('clears both at once', () => {
    writePlayerName('p1', 'Ada');
    writePlayerName('p2', 'Grace');
    clearPlayerNames();
    expect(readPlayerNames()).toEqual({});
  });
});

describe('surviving whatever is actually in storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores unparseable content', () => {
    install(fakeStorage({ [PLAYER_NAMES_KEY]: '{not json' }));
    expect(readPlayerNames()).toEqual({});
  });

  it('ignores a version it has never heard of', () => {
    install(fakeStorage({ [PLAYER_NAMES_KEY]: '{"version":99,"p1":"Ada"}' }));
    expect(readPlayerNames()).toEqual({});
  });

  it('drops a name that is not a string, and one that is only whitespace', () => {
    install(fakeStorage({ [PLAYER_NAMES_KEY]: '{"version":1,"p1":42,"p2":"  "}' }));
    expect(readPlayerNames()).toEqual({});
  });

  it('cuts a name a hand-edited store made too long', () => {
    // Checked on the way out as well as on the way in: what is under the key was written
    // by another tab, an older build, or somebody with the console open.
    install(fakeStorage({ [PLAYER_NAMES_KEY]: '{"version":1,"p1":"a name far too long"}' }));
    expect((readPlayerNames().p1 ?? '').length).toBe(MAX_NAME_LENGTH);
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readPlayerNames()).toEqual({});
    expect(() => {
      writePlayerName('p1', 'Ada');
    }).not.toThrow();
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(() => {
      writePlayerName('p1', 'Ada');
    }).not.toThrow();
  });
});
