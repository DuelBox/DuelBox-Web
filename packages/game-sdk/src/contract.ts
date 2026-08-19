import type {
  InputStateView,
  Presentation,
  Renderer,
  Rng,
  SeatId,
  SeatInputView,
} from '@duelbox/engine';
import type { GameManifest } from './manifest.js';

/**
 * The contract every game implements. The shell loads, runs, pauses, scores and unloads
 * a game through this and nothing else, so adding the hundred-and-eighth game costs the
 * shell no changes at all.
 */

/**
 * A game reads input through the engine's view: movement as a vector and a pointer
 * that is null when absent, so the type system carries what is and is not available.
 */
export type SeatInput = SeatInputView;
export type InputState = InputStateView;

export type { Renderer };

export interface MatchScore {
  readonly p1: number;
  readonly p2: number;
  /** Set once the match has ended; null while it is still running. */
  readonly winner: SeatId | 'draw' | null;
}

export interface GameContext {
  readonly manifest: GameManifest;
  /** Seeded per match. The only source of randomness a game may use. */
  readonly rng: Rng;
  readonly presentation: Presentation;
  /** In single-seat presentation, which seat this device is playing. */
  readonly localSeat: SeatId;
  /** Difficulty of the bot occupying a seat, or null when a human holds it. */
  botDifficulty(seat: SeatId): 'easy' | 'normal' | 'hard' | null;
}

export interface Game {
  /** Set up state for a fresh match. Called once before the first update. */
  init(context: GameContext): void;
  /** Fixed-rate simulation. Must be deterministic and allocation-free. */
  update(fixedDeltaSeconds: number, input: InputState): void;
  /** Draw the current state, interpolated by `alpha` in [0, 1). Must not mutate state. */
  render(renderer: Renderer, alpha: number): void;
  onPause(): void;
  onResume(): void;
  getScore(): MatchScore;
  /**
   * Whose turn it is, for the shell's turn indicator and seat flip. Optional because a
   * real-time game has no turns; returning null means the same thing. A game that
   * answers this never draws its own turn banner — the shell owns that, once.
   */
  getActiveSeat?(): SeatId | null;
  /** Release every listener, timer and buffer. The shell asserts no heap growth. */
  destroy(): void;
}

/** What a game package exports. The registry loads this and nothing else. */
export interface GameModule {
  readonly manifest: GameManifest;
  create(): Game;
}
