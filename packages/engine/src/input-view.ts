import type { SeatId } from './seat.js';
import type { InputState, SeatInputState } from './input.js';
import { vec2, type Vec2 } from './vec2.js';

/**
 * Presents the engine's input state in the shape games read.
 *
 * The two shapes exist for different reasons and both are right. The engine holds flat
 * scalars — `moveX`, `pointerActive` — because that is what a per-step update can touch
 * without allocating. Games read `move.x` and a nullable `pointer`, because a game author
 * should not have to remember that a pointer position is only meaningful when a separate
 * boolean is set: making it null when absent puts that in the type system.
 *
 * This adapter bridges them with pre-allocated vectors, so reading input still allocates
 * nothing per step.
 */

export interface SeatInputView {
  /** Direction of intent, each component in [-1, 1]. Zero when idle. */
  readonly move: Readonly<Vec2>;
  /** Pointer position in logical units, or null when this seat has no pointer down. */
  readonly pointer: Readonly<Vec2> | null;
  readonly actionPressed: boolean;
  readonly actionHeld: boolean;
  readonly actionReleased: boolean;
  readonly holdSeconds: number;
}

export interface InputStateView {
  seat(seat: SeatId): SeatInputView;
}

class SeatView implements SeatInputView {
  readonly move: Vec2 = vec2();
  readonly #pointer: Vec2 = vec2();
  #pointerActive = false;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;

  get pointer(): Readonly<Vec2> | null {
    return this.#pointerActive ? this.#pointer : null;
  }

  sync(source: Readonly<SeatInputState>): void {
    this.move.x = source.moveX;
    this.move.y = source.moveY;
    this.#pointer.x = source.pointerX;
    this.#pointer.y = source.pointerY;
    this.#pointerActive = source.pointerActive;
    this.actionPressed = source.actionPressed;
    this.actionHeld = source.actionHeld;
    this.actionReleased = source.actionReleased;
    this.holdSeconds = source.holdSeconds;
  }
}

export class InputView implements InputStateView {
  readonly #p1 = new SeatView();
  readonly #p2 = new SeatView();

  /** Copies the current engine state into the view. Allocates nothing. */
  sync(state: Readonly<InputState>): this {
    this.#p1.sync(state.seat('p1'));
    this.#p2.sync(state.seat('p2'));
    return this;
  }

  seat(seat: SeatId): SeatInputView {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}
