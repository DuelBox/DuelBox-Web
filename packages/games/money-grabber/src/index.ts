import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { MoneyGrabberGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new MoneyGrabberGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
