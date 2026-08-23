import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { CupPongGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new CupPongGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
