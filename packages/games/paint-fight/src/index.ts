import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { PaintFightGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new PaintFightGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
