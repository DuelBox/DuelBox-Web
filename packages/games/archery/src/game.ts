import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import { createState, type State } from './rules.js';

export class ArcheryGame implements Game {
  #state: State = createState();

  /**
   * Whose turn it is.
   *
   * The shell decides a game is turn-based by the *presence* of this method, and only
   * then does it hand the whole board to the active seat and map both keyboard halves
   * onto them. Leave it out of a `turn-*` game and the arrow keys drive the player who
   * is not playing, while half the device goes dead to a finger. Return the seat that may
   * act right now.
   */
  getActiveSeat(): SeatId {
    return this.#state.seat;
  }

  init(_context: GameContext): void {
    this.#state = createState();
  }

  update(_dt: number, _input: InputState): void {
    // TODO: simulate. Runs on the fixed timestep; must not allocate.
  }

  render(renderer: Renderer): void {
    renderer.clear('#f7f8fc');
    renderer.text(
      manifest.name,
      manifest.logical.width / 2,
      manifest.logical.height / 2,
      48,
      '#14161f',
      'centre',
    );
  }

  onPause(): void {}
  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: null };
  }

  destroy(): void {}
}
