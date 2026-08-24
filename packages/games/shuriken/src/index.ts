import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ShurikenGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ShurikenGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
