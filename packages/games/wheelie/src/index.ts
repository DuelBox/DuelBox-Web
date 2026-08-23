import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { WheelieGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new WheelieGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
