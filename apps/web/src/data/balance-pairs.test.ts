import { describe, expect, it } from 'vitest';
import { classifyPair, endingMoved, isMirror, mirrorWinner } from './balance-pairs';
import type { Arm } from './balance-pairs';

function arm(winner: Arm['winner'], steps: number, p1: number, p2: number): Arm {
  return { winner, steps, p1, p2 };
}

/**
 * The classifier `balance-aggregate.test.ts` sorts every seed pair with, exercised on the
 * shapes it has to tell apart - and in particular on the two that look alike from the
 * scoreline: the other chair's mirror of a match, and a role-keyed scoreline under the same
 * winner. The sweep itself takes minutes and runs the classifier only on real games, so the
 * planted cases live here, where a change to the classifier is watched on every push.
 */
describe('the shape of a seed pair', () => {
  it('reads the #2549 pair as the other chair, not as hidden state', () => {
    // Verbatim from the nightly of 2026-09-08: the same winner after the same 16489 steps,
    // 9-6 against 6-9. The winner is a draw, so it is its own image, and the tallies swap.
    const first = arm('draw', 16489, 9, 6);
    const second = arm('draw', 16489, 6, 9);
    expect(classifyPair(first, second)).toBe('mirrored');
    expect(endingMoved(first, second), 'the ending did not move - which is the whole problem').toBe(
      false,
    );
  });

  it('does not let a role-keyed scoreline pass as a mirror', () => {
    // The defect the mirror must be told apart from: the same seat wins from both chairs and
    // only the tallies swap. A game whose scoring follows the opener rather than the mover
    // produces exactly this, and a mirror check on the tallies alone would wave it through.
    const first = arm('p1', 16489, 9, 6);
    const second = arm('p1', 16489, 6, 9);
    expect(isMirror(first, second)).toBe(false);
    expect(classifyPair(first, second)).toBe('silent');
  });

  it('needs every one of the four numbers to swap or hold', () => {
    const base = arm('p1', 400, 12, 3);
    expect(classifyPair(base, arm('p2', 400, 3, 12)), 'the full mirror').toBe('mirrored');
    expect(classifyPair(base, arm('p2', 400, 12, 3)), 'winner swapped, tallies not').toBe('swung');
    expect(classifyPair(base, arm('p2', 401, 3, 12)), 'one step longer').toBe('swung');
    expect(classifyPair(base, arm('p1', 400, 3, 12)), 'tallies swapped, winner not').toBe('silent');
    expect(classifyPair(base, arm('p1', 400, 12, 4)), 'one tally moved').toBe('silent');
  });

  it('calls a symmetric scoreline identical rather than mirrored', () => {
    // 9-9 from either chair is one match, not two: the stronger statement wins.
    const first = arm('draw', 14585, 9, 9);
    expect(classifyPair(first, arm('draw', 14585, 9, 9))).toBe('identical');
    expect(classifyPair(arm('p1', 100, 0, 0), arm('p1', 100, 0, 0))).toBe('identical');
  });

  it('keeps the ceiling apart from an ending', () => {
    // The pair the `ceilinged` list was written for: neither arm ever ended.
    expect(classifyPair(arm(null, 36000, 6, 8), arm(null, 36000, 11, 9))).toBe('ceilinged');
    // A mirrored non-ending is still a mirror: the opener played the same clock out from
    // the other chair.
    expect(classifyPair(arm(null, 36000, 6, 8), arm(null, 36000, 8, 6))).toBe('mirrored');
    // And a non-ending against an ending is the ending moving.
    expect(classifyPair(arm(null, 36000, 6, 8), arm('draw', 36000, 6, 8))).toBe('swung');
  });

  it('mirrors the seats and fixes everything else', () => {
    expect(mirrorWinner('p1')).toBe('p2');
    expect(mirrorWinner('p2')).toBe('p1');
    expect(mirrorWinner('draw')).toBe('draw');
    expect(mirrorWinner(null)).toBeNull();
  });
});
