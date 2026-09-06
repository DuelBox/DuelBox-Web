import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRecord,
  KEY_PREFIX,
  readJson,
  readVersioned,
  removeJson,
  uniqueStrings,
  writeJson,
  writeVersioned,
} from './local-store';

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

const KEY = `${KEY_PREFIX}test`;

describe('reading and writing JSON', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes every key the site writes', () => {
    // A reader of DevTools should be able to tell whose keys these are at a glance.
    expect(KEY_PREFIX).toBe('duelbox:');
  });

  it('round-trips a value and reports the write', () => {
    expect(writeJson(KEY, { a: 1, b: ['x'] })).toBe(true);
    expect(readJson(KEY)).toEqual({ a: 1, b: ['x'] });
  });

  it('reads null for a key that was never written', () => {
    expect(readJson(KEY)).toBeNull();
  });

  it('reads null for content that is not JSON', () => {
    install(fakeStorage({ [KEY]: '{not json' }));
    expect(readJson(KEY)).toBeNull();
  });

  it('refuses to write a value JSON cannot carry', () => {
    // `JSON.stringify(undefined)` is `undefined`, and writing the string "undefined" would
    // leave a value no reader can parse.
    expect(writeJson(KEY, undefined)).toBe(false);
    expect(readJson(KEY)).toBeNull();
  });

  it('removes a key, and does not mind if it was never there', () => {
    writeJson(KEY, 1);
    removeJson(KEY);
    expect(readJson(KEY)).toBeNull();
    expect(() => {
      removeJson(KEY);
    }).not.toThrow();
  });
});

describe('surviving whatever storage does', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readJson(KEY)).toBeNull();
    expect(writeJson(KEY, 1)).toBe(false);
    expect(() => {
      removeJson(KEY);
    }).not.toThrow();
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(writeJson(KEY, 1)).toBe(false);
  });

  it('survives a read throwing, as when storage is blocked by policy', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    install(storage);
    expect(readJson(KEY)).toBeNull();
  });

  it('survives a removal throwing', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    install(storage);
    expect(() => {
      removeJson(KEY);
    }).not.toThrow();
  });
});

describe('versioned values', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('writes the version alongside the data', () => {
    expect(writeVersioned(KEY, 1, { slugs: ['chess'] })).toBe(true);
    expect(readJson(KEY)).toEqual({ version: 1, slugs: ['chess'] });
  });

  it('reads back only the version it was asked for', () => {
    writeVersioned(KEY, 1, { slugs: ['chess'] });
    expect(readVersioned(KEY, 1)).toEqual({ version: 1, slugs: ['chess'] });
    // A future shape is not something this build can interpret, and guessing at it is
    // how one tab corrupts another's settings.
    expect(readVersioned(KEY, 2)).toBeNull();
  });

  it('reads null for anything that is not a versioned object', () => {
    for (const raw of ['null', '[]', '"1"', '{"slugs":[]}', '{"version":"1"}', '{not json']) {
      install(fakeStorage({ [KEY]: raw }));
      expect(readVersioned(KEY, 1), raw).toBeNull();
    }
  });
});

describe('the shared validators', () => {
  it('recognises a plain object and nothing else', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ version: 1 })).toBe(true);
    for (const value of [null, undefined, [], 'x', 1, true]) {
      expect(isRecord(value), String(value)).toBe(false);
    }
  });

  it('keeps the strings of a list, in order, once each', () => {
    expect(uniqueStrings(['b', 'a', 'b', 1, null, '', 'a', {}])).toEqual(['b', 'a']);
  });

  it('turns anything that is not a list into an empty one', () => {
    for (const value of [null, undefined, 'chess', 1, { 0: 'chess' }]) {
      expect(uniqueStrings(value), JSON.stringify(value)).toEqual([]);
    }
  });
});
