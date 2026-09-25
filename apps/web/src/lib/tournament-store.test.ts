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

/**
 * What the build reading these documents back can open.
 *
 * Every game in the line-up, so the tests above are about storage and nothing else; the
 * block at the foot of the file is where a build that has lost one is the subject.
 */
const PLAYS: readonly string[] = LINE_UP;

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
    expect(readTournament(PLAYS)).toBeNull();
  });

  it('brings a tournament back exactly as it was left', () => {
    // The acceptance criterion of #157, at the level a unit test can reach it: every advance
    // through a tournament is a page load, so this round trip is the feature.
    const halfway = reduce(reduce(started(), { kind: 'report', outcome: 'p1' }), {
      kind: 'report',
      outcome: 'draw',
    });
    writeTournament(halfway);
    const back = readTournament(PLAYS);
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
    expect(readTournament(PLAYS)?.opponent).toBe('bot');
  });

  it('forgets it on request, and is happy to be asked twice', () => {
    writeTournament(started());
    clearTournament();
    expect(readTournament(PLAYS)).toBeNull();
    expect(() => {
      clearTournament();
    }).not.toThrow();
  });
});

describe('the bot’s tier (#2347)', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('round-trips with the tournament it belongs to', () => {
    const state = reduce(initialTournament(), {
      kind: 'start',
      games: LINE_UP,
      opponent: 'bot',
      difficulty: 'hard',
    });
    writeTournament(state);
    expect(stored()).toMatchObject({ opponent: 'bot', difficulty: 'hard' });
    expect(readTournament(PLAYS)?.difficulty).toBe('hard');
  });

  it('writes no tier when there is none, so an older document shape is unchanged', () => {
    writeTournament(started());
    expect(stored()).not.toHaveProperty('difficulty');
  });

  it('reads a tier only against the bot, and only one this build has', () => {
    store({ version: 1, games: LINE_UP, results: [], opponent: 'bot', difficulty: 'brutal' });
    expect(readTournament(PLAYS)?.difficulty).toBeUndefined();
    store({ version: 1, games: LINE_UP, results: [], opponent: 'friend', difficulty: 'hard' });
    expect(readTournament(PLAYS)?.difficulty).toBeUndefined();
    store({ version: 1, games: LINE_UP, results: [], opponent: 'bot', difficulty: 'easy' });
    expect(readTournament(PLAYS)?.difficulty).toBe('easy');
  });

  it('reads a document written before there was a tier as a tournament with none', () => {
    // The tournament then plays at whatever this game's remembered tier is, which is what
    // it did before; the record is never invented for it.
    store({ version: 1, games: LINE_UP, results: ['p1'], opponent: 'bot' });
    const back = readTournament(PLAYS);
    expect(back?.opponent).toBe('bot');
    expect(back?.difficulty).toBeUndefined();
  });
});

describe('reading something this build did not write', () => {
  it('treats a future version as no tournament at all', () => {
    // Not guessed at: a shape this build cannot interpret is not one to half-apply.
    store({ version: 2, games: LINE_UP, results: ['p1'], opponent: 'friend' });
    expect(readTournament(PLAYS)).toBeNull();
  });

  it('treats a document with no usable line-up as no tournament', () => {
    for (const games of [undefined, null, 'chess', [], [1, 2], ['', ''], {}]) {
      store({ version: 1, games, results: ['p1'], opponent: 'friend' });
      expect(readTournament(PLAYS), JSON.stringify(games)).toBeNull();
    }
  });

  it('cleans duplicates and junk out of the line-up', () => {
    // A repeated slug would break the one promise the format makes about itself.
    store({ version: 1, games: ['chess', 'chess', 7, '', 'darts'], results: [], opponent: 'x' });
    expect(readTournament(PLAYS)?.games).toEqual(['chess', 'darts']);
  });

  it('reads anything that is not the bot as the other person', () => {
    // The safe way round: a bot match wrongly labelled a friend match shows an unmarked
    // seat name, while the other way round would put a bot's wins on a person's record.
    for (const opponent of [undefined, null, 'nobody', 7, 'friend']) {
      store({ version: 1, games: LINE_UP, results: [], opponent });
      expect(readTournament(PLAYS)?.opponent, String(opponent)).toBe('friend');
    }
  });

  it('truncates the results at the first entry that is not an outcome', () => {
    // Truncated rather than filtered, because results are positional: dropping a corrupt
    // entry would silently re-label every leg after it.
    store({ version: 1, games: LINE_UP, results: ['p1', 'draw', 'p3', 'p2'], opponent: 'friend' });
    expect(readTournament(PLAYS)?.results).toEqual(['p1', 'draw']);
  });

  it('reads no results at all when the results are not a list', () => {
    for (const results of [undefined, null, 'p1', { 0: 'p1' }]) {
      store({ version: 1, games: LINE_UP, results, opponent: 'friend' });
      expect(readTournament(PLAYS)?.results, JSON.stringify(results)).toEqual([]);
    }
  });

  it('never claims more results than there are games', () => {
    store({
      version: 1,
      games: ['chess', 'darts'],
      results: ['p1', 'p2', 'p1'],
      opponent: 'friend',
    });
    const back = readTournament(PLAYS);
    expect(back?.results).toEqual(['p1', 'p2']);
    // And the tournament it resumes into is a finished one rather than a state whose
    // current game is off the end of the line-up.
    expect(resume(back!).phase).toBe('complete');
    expect(currentGame(resume(back!))).toBeUndefined();
  });

  it('treats an unparseable value as no tournament', () => {
    install(fakeStorage({ [TOURNAMENT_KEY]: '{not json' }));
    expect(readTournament(PLAYS)).toBeNull();
    install(fakeStorage({ [TOURNAMENT_KEY]: '"a string"' }));
    expect(readTournament(PLAYS)).toBeNull();
  });
});

/**
 * A tournament drawn before a game was switched off, read back by the build that lost it.
 *
 * The line-up is drawn once from `PLAYABLE` and then persisted, so #208 can take a game out
 * of the build between the draw and the pair coming back to it. Nothing else notices: the
 * "up next" link and the result screen's next link both point at `/play/<slug>/`, which the
 * export no longer contains, and the leg can only be reported from that route — so the pair
 * meet a 404 and the tournament can never advance past it.
 */
describe('a line-up that names a game this build no longer has', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  /** The same seven games with one taken out, the way a kill switch takes one out. */
  const without = (slug: string): readonly string[] => LINE_UP.filter((game) => game !== slug);

  it('drops the leg it is waiting on, so the tournament is shorter rather than stuck', () => {
    // One game played, and the game the pair are being sent to next is the one that has
    // gone. This is the case that cannot resolve itself: `isCurrentLeg` is only true on the
    // route that no longer exists, so without this the tournament can never advance.
    store({ version: 1, games: LINE_UP, results: ['p1'], opponent: 'friend' });
    const back = readTournament(without('darts'));
    expect(back?.games, 'the switched-off leg is still in the line-up').toEqual([
      'chess',
      'ludo',
      'pool',
      'sumo',
      'memory',
      'reversi',
    ]);
    // The leg the pair are sent to next is a route this build actually exports.
    expect(currentGame(resume(back!))).toBe('ludo');
  });

  it('keeps a leg already played, because the results are positional', () => {
    // Dropping `darts` here would move `ludo`'s outcome onto it and re-label every leg
    // after. A game that has been played is history: it is not a destination any more, so
    // it cannot 404 anybody, and the honest record of the tournament includes it.
    store({ version: 1, games: LINE_UP, results: ['p1', 'p2'], opponent: 'friend' });
    const back = readTournament(without('darts'));
    expect(back?.games[1]).toBe('darts');
    expect(back?.results).toEqual(['p1', 'p2']);
    expect(currentGame(resume(back!))).toBe('ludo');
  });

  it('resumes a tournament with nothing playable left as a finished one', () => {
    store({ version: 1, games: ['chess', 'darts'], results: ['p1'], opponent: 'friend' });
    const back = readTournament(['chess']);
    expect(back?.games).toEqual(['chess']);
    // Complete rather than waiting on a game that is gone, which is the state the result
    // screen and the track both know how to draw.
    expect(resume(back!).phase).toBe('complete');
    expect(currentGame(resume(back!))).toBeUndefined();
  });

  it('is no tournament at all when nothing in it was played or can be', () => {
    store({ version: 1, games: ['chess', 'darts'], results: [], opponent: 'friend' });
    expect(readTournament(['ludo'])).toBeNull();
  });
});

describe('a browser that will not store anything', () => {
  it('reads nothing and writes nothing, without ever throwing', () => {
    // Private browsing on some engines has no localStorage at all, and losing a tournament
    // is not worth a broken play route.
    install(undefined);
    expect(readTournament(PLAYS)).toBeNull();
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
    expect(readTournament(PLAYS)).toBeNull();
    vi.restoreAllMocks();
  });
});
