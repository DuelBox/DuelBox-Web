import type {
  InputStateView,
  Presentation,
  Renderer,
  Rng,
  SeatId,
  SeatInputView,
  SoundBus,
  SoundEvent,
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

/**
 * Re-exported so a game imports its whole world from `@duelbox/game-sdk`, as it already
 * does for the renderer. The vocabulary and the bus itself live in the engine.
 */
export type { SoundBus, SoundEvent };

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
  /**
   * Which seat moves first this round. The SDK alternates it across the rounds of a
   * best-of so first-mover advantage washes out, so a game must read it rather than
   * assume `p1` — see issue #2466, where seat one took 55% at `hard` purely by opening.
   *
   * Real-time games have no opener and may ignore this.
   */
  readonly openingSeat: SeatId;
  /** Difficulty of the bot occupying a seat, or null when a human holds it. */
  botDifficulty(seat: SeatId): 'easy' | 'normal' | 'hard' | null;
  /**
   * Where a game says what just happened, so the engine can decide what it sounds like.
   *
   * **Optional, and it must stay optional.** Sound is presentation: every headless test,
   * every balance run and every replay drives a game with no bus at all, and a game that
   * needs one to step is a game whose simulation depends on its output device. The calling
   * convention is therefore always `context.audio?.emit('hit', force, seat)` — one optional
   * chain, no allocation, and correct whether or not anybody is listening.
   *
   * The vocabulary is a closed set of ten names on {@link SoundBus}. A game names the
   * *event*, never a waveform or a file: what a hit sounds like is one decision made once
   * for 107 games, exactly as the countdown, the HUD and the result screen are.
   */
  readonly audio?: SoundBus | undefined;
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
