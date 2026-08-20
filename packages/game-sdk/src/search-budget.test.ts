import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_NODES, SearchBudget, deepen } from './search-budget.js';

describe('a search budget', () => {
  it('spends down to nothing and then refuses', () => {
    const budget = new SearchBudget(3);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(true);
    expect(budget.spend()).toBe(true);
    expect(budget.spend(), 'the fourth node is not affordable').toBe(false);
    expect(budget.exhausted).toBe(true);
    expect(budget.spent).toBe(3);
  });

  it('starts full again on reset', () => {
    const budget = new SearchBudget(2);
    budget.spend();
    budget.spend();
    budget.reset();
    expect(budget.exhausted).toBe(false);
    expect(budget.spent).toBe(0);
  });

  it('refuses a budget that is not a positive whole number', () => {
    expect(() => new SearchBudget(0)).toThrow(RangeError);
    expect(() => new SearchBudget(-1)).toThrow(RangeError);
    expect(() => new SearchBudget(1.5)).toThrow(RangeError);
  });

  it('has a default chosen by measurement', () => {
    expect(DEFAULT_SEARCH_NODES).toBeGreaterThan(1000);
  });
});

describe('deepening', () => {
  it('returns the deepest move it finished', () => {
    const budget = new SearchBudget(1000);
    const reached: number[] = [];
    const move = deepen(budget, 5, (depth) => {
      reached.push(depth);
      return depth * 10;
    });
    expect(reached).toEqual([1, 2, 3, 4, 5]);
    expect(move).toBe(50);
  });

  it('throws away a depth that did not finish', () => {
    // Half a ply is not an opinion, it is whichever moves happened to come first.
    const budget = new SearchBudget(1000);
    const move = deepen(budget, 5, (depth) => (depth >= 3 ? null : depth * 10));
    expect(move, 'the last full depth').toBe(20);
  });

  it('stops once the budget is gone', () => {
    const budget = new SearchBudget(2);
    const reached: number[] = [];
    deepen(budget, 9, (depth) => {
      reached.push(depth);
      budget.spend();
      budget.spend();
      return depth;
    });
    expect(reached, 'one depth, and then nothing left to spend').toEqual([1]);
  });

  it('returns nothing when even the first depth fails', () => {
    expect(deepen(new SearchBudget(4), 3, () => null)).toBe(-1);
  });

  it('is deterministic — the same budget spends the same way on any device', () => {
    // A stopwatch would make the depth reached depend on how fast the machine is, and
    // rule 8 says a phone and a laptop must step the identical match.
    const run = (): string => {
      const budget = new SearchBudget(50);
      const depths: number[] = [];
      deepen(budget, 20, (depth) => {
        depths.push(depth);
        for (let i = 0; i < depth * depth; i += 1) {
          if (!budget.spend()) return null;
        }
        return depth;
      });
      return depths.join(',');
    };
    expect(run()).toBe(run());
  });
});
