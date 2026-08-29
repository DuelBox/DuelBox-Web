import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { CricketGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new CricketGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
