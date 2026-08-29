import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SolitaireGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SolitaireGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
