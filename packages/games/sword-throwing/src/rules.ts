import type { SeatId } from '@duelbox/engine';

/**
 * Pure rules for Sword Throwing. No rendering, no timing, no DOM — the bot and the balance
 * harness reuse this module, so anything that touches a canvas belongs in game.ts.
 */

export interface State {
  readonly p1: number;
  readonly p2: number;
  /** Whose turn it is. A turn-based game has to answer this — see `getActiveSeat`. */
  seat: SeatId;
}

export function createState(): State {
  return { p1: 0, p2: 0, seat: 'p1' };
}

export function winnerOf(state: State): SeatId | 'draw' | null {
  // TODO: implement the win condition from SPEC.md using the SDK's resolve() helper.
  void state;
  return null;
}
