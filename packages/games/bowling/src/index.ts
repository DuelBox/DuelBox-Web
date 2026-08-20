import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BowlingGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new BowlingGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
