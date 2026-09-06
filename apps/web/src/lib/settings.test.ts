import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  readSettings,
  resetSettings,
  SETTINGS_KEY,
  writeSettings,
} from './settings';

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

describe('the defaults', () => {
  it('start with sound on and vibration off', () => {
    // Sound is what a player expects from a game. A phone buzzing against the table
    // between two people is a surprise, so vibration is opted into (#135).
    expect(DEFAULT_SETTINGS).toEqual({ muted: false, volume: 1, haptics: false });
  });
});

describe('reading and writing settings', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hands back the defaults when nothing is stored', () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('remembers a change across reads, which is what #171 asks for', () => {
    writeSettings({ muted: true });
    expect(readSettings().muted).toBe(true);
  });

  it('patches one field without disturbing the others', () => {
    // A mute button must not reset a volume the player set on another page.
    writeSettings({ volume: 0.4 });
    writeSettings({ muted: true });
    writeSettings({ haptics: true });
    expect(readSettings()).toEqual({ muted: true, volume: 0.4, haptics: true });
  });

  it('returns what it kept, not what it was asked for', () => {
    expect(writeSettings({ volume: 7 }).volume).toBe(1);
    expect(writeSettings({ volume: -2 }).volume).toBe(0);
    expect(readSettings().volume).toBe(0);
  });

  it('stores a version under its own key', () => {
    writeSettings({ muted: true });
    const raw: unknown = JSON.parse(globalThis.localStorage.getItem(SETTINGS_KEY) ?? '{}');
    expect(SETTINGS_KEY).toBe('duelbox:settings');
    expect(raw).toEqual({ version: 1, muted: true, volume: 1, haptics: false });
  });

  it('resets to the defaults by forgetting, not by writing them', () => {
    writeSettings({ muted: true, volume: 0.2, haptics: true });
    resetSettings();
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
    expect(globalThis.localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
});

describe('surviving whatever is actually in storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores unparseable content, the wrong shape and an unknown version', () => {
    for (const raw of ['{not json', '[true]', '"muted"', '{"version":2,"muted":true}']) {
      install(fakeStorage({ [SETTINGS_KEY]: raw }));
      expect(readSettings(), raw).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('takes the default for a field that is wrong and keeps the ones that are right', () => {
    // Field by field: a volume this build cannot read should cost the player their
    // volume, not their mute as well.
    install(
      fakeStorage({
        [SETTINGS_KEY]: '{"version":1,"muted":true,"volume":"loud","haptics":"yes"}',
      }),
    );
    expect(readSettings()).toEqual({ muted: true, volume: 1, haptics: false });
  });

  it('clamps a stored volume into range and refuses one that is not a number', () => {
    for (const [stored, expected] of [
      [1.5, 1],
      [-0.5, 0],
      [0.25, 0.25],
      ['NaN', 1],
      [null, 1],
    ] as const) {
      const volume = stored === 'NaN' ? 'null' : JSON.stringify(stored);
      install(fakeStorage({ [SETTINGS_KEY]: `{"version":1,"volume":${volume}}` }));
      expect(readSettings().volume, String(stored)).toBe(expected);
    }
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
    expect(writeSettings({ muted: true })).toEqual({ ...DEFAULT_SETTINGS, muted: true });
    expect(() => {
      resetSettings();
    }).not.toThrow();
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(writeSettings({ haptics: true }).haptics).toBe(true);
  });
});
