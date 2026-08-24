import type { Game, GameModule } from '@duelbox/game-sdk';
import { PinballDuelGame } from './game.js';
import { manifest } from './manifest.js';

function create(): Game {
  return new PinballDuelGame();
}

export const gameModule: GameModule = { manifest, create };

export { manifest };
export {
  PinballDuelGame,
  FLASH_STEPS,
  GOAL_TARGET,
  MATCH_SECONDS,
  SERVE_STEPS,
  IDLE_STEPS,
} from './game.js';
export * from './rules.js';

export default gameModule;
