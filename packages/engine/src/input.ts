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
  /**
   * How long the action had been held when it was let go, valid on the release step only
   * and 0 on every other.
   *
   * {@link holdSeconds} is deliberately 0 on the release step — the hold is over — which
   * means `actionReleased && holdSeconds > x` is a contradiction that can never be true.
   * Sea Battle shipped that exact line, so its keyboard long-press to rotate a ship had
   * never once fired (#2475), and ten other games carry a private field reconstructing
   * this by hand. A tap that began and ended inside one step reports 0, because it was a
   * tap and not a hold.
   */
  holdSecondsAtRelease: number;
  /**
   * True for exactly one step: the step on which a pointer gesture was taken away rather
   * than let go.
   *
   * A `pointercancel` is the browser saying *this gesture did not happen* — a system
   * edge-swipe, palm rejection, an incoming call — and {@link InputManager.clear} says the
   * same thing for a pause or a lost focus. Wired to `pointerUp`, as it was until #2480,
   * every one of those produced an ordinary {@link actionReleased} and so **fired the
   * shot** in every drag-and-release aim game: a player who started to aim and got a
   * system gesture did not get their aim cancelled, they got a shot they never took, at
   * whatever the aim happened to be. On a phone, where an edge swipe is how you leave an
   * app, that is not an edge case.
   *
   * The two are mutually exclusive by construction: a cancel suppresses the release, so
   * `actionReleased` means "the player let go" and nothing else. Per
   * `docs/input-idiom.md` a cancel **abandons** the gesture and commits nothing, so a game
   * reads this to drop the aim it was carrying — it must never treat it as a release.
   */
  pointerCancelled: boolean;
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
    holdSecondsAtRelease: 0,
    pointerCancelled: false,
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
  state.holdSecondsAtRelease = 0;
  state.pointerCancelled = false;
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
  /**
   * Whether each direction went down since the last step, even if it was released again
   * before the step ran.
   *
   * The same reasoning as `actionLatched`, which has carried this comment since the
   * beginning: sampling "is it down now" loses a tap whose press and release both land
   * inside one frame. That was applied to the action key and not to movement, so a quick
   * tap of a direction key was dropped outright and the cursor did not move — in every
   * keyboard-driven grid game in the collection. A human tap usually spans several frames
   * and got away with it; a slow frame, or any automated harness, did not.
   */
  readonly latchedKeys: Record<KeySlot, boolean>;
  /** Number of pointers owned by this seat that are currently down. */
  pointerCount: number;
  pointerX: number;
  pointerY: number;
  /** Action state as of the previous step, the only thing the edges are derived from. */
  wasActionHeld: boolean;
  /**
   * Whether the action went down at any point since the last step, even if it was
   * released again before the step ran.
   *
   * Sampling "is it down now" loses a tap whose press and release both land inside one
   * frame — which on a touchscreen is most of them. A tap is the primary gesture in this
   * product, so it is latched here and consumed by the next step rather than missed.
   */
  actionLatched: boolean;
  /**
   * Whether a *pointer* went down since the last step.
   *
   * Separate from `actionLatched`, which a key can also raise: a keyboard press must not
   * conjure a pointer position out of nowhere. This one keeps the tap's coordinates
   * readable for the step that reports the press, or a game is told a tap happened and
   * given nowhere to put it.
   */
  pointerLatched: boolean;
  /**
   * Whether a pointer owned by this seat was cancelled since the last step.
   *
   * Latched like the others so a cancel that lands between two steps is still reported —
   * losing it would put the gesture back exactly where it was before #2480, with the game
   * still holding an aim nothing will ever tell it to drop.
   */
  cancelLatched: boolean;
}

function createSeatSources(): SeatSources {
  return {
    keys: { up: false, down: false, left: false, right: false, action: false },
    latchedKeys: { up: false, down: false, left: false, right: false, action: false },
    pointerCount: 0,
    pointerX: 0,
    pointerY: 0,
    wasActionHeld: false,
    actionLatched: false,
    pointerLatched: false,
    cancelLatched: false,
  };
}

function releaseKeys(sources: SeatSources): void {
  const keys = sources.keys;
  keys.up = false;
  keys.down = false;
  keys.left = false;
  keys.right = false;
  keys.action = false;
  // The direction latch goes too. This runs when focus is lost, and a tap that has not
  // been consumed by a step yet must not fire when the player comes back to the tab.
  const latched = sources.latchedKeys;
  latched.up = false;
  latched.down = false;
  latched.left = false;
  latched.right = false;
  latched.action = false;
}

function releaseSources(sources: SeatSources): void {
  releaseKeys(sources);
  sources.pointerCount = 0;
  sources.pointerX = 0;
  sources.pointerY = 0;
  sources.wasActionHeld = false;
  sources.actionLatched = false;
  sources.pointerLatched = false;
  sources.cancelLatched = false;
}

/** Where a key code writes to. Built on construction and on rebind, never per step. */
interface KeyTarget {
  readonly sources: SeatSources;
  readonly slot: KeySlot;
}

/**
 * The precision envelope: the finest distinction any pointing device may express.
 *
 * A mouse resolves a single device pixel; a thumb covers dozens of them and hides what it
 * is touching. Left alone, a cross-device match is decided by which instrument the players
 * happened to be holding, which is exactly what `docs/input-parity.md` exists to prevent.
 *
 * The fix is to *remove excess precision* rather than to invent any: every pointer position
 * is rounded onto a lattice fine enough that nobody can feel it and coarse enough that no
 * device can aim between its points. Quantising cannot make a thumb steadier — that is a
 * property of hands, not software — but it does stop a mouse from aiming finer than the
 * game asks anyone to.
 *
 * Expressed as a fraction of the play area rather than in pixels, because the whole point
 * is that it must mean the same thing on a phone and on a desktop (rule 8). One
 * two-hundredth of the shorter side puts it at 4.5 units in a 900-unit box: about 1.6
 * device pixels on a 320px phone and about 5.8 on a 1440px desktop, so the desktop loses
 * precision it had and the phone loses none it ever had.
 */
export const PRECISION_ENVELOPE = 1 / 200;

/** The lattice spacing for a logical box, in logical units. */
export function envelopeFor(logical: LogicalSize): number {
  return Math.min(logical.width, logical.height) * PRECISION_ENVELOPE;
}

export class InputManager {
  readonly #logical: LogicalSize;
  #split: ZoneSplit;
  readonly #envelope: number;
  #bottomSeat: SeatId;
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
    this.#envelope = envelopeFor(logical);
    this.#bindings = { p1, p2 };
    this.#rebuildKeyTargets();
  }

  /**
   * Hand the whole pointer surface to a seat. Only meaningful under a shared split.
   *
   * A turn-based game's board belongs to whoever is to move, and that changes every turn,
   * so it cannot be fixed at construction the way a real-time game's zones can.
   */
  setBoardSeat(seat: SeatId): void {
    this.#bottomSeat = seat;
  }

  /**
   * Change how the pointer surface is divided, mid-match.
   *
   * Most games never call this: a real-time game splits the device between two seats for
   * its whole life, and a turn-based one hands the whole board to whoever is to move. But
   * the two are phases of one game rather than two kinds of game — Sea Battle has both
   * players lay out their fleets at the same time on their own half, and only then starts
   * taking turns at a shared grid. Fixing the split at construction made that unplayable
   * in one direction or the other.
   */
  setSplit(split: ZoneSplit): void {
    this.#split = split;
  }

  /** The logical box this manager was built for. A trace needs it to be replayable. */
  get logical(): LogicalSize {
    return this.#logical;
  }

  get state(): Readonly<InputState> {
    return this.#state;
  }

  /**
   * Whether this key drives a seat.
   *
   * The host asks so it can keep a bound key from also activating whatever the browser
   * has focused. During a live match those keys belong to the game.
   */
  isBound(code: string): boolean {
    return this.#keyTargets.has(code);
  }

  /** A repeat keyDown for a key already down is ignored: browsers auto-repeat. */
  keyDown(code: string): void {
    const target = this.#keyTargets.get(code);
    if (target === undefined) return;
    if (target.sources.keys[target.slot]) return;
    target.sources.keys[target.slot] = true;
    if (target.slot === 'action') target.sources.actionLatched = true;
    else target.sources.latchedKeys[target.slot] = true;
  }

  keyUp(code: string): void {
    const target = this.#keyTargets.get(code);
    if (target === undefined) return;
    target.sources.keys[target.slot] = false;
  }

  /**
   * Round a logical coordinate onto the shared precision lattice.
   *
   * See {@link PRECISION_ENVELOPE}. Applied at the one place logical coordinates enter the
   * engine, so every game gets it without asking and none can opt out.
   */
  #quantise(value: number): number {
    return Math.round(value / this.#envelope) * this.#envelope;
  }

  /** The seat is decided here, from the zone the pointer went down in, and only here. */
  pointerDown(pointerId: number, rawX: number, rawY: number): void {
    const logicalX = this.#quantise(rawX);
    const logicalY = this.#quantise(rawY);
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
    sources.actionLatched = true;
    sources.pointerLatched = true;
    sources.pointerX = logicalX;
    sources.pointerY = logicalY;
  }

  /**
   * Position only. A drag that crosses the divider keeps feeding the seat it started
   * in — without that, one player's swipe would be handed to the other mid-gesture.
   */
  pointerMove(pointerId: number, rawX: number, rawY: number): void {
    const seat = this.#ownership.seatOf(pointerId);
    if (seat === undefined) return;
    const sources = this.#sourcesFor(seat);
    sources.pointerX = this.#quantise(rawX);
    sources.pointerY = this.#quantise(rawY);
  }

  pointerUp(pointerId: number): void {
    const seat = this.#ownership.seatOf(pointerId);
    if (seat === undefined) return;
    this.#ownership.release(pointerId);
    const sources = this.#sourcesFor(seat);
    if (sources.pointerCount > 0) sources.pointerCount -= 1;
  }

  /**
   * The gesture was taken away rather than let go: `pointercancel`, or a pause.
   *
   * Deliberately not `pointerUp`. The host wired `pointercancel` straight to it until
   * #2480, and the result was that a system edge-swipe, palm rejection or an incoming
   * call *fired the player's shot* in every drag-and-release aim game, aimed wherever the
   * drag had got to. A release and a cancellation are opposite events and the engine now
   * says so: this raises `pointerCancelled` for the seat and suppresses the release the
   * lift would otherwise have produced.
   *
   * The bit is raised for any cancelled pointer, not only the last one down. The engine
   * cannot know which finger was driving the aim, and of the two ways to be wrong —
   * abandoning a gesture that was still live, or committing one the browser disowned —
   * only the first is recoverable by the player.
   */
  pointerCancel(pointerId: number): void {
    const seat = this.#ownership.seatOf(pointerId);
    if (seat === undefined) return;
    this.#ownership.release(pointerId);
    const sources = this.#sourcesFor(seat);
    if (sources.pointerCount > 0) sources.pointerCount -= 1;
    sources.cancelLatched = true;
    // Nothing of the gesture survives, the un-consumed press included: a touch that went
    // down and was cancelled before the next step must not be reported as a tap, or a
    // tap-to-commit game plays the move the browser just said did not happen. The action
    // key is left alone — it is a different instrument and it was not cancelled.
    if (sources.pointerCount === 0) {
      sources.pointerLatched = false;
      if (!sources.keys.action) sources.actionLatched = false;
    }
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
    // Read before the wipe: a seat holding a pointer when the world is taken away has had
    // its gesture cancelled in exactly the sense `pointerCancel` means, and must be told
    // so on the next step. Without it a paused aim stays armed in the game, waiting for a
    // release that can never come.
    const p1Live = this.#p1Sources.pointerCount > 0;
    const p2Live = this.#p2Sources.pointerCount > 0;
    this.#ownership.releaseAll();
    releaseSources(this.#p1Sources);
    releaseSources(this.#p2Sources);
    resetSeatInputState(this.#p1State);
    resetSeatInputState(this.#p2State);
    this.#p1Sources.cancelLatched = p1Live;
    this.#p2Sources.cancelLatched = p2Live;
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
    const taps = sources.latchedKeys;
    const move = this.#move;
    // Held now, or pressed and released since the last step. The latch is consumed below
    // so a tap moves a cursor exactly one cell rather than lingering into the next step.
    const right = keys.right || taps.right;
    const left = keys.left || taps.left;
    const down = keys.down || taps.down;
    const up = keys.up || taps.up;
    set(move, (right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
    taps.right = false;
    taps.left = false;
    taps.down = false;
    taps.up = false;
    // Two keys at once must not out-run one. Capped rather than normalised outright so
    // a future analogue source keeps its shorter vectors short.
    if (lengthSq(move) > 1) normalise(move, move);
    out.moveX = move.x;
    out.moveY = move.y;

    const pointerDown = sources.pointerCount > 0;
    // A tap that has already ended still has a position this step: the press is being
    // reported now, and a press with no coordinates cannot be aimed.
    const pointerActive = pointerDown || sources.pointerLatched;
    out.pointerActive = pointerActive;
    // The pointer owns position outright; keys never write it.
    out.pointerX = sources.pointerX;
    out.pointerY = sources.pointerY;

    // Either source raises the action: a thumb on the screen and a key are the same intent.
    const held = keys.action || pointerDown;
    const was = sources.wasActionHeld;
    // A tap that began and ended between two steps is still a press. Without the latch
    // it is invisible: by the time the step runs the finger is already gone.
    const latched = sources.actionLatched;
    // A cancelled gesture is not a release, and this is the line that makes that true for
    // all 107 games at once: `actionReleased` now means "the player let go" and nothing
    // else, so every game that commits on it stops committing on a system gesture without
    // one line of game code changing.
    const cancelled = sources.cancelLatched;
    out.pointerCancelled = cancelled;
    out.actionHeld = held;
    out.actionPressed = (held || latched) && !was;
    out.actionReleased = !cancelled && !held && (was || latched);
    // Read before the reset: the release step is the one that needs the total, and it is
    // also the step on which `holdSeconds` goes to zero.
    const heldFor = out.holdSeconds;
    out.holdSeconds = held && was ? heldFor + delta : 0;
    out.holdSecondsAtRelease = out.actionReleased ? heldFor : 0;
    sources.wasActionHeld = held;
    sources.actionLatched = false;
    sources.pointerLatched = false;
    sources.cancelLatched = false;
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
