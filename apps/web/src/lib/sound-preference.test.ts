import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUME,
  defaultSoundPreference,
  prefersReducedMotion,
  readSoundPreference,
  writeSoundPreference,
} from './sound-preference';

/**
 * The same three things `last-mode.test.ts` checks of the other stored preference: it
 * round-trips, it survives anything at all being in storage, and it never throws when
 * storage is missing. Plus the one that is specific to sound — the OS-derived default.
 */

const KEY = 'duelbox:sound';

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const scope = globalThis as unknown as {
  localStorage?: FakeStorage;
  matchMedia?: (query: string) => { matches: boolean };
};

const originalStorage = scope.localStorage;
const originalMatchMedia = scope.matchMedia;

function useStorage(store: Map<string, string> | null): void {
  if (store === null) {
    delete scope.localStorage;
    return;
  }
  scope.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

function useReducedMotion(reduce: boolean): void {
  scope.matchMedia = () => ({ matches: reduce });
}

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  useStorage(store);
  useReducedMotion(false);
});

afterEach(() => {
  if (originalStorage === undefined) delete scope.localStorage;
  else scope.localStorage = originalStorage;
  if (originalMatchMedia === undefined) delete scope.matchMedia;
  else scope.matchMedia = originalMatchMedia;
});

describe('readSoundPreference', () => {
  it('starts unmuted at a level nobody has to turn down', () => {
    expect(readSoundPreference()).toEqual({ muted: false, volume: DEFAULT_VOLUME });
  });

  it('round-trips what was written', () => {
    writeSoundPreference({ muted: true, volume: 0.25 });
    expect(readSoundPreference()).toEqual({ muted: true, volume: 0.25 });
  });

  it('remembers the level through a mute, so unmuting restores it', () => {
    writeSoundPreference({ volume: 0.4 });
    writeSoundPreference({ muted: true });
    expect(readSoundPreference()).toEqual({ muted: true, volume: 0.4 });
    writeSoundPreference({ muted: false });
    expect(readSoundPreference().volume).toBe(0.4);
  });

  it('clamps a level to [0, 1] on the way in as well as out', () => {
    expect(writeSoundPreference({ volume: 4 }).volume).toBe(1);
    expect(writeSoundPreference({ volume: -2 }).volume).toBe(0);
    expect(writeSoundPreference({ volume: Number.NaN }).volume).toBe(DEFAULT_VOLUME);
  });

  it.each([
    ['not JSON at all', 'not json'],
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['a version this build does not know', '{"version":99,"muted":true}'],
    ['a mute that is not a boolean', '{"version":1,"muted":"yes"}'],
    ['a volume that is not a number', '{"version":1,"volume":"loud"}'],
  ])('falls back rather than trusting %s', (_label, raw) => {
    store.set(KEY, raw);
    const preference = readSoundPreference();
    expect(typeof preference.muted).toBe('boolean');
    expect(preference.volume).toBeGreaterThanOrEqual(0);
    expect(preference.volume).toBeLessThanOrEqual(1);
  });

  it('keeps the fields it can when one of them is corrupt', () => {
    // Field by field, as `last-mode.ts` does: a bad volume must not cost the mute.
    store.set(KEY, '{"version":1,"muted":true,"volume":"loud"}');
    expect(readSoundPreference()).toEqual({ muted: true, volume: DEFAULT_VOLUME });
  });

  it('returns the default when there is no storage at all', () => {
    // Private browsing on some engines. Reaching for `localStorage` throws, and a broken
    // play page is a far worse outcome than a forgotten volume.
    useStorage(null);
    expect(readSoundPreference()).toEqual({ muted: false, volume: DEFAULT_VOLUME });
    expect(() => writeSoundPreference({ muted: true })).not.toThrow();
  });
});

describe('the OS default', () => {
  it('starts muted for somebody who asked for less sensory intensity', () => {
    useReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(defaultSoundPreference()).toEqual({ muted: true, volume: DEFAULT_VOLUME });
    expect(readSoundPreference().muted).toBe(true);
  });

  it('is only a default: a stored choice wins', () => {
    useReducedMotion(true);
    writeSoundPreference({ muted: false });
    expect(readSoundPreference().muted).toBe(false);
  });

  it('reports no preference where there is no matchMedia, rather than throwing', () => {
    // This module is imported by a statically exported page and evaluated during the
    // build, in Node, where there is no `matchMedia` at all.
    delete scope.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});
