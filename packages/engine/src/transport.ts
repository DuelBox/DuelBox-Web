import type { SeatInputState } from './input.js';
import type { SeatId } from './seat.js';

/**
 * The seam a cross-device match sends its inputs through.
 *
 * Rule 8 says a phone and a laptop must step the identical match, which settles the netcode
 * argument before it starts: **inputs travel, state does not**. Both devices hold the same
 * seeded world and advance it in whole fixed steps, so the only thing that has to cross the
 * wire is what the two people did. `record.ts` already writes exactly that down and replays
 * it into a fresh `InputManager` to reproduce a match; a lockstep transport is the same idea
 * with the far end of the wire in somebody else's hand.
 *
 * Nothing in this file knows what a network is, and nothing in it may learn. The browser
 * objects that would carry these frames — a peer connection, a data channel — are reached
 * the way `audio.ts` reaches an `AudioContext`: lazily, through an injectable seam, so the
 * whole mechanism is exercised by tests with no network, no DOM, and no signalling, and so
 * the static export can evaluate this file in Node during the build.
 *
 * ## What travels: one seat's *sampled* input, not its raw events
 *
 * A frame carries the `SeatInputState` the sending device sampled on the step it stamps —
 * the same record a game reads — rather than the pointer and key events underneath it.
 * That is deliberate and it is the decision the rest of the design hangs off.
 *
 * Raw events are the right thing to *record* (see `record.ts`: edges are derived, so keeping
 * the derivation's input keeps the derivation). They are the wrong thing to *transmit*,
 * because deriving them back into a seat state needs the sender's key bindings, its zone
 * split and which seat sits at the bottom of its screen — three facts that legitimately
 * differ between two devices held by two people. A receiver that guessed any of them wrong
 * would step a different match while both ends believed they agreed. The sampled state has
 * no such dependency: it is already in logical units, already rounded onto the shared
 * precision lattice (`PRECISION_ENVELOPE`), already free of anything device-shaped, and it
 * is the exact value the simulation consumes.
 *
 * ## Source timestamps, not arrival
 *
 * `step` is the frame's timestamp and it is counted in simulation steps from the start of
 * the match, never in wall-clock time. It says *when the input was made*, and a frame
 * applies on that step however late it turns up — so a reaction is resolved by the step the
 * player acted on, exactly as the fairness section of `CLAUDE.md` requires, and a player on
 * a worse connection loses no contest they won on their own screen.
 *
 * ## What a transport must promise
 *
 * Deliver every frame handed to `send`, eventually, and hand each one to the peer's `drain`
 * exactly once or more. Ordering is not required and duplicates are tolerated — the
 * receiving session sorts by `step` and ignores what it has already seen. **Loss is not
 * recoverable**: delay-based lockstep has no way to invent an input nobody sent, so a lost
 * frame becomes a stall and then a clean end to the match. A data channel in its default
 * reliable mode satisfies this; an unreliable one would need each frame to repeat the last
 * few, which is a change to this file and not to the session above it.
 */

/**
 * One seat's input for one simulation step, as it left the device that made it.
 *
 * Plain data with no methods, so a network transport is `JSON.stringify` on one side and
 * `JSON.parse` plus {@link frameProblem} on the other.
 */
export interface SeatInputFrame {
  /** Which seat made this. A frame naming the receiver's own seat is rejected. */
  readonly seat: SeatId;
  /** The simulation step this input was made on, counted from the start of the match. */
  readonly step: number;
  /**
   * The last step whose checksum the sender had sealed when it sent this, or -1 before it
   * has sealed any. See {@link SeatInputFrame.check}.
   */
  readonly checkStep: number;
  /**
   * The sender's rolling checksum of the match as it stood after {@link checkStep}.
   *
   * Free-riding on a frame that was being sent anyway, because the failure it catches is
   * the one lockstep cannot survive and cannot otherwise see: two devices that have quietly
   * stopped agreeing keep playing, each showing its own player a different match, and
   * neither has any reason to suspect it.
   */
  readonly check: number;
  /** The seat state the sender sampled on {@link step}. */
  readonly input: Readonly<SeatInputState>;
}

/** The writable form. Frames are pooled and rewritten in place; nothing allocates per step. */
export interface SeatInputFrameBuffer {
  seat: SeatId;
  step: number;
  checkStep: number;
  check: number;
  readonly input: SeatInputState;
}

export function createSeatInput(): SeatInputState {
  return {
    moveX: 0,
    moveY: 0,
    pointerX: 0,
    pointerY: 0,
    pointerActive: false,
    pointerCount: 0,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
    holdSecondsAtRelease: 0,
    pointerCancelled: false,
  };
}

/** Field by field rather than by spread, so it allocates nothing on the step path. */
export function copySeatInput(target: SeatInputState, source: Readonly<SeatInputState>): void {
  target.moveX = source.moveX;
  target.moveY = source.moveY;
  target.pointerX = source.pointerX;
  target.pointerY = source.pointerY;
  target.pointerActive = source.pointerActive;
  target.pointerCount = source.pointerCount;
  target.actionPressed = source.actionPressed;
  target.actionHeld = source.actionHeld;
  target.actionReleased = source.actionReleased;
  target.holdSeconds = source.holdSeconds;
  target.holdSecondsAtRelease = source.holdSecondsAtRelease;
  target.pointerCancelled = source.pointerCancelled;
}

/** The state of a seat that did nothing. What both ends agree on before a match warms up. */
export function resetSeatInput(target: SeatInputState): void {
  target.moveX = 0;
  target.moveY = 0;
  target.pointerX = 0;
  target.pointerY = 0;
  target.pointerActive = false;
  target.pointerCount = 0;
  target.actionPressed = false;
  target.actionHeld = false;
  target.actionReleased = false;
  target.holdSeconds = 0;
  target.holdSecondsAtRelease = 0;
  target.pointerCancelled = false;
}

export function createFrameBuffer(): SeatInputFrameBuffer {
  return { seat: 'p1', step: -1, checkStep: -1, check: 0, input: createSeatInput() };
}

export function copyFrameInto(
  target: SeatInputFrameBuffer,
  source: Readonly<SeatInputFrame>,
): void {
  target.seat = source.seat;
  target.step = source.step;
  target.checkStep = source.checkStep;
  target.check = source.check;
  copySeatInput(target.input, source.input);
}

/** The largest value {@link SeatInputFrame.check} may hold: it is one unsigned 32-bit word. */
const MAX_CHECK = 0xffffffff;

/**
 * A ceiling on the reported pointer count, set well above any hand.
 *
 * A bound rather than a truth: the engine tracks any number of concurrent pointers, and a
 * touchscreen reporting more than ten is a real if unusual device, so the limit is generous.
 * What it refuses is the number somebody typed — a game that scales anything by the finger
 * count must not be handed four billion of them.
 */
const MAX_POINTERS = 32;

/** A number that is not a number, is not finite, or is outside what it may be. */
function outOfRange(value: unknown, min: number, max: number): boolean {
  return typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max;
}

function notFinite(value: unknown): boolean {
  return typeof value !== 'number' || !Number.isFinite(value);
}

/**
 * What is wrong with this frame, or null if nothing is.
 *
 * Takes `unknown` and validates rather than casts, exactly as `importTrace` does and for the
 * same reason one step further on: a trace arrives from a file somebody was sent, and a frame
 * arrives from another person's browser, sixty times a second, straight into a simulation.
 * The interfaces above are a convenience for the code that *builds* a frame and are worth
 * nothing about one that was parsed out of a message — and a single `NaN` admitted here
 * spreads through a position, a velocity, and then the whole match.
 *
 * Written out field by field rather than looped over a list of them, and returning fixed
 * strings rather than built ones, so that checking every frame of every step allocates
 * nothing — not a message, not an iterator (rule 5).
 */
export function frameProblem(frame: unknown): string | null {
  if (typeof frame !== 'object' || frame === null) return 'frame is not an object';
  const value = frame as Record<string, unknown>;
  const seat = value['seat'];
  if (seat !== 'p1' && seat !== 'p2') return 'frame names no seat';
  const step = value['step'];
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 0) {
    return 'frame is stamped with no step';
  }
  const checkStep = value['checkStep'];
  if (typeof checkStep !== 'number' || !Number.isInteger(checkStep) || checkStep < -1) {
    return 'frame carries no checksum step';
  }
  const check = value['check'];
  if (typeof check !== 'number' || !Number.isInteger(check) || check < 0 || check > MAX_CHECK) {
    return 'frame carries no checksum';
  }
  const input = value['input'];
  if (typeof input !== 'object' || input === null) return 'frame carries no input';
  const state = input as Record<string, unknown>;

  // Movement is an intent in [-1, 1]; outside it is a seat asking to outrun itself.
  if (notFinite(state['moveX']) || notFinite(state['moveY'])) return 'frame moves nowhere finite';
  if (outOfRange(state['moveX'], -1, 1) || outOfRange(state['moveY'], -1, 1)) {
    return 'frame moves further than a seat can';
  }
  if (notFinite(state['pointerX']) || notFinite(state['pointerY'])) {
    return 'frame points nowhere finite';
  }
  if (
    outOfRange(state['holdSeconds'], 0, Number.MAX_VALUE) ||
    outOfRange(state['holdSecondsAtRelease'], 0, Number.MAX_VALUE)
  ) {
    return 'frame holds time it could not have held';
  }
  const pointerCount = state['pointerCount'];
  if (
    typeof pointerCount !== 'number' ||
    !Number.isInteger(pointerCount) ||
    pointerCount < 0 ||
    pointerCount > MAX_POINTERS
  ) {
    return 'frame counts no pointers';
  }
  if (
    typeof state['pointerActive'] !== 'boolean' ||
    typeof state['actionPressed'] !== 'boolean' ||
    typeof state['actionHeld'] !== 'boolean' ||
    typeof state['actionReleased'] !== 'boolean' ||
    typeof state['pointerCancelled'] !== 'boolean'
  ) {
    return 'frame carries a flag that is not a flag';
  }
  // The two invariants a game is entitled to rely on, checked here because a frame from
  // another device is the one seat state in the product that was not built by `InputManager`.
  // `SeatInputView` promises the pointer count is 0 exactly when there is no pointer, and
  // `docs/input-idiom.md` promises a cancellation and a release are opposite events and never
  // both. A peer that sent either combination would hand a game a state its own engine cannot
  // produce.
  if (state['pointerActive'] !== pointerCount > 0) {
    return 'frame counts pointers it has not got';
  }
  if (state['actionReleased'] === true && state['pointerCancelled'] === true) {
    return 'frame both releases and cancels';
  }
  return null;
}

/**
 * `'connecting'` is a transport that expects to open and has not yet; `'closed'` was ended
 * deliberately at one end or the other; `'failed'` gave up. A session treats the last two
 * alike — the match is over — and waits through the first.
 */
export type TransportStatus = 'connecting' | 'open' | 'closed' | 'failed';

export interface FrameSink {
  /**
   * Take what is needed from `frame` and return.
   *
   * The caller owns the object and rewrites it immediately afterwards, so a sink that keeps
   * the reference keeps a value that changes underneath it. Copy, do not retain.
   */
  accept(frame: Readonly<SeatInputFrame>): void;
}

export interface MatchTransport {
  readonly status: TransportStatus;
  /**
   * Send one frame to the peer. Must not retain `frame` past the call — a transport that
   * defers delivery copies what it needs first.
   */
  send(frame: Readonly<SeatInputFrame>): void;
  /**
   * Hand every frame that has arrived since the last call to `sink`, then forget them.
   *
   * Pull rather than push, so everything a match does happens on a step boundary the
   * session chose. A real transport's own callback enqueues; this empties the queue.
   */
  drain(sink: FrameSink): void;
  close(): void;
}

/** Frames a loopback endpoint will hold before it starts dropping the oldest. */
const DEFAULT_CAPACITY = 256;

export interface LoopbackOptions {
  /**
   * How many of this endpoint's `drain` calls a frame waits through before it is handed
   * over. 0 delivers on the first drain after it was sent.
   *
   * A drain count rather than milliseconds, on purpose: the session drains exactly once per
   * step attempt, so this is latency measured in the only clock a deterministic test may
   * have. Wall time would make the test's result depend on the machine it ran on.
   */
  readonly lagDrains?: number;
  /**
   * Hand a drain's frames over newest-first.
   *
   * There to prove a property rather than to model a network: if reversing the order frames
   * arrive in changes the match, then something is resolving on arrival rather than on the
   * step each frame is stamped with, and the fairness rule this seam exists to keep has
   * already been broken.
   */
  readonly reorder?: boolean;
  readonly capacity?: number;
}

/**
 * Two endpoints wired to each other in memory, with no network anywhere near them.
 *
 * This is the implementation everything else is tested against, and it is not a stub: it is
 * the same seam the browser one would sit behind, with the queue, the latency and the
 * failures modelled explicitly so that a test can ask for them. What it cannot model is a
 * real network's timing, which is exactly the part a test must not depend on.
 */
export class LoopbackTransport implements MatchTransport {
  #peer: LoopbackTransport | null = null;
  #status: TransportStatus = 'open';
  #paused = false;
  readonly #lag: number;
  readonly #reorder: boolean;
  readonly #capacity: number;
  /** Pre-allocated slots, used as a ring. Frames are copied in, never referenced. */
  readonly #slots: SeatInputFrameBuffer[];
  /** How many drains each live slot has waited through. */
  readonly #age: Int32Array;
  #head = 0;
  #count = 0;
  #sent = 0;
  #delivered = 0;
  #dropped = 0;

  constructor(options?: LoopbackOptions) {
    const lag = options?.lagDrains ?? 0;
    const capacity = options?.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(lag) || lag < 0) {
      throw new RangeError(`lagDrains must be a non-negative integer, received ${String(lag)}`);
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, received ${String(capacity)}`);
    }
    this.#lag = lag;
    this.#reorder = options?.reorder ?? false;
    this.#capacity = capacity;
    this.#slots = new Array<SeatInputFrameBuffer>(capacity);
    for (let i = 0; i < capacity; i += 1) this.#slots[i] = createFrameBuffer();
    this.#age = new Int32Array(capacity);
  }

  get status(): TransportStatus {
    return this.#status;
  }

  /** Frames handed to `send`, including any the endpoint then dropped. */
  get sent(): number {
    return this.#sent;
  }

  /** Frames handed to a sink by `drain`. */
  get delivered(): number {
    return this.#delivered;
  }

  /** Frames that went nowhere: sent while paused, closed, unconnected, or over capacity. */
  get dropped(): number {
    return this.#dropped;
  }

  /** Frames waiting in this endpoint's queue for a drain. */
  get queued(): number {
    return this.#count;
  }

  /** Wire two endpoints together. Each one's options describe what *it* receives. */
  connect(peer: LoopbackTransport): void {
    this.#peer = peer;
    peer.#peer = this;
  }

  /**
   * Stop delivering to the peer, without saying so.
   *
   * What a phone going through a tunnel looks like from the other end: no error, no close,
   * simply nothing more. The peer stalls, and its session decides how long to wait.
   */
  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
  }

  /** Give up. The peer sees a transport that stops delivering; this end reports `failed`. */
  fail(): void {
    if (this.#status === 'open' || this.#status === 'connecting') this.#status = 'failed';
  }

  send(frame: Readonly<SeatInputFrame>): void {
    this.#sent += 1;
    const peer = this.#peer;
    if (peer === null || this.#paused || this.#status !== 'open') {
      this.#dropped += 1;
      return;
    }
    peer.#enqueue(frame);
  }

  drain(sink: FrameSink): void {
    if (this.#status !== 'open') return;
    const capacity = this.#capacity;
    // Frames age in the order they arrived, so everything old enough is a prefix of the queue.
    let ready = 0;
    while (ready < this.#count) {
      const age = this.#age[(this.#head + ready) % capacity];
      if (age === undefined || age < this.#lag) break;
      ready += 1;
    }
    for (let i = 0; i < ready; i += 1) {
      const offset = this.#reorder ? ready - 1 - i : i;
      const frame = this.#slots[(this.#head + offset) % capacity];
      if (frame === undefined) continue;
      this.#delivered += 1;
      sink.accept(frame);
    }
    this.#head = (this.#head + ready) % capacity;
    this.#count -= ready;
    for (let i = 0; i < this.#count; i += 1) {
      const slot = (this.#head + i) % capacity;
      this.#age[slot] = (this.#age[slot] ?? 0) + 1;
    }
  }

  /**
   * End the link, at both ends.
   *
   * Two-sided because that is what closing a channel does: the far end is told, and finds
   * out at once rather than by waiting out a timeout. A connection that *breaks* tells
   * nobody anything, and {@link fail} and {@link pause} are the two ways to model that.
   *
   * The queue is left where it is rather than emptied. `drain` already refuses to hand
   * anything over once the status is not open, and emptying it here would corrupt the ring
   * for a `close` called from inside a sink's `accept`, which is exactly what a session does
   * the moment it finds a checksum that disagrees.
   */
  close(): void {
    if (this.#status === 'closed') return;
    this.#status = 'closed';
    this.#peer?.close();
  }

  #enqueue(frame: Readonly<SeatInputFrame>): void {
    if (this.#status !== 'open') {
      this.#dropped += 1;
      return;
    }
    if (this.#count === this.#capacity) {
      // The oldest goes rather than the newest: a queue this deep means the receiver has
      // stopped draining, and the frames it will ask for next are the recent ones.
      this.#head = (this.#head + 1) % this.#capacity;
      this.#count -= 1;
      this.#dropped += 1;
    }
    const slot = (this.#head + this.#count) % this.#capacity;
    const target = this.#slots[slot];
    if (target === undefined) return;
    copyFrameInto(target, frame);
    this.#age[slot] = 0;
    this.#count += 1;
  }
}

/**
 * A connected pair. Each side's options describe the latency and ordering *it* experiences,
 * so a match between a good connection and a bad one is two different sets of options.
 */
export function loopbackPair(
  first?: LoopbackOptions,
  second?: LoopbackOptions,
): readonly [LoopbackTransport, LoopbackTransport] {
  const a = new LoopbackTransport(first);
  const b = new LoopbackTransport(second);
  a.connect(b);
  return [a, b];
}
