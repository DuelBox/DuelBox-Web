import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAVOURITES_KEY, readFavourites, toggleFavourite } from './favourites';
import { HEAD_TO_HEAD_KEY, readGameRecord, recordResult } from './head-to-head';
import { BEST_SCORES_KEY, recordRunScore } from './best-scores';
import { CATALOGUE_KEY, writeSortPreference } from './catalogue-filter';
import { HINTS_SEEN_KEY, markHintsSeen } from './control-hints';
import { INSTALL_KEY, rememberDismissed } from './install-prompt';
import { KEY_BINDINGS_KEY, readBindings, writeSeatBinding } from './key-bindings';
import { LAST_MODE_KEY, readSetup, writeSetup } from './last-mode';
import { PLAYER_NAMES_KEY, readPlayerNames, writePlayerName } from './player-names';
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
import { readTournament, TOURNAMENT_KEY, writeTournament } from './tournament-store';

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
  recordResult('chess', 'p1', 'friend');
  recordResult('chess', 'draw', 'friend');
  recordResult('pool', 'p2', 'friend');
  writePlayerName('p1', 'Ada');
  writeTournament({ games: ['chess', 'darts', 'ludo'], results: ['p1'], opponent: 'bot' });
  // A binding the defaults do not have, so the key is present in the export. `KeyC` collides
  // with nothing either seat holds; a colliding one would be refused and write nothing, and
  // this fixture would then be exporting six stores while claiming seven.
  writeSeatBinding('p1', { ...readBindings().p1, action: 'KeyC' });
  markHintsSeen('chess');
  writeSortPreference('name');
  rememberDismissed(1_700_000_000_000);
  recordRunScore('sudoku', 12);
}

describe('the keys', () => {
  /**
   * Every key any module under `lib/` defines is in the list, read from the source rather than
   * from memory.
   *
   * The hand-written list below could not notice a store that nobody added to it — which is
   * what happened: `CATALOGUE_KEY` (`duelbox:catalogue`, the sort the player last chose) was
   * written by `catalogue-filter.ts` for a month, exported by nobody, and not on the privacy
   * page's list of what this site keeps, while this test said "cover every store, and nothing
   * else" and passed. That is the tenth tally entry's shape, one file over from where it was
   * found. Definitions are matched on the `${KEY_PREFIX}` template every store uses, so a
   * store that spells its key any other way is a separate defect `local-store.ts` should catch.
   */
  it('cover every key a module under lib/ defines', () => {
    const lib = fileURLToPath(new URL('.', import.meta.url));
    const defined = new Set<string>();
    for (const file of readdirSync(lib)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const source = readFileSync(join(lib, file), 'utf8');
      for (const match of source.matchAll(/`\$\{KEY_PREFIX\}([a-z-]+)`/g)) {
        defined.add(`duelbox:${match[1] ?? ''}`);
      }
    }
    expect(defined.size, 'the scan found no key definitions at all').toBeGreaterThan(5);
    expect([...defined].sort()).toEqual([...PLAYER_DATA_KEYS].sort());
  });

  it('cover every store, and nothing else', () => {
    expect(PLAYER_DATA_KEYS).toEqual([
      LAST_MODE_KEY,
      FAVOURITES_KEY,
      RECENT_KEY,
      SETTINGS_KEY,
      HEAD_TO_HEAD_KEY,
      PLAYER_NAMES_KEY,
      TOURNAMENT_KEY,
      KEY_BINDINGS_KEY,
      HINTS_SEEN_KEY,
      CATALOGUE_KEY,
      INSTALL_KEY,
      BEST_SCORES_KEY,
    ]);
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
        [SETTINGS_KEY]: {
          version: 1,
          muted: true,
          volume: 0.5,
          haptics: false,
          theme: 'system',
          seatPalette: 'default',
          gameSpeed: 1,
        },
        [HEAD_TO_HEAD_KEY]: {
          version: 1,
          games: { chess: { p1: 1, p2: 0, draws: 1 }, pool: { p1: 0, p2: 1, draws: 0 } },
          bots: {},
        },
        [PLAYER_NAMES_KEY]: { version: 1, p1: 'Ada' },
        [TOURNAMENT_KEY]: {
          version: 1,
          games: ['chess', 'darts', 'ludo'],
          results: ['p1'],
          opponent: 'bot',
        },
        // Both seats, not only the one that was changed: `writeSeatBinding` stores the pair,
        // so a device that has rebound one key carries a complete keyboard to the next one
        // rather than a patch the other device has to know how to apply.
        [KEY_BINDINGS_KEY]: {
          version: 1,
          p1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'KeyC' },
          p2: {
            up: 'ArrowUp',
            down: 'ArrowDown',
            left: 'ArrowLeft',
            right: 'ArrowRight',
            action: 'Enter',
          },
        },
        [HINTS_SEEN_KEY]: { version: 1, seen: ['chess'] },
        [CATALOGUE_KEY]: { version: 1, sort: 'name' },
        [INSTALL_KEY]: { version: 1, dismissedAt: 1_700_000_000_000, installed: false },
        [BEST_SCORES_KEY]: { version: 1, games: { sudoku: 12 } },
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
    expect(readSettings()).toEqual({
      muted: true,
      volume: 0.5,
      haptics: false,
      theme: 'system',
      seatPalette: 'default',
      gameSpeed: 1,
    });
    // The record travels with everything else (#2448): a pair who move to a new phone
    // keep the score they have been keeping against each other.
    expect(readGameRecord('chess', 'friend')).toEqual({ p1: 1, p2: 0, draws: 1, played: 2 });
    expect(readPlayerNames()).toEqual({ p1: 'Ada' });
    // A tournament in progress travels too, and it is the one thing in here that cannot be
    // rebuilt by playing: the line-up was drawn at random and the games behind it are gone.
    expect(readTournament(['chess', 'darts', 'ludo'])).toEqual({
      games: ['chess', 'darts', 'ludo'],
      results: ['p1'],
      opponent: 'bot',
    });
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
    expect(readGameRecord('chess', 'friend').played).toBe(0);
    expect(readPlayerNames()).toEqual({});
    expect(readTournament(['chess', 'darts', 'ludo'])).toBeNull();
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
      matches: 0,
    });
  });

  it('counts what is there, so the player knows what "erase" means', () => {
    populate();
    expect(playerDataSummary()).toEqual({
      favourites: 2,
      recent: 2,
      hasSettings: true,
      games: 2,
      matches: 3,
    });
  });

  it('counts matches across every game, not per game', () => {
    // Three at chess and one at pool is four matches played, and that is the number a
    // pair recognises as "how much of this is ours".
    recordResult('chess', 'p1', 'friend');
    recordResult('chess', 'p2', 'friend');
    recordResult('chess', 'draw', 'friend');
    recordResult('pool', 'p1', 'friend');
    expect(playerDataSummary().matches).toBe(4);
  });

  it('counts a match against the bot, because erasing removes that one too', () => {
    // The head-to-head between the two seats leaves the bot's matches out, and this
    // number deliberately does not: it sits beside the button that erases everything
    // stored here, so it has to describe everything stored here.
    recordResult('chess', 'p1', 'friend');
    recordResult('crash-it', 'p2', 'bot');
    expect(playerDataSummary().matches).toBe(2);
  });

  it('counts a game whose setup was remembered before it was versioned', () => {
    install(fakeStorage({ [LAST_MODE_KEY]: '{"chess":"bot","pool":"friend"}' }));
    expect(playerDataSummary().games).toBe(2);
  });
});

describe('refusing a prototype-pollution payload on import (#2365)', () => {
  beforeEach(() => {
    install(fakeStorage());
  });
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['polluted'];
    vi.restoreAllMocks();
  });

  it('imports a poisoned file without polluting Object.prototype', () => {
    // A __proto__ payload at the envelope and inside `data`, plus a legitimate favourites
    // value that must still land. Written as raw JSON so `__proto__` is an own key rather
    // than the object-literal form that would set a prototype instead.
    const file =
      `{"format":${JSON.stringify(PLAYER_DATA_FORMAT)},"version":${String(PLAYER_DATA_VERSION)},` +
      `"__proto__":{"polluted":1},` +
      `"data":{"__proto__":{"polluted":1},` +
      `${JSON.stringify(FAVOURITES_KEY)}:{"version":1,"slugs":["chess"]}}}`;
    const result = importPlayerData(file);
    expect('imported' in result).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // The clean value beside the payload still imported and reads back.
    expect(readFavourites()).toEqual(['chess']);
  });
});
