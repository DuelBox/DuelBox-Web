import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { PiranhaRushGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new PiranhaRushGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
