import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BallGamesGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new BallGamesGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
