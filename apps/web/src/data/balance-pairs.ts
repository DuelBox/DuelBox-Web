import type { SeatId } from '@duelbox/engine';

/**
 * What the balance sweep can see of one match - the whole of it. Two arms of one seed are
 * compared on nothing else, so everything the sweep can say about the opening seat is a
 * statement about these four numbers.
 */
export interface Arm {
  readonly winner: SeatId | 'draw' | null;
  readonly steps: number;
  readonly p1: number;
  readonly p2: number;
}

/**
 * How the two arms of one seed relate, in order of how much they have to say.
 *
 * - `identical` - the opening seat changed nothing the sweep can see.
 * - `mirrored` - the second arm is the first played from the other chair: the same length,
 *   the winner's seat swapped, the two tallies swapped. A game that is exactly symmetric
 *   under the opener produces nothing else, and it is the one shape that a winner-and-steps
 *   comparison cannot see when the match is drawn, because `draw` is its own image. That is
 *   #2549: `checkers` on `hard` draws every seed by the forty-move rule after the same 16489
 *   steps, 9-6 from one chair and 6-9 from the other, and read as hidden per-opener state.
 * - `swung` - the ending moved: a different winner or a different length, and not a mirror.
 * - `ceilinged` - the same non-ending after the same ceiling with a different scoreline, so
 *   the sameness is a fact about the ceiling and the difference is the opener's to keep.
 * - `silent` - the same winner after the same number of steps, and a scoreline that differs
 *   and is *not* the other chair's. Nothing about reading the opening seat produces this; it
 *   is the shape of scoring keyed to a role rather than to a mover, and it is what #2494's
 *   guard exists to catch.
 */
export type PairShape = 'identical' | 'mirrored' | 'swung' | 'ceilinged' | 'silent';

/** The winner the other chair would report: the seats swap, a draw and a non-ending do not. */
export function mirrorWinner(winner: Arm['winner']): Arm['winner'] {
  if (winner === 'p1') return 'p2';
  if (winner === 'p2') return 'p1';
  return winner;
}

/** Whether the ending moved - a different winner or a different length. */
export function endingMoved(first: Arm, second: Arm): boolean {
  return first.winner !== second.winner || first.steps !== second.steps;
}

/**
 * Whether `second` is `first` played from the other chair.
 *
 * All four numbers take part. A check on the tallies alone would call a role-keyed
 * scoreline - the same seat winning 9-6 from one chair and 6-9 from the other - a mirror,
 * and that is precisely the defect the mirror is being told apart from: in a real mirror the
 * winner's seat swaps with the tallies, and a draw swaps into a draw.
 */
export function isMirror(first: Arm, second: Arm): boolean {
  return (
    second.steps === first.steps &&
    second.winner === mirrorWinner(first.winner) &&
    second.p1 === first.p2 &&
    second.p2 === first.p1
  );
}

export function classifyPair(first: Arm, second: Arm): PairShape {
  const moved = endingMoved(first, second);
  if (!moved && first.p1 === second.p1 && first.p2 === second.p2) return 'identical';
  if (isMirror(first, second)) return 'mirrored';
  if (moved) return 'swung';
  return first.winner === null ? 'ceilinged' : 'silent';
}
