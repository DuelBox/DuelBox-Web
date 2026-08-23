import type { InputManager } from './input.js';
import type { SeatId, ZoneSplit } from './seat.js';

/**
 * Recording what a player did, so a complaint about feel becomes a failing test.
 *
 * "It stuttered", "my tap did not register", "the ball went the wrong way" are all
 * unreproducible by construction: the person cannot tell you what they pressed, and the frame
 * it happened on is the only thing that matters. A trace turns that into an artefact you can
 * hand to a test.
 *
 * Recorded at the **event** level rather than the resolved-state level, and that is the whole
 * design. `SeatInputState` is what a game reads, but it is derived — `actionPressed` is an edge
 * computed against the previous frame, movement is a normalised vector, and a pointer that
 * began and ended between two steps is latched. Recording the derivation loses the thing that
 * produced it; recording the events keeps it, and replaying them through a fresh
 * `InputManager` reproduces the derivation exactly, including the edges.
 */

export type InputEvent =
  | { readonly kind: 'keyDown'; readonly code: string }
  | { readonly kind: 'keyUp'; readonly code: string }
  | { readonly kind: 'pointerDown'; readonly id: number; readonly x: number; readonly y: number }
  | { readonly kind: 'pointerMove'; readonly id: number; readonly x: number; readonly y: number }
  | { readonly kind: 'pointerUp'; readonly id: number }
  | { readonly kind: 'boardSeat'; readonly seat: SeatId }
  | { readonly kind: 'split'; readonly split: ZoneSplit }
  | { readonly kind: 'clear' };

export interface RecordedFrame {
  /**
   * Which fixed step these events landed before, counted from zero.
   *
   * A frame index rather than a wall-clock timestamp, deliberately. The loop is fixed-step, so
   * the index *is* the time as far as the simulation is concerned — and a timestamp would
   * record the recording machine's jitter and then replay it somewhere it never happened.
   */
  readonly at: number;
  readonly events: readonly InputEvent[];
}

export interface Trace {
  readonly version: 1;
  /** Which game this was recorded from, so a trace cannot be replayed into the wrong one. */
  readonly game: string;
  /** The match seed, without which the world would be dealt differently on replay. */
  readonly seed: number;
  readonly logical: { readonly width: number; readonly height: number };
  readonly fixedDeltaSeconds: number;
  readonly frames: readonly RecordedFrame[];
}

/**
 * Wraps an `InputManager` and writes down everything asked of it.
 *
 * Every mutating call is proxied rather than the class being subclassed, so a method added to
 * `InputManager` that this does not know about is a compile error at the call site rather than
 * a silently unrecorded event.
 */
export class InputRecorder {
  readonly #input: InputManager;
  readonly #frames: RecordedFrame[] = [];
  #pending: InputEvent[] = [];
  #at = 0;

  constructor(input: InputManager) {
    this.#input = input;
  }

  get input(): InputManager {
    return this.#input;
  }

  /** How many fixed steps have been recorded. */
  get frames(): number {
    return this.#at;
  }

  keyDown(code: string): void {
    this.#pending.push({ kind: 'keyDown', code });
    this.#input.keyDown(code);
  }

  keyUp(code: string): void {
    this.#pending.push({ kind: 'keyUp', code });
    this.#input.keyUp(code);
  }

  pointerDown(id: number, x: number, y: number): void {
    this.#pending.push({ kind: 'pointerDown', id, x, y });
    this.#input.pointerDown(id, x, y);
  }

  pointerMove(id: number, x: number, y: number): void {
    this.#pending.push({ kind: 'pointerMove', id, x, y });
    this.#input.pointerMove(id, x, y);
  }

  pointerUp(id: number): void {
    this.#pending.push({ kind: 'pointerUp', id });
    this.#input.pointerUp(id);
  }

  setBoardSeat(seat: SeatId): void {
    this.#pending.push({ kind: 'boardSeat', seat });
    this.#input.setBoardSeat(seat);
  }

  setSplit(split: ZoneSplit): void {
    this.#pending.push({ kind: 'split', split });
    this.#input.setSplit(split);
  }

  /** A query rather than a change, so it is delegated and not written down. */
  isBound(code: string): boolean {
    return this.#input.isBound(code);
  }

  clear(): void {
    this.#pending.push({ kind: 'clear' });
    this.#input.clear();
  }

  /**
   * Close the frame and advance.
   *
   * Call this exactly where the loop calls `beginStep`, and pass its result on. A frame with
   * nothing in it is not written down — most frames are empty, and a trace of a two-minute
   * match would otherwise be seven thousand empty objects.
   */
  beginStep(fixedDeltaSeconds: number): ReturnType<InputManager['beginStep']> {
    if (this.#pending.length > 0) {
      this.#frames.push({ at: this.#at, events: this.#pending });
      this.#pending = [];
    }
    this.#at += 1;
    return this.#input.beginStep(fixedDeltaSeconds);
  }

  /** The trace so far. Safe to call mid-match. */
  toTrace(game: string, seed: number, fixedDeltaSeconds: number): Trace {
    return {
      version: 1,
      game,
      seed,
      logical: this.#input.logical,
      fixedDeltaSeconds,
      frames: this.#frames.slice(),
    };
  }
}

/**
 * Feeds a recorded trace back into an `InputManager`, one frame at a time.
 *
 * Deliberately not a loop of its own. The point is to drive the *same* fixed loop the match
 * ran under, so the caller keeps its own `for` and calls `apply` where the player's hands used
 * to be — anything else would be replaying into a second implementation of the thing under
 * test.
 */
export class TracePlayer {
  readonly #frames: readonly RecordedFrame[];
  #next = 0;

  constructor(trace: Trace) {
    this.#frames = trace.frames;
  }

  get done(): boolean {
    return this.#next >= this.#frames.length;
  }

  /** Apply everything recorded for step `at`. Steps with nothing recorded do nothing. */
  apply(input: InputManager, at: number): void {
    while (this.#next < this.#frames.length) {
      const frame = this.#frames[this.#next];
      if (frame === undefined || frame.at > at) return;
      // A frame in the past can only mean `at` went backwards, which is a caller bug worth
      // hearing about rather than skipping quietly.
      if (frame.at < at) {
        throw new Error(`trace frame ${frame.at} was skipped; replay asked for ${at}`);
      }
      for (const event of frame.events) applyEvent(input, event);
      this.#next += 1;
      return;
    }
  }
}

function applyEvent(input: InputManager, event: InputEvent): void {
  switch (event.kind) {
    case 'keyDown':
      input.keyDown(event.code);
      return;
    case 'keyUp':
      input.keyUp(event.code);
      return;
    case 'pointerDown':
      input.pointerDown(event.id, event.x, event.y);
      return;
    case 'pointerMove':
      input.pointerMove(event.id, event.x, event.y);
      return;
    case 'pointerUp':
      input.pointerUp(event.id);
      return;
    case 'boardSeat':
      input.setBoardSeat(event.seat);
      return;
    case 'split':
      input.setSplit(event.split);
      return;
    case 'clear':
      input.clear();
      return;
  }
}

/** A trace as JSON. Pretty-printed: these get pasted into issues and read by people. */
export function exportTrace(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}

/**
 * Read a trace back, refusing anything that is not one.
 *
 * Validated rather than cast. A trace arrives from a file somebody was sent, so "it parsed as
 * JSON" is not evidence it is a trace — and a malformed one replayed as `undefined` events
 * produces a *wrong* result rather than an error, which is the worst possible outcome for a
 * tool whose entire job is to be believed.
 */
export function importTrace(text: string): Trace {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new Error('trace is not an object');
  const value = raw as Record<string, unknown>;
  if (value['version'] !== 1)
    throw new Error(`unsupported trace version ${String(value['version'])}`);
  if (typeof value['game'] !== 'string') throw new Error('trace names no game');
  if (typeof value['seed'] !== 'number' || !Number.isFinite(value['seed'])) {
    throw new Error('trace has no seed');
  }
  if (typeof value['fixedDeltaSeconds'] !== 'number' || value['fixedDeltaSeconds'] <= 0) {
    throw new Error('trace has no step length');
  }
  const logical = value['logical'];
  if (
    typeof logical !== 'object' ||
    logical === null ||
    typeof (logical as Record<string, unknown>)['width'] !== 'number' ||
    typeof (logical as Record<string, unknown>)['height'] !== 'number'
  ) {
    throw new Error('trace has no logical size');
  }
  const frames = value['frames'];
  if (!Array.isArray(frames)) throw new Error('trace has no frames');
  for (const frame of frames) {
    if (typeof frame !== 'object' || frame === null) throw new Error('a frame is not an object');
    const at = (frame as Record<string, unknown>)['at'];
    const events = (frame as Record<string, unknown>)['events'];
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) {
      throw new Error(`a frame is stamped ${String(at)}`);
    }
    if (!Array.isArray(events)) throw new Error(`frame ${at} has no events`);
    for (const event of events) checkEvent(event, at);
  }
  return raw as Trace;
}

const KINDS = new Set([
  'keyDown',
  'keyUp',
  'pointerDown',
  'pointerMove',
  'pointerUp',
  'boardSeat',
  'split',
  'clear',
]);

function checkEvent(event: unknown, at: number): void {
  if (typeof event !== 'object' || event === null) throw new Error(`frame ${at} holds a non-event`);
  const kind = (event as Record<string, unknown>)['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind)) {
    throw new Error(`frame ${at} holds an event of kind ${String(kind)}`);
  }
  const value = event as Record<string, unknown>;
  if ((kind === 'keyDown' || kind === 'keyUp') && typeof value['code'] !== 'string') {
    throw new Error(`frame ${at}: a ${kind} names no key`);
  }
  if (kind.startsWith('pointer') && typeof value['id'] !== 'number') {
    throw new Error(`frame ${at}: a ${kind} names no pointer`);
  }
  if ((kind === 'pointerDown' || kind === 'pointerMove') && typeof value['x'] !== 'number') {
    throw new Error(`frame ${at}: a ${kind} has no position`);
  }
  if (kind === 'boardSeat' && value['seat'] !== 'p1' && value['seat'] !== 'p2') {
    throw new Error(`frame ${at}: a boardSeat names ${String(value['seat'])}`);
  }
}
