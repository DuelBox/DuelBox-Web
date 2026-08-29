import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ExplosiveFestivalGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ExplosiveFestivalGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
