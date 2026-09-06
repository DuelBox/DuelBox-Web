import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOGUE_KEY,
  SORT_KEYS,
  countLabel,
  favouriteLabel,
  filterEntries,
  groupByCategory,
  isSortKey,
  matches,
  normalise,
  parseQuery,
  readSortPreference,
  serialiseQuery,
  sortEntries,
  suggestions,
  writeSortPreference,
  type CatalogueIndexEntry,
} from './catalogue-filter';

/**
 * Five made-up games, chosen so that every rule below has a case that exercises it: two
 * share a category, two share a round length, one has an accent, and one has a slug that
 * says something its name does not.
 */
const CAFE: CatalogueIndexEntry = {
  slug: 'cafe-rush',
  name: 'Café Rush',
  category: 'Party',
  roundSeconds: 60,
  playable: true,
};
const CHESS: CatalogueIndexEntry = {
  slug: 'chess',
  name: 'Chess',
  category: 'Board',
  roundSeconds: 600,
  playable: true,
};
const ULTIMATE: CatalogueIndexEntry = {
  slug: 'ultimate-ttt',
  name: 'Ultimate Tic Tac Toe',
  category: 'Board',
  roundSeconds: 240,
  playable: true,
};
const DARTS: CatalogueIndexEntry = {
  slug: 'darts',
  name: 'Darts',
  category: 'Shooter',
  roundSeconds: 60,
  playable: true,
};
const UNBUILT: CatalogueIndexEntry = {
  slug: 'zebra-crossing',
  name: 'Zebra Crossing',
  category: 'Party',
  roundSeconds: 90,
  playable: false,
};

const ENTRIES: readonly CatalogueIndexEntry[] = [CAFE, CHESS, ULTIMATE, DARTS, UNBUILT];
const CATEGORIES: readonly string[] = ['Arcade', 'Board', 'Party', 'Shooter'];

const slugs = (entries: readonly CatalogueIndexEntry[]) => entries.map((entry) => entry.slug);

describe('normalising a search', () => {
  it('lower-cases, strips accents and collapses whitespace', () => {
    expect(normalise('  Café   RUSH ')).toBe('cafe rush');
  });

  it('leaves plain text alone', () => {
    expect(normalise('chess')).toBe('chess');
  });
});

describe('what a search matches', () => {
  it('finds a game by name, whatever the case', () => {
    expect(matches(CHESS, 'CHESS')).toBe(true);
    expect(matches(DARTS, 'chess')).toBe(false);
  });

  it('finds a game by category', () => {
    expect(matches(CHESS, 'board')).toBe(true);
    expect(matches(DARTS, 'board')).toBe(false);
  });

  it('finds a game by a word of its slug', () => {
    // "ttt" is nowhere in the name; it is the short form a player remembers.
    expect(matches(ULTIMATE, 'ttt')).toBe(true);
  });

  it('ignores accents on either side', () => {
    expect(matches(CAFE, 'cafe')).toBe(true);
    expect(matches(CAFE, 'CAFÉ')).toBe(true);
    expect(matches(CHESS, 'chéss')).toBe(true);
  });

  it('needs every word, in any order', () => {
    expect(matches(CHESS, 'board chess')).toBe(true);
    expect(matches(CHESS, 'chess board')).toBe(true);
    expect(matches(ULTIMATE, 'board chess')).toBe(false);
  });

  it('matches everything when there are no words', () => {
    expect(matches(DARTS, '')).toBe(true);
    expect(matches(DARTS, '   ')).toBe(true);
  });
});

describe('filtering', () => {
  it('hands everything back for an empty query, in the order given', () => {
    expect(filterEntries(ENTRIES, { text: '', categories: [] })).toEqual(ENTRIES);
  });

  it('narrows by words', () => {
    expect(slugs(filterEntries(ENTRIES, { text: 'chess', categories: [] }))).toEqual(['chess']);
  });

  it('treats categories as a union', () => {
    expect(slugs(filterEntries(ENTRIES, { text: '', categories: ['Board', 'Shooter'] }))).toEqual([
      'chess',
      'ultimate-ttt',
      'darts',
    ]);
  });

  it('applies words and categories together', () => {
    expect(slugs(filterEntries(ENTRIES, { text: 'tic', categories: ['Board'] }))).toEqual([
      'ultimate-ttt',
    ]);
    expect(filterEntries(ENTRIES, { text: 'tic', categories: ['Party'] })).toEqual([]);
  });
});

describe('sorting', () => {
  it('leaves the catalogue order alone for the category sort', () => {
    expect(sortEntries(ENTRIES, 'category')).toBe(ENTRIES);
  });

  it('sorts by name without regard to case or accent', () => {
    expect(slugs(sortEntries(ENTRIES, 'name'))).toEqual([
      'cafe-rush',
      'chess',
      'darts',
      'ultimate-ttt',
      'zebra-crossing',
    ]);
  });

  it('sorts by round length, shortest first, ties broken by slug', () => {
    // Café Rush and Darts are both a minute; "cafe-rush" sorts before "darts".
    expect(slugs(sortEntries(ENTRIES, 'length'))).toEqual([
      'cafe-rush',
      'darts',
      'zebra-crossing',
      'ultimate-ttt',
      'chess',
    ]);
  });

  it('gives the same order whatever order it was handed', () => {
    // The whole point of the tie-break: equal items must not fall where the engine put
    // them, or the grid reshuffles between one render and the next.
    const reversed = [...ENTRIES].reverse();
    expect(sortEntries(reversed, 'length')).toEqual(sortEntries(ENTRIES, 'length'));
    expect(sortEntries(reversed, 'name')).toEqual(sortEntries(ENTRIES, 'name'));
  });

  it('does not mutate what it was given', () => {
    const copy = [...ENTRIES];
    sortEntries(copy, 'name');
    expect(copy).toEqual(ENTRIES);
  });

  it('knows its own keys', () => {
    for (const key of SORT_KEYS) expect(isSortKey(key)).toBe(true);
    expect(isSortKey('colour')).toBe(false);
    expect(isSortKey(1)).toBe(false);
    expect(isSortKey(undefined)).toBe(false);
  });
});

describe('grouping by category', () => {
  it('puts the biggest group first and drops empty ones', () => {
    const groups = groupByCategory(ENTRIES, CATEGORIES);
    expect(groups.map((group) => group.category)).toEqual(['Board', 'Party', 'Shooter']);
    expect(groups.map((group) => group.games.length)).toEqual([2, 2, 1]);
  });

  it('keeps equal groups in category order and games in the order given', () => {
    // Board and Party both have two; Board is listed first, so it stays first.
    const groups = groupByCategory(ENTRIES, CATEGORIES);
    expect(slugs(groups[0]?.games ?? [])).toEqual(['chess', 'ultimate-ttt']);
    expect(slugs(groups[1]?.games ?? [])).toEqual(['cafe-rush', 'zebra-crossing']);
  });

  it('groups only what it was given', () => {
    const groups = groupByCategory([DARTS], CATEGORIES);
    expect(groups).toEqual([{ category: 'Shooter', games: [DARTS] }]);
  });
});

describe('the query in the address', () => {
  it('reads words and categories', () => {
    expect(parseQuery('?q=air+hockey&category=Board,Party', CATEGORIES)).toEqual({
      text: 'air hockey',
      categories: ['Board', 'Party'],
    });
  });

  it('reads a repeated category parameter too', () => {
    expect(parseQuery('?category=Party&category=Board', CATEGORIES).categories).toEqual([
      'Board',
      'Party',
    ]);
  });

  it('drops a category it does not know and keeps the known ones in canonical order', () => {
    expect(parseQuery('?category=Shooter,Telepathy,Board', CATEGORIES).categories).toEqual([
      'Board',
      'Shooter',
    ]);
  });

  it('reads nothing from an empty address', () => {
    expect(parseQuery('', CATEGORIES)).toEqual({ text: '', categories: [] });
    expect(parseQuery('?', CATEGORIES)).toEqual({ text: '', categories: [] });
  });

  it('writes nothing for an empty query, so a cleared search leaves a clean address', () => {
    expect(serialiseQuery({ text: '', categories: [] })).toBe('');
    expect(serialiseQuery({ text: '   ', categories: [] })).toBe('');
  });

  it('writes words first, then categories, with a readable comma', () => {
    expect(serialiseQuery({ text: 'air hockey', categories: ['Board', 'Party'] })).toBe(
      '?q=air+hockey&category=Board,Party',
    );
    expect(serialiseQuery({ text: '', categories: ['Board'] })).toBe('?category=Board');
    expect(serialiseQuery({ text: 'chess', categories: [] })).toBe('?q=chess');
  });

  it('trims the words it writes, so a trailing space mid-typing does not change the address', () => {
    expect(serialiseQuery({ text: 'chess ', categories: [] })).toBe('?q=chess');
  });

  it('survives a round trip, ampersands and accents included', () => {
    const query = { text: 'café & co', categories: ['Board', 'Shooter'] };
    expect(parseQuery(serialiseQuery(query), CATEGORIES)).toEqual(query);
  });
});

describe('the words around the grid', () => {
  it('counts games in the singular and the plural', () => {
    expect(countLabel(0)).toBe('0 games');
    expect(countLabel(1)).toBe('1 game');
    expect(countLabel(108)).toBe('108 games');
  });

  it('names a star by what pressing it will do', () => {
    expect(favouriteLabel('Chess', false)).toBe('Add Chess to favourites');
    expect(favouriteLabel('Chess', true)).toBe('Remove Chess from favourites');
  });
});

describe('what an empty search offers instead', () => {
  it('offers the first three favourites when there are enough', () => {
    const offered = suggestions(ENTRIES, ['darts', 'chess', 'cafe-rush', 'ultimate-ttt'], []);
    expect(slugs(offered)).toEqual(['darts', 'chess', 'cafe-rush']);
  });

  it('fills up from recent games, then from the front of the catalogue', () => {
    expect(slugs(suggestions(ENTRIES, ['darts'], ['chess']))).toEqual([
      'darts',
      'chess',
      'cafe-rush',
    ]);
    expect(slugs(suggestions(ENTRIES, [], []))).toEqual(['cafe-rush', 'chess', 'ultimate-ttt']);
  });

  it('never offers the same game twice', () => {
    expect(slugs(suggestions(ENTRIES, ['chess'], ['chess', 'darts']))).toEqual([
      'chess',
      'darts',
      'cafe-rush',
    ]);
  });

  it('skips a slug the catalogue no longer has', () => {
    expect(slugs(suggestions(ENTRIES, ['gone-forever'], ['darts']))).toEqual([
      'darts',
      'cafe-rush',
      'chess',
    ]);
  });

  it('falls back only to games that can be started', () => {
    // Zebra Crossing is in the catalogue and not built; it is offered only if the player
    // chose it themselves.
    expect(slugs(suggestions([UNBUILT, DARTS], [], []))).toEqual(['darts']);
    expect(slugs(suggestions([UNBUILT, DARTS], ['zebra-crossing'], []))).toEqual([
      'zebra-crossing',
      'darts',
    ]);
  });

  it('honours the limit', () => {
    expect(suggestions(ENTRIES, [], [], 1)).toEqual([CAFE]);
    expect(suggestions(ENTRIES, [], [], 0)).toEqual([]);
  });
});

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

describe('remembering the sort', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the category order until the player chooses otherwise', () => {
    install(fakeStorage());
    expect(readSortPreference()).toBe('category');
  });

  it('remembers what was chosen, under a versioned key', () => {
    install(fakeStorage());
    writeSortPreference('length');
    expect(readSortPreference()).toBe('length');
    expect(JSON.parse(globalThis.localStorage.getItem(CATALOGUE_KEY) ?? '{}')).toEqual({
      version: 1,
      sort: 'length',
    });
  });

  it('ignores a sort it does not recognise', () => {
    install(fakeStorage({ [CATALOGUE_KEY]: '{"version":1,"sort":"colour"}' }));
    expect(readSortPreference()).toBe('category');
  });

  it('ignores a version it has never heard of', () => {
    install(fakeStorage({ [CATALOGUE_KEY]: '{"version":2,"sort":"name"}' }));
    expect(readSortPreference()).toBe('category');
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readSortPreference()).toBe('category');
    expect(() => {
      writeSortPreference('name');
    }).not.toThrow();
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(() => {
      writeSortPreference('name');
    }).not.toThrow();
    expect(readSortPreference()).toBe('category');
  });
});
