import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { KnifeThrowerGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new KnifeThrowerGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
