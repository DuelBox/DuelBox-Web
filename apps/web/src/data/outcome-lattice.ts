import { InputManager, InputView, Rng, envelopeFor } from '@duelbox/engine';
import type { Game, GameContext, GameManifest, Renderer } from '@duelbox/game-sdk';

/**
 * Criterion 1 of the fairness audits — *are the measured outcome distributions comparable
 * across input families?* — computed rather than argued, for every game in the registry.
 *
 * ## The question this asks, and the one it refuses to ask
 *
 * `control-parity.test.ts` compares win rates in a deliberately wide band, and says itself what
 * that band is for: "looking for a game one instrument simply cannot play — not for a tuning
 * gap". A resolution difference is invisible to it at any sample size, because it is not a
 * difference in how *well* an instrument plays but in *what it can say*. Two players of equal
 * skill holding unequal lattices win equally often and still cannot name the same shot.
 *
 * So the question here is **which values each instrument can name**, and the answer is compared
 * as a *set*. `docs/input-parity.md` and `scalarEnvelopeFor` both put it the same way: the
 * property that makes two instruments equal rather than merely comparable is that a sweep on
 * either one passes through the same cells.
 *
 * A ratio alone is worth very little, and reporting one alone is how the previous attempt at
 * this went wrong: `air-hockey` reads 5.00 and every position a key can name is also under a
 * finger, while a game reading 1.78 can share six percent of its positions. The ratio says the
 * first is five times worse. The sets say the first is fair. **Both numbers are recorded for
 * every game and the set is the one that decides.**
 *
 * ## What a lattice quantum is, and why it is measured rather than read off the source
 *
 * A quantum here is **the smallest change an instrument can make to a committed outcome**, in
 * whatever units that outcome is drawn in. It is deliberately not the input step, and the
 * difference is not academic:
 *
 * - Several games reduce the pointer to a *direction* before it reaches the simulation. Their
 *   input steps differ by any amount you like and their outcomes then advance by an identical
 *   stride, so the honest factor is 1.0. Dividing `envelopeFor(logical)` by a keyboard rate
 *   reports a gap that no player can express, and an earlier attempt at this measurement did
 *   exactly that for `piranha-rush`, `spike-attacks` and `mini-soccer`.
 * - A game may quantise its outcome coarser than either instrument's input. The sweep is then a
 *   staircase, and the quantum is the rise of a step rather than the width of the sweep's own.
 *
 * Both fall out of one rule: sweep the instrument in its own smallest increment, watch the
 * committed outcome, and take the size of the jumps it actually makes.
 *
 * ## The three mistakes already paid for
 *
 * **Let the sweep overshoot and clamp.** Stopping at the clamp reports the extremes of the range
 * as pointer-only and invents unfairness that is not there. Every sweep here deliberately runs
 * past saturation, and {@link quantumOf} reads the jump size from the moving part — a saturated
 * tail contributes no jumps, rather than contributing jumps of zero.
 *
 * **Measure the committed outcome, not a reticle.** A pre-commit frame reads the live finger,
 * which is envelope-quantised while a keyboard cursor is not, so it reports "pointer finer" for
 * every game that draws an aiming line — it is measuring the line. Every checkpoint here is
 * after the commit, which is what `cornhole` needed: it previously measured its reticle.
 *
 * **A quantum that moves when the finger's other axis moves is not a quantum.** A game that
 * normalises the finger's direction turns a sideways sweep into a diagonal one whenever the
 * finger's home is not level with the thing it steers, and the step size then reads as the
 * *component* of a stride rather than the stride. It is perfectly consistent, so a spread test
 * cannot see it. Every pointer gesture is therefore run from three homes that differ only across
 * the sweep, and thrown away unless all three agree — see {@link PERPENDICULAR_HOMES}.
 *
 * ## What it cannot do
 *
 * A single-axis sweep cannot separate the two quantities of a drag that sets angle and power
 * together, and a game that aims through `atan2` has no single step size to find. Those read
 * `uncalibratable` with the reason attached. That is a limit of this harness, **not a finding
 * that the game is fair and not a finding that it is unfair** — the two must never be reported
 * as though they were the same thing.
 */

const STEP = 1 / 60;

/** Frames of no input before a sweep, so a game reaches whatever state it takes input in. */
const SETTLE = 45;

/**
 * Frames the input phase occupies, identical for every run of every sweep.
 *
 * Without the padding a longer hold commits later, and every reading is then contaminated by
 * however far the world moved in the difference.
 */
const WINDOW = 40;

/**
 * When the outcome is looked at, in frames after the commit.
 *
 * More than one, because a game can show its answer at either end: a thrown thing separates
 * immediately, a scored thing only once it has landed. Each checkpoint contributes its own
 * channels and the clearest of them is the one that gets used.
 *
 * Two, not three. A checkpoint sixty frames out was swept as well and no game's reading came off
 * it — every one of them was settled by frame twenty — while it cost a third of the simulation
 * and a third of the memory of the whole harness. This suite already loses runs to Vitest's
 * sixty-second transport timeout under load (see `vitest.config.ts`), so work that buys nothing
 * is not free here.
 */
const CHECKPOINTS = [2, 20] as const;

/** Envelopes of pointer travel the travel sweep runs to. Runs past most games' clamps. */
const TRAVEL_STEPS = 40;

/** Frames the dwell and key sweeps run to. Must stay inside {@link WINDOW}. */
const HOLD_FRAMES = 24;

/** How far the dwell sweep's finger is planted from home, in envelopes. */
const DWELL_REACH = 40;

/**
 * The two homes every pointer gesture is run from, as envelopes across the swept axis.
 *
 * A quantum is a property of the instrument and the game, so it may not depend on where the
 * finger happened to start on the axis nobody is sweeping. Running from two homes and requiring
 * the same answer is what tells a real lattice from the component of a diagonal one — the whole
 * difference between reading `beach-ball` as a stride both instruments share and reading it as
 * two-thirds of one.
 *
 * Three homes rather than two, and not symmetric, because two can agree by coincidence — a
 * game whose finger both aims and throws in one gesture produced a step that matched across two
 * homes and matched nothing in its own source. A third home at an unrelated distance costs half
 * as much again and is much harder to satisfy by accident.
 *
 * All three stay well inside a seat's own half so that `seatForPoint` still hands the gesture to
 * seat one: the largest is 24 envelopes, an eighth of the play area's short side.
 */
const PERPENDICULAR_HOMES = [0, 24, -16] as const;

/** How far the two homes' answers may differ and still be called the same number. */
const HOME_TOLERANCE = 0.01;

/**
 * How many calls of each drawing method are followed, per checkpoint.
 *
 * Bucketed by method rather than taken as one run of the frame, because a game that draws a
 * variable number of labels would otherwise shift every shape drawn after them into a different
 * slot, and {@link channelsOf} would drop the whole tail of the frame as unstable. A wall of
 * bricks must not cost a game its paddle.
 *
 * Beyond a method's budget a frame's tail is not followed. The budgets are generous for what the
 * collection actually draws and the total is what sizes every trace, so raising one is cheap and
 * raising all of them is not.
 */
const BUDGETS: readonly number[] = [
  0, // unused id 0
  1, // clear
  224, // rect
  96, // strokeRect
  176, // circle
  96, // strokeCircle
  176, // line
  112, // text
  48, // pushSeatRotation
  48, // pushRotation
  47, // popSeatRotation
];

/** Where each method's calls begin in a checkpoint's slots. */
const BASES: readonly number[] = BUDGETS.map((_unused, index) =>
  BUDGETS.slice(0, index).reduce((total, budget) => total + budget, 0),
);

const MAX_CALLS = BUDGETS.reduce((total, budget) => total + budget, 0);

const METHODS = BUDGETS.length;

/** Numeric arguments read per draw call. Everything past this is colour and alignment. */
const ARITY = 6;

/** Below this fraction of a channel's own range, a jump is no jump at all. */
const JUMP_FLOOR = 1e-6;

/** How far the jumps of one sweep may spread and still be called one quantum. */
const SPREAD_TOLERANCE = 0.02;

/** Jumps a sweep must make before its quantum is a measurement and not a coincidence. */
const MIN_JUMPS = 6;

/**
 * How much of the ground a sweep's jumps covered must still separate its ends.
 *
 * A lattice is walked along, so a sweep that takes `n` steps of size `q` finishes about `n * q`
 * from where it started. A thing that flicks between two places also takes plenty of jumps, all
 * of one size, and finishes where it began — and it does that for *either* instrument, so it
 * reports a ratio of exactly one and a verdict of parity for a game nobody has measured. That
 * false pass is the one this constant exists to refuse. Half, not all, because an outcome that
 * curves — a blade on an arc — covers real ground while its ends stay closer than the path
 * between them.
 */
const MONOTONE_SHARE = 0.5;

/** Share of a sweep's runs that must survive to the last checkpoint. */
const MIN_COMPLETE = 0.75;

/**
 * Pointer steps the two lattices are compared over: the pointer's own range, by rule 8.
 *
 * `PRECISION_ENVELOPE` is one two-hundredth of the play area's short side, so two hundred
 * pointer steps is exactly that short side — the one span both instruments are asked about, and
 * the one that means the same thing on a phone and on a desktop.
 */
const SPAN_STEPS = 200;

/** Below this share of the smaller lattice, an overlap is not worth calling one. */
const SPARSE_BELOW = 0.25;

/** How far a channel's ratio may sit from the consensus and still be counted as agreeing. */
const RATIO_AGREEMENT = 0.01;

/**
 * How much of the frame must agree with the consensus before it is called a measurement.
 *
 * Every candidate has already survived a spread test and three homes, so two of them
 * disagreeing about the ratio is not noise: it means two different quantities are being driven,
 * and which one a reading describes then depends on which the tie-break happened to pick. A
 * frame that disagrees with itself has not measured the game.
 */
const MIN_AGREEMENT = 0.5;

/**
 * How a game's two lattices stand to each other.
 *
 * `parity` is the pass mark for criterion 1. `nested` is named rather than folded into a
 * percentage because it is the near miss that costs nobody anything: every value one instrument
 * can name is also nameable by the other, so the two are commensurable even though one is
 * coarser, and no shot exists that only one player can play.
 */
export type Verdict = 'parity' | 'nested' | 'partial' | 'sparse' | 'uncalibratable';

export type Axis = 'x' | 'y';

export interface Reading {
  readonly game: string;
  readonly verdict: Verdict;
  /**
   * Outcome units one envelope of pointer travel — or one frame of a planted finger, where
   * travel names nothing — moves the committed outcome. Null when the game is uncalibratable.
   */
  readonly pointerQuantum: number | null;
  /** Outcome units one frame of a held key moves the same committed outcome. */
  readonly keyboardQuantum: number | null;
  /** The coarser quantum over the finer one, so it is never below 1. */
  readonly ratio: number | null;
  /** Values the pointer can name across the span, always {@link SPAN_STEPS} + 1. */
  readonly pointerValues: number;
  /** Values a held key can name across the same span. */
  readonly keyboardValues: number;
  /** Values both can name. */
  readonly shared: number;
  /** Which pointer gesture and which key direction turned out to drive the same quantity. */
  readonly pairing: string | null;
  readonly reason: string;
}

type Split = 'horizontal' | 'vertical' | 'shared';

function splitOf(manifest: GameManifest): Split {
  if (manifest.zoneSplit === 'vertical') return 'vertical';
  // The manifest calls it `shared-board`; the engine calls it `shared`.
  if (manifest.zoneSplit === 'shared-board') return 'shared';
  return 'horizontal';
}

/** The middle of the surface seat one owns, which is where every gesture here starts. */
function homeFor(manifest: GameManifest, split: Split): readonly [number, number] {
  const { width, height } = manifest.logical;
  if (split === 'vertical') return [width * 0.25, height / 2];
  if (split === 'shared') return [width / 2, height / 2];
  return [width / 2, height * 0.75];
}

/**
 * What a run told the renderer at each checkpoint, one draw call per row.
 *
 * Per *call* rather than per method, because a channel has to be a quantity in the game's own
 * logical units for its jumps to mean anything: the x of the fourth circle is a position, and
 * the sum of the x of every circle is not — it is a number that moves when a trail grows by a
 * segment. The cost is that a run whose call sequence differs cannot be compared with its
 * neighbours, and {@link channelsOf} drops exactly those columns rather than lining up rows
 * that are not the same shape.
 */
interface Trace {
  /** Calls each method made at each checkpoint, so a run that drew a different frame is seen. */
  readonly counts: Uint16Array;
  /** {@link ARITY} numbers per call slot. */
  readonly args: Float64Array;
}

const SLOTS = CHECKPOINTS.length * MAX_CALLS;

/**
 * A `Renderer` that keeps the numbers and throws the colours away.
 *
 * Every method the interface declares is written out rather than proxied, so a method added to
 * `Renderer` is a compile error here rather than a channel that quietly stops being recorded.
 */
class TraceRecorder implements Renderer {
  readonly counts = new Uint16Array(CHECKPOINTS.length * METHODS);
  readonly args = new Float64Array(SLOTS * ARITY);
  #checkpoint = 0;

  /** Name the checkpoint the next draw calls belong to. */
  mark(index: number): void {
    this.#checkpoint = index;
  }

  #push(id: number, a: number, b: number, c: number, d: number, e: number, f: number): void {
    const tally = this.#checkpoint * METHODS + id;
    const ordinal = this.counts[tally] ?? 0;
    this.counts[tally] = ordinal + 1;
    if (ordinal >= (BUDGETS[id] ?? 0)) return;
    const slot = this.#checkpoint * MAX_CALLS + (BASES[id] ?? 0) + ordinal;
    const at = slot * ARITY;
    this.args[at] = Number.isFinite(a) ? a : 0;
    this.args[at + 1] = Number.isFinite(b) ? b : 0;
    this.args[at + 2] = Number.isFinite(c) ? c : 0;
    this.args[at + 3] = Number.isFinite(d) ? d : 0;
    this.args[at + 4] = Number.isFinite(e) ? e : 0;
    this.args[at + 5] = Number.isFinite(f) ? f : 0;
  }

  clear(): void {
    this.#push(1, 0, 0, 0, 0, 0, 0);
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.#push(2, x, y, width, height, 0, 0);
  }

  strokeRect(x: number, y: number, width: number, height: number, lineWidth: number): void {
    this.#push(3, x, y, width, height, lineWidth, 0);
  }

  circle(x: number, y: number, radius: number): void {
    this.#push(4, x, y, radius, 0, 0, 0);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number): void {
    this.#push(5, x, y, radius, lineWidth, 0, 0);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number): void {
    this.#push(6, x1, y1, x2, y2, lineWidth, 0);
  }

  text(value: string, x: number, y: number, sizePx: number): void {
    this.#push(7, value.length, x, y, sizePx, 0, 0);
  }

  pushSeatRotation(rotated: boolean): void {
    this.#push(8, rotated ? 1 : 0, 0, 0, 0, 0, 0);
  }

  pushRotation(radians: number): void {
    this.#push(9, radians, 0, 0, 0, 0, 0);
  }

  popSeatRotation(): void {
    this.#push(10, 0, 0, 0, 0, 0, 0);
  }
}

/** How one arm holds its instrument for one run of a sweep. */
interface Gesture {
  /** `travel` moves the finger; `dwell` plants it and varies how long it stays; `key` holds. */
  readonly mode: 'travel' | 'dwell' | 'key';
  readonly axis: Axis;
  readonly sign: 1 | -1;
  /** Envelopes the home is offset across the swept axis. See {@link PERPENDICULAR_HOMES}. */
  readonly home: number;
  /** Envelopes for `travel`, frames for `dwell` and `key`. */
  readonly amount: number;
}

const KEY_CODES: Readonly<Record<Axis, Readonly<Record<string, string>>>> = {
  x: { '1': 'KeyD', '-1': 'KeyA' },
  y: { '1': 'KeyS', '-1': 'KeyW' },
};
const ACTION_KEY = 'Space';

function nameOf(gesture: Gesture): string {
  return `${gesture.mode}${gesture.sign === 1 ? '+' : '-'}${gesture.axis}`;
}

/**
 * Drive one game once and return what the renderer was told at each post-commit checkpoint.
 *
 * `null` means the run is not comparable with the rest of its sweep — the game ended, or threw.
 * A game that ends mid-sweep is reporting on the script rather than on the instrument.
 */
function capture(create: () => Game, manifest: GameManifest, gesture: Gesture): Trace | null {
  const game = create();
  const context: GameContext = {
    manifest,
    rng: new Rng(20260830),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    // No bot on seat two. The question is what seat one can express, and an opponent moving in
    // the background is noise on every channel the answer is read from.
    botDifficulty: (): null => null,
  };

  const split = splitOf(manifest);
  const { width, height } = manifest.logical;
  const input = new InputManager({ width, height }, { split, bottomSeat: 'p1' });
  const view = new InputView();
  const recorder = new TraceRecorder();
  const envelope = envelopeFor(manifest.logical);
  const [centreX, centreY] = homeFor(manifest, split);
  const across = gesture.home * envelope;
  const homeX = gesture.axis === 'x' ? centreX : centreX + across;
  const homeY = gesture.axis === 'y' ? centreY : centreY + across;

  const reach = gesture.mode === 'travel' ? gesture.amount * envelope : DWELL_REACH * envelope;
  const aimX = gesture.axis === 'x' ? homeX + gesture.sign * reach : homeX;
  const aimY = gesture.axis === 'y' ? homeY + gesture.sign * reach : homeY;

  const advance = (): boolean => {
    if (split === 'shared') input.setBoardSeat(game.getActiveSeat?.() ?? 'p1');
    game.update(STEP, view.sync(input.beginStep(STEP)));
    return game.getScore().winner === null;
  };

  try {
    game.init(context);
    for (let i = 0; i < SETTLE; i += 1) if (!advance()) return null;

    if (gesture.mode === 'key') {
      // The knob is a held direction key; the commit is the action key going down.
      const code = KEY_CODES[gesture.axis][String(gesture.sign)] ?? 'KeyD';
      input.keyDown(code);
      for (let i = 0; i < gesture.amount; i += 1) if (!advance()) return null;
      input.keyUp(code);
      for (let i = gesture.amount; i < WINDOW; i += 1) if (!advance()) return null;
      input.keyDown(ACTION_KEY);
      if (!advance()) return null;
      input.keyUp(ACTION_KEY);
    } else if (gesture.mode === 'travel') {
      // The knob is how far the finger went; the commit is the finger leaving the glass. The
      // gesture is placed to *end* on the frame the key arm's press lands on, so both outcomes
      // are the same age at every checkpoint.
      input.pointerDown(1, homeX, homeY);
      if (!advance()) return null;
      input.pointerMove(1, aimX, aimY);
      for (let i = 1; i < WINDOW; i += 1) if (!advance()) return null;
      input.pointerUp(1);
      if (!advance()) return null;
    } else {
      // The knob is how long the finger stayed, for the games that reduce it to a direction
      // before the simulation sees it and whose travel therefore names nothing at all.
      for (let i = gesture.amount; i < WINDOW; i += 1) if (!advance()) return null;
      if (gesture.amount > 0) {
        input.pointerDown(1, aimX, aimY);
        for (let i = 0; i < gesture.amount; i += 1) if (!advance()) return null;
        input.pointerUp(1);
      }
      if (!advance()) return null;
    }

    let elapsed = 0;
    for (let c = 0; c < CHECKPOINTS.length; c += 1) {
      const at = CHECKPOINTS[c] ?? 0;
      for (; elapsed < at; elapsed += 1) if (!advance()) return null;
      recorder.mark(c);
      game.render(recorder, 0);
    }
    return { counts: recorder.counts, args: recorder.args };
  } catch {
    return null;
  } finally {
    game.destroy();
  }
}

/** One run of a sweep, in sweep order. `null` where the run did not finish. */
type Sweep = readonly (Trace | null)[];

/**
 * One quantity a game draws, followed across a sweep.
 *
 * A channel is deliberately one *call's* argument rather than a total over every call of a
 * method: the x of the fourth circle is a position, and the sum of the x of every circle is a
 * number that also moves when a trail grows by a segment.
 *
 * `across` names the argument holding the other half of a coordinate pair — `y` to an `x`. When
 * it is set, the jump between two runs is the **distance the drawn thing moved**, not the
 * change in one of its coordinates, and that is what makes the reading independent of where the
 * finger started. A game that steers by a normalised direction turns a sideways drag into a
 * diagonal whenever the finger is not level with the thing it steers, and the change in x is
 * then a *component* of the stride — perfectly consistent, so no spread test can see it, and
 * different for every home. The distance is the stride itself either way.
 */
interface Channel {
  readonly slot: number;
  readonly method: number;
  readonly ordinal: number;
  readonly checkpoint: number;
  readonly arg: number;
  readonly across: number | null;
}

/** Which argument holds the other half of a coordinate pair, per drawing method. */
const PAIRS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  2: [[0, 1]],
  3: [[0, 1]],
  4: [[0, 1]],
  5: [[0, 1]],
  6: [
    [0, 1],
    [2, 3],
  ],
  7: [[1, 2]],
};

/** Method ids, as {@link TraceRecorder} assigns them, for naming a channel in a reading. */
const METHOD_NAMES: readonly string[] = [
  '?',
  'clear',
  'rect',
  'strokeRect',
  'circle',
  'strokeCircle',
  'line',
  'text',
  'pushSeatRotation',
  'pushRotation',
  'popSeatRotation',
];

/**
 * Where a reading came from, in terms a person can go and look at.
 *
 * `circle#37.xy@20` is the x and y of the thirty-eighth circle of the frame drawn twenty frames
 * after the commit. Recorded with every measurement, because a number whose provenance is a
 * slot index cannot be checked by anybody, and a recorded table nobody can check is a table
 * that drifts.
 */
function channelName(channel: Channel): string {
  const method = METHOD_NAMES[channel.method] ?? '?';
  const at = CHECKPOINTS[channel.checkpoint] ?? 0;
  const args = channel.across === null ? `${channel.arg}` : `${channel.arg}${channel.across}`;
  return `${method}#${channel.ordinal}.${args}@${at}`;
}

/**
 * The quantities every run of every sweep drew, in the order each method drew them.
 *
 * Only the calls every run made are followed. A game that cuts a cane down draws one circle
 * fewer, and the circles after it are then a different set of things rather than one set seen
 * twice — so the tail is dropped and the shared prefix kept, per method, which is why a wall of
 * bricks that loses a brick does not also cost the game its paddle.
 */
function channelsOf(sweeps: readonly Sweep[]): Channel[] {
  const traces = sweeps.flat().filter((trace): trace is Trace => trace !== null);
  const first = traces[0];
  if (first === undefined) return [];
  const channels: Channel[] = [];
  for (let checkpoint = 0; checkpoint < CHECKPOINTS.length; checkpoint += 1) {
    for (let id = 1; id < METHODS; id += 1) {
      const tally = checkpoint * METHODS + id;
      let count = first.counts[tally] ?? 0;
      for (const trace of traces) count = Math.min(count, trace.counts[tally] ?? 0);
      if (count === 0) continue;
      const drawn = Math.min(count, BUDGETS[id] ?? 0);
      for (let ordinal = 0; ordinal < drawn; ordinal += 1) {
        const slot = checkpoint * MAX_CALLS + (BASES[id] ?? 0) + ordinal;
        for (let arg = 0; arg < ARITY; arg += 1) {
          channels.push({ slot, method: id, ordinal, checkpoint, arg, across: null });
        }
        for (const [arg, across] of PAIRS[id] ?? []) {
          channels.push({ slot, method: id, ordinal, checkpoint, arg, across });
        }
      }
    }
  }
  return channels;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** What one sweep did to one channel. */
interface Quantum {
  /** The size of the jump the channel makes when it moves at all. */
  readonly size: number;
  /** How far the jumps spread, relative to their own size. Zero is a perfect staircase. */
  readonly spread: number;
  readonly jumps: number;
}

/**
 * The step size a sweep imposes on one channel, or null when the channel names nothing.
 *
 * Only the jumps count. A sweep that has run into a clamp makes no more of them, and a sweep
 * finer than the outcome lattice makes them only every few runs — dropping the flat stretches
 * is what turns both of those into the same measurement, and is exactly why this reads a
 * lattice quantum where a mean of the differences would read a sweep-index ratio.
 */
function quantumOf(sweep: Sweep, channel: Channel): Quantum | null {
  const at = channel.slot * ARITY;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const trace of sweep) {
    if (trace === null) break;
    xs.push(trace.args[at + channel.arg] ?? 0);
    if (channel.across !== null) ys.push(trace.args[at + channel.across] ?? 0);
  }
  if (xs.length < MIN_JUMPS + 1) return null;
  const raw: number[] = [];
  let reach = 0;
  const firstX = xs[0] ?? 0;
  const firstY = ys[0] ?? 0;
  for (let i = 1; i < xs.length; i += 1) {
    const dx = (xs[i] ?? 0) - (xs[i - 1] ?? 0);
    const dy = channel.across === null ? 0 : (ys[i] ?? 0) - (ys[i - 1] ?? 0);
    raw.push(Math.hypot(dx, dy));
    const spanX = (xs[i] ?? 0) - firstX;
    const spanY = channel.across === null ? 0 : (ys[i] ?? 0) - firstY;
    reach = Math.max(reach, Math.hypot(spanX, spanY));
  }
  if (!(reach > 0)) return null;
  const floor = reach * JUMP_FLOOR;
  const jumps = raw.filter((jump) => jump > floor);
  if (jumps.length < MIN_JUMPS) return null;
  const size = median(jumps);
  if (!(size > 0)) return null;
  if (reach < (jumps.length - 1) * size * MONOTONE_SHARE) return null;
  const spread = median(jumps.map((jump) => Math.abs(jump - size))) / size;
  return { size, spread, jumps: jumps.length };
}

/** Every run of one gesture, from each of {@link PERPENDICULAR_HOMES}. */
interface Arm {
  readonly gesture: Gesture;
  readonly sweeps: readonly Sweep[];
}

/**
 * One gesture's quantum on one channel, or null when the gesture does not name a lattice there.
 *
 * A gesture answers only when **every** home answers, every answer settles, and all of them
 * agree. Homes disagreeing is the signature of a game that turns the finger's position into a
 * direction: the sweep is then a diagonal whose angle depends on where the finger started, and
 * its step is a component of the real stride rather than the stride.
 */
function armQuantum(arm: Arm, channel: Channel): Quantum | null {
  let agreed: Quantum | null = null;
  for (const sweep of arm.sweeps) {
    const quantum = quantumOf(sweep, channel);
    if (quantum === null || quantum.spread > SPREAD_TOLERANCE) return null;
    if (agreed === null) {
      agreed = quantum;
      continue;
    }
    const drift = Math.abs(quantum.size - agreed.size) / Math.max(quantum.size, agreed.size);
    if (drift > HOME_TOLERANCE) return null;
    if (quantum.jumps > agreed.jumps) agreed = quantum;
  }
  return agreed;
}

/** How many of the pointer's values across the span a lattice of spacing `keyboard` also names. */
function overlap(pointer: number, keyboard: number, span: number): number {
  const tolerance = span * 1e-9;
  let shared = 0;
  for (let i = 0; i <= SPAN_STEPS; i += 1) {
    const at = i * pointer;
    const j = Math.round(at / keyboard);
    if (Math.abs(j * keyboard - at) <= tolerance) shared += 1;
  }
  return shared;
}

function verdictFor(keys: number, shared: number): Verdict {
  const points = SPAN_STEPS + 1;
  if (shared === points && shared === keys) return 'parity';
  if (shared === points || shared === keys) return 'nested';
  const smaller = Math.min(points, keys);
  if (smaller === 0 || shared / smaller < SPARSE_BELOW) return 'sparse';
  return 'partial';
}

/** A reading that failed, with the reason attached rather than reduced to a category. */
function unmeasured(game: string, reason: string): Reading {
  return {
    game,
    verdict: 'uncalibratable',
    pointerQuantum: null,
    keyboardQuantum: null,
    ratio: null,
    pointerValues: 0,
    keyboardValues: 0,
    shared: 0,
    pairing: null,
    reason,
  };
}

interface Calibration {
  readonly pointer: Quantum;
  readonly keyboard: Quantum;
  readonly pairing: string;
  readonly channel: Channel;
  readonly ratio: number;
}

/**
 * Sweep a game through both instruments and rule on it.
 *
 * Every pointer gesture is tried against every key direction, because the two knobs need not be
 * on the same axis: Shuriken is the proof — a finger's *sideways* travel is the spin, while a
 * key spins with `KeyS` and aims with `KeyD`, so sweeping x against x there compares an aim
 * against a spin and returns a number that means nothing.
 *
 * The pointer's two kinds of gesture are both tried and **the finer of them wins**, because both are
 * things one finger can do. `air-hockey` puts the mallet where the finger is, so its travel
 * names a position every three units while a planted finger only drags the mallet along at its
 * top speed. `piranha-rush` is the other way round: travel names nothing at all, because the
 * pointer is reduced to a direction before the simulation sees it, and the finger's whole
 * expression is in when it lifts.
 *
 * Both quanta must come off **one** channel. Two step sizes read from two different things the
 * game draws are in different units, and their ratio is a number with no meaning.
 */
export function measureGame(create: () => Game, manifest: GameManifest): Reading {
  const id = manifest.id;
  const axes: readonly Axis[] = ['x', 'y'];
  const signs: readonly (1 | -1)[] = [1, -1];
  const pointerArms: Arm[] = [];
  const keyArms: Arm[] = [];
  let ended = 0;
  let total = 0;

  const sweepOf = (gesture: Gesture, steps: number): Sweep => {
    const runs: (Trace | null)[] = [];
    for (let n = 0; n <= steps; n += 1) {
      const trace = capture(create, manifest, { ...gesture, amount: n });
      total += 1;
      if (trace === null) ended += 1;
      runs.push(trace);
    }
    return runs;
  };

  for (const axis of axes) {
    for (const sign of signs) {
      for (const mode of ['travel', 'dwell'] as const) {
        const steps = mode === 'travel' ? TRAVEL_STEPS : HOLD_FRAMES;
        const gesture: Gesture = { mode, axis, sign, home: 0, amount: 0 };
        pointerArms.push({
          gesture,
          sweeps: PERPENDICULAR_HOMES.map((home) => sweepOf({ ...gesture, home }, steps)),
        });
      }
      // A key has no home to be offset from, so it is swept once.
      const key: Gesture = { mode: 'key', axis, sign, home: 0, amount: 0 };
      keyArms.push({ gesture: key, sweeps: [sweepOf(key, HOLD_FRAMES)] });
    }
  }

  if (total - ended < total * MIN_COMPLETE) {
    return unmeasured(id, `${ended} of ${total} runs ended before the last checkpoint`);
  }

  const arms = [...pointerArms, ...keyArms];
  const channels = channelsOf(arms.flatMap((arm) => arm.sweeps));
  if (channels.length === 0) return unmeasured(id, 'no two runs drew the same frame twice');

  const candidates: Calibration[] = [];
  const seen = {
    pointerMoved: false,
    pointerSettled: false,
    pointerSteady: false,
    keyboardMoved: false,
    keyboardSettled: false,
    keyboardSteady: false,
  };

  const survey = (arm: Arm, channel: Channel, who: 'pointer' | 'keyboard'): Quantum | null => {
    for (const sweep of arm.sweeps) {
      const loose = quantumOf(sweep, channel);
      if (loose === null) continue;
      seen[`${who}Moved`] = true;
      if (loose.spread <= SPREAD_TOLERANCE) seen[`${who}Settled`] = true;
    }
    const quantum = armQuantum(arm, channel);
    if (quantum !== null) seen[`${who}Steady`] = true;
    return quantum;
  };

  for (const channel of channels) {
    let pointer: { quantum: Quantum; gesture: Gesture } | null = null;
    for (const arm of pointerArms) {
      const quantum = survey(arm, channel, 'pointer');
      if (quantum === null) continue;
      // The finer gesture is the one the finger would use; both are available to it.
      if (pointer === null || quantum.size < pointer.quantum.size) {
        pointer = { quantum, gesture: arm.gesture };
      }
    }
    let keyboard: { quantum: Quantum; gesture: Gesture } | null = null;
    for (const arm of keyArms) {
      const quantum = survey(arm, channel, 'keyboard');
      if (quantum === null) continue;
      if (keyboard === null || quantum.size < keyboard.quantum.size) {
        keyboard = { quantum, gesture: arm.gesture };
      }
    }
    if (pointer === null || keyboard === null) continue;
    const coarse = Math.max(pointer.quantum.size, keyboard.quantum.size);
    const fine = Math.min(pointer.quantum.size, keyboard.quantum.size);
    candidates.push({
      pointer: pointer.quantum,
      keyboard: keyboard.quantum,
      pairing: `${nameOf(pointer.gesture)}/${nameOf(keyboard.gesture)}`,
      channel,
      ratio: coarse / fine,
    });
  }

  if (candidates.length === 0) {
    const why = (who: 'pointer' | 'keyboard'): string => {
      if (!seen[`${who}Moved`]) return `the ${who} moved nothing the renderer shows`;
      if (!seen[`${who}Settled`]) {
        return `the ${who} moves the outcome continuously: no one step size describes it`;
      }
      return `the ${who}'s step depends on where the finger sits across the sweep`;
    };
    if (!seen.pointerSteady && !seen.keyboardSteady) {
      if (!seen.pointerMoved && !seen.keyboardMoved) {
        return unmeasured(id, 'neither instrument moved anything the renderer shows');
      }
      return unmeasured(id, `${why('pointer')}, and ${why('keyboard')}`);
    }
    if (!seen.pointerSteady) return unmeasured(id, why('pointer'));
    if (!seen.keyboardSteady) return unmeasured(id, why('keyboard'));
    return unmeasured(id, 'the two instruments never moved one drawn quantity in common');
  }

  // Where anything the game *moves* answered, the things it merely resizes are not consulted.
  // A distance travelled is the same number whichever way the thing went, and a coordinate is
  // not: a stride taken diagonally spends only its component on x, so a scalar channel reads a
  // diagonal drag as a finer lattice than the same stride taken straight. Measuring the
  // distance removes that, and it is the reason a game is compared on what it drew as a
  // position wherever it drew one.
  const moved = candidates.filter((candidate) => candidate.channel.across !== null);
  const consulted = moved.length > 0 ? moved : candidates;

  // The ratio is a property of the game, not of whichever thing the game happens to draw it
  // with, so it is taken as the consensus of every quantity that answered, and the quanta are
  // then read off a channel that agrees with it. A single channel can be a lucky pick; a
  // consensus most of the frame disagrees with is visible in the recorded table.
  const consensus = median(consulted.map((candidate) => candidate.ratio));
  const agreeing = consulted.filter(
    (candidate) => Math.abs(candidate.ratio - consensus) / consensus <= RATIO_AGREEMENT,
  );
  let best: Calibration | null = null;
  for (const candidate of agreeing) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const spread = candidate.keyboard.spread + candidate.pointer.spread;
    const bestSpread = best.keyboard.spread + best.pointer.spread;
    if (spread > bestSpread) continue;
    const jumps = candidate.keyboard.jumps + candidate.pointer.jumps;
    const bestJumps = best.keyboard.jumps + best.pointer.jumps;
    if (spread === bestSpread && jumps <= bestJumps) continue;
    best = candidate;
  }
  const agreement = `${agreeing.length}/${consulted.length} channels agree`;
  if (best === null || agreeing.length < consulted.length * MIN_AGREEMENT) {
    return unmeasured(id, `the frame disagrees with itself about the ratio: ${agreement}`);
  }

  const pointerQuantum = best.pointer.size;
  const keyboardQuantum = best.keyboard.size;
  const span = SPAN_STEPS * pointerQuantum;
  const keyboardValues = Math.floor(span / keyboardQuantum + 1e-9) + 1;
  const shared = overlap(pointerQuantum, keyboardQuantum, span);
  const ratio =
    keyboardQuantum >= pointerQuantum
      ? keyboardQuantum / pointerQuantum
      : pointerQuantum / keyboardQuantum;
  return {
    game: id,
    verdict: verdictFor(keyboardValues, shared),
    pointerQuantum,
    keyboardQuantum,
    ratio,
    pointerValues: SPAN_STEPS + 1,
    keyboardValues,
    shared,
    pairing: best.pairing,
    reason: `${channelName(best.channel)}, ${agreement}`,
  };
}
