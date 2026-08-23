import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TaxiRaceGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TaxiRaceGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
