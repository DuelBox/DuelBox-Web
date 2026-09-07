import { SEATS } from './seat.js';
import type { SeatId } from './seat.js';

/**
 * Two pads on a laptop, mapped to two seats (#130).
 *
 * The browser's `navigator.getGamepads()` is the one device API this feature needs, and it
 * is kept out of the engine entirely: this module reads an injected {@link GamepadSource}, a
 * function returning plain snapshots, so the engine and its tests never touch `navigator`
 * (which lint bans across `packages/`). The browser adapter that actually calls
 * `navigator.getGamepads` lives beside `browserClock` in `loop.ts`, the one file allowed to
 * read the device. A test drives this class with hand-built snapshots and needs no DOM.
 *
 * What this owns: seat assignment by connection order with manual reassignment, a radial
 * deadzone and axis normalisation, and connect / disconnect edge detection so the shell can
 * do what the acceptance criterion asks — **pause the match with a prompt** rather than
 * silently swap a seat mid-rally.
 *
 * ## Allocation
 *
 * {@link poll} runs once per fixed step, so its steady path allocates nothing: the readings
 * are mutated in place, and the connected-set bookkeeping reuses two persistent `Set`s it
 * `clear()`s rather than rebuilds. The only allocation is one {@link GamepadEvent} per actual
 * hot-plug — a one-off, never per frame — pushed into a buffer the shell drains.
 */

/**
 * A device-independent snapshot of one pad, as the adapter presents it. Deliberately a plain
 * shape rather than the DOM `Gamepad`, so a test can build one and the engine never depends
 * on the DOM type.
 */
export interface GamepadSnapshot {
  /** The pad's stable identifier within a session — `Gamepad.index`. Two pads never share it. */
  readonly index: number;
  /** The product string, shown in a reassignment prompt. */
  readonly id: string;
  readonly connected: boolean;
  /** Analogue axes in [-1, 1]; a stick is a pair of them. */
  readonly axes: readonly number[];
  /** Button pressed-states; a game reads only the ones named in the options. */
  readonly buttons: readonly boolean[];
}

/** A function returning the current pads, `null` for empty slots — exactly `getGamepads()`. */
export type GamepadSource = () => readonly (GamepadSnapshot | null)[];

/** One seat's gamepad intent for the step about to run. */
export interface GamepadReading {
  /** Movement, each component in [-1, 1], after the deadzone and normalisation. */
  readonly moveX: number;
  readonly moveY: number;
  /** Whether any action button named in the options is pressed. */
  readonly action: boolean;
}

export type GamepadEventKind = 'connected' | 'disconnected' | 'reassigned';

/** A change worth pausing for: a pad appeared, vanished, or was moved to another seat. */
export interface GamepadEvent {
  readonly kind: GamepadEventKind;
  /** The seat affected, or `null` for a pad that connected with no free seat to take it. */
  readonly seat: SeatId | null;
  /** The pad's `index`. */
  readonly gamepadIndex: number;
  readonly id: string;
}

export interface GamepadManagerOptions {
  /**
   * Radial deadzone in [0, 1). A stick displacement shorter than this reads as zero, and the
   * rest of the range is rescaled so the first move past the deadzone is not a jump.
   *
   * 0.15 by default — enough to swallow the resting drift of a worn stick without eating the
   * slow movements a game needs.
   */
  readonly deadzone?: number;
  /** Which two axes are the movement stick's X and Y. `[0, 1]` — the left stick — by default. */
  readonly axisPair?: readonly [number, number];
  /** Which button indices count as the action. `[0]` — the south face button — by default. */
  readonly actionButtons?: readonly number[];
}

const DEFAULT_DEADZONE = 0.15;
const DEFAULT_AXIS_PAIR: readonly [number, number] = [0, 1];
const DEFAULT_ACTION_BUTTONS: readonly number[] = [0];

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

interface MutableReading {
  moveX: number;
  moveY: number;
  action: boolean;
}

export class GamepadManager {
  readonly #source: GamepadSource;
  readonly #deadzone: number;
  readonly #axisX: number;
  readonly #axisY: number;
  readonly #actionButtons: readonly number[];

  /** seat → the pad index driving it, or null when that seat has no pad. */
  readonly #seatToPad: Record<SeatId, number | null> = { p1: null, p2: null };
  /** The per-seat reading, mutated in place each poll. */
  readonly #readings: Record<SeatId, MutableReading> = {
    p1: { moveX: 0, moveY: 0, action: false },
    p2: { moveX: 0, moveY: 0, action: false },
  };
  readonly #hasReading: Record<SeatId, boolean> = { p1: false, p2: false };

  /** Connected pad indices, this poll and the previous, reused rather than rebuilt. */
  readonly #connectedNow = new Set<number>();
  readonly #connectedPrev = new Set<number>();
  #primed = false;

  /** Hot-plug events since the last {@link clearEvents}. Empty on a steady step. */
  readonly #events: GamepadEvent[] = [];

  constructor(source: GamepadSource, options?: GamepadManagerOptions) {
    this.#source = source;
    const dz = options?.deadzone ?? DEFAULT_DEADZONE;
    this.#deadzone = Number.isFinite(dz) ? Math.min(0.99, Math.max(0, dz)) : DEFAULT_DEADZONE;
    const pair = options?.axisPair ?? DEFAULT_AXIS_PAIR;
    this.#axisX = pair[0];
    this.#axisY = pair[1];
    this.#actionButtons = options?.actionButtons ?? DEFAULT_ACTION_BUTTONS;
  }

  /** The seat a pad index currently drives, or null. */
  seatOf(gamepadIndex: number): SeatId | null {
    if (this.#seatToPad.p1 === gamepadIndex) return 'p1';
    if (this.#seatToPad.p2 === gamepadIndex) return 'p2';
    return null;
  }

  /** The pad index driving a seat, or null. */
  padOf(seat: SeatId): number | null {
    return this.#seatToPad[seat];
  }

  /** This seat's reading, or null when it has no pad assigned. Valid after {@link poll}. */
  reading(seat: SeatId): Readonly<GamepadReading> | null {
    return this.#hasReading[seat] ? this.#readings[seat] : null;
  }

  /** Hot-plug events since the last {@link clearEvents}; the live buffer, do not keep it. */
  get events(): readonly GamepadEvent[] {
    return this.#events;
  }

  /** Drop the accumulated events, once the shell has acted on them. */
  clearEvents(): void {
    this.#events.length = 0;
  }

  /**
   * Move a pad to a seat by hand, displacing whatever held that seat.
   *
   * The manual half of "connection order plus manual reassignment": two players who were
   * handed the wrong pads swap without re-plugging. The displaced pad becomes unseated rather
   * than taking the reassigned seat's old pad, because a silent three-way swap is exactly the
   * confusion the prompt exists to avoid.
   */
  reassign(seat: SeatId, gamepadIndex: number): void {
    const previousSeat = this.seatOf(gamepadIndex);
    if (previousSeat !== null) this.#seatToPad[previousSeat] = null;
    this.#seatToPad[seat] = gamepadIndex;
    this.#push('reassigned', seat, gamepadIndex, '');
  }

  /**
   * Read the pads once, update the seat readings, and record any connect/disconnect edges.
   *
   * Call inside the fixed loop, before `InputManager.beginStep`, so a seat's gamepad intent
   * reaches the same step its keyboard and pointer do.
   */
  poll(): void {
    const pads = this.#source();
    this.#connectedNow.clear();

    for (const pad of pads) {
      if (pad === null || !pad.connected) continue;
      this.#connectedNow.add(pad.index);
    }

    // Disconnect edges first, so a freed seat is available to a pad connecting the same poll.
    if (this.#primed) {
      for (const index of this.#connectedPrev) {
        if (this.#connectedNow.has(index)) continue;
        const seat = this.seatOf(index);
        if (seat !== null) this.#seatToPad[seat] = null;
        this.#push('disconnected', seat, index, '');
      }
    }

    // Connect edges, assigning each new pad to the first free seat in seat order.
    for (const pad of pads) {
      if (pad === null || !pad.connected) continue;
      if (this.#primed && this.#connectedPrev.has(pad.index)) continue;
      if (!this.#primed) {
        // First poll: seat the pads that are already present, in slot order, without a prompt.
        if (this.seatOf(pad.index) === null) this.#assignFirstFree(pad.index);
        continue;
      }
      const seat = this.#assignFirstFree(pad.index);
      this.#push('connected', seat, pad.index, pad.id);
    }

    // Freshen the readings from the assigned pads.
    for (const seat of SEATS) {
      const padIndex = this.#seatToPad[seat];
      const pad = padIndex === null ? null : this.#findPad(pads, padIndex);
      if (pad === null) {
        this.#hasReading[seat] = false;
        const reading = this.#readings[seat];
        reading.moveX = 0;
        reading.moveY = 0;
        reading.action = false;
        continue;
      }
      this.#hasReading[seat] = true;
      this.#applyReading(this.#readings[seat], pad);
    }

    // Swap the buffers: this poll's connected set becomes next poll's previous, allocation-free.
    this.#connectedPrev.clear();
    for (const index of this.#connectedNow) this.#connectedPrev.add(index);
    this.#primed = true;
  }

  #assignFirstFree(gamepadIndex: number): SeatId | null {
    if (this.seatOf(gamepadIndex) !== null) return this.seatOf(gamepadIndex);
    for (const seat of SEATS) {
      if (this.#seatToPad[seat] === null) {
        this.#seatToPad[seat] = gamepadIndex;
        return seat;
      }
    }
    return null; // no free seat: the pad is connected but drives nothing
  }

  #findPad(
    pads: readonly (GamepadSnapshot | null)[],
    index: number,
  ): GamepadSnapshot | null {
    for (const pad of pads) {
      if (pad !== null && pad.connected && pad.index === index) return pad;
    }
    return null;
  }

  #applyReading(out: MutableReading, pad: GamepadSnapshot): void {
    const rawX = clampAxis(pad.axes[this.#axisX] ?? 0);
    const rawY = clampAxis(pad.axes[this.#axisY] ?? 0);
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude <= this.#deadzone || magnitude === 0) {
      out.moveX = 0;
      out.moveY = 0;
    } else {
      // Rescale [deadzone, 1] onto [0, 1], preserving direction, so the first move past the
      // deadzone is smooth and a full tilt is still full.
      const scaled = Math.min(1, (magnitude - this.#deadzone) / (1 - this.#deadzone));
      const unit = scaled / magnitude;
      out.moveX = rawX * unit;
      out.moveY = rawY * unit;
    }
    let action = false;
    for (const button of this.#actionButtons) {
      if (pad.buttons[button] === true) {
        action = true;
        break;
      }
    }
    out.action = action;
  }

  #push(kind: GamepadEventKind, seat: SeatId | null, gamepadIndex: number, id: string): void {
    this.#events.push({ kind, seat, gamepadIndex, id });
  }
}
