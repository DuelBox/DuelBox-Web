import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTournament,
  readTournament,
  TOURNAMENT_KEY,
  writeTournament,
} from './tournament-store';
import { currentGame, initialTournament, reduce, resume, type TournamentState } from './tournament';

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

/** A stored document, written straight to the key the way another build or a console would. */
function store(document: unknown): void {
  install(fakeStorage({ [TOURNAMENT_KEY]: JSON.stringify(document) }));
}

/** What is actually under the key, parsed. */
function stored(): unknown {
  return JSON.parse(globalThis.localStorage.getItem(TOURNAMENT_KEY) ?? 'null');
}

const LINE_UP = ['chess', 'darts', 'ludo', 'pool', 'sumo', 'memory', 'reversi'];

function started(): TournamentState {
  return reduce(initialTournament(), { kind: 'start', games: LINE_UP, opponent: 'friend' });
}

describe('the key', () => {
  it('is one of ours, and versioned inside', () => {
    expect(TOURNAMENT_KEY).toBe('duelbox:tournament');
  });
});

describe('writing and reading back', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('finds nothing on a fresh browser', () => {
    expect(readTournament()).toBeNull();
  });

  it('brings a tournament back exactly as it was left', () => {
    // The acceptance criterion of #157, at the level a unit test can reach it: every advance
    // through a tournament is a page load, so this round trip is the feature.
    const halfway = reduce(reduce(started(), { kind: 'report', outcome: 'p1' }), {
      kind: 'report',
      outcome: 'draw',
    });
    writeTournament(halfway);
    const back = readTournament();
    expect(back).not.toBeNull();
    expect(resume(back!)).toEqual(halfway);
    expect(currentGame(resume(back!))).toBe('ludo');
  });

  it('never writes the phase, because the phase is derived', () => {
    // A stored phase would be a second copy of an answer arithmetic already gives, able to
    // disagree with it. This is the guard on that decision.
    writeTournament(started());
    expect(stored()).toEqual({
      version: 1,
      games: LINE_UP,
      results: [],
      opponent: 'friend',
    });
  });

  it('keeps which kind of opponent it was', () => {
    writeTournament(
      reduce(initialTournament(), { kind: 'start', games: LINE_UP, opponent: 'bot' }),
    );
    expect(readTournament()?.opponent).toBe('bot');
  });

  it('forgets it on request, and is happy to be asked twice', () => {
    writeTournament(started());
    clearTournament();
    expect(readTournament()).toBeNull();
    expect(() => {
      clearTournament();
    }).not.toThrow();
  });
});

describe('reading something this build did not write', () => {
  it('treats a future version as no tournament at all', () => {
    // Not guessed at: a shape this build cannot interpret is not one to half-apply.
    store({ version: 2, games: LINE_UP, results: ['p1'], opponent: 'friend' });
    expect(readTournament()).toBeNull();
  });

  it('treats a document with no usable line-up as no tournament', () => {
    for (const games of [undefined, null, 'chess', [], [1, 2], ['', ''], {}]) {
      store({ version: 1, games, results: ['p1'], opponent: 'friend' });
      expect(readTournament(), JSON.stringify(games)).toBeNull();
    }
  });

  it('cleans duplicates and junk out of the line-up', () => {
    // A repeated slug would break the one promise the format makes about itself.
    store({ version: 1, games: ['chess', 'chess', 7, '', 'darts'], results: [], opponent: 'x' });
    expect(readTournament()?.games).toEqual(['chess', 'darts']);
  });

  it('reads anything that is not the bot as the other person', () => {
    // The safe way round: a bot match wrongly labelled a friend match shows an unmarked
    // seat name, while the other way round would put a bot's wins on a person's record.
    for (const opponent of [undefined, null, 'nobody', 7, 'friend']) {
      store({ version: 1, games: LINE_UP, results: [], opponent });
      expect(readTournament()?.opponent, String(opponent)).toBe('friend');
    }
  });

  it('truncates the results at the first entry that is not an outcome', () => {
    // Truncated rather than filtered, because results are positional: dropping a corrupt
    // entry would silently re-label every leg after it.
    store({ version: 1, games: LINE_UP, results: ['p1', 'draw', 'p3', 'p2'], opponent: 'friend' });
    expect(readTournament()?.results).toEqual(['p1', 'draw']);
  });

  it('reads no results at all when the results are not a list', () => {
    for (const results of [undefined, null, 'p1', { 0: 'p1' }]) {
      store({ version: 1, games: LINE_UP, results, opponent: 'friend' });
      expect(readTournament()?.results, JSON.stringify(results)).toEqual([]);
    }
  });

  it('never claims more results than there are games', () => {
    store({
      version: 1,
      games: ['chess', 'darts'],
      results: ['p1', 'p2', 'p1'],
      opponent: 'friend',
    });
    const back = readTournament();
    expect(back?.results).toEqual(['p1', 'p2']);
    // And the tournament it resumes into is a finished one rather than a state whose
    // current game is off the end of the line-up.
    expect(resume(back!).phase).toBe('complete');
    expect(currentGame(resume(back!))).toBeUndefined();
  });

  it('treats an unparseable value as no tournament', () => {
    install(fakeStorage({ [TOURNAMENT_KEY]: '{not json' }));
    expect(readTournament()).toBeNull();
    install(fakeStorage({ [TOURNAMENT_KEY]: '"a string"' }));
    expect(readTournament()).toBeNull();
  });
});

describe('a browser that will not store anything', () => {
  it('reads nothing and writes nothing, without ever throwing', () => {
    // Private browsing on some engines has no localStorage at all, and losing a tournament
    // is not worth a broken play route.
    install(undefined);
    expect(readTournament()).toBeNull();
    expect(() => {
      writeTournament(started());
      clearTournament();
    }).not.toThrow();
  });

  it('survives a storage that throws on write', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    expect(() => {
      writeTournament(started());
    }).not.toThrow();
    expect(readTournament()).toBeNull();
    vi.restoreAllMocks();
  });
});
