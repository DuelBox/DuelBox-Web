import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SpikeAttacksGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SpikeAttacksGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
