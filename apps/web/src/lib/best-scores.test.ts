import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BEST_SCORES_KEY, readBestScore, recordRunScore } from './best-scores';

function install(storage: Storage | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

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
    map,
  } as unknown as Storage & { map: Map<string, string> };
}

describe('the best score a device keeps for a solo game', () => {
  let storage: Storage & { map: Map<string, string> };
  beforeEach(() => {
    storage = fakeStorage();
    install(storage);
  });
  afterEach(() => {
    install(undefined);
  });

  it('is nothing until a run has finished', () => {
    expect(readBestScore('sudoku')).toBeNull();
  });

  it('is set by the first run, whatever it scored, and says so', () => {
    expect(recordRunScore('sudoku', 12)).toEqual({ score: 12, best: 12, isNewBest: true });
    expect(readBestScore('sudoku')).toBe(12);
  });

  it('keeps the higher of a new run and the old best, and a tie is not a new best', () => {
    recordRunScore('sudoku', 12);
    expect(recordRunScore('sudoku', 9)).toEqual({ score: 9, best: 12, isNewBest: false });
    expect(recordRunScore('sudoku', 12)).toEqual({ score: 12, best: 12, isNewBest: false });
    expect(recordRunScore('sudoku', 20)).toEqual({ score: 20, best: 20, isNewBest: true });
    expect(readBestScore('sudoku')).toBe(20);
  });

  it('keeps games apart', () => {
    recordRunScore('sudoku', 12);
    recordRunScore('blocks', 300);
    expect(readBestScore('sudoku')).toBe(12);
    expect(readBestScore('blocks')).toBe(300);
    expect(storage.map.get(BEST_SCORES_KEY)).toContain('"version":1');
  });

  it('writes nothing for a run that did not beat the best', () => {
    recordRunScore('sudoku', 12);
    const before = storage.map.get(BEST_SCORES_KEY);
    recordRunScore('sudoku', 3);
    expect(storage.map.get(BEST_SCORES_KEY)).toBe(before);
  });

  it('clamps nonsense to nothing rather than refusing the run', () => {
    expect(recordRunScore('sudoku', -4)).toEqual({ score: 0, best: 0, isNewBest: true });
    expect(recordRunScore('sudoku', Number.NaN)).toEqual({ score: 0, best: 0, isNewBest: false });
    expect(recordRunScore('sudoku', 2.9)).toEqual({ score: 2, best: 2, isNewBest: true });
  });

  it('reads junk, the wrong version and a bad entry as no best', () => {
    storage.setItem(BEST_SCORES_KEY, 'not json');
    expect(readBestScore('sudoku')).toBeNull();
    storage.setItem(BEST_SCORES_KEY, JSON.stringify({ version: 2, games: { sudoku: 9 } }));
    expect(readBestScore('sudoku')).toBeNull();
    storage.setItem(
      BEST_SCORES_KEY,
      JSON.stringify({ version: 1, games: { sudoku: 'nine', blocks: -1, ludo: 7 } }),
    );
    expect(readBestScore('sudoku')).toBeNull();
    expect(readBestScore('blocks')).toBeNull();
    expect(readBestScore('ludo')).toBe(7);
  });

  it('reads nothing and writes nothing when storage is gone', () => {
    install(undefined);
    expect(readBestScore('sudoku')).toBeNull();
    expect(recordRunScore('sudoku', 5)).toEqual({ score: 5, best: 5, isNewBest: true });
  });
});
