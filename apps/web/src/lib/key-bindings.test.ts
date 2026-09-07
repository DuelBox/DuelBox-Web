import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS, type KeyBinding } from '@duelbox/engine';
import {
  KEY_BINDINGS_KEY,
  keyLabel,
  readBindings,
  resetBindings,
  resetSeatBinding,
  validateBindingChange,
  writeSeatBinding,
} from './key-bindings';

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

/** A left-hand binding that avoids every default and every reserved key. */
const IJKL: KeyBinding = { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', action: 'KeyU' };

describe('reading and writing bindings', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hands back the code-based defaults when nothing is stored', () => {
    expect(readBindings()).toEqual({ p1: DEFAULT_BINDINGS.p1, p2: DEFAULT_BINDINGS.p2 });
  });

  it('persists a valid per-seat change that survives a reload', () => {
    const result = writeSeatBinding('p1', IJKL);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    // A fresh read — as after a reload — returns the stored binding for p1 and the default p2.
    expect(readBindings().p1).toEqual(IJKL);
    expect(readBindings().p2).toEqual(DEFAULT_BINDINGS.p2);
  });

  it('rebinds each seat independently without disturbing the other', () => {
    writeSeatBinding('p1', IJKL);
    const p2Custom: KeyBinding = {
      up: 'KeyT',
      down: 'KeyG',
      left: 'KeyF',
      right: 'KeyH',
      action: 'KeyR',
    };
    writeSeatBinding('p2', p2Custom);
    expect(readBindings()).toEqual({ p1: IJKL, p2: p2Custom });
  });

  it('refuses a key already used by the other seat and leaves storage untouched', () => {
    // ArrowUp belongs to p2 by default.
    const clash: KeyBinding = { ...DEFAULT_BINDINGS.p1, up: 'ArrowUp' };
    const result = writeSeatBinding('p1', clash);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('ArrowUp');
    expect(readBindings().p1).toEqual(DEFAULT_BINDINGS.p1); // unchanged
  });

  it('refuses a reserved system key with a clear reason', () => {
    const reserved: KeyBinding = { ...IJKL, action: 'Escape' };
    const result = writeSeatBinding('p1', reserved);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/reserved/i);
  });

  it('refuses a seat that binds one key to two slots', () => {
    const doubled: KeyBinding = { ...IJKL, up: 'KeyI', down: 'KeyI' };
    const result = writeSeatBinding('p1', doubled);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('KeyI');
  });

  it('resets one seat to its default and forgets all bindings on a full reset', () => {
    writeSeatBinding('p1', IJKL);
    resetSeatBinding('p1');
    expect(readBindings().p1).toEqual(DEFAULT_BINDINGS.p1);

    writeSeatBinding('p1', IJKL);
    resetBindings();
    expect(globalThis.localStorage.getItem(KEY_BINDINGS_KEY)).toBeNull();
    expect(readBindings()).toEqual({ p1: DEFAULT_BINDINGS.p1, p2: DEFAULT_BINDINGS.p2 });
  });
});

describe('surviving whatever is in storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the defaults for a malformed or conflicting stored pair', () => {
    for (const raw of [
      '{"version":1,"p1":{"up":"KeyW"}}', // incomplete
      '{"version":1,"p1":"nope","p2":"nope"}', // wrong type
      // A stored cross-seat conflict this build cannot honour: p1 and p2 both on ArrowUp.
      '{"version":1,"p1":{"up":"ArrowUp","down":"KeyS","left":"KeyA","right":"KeyD","action":"Space"},"p2":{"up":"ArrowUp","down":"ArrowDown","left":"ArrowLeft","right":"ArrowRight","action":"Enter"}}',
    ]) {
      install(fakeStorage({ [KEY_BINDINGS_KEY]: raw }));
      expect(readBindings(), raw).toEqual({ p1: DEFAULT_BINDINGS.p1, p2: DEFAULT_BINDINGS.p2 });
    }
  });

  it('survives storage being absent entirely', () => {
    install(undefined);
    expect(readBindings()).toEqual({ p1: DEFAULT_BINDINGS.p1, p2: DEFAULT_BINDINGS.p2 });
    expect(writeSeatBinding('p1', IJKL).ok).toBe(true);
    expect(() => {
      resetBindings();
    }).not.toThrow();
  });
});

describe('validateBindingChange and keyLabel', () => {
  it('reports no errors for a clean binding', () => {
    expect(validateBindingChange('p1', IJKL, DEFAULT_BINDINGS.p2)).toHaveLength(0);
  });

  it('labels codes for display without ever changing what is stored', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('F13')).toBe('F13'); // unrecognised: shown as-is
  });
});
