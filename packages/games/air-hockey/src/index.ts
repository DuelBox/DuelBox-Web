import type { Game, GameModule } from '@duelbox/game-sdk';
import { AirHockeyGame } from './game.js';
import { manifest } from './manifest.js';

function create(): Game {
  return new AirHockeyGame();
}

export const gameModule: GameModule = { manifest, create };

export { manifest };
export { AirHockeyGame, GOAL_TARGET, SERVE_STEPS } from './game.js';
export * from './rules.js';

export default gameModule;
