import { describe, expect, it } from 'vitest';
import { resolve, resolveSimultaneous } from './win-conditions.js';

describe('resolve — first-to', () => {
  const c = { kind: 'first-to', target: 7 } as const;

  it('runs on until a seat reaches the target', () => {
    expect(resolve(c, { p1: 6, p2: 6 })).toBeNull();
  });

  it('declares the seat that reached it', () => {
    expect(resolve(c, { p1: 7, p2: 3 })).toBe('p1');
    expect(resolve(c, { p1: 3, p2: 7 })).toBe('p2');
  });

  it('calls a level simultaneous crossing a draw rather than picking a seat', () => {
    expect(resolve(c, { p1: 7, p2: 7 })).toBe('draw');
  });

  it('awards the higher score when both cross unevenly in one step', () => {
    expect(resolve(c, { p1: 8, p2: 7 })).toBe('p1');
  });

  it('settles on score if time expires first', () => {
    expect(resolve(c, { p1: 4, p2: 2 }, { timeExpired: true })).toBe('p1');
    expect(resolve(c, { p1: 2, p2: 2 }, { timeExpired: true })).toBe('draw');
  });

  it('rejects a non-positive target', () => {
    expect(() => resolve({ kind: 'first-to', target: 0 }, { p1: 1, p2: 0 })).toThrow(RangeError);
  });
});

describe('resolve — lead-by', () => {
  const c = { kind: 'lead-by', margin: 2 } as const;

  it('runs on while the lead is short of the margin', () => {
    expect(resolve(c, { p1: 5, p2: 4 })).toBeNull();
  });

  it('declares whichever seat leads by the margin', () => {
    expect(resolve(c, { p1: 6, p2: 4 })).toBe('p1');
    expect(resolve(c, { p1: 4, p2: 6 })).toBe('p2');
  });

  it('respects a minimum score before any lead counts', () => {
    const withFloor = { kind: 'lead-by', margin: 2, minimum: 5 } as const;
    expect(resolve(withFloor, { p1: 2, p2: 0 })).toBeNull();
    expect(resolve(withFloor, { p1: 5, p2: 3 })).toBe('p1');
  });

  it('rejects a non-positive margin', () => {
    expect(() => resolve({ kind: 'lead-by', margin: 0 }, { p1: 1, p2: 0 })).toThrow(RangeError);
  });
});

describe('resolve — highest-when-time-expires', () => {
  const c = { kind: 'highest-when-time-expires' } as const;

  it('is undecided until the clock runs out', () => {
    expect(resolve(c, { p1: 99, p2: 0 })).toBeNull();
  });

  it('awards the higher score, or a draw when level', () => {
    expect(resolve(c, { p1: 3, p2: 1 }, { timeExpired: true })).toBe('p1');
    expect(resolve(c, { p1: 1, p2: 3 }, { timeExpired: true })).toBe('p2');
    expect(resolve(c, { p1: 2, p2: 2 }, { timeExpired: true })).toBe('draw');
  });
});

describe('resolve — reduce-to-zero', () => {
  const c = { kind: 'reduce-to-zero' } as const;

  it('runs on while both seats hold health', () => {
    expect(resolve(c, { p1: 3, p2: 1 })).toBeNull();
  });

  it('awards the surviving seat', () => {
    expect(resolve(c, { p1: 0, p2: 2 })).toBe('p2');
    expect(resolve(c, { p1: 2, p2: 0 })).toBe('p1');
  });

  it('treats negative health as dead', () => {
    expect(resolve(c, { p1: -3, p2: 2 })).toBe('p2');
  });

  it('calls a mutual knockout a draw', () => {
    expect(resolve(c, { p1: 0, p2: 0 })).toBe('draw');
  });
});

describe('resolve — last-standing', () => {
  const c = { kind: 'last-standing' } as const;

  it('runs on while nobody is out', () => {
    expect(resolve(c, { p1: 0, p2: 0 }, { eliminated: [] })).toBeNull();
  });

  it('awards the seat still in', () => {
    expect(resolve(c, { p1: 0, p2: 0 }, { eliminated: ['p1'] })).toBe('p2');
    expect(resolve(c, { p1: 0, p2: 0 }, { eliminated: ['p2'] })).toBe('p1');
  });

  it('calls a simultaneous ring-out a draw', () => {
    expect(resolve(c, { p1: 0, p2: 0 }, { eliminated: ['p1', 'p2'] })).toBe('draw');
  });
});

describe('resolve — guards', () => {
  it('rejects a non-finite tally', () => {
    expect(() => resolve({ kind: 'first-to', target: 3 }, { p1: NaN, p2: 0 })).toThrow(RangeError);
    expect(() => resolve({ kind: 'first-to', target: 3 }, { p1: 0, p2: Infinity })).toThrow(
      RangeError,
    );
  });
});

describe('resolveSimultaneous', () => {
  it('awards the earlier input when the gap is clear', () => {
    expect(resolveSimultaneous(0.21, 0.3)).toBe('p1');
    expect(resolveSimultaneous(0.3, 0.21)).toBe('p2');
  });

  it('calls a gap inside the measurement tolerance a draw', () => {
    expect(resolveSimultaneous(0.2, 0.203)).toBe('draw');
    expect(resolveSimultaneous(0.2, 0.2)).toBe('draw');
  });

  it('treats a gap exactly on the tolerance as a draw', () => {
    expect(resolveSimultaneous(0, 0.008)).toBe('draw');
  });

  it('honours a custom tolerance', () => {
    expect(resolveSimultaneous(0.2, 0.203, 0.001)).toBe('p1');
  });

  it('rejects a negative tolerance and non-finite times', () => {
    expect(() => resolveSimultaneous(0.1, 0.2, -1)).toThrow(RangeError);
    expect(() => resolveSimultaneous(NaN, 0.2)).toThrow(RangeError);
  });
});
