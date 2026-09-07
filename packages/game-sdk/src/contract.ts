import type {
  InputStateView,
  Presentation,
  Renderer,
  Rng,
  SeatId,
  SeatInputView,
} from '@duelbox/engine';
import type { GameManifest } from './manifest.js';
import type { GameLayout, LayoutContext } from './layout.js';

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
  /**
   * Which seat moves first this round. The SDK alternates it across the rounds of a
   * best-of so first-mover advantage washes out, so a game must read it rather than
   * assume `p1` — see issue #2466, where seat one took 55% at `hard` purely by opening.
   *
   * Real-time games have no opener and may ignore this.
   */
  readonly openingSeat: SeatId;
  /**
   * Whether this player has asked their system for reduced motion (#175).
   *
   * **Passed in rather than read, and that is not a style preference.** CLAUDE.md rule 10
   * says no game branches on the device, and lint bans `matchMedia` outright inside
   * `packages/` — the host asks the browser and hands the answer over, exactly as it does
   * with the presentation and the local seat. A game that reached for the media query
   * itself would also be a game that behaves differently under a test harness with no DOM.
   *
   * **It may only change what is DRAWN.** Never the simulation: not a speed, not a
   * duration counted in steps, not a distance, not a random draw. Two devices with
   * different accessibility settings must still step the identical match, or rule 8 and
   * every replay, lockstep trace and determinism test break at once. Screen shake, flashes,
   * particle bursts and the board's half-turn are presentation and may all go; what they
   * were telling the player must not, so a game that shakes on a hit needs a non-motion
   * way to say the same thing (rule 7's argument, applied to time instead of colour).
   *
   * Optional on the interface and always present in practice, for the reason
   * `SeatInputView.pointerCount` is: this context is implemented structurally by hand in
   * game tests, and a required field is a breaking change to all of them at once. Read it
   * as `context.reducedMotion ?? false`.
   */
  readonly reducedMotion?: boolean;
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
  /**
   * Where the play area and control zones sit, for the SDK to place (#1863). Optional and
   * opt-in: a game that omits it keeps placing its own geometry exactly as before, and the
   * SDK falls back to the whole-box {@link import('./layout.js').defaultLayout}. A game that
   * implements it declares its regions once, in logical units, and lets `placeLayout` decide
   * where each lands and which way it faces per presentation — so it supports both without one
   * line branching on the device (rule 10). Called for placement only; it is not simulation
   * and must not read anything the two presentations are required to share.
   */
  describeLayout?(context: LayoutContext): GameLayout;
  /** Release every listener, timer and buffer. The shell asserts no heap growth. */
  destroy(): void;
}

/** What a game package exports. The registry loads this and nothing else. */
export interface GameModule {
  readonly manifest: GameManifest;
  create(): Game;
}
