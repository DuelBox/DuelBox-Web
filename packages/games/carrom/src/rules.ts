import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Carrom, as pure rules.
 *
 * Nine-a-side on a real board; six a side here. A rosette of pucks sits in the middle with
 * the queen at its heart, and each player flicks a heavier striker from their own baseline.
 * Pot one of yours and you shoot again. Clear all six and the frame is yours — but the queen
 * has to be off the board and *covered* before your last puck may go down.
 *
 * Two things make this a different problem from Pool rather than a re-skin of it.
 *
 * **The shooter places their own striker.** A pool player is handed the cue ball where it
 * lies; a carrom player slides the striker anywhere along their baseline first. So a shot is
 * three numbers, not two — where, which way, how hard — and the bot has to search the
 * placement as well as the line.
 *
 * **Everything is stated in seat space.** The baseline, the slide and the aim angle are all
 * measured from the shooter's own side of the board, and the board is exactly antisymmetric
 * under a half turn: rotate the opening position 180 degrees and it is the same position
 * with the colours swapped. That is what makes the two seats provably equal rather than
 * approximately equal, and `mirror()` in the tests is the assertion of it.
 *
 * No rendering, no timing, no DOM.
 */

/** The logical box the manifest declares. Everything below is inside it. */
export const BOARD_X = 30;
export const BOARD_Y = 120;
/** Square, as a carrom board is. Centred in the logical box so a half turn is a no-op. */
export const BOARD_SIZE = 660;
/** The wooden frame, measured in from the board edge. */
export const FRAME = 34;

export const SURFACE_LEFT = BOARD_X + FRAME;
export const SURFACE_TOP = BOARD_Y + FRAME;
export const SURFACE_RIGHT = BOARD_X + BOARD_SIZE - FRAME;
export const SURFACE_BOTTOM = BOARD_Y + BOARD_SIZE - FRAME;
export const CENTRE_X = BOARD_X + BOARD_SIZE / 2;
export const CENTRE_Y = BOARD_Y + BOARD_SIZE / 2;

export const PUCK_RADIUS = 17;
export const STRIKER_RADIUS = 22;
/**
 * How far from each corner the rails stop, and therefore how wide a pocket is.
 *
 * A carrom pocket is a hole cut *into* the corner of the bed, so the rails do not meet: they
 * end short and leave a mouth. Modelling it any other way does not work, and the failure is
 * not subtle. With rails running right into the corner and a circular capture zone, a puck
 * struck perfectly at the pocket is deflected by whichever rail it reaches first — a couple
 * of units off the diagonal is enough — and skids away along it. Measured with a bot aiming
 * the exact ghost-ball line and zero error: 46 of 190 open shots dropped, with the departure
 * angle correct to three decimal places on every one of them. The pocket was not missing the
 * puck; the rail was taking it away first.
 *
 * So each rail stops `POCKET_MOUTH` short of the corner, and anything that reaches the square
 * that leaves is in. A puck running down a rail into a corner drops too, which is carrom.
 * Forty units against a 34-unit puck is a real board's proportions, and the same 190 shots
 * then dropped 152.
 *
 * The mouth is also what keeps a body from escaping: the rails are open only over the square
 * that pots whatever enters it, in the same sub-step, so there is no gap to leak through.
 */
export const POCKET_MOUTH = 40;

/** A carrom striker is heavier than a puck, and the whole feel of the game rests on it. */
export const PUCK_MASS = 1;
export const STRIKER_MASS = 2;

export const STRIKER_MAX_SPEED = 1200;
/**
 * Deceleration in units per second squared, the same whatever the speed.
 *
 * **Coulomb friction, not drag.** A coin sliding on a powdered board is held back by a force
 * that does not care how fast it is going, so it loses speed at a constant rate and stops
 * dead rather than creeping to a halt. Pool's exponential decay is right for a ball rolling
 * on cloth and wrong here, and it is wrong in a way that ruins the game: an exponential loses
 * most of its speed in the first third of the journey, so a puck struck squarely at the far
 * corner stopped two hundred units short of it and nothing was ever potted.
 *
 * It is also the better-behaved integration. Speed falls linearly and the travel over a step
 * is written as its exact integral, `(v − ½at)·t`, with the last part-step covering the exact
 * `v²/2a` that is left — so the total roll is the same number at 60, 90, 120 and 240 Hz and
 * at any number of sub-steps, rather than drifting by the `½at²` a plain `v·t` throws away
 * every step. A per-step multiplier could not survive a change of frame rate at all without
 * its matching analytic power, and would still only ever approach zero.
 */
export const FRICTION = 340;

/**
 * How far a stroke of full power carries, in units: `v² / 2a`, exactly.
 *
 * The point of a constant deceleration is that this number exists. 2118 units against a
 * 592-unit bed is two and a half diagonals, so power is a real choice — a soft stroke dies
 * where it is aimed and a hard one comes back off two rails — and a player can learn the
 * relationship because there is one.
 */
export const MAX_ROLL_DISTANCE = (STRIKER_MAX_SPEED * STRIKER_MAX_SPEED) / (2 * FRICTION);

/**
 * The power that carries the striker `distance` units, if nothing is in the way.
 *
 * The inverse of `d = v²/2a`. Exact rather than fitted, which is the third thing the
 * constant deceleration buys: weight is learnable, by a person and by a bot.
 */
export function powerForDistance(distance: number): number {
  const wanted = clamp(distance, 0, MAX_ROLL_DISTANCE);
  return Math.sqrt(2 * FRICTION * wanted) / STRIKER_MAX_SPEED;
}

/** The frame is wood, not a cushion: it gives back much less than a pool table does. */
export const FRAME_BOUNCE = 0.62;
export const PUCK_BOUNCE = 0.94;

/** How far the baseline sits from the centre, on the shooter's side. */
export const BASE_DISTANCE = 218;
/** How far either way along the baseline the striker may slide. */
export const BASE_HALF = 200;
/** The widest angle off straight-ahead a shot may be aimed, about 66 degrees. */
export const MAX_AIM = 1.15;

export const PUCKS_PER_SIDE = 6;

/**
 * Consecutive strokes gaining nothing before the frame is called.
 *
 * Twenty-four, which is twelve visits each. Carrom reaches positions neither side can clear —
 * pucks flat against a rail with the queen still out — and nothing else in this project ends
 * a frame: `roundSeconds` prints "about 2 min" on a catalogue card and is enforced nowhere.
 * An unwinnable position would otherwise be an unwinnable *match*.
 *
 * Sixteen was the first number and it was too few, which only measuring showed. The weakest
 * tier pots on about one stroke in twelve, so a run of sixteen dry strokes happens by bad
 * luck alone a quarter of the time, and the rule was ending three easy frames in four on a
 * board that was perfectly playable — `normal` against itself drew a fifth of its frames.
 * Twenty-four halved that (20% to 8%) and costs nothing, because it is `SHOT_LIMIT` and not
 * this number that bounds how long a frame can run.
 */
export const STALEMATE_SHOTS = 24;

/**
 * The hard ceiling on a frame, in strokes.
 *
 * The stalemate rule above only fires on a *run* of dead strokes; a pair of weak bots that
 * pots something every seventh stroke never triggers it and would grind on past the ten
 * simulated minutes the termination guard allows. This is the belt to the stalemate rule's
 * braces, and it is the number the whole termination argument rests on:
 * `SHOT_LIMIT × (MAX_ROLL_SECONDS + THINK_SECONDS)` = 96 × 5.35 = **514 s**, against the
 * 600 s the guard allows. Two `easy` bots measured 171 s at their worst over 120 frames.
 */
export const SHOT_LIMIT = 96;

/**
 * How many times the board is advanced within one fixed step.
 *
 * **This is the single most load-bearing number in the file.** A striker crossing the board
 * at nine hundred units a second moves fifteen units in a sixtieth, and the contact circle
 * between a striker and a puck has a radius of thirty-nine — so a whole-step integration
 * detects the contact up to fifteen units *past* the point the shot was aimed at, by which
 * time the line of centres has swung twenty degrees and the puck leaves nowhere near the
 * pocket. Measured: a bot aiming the perfect ghost-ball line potted 16 of 190 open shots.
 *
 * Six sub-steps put the overshoot under three units and the same 190 shots potted 150. It is
 * not a graphics trick or a smoothing pass; without it there is no game here at all.
 *
 * Sub-stepping keeps the simulation frame-rate independent rather than breaking it: the
 * sub-step is a fraction of whatever fixed delta arrives, so the same stroke is integrated
 * the same way at 60 Hz and at 120 Hz.
 */
export const SUB_STEPS = 6;

/**
 * A stroke is abandoned after this long.
 *
 * Counted in seconds rather than steps so it means the same thing at 60 Hz and 120 Hz, and
 * chosen so that the two caps multiply out under the ten simulated minutes
 * `apps/web/src/data/termination.test.ts` allows: `SHOT_LIMIT × (MAX_ROLL_SECONDS +
 * THINK_SECONDS)` is 514 s at five and 610 s at six. Six was over the line, which is not a
 * guarantee at all — merely a frame that had never happened to need it.
 *
 * Five is also above every stroke the physics can produce. Friction is constant, so a body
 * moving at `v` is stopped after `v / FRICTION`; the whole stroke starts with
 * `½·STRIKER_MASS·STRIKER_MAX_SPEED²` of energy and every contact takes some away, so no
 * body ever exceeds `sqrt(2·E/PUCK_MASS)` = 1697 units/s and nothing can still be rolling
 * after 4.99 s. The measured worst over 1080 bot frames is 2.45 s. The cap is a guarantee
 * for a body wedged in a corner and fed by the separation push, not a working part.
 */
export const MAX_ROLL_SECONDS = 5;

/** Pot all six of your own. The queen is a gate on the last one, not a point. */
export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: PUCKS_PER_SIDE };

export type BodyKind = 'striker' | 'p1' | 'p2' | 'queen';

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly kind: BodyKind;
  /** Potted bodies leave the board but keep their slot, so indices never shift. */
  potted: boolean;
}

export type Phase = 'aiming' | 'rolling' | 'over';

export interface State {
  /** Index 0 is always the striker; the rest are the queen and the twelve pucks. */
  readonly bodies: Body[];
  seat: SeatId;
  phase: Phase;
  winner: Outcome;
  /** Where along the baseline the shooter has slid the striker, -1 to 1 in seat space. */
  offset: number;
  /** The queen is off the board and not yet covered: the shooter owes a puck this visit. */
  queenPending: boolean;
  /** Who covered the queen, or null while she is unresolved. */
  queenOwner: SeatId | null;
  /** Whether the stroke just played was a foul. Drawn, so a player knows what happened. */
  fouled: boolean;
  /** Consecutive strokes that gained nothing for anybody. */
  dryShots: number;
  /** Strokes played in this frame, both seats together. */
  shots: number;
  /** Seconds the current stroke has been running. */
  rollSeconds: number;
}

/** The four pockets, as centres, one on each corner of the bed. */
export const POCKETS: readonly (readonly [number, number])[] = Object.freeze([
  [SURFACE_LEFT, SURFACE_TOP],
  [SURFACE_RIGHT, SURFACE_TOP],
  [SURFACE_LEFT, SURFACE_BOTTOM],
  [SURFACE_RIGHT, SURFACE_BOTTOM],
]);

export function radiusOf(kind: BodyKind): number {
  return kind === 'striker' ? STRIKER_RADIUS : PUCK_RADIUS;
}

export function massOf(kind: BodyKind): number {
  return kind === 'striker' ? STRIKER_MASS : PUCK_MASS;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Which way along world y this seat shoots. Seat one sits at the bottom and fires up. */
export function forwardOf(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

/** Which way along world x the shooter's own right hand lies. */
export function rightOf(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function body(x: number, y: number, kind: BodyKind): Body {
  return { x, y, vx: 0, vy: 0, kind, potted: false };
}

/**
 * The opening rosette.
 *
 * The queen at the centre, six pucks around her and six further out, alternating. Fixed
 * rather than seeded: an opening both players know is part of carrom, and a random spread
 * would make the break a lottery.
 *
 * The arrangement is deliberately **antisymmetric** under a half turn — position k of a ring
 * maps to position k + 3, whose colour is the other seat's — so neither seat opens with an
 * easier board than the other. The tests assert it rather than trusting the arithmetic.
 */
export function createState(): State {
  const bodies: Body[] = [
    body(strikerXFor('p1', 0), strikerYFor('p1'), 'striker'),
    body(CENTRE_X, CENTRE_Y, 'queen'),
  ];
  const inner = PUCK_RADIUS * 2 + 1;
  for (let k = 0; k < 6; k += 1) {
    const angle = (k * Math.PI) / 3;
    bodies.push(
      body(
        CENTRE_X + Math.cos(angle) * inner,
        CENTRE_Y + Math.sin(angle) * inner,
        k % 2 === 0 ? 'p1' : 'p2',
      ),
    );
  }
  const outer = inner * 2;
  for (let k = 0; k < 6; k += 1) {
    const angle = (k * Math.PI) / 3 + Math.PI / 6;
    bodies.push(
      body(
        CENTRE_X + Math.cos(angle) * outer,
        CENTRE_Y + Math.sin(angle) * outer,
        k % 2 === 0 ? 'p2' : 'p1',
      ),
    );
  }
  return {
    bodies,
    seat: 'p1',
    phase: 'aiming',
    winner: null,
    offset: 0,
    queenPending: false,
    queenOwner: null,
    fouled: false,
    dryShots: 0,
    shots: 0,
    rollSeconds: 0,
  };
}

/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK
 * alternates it across the rounds of a best-of so first-mover advantage washes out
 * (#2466), and a game that assumed seat one would leave that rotation reaching nothing.
 * The default exists only so the rules tests can name a concrete side.
 */
export function resetState(state: State, opener: SeatId = 'p1'): void {
  const fresh = createState();
  state.bodies.length = 0;
  for (const b of fresh.bodies) state.bodies.push(b);
  state.seat = opener;
  state.phase = 'aiming';
  state.winner = null;
  state.offset = 0;
  state.queenPending = false;
  state.queenOwner = null;
  state.fouled = false;
  state.dryShots = 0;
  state.shots = 0;
  state.rollSeconds = 0;
}

export function strikerOf(state: State): Body {
  return state.bodies[0] as Body;
}

export function queenOf(state: State): Body {
  return state.bodies[1] as Body;
}

/** Where a striker slid to `offset` sits, in world units. */
export function strikerXFor(seat: SeatId, offset: number): number {
  return CENTRE_X + clamp(offset, -1, 1) * BASE_HALF * rightOf(seat);
}

export function strikerYFor(seat: SeatId): number {
  return CENTRE_Y - BASE_DISTANCE * forwardOf(seat);
}

/** How many of a seat's own pucks are still on the board. */
export function remaining(state: State, seat: SeatId): number {
  let count = 0;
  for (const b of state.bodies) {
    if (b.kind === seat && !b.potted) count += 1;
  }
  return count;
}

/** How many of a seat's own pucks are down. This is the seat's score. */
export function pottedCount(state: State, seat: SeatId): number {
  return PUCKS_PER_SIDE - remaining(state, seat);
}

/** Whether a point is far enough inside the frame for a body of `radius` to sit there. */
export function onSurface(x: number, y: number, radius: number): boolean {
  return (
    x >= SURFACE_LEFT + radius &&
    x <= SURFACE_RIGHT - radius &&
    y >= SURFACE_TOP + radius &&
    y <= SURFACE_BOTTOM - radius
  );
}

/** Whether a point is inside one of the four corner squares the rails leave open. */
export function inPocket(x: number, y: number): boolean {
  const acrossX = x <= SURFACE_LEFT + POCKET_MOUTH || x >= SURFACE_RIGHT - POCKET_MOUTH;
  const acrossY = y <= SURFACE_TOP + POCKET_MOUTH || y >= SURFACE_BOTTOM - POCKET_MOUTH;
  return acrossX && acrossY;
}

/** Whether a body of `radius` could rest at this point without touching anything else. */
export function spotIsFree(
  state: State,
  ignore: Body,
  x: number,
  y: number,
  radius: number,
): boolean {
  if (!onSurface(x, y, radius)) return false;
  if (inPocket(x, y)) return false;
  for (const b of state.bodies) {
    if (b === ignore || b.potted) continue;
    const gap = radius + radiusOf(b.kind) + 1;
    const dx = b.x - x;
    const dy = b.y - y;
    if (dx * dx + dy * dy < gap * gap) return false;
  }
  return true;
}

/**
 * The nearest legal slide to the one asked for.
 *
 * A puck that has come to rest on the baseline is in the way, and a striker overlapping it
 * would be flung sideways by the separation push the instant it was flicked. Searching
 * outward from the requested slide instead means the striker simply stops against the
 * obstruction, which is what a hand does.
 */
export function freeOffset(state: State, seat: SeatId, desired: number): number {
  const striker = strikerOf(state);
  const wanted = clamp(desired, -1, 1);
  const y = strikerYFor(seat);
  if (spotIsFree(state, striker, strikerXFor(seat, wanted), y, STRIKER_RADIUS)) return wanted;
  for (let stepIndex = 1; stepIndex <= 40; stepIndex += 1) {
    const delta = stepIndex * 0.025;
    const up = clamp(wanted + delta, -1, 1);
    if (spotIsFree(state, striker, strikerXFor(seat, up), y, STRIKER_RADIUS)) return up;
    const down = clamp(wanted - delta, -1, 1);
    if (spotIsFree(state, striker, strikerXFor(seat, down), y, STRIKER_RADIUS)) return down;
  }
  return wanted;
}

/** Put the striker on the shooter's baseline at the nearest legal slide. */
export function placeStriker(state: State): void {
  const striker = strikerOf(state);
  const offset = freeOffset(state, state.seat, state.offset);
  striker.x = strikerXFor(state.seat, offset);
  striker.y = strikerYFor(state.seat);
  striker.vx = 0;
  striker.vy = 0;
  striker.potted = false;
}

/** Where the striker is actually standing, which is not always where it was asked to go. */
export function strikerSlide(state: State): number {
  return freeOffset(state, state.seat, state.offset);
}

export function clampAim(angle: number): number {
  return clamp(angle, -MAX_AIM, MAX_AIM);
}

/**
 * Flick the striker. `angle` is in seat space — zero is straight up the board, positive is
 * towards the shooter's own right — and `power` is 0 to 1.
 */
export function flick(state: State, angle: number, power: number): boolean {
  if (state.phase !== 'aiming') return false;
  const strength = clamp(power, 0, 1);
  if (strength <= 0) return false;
  placeStriker(state);
  const aim = clampAim(angle);
  const striker = strikerOf(state);
  const speed = STRIKER_MAX_SPEED * strength;
  striker.vx = Math.sin(aim) * rightOf(state.seat) * speed;
  striker.vy = Math.cos(aim) * forwardOf(state.seat) * speed;
  state.phase = 'rolling';
  state.rollSeconds = 0;
  state.fouled = false;
  return true;
}

export function boardIsStill(state: State): boolean {
  for (const b of state.bodies) {
    if (b.potted) continue;
    if (b.vx !== 0 || b.vy !== 0) return false;
  }
  return true;
}

export interface StepResult {
  /** Bodies potted this step, as indices into `state.bodies`. */
  readonly potted: readonly number[];
  /** True on the step the board comes to rest. */
  readonly settled: boolean;
}

const pottedScratch: number[] = [];

/**
 * One fixed step of the board.
 *
 * Order matters and is the order Pool arrived at the hard way: move, then the frame, then
 * body-on-body, then the pockets. Resolving pockets before contacts lets a puck be potted
 * and then struck by another in the same step, which puts a potted puck back on the board.
 */
export function step(state: State, fixedDeltaSeconds: number): StepResult {
  pottedScratch.length = 0;
  if (state.phase !== 'rolling') return { potted: pottedScratch, settled: true };

  state.rollSeconds += fixedDeltaSeconds;
  const sub = fixedDeltaSeconds / SUB_STEPS;
  const drop = FRICTION * sub;

  for (let n = 0; n < SUB_STEPS; n += 1) {
    for (const b of state.bodies) {
      if (b.potted) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed > 0) {
        const ux = b.vx / speed;
        const uy = b.vy / speed;
        let travel: number;
        let left: number;
        if (speed <= drop) {
          // It runs out inside this sub-step: the exact distance left, then a dead stop.
          travel = (speed * speed) / (2 * FRICTION);
          left = 0;
        } else {
          travel = (speed - 0.5 * drop) * sub;
          left = speed - drop;
        }
        b.x += ux * travel;
        b.y += uy * travel;
        // Written as an exact zero rather than `ux * 0`, which is a negative zero for half
        // the directions on the board and reads as one in every trace that prints it.
        b.vx = left === 0 ? 0 : ux * left;
        b.vy = left === 0 ? 0 : uy * left;
      }
      bounceOffFrame(b);
    }

    resolveContacts(state);

    for (let i = 0; i < state.bodies.length; i += 1) {
      const b = state.bodies[i];
      if (b === undefined || b.potted) continue;
      if (!inPocket(b.x, b.y)) continue;
      b.potted = true;
      b.vx = 0;
      b.vy = 0;
      pottedScratch.push(i);
    }
  }

  // The abandonment rule. A stroke that has not settled in six seconds is stopped where it
  // stands rather than left to run: the frame has to end, and a body wedged in a corner
  // being fed by the separation push will not stop on its own.
  if (state.rollSeconds >= MAX_ROLL_SECONDS) {
    for (const b of state.bodies) {
      b.vx = 0;
      b.vy = 0;
    }
  }

  return { potted: pottedScratch, settled: boardIsStill(state) };
}

/**
 * The rails, with a gap at each end where the pocket is.
 *
 * A rail only acts along the stretch between the two mouths: the side rails are open over
 * the last `POCKET_MOUTH` at the top and bottom, and the end rails over the last
 * `POCKET_MOUTH` at either side. Whatever travels through a gap is inside a corner square
 * and is potted by the same sub-step, so nothing ever leaves the board.
 */
function bounceOffFrame(b: Body): void {
  const radius = radiusOf(b.kind);
  const pastTop = b.y <= SURFACE_TOP + POCKET_MOUTH;
  const pastBottom = b.y >= SURFACE_BOTTOM - POCKET_MOUTH;
  const pastLeft = b.x <= SURFACE_LEFT + POCKET_MOUTH;
  const pastRight = b.x >= SURFACE_RIGHT - POCKET_MOUTH;

  if (!pastTop && !pastBottom) {
    const left = SURFACE_LEFT + radius;
    const right = SURFACE_RIGHT - radius;
    if (b.x < left) {
      b.x = left;
      b.vx = Math.abs(b.vx) * FRAME_BOUNCE;
    } else if (b.x > right) {
      b.x = right;
      b.vx = -Math.abs(b.vx) * FRAME_BOUNCE;
    }
  }
  if (!pastLeft && !pastRight) {
    const top = SURFACE_TOP + radius;
    const bottom = SURFACE_BOTTOM - radius;
    if (b.y < top) {
      b.y = top;
      b.vy = Math.abs(b.vy) * FRAME_BOUNCE;
    } else if (b.y > bottom) {
      b.y = bottom;
      b.vy = -Math.abs(b.vy) * FRAME_BOUNCE;
    }
  }
}

/**
 * Impulse along the line of centres, weighted by mass, plus a positional push so two bodies
 * never sit inside one another.
 *
 * Pool could exchange velocities outright because every ball there weighs the same. Here the
 * striker is twice a puck, which is the whole reason a carrom striker exists, so the impulse
 * is the general one — and the separation push is split by inverse mass too, or a struck
 * puck shoves the striker backwards out of the way as if it were the heavier body.
 *
 * A pair already separating is left alone: striking them again applies the impulse the wrong
 * way and quietly adds energy, which is the bug that took Pool a velocity-reading test to
 * find.
 */
function resolveContacts(state: State): void {
  const bodies = state.bodies;
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    if (a === undefined || a.potted) continue;
    const invA = 1 / massOf(a.kind);
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];
      if (b === undefined || b.potted) continue;
      const minimum = radiusOf(a.kind) + radiusOf(b.kind);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= minimum * minimum || distanceSq === 0) continue;

      const distance = Math.sqrt(distanceSq);
      const invB = 1 / massOf(b.kind);
      const total = invA + invB;

      // The normal at the instant they *touched*, not at the instant we noticed.
      //
      // A step finds the pair already overlapping, and by then the line of centres has swung
      // away from where it was at first contact — by four or five degrees on a fast cut,
      // which over a four-hundred-unit run to the pocket is a thirty-unit miss. So the
      // relative motion is wound back to the touching distance and the normal read from
      // there: a quadratic in the rewind time, with exactly one positive root because the
      // pair is inside the contact circle and approaching. This is the difference between a
      // bot that pots a quarter of its open shots and one that pots four fifths.
      let nx = dx / distance;
      let ny = dy / distance;
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const closing = rvx * nx + rvy * ny;
      const speedSq = rvx * rvx + rvy * rvy;
      if (closing < 0 && speedSq > 0) {
        const halfB = -(dx * rvx + dy * rvy);
        const c = distanceSq - minimum * minimum;
        const discriminant = halfB * halfB - speedSq * c;
        if (discriminant > 0) {
          const rewind = (Math.sqrt(discriminant) - halfB) / speedSq;
          const cx = dx - rvx * rewind;
          const cy = dy - rvy * rewind;
          const contact = Math.hypot(cx, cy);
          if (contact > 0) {
            nx = cx / contact;
            ny = cy / contact;
          }
        }
      }

      const overlap = minimum - distance;
      a.x -= nx * overlap * (invA / total);
      a.y -= ny * overlap * (invA / total);
      b.x += nx * overlap * (invB / total);
      b.y += ny * overlap * (invB / total);

      // Only the component along the line of centres is exchanged; the tangential part of
      // each velocity is untouched, which is what makes a cut shot behave.
      const along = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (along > 0) continue;
      const impulse = (-(1 + PUCK_BOUNCE) * along) / total;
      a.vx -= impulse * invA * nx;
      a.vy -= impulse * invA * ny;
      b.vx += impulse * invB * nx;
      b.vy += impulse * invB * ny;
    }
  }
}

/**
 * Put a body back on the board, as near the centre spot as it will go.
 *
 * A returned puck belongs on the centre spot; when the spot is occupied the search steps
 * outward through fixed rings, so where it lands is a function of the position and nothing
 * else. Never seeded, because a player has to be able to predict it.
 */
export function returnToBoard(state: State, target: Body): void {
  target.potted = false;
  target.vx = 0;
  target.vy = 0;
  const radius = radiusOf(target.kind);
  for (let ring = 0; ring < 10; ring += 1) {
    const distance = ring * (PUCK_RADIUS * 2 + 3);
    const slots = ring === 0 ? 1 : 12;
    for (let slot = 0; slot < slots; slot += 1) {
      const angle = (slot / slots) * Math.PI * 2;
      const x = CENTRE_X + Math.cos(angle) * distance;
      const y = CENTRE_Y + Math.sin(angle) * distance;
      if (spotIsFree(state, target, x, y, radius)) {
        target.x = x;
        target.y = y;
        return;
      }
    }
  }
  target.x = CENTRE_X;
  target.y = CENTRE_Y;
}

/**
 * Which potted puck of a seat comes back after a foul.
 *
 * A puck potted in the offending stroke first, so the stroke is undone rather than punished
 * twice over; failing that the oldest one on the pile, which is what a player hands back.
 */
function pickReturn(state: State, seat: SeatId, potted: readonly number[]): Body | null {
  for (let i = potted.length - 1; i >= 0; i -= 1) {
    const index = potted[i];
    if (index === undefined) continue;
    const b = state.bodies[index];
    if (b !== undefined && b.kind === seat && b.potted) return b;
  }
  for (const b of state.bodies) {
    if (b.kind === seat && b.potted) return b;
  }
  return null;
}

export interface ShotOutcome {
  /** Who shoots next. */
  readonly next: SeatId;
  /** Set when the frame is decided. A stalemate can end it level. */
  readonly winner: Outcome;
  readonly fouled: boolean;
  /** Whether the shooter keeps the board. */
  readonly repeats: boolean;
}

/**
 * Work out what a finished stroke means.
 *
 * The rules kept, in the order they are applied:
 *
 * - Pot one of your own and you shoot again.
 * - Pot one of the opponent's and it counts **for them**; the visit ends. That is the real
 *   rule and it is what makes a wild shot expensive.
 * - Pot the queen and she is held pending: cover her by potting one of your own in the same
 *   stroke or the next one of the same visit, or she goes back to the centre and the visit
 *   ends. She never crosses the change of hands — a foul in the stroke that took her sends
 *   her straight back.
 * - Your last puck may not go down while the queen is unresolved. It comes straight back —
 *   which is the observed rule "the queen must be potted before the last puck", enforced
 *   rather than merely stated.
 * - Pot the striker and you owe a puck: one of yours comes back and the visit ends.
 */
export function settleShot(state: State, potted: readonly number[]): ShotOutcome {
  const seat = state.seat;
  const wasPending = state.queenPending;
  let pottedStriker = false;
  let queenDown = false;
  let ownDown = 0;
  let oppDown = 0;

  for (const index of potted) {
    const b = state.bodies[index];
    if (b === undefined) continue;
    if (b.kind === 'striker') pottedStriker = true;
    else if (b.kind === 'queen') queenDown = true;
    else if (b.kind === seat) ownDown += 1;
    else oppDown += 1;
  }

  if (queenDown) state.queenPending = true;

  let covered = false;
  if (state.queenPending && ownDown > 0) {
    state.queenOwner = seat;
    state.queenPending = false;
    covered = true;
  }

  let returns = 0;
  // The gate: nobody may be left with no pucks while the queen is unresolved. Checked for
  // both seats, because potting the opponent's last puck would otherwise hand them the frame
  // through a door the rules keep shut.
  if (state.queenOwner === null) {
    for (const side of ['p1', 'p2'] as const) {
      if (remaining(state, side) !== 0) continue;
      const back = pickReturn(state, side, potted);
      if (back === null) continue;
      returnToBoard(state, back);
      returns += 1;
    }
  }
  const gated = returns > 0;

  if (pottedStriker) {
    const back = pickReturn(state, seat, potted);
    if (back !== null) {
      returnToBoard(state, back);
      returns += 1;
    }
  }

  const fouled = pottedStriker || gated;

  /**
   * Whether the queen is still owed.
   *
   * She may be carried from the stroke that potted her to the *next stroke of the same
   * visit*, and no further: `wasPending` says the grace stroke has already been used, and a
   * foul spends it whatever else the stroke did.
   *
   * The foul clause is the one that was wrong. `queenPending` used to survive the change of
   * hands, so a shooter who potted the queen and the striker together handed the opponent a
   * queen they could cover with their own next puck — a gift the rule has no room for. She
   * belongs to the visit that potted her, and when that visit ends she goes back.
   */
  const stillOwed = state.queenPending && !wasPending && !fouled;

  let queenReturned = false;
  if (state.queenPending && !stillOwed) {
    state.queenPending = false;
    returnToBoard(state, queenOf(state));
    queenReturned = true;
  }

  const gained = Math.max(0, ownDown + oppDown + (covered ? 1 : 0) - returns);
  state.shots += 1;
  state.dryShots = gained > 0 ? 0 : state.dryShots + 1;

  const repeats = !fouled && !queenReturned && (ownDown > 0 || covered || stillOwed);
  const winner = winnerOf(state);
  return { next: repeats ? seat : otherOf(seat), winner, fouled, repeats };
}

/**
 * The frame's outcome, or null while it is still running.
 *
 * The comparison itself belongs to the SDK: "first to six" has to mean the same thing here
 * as everywhere else, and a frame that runs out of strokes settles on what is down and is
 * drawn when that is level.
 */
export function winnerOf(state: State): Outcome {
  const expired = state.dryShots >= STALEMATE_SHOTS || state.shots >= SHOT_LIMIT;
  return resolve(
    WIN_CONDITION,
    { p1: pottedCount(state, 'p1'), p2: pottedCount(state, 'p2') },
    { timeExpired: expired },
  );
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Angular error held for the whole stroke, in radians. */
  readonly spread: number;
  readonly power: number;
  /** Whether it takes the best line it found, or any playable one. */
  readonly picksBest: boolean;
  /** Whether it goes for the queen before it is forced to. */
  readonly seeksQueen: boolean;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { spread: 0.055, power: 0.64, picksBest: false, seeksQueen: false },
  normal: { spread: 0.045, power: 0.66, picksBest: true, seeksQueen: false },
  hard: { spread: 0.014, power: 0.78, picksBest: true, seeksQueen: true },
});

export interface Aim {
  /** Where to slide the striker, in seat space. */
  readonly offset: number;
  /** Seat-space angle, zero being straight up the board. */
  readonly angle: number;
  readonly power: number;
}

/** How many placements along the baseline the bot considers. A hand has the same choice. */
export const OFFSET_SAMPLES = 9;

/**
 * Every playable line found while looking, so `easy` can take an ordinary one rather than
 * the best one.
 *
 * Two flat arrays sized once at module load rather than a list built per stroke: six targets
 * by four pockets by nine placements is 216 lines at the very most, and a bot that allocates
 * on the step it decides is a frame-time spike wearing a disguise.
 */
const MAX_LINES = 256;
const lineOffsets = new Float64Array(MAX_LINES);
const lineAngles = new Float64Array(MAX_LINES);

/**
 * Whether anything stands between the striker and where it has to be at contact.
 *
 * A segment-to-centre test, ignoring the striker itself and the body being struck.
 */
export function blocked(
  state: State,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  target: Body,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return false;
  for (const b of state.bodies) {
    if (b === target || b.potted || b.kind === 'striker') continue;
    let t = ((b.x - fromX) * dx + (b.y - fromY) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const nx = fromX + dx * t;
    const ny = fromY + dy * t;
    const gap = STRIKER_RADIUS + radiusOf(b.kind);
    if (Math.hypot(b.x - nx, b.y - ny) < gap) return true;
  }
  return false;
}

/** Which bodies this seat may legally aim at right now. */
export function isTarget(state: State, seat: SeatId, b: Body, seeksQueen: boolean): boolean {
  if (b.potted) return false;
  if (b.kind === seat) {
    // The last puck cannot go down while the queen is unresolved, so do not aim at it —
    // unless she is already off the board and waiting to be covered, in which case that
    // very puck is what covers her and the frame is won with it.
    if (state.queenOwner !== null || state.queenPending) return true;
    return remaining(state, seat) > 1;
  }
  if (b.kind !== 'queen') return false;
  if (state.queenOwner !== null) return false;
  // Forced or chosen: with one puck left the queen is the only legal pot on the board.
  return seeksQueen || remaining(state, seat) === 1;
}

/**
 * Where the bot places, aims and how hard it hits.
 *
 * It reads the board and nothing else: the positions of the pucks, the four pockets and its
 * own baseline, which is exactly what the person opposite can see. For every target and every
 * pocket it works out the **ghost point** — where the striker must be at contact to send that
 * puck at that pocket, the line every carrom player is taught — and then tries each placement
 * along its baseline, keeping the ones whose line is on the board, inside the aiming cone and
 * not through another puck.
 *
 * The tiers differ in three things a person differs in, and in nothing else: how straight
 * they hit the line they chose, how hard they hit it, and whether they take the best shot
 * available or merely a playable one. `roll` and `choice` are drawn **once per stroke**; a
 * fresh error every step averages to zero and every tier plays the same, which is the mistake
 * the SDK's bot-judgement module exists to document.
 */
export function botAim(state: State, difficulty: BotDifficulty, roll: number, choice: number): Aim {
  const profile = BOT_PROFILES[difficulty];
  const seat = state.seat;
  const forward = forwardOf(seat);
  const right = rightOf(seat);
  const baseY = strikerYFor(seat);

  let bestScore = -Infinity;
  let bestOffset = 0;
  let bestAngle = 0;
  let playable = 0;
  let found = false;

  for (const target of state.bodies) {
    if (!isTarget(state, seat, target, profile.seeksQueen)) continue;
    for (const [px, py] of POCKETS) {
      const toPocket = Math.atan2(py - target.y, px - target.x);
      const reach = radiusOf(target.kind) + STRIKER_RADIUS;
      const ghostX = target.x - Math.cos(toPocket) * reach;
      const ghostY = target.y - Math.sin(toPocket) * reach;
      if (!onSurface(ghostX, ghostY, STRIKER_RADIUS)) continue;

      for (let sample = 0; sample < OFFSET_SAMPLES; sample += 1) {
        const offset = (sample / (OFFSET_SAMPLES - 1)) * 2 - 1;
        const baseX = strikerXFor(seat, offset);
        const relForward = (ghostY - baseY) * forward;
        if (relForward <= 0) continue;
        const relRight = (ghostX - baseX) * right;
        const angle = Math.atan2(relRight, relForward);
        if (Math.abs(angle) > MAX_AIM) continue;
        if (blocked(state, baseX, baseY, ghostX, ghostY, target)) continue;

        const travel = Math.hypot(ghostX - baseX, ghostY - baseY);
        const pocketRun = Math.hypot(px - target.x, py - target.y);
        const cut = Math.abs(normaliseAngle(toPocket - Math.atan2(ghostY - baseY, ghostX - baseX)));
        // Everything here is something a player weighs by eye: a thin cut is hard, a long
        // run to the pocket is hard, and a striker that has to cross the whole board is hard.
        const score = -cut * 70 - travel * 0.012 - pocketRun * 0.02;

        if (!found || score > bestScore) {
          found = true;
          bestScore = score;
          bestOffset = offset;
          bestAngle = angle;
        }
        if (playable < MAX_LINES) {
          lineOffsets[playable] = offset;
          lineAngles[playable] = angle;
          playable += 1;
        }
      }
    }
  }

  if (!found) return safety(state, seat, profile, roll);

  // A uniform seeded pick over the playable lines for the tier that does not insist on the
  // best one. Drawn once for the stroke, like the aiming error.
  const picked = Math.min(playable - 1, Math.floor(clamp(choice, 0, 0.999999) * playable));
  const offset = profile.picksBest ? bestOffset : (lineOffsets[picked] ?? bestOffset);
  const angle = profile.picksBest ? bestAngle : (lineAngles[picked] ?? bestAngle);
  return {
    offset,
    angle: clampAim(angle + (roll * 2 - 1) * profile.spread),
    power: profile.power,
  };
}

/**
 * Nothing can be potted from here, so play the board.
 *
 * Hit your nearest own puck at all: it moves the position, it cannot foul, and it may open
 * something up. Firing the least bad impossible line instead is how a frame grinds to a halt
 * — Pool measured thirty of forty frames never ending before it learned this.
 */
function safety(state: State, seat: SeatId, profile: BotProfile, roll: number): Aim {
  const baseY = strikerYFor(seat);
  const forward = forwardOf(seat);
  const right = rightOf(seat);
  let bestAngle = 0;
  let bestOffset = 0;
  let nearest = Infinity;
  for (const b of state.bodies) {
    if (b.potted || b.kind === 'striker') continue;
    for (let sample = 0; sample < OFFSET_SAMPLES; sample += 1) {
      const offset = (sample / (OFFSET_SAMPLES - 1)) * 2 - 1;
      const baseX = strikerXFor(seat, offset);
      const relForward = (b.y - baseY) * forward;
      if (relForward <= 0) continue;
      const relRight = (b.x - baseX) * right;
      const angle = Math.atan2(relRight, relForward);
      if (Math.abs(angle) > MAX_AIM) continue;
      if (blocked(state, baseX, baseY, b.x, b.y, b)) continue;
      const distance = Math.hypot(b.x - baseX, b.y - baseY);
      if (distance < nearest) {
        nearest = distance;
        bestAngle = angle;
        bestOffset = offset;
      }
    }
  }
  return {
    offset: bestOffset,
    // Still the tier's own error: a safety played by `hard` is a straighter safety.
    angle: clampAim(bestAngle + (roll * 2 - 1) * profile.spread),
    power: profile.power,
  };
}

export function normaliseAngle(radians: number): number {
  let a = radians;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
