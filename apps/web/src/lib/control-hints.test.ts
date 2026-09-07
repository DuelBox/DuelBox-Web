import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HINTS_SEEN_KEY, hasSeenHints, markHintsSeen, resetHints } from './control-hints';

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

describe('control hints, once per game per device (#137)', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has not shown a game before the first play', () => {
    expect(hasSeenHints('pool')).toBe(false);
  });

  it('remembers a game after its hints are shown, across reads', () => {
    markHintsSeen('pool');
    expect(hasSeenHints('pool')).toBe(true);
    // A different game is still unseen — the memory is per game, not global.
    expect(hasSeenHints('darts')).toBe(false);
  });

  it('is idempotent: marking twice does not duplicate', () => {
    markHintsSeen('pool');
    markHintsSeen('pool');
    const raw: unknown = JSON.parse(globalThis.localStorage.getItem(HINTS_SEEN_KEY) ?? '{}');
    expect(raw).toEqual({ version: 1, seen: ['pool'] });
  });

  it('shows hints again after a reset', () => {
    markHintsSeen('pool');
    markHintsSeen('darts');
    resetHints();
    expect(hasSeenHints('pool')).toBe(false);
    expect(hasSeenHints('darts')).toBe(false);
    expect(globalThis.localStorage.getItem(HINTS_SEEN_KEY)).toBeNull();
  });

  it('ignores an empty game id and junk in storage', () => {
    expect(hasSeenHints('')).toBe(false);
    markHintsSeen(''); // no-op
    expect(globalThis.localStorage.getItem(HINTS_SEEN_KEY)).toBeNull();
    install(fakeStorage({ [HINTS_SEEN_KEY]: '{"version":1,"seen":[1,"pool","",null]}' }));
    expect(hasSeenHints('pool')).toBe(true);
  });

  it('survives storage being absent entirely', () => {
    install(undefined);
    expect(hasSeenHints('pool')).toBe(false);
    expect(() => {
      markHintsSeen('pool');
      resetHints();
    }).not.toThrow();
  });
});
