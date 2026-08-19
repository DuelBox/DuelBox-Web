import { PointerOwnership, otherSeat, seatForPoint } from './seat.js';
import type { LogicalSize, SeatId, ZoneSplit } from './seat.js';
import { lengthSq, normalise, set, vec2 } from './vec2.js';
import type { Vec2 } from './vec2.js';

/**
 * Two people, one browser tab, three input families.
 *
 * The browser gives us no operating-system player separation: every key and every
 * touch arrives on the same window, so the sorting into seats happens here and
 * nowhere else. Games read one `SeatInputState` per seat and never learn whether
 * it came from half a keyboard, a mouse, or a thumb.
 *
 * Coordinates in and out are logical units in device orientation — the same frame
 * `seatForPoint` divides into zones. Turning a seat's view upright is the
 * presentation layer's job (see `toWorld`), never this module's.
 *
 * Event intake is a set of plain methods rather than DOM listeners, so the whole
 * system is testable without a document and can be driven from a replay.
 */

/** Movement axes and the action key, keyed by `KeyboardEvent.code`. */
type KeySlot = 'up' | 'down' | 'left' | 'right' | 'action';

const KEY_SLOTS: readonly KeySlot[] = ['up', 'down', 'left', 'right', 'action'];

/** What a game reads for one seat, for the step about to run. */
export interface SeatInputState {
  /** Movement intent, each component in [-1, 1]. +y is down, as in logical space. */
  moveX: number;
  moveY: number;
  /** Last known pointer position for this seat, in logical units. */
  pointerX: number;
  pointerY: number;
  /** True while at least one pointer owned by this seat is down. */
  pointerActive: boolean;
  /** True for exactly one step: the step on which the action first read as held. */
  actionPressed: boolean;
  /** True while any source — the action key or a pointer — holds the action. */
  actionHeld: boolean;
  /** True for exactly one step: the first step on which the action is no longer held. */
  actionReleased: boolean;
  /** Seconds the action had been held before this step; 0 on the press and release steps. */
  holdSeconds: number;
}

function createSeatInputState(): SeatInputState {
  return {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    pointerActive: false,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
  };
}

function resetSeatInputState(state: SeatInputState): void {
  state.moveX = 0;
  state.moveY = 0;
  state.pointerX = 0;
  state.pointerY = 0;
  state.pointerActive = false;
  state.actionPressed = false;
  state.actionHeld = false;
  state.actionReleased = false;
  state.holdSeconds = 0;
}

/**
 * Both seats' input for one step.
 *
 * The two records are allocated once and rewritten in place, so `seat()` hands back
 * the same object every step. A caller that wants a value to outlive the step must
 * copy the number out, not keep the record.
 */
export class InputState {
  readonly #p1: SeatInputState;
  readonly #p2: SeatInputState;

  /**
   * The seat records are the only allocation this class ever makes. Passing them in
   * is how the owning InputManager keeps write access without exposing a mutator to
   * the games, which only ever see `Readonly<InputState>`.
   */
  constructor(
    p1: SeatInputState = createSeatInputState(),
    p2: SeatInputState = createSeatInputState(),
  ) {
    this.#p1 = p1;
    this.#p2 = p2;
  }

  seat(seat: SeatId): Readonly<SeatInputState> {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

/** One seat's keyboard half, keyed by `KeyboardEvent.code` so layout never matters. */
export interface KeyBinding {
  up: string;
  down: string;
  left: string;
  right: string;
  action: string;
}

/**
 * The two halves of one keyboard. Deliberately disjoint and far apart: both seats
 * must be usable at the same time, on the same board, without either player's hand
 * covering the other's keys.
 */
export const DEFAULT_BINDINGS: Readonly<Record<SeatId, KeyBinding>> = Object.freeze({
  p1: Object.freeze({ up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'Space' }),
  p2: Object.freeze({
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    action: 'Enter',
  }),
});

function copyBinding(binding: Readonly<KeyBinding>): KeyBinding {
  return {
    up: binding.up,
    down: binding.down,
    left: binding.left,
    right: binding.right,
    action: binding.action,
  };
}

/**
 * A key may drive exactly one slot of one seat. Two seats sharing a code would let
 * one player move the other, and one seat using a code twice would leave the second
 * slot stuck down after a key-up. Both are rejected before anything is stored.
 */
function validateBinding(
  seat: SeatId,
  binding: Readonly<KeyBinding>,
  other: Readonly<KeyBinding>,
): void {
  for (const slot of KEY_SLOTS) {
    const code = binding[slot];
    for (const otherSlot of KEY_SLOTS) {
      if (other[otherSlot] === code) {
        throw new Error(
          `Cannot bind ${code} to ${seat}.${slot}: ${otherSeat(seat)}.${otherSlot} already uses it`,
        );
      }
    }
  }
  for (const slot of KEY_SLOTS) {
    for (const otherSlot of KEY_SLOTS) {
      if (slot !== otherSlot && binding[slot] === binding[otherSlot]) {
        throw new Error(
          `Cannot bind ${binding[slot]} to ${seat} twice: ${slot} and ${otherSlot} would share it`,
        );
      }
    }
  }
}

/** Live hardware state for one seat. Not exported: games read SeatInputState instead. */
interface SeatSources {
  readonly keys: Record<KeySlot, boolean>;
  /** Number of pointers owned by this seat that are currently down. */
  pointerCount: number;
  pointerX: number;
  pointerY: number;
  /** Action state as of the previous step, the only thing the edges are derived from. */
  wasActionHeld: boolean;
}

function createSeatSources(): SeatSources {
  return {
    keys: { up: false, down: false, left: false, right: false, action: false },
    pointerCount: 0,
    pointerX: 0,
    pointerY: 0,
    wasActionHeld: false,
  };
}

function releaseKeys(sources: SeatSources): void {
  const keys = sources.keys;
  keys.up = false;
  keys.down = false;
  keys.left = false;
  keys.right = false;
  keys.action = false;
}

function releaseSources(sources: SeatSources): void {
  releaseKeys(sources);
  sources.pointerCount = 0;
  sources.pointerX = 0;
  sources.pointerY = 0;
  sources.wasActionHeld = false;
}

/** Where a key code writes to. Built on construction and on rebind, never per step. */
interface KeyTarget {
  readonly sources: SeatSources;
  readonly slot: KeySlot;
}

export class InputManager {
  readonly #logical: LogicalSize;
  readonly #split: ZoneSplit;
  readonly #bottomSeat: SeatId;
  readonly #bindings: Record<SeatId, KeyBinding>;
  readonly #keyTargets = new Map<string, KeyTarget>();
  readonly #ownership = new PointerOwnership();
  readonly #p1Sources = createSeatSources();
  readonly #p2Sources = createSeatSources();
  readonly #p1State = createSeatInputState();
  readonly #p2State = createSeatInputState();
  readonly #state = new InputState(this.#p1State, this.#p2State);
  /** Scratch for the movement vector, so beginStep allocates nothing. */
  readonly #move: Vec2 = vec2();

  constructor(
    logical: LogicalSize,
    options?: { bindings?: Record<SeatId, KeyBinding>; split?: ZoneSplit; bottomSeat?: SeatId },
  ) {
    const source = options?.bindings ?? DEFAULT_BINDINGS;
    // Copied so a caller mutating their object later cannot desynchronise the lookup.
    const p1 = copyBinding(source.p1);
    const p2 = copyBinding(source.p2);
    validateBinding('p1', p1, p2);
    validateBinding('p2', p2, p1);
    this.#logical = logical;
    this.#split = options?.split ?? 'horizontal';
    this.#bottomSeat = options?.bottomSeat ?? 'p1';
    this.#bindings = { p1, p2 };
    this.#rebuildKeyTargets();
  }

  get state(): Readonly<InputState> {
    return this.#state;
  }

  /** A repeat keyDown for a key already down is ignored: browsers auto-repeat. */
  keyDown(code: string): void {
    const target = this.#keyTargets.get(code);
    if (target === undefined) return;
    if (target.sources.keys[target.slot]) return;
    target.sources.keys[target.slot] = true;
  }

  keyUp(code: string): void {
    const target = this.#keyTargets.get(code);
    if (target === undefined) return;
    target.sources.keys[target.slot] = false;
  }

  /** The seat is decided here, from the zone the pointer went down in, and only here. */
  pointerDown(pointerId: number, logicalX: number, logicalY: number): void {
    const live = this.#ownership.seatOf(pointerId);
    if (live !== undefined) {
      // A second down for a live id is the same finger, not another one; do not double-count it.
      const existing = this.#sourcesFor(live);
      existing.pointerX = logicalX;
      existing.pointerY = logicalY;
      return;
    }
    const seat = seatForPoint(logicalX, logicalY, this.#logical, this.#split, this.#bottomSeat);
    this.#ownership.claim(pointerId, seat);
    const sources = this.#sourcesFor(seat);
    sources.pointerCount += 1;
    sources.pointerX = logicalX;
    sources.pointerY = logicalY;
  }

  /**
   * Position only. A drag that crosses the divider keeps feeding the seat it started
   * in — without that, one player's swipe would be handed to the other mid-gesture.
   */
  pointerMove(pointerId: number, logicalX: number, logicalY: number): void {
    const seat = this.#ownership.seatOf(pointerId);
    if (seat === undefined) return;
    const sources = this.#sourcesFor(seat);
    sources.pointerX = logicalX;
    sources.pointerY = logicalY;
  }

  pointerUp(pointerId: number): void {
    const seat = this.#ownership.seatOf(pointerId);
    if (seat === undefined) return;
    this.#ownership.release(pointerId);
    const sources = this.#sourcesFor(seat);
    if (sources.pointerCount > 0) sources.pointerCount -= 1;
  }

  /**
   * Replace one seat's keys. Validated against the other seat's current binding
   * before anything is written, so a rejected binding leaves the manager untouched.
   *
   * @throws Error naming the key when it is already bound to the other seat, or
   * bound twice within this binding.
   */
  setBinding(seat: SeatId, binding: KeyBinding): void {
    const next = copyBinding(binding);
    validateBinding(seat, next, this.#bindings[otherSeat(seat)]);
    this.#bindings[seat] = next;
    // A key held under the old binding will never receive its key-up, so drop the lot.
    releaseKeys(this.#sourcesFor(seat));
    this.#rebuildKeyTargets();
  }

  /**
   * Drop every key and pointer, for a pause or a lost focus.
   *
   * The published state is zeroed too, edges included: a window that loses focus
   * mid-charge must not deliver a release the player never made, and a resume must
   * not deliver a press. The cost is that a key still physically held when focus
   * returns counts as up until it repeats or is pressed again — the right trade,
   * since the browser does not reliably deliver the key-up that happened elsewhere.
   */
  clear(): void {
    this.#ownership.releaseAll();
    releaseSources(this.#p1Sources);
    releaseSources(this.#p2Sources);
    resetSeatInputState(this.#p1State);
    resetSeatInputState(this.#p2State);
  }

  /**
   * Sample both seats for the step about to run. Allocates nothing.
   *
   * Sampling on the step boundary rather than on the event is what makes the edges
   * exact: `actionPressed` and `actionReleased` are true for exactly one step no
   * matter how many events, repeats included, arrived since the last one.
   */
  beginStep(fixedDeltaSeconds: number): Readonly<InputState> {
    let delta = fixedDeltaSeconds;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    this.#applySeat(this.#p1State, this.#p1Sources, delta);
    this.#applySeat(this.#p2State, this.#p2Sources, delta);
    return this.#state;
  }

  #applySeat(out: SeatInputState, sources: SeatSources, delta: number): void {
    const keys = sources.keys;
    const move = this.#move;
    set(move, (keys.right ? 1 : 0) - (keys.left ? 1 : 0), (keys.down ? 1 : 0) - (keys.up ? 1 : 0));
    // Two keys at once must not out-run one. Capped rather than normalised outright so
    // a future analogue source keeps its shorter vectors short.
    if (lengthSq(move) > 1) normalise(move, move);
    out.moveX = move.x;
    out.moveY = move.y;

    const pointerActive = sources.pointerCount > 0;
    out.pointerActive = pointerActive;
    // The pointer owns position outright; keys never write it.
    out.pointerX = sources.pointerX;
    out.pointerY = sources.pointerY;

    // Either source raises the action: a thumb on the screen and a key are the same intent.
    const held = keys.action || pointerActive;
    const was = sources.wasActionHeld;
    out.actionHeld = held;
    out.actionPressed = held && !was;
    out.actionReleased = !held && was;
    out.holdSeconds = held && was ? out.holdSeconds + delta : 0;
    sources.wasActionHeld = held;
  }

  #sourcesFor(seat: SeatId): SeatSources {
    return seat === 'p1' ? this.#p1Sources : this.#p2Sources;
  }

  #rebuildKeyTargets(): void {
    this.#keyTargets.clear();
    this.#addKeyTargets('p1');
    this.#addKeyTargets('p2');
  }

  #addKeyTargets(seat: SeatId): void {
    const binding = this.#bindings[seat];
    const sources = this.#sourcesFor(seat);
    for (const slot of KEY_SLOTS) {
      this.#keyTargets.set(binding[slot], { sources, slot });
    }
  }
}
