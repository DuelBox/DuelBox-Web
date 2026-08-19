import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { WhackaMoleGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new WhackaMoleGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
