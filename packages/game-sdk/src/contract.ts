import type { Presentation, Rng, SeatId, Vec2 } from '@duelbox/engine';
import type { GameManifest } from './manifest.js';

/**
 * The contract every game implements. The shell loads, runs, pauses, scores and unloads
 * a game through this and nothing else, so adding the hundred-and-eighth game costs the
 * shell no changes at all.
 */

/** One seat's input for one simulation step. Read-only: games never write input. */
export interface SeatInput {
  /** Direction of intent, each component in [-1, 1]. Zero when idle. */
  readonly move: Readonly<Vec2>;
  /** Pointer position in logical units, or null when this seat has no pointer down. */
  readonly pointer: Readonly<Vec2> | null;
  /** True on the step the primary action began. */
  readonly actionPressed: boolean;
  /** True while the primary action is held. */
  readonly actionHeld: boolean;
  /** True on the step the primary action ended. */
  readonly actionReleased: boolean;
  /**
   * How long the action has been held, in seconds, for charge and hold-timing games.
   * Zero when not held.
   */
  readonly holdSeconds: number;
}

export interface InputState {
  seat(seat: SeatId): SeatInput;
}

/** Everything a game may draw with. Games never touch a canvas context directly. */
export interface Renderer {
  clear(colour: string): void;
  rect(x: number, y: number, width: number, height: number, colour: string): void;
  circle(x: number, y: number, radius: number, colour: string): void;
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: string): void;
  text(value: string, x: number, y: number, sizePx: number, colour: string): void;
  /** Rotates subsequent drawing 180 degrees about the logical centre, for the far seat. */
  pushSeatRotation(rotated: boolean): void;
  popSeatRotation(): void;
}

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
  /** Release every listener, timer and buffer. The shell asserts no heap growth. */
  destroy(): void;
}

/** What a game package exports. The registry loads this and nothing else. */
export interface GameModule {
  readonly manifest: GameManifest;
  create(): Game;
}
