import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { createState, type State } from './rules.js';

export class SpinWarGame implements Game {
  #state: State = createState();

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
