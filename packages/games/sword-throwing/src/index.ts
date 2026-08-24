import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SwordThrowingGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SwordThrowingGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
