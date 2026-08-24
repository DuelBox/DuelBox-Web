import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TrafficJamGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TrafficJamGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
