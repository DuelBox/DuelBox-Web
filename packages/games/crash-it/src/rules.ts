import type { SeatId } from '@duelbox/engine';

/**
 * Pure rules for Crash It. No rendering, no timing, no DOM — the bot and the balance
 * harness reuse this module, so anything that touches a canvas belongs in game.ts.
 */

export interface State {
  readonly p1: number;
  readonly p2: number;
}

export function createState(): State {
  return { p1: 0, p2: 0 };
}

export function winnerOf(state: State): SeatId | 'draw' | null {
  // TODO: implement the win condition from SPEC.md using the SDK's resolve() helper.
  void state;
  return null;
}
