import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BackgammonGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new BackgammonGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
