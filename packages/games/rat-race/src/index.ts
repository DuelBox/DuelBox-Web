import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { RatRaceGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new RatRaceGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
