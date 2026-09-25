import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addOutcome,
  clearRecord,
  EMPTY_TALLY,
  HEAD_TO_HEAD_KEY,
  mostPlayed,
  readGameRecord,
  readRecord,
  recordResult,
} from './head-to-head';

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

/** What is actually under the key, for the tests that care about the stored shape. */
function stored(): unknown {
  const raw = globalThis.localStorage.getItem(HEAD_TO_HEAD_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe('counting a match', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('starts every game at nothing', () => {
    expect(readGameRecord('chess', 'friend')).toEqual({ ...EMPTY_TALLY, played: 0 });
    expect(readGameRecord('chess', 'bot')).toEqual({ ...EMPTY_TALLY, played: 0 });
    expect(readRecord()).toEqual({ overall: EMPTY_TALLY, games: {}, matches: 0 });
  });

  it('counts a win for each seat and a draw between them', () => {
    recordResult('chess', 'p1', 'friend');
    recordResult('chess', 'p2', 'friend');
    recordResult('chess', 'draw', 'friend');
    expect(readGameRecord('chess', 'friend')).toEqual({ p1: 1, p2: 1, draws: 1, played: 3 });
  });

  /**
   * The counting rule, which is the defect this store exists to prevent.
   *
   * The shell used to add one to a tally it held in state on every entry into
   * `match-over`, and the store now has to be the single place a match is counted: one
   * call is one match, ten calls are ten matches, and the number the caller renders is the
   * number that was written. A component that increments its own copy as well is the
   * double count, and it is visible here as a return value that disagrees with a read.
   */
  it('counts one match per call, and returns exactly what it stored', () => {
    for (let played = 1; played <= 10; played += 1) {
      const returned = recordResult('pool', 'p1', 'friend');
      expect(returned.played).toBe(played);
      expect(returned).toEqual(readGameRecord('pool', 'friend'));
    }
    expect(readGameRecord('pool', 'friend')).toEqual({ p1: 10, p2: 0, draws: 0, played: 10 });
  });

  it('keeps one game apart from another', () => {
    recordResult('chess', 'p1', 'friend');
    recordResult('pool', 'p2', 'friend');
    expect(readGameRecord('chess', 'friend')).toEqual({ p1: 1, p2: 0, draws: 0, played: 1 });
    expect(readGameRecord('pool', 'friend')).toEqual({ p1: 0, p2: 1, draws: 0, played: 1 });
  });

  it('survives the tab that made it', () => {
    recordResult('chess', 'p1', 'friend');
    // A fresh module read against the same storage is what a reload amounts to.
    expect(readGameRecord('chess', 'friend').played).toBe(1);
  });

  it('stores the three counts and nothing derived from them', () => {
    // `played` and the overall record are both sums, and a sum that is also stored is a
    // number that can disagree with the one it was summed from.
    recordResult('chess', 'p1', 'friend');
    expect(stored()).toEqual({
      version: 1,
      games: { chess: { p1: 1, p2: 0, draws: 0 } },
      bots: {},
    });
  });
});

/**
 * The rule the split exists for (#160, #12 in the review of this branch).
 *
 * Ten losses to the hard bot used to come back on the next friend match's result screen as
 * ten wins for the person sitting in the far seat, because the tally was keyed by slug
 * alone and the result screen labelled it with whatever names the *current* match had. The
 * two numbers are different facts about different opponents and the store now says so.
 */
describe('a bot in the far seat', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('is counted apart from the person who normally sits there', () => {
    for (let i = 0; i < 10; i += 1) recordResult('crash-it', 'p2', 'bot');
    recordResult('crash-it', 'p1', 'friend');
    expect(readGameRecord('crash-it', 'bot')).toEqual({ p1: 0, p2: 10, draws: 0, played: 10 });
    expect(readGameRecord('crash-it', 'friend')).toEqual({ p1: 1, p2: 0, draws: 0, played: 1 });
  });

  it('is left out of the head-to-head between the two seats', () => {
    for (let i = 0; i < 10; i += 1) recordResult('crash-it', 'p2', 'bot');
    recordResult('chess', 'p1', 'friend');
    // The far seat has won nothing here: every one of those ten was the bot's.
    expect(readRecord().overall).toEqual({ p1: 1, p2: 0, draws: 0 });
    expect(Object.keys(readRecord().games)).toEqual(['chess']);
  });

  it('is counted in how much this device has played, which is the other question', () => {
    recordResult('crash-it', 'p2', 'bot');
    recordResult('chess', 'p1', 'friend');
    expect(readRecord().matches, 'two matches were finished on this device').toBe(2);
  });

  it('writes each kind under its own map, leaving the other alone', () => {
    recordResult('chess', 'p1', 'friend');
    recordResult('chess', 'p2', 'bot');
    expect(stored()).toEqual({
      version: 1,
      games: { chess: { p1: 1, p2: 0, draws: 0 } },
      bots: { chess: { p1: 0, p2: 1, draws: 0 } },
    });
  });

  it('reads a record written before the split as the head-to-head it was called', () => {
    // Additive rather than a version bump, so a pair who played last week still have
    // their record this week. What was stored then was every match under one map.
    install(
      fakeStorage({
        [HEAD_TO_HEAD_KEY]: '{"version":1,"games":{"chess":{"p1":3,"p2":1,"draws":0}}}',
      }),
    );
    expect(readGameRecord('chess', 'friend')).toEqual({ p1: 3, p2: 1, draws: 0, played: 4 });
    expect(readGameRecord('chess', 'bot').played).toBe(0);
  });
});

describe('adding one result to a tally', () => {
  it('moves exactly one count and leaves the other two alone', () => {
    expect(addOutcome(EMPTY_TALLY, 'p1')).toEqual({ p1: 1, p2: 0, draws: 0 });
    expect(addOutcome({ p1: 2, p2: 5, draws: 1 }, 'p2')).toEqual({ p1: 2, p2: 6, draws: 1 });
    expect(addOutcome({ p1: 2, p2: 5, draws: 1 }, 'draw')).toEqual({ p1: 2, p2: 5, draws: 2 });
  });

  /**
   * The result screen shows `addOutcome(record, outcome)` in the same render as the phase
   * change and the store writes the same thing a moment later. If the two ever disagreed,
   * the panel would show one number and the settings page another.
   */
  it('agrees with what the store writes for the same result', () => {
    install(fakeStorage());
    const before = readGameRecord('darts', 'friend');
    const shown = addOutcome(before, 'draw');
    const written = recordResult('darts', 'draw', 'friend');
    expect({ p1: written.p1, p2: written.p2, draws: written.draws }).toEqual(shown);
  });
});

describe('the overall record', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('is the games added up, not a second number kept beside them', () => {
    recordResult('chess', 'p1', 'friend');
    recordResult('chess', 'draw', 'friend');
    recordResult('pool', 'p2', 'friend');
    recordResult('darts', 'p1', 'friend');
    const { overall, games } = readRecord();
    expect(overall).toEqual({ p1: 2, p2: 1, draws: 1 });
    expect(games['chess']).toEqual({ p1: 1, p2: 0, draws: 1, played: 2 });
    expect(Object.keys(games).sort()).toEqual(['chess', 'darts', 'pool']);
  });

  it('cannot disagree with the games, whatever is in storage', () => {
    // A stored overall would be believed here; a summed one has nothing to believe.
    install(
      fakeStorage({
        [HEAD_TO_HEAD_KEY]: JSON.stringify({
          version: 1,
          overall: { p1: 99, p2: 99, draws: 99 },
          games: { chess: { p1: 1, p2: 0, draws: 0 } },
        }),
      }),
    );
    expect(readRecord().overall).toEqual({ p1: 1, p2: 0, draws: 0 });
  });
});

describe('the most played games', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('puts the most played first and breaks ties on the slug, so it is stable', () => {
    recordResult('chess', 'p1', 'friend');
    recordResult('chess', 'p2', 'friend');
    recordResult('chess', 'draw', 'friend');
    recordResult('pool', 'p1', 'friend');
    recordResult('darts', 'p2', 'friend');
    expect(mostPlayed(5).map((entry) => entry.slug)).toEqual(['chess', 'darts', 'pool']);
    expect(mostPlayed(5)[0]?.record).toEqual({ p1: 1, p2: 1, draws: 1, played: 3 });
  });

  /**
   * This list answers "which games do you two reach for", so a game played only against
   * the bot belongs on it. The settings page carries the legend that says the numbers
   * count both kinds; without one, the tally is a number a reader may read either way.
   */
  it('counts matches against the bot as well, because they were still played', () => {
    recordResult('crash-it', 'p2', 'bot');
    recordResult('crash-it', 'p2', 'bot');
    recordResult('chess', 'p1', 'friend');
    expect(mostPlayed(5).map((entry) => entry.slug)).toEqual(['crash-it', 'chess']);
    expect(mostPlayed(5)[0]?.record).toEqual({ p1: 0, p2: 2, draws: 0, played: 2 });
  });

  it('adds the two kinds together for a game that has both', () => {
    recordResult('crash-it', 'p1', 'friend');
    recordResult('crash-it', 'p2', 'bot');
    expect(mostPlayed(5)[0]?.record).toEqual({ p1: 1, p2: 1, draws: 0, played: 2 });
  });

  it('hands back no more than it was asked for, and copes with nonsense limits', () => {
    recordResult('chess', 'p1', 'friend');
    recordResult('pool', 'p1', 'friend');
    expect(mostPlayed(1)).toHaveLength(1);
    expect(mostPlayed(0)).toEqual([]);
    expect(mostPlayed(-3)).toEqual([]);
  });

  it('lists nothing at all on a browser that has finished no matches', () => {
    expect(mostPlayed(5)).toEqual([]);
  });
});

describe('clearing it', () => {
  beforeEach(() => {
    install(fakeStorage());
  });

  it('removes the key rather than writing zeros', () => {
    recordResult('chess', 'p1', 'friend');
    recordResult('chess', 'p1', 'bot');
    clearRecord();
    expect(stored()).toBeNull();
    expect(readRecord()).toEqual({ overall: EMPTY_TALLY, games: {}, matches: 0 });
  });

  it('is safe with nothing stored and with no storage at all', () => {
    expect(() => {
      clearRecord();
    }).not.toThrow();
    install(undefined);
    expect(() => {
      clearRecord();
    }).not.toThrow();
  });
});

describe('surviving whatever is actually in storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores unparseable content', () => {
    install(fakeStorage({ [HEAD_TO_HEAD_KEY]: '{not json' }));
    expect(readGameRecord('chess', 'friend')).toEqual({ ...EMPTY_TALLY, played: 0 });
  });

  it('ignores a version it has never heard of', () => {
    install(
      fakeStorage({
        [HEAD_TO_HEAD_KEY]: '{"version":99,"games":{"chess":{"p1":3,"p2":1,"draws":0}}}',
      }),
    );
    expect(readGameRecord('chess', 'friend').played).toBe(0);
  });

  it('drops a count that is not one, keeping the counts that are', () => {
    install(
      fakeStorage({
        [HEAD_TO_HEAD_KEY]: JSON.stringify({
          version: 1,
          games: {
            chess: { p1: -3, p2: 2, draws: 1.5 },
            pool: { p1: 'seven', p2: 4, draws: null },
            darts: 'nonsense',
          },
          bots: { chess: { p1: 'nine', p2: 1, draws: 0 } },
        }),
      }),
    );
    expect(readGameRecord('chess', 'friend')).toEqual({ p1: 0, p2: 2, draws: 0, played: 2 });
    expect(readGameRecord('pool', 'friend')).toEqual({ p1: 0, p2: 4, draws: 0, played: 4 });
    expect(readGameRecord('chess', 'bot')).toEqual({ p1: 0, p2: 1, draws: 0, played: 1 });
    // An entry that sanitises to nothing is not a game anybody has played.
    expect(readGameRecord('darts', 'friend').played).toBe(0);
    expect(Object.keys(readRecord().games).sort()).toEqual(['chess', 'pool']);
  });

  it('drops a NaN, which JSON carries as null and arithmetic carries everywhere', () => {
    install(fakeStorage({ [HEAD_TO_HEAD_KEY]: '{"version":1,"games":{"chess":{"p1":null}}}' }));
    expect(readGameRecord('chess', 'friend').played).toBe(0);
    expect(Number.isNaN(readRecord().overall.p1)).toBe(false);
  });

  it('does not carry a junk entry forward into the next write', () => {
    install(
      fakeStorage({
        [HEAD_TO_HEAD_KEY]: '{"version":1,"games":{"darts":{"p1":-1},"chess":{"p1":2}}}',
      }),
    );
    recordResult('chess', 'p1', 'friend');
    expect(stored()).toEqual({
      version: 1,
      games: { chess: { p1: 3, p2: 0, draws: 0 } },
      bots: {},
    });
  });

  it('keeps the other map when only one of the two is written to', () => {
    install(
      fakeStorage({
        [HEAD_TO_HEAD_KEY]: '{"version":1,"games":{"chess":{"p1":2}},"bots":{"pool":{"p2":5}}}',
      }),
    );
    recordResult('chess', 'p1', 'friend');
    expect(readGameRecord('pool', 'bot').played, 'the bot map survived a friend write').toBe(5);
  });

  it('survives storage being absent entirely, as in private browsing', () => {
    install(undefined);
    expect(readGameRecord('chess', 'friend').played).toBe(0);
    expect(recordResult('chess', 'p1', 'friend')).toEqual({ p1: 1, p2: 0, draws: 0, played: 1 });
  });

  it('survives a write throwing, as when the quota is full', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    install(storage);
    // The caller still gets the number to show; storage refusing it is a matter for the
    // next read, not for the result screen in front of two people.
    expect(recordResult('chess', 'draw', 'friend').played).toBe(1);
  });

  it('survives a read throwing, as when storage is blocked by policy', () => {
    const storage = fakeStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    install(storage);
    expect(readRecord()).toEqual({ overall: EMPTY_TALLY, games: {}, matches: 0 });
  });
});
