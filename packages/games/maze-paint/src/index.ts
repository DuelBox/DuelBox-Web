import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { MazePaintGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new MazePaintGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
