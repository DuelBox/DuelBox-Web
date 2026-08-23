import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SpinWarGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SpinWarGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
