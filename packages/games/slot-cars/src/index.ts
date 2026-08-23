import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SlotCarsGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SlotCarsGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
