import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { createState, type State } from './rules.js';

export class BallGamesGame implements Game {
  #state: State = createState();

  init(context: GameContext): void {
    void context;
    this.#state = createState();
  }

  update(dt: number, input: InputState): void {
    // TODO: simulate. Runs on the fixed timestep; must not allocate.
    void dt;
    void input;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. Declaring only the one-argument form is
  // what made render-purity tests unable to render at two different alphas (issue #2464).
  render(renderer: Renderer, alpha: number): void;
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
