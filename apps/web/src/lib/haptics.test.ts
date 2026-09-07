import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAPTIC_PATTERNS, hapticsSupported, vibrate, type HapticName } from './haptics';
import { SETTINGS_KEY } from './settings';

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

/**
 * Node has a `navigator` of its own since version 21, with no `vibrate` on it — which is
 * exactly iOS Safari's shape, and the reason the original is saved and restored rather
 * than assumed absent.
 */
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function installNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function restoreNavigator(): void {
  if (originalNavigator === undefined) {
    delete (globalThis as { navigator?: unknown }).navigator;
  } else {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  }
}

const HAPTICS_ON = { [SETTINGS_KEY]: '{"version":1,"haptics":true}' };

describe('the patterns', () => {
  it('names every event a game can report, and keeps them short', () => {
    const names: HapticName[] = ['tap', 'score', 'win', 'lose'];
    for (const name of names) {
      const pattern = HAPTIC_PATTERNS[name];
      expect(pattern.length, name).toBeGreaterThan(0);
      // Both players are holding the same device, and only one of them won.
      expect(
        pattern.reduce((sum, ms) => sum + ms, 0),
        name,
      ).toBeLessThan(500);
    }
  });
});

describe('support detection', () => {
  afterEach(restoreNavigator);

  it('is false where navigator has no vibrate, as on iOS Safari and the build machine', () => {
    installNavigator({});
    expect(hapticsSupported()).toBe(false);
  });

  it('is false where there is no navigator at all', () => {
    installNavigator(undefined);
    expect(hapticsSupported()).toBe(false);
  });

  it('is true where vibrate is a function', () => {
    installNavigator({ vibrate: () => true });
    expect(hapticsSupported()).toBe(true);
  });
});

describe('vibrating', () => {
  beforeEach(() => {
    install(fakeStorage(HAPTICS_ON));
  });
  afterEach(() => {
    restoreNavigator();
    vi.restoreAllMocks();
  });

  it('calls the browser with the named pattern when on and supported', () => {
    const calls: unknown[] = [];
    installNavigator({
      vibrate: (pattern: unknown) => {
        calls.push(pattern);
        return true;
      },
    });
    expect(vibrate('win')).toBe(true);
    expect(calls).toEqual([[...HAPTIC_PATTERNS.win]]);
  });

  it('is off by default, so a fresh install never buzzes', () => {
    install(fakeStorage());
    const spy = vi.fn(() => true);
    installNavigator({ vibrate: spy });
    expect(vibrate('tap')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stays quiet when the player has turned it off', () => {
    install(fakeStorage({ [SETTINGS_KEY]: '{"version":1,"haptics":false}' }));
    const spy = vi.fn(() => true);
    installNavigator({ vibrate: spy });
    expect(vibrate('score')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is a no-op where the device cannot vibrate', () => {
    installNavigator({});
    expect(vibrate('tap')).toBe(false);
    installNavigator(undefined);
    expect(vibrate('tap')).toBe(false);
  });

  it('reports false when the browser declines the pattern', () => {
    installNavigator({ vibrate: () => false });
    expect(vibrate('lose')).toBe(false);
  });

  it('never throws, whatever the browser does', () => {
    installNavigator({
      vibrate: () => {
        throw new TypeError('not allowed');
      },
    });
    expect(vibrate('tap')).toBe(false);
  });
});
