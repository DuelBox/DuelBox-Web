import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { LightFingersGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new LightFingersGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
