import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SlingPuckGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SlingPuckGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
