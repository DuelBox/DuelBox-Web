import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SnakesandLaddersGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SnakesandLaddersGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
