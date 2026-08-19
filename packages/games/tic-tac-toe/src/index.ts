import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TicTacToeGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TicTacToeGame(),
};

export default gameModule;

export { manifest } from './manifest.js';
export {
  BOARD_EXTENT,
  BOARD_ORIGIN,
  CELL_EXTENT,
  TicTacToeGame,
  cellCentre,
  cellIndexAt,
} from './game.js';
export {
  BLUNDER_CHANCE,
  BOARD_COLUMNS,
  CELL_COUNT,
  applyMove,
  bestMove,
  createBoard,
  legalMoves,
  winnerOf,
  winningLine,
  winningLineInto,
} from './rules.js';
export type { Board, BotDifficulty, Cell } from './rules.js';
