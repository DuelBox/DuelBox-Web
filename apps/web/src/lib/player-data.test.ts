import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAVOURITES_KEY, readFavourites, toggleFavourite } from './favourites';
import { LAST_MODE_KEY, readSetup, writeSetup } from './last-mode';
import {
  exportPlayerData,
  importPlayerData,
  PLAYER_DATA_FORMAT,
  PLAYER_DATA_KEYS,
  PLAYER_DATA_VERSION,
  playerDataSummary,
  resetPlayerData,
} from './player-data';
import { readRecent, RECENT_KEY, recordPlayed } from './recent';
import { DEFAULT_SETTINGS, readSettings, SETTINGS_KEY, writeSettings } from './settings';

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

/** The reason an import was refused, or the empty string if it was not. */
function errorOf(result: ReturnType<typeof importPlayerData>): string {
  return 'error' in result ? result.error : '';
}

/** A browser with something in every store. */
function populate(): void {
  writeSetup('chess', { mode: 'bot', difficulty: 'hard' });
  writeSetup('pool', { rounds: 5 });
  toggleFavourite('chess');
  toggleFavourite('ludo');
  recordPlayed('pool');
  recordPlayed('chess');
  writeSettings({ muted: true, volume: 0.5 });
}

describe('the keys', () => {
  it('cover every store, and nothing else', () => {
    expect(PLAYER_DATA_KEYS).toEqual([LAST_MODE_KEY, FAVOURITES_KEY, RECENT_KEY, SETTINGS_KEY]);
    for (const key of PLAYER_DATA_KEYS) expect(key).toMatch(/^duelbox:/);
  });
});

describe('exporting', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('wraps what is stored, key by key, in a named and versioned envelope', () => {
    populate();
    const parsed: unknown = JSON.parse(exportPlayerData());
    expect(parsed).toEqual({
      format: PLAYER_DATA_FORMAT,
      version: PLAYER_DATA_VERSION,
      data: {
        [LAST_MODE_KEY]: {
          version: 1,
          games: { chess: { mode: 'bot', difficulty: 'hard' }, pool: { rounds: 5 } },
        },
        [FAVOURITES_KEY]: { version: 1, slugs: ['chess', 'ludo'] },
        [RECENT_KEY]: { version: 1, slugs: ['chess', 'pool'] },
        [SETTINGS_KEY]: { version: 1, muted: true, volume: 0.5, haptics: false },
      },
    });
  });

  it('leaves out a store that holds nothing', () => {
    toggleFavourite('chess');
    const parsed: unknown = JSON.parse(exportPlayerData());
    expect(parsed).toEqual({
      format: PLAYER_DATA_FORMAT,
      version: PLAYER_DATA_VERSION,
      data: { [FAVOURITES_KEY]: { version: 1, slugs: ['chess'] } },
    });
  });

  it('exports an empty envelope when storage is absent, rather than throwing', () => {
    install(undefined);
    expect(JSON.parse(exportPlayerData())).toMatchObject({ data: {} });
  });
});

describe('importing', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('brings back exactly what was exported', () => {
    populate();
    const file = exportPlayerData();
    resetPlayerData();
    expect(readFavourites()).toEqual([]);

    expect(importPlayerData(file)).toEqual({ imported: PLAYER_DATA_KEYS });
    expect(readSetup('chess')).toEqual({ mode: 'bot', difficulty: 'hard', rounds: 3 });
    expect(readFavourites()).toEqual(['chess', 'ludo']);
    expect(readRecent()).toEqual(['chess', 'pool']);
    expect(readSettings()).toEqual({ muted: true, volume: 0.5, haptics: false });
  });

  it('refuses text that is not JSON, with a reason', () => {
    expect(errorOf(importPlayerData('{not json'))).toMatch(/JSON/);
  });

  it('refuses a file that is not ours', () => {
    for (const text of ['null', '[]', '{}', '{"format":"something-else","version":1,"data":{}}']) {
      const result = importPlayerData(text);
      expect(result, text).toHaveProperty('error');
    }
  });

  it('refuses a version it does not read, and says which', () => {
    const text = JSON.stringify({ format: PLAYER_DATA_FORMAT, version: 99, data: {} });
    expect(errorOf(importPlayerData(text))).toContain('99');
  });

  it('refuses an envelope with no data section', () => {
    const text = JSON.stringify({ format: PLAYER_DATA_FORMAT, version: PLAYER_DATA_VERSION });
    expect(importPlayerData(text)).toHaveProperty('error');
  });

  it('skips keys it does not know and values that are not objects', () => {
    // A later build may export a store this one has never heard of; that is no reason to
    // refuse the favourites beside it.
    const text = JSON.stringify({
      format: PLAYER_DATA_FORMAT,
      version: PLAYER_DATA_VERSION,
      data: {
        'duelbox:achievements': { version: 1, unlocked: ['first-win'] },
        [RECENT_KEY]: ['chess'],
        [FAVOURITES_KEY]: { version: 1, slugs: ['chess'] },
      },
    });
    expect(importPlayerData(text)).toEqual({ imported: [FAVOURITES_KEY] });
    expect(readFavourites()).toEqual(['chess']);
    expect(readRecent()).toEqual([]);
    expect(globalThis.localStorage.getItem('duelbox:achievements')).toBeNull();
  });

  it('lets a foreign value cost defaults rather than a crash', () => {
    // The stores sanitise on read, so what a value contains is not checked here.
    const text = JSON.stringify({
      format: PLAYER_DATA_FORMAT,
      version: PLAYER_DATA_VERSION,
      data: {
        [SETTINGS_KEY]: { version: 1, volume: 'loud', muted: 'no' },
        [FAVOURITES_KEY]: { version: 7, slugs: ['chess'] },
      },
    });
    expect(importPlayerData(text)).toEqual({ imported: [FAVOURITES_KEY, SETTINGS_KEY] });
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
    expect(readFavourites()).toEqual([]);
  });

  it('reports storage refusing the write, which is the one failure the player can fix', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    const text = JSON.stringify({
      format: PLAYER_DATA_FORMAT,
      version: PLAYER_DATA_VERSION,
      data: { [FAVOURITES_KEY]: { version: 1, slugs: ['chess'] } },
    });
    expect(errorOf(importPlayerData(text))).toMatch(/save/i);
  });
});

describe('erasing', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('removes every key and leaves every reader at its defaults', () => {
    populate();
    resetPlayerData();
    for (const key of PLAYER_DATA_KEYS) expect(globalThis.localStorage.getItem(key)).toBeNull();
    expect(readSetup('chess')).toEqual({ mode: null, difficulty: 'normal', rounds: 3 });
    expect(readFavourites()).toEqual([]);
    expect(readRecent()).toEqual([]);
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('is safe with nothing stored and with no storage at all', () => {
    expect(() => {
      resetPlayerData();
    }).not.toThrow();
    install(undefined);
    expect(() => {
      resetPlayerData();
    }).not.toThrow();
  });
});

describe('the summary', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('counts nothing on a fresh browser', () => {
    expect(playerDataSummary()).toEqual({
      favourites: 0,
      recent: 0,
      hasSettings: false,
      games: 0,
    });
  });

  it('counts what is there, so the player knows what "erase" means', () => {
    populate();
    expect(playerDataSummary()).toEqual({
      favourites: 2,
      recent: 2,
      hasSettings: true,
      games: 2,
    });
  });

  it('counts a game whose setup was remembered before it was versioned', () => {
    install(fakeStorage({ [LAST_MODE_KEY]: '{"chess":"bot","pool":"friend"}' }));
    expect(playerDataSummary().games).toBe(2);
  });
});
