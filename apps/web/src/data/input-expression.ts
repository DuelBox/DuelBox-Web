import {
  InputManager,
  InputView,
  Rng,
  envelopeFor,
  zoneSplitFor,
  type LogicalSize,
  type Renderer,
  type ZoneSplit,
} from '@duelbox/engine';
import type { Game, GameContext, GameManifest } from '@duelbox/game-sdk';
import type { LoadedGame } from './registry';

/**
 * What each input family can *say*, rather than how often it wins.
 *
 * `control-parity.test.ts` already asks whether a thumb and a keyboard win at comparable
 * rates, inside a deliberately wide band, and its own comment says what it is for: finding
 * a game one instrument simply cannot play. That is not acceptance criterion 1 of the
 * seventy-eight fairness audits, and no band width would make it so. A win rate cannot see
 * the thing the criterion is about, because the thing is not a *strength* difference.
 *
 * CLAUDE.md asks for "a common precision envelope so no input family can aim finer than
 * another". Aiming finer is a statement about **reachable sets**: the values an instrument
 * can select and commit. Two instruments can win equally often while one of them can name
 * spins the other physically cannot reach — the loser never sees it, because the shot they
 * wanted was never in their vocabulary.
 *
 * ## The measurement
 *
 * The engine quantises pointer *position* onto a lattice of `envelopeFor(logical)` and
 * nothing else, so the pointer's finest expressible increment is one envelope of travel.
 * A keyboard has no position at all: every game that binds a continuous quantity to a key
 * integrates a private rate constant over the fixed timestep, so the keyboard's finest
 * expressible increment is one simulation step of that rate. Those two lattices are
 * unrelated numbers, invented per game, and nothing in the repository has ever compared
 * them.
 *
 * This compares them, without reading either. For each game it sweeps a one-parameter knob
 * through each instrument in its own smallest legal increment — one envelope of pointer
 * travel, one step of key hold — and observes the game through the only channel every game
 * shares: {@link Renderer}. A game draws its aim, its power bar, its reticle and its
 * consequences, so the draw stream is a faithful, generic, game-agnostic read of the state
 * the player selected.
 *
 * Two numbers come out of a sweep:
 *
 * - **step** — the median distance between the outcomes of two *adjacent* knob values.
 *   This is the smallest difference that instrument can express at all.
 * - **span** — the largest distance between any two outcomes in the sweep. This is how
 *   much of the quantity the sweep covered.
 *
 * Distances are taken in the render vector, per-slot-normalised by the range that slot
 * covers across every sweep of that game, so the number is scale-free and a paddle measured
 * in hundreds of units and an angle measured in radians contribute comparably.
 *
 * The **expression factor** is then `step(keyboard) / step(pointer)`, computed only over
 * the render slots *both* sweeps actually move — comparing the two instruments on a common
 * observable rather than on whatever each happens to touch. A factor of 2 means the pointer
 * can select twice as many distinct values of that quantity as the keyboard can. That is
 * criterion 1, stated as a ratio.
 *
 * ## Aimed, or merely integrated
 *
 * The factor only *matters* for a quantity that is aimed and committed. A velocity or a
 * position that both instruments accumulate is not a fairness problem: whatever the step
 * sizes, both players are pushing the same thing in the same direction and neither is
 * excluded from anything.
 *
 * That distinction is measured rather than read, because reading it got the wrong answer
 * once already: issue #2478 asserted from the source that Shuriken bound spin to pointer
 * *velocity*, and measurement showed the per-step deltas telescope to net displacement —
 * the same 300-unit drag gives the identical spin over 3 frames and over 120.
 *
 * So {@link pathIndependence} runs the same gesture twice with the same endpoint and
 * different durations. A quantity that is *aimed* reads only where the finger ended and
 * gives the same outcome both times; one that is *integrated* has been accumulating the
 * whole way and does not. Shuriken passes, an anchored virtual stick does not, and no
 * source is consulted either way.
 *
 * Nothing here allocates inside a game's `update()` — the harness only calls it — and every
 * run is seeded (rule 4). Two runs of this file produce byte-identical numbers.
 */

/** The fixed timestep every game is stepped on, and the keyboard's finest unit. */
export const STEP = 1 / 60;

/** Steps of settling before anything is asked of the game. */
const WARM_STEPS = 10;
/**
 * Steps set aside for the keyboard to aim in.
 *
 * The direction key is held for the *last* `|knob|` of them, so it is released on the step
 * before the action rather than a variable number of steps earlier. A game that drifts
 * while nothing is held then drifts identically at every knob value, and the knob varies
 * the aim and nothing else.
 */
const AIM_STEPS = 60;
const ACTION_FROM = WARM_STEPS + AIM_STEPS;

/**
 * The action window, and why the pointer's and the keyboard's are offset from each other.
 *
 * A keyboard commits on `actionPressed` and a pointer on `actionReleased` in every
 * drag-and-release game in the catalogue. Give both instruments the same window and their
 * two shots are fired a whole window apart, so every checkpoint afterwards samples two
 * different moments of two different flights — a difference in *shape*, not a constant
 * offset, and one no centring removes. Shuriken could not be calibrated at all until this
 * was fixed: no pointer knob reproduced any keyboard outcome to better than 1.6 grains.
 *
 * So the pointer's gesture is placed to **end** where the keyboard's begins. The pointer
 * presses one step early, pulls, and lifts one step after the keyboard's press, which puts
 * every commit either instrument can make within one step of `ACTION_FROM`.
 */
const KEY_ACTION_STEPS = 3;
/** Steps the pointer is down for during a sweep: press, pull, lift. */
const SWEEP_HOLD = 2;
/** The step after which nothing is asked of the game and the outcome plays out. */
const SETTLED_AT = ACTION_FROM + KEY_ACTION_STEPS;
/** The longest a timing probe postpones the commit by. */
const MAX_DELAY = 48;
/** Steps of no input at all after the gesture, in which the committed outcome plays out. */
const TAIL_STEPS = 60;

/**
 * Where the run is observed, counted from the step the gesture ends on.
 *
 * **Every checkpoint is after the commit, and that is the whole of why they are where they
 * are.** A checkpoint taken while the finger is still down reads the finger: a pointer's
 * live position is quantised at one envelope and a keyboard's cursor is not, so any
 * pre-commit sample says "the pointer is finer" in every game that draws a reticle, which
 * is a fact about the reticle and not about what the player can commit. Sampling only the
 * consequences asks the question the criterion asks — what could this instrument *do*.
 *
 * Several of them, spread wide, because one is not enough: a single late frame catches a
 * thrown blade after it has already settled, and two aims that differed by a whole hook
 * then read as identical. That was measured, on Shuriken, before these were spread.
 */
const CHECKPOINTS: readonly number[] = [1, 4, 8, 14, 22, 32, 45, 59];

/**
 * Knob values per sweep, symmetric about zero.
 *
 * Both instruments get the same count so neither is measured over a longer arm than the
 * other, and the count is bounded because a sweep costs a whole match per sample.
 *
 * Fifty-six envelopes is 28% of the short side of any logical box — a long deliberate drag,
 * and inside the third of the short side `docs/input-idiom.md` caps a trackpad gesture at.
 * Fifty-six steps is a little under a second of holding, which saturates every key rate in
 * the catalogue. The two arms are therefore not the same *reach*, and reach is deliberately
 * not what is compared: this measures how finely each instrument can divide the quantity,
 * which is what "no input family can aim finer than another" asks.
 */
const KNOB_LIMIT = 56;
export const KNOB_VALUES: readonly number[] = Array.from(
  { length: KNOB_LIMIT * 2 + 1 },
  (_, i) => i - KNOB_LIMIT,
);

/**
 * The band of knob values the sensitivity is taken over.
 *
 * Not the whole sweep, and both ends matter. Below the lower bound a drag is still inside
 * the deadzone of the twenty-two games that have one, and neither instrument has said
 * anything yet. Above the upper bound the faster instrument has usually reached the game's
 * own clamp, and a clamped response understates the sensitivity of whichever instrument hit
 * the wall first — which is precisely the one with the coarser step, so including the tail
 * biases the answer towards "equivalent" exactly where it is not.
 */
const BAND_LOW = 6;
const BAND_HIGH = 40;

const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'Space' };

/** Which instrument, and how it spells a knob value. */
export type Family = 'pointer-absolute' | 'pointer-anchored' | 'keyboard' | 'keyboard-tap';
export type Axis = 'x' | 'y';

export interface SweepId {
  readonly family: Family;
  readonly axis: Axis;
}

export const SWEEPS: readonly SweepId[] = [
  { family: 'pointer-absolute', axis: 'x' },
  { family: 'pointer-absolute', axis: 'y' },
  { family: 'pointer-anchored', axis: 'x' },
  { family: 'pointer-anchored', axis: 'y' },
  { family: 'keyboard', axis: 'x' },
  { family: 'keyboard', axis: 'y' },
  { family: 'keyboard-tap', axis: 'x' },
  { family: 'keyboard-tap', axis: 'y' },
];

export function isPointer(family: Family): boolean {
  return family === 'pointer-absolute' || family === 'pointer-anchored';
}

/**
 * A recorded run, as a flat vector of numbers: every draw call of every checkpoint frame,
 * concatenated in order.
 *
 * Every draw call contributes its own numeric arguments plus a small integer for its kind
 * and a hash for each string it carries, so a colour change or a different label is a
 * change in the vector too. Order is the draw order, which a deterministic game repeats
 * exactly, so slot *i* means the same mark of the same checkpoint in every run of the same
 * game.
 */
export type Frame = readonly number[];

/** Cheap, stable string hash. Only equality and inequality are ever asked of it. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Scaled into a small range so a colour change cannot dominate a normalised distance.
  return (h >>> 8) / 0xffffff;
}

/**
 * Rounds a drawn number before it is recorded.
 *
 * Float noise below this is not something any instrument *expressed*; counting it would
 * inflate both instruments' step counts with the same garbage and make the ratio a
 * measurement of rounding. Logical boxes are hundreds of units across, so a ten-thousandth
 * of a unit is far below anything a player or a lattice can name.
 */
function tidy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e4) / 1e4;
}

/**
 * Colour buckets the aggregate half of a frame is grouped by. Four is enough to keep a
 * seat's marks from being summed together with the board's without making the vector large.
 */
const COLOUR_BUCKETS = 4;
/** Draw kinds, 1..10, as pushed below. */
const KINDS = 10;
/** count, sum of x, sum of y, sum of the first size, sum of the second size. */
const STATS = 5;
const AGGREGATE_SLOTS = KINDS * COLOUR_BUCKETS * STATS;

/**
 * The recording renderer: one run becomes one flat vector of numbers.
 *
 * Each checkpoint contributes **two halves**, and the reason for two is worth stating.
 *
 * The natural fingerprint is the draw calls in order, which is exact and very sharp: slot
 * *i* names the same mark in every run of a deterministic game. It is also brittle in the
 * one way that matters here. The moment a game draws *one more thing* at some knob values
 * than at others — a disc that has landed, a dart that has stuck, a star that has been
 * caught — every later slot shifts by a few places, and a slot that means "the disc's x" at
 * one knob value means "the frame's line width" at the next. Read as a series, that mark
 * thrashes, the order filter throws it away, and the game reports as unmeasurable. Four in a
 * Row and Star Catcher both did exactly that.
 *
 * So each checkpoint is summarised first into a **fixed-length aggregate** — per draw kind
 * and coarse colour, the count and the sums of the coordinates and sizes — which no
 * insertion can shift, and which still moves by exactly the amount a mark moved. The
 * positional call list follows it, so a game whose draw list is stable keeps the sharper
 * signal too. The two halves are independent slots and each is filtered on its own merits.
 */
class VectorRenderer implements Renderer {
  readonly out: number[] = [];
  #aggregate = new Float64Array(AGGREGATE_SLOTS);
  #calls: number[] = [];

  #bucket(kind: number, colour: number, x: number, y: number, a: number, b: number): void {
    const slice = Math.min(COLOUR_BUCKETS - 1, Math.floor(colour * COLOUR_BUCKETS));
    const at = ((kind - 1) * COLOUR_BUCKETS + slice) * STATS;
    const sums = this.#aggregate;
    sums[at] = (sums[at] ?? 0) + 1;
    sums[at + 1] = (sums[at + 1] ?? 0) + x;
    sums[at + 2] = (sums[at + 2] ?? 0) + y;
    sums[at + 3] = (sums[at + 3] ?? 0) + a;
    sums[at + 4] = (sums[at + 4] ?? 0) + b;
  }

  #push(kind: number, colour: number, x: number, y: number, a: number, b: number, rest: number[]): void {
    this.#bucket(kind, colour, x, y, a, b);
    this.#calls.push(kind, tidy(x), tidy(y), tidy(a), tidy(b), colour);
    for (const value of rest) this.#calls.push(tidy(value));
  }

  /** Close one checkpoint: the fixed aggregate first, then this frame's call list. */
  seal(): void {
    for (let i = 0; i < AGGREGATE_SLOTS; i += 1) this.out.push(tidy(this.#aggregate[i] ?? 0));
    for (const value of this.#calls) this.out.push(value);
    this.#aggregate = new Float64Array(AGGREGATE_SLOTS);
    this.#calls = [];
  }

  clear(colour: string): void {
    this.#push(1, hashString(colour), 0, 0, 0, 0, []);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push(2, hashString(colour), x, y, width, height, []);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#push(3, hashString(colour), x, y, width, height, [lineWidth]);
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push(4, hashString(colour), x, y, radius, 0, []);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#push(5, hashString(colour), x, y, radius, lineWidth, []);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#push(6, hashString(colour), x1, y1, x2, y2, [lineWidth]);
  }

  text(value: string, x: number, y: number, sizePx: number, colour: string, align?: string): void {
    this.#push(7, hashString(colour), x, y, sizePx, hashString(value), [hashString(align ?? '')]);
  }

  pushSeatRotation(rotated: boolean): void {
    this.#push(8, 0, rotated ? 1 : 0, 0, 0, 0, []);
  }

  pushRotation(radians: number): void {
    this.#push(9, 0, radians, 0, 0, 0, []);
  }

  popSeatRotation(): void {
    this.#push(10, 0, 0, 0, 0, 0, []);
  }
}

/** Where in the surface the sweep is anchored, and how far it may travel, for one seat. */
interface Zone {
  readonly cx: number;
  readonly cy: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function zoneOf(logical: LogicalSize, split: ZoneSplit): Zone {
  const { width: w, height: h } = logical;
  // Seat one is the bottom seat, so it owns the lower half of a horizontal split, the left
  // half of a vertical one, and all of a shared board.
  if (split === 'vertical') {
    return { cx: w * 0.25, cy: h / 2, minX: 1, maxX: w / 2 - 1, minY: 1, maxY: h - 1 };
  }
  if (split === 'shared') {
    return { cx: w / 2, cy: h / 2, minX: 1, maxX: w - 1, minY: 1, maxY: h - 1 };
  }
  return { cx: w / 2, cy: h * 0.75, minX: 1, maxX: w - 1, minY: h / 2 + 1, maxY: h - 1 };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export interface RunOptions {
  /** Knob value, in envelopes for a pointer sweep and in simulation steps for a keyboard one. */
  readonly knob: number;
  /** Steps the action is held for. Sweeps use the shortest window that can express a drag. */
  readonly holdSteps?: number;
  /**
   * Steps the pointer takes to travel from the anchor to its target.
   *
   * 1 is a jump; anything larger is a glide. Only {@link pathIndependence} varies it — every
   * sweep uses a jump, so that a sweep measures the endpoint and nothing else.
   */
  readonly glideSteps?: number;
  /**
   * Steps to postpone the whole gesture by, for {@link timingOf}.
   *
   * When it is set the checkpoints stop following the gesture and sit at fixed absolute steps
   * instead, so that what varies between two runs is *when the commit happened* rather than
   * when it was looked at.
   */
  readonly delaySteps?: number;
  /** Record only the last checkpoint: what a settled board looks like, with no animation in it. */
  readonly lastOnly?: boolean;
}

/**
 * Play one whole match-shaped run and return its checkpoint frames, concatenated.
 *
 * Both seats are human — a bot would answer the knob with a policy of its own, and the
 * point is to hold everything except the instrument fixed.
 */
export function runProbe(
  loaded: LoadedGame,
  sweep: SweepId,
  options: RunOptions,
  seed: number,
): Frame {
  const manifest: GameManifest = loaded.manifest;
  const game: Game = loaded.create();
  const context: GameContext = {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
  };
  game.init(context);

  const logical = manifest.logical;
  const envelope = envelopeFor(logical);
  const declared = manifest.zoneSplit;
  const input = new InputManager(logical, { split: 'horizontal', bottomSeat: 'p1' });
  const view = new InputView();
  const renderer = new VectorRenderer();

  const knob = options.knob;
  const hold = Math.max(2, options.holdSteps ?? SWEEP_HOLD);
  const glide = Math.max(1, options.glideSteps ?? 1);
  const delay = options.delaySteps ?? 0;
  const actionFrom = ACTION_FROM + delay;
  const settledAt = SETTLED_AT + delay;
  const pointerTo = actionFrom + 1;
  const pointerFrom = pointerTo - hold;
  // With a delay in play the checkpoints are pinned to absolute steps, so two runs differ in
  // when the commit landed rather than in when it was looked at.
  const observeFrom = SETTLED_AT + (options.delaySteps === undefined ? 0 : MAX_DELAY);
  const total = observeFrom + TAIL_STEPS;
  const aimFrom = actionFrom - Math.min(Math.abs(knob), AIM_STEPS);

  let pointerDown = false;
  let keyX = 0;
  let keyY = 0;
  let actionDown = false;
  let split: ZoneSplit = 'horizontal';
  let zone = zoneOf(logical, split);
  let mark = 0;

  const setKey = (axis: Axis, want: number): void => {
    const held = axis === 'x' ? keyX : keyY;
    if (held === want) return;
    if (axis === 'x') {
      if (held < 0) input.keyUp(KEYS.left);
      if (held > 0) input.keyUp(KEYS.right);
      if (want < 0) input.keyDown(KEYS.left);
      if (want > 0) input.keyDown(KEYS.right);
      keyX = want;
    } else {
      if (held < 0) input.keyUp(KEYS.up);
      if (held > 0) input.keyUp(KEYS.down);
      if (want < 0) input.keyDown(KEYS.up);
      if (want > 0) input.keyDown(KEYS.down);
      keyY = want;
    }
  };

  const setAction = (want: boolean): void => {
    if (want === actionDown) return;
    if (want) input.keyDown(KEYS.action);
    else input.keyUp(KEYS.action);
    actionDown = want;
  };

  try {
    for (let i = 0; i < total; i += 1) {
      // The split the shell would use, recomputed every step exactly as `GameHost` does:
      // a turn game's board belongs to whoever is to move, and that changes every turn.
      const active = game.getActiveSeat?.() ?? null;
      const wanted = zoneSplitFor('shared-screen', declared, active);
      if (wanted !== split) {
        split = wanted;
        input.setSplit(split);
        zone = zoneOf(logical, split);
      }
      if (split === 'shared') input.setBoardSeat(active ?? 'p1');

      if (sweep.family === 'keyboard-tap') {
        // A held key is the wrong idiom for a cursor. Fifteen games step a `GridCursor` on
        // the *press* and then auto-repeat, so holding for six steps and holding for a
        // hundred and twenty both park it against the far edge and the whole keyboard arm
        // collapses to two outcomes — which is what Four in a Row, Tic Tac Toe and Rock
        // Paper Scissors each reported before this family existed. A player taps. So this
        // family taps: one step down, one step up, repeated, which is the finest thing a
        // keyboard can say to a cursor and the honest arm to compare a tap against.
        const from = actionFrom - 2 * Math.min(Math.abs(knob), AIM_STEPS / 2);
        const within = i >= from && i < actionFrom;
        setKey(sweep.axis, within && (i - from) % 2 === 0 ? Math.sign(knob) : 0);
        setAction(i >= actionFrom && i < settledAt);
      } else if (sweep.family === 'keyboard') {
        // Aim first with a direction key, then commit with the action. The two phases are
        // separate so that the knob varies the aim and *only* the aim: the action is held
        // for the same number of steps at every knob value, so a game that charges while
        // the key is down charges identically across the sweep.
        setKey(sweep.axis, i >= aimFrom && i < actionFrom ? Math.sign(knob) : 0);
        setAction(i >= actionFrom && i < settledAt);
      } else if (i >= pointerFrom && i < pointerTo) {
        // A finger on the glass *is* the action, so a pointer has no separate aim phase.
        // It presses inside the same window the action key is held in and lifts on the same
        // step, which is the only way to give the two instruments equal hold time.
        const anchored = sweep.family === 'pointer-anchored';
        const reached = clamp((i - pointerFrom) / glide, 0, 1);
        const offset = knob * envelope * (anchored ? reached : 1);
        const tx = clamp(zone.cx + (sweep.axis === 'x' ? offset : 0), zone.minX, zone.maxX);
        const ty = clamp(zone.cy + (sweep.axis === 'y' ? offset : 0), zone.minY, zone.maxY);
        if (!pointerDown) {
          // The absolute family presses straight on the target; the anchored family presses
          // on the anchor and pulls away from it, which is the only gesture a virtual stick
          // or a slingshot can read.
          input.pointerDown(1, anchored ? zone.cx : tx, anchored ? zone.cy : ty);
          pointerDown = true;
        } else {
          input.pointerMove(1, tx, ty);
        }
      } else if (pointerDown) {
        input.pointerUp(1);
        pointerDown = false;
      }

      game.update(STEP, view.sync(input.beginStep(STEP)));

      if (mark < CHECKPOINTS.length && i === observeFrom + CHECKPOINTS[mark]!) {
        if (!options.lastOnly || mark === CHECKPOINTS.length - 1) {
          game.render(renderer, 0);
          renderer.seal();
        }
        mark += 1;
      }
    }
    return renderer.out.slice();
  } finally {
    game.destroy();
  }
}

/** Everything one sweep produced: one run per knob value, in knob order. */
export interface Sweep {
  readonly id: SweepId;
  readonly knobs: readonly number[];
  readonly frames: readonly Frame[];
}

export function runSweep(loaded: LoadedGame, id: SweepId, seed: number): Sweep {
  const frames: Frame[] = [];
  for (const knob of KNOB_VALUES) frames.push(runProbe(loaded, id, { knob }, seed));
  return { id, knobs: KNOB_VALUES, frames };
}

export function nameOf(id: SweepId): string {
  return `${id.family}/${id.axis}`;
}

function same(a: Frame, b: Frame): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * How one instrument moved one drawn mark across a sweep: the values it visited, in knob
 * order, plus the two summaries the comparison needs.
 *
 * `order` is the range divided by the total variation, in (0, 1]. One means the mark walked
 * one way and never turned back — the knob names it. Near zero means it thrashed across the
 * same range many times over, which is what a struck puck, a felled cane or a re-dealt board
 * does, and such a mark carries no information about *resolution* at all: its step size is
 * set by the chaos, not by the instrument. Filtering on this is what separates "the pointer
 * can aim finer" from "the outcome is sensitive to everything" — without it Shuriken reads
 * 1.06, because nine hundred marks of rearranged bamboo drown the dozen tracking the blade.
 */
interface SlotTrace {
  readonly values: readonly number[];
  /** Whether each value continues the previous knob by exactly one; the band has a hole. */
  readonly adjacent: readonly boolean[];
  readonly low: number;
  readonly high: number;
  readonly order: number;
}

function traceFor(sweep: Sweep, band: readonly number[], slot: number): SlotTrace {
  const values: number[] = [];
  const adjacent: boolean[] = [];
  let low = Infinity;
  let high = -Infinity;
  let variation = 0;
  for (let i = 0; i < band.length; i += 1) {
    const index = band[i]!;
    const value = sweep.frames[index]![slot] ?? 0;
    values.push(value);
    if (value < low) low = value;
    if (value > high) high = value;
    const near = i > 0 && sweep.knobs[index]! - sweep.knobs[band[i - 1]!]! === 1;
    adjacent.push(near);
    if (near) variation += Math.abs(value - values[i - 1]!);
  }
  const range = Number.isFinite(low) ? high - low : 0;
  return { values, adjacent, low, high, order: variation > 0 ? range / variation : 0 };
}

/** A mark whose whole range is below this is noise in the last digit, not an expression. */
const MIN_RANGE = 1e-3;
/** Both instruments must cover this share of a mark's pooled range before it is compared. */
const MOVED_FRACTION = 0.02;
/** Fewer shared marks than this and the "common observable" is a coincidence, not a quantity. */
const MIN_SHARED_SLOTS = 4;
/**
 * How orderly a mark's response must be, for both instruments, before it is used.
 *
 * Two thirds: the mark may double back over a third of its travel and still be read as
 * tracking the knob. Below that it is not resolving anything, it is reacting.
 */
const MIN_ORDER = 0.66;

/**
 * Distance between two runs over the shared marks, each scaled to its range and each sweep
 * shifted onto its own centre.
 *
 * The centring is not cosmetic. The two instruments do not commit on the same step — a
 * keyboard fires on `actionPressed` and a pointer on `actionReleased`, three steps apart in
 * every drag-and-release game in the catalogue — so the keyboard arm's whole trace sits a
 * few steps further along its consequences than the pointer arm's. That is a **constant
 * offset between the arms**, and it puts a floor under the raw residual: Shuriken could not
 * match at all, because no pointer knob reproduced a keyboard outcome to better than 1.6
 * grains however well the two lattices lined up. Subtracting each sweep's own median removes
 * the offset and leaves the shape, which is the thing being calibrated.
 */
function distance(
  a: Frame,
  b: Frame,
  slots: readonly number[],
  scale: readonly number[],
  centreA: readonly number[],
  centreB: readonly number[],
): number {
  let sum = 0;
  for (const slot of slots) {
    const d =
      ((a[slot] ?? 0) - centreA[slot]! - ((b[slot] ?? 0) - centreB[slot]!)) / scale[slot]!;
    sum += d * d;
  }
  return Math.sqrt(sum / slots.length);
}

/** The middle value each shared mark took over a sweep's band, used to centre it. */
function centreOf(sweep: Sweep, band: readonly number[], slots: readonly number[]): number[] {
  const centre: number[] = [];
  const scratch: number[] = [];
  for (const slot of slots) {
    scratch.length = 0;
    for (const index of band) scratch.push(sweep.frames[index]![slot] ?? 0);
    centre[slot] = median(scratch);
  }
  return centre;
}

export interface PairMeasure {
  readonly pointer: SweepId;
  readonly keyboard: SweepId;
  /** Drawn marks both instruments move in an orderly way. */
  readonly slots: number;
  /** Keyboard knob values whose outcome the pointer could match closely enough to calibrate. */
  readonly matched: number;
  /**
   * Pointer increments per keyboard increment. Above 1, the pointer resolves finer: it takes
   * that many of its own smallest steps to cover what the keyboard covers in one of its.
   */
  readonly factor: number;
  /** Ratio of the quartiles of the individual slope estimates. Near 1 is a clean fit. */
  readonly spread: number;
}

/**
 * Calibrate the two instruments' knobs against each other, and read off the ratio.
 *
 * This is the heart of the harness and it is worth saying why it is a *matching* rather than
 * a comparison of step sizes. What the renderer shows is `f(quantity)` for some unknown,
 * non-linear `f` — an aim sweeping 0.05 to 0.34 radians and one sweeping 0.12 to 0.77 move a
 * blade at quite different rates per radian. Two step sizes measured over different stretches
 * of `f` therefore differ for a reason that has nothing to do with either lattice, and both
 * earlier versions of this file were fooled by exactly that: pooled distances put Shuriken at
 * 1.06 and per-mark step ratios put it at 3.03 and then 5.68, against the 2.1 its own two
 * constants imply.
 *
 * So: for each keyboard knob, find the pointer knob whose *outcome* is nearest. Every `f`
 * cancels, because the two runs being matched are two spellings of the same game state. The
 * matching is done on the whole shared mark set at once rather than mark by mark, which is
 * also the validity check the earlier versions lacked — when a pointer sweep drives two
 * quantities and a keyboard sweep drives one of them, no pointer knob reproduces the
 * keyboard's outcome, the residual stays large, and the pair is discarded instead of
 * yielding a confident wrong number.
 *
 * The slope of that matching is the answer: how many envelopes of finger travel it takes to
 * say what one step of a held key says. Two means the pointer can stop at two values for
 * every one the keyboard can reach, which is a difference in *what is reachable* and not in
 * how well either player plays.
 */
/** Why a pair produced no ratio, for the report to say something better than "no". */
export interface PairDiagnosis {
  readonly slots: number;
  /** Marks rejected for never moving, for one instrument ignoring them, and for thrashing. */
  readonly still: number;
  readonly onesided: number;
  readonly chaotic: number;
  readonly grain: number;
  readonly matched: number;
  readonly bestResidual: number;
  readonly slopes: number;
  readonly stop: string;
}

export function comparePair(pointer: Sweep, keyboard: Sweep): PairMeasure | null {
  return measurePair(pointer, keyboard).measure;
}

export function diagnosePair(pointer: Sweep, keyboard: Sweep): PairDiagnosis {
  return measurePair(pointer, keyboard).diagnosis;
}

function measurePair(
  pointer: Sweep,
  keyboard: Sweep,
): { measure: PairMeasure | null; diagnosis: PairDiagnosis } {
  const band: number[] = [];
  for (let i = 0; i < KNOB_VALUES.length; i += 1) {
    const magnitude = Math.abs(KNOB_VALUES[i]!);
    if (magnitude >= BAND_LOW && magnitude <= BAND_HIGH) band.push(i);
  }

  let length = 0;
  for (const frame of pointer.frames) if (frame.length > length) length = frame.length;
  for (const frame of keyboard.frames) if (frame.length > length) length = frame.length;

  const slots: number[] = [];
  const scale: number[] = new Array<number>(length).fill(1);
  let still = 0;
  let onesided = 0;
  let chaotic = 0;
  for (let slot = 0; slot < length; slot += 1) {
    const p = traceFor(pointer, band, slot);
    const k = traceFor(keyboard, band, slot);
    const pRange = p.high - p.low;
    const kRange = k.high - k.low;
    const pooled = Math.max(pRange, kRange);
    if (pooled < MIN_RANGE) {
      still += 1;
      continue;
    }
    if (pRange < pooled * MOVED_FRACTION || kRange < pooled * MOVED_FRACTION) {
      onesided += 1;
      continue;
    }
    if (p.order < MIN_ORDER || k.order < MIN_ORDER) {
      chaotic += 1;
      continue;
    }
    slots.push(slot);
    scale[slot] = pooled;
  }
  const fail = (stop: string, extra?: Partial<PairDiagnosis>): {
    measure: null;
    diagnosis: PairDiagnosis;
  } => ({
    measure: null,
    diagnosis: {
      slots: slots.length,
      still,
      onesided,
      chaotic,
      grain: 0,
      matched: 0,
      bestResidual: Infinity,
      slopes: 0,
      stop,
      ...extra,
    },
  });
  if (slots.length < MIN_SHARED_SLOTS) return fail('too few shared marks');

  // How close two neighbouring keyboard knobs sit. Nothing can be matched finer than this,
  // so it is also the tolerance a match has to meet to count as one.
  const pointerCentre = centreOf(pointer, band, slots);
  const keyboardCentre = centreOf(keyboard, band, slots);

  const grains: number[] = [];
  for (let i = 1; i < KNOB_VALUES.length; i += 1) {
    if (Math.abs(KNOB_VALUES[i]!) > BAND_HIGH || Math.abs(KNOB_VALUES[i]!) < BAND_LOW) continue;
    if (KNOB_VALUES[i]! - KNOB_VALUES[i - 1]! !== 1) continue;
    grains.push(
      distance(
        keyboard.frames[i]!,
        keyboard.frames[i - 1]!,
        slots,
        scale,
        keyboardCentre,
        keyboardCentre,
      ),
    );
  }
  const grain = median(grains.filter((g) => g > 0));
  if (grain <= 0) return fail('the keyboard sweep stood still between neighbouring knobs');

  // For each keyboard knob, the pointer knob that reproduces its outcome most closely.
  const keys: number[] = [];
  const found: number[] = [];
  let closest = Infinity;
  for (const index of band) {
    let bestAt = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < pointer.frames.length; j += 1) {
      const d = distance(
        keyboard.frames[index]!,
        pointer.frames[j]!,
        slots,
        scale,
        keyboardCentre,
        pointerCentre,
      );
      if (d < bestDistance) {
        bestDistance = d;
        bestAt = j;
      }
    }
    if (bestDistance < closest) closest = bestDistance;
    // The pointer must have landed inside a keyboard grain of the outcome. Nothing can be
    // matched finer than the keyboard's own step, so this is the loosest tolerance that still
    // means "the same value". A scale-free version was tried — accept whatever the pointer
    // got closest to, provided it was much closer than a pointer run usually gets — and it
    // matched everything to everything: Pool came out at 15x, Mini Golf at 29x and Shuriken
    // reversed direction. When two arms genuinely never reproduce each other's outcomes, the
    // honest answer is that they cannot be calibrated, not a confident number.
    if (bestDistance > grain * MATCH_TOLERANCE) continue;
    // A match pinned to the end of the pointer's reach is a saturation, not a calibration.
    if (bestAt <= 0 || bestAt >= pointer.frames.length - 1) continue;
    keys.push(keyboard.knobs[index]!);
    found.push(pointer.knobs[bestAt]!);
  }
  if (keys.length < MIN_MATCHED) {
    return fail('the pointer never reproduced the keyboard outcome', {
      grain,
      matched: keys.length,
      bestResidual: closest,
    });
  }

  const slopes: number[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const run = keys[j]! - keys[i]!;
      // Widely separated pairs only: two neighbouring matches differ by an integer number of
      // envelopes, so a short baseline quantises the slope into uselessness.
      if (run < SLOPE_BASELINE) continue;
      slopes.push(Math.abs((found[j]! - found[i]!) / run));
    }
  }
  const usable = slopes.filter((slope) => slope > 0);
  if (usable.length < MIN_SHARED_SLOTS) {
    return fail('the matches were too bunched to read a slope from', {
      grain,
      matched: keys.length,
      bestResidual: closest,
      slopes: usable.length,
    });
  }

  // The matching must be a *line*, not a cloud. Without this a keyboard sweep whose outcomes
  // the pointer never really reproduces still finds a nearest neighbour for each knob, and
  // the median of a cloud of slopes is a confident number about nothing: it put Archery at
  // 12x and Money Grabber at 36x, both by pairing a pointer x sweep against a keyboard y one
  // and calling the coincidence a calibration.
  if (Math.abs(correlation(keys, found)) < MIN_CORRELATION) {
    return fail('the matched knobs did not line up, so the calibration is a coincidence', {
      grain,
      matched: keys.length,
      bestResidual: closest,
      slopes: usable.length,
    });
  }

  const sorted = [...usable].sort((a, b) => a - b);
  const quarter = sorted[Math.floor(sorted.length * 0.25)]!;
  const threeQuarters = sorted[Math.floor(sorted.length * 0.75)]!;
  return {
    measure: {
      pointer: pointer.id,
      keyboard: keyboard.id,
      slots: slots.length,
      matched: keys.length,
      factor: median(usable),
      spread: quarter > 0 ? threeQuarters / quarter : Infinity,
    },
    diagnosis: {
      slots: slots.length,
      still,
      onesided,
      chaotic,
      grain,
      matched: keys.length,
      bestResidual: closest,
      slopes: usable.length,
      stop: 'measured',
    },
  };
}

/** How many keyboard grains a matched pointer run may sit away and still count as matched. */
const MATCH_TOLERANCE = 3;
/** Keyboard knobs that must find a match before a slope is fitted at all. */
const MIN_MATCHED = 16;
/** The shortest keyboard baseline a slope may be read over, in keyboard steps. */
const SLOPE_BASELINE = 6;
/** How straight the matched knobs must lie before their slope is believed. */
const MIN_CORRELATION = 0.95;

/** Pearson correlation, for asking whether a matching is a line. */
function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let top = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    top += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? top / Math.sqrt(va * vb) : 0;
}

/** Samples in a reach sweep. Coarse on purpose: it counts targets, it does not resolve them. */
const REACH_SAMPLES = 49;

export interface Reach {
  readonly pointer: number;
  readonly keyboard: number;
  /** Outcomes one instrument reached and the other never did, each way round. */
  readonly pointerOnly: number;
  readonly keyboardOnly: number;
}

/** Distinct settled outcomes across one coarse sweep of a whole range. */
function outcomesOf(
  loaded: LoadedGame,
  id: SweepId,
  span: number,
  seed: number,
): readonly Frame[] {
  const seen: Frame[] = [];
  const half = (REACH_SAMPLES - 1) / 2;
  for (let i = 0; i < REACH_SAMPLES; i += 1) {
    // Odd sample count and a symmetric stride, so the middle sample is exactly zero. With an
    // even count it was not, and a three-cell row measured as two: the centre cell is the one
    // a sweep that never stops at the origin can never name.
    const knob = Math.round(((i - half) * span) / half);
    // The last checkpoint only. Two instruments commit a step apart, so any earlier frame
    // catches the same board mid-animation at two different phases and every outcome looks
    // unique; by the last one a settled board has settled and two routes to the same move
    // are the same frame, which is what makes the two sets comparable at all.
    const frame = runProbe(loaded, id, { knob, lastOnly: true }, seed);
    if (!seen.some((other) => same(other, frame))) seen.push(frame);
  }
  return seen;
}

/**
 * The outcomes each instrument can reach *at all*, over its whole range, as sets.
 *
 * This is the other half of criterion 1, and the half a granularity ratio cannot answer.
 * Where a game's outcome is a small discrete set — a column, a cell, a lane, one of three
 * buttons — there is no scalar to resolve finely and the calibration measures nothing. What
 * matters instead is whether both instruments can name every member of the set, which is a
 * *set* comparison and is stronger than any distribution: an instrument that reaches five of
 * seven columns is unfair in a way no number of matches would average away.
 *
 * The pointer arm sweeps its whole zone rather than the band the calibration uses, in both
 * the absolute and the anchored idiom, because a game that reads a drag rather than a press
 * has no reach at all in absolute terms and reporting that as "the pointer cannot play this"
 * would be false. The keyboard arm both holds and taps, for the reason `keyboard-tap` exists.
 */
export function reachOf(loaded: LoadedGame, seed: number): Reach {
  const { width, height } = loaded.manifest.logical;
  // envelopeFor is min/200, so this many envelopes spans the longest reach any zone has.
  const limit = Math.ceil((100 * Math.max(width, height)) / Math.min(width, height));
  let pointer: readonly Frame[] = [];
  let keyboard: readonly Frame[] = [];
  const widest = (best: readonly Frame[], id: SweepId, span: number): readonly Frame[] => {
    const found = outcomesOf(loaded, id, span, seed);
    return found.length > best.length ? found : best;
  };
  for (const axis of ['x', 'y'] as const) {
    pointer = widest(pointer, { family: 'pointer-absolute', axis }, limit);
    pointer = widest(pointer, { family: 'pointer-anchored', axis }, limit);
    keyboard = widest(keyboard, { family: 'keyboard', axis }, AIM_STEPS);
    keyboard = widest(keyboard, { family: 'keyboard-tap', axis }, AIM_STEPS / 2);
  }
  const missing = (from: readonly Frame[], within: readonly Frame[]): number =>
    from.filter((frame) => !within.some((other) => same(other, frame))).length;
  return {
    pointer: pointer.length,
    keyboard: keyboard.length,
    pointerOnly: missing(pointer, keyboard),
    keyboardOnly: missing(keyboard, pointer),
  };
}

/**
 * How finely each instrument can choose *when* it commits.
 *
 * The six timing games in the `turn-aim` archetype — basketball, cannon-duel, cup-pong,
 * hammer-hit, knife-thrower, sling-puck — have no aim in them at all. They ask the player to
 * stop a moving needle, so neither where the finger is nor how long it stays changes
 * anything, and both of the sweeps above correctly report that they express nothing. That
 * reads as "unmeasurable", and it is not: what those games read is a step number, and a step
 * number is the one quantity the two instruments are guaranteed to share, because the
 * simulation gives them both exactly one commit per fixed step and no more.
 *
 * So this varies *when*: the same gesture, postponed by a growing number of steps, observed
 * at a fixed absolute frame. Equal counts are the evidence that neither instrument can pick a
 * moment the other cannot.
 */
export function timingOf(loaded: LoadedGame, seed: number): Reach {
  const count = (id: SweepId): readonly Frame[] => {
    const seen: Frame[] = [];
    for (let delay = 0; delay < MAX_DELAY; delay += 1) {
      const frame = runProbe(loaded, id, { knob: 0, delaySteps: delay, lastOnly: true }, seed);
      if (!seen.some((other) => same(other, frame))) seen.push(frame);
    }
    return seen;
  };
  const pointer = count({ family: 'pointer-absolute', axis: 'x' });
  const keyboard = count({ family: 'keyboard', axis: 'x' });
  const missing = (from: readonly Frame[], within: readonly Frame[]): number =>
    from.filter((frame) => !within.some((other) => same(other, frame))).length;
  return {
    pointer: pointer.length,
    keyboard: keyboard.length,
    pointerOnly: missing(pointer, keyboard),
    keyboardOnly: missing(keyboard, pointer),
  };
}

/** Steps the pointer is held down for during the path test. Long enough for a real glide. */
const PATH_HOLD = 60;
/** Which knob the path test is run at. Far enough out to matter, inside every zone. */
const PATH_KNOB = 40;

export interface PathResult {
  readonly aimed: boolean;
  /** Which axis answered a jump and a glide identically, if either did. */
  readonly axis: Axis | null;
}

/**
 * Whether the pointer names a value or accumulates one.
 *
 * The same gesture, the same endpoint, the same press step and the same release step — once
 * as a jump and once as a glide across the whole hold. An *aimed* quantity reads where the
 * finger ended and commits identically both times; an *integrated* one has been accumulating
 * the whole way and does not.
 *
 * This is the discriminator issue #2478 got wrong by reading the source. It claimed
 * Shuriken's spin was bound to pointer *velocity* — it is written as a per-step delta, so
 * that is exactly what the code looks like — and the deltas telescope to net displacement,
 * so a 300-unit drag gives the same spin over 3 frames as over 120. Measurement says aimed;
 * reading said velocity; measurement was right.
 *
 * A game that ignores the pointer altogether is trivially identical under both, so the
 * gesture must also have *done* something relative to no gesture at all.
 */
export function pathIndependence(loaded: LoadedGame, seed: number): PathResult {
  for (const axis of ['x', 'y'] as const) {
    const id: SweepId = { family: 'pointer-anchored', axis };
    const held = { knob: PATH_KNOB, holdSteps: PATH_HOLD };
    const jump = runProbe(loaded, id, { ...held, glideSteps: 1 }, seed);
    const glide = runProbe(loaded, id, { ...held, glideSteps: PATH_HOLD - 1 }, seed);
    if (!same(jump, glide)) continue;
    const idle = runProbe(loaded, id, { knob: 0, holdSteps: PATH_HOLD, glideSteps: 1 }, seed);
    if (!same(jump, idle)) return { aimed: true, axis };
  }
  return { aimed: false, axis: null };
}

export type Verdict = 'A' | 'B' | 'C' | 'D';

export interface GameReport {
  readonly slug: string;
  readonly archetype: string;
  readonly verdict: Verdict;
  /** The largest resolution or reach gap found, either way round. 1 means equivalent. */
  readonly factor: number;
  readonly direction: 'pointer' | 'keyboard' | 'none';
  readonly aimed: boolean;
  readonly reach: Reach;
  readonly timing: Reach | null;
  readonly best: PairMeasure | null;
  readonly note: string;
}

/** Above this, one instrument can select values the other cannot, and it is worth naming. */
export const GAP_THRESHOLD = 1.5;
/**
 * A pair whose slope estimates disagree by more than this between their quartiles is not
 * tracking one quantity, and its median is an average of unrelated things.
 */
const MAX_SPREAD = 1.6;
/**
 * At or below this many distinguishable outcomes, the game is offering a *choice from a list*
 * rather than a scalar to aim, and the question becomes reach rather than resolution.
 *
 * Sixteen: the widest board any single sweep crosses here is a seven-column grid, and every
 * aimed or real-time game measures in the thirties or above. Nothing in the catalogue sits
 * near the boundary, which is the only reason a bare constant is safe.
 */
const DISCRETE_MAX = 16;
/** Below this, a sweep did not reach the game at all and nothing has been measured by it. */
const MIN_REACH = 3;
/**
 * Reach a game must give *both* instruments before a difference between them is called a
 * finding rather than a limitation of the gesture.
 *
 * Sitting on the floor is not evidence. Chess and Checkers need a tap to select and a second
 * to move, and Tanks and Broken Tiles read a drag rather than a press: all four gave the
 * pointer arm exactly three outcomes against the keyboard's eight to fifteen, which says
 * only that one gesture reached the game and the other did not.
 */
const TRUSTED_REACH = 5;

export function assess(loaded: LoadedGame, slug: string, seed: number): GameReport {
  const archetype = loaded.manifest.archetype;
  const pointers: Sweep[] = [];
  const keyboards: Sweep[] = [];
  for (const id of SWEEPS) {
    const sweep = runSweep(loaded, id, seed);
    (isPointer(id.family) ? pointers : keyboards).push(sweep);
  }

  let best: PairMeasure | null = null;
  let gap = 1;
  let scattered = 0;
  for (const p of pointers) {
    for (const k of keyboards) {
      const pair = comparePair(p, k);
      if (pair === null) continue;
      if (pair.spread > MAX_SPREAD) {
        scattered += 1;
        continue;
      }
      const here = Math.max(pair.factor, 1 / pair.factor);
      if (best === null || here > gap) {
        best = pair;
        gap = here;
      }
    }
  }

  const reach = reachOf(loaded, seed);
  const path = pathIndependence(loaded, seed);
  const both = Math.min(reach.pointer, reach.keyboard);
  const either = Math.max(reach.pointer, reach.keyboard);

  // Neither where the finger went nor how long a key was held changed anything. That is not
  // a failure to measure: it is what a timing game looks like from here, and the quantity it
  // reads — which step the commit landed on — is measured directly rather than assumed.
  const timing = either < MIN_REACH ? timingOf(loaded, seed) : null;
  const base = { slug, archetype, aimed: path.aimed, reach, timing };

  if (timing !== null) {
    const felt = Math.min(timing.pointer, timing.keyboard);
    if (felt < MIN_REACH) {
      return {
        ...base,
        verdict: 'D',
        factor: 1,
        direction: 'none',
        best: null,
        note: 'the generic gesture changed nothing at all: not by position, not by hold, not by moment',
      };
    }
    const wide = Math.max(
      timing.pointer / timing.keyboard,
      timing.keyboard / timing.pointer,
    );
    if (wide >= GAP_THRESHOLD) {
      return {
        ...base,
        verdict: 'B',
        factor: wide,
        direction: timing.pointer > timing.keyboard ? 'pointer' : 'keyboard',
        best: null,
        note: `a timing game whose two instruments do not resolve the moment alike (${timing.pointer} against ${timing.keyboard})`,
      };
    }
    return {
      ...base,
      verdict: 'C',
      factor: wide,
      direction: 'none',
      best: null,
      note: `no aimed scalar: nothing is aimed and the commit is a moment, resolved on the fixed step by both instruments alike (${timing.pointer} against ${timing.keyboard})`,
    };
  }

  if (both < MIN_REACH) {
    // One instrument names outcomes and the other names none. Either it genuinely cannot
    // express this game, or the generic gesture is not the gesture it wants — and the two
    // cannot be told apart from here, which is what D is for.
    const deaf = reach.pointer < MIN_REACH ? 'the pointer' : 'the keyboard';
    return {
      ...base,
      verdict: 'D',
      factor: 1,
      direction: 'none',
      best: null,
      note: `${deaf} reached ${Math.min(reach.pointer, reach.keyboard)} outcomes against the other's ${either}, so the generic gesture is the suspect and not the game`,
    };
  }

  // The discrete branch. A column, a cell, a lane or one of three buttons is not a scalar
  // anybody aims: there is nothing between two targets to be excluded from. What can still go
  // wrong is *reach*, so the two outcome sets are compared as sets.
  if (either <= DISCRETE_MAX) {
    const targets = `${reach.pointer} against ${reach.keyboard}`;
    const wide = Math.max(reach.pointer / reach.keyboard, reach.keyboard / reach.pointer);
    if (wide >= GAP_THRESHOLD && both < TRUSTED_REACH) {
      return {
        ...base,
        verdict: 'D',
        factor: 1,
        direction: 'none',
        best,
        note: `discrete targets, but one instrument reached only ${both} of them (${targets}), which indicts the generic gesture rather than the game`,
      };
    }
    if (wide >= GAP_THRESHOLD) {
      return {
        ...base,
        verdict: 'B',
        factor: wide,
        direction: reach.pointer > reach.keyboard ? 'pointer' : 'keyboard',
        best,
        note: `discrete targets, and the two instruments reach different numbers of them (${targets}; ${reach.pointerOnly} pointer-only, ${reach.keyboardOnly} keyboard-only)`,
      };
    }
    return {
      ...base,
      verdict: 'C',
      factor: wide,
      direction: 'none',
      best,
      note: `no aimed scalar: the outcome is one of a handful of discrete targets and both instruments reach them (${targets})`,
    };
  }

  if (!path.aimed) {
    return {
      ...base,
      verdict: 'C',
      factor: best === null ? 1 : gap,
      direction: 'none',
      best,
      note: 'no aimed scalar: what the pointer drives is integrated, so both instruments accumulate it rather than selecting it',
    };
  }

  if (best === null) {
    // Say which wall the calibration hit rather than only that it did. The pair with the most
    // shared marks is the one that came closest to being a measurement, so its diagnosis is
    // the one worth reporting — this is the note somebody closing a D will start from.
    let closest: PairDiagnosis | null = null;
    for (const p of pointers) {
      for (const k of keyboards) {
        const seen = diagnosePair(p, k);
        if (closest === null || seen.slots > closest.slots) closest = seen;
      }
    }
    return {
      ...base,
      verdict: 'D',
      factor: 1,
      direction: 'none',
      best: null,
      note:
        scattered > 0
          ? `aimed, but all ${scattered} comparable pairs scattered past ${MAX_SPREAD}x between quartiles`
          : `aimed, but the two knobs could not be calibrated against each other: ${closest?.stop ?? 'no pair had anything in common'}`,
    };
  }

  const direction = best.factor >= 1 ? 'pointer' : 'keyboard';
  if (gap >= GAP_THRESHOLD) {
    return {
      ...base,
      verdict: 'B',
      factor: gap,
      direction,
      best,
      note: `${direction} resolves ${gap.toFixed(2)}x finer (${nameOf(best.pointer)} calibrated against ${nameOf(best.keyboard)} over ${best.matched} knobs)`,
    };
  }
  return {
    ...base,
    verdict: 'A',
    factor: gap,
    direction: 'none',
    best,
    note: `equivalent within ${GAP_THRESHOLD}x (measured ${gap.toFixed(2)}x over ${best.matched} calibrated knobs)`,
  };
}
