import type { Rng, SeatId } from '@duelbox/engine';
import { misjudgement, resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Sword Throwing, as pure rules.
 *
 * Two fighters stand facing each other down a long arena, each with a rack of targets at
 * their back and one sword in their hand. On your turn you pivot the sword and let it go;
 * it flies a straight line the length of the arena. While it is in the air the *other*
 * player is the one with something to do: they slide the sword they are holding along
 * their guard line and try to meet the throw with it. A blade that meets the throw parries
 * it dead; a blade that arrives late watches it bury itself in a target.
 *
 * The two halves of the observed rule are therefore the two halves of a turn: one player
 * throws, the other parries, and the game hands the board to whichever of them has
 * something to do. Neither ever acts at the same time as the other.
 *
 * **There is one frame in this file, not two.** Every position is expressed in the *local*
 * frame of the seat it belongs to: `u` across the arena, positive towards that seat's own
 * right, and `v` along it, positive towards that seat's own end. A seat's world position is
 * `centre + sign · local`, with `sign` +1 for p1 and −1 for p2, so **one seat's local frame
 * is the other's negated**. That is not tidiness. A mirror written as `WIDTH − x` is not
 * exact in floating point — 700 − 0.1 is not representable, so mirroring twice does not
 * return the number you started with, and beach-ball and spin-war both found their two
 * seats playing measurably different games because of it. Negation is exact to the last
 * bit, and a game that never leaves the local frame never even has to negate: p1's throw
 * and p2's throw are literally the same arithmetic on the same numbers.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit (rule 8) and every
 * angle is radians.
 */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** Half the arena's width. A sword that reaches this has left the fight. */
export const HALF_WIDTH = BOARD_WIDTH / 2;

/**
 * Where a fighter stands, as a distance from the centre line towards their own end.
 *
 * The two guard lines are `2 · GUARD_V` apart — 520 units — which at {@link SWORD_SPEED} is
 * 1.04 s of flight. That number is the whole budget the parry lives inside: it is what a
 * defender has to notice a throw, read its line and get there. Shorter and the parry is a
 * coin toss; longer and no throw ever gets past anybody.
 */
export const GUARD_V = 260;

/** Where a seat's rack of targets stands, behind them. */
export const TARGET_V = 424;

/** The back wall. A sword that reaches it drops. */
export const WALL_V = 470;

/**
 * How far along the flight the defender's guard line sits, as a fraction.
 *
 * `2 · GUARD_V / (GUARD_V + TARGET_V)` = 0.76: a throw is three quarters of the way to the
 * target it is aimed at by the time it passes the blade. It is written out here because it
 * is the number that decides how much the *thrower's own stance* moves the point the throw
 * has to be parried at — see {@link crossingFor}.
 */
export const CROSS_FRACTION = (2 * GUARD_V) / (GUARD_V + TARGET_V);

export const TARGETS_PER_SEAT = 5;

/**
 * Where the targets stand, as offsets from the seat's own centre line.
 *
 * One rack is written down and both seats get it, in their own local frame, so the two
 * fighters face the identical problem rather than a similar one. 130 apart with a capture
 * radius of {@link CAPTURE_RADIUS} leaves a 48-unit gap between one target's reach and the
 * next: wide enough that a badly aimed throw really can sail through, narrow enough that a
 * throw meant for the rack usually finds something.
 */
const SLOT_SPACING = 130;
export const TARGET_SLOTS: readonly number[] = Object.freeze([
  -2 * SLOT_SPACING,
  -SLOT_SPACING,
  0,
  SLOT_SPACING,
  2 * SLOT_SPACING,
]);

/**
 * How far a target may be nudged from its slot, so no two matches are the same rack.
 *
 * Twelve either way, which keeps the closest two capture circles 102 apart against a
 * combined reach of 82 — the gap narrows but never closes, so a throw can always miss.
 * The same nudge is given to both racks: a rack jittered independently would hand one
 * player an easier five than the other.
 */
export const SLOT_JITTER = 12;

export const TARGET_RADIUS = 34;
export const SWORD_RADIUS = 7;
/** What a target catches. A sword within this of a target's centre has struck it. */
export const CAPTURE_RADIUS = TARGET_RADIUS + SWORD_RADIUS;

/** How far either way along the guard line a fighter may carry their sword. */
export const BLADE_RANGE = 300;

/** Half the length of the held sword, across the line of a throw. */
export const BLADE_HALF = 34;
/** How near the crossing point the blade must be to catch it. */
export const PARRY_REACH = BLADE_HALF + SWORD_RADIUS;

/** Logical units a second, constant. A sword neither speeds up nor slows down. */
export const SWORD_SPEED = 500;

/**
 * How fast a held sword can be carried along the guard line.
 *
 * The one number that sets how often a parry lands, and it is derived rather than chosen
 * for feel. A throw at the widest target crosses the guard line `CROSS_FRACTION · 260` =
 * 198 units off centre; a defender has the 1.04 s of the flight less whatever they spend
 * noticing, so at 250 units a second and the quickest reaction in the ladder they cover
 * 222 units and their blade catches anything within {@link PARRY_REACH} of that — 263 all
 * told. **So a defender standing near the middle of their line can reach every target on
 * the rack and one standing more than about 65 units off it cannot reach the far one.**
 * That narrow band is the whole game: a throw is parried when the last exchange left you
 * near your guard and gets through when it left you out of position.
 *
 * Swept over 60 seeded matches a tier at each of three settings, moving this number moves
 * exactly what the arithmetic says it should: at 230 the parry rate is 9 / 25 / 37 per cent
 * for the three tiers, at 250 it is 12 / 29 / 48, and at 270 it is 14 / 35 / 52 with `hard`
 * matches running to 19 throws each. 250 is where the parry is a real threat at every tier
 * without the best two making the arena impassable, and at 450 matches a tier it settles at
 * 11.2 / 28.8 / 47.5.
 *
 * Both seats and every difficulty carry the sword at exactly this speed (rule 6).
 */
export const BLADE_SPEED = 250;

/** How far off straight a throw may be pointed, either way. */
export const MAX_AIM = 0.72;

/**
 * A hard ceiling on a flight, in seconds.
 *
 * Never reached: the longest path any legal throw can take is the back wall at the widest
 * angle, 730 units of arena divided by cos(0.72), which is 971 units, or 1.94 s. It exists
 * so that termination does not depend on the geometry staying as it is.
 */
export const FLIGHT_LIMIT_SECONDS = 2.4;

/** Seconds the arena is held after a throw, before the board changes hands. */
export const SETTLE_SECONDS = 0.5;

/**
 * Throws in a match, both seats together, after which it is settled on hits.
 *
 * A structural limit rather than a clock — nothing in the shell ends a match. Twenty-two
 * throws each is a little over twice what a `normal` bot needs for five hits, so the cap
 * decides only matches that deserve to be decided that way. The arithmetic that has to
 * close is in SPEC.md: 44 × (1.15 s of thinking + 1.94 s of flight + 0.5 s of settling) is
 * 158 s against the platform's 600 s ceiling.
 */
export const MAX_THROWS = 44;

/** Hits that win a match. */
export const WIN_HITS = 5;

/**
 * How far off centre a fighter may start, drawn **separately for each of them**.
 *
 * The obvious thing is to give both the same starting stance, which is exactly what the
 * first version did, and it is wrong. A blade only moves while its owner is parrying, so
 * the two stances march along in lockstep — and starting them equal starts them in
 * *opposite* phases of that lockstep, because seat one throws first. Measured over three
 * independent families of 150 `hard` matches, seat one won 40.5%, 40.7% and 39.5% of the
 * decided ones, which is not noise and is not a difficulty ladder: it is a seat advantage.
 *
 * Drawing the two stances independently scatters the phase, and how far they may scatter
 * is what is left to tune. The same three families measure seat one at 44.4 / 40.9 / 41.7
 * per cent with a spread of 120, and 46.5 / 46.3 / 45.1 with a spread of 200. Two hundred
 * is two thirds of the guard line, which is wide enough to break the lockstep and narrow
 * enough that nobody opens a match already backed against their own edge.
 *
 * It is still a fair draw: both come from the same distribution about each fighter's own
 * centre line, so neither seat is favoured over a run of matches, and a mirrored state is
 * still the same state.
 */
export const BLADE_START_SPREAD = 200;

/** Radians a second a sword appears to tumble. Cosmetic, but stepped, so a replay is exact. */
export const SWORD_TUMBLE = 16;

const TAU = Math.PI * 2;

export type Phase = 'aiming' | 'flying' | 'settling' | 'over';

/** What the last throw came to. */
export type ThrowOutcome = 'none' | 'parried' | 'struck' | 'missed';

export interface Fighter {
  /**
   * Where this seat's sword is being held, across their own guard line.
   *
   * It moves only while this seat is parrying. Where a parry leaves it is where the next
   * throw is made from, which is the one piece of state that carries between exchanges.
   */
  blade: number;
  /** Swords of the *other* seat standing in each of this seat's targets. */
  readonly struck: number[];
}

/**
 * A sword in the air, expressed in the **defender's** local frame.
 *
 * The defender's frame rather than the thrower's because everything the flight has to be
 * tested against — the guard line, the blade on it, the rack behind it — belongs to the
 * defender. One negation at the moment of release, and then no frame changes at all.
 */
export interface Shot {
  u: number;
  v: number;
  /** Where it started, so a position is recomputed from `elapsed` rather than accumulated. */
  u0: number;
  v0: number;
  /** Unit direction of travel. `dv` is always positive: a throw always crosses the arena. */
  du: number;
  dv: number;
  elapsed: number;
  /** When the sword reaches the defender's guard line. */
  guardTime: number;
  /** When the flight ends: a parry, a target, the wall, the side, or the flight limit. */
  endTime: number;
  /** Whether the parry has been decided yet. */
  resolved: boolean;
  parried: boolean;
  /** Index of the target it will bury itself in, or −1. */
  hit: number;
  /** Cosmetic tumble. */
  tumble: number;
}

export interface State {
  readonly p1: Fighter;
  readonly p2: Fighter;
  /** Where the targets stand this match, in both seats' local frames alike. */
  readonly slots: number[];
  phase: Phase;
  /** Whose sword is being thrown. The other seat is the one parrying. */
  thrower: SeatId;
  /** Where the throw points, in the thrower's local frame. Reset every hand-over. */
  aim: number;
  readonly shot: Shot;
  throws: number;
  /** Throws each seat has made, so a match can only end on a completed round. */
  p1Throws: number;
  p2Throws: number;
  settle: number;
  lastOutcome: ThrowOutcome;
  /** Which target the last throw found, or −1. */
  lastHit: number;
  winner: Outcome;
}

/**
 * First to five hits.
 *
 * `first-to` over a tally of swords landed, so "first to five" means what it means
 * everywhere else in the collection, and two seats arriving together in the same round are
 * a draw rather than whichever the code happened to look at first.
 */
const WIN_CONDITION: WinCondition = { kind: 'first-to', target: WIN_HITS };

/** Preallocated arguments for {@link resolve}: it is called on a step, so it may not allocate. */
const winTally = { p1: 0, p2: 0 };
const winOptions = { timeExpired: false };

function createFighter(): Fighter {
  const struck: number[] = [];
  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) struck.push(0);
  return { blade: 0, struck };
}

export function createState(): State {
  const slots: number[] = [];
  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) slots.push(TARGET_SLOTS[i] ?? 0);
  return {
    p1: createFighter(),
    p2: createFighter(),
    slots,
    phase: 'aiming',
    thrower: 'p1',
    aim: 0,
    shot: {
      u: 0,
      v: -GUARD_V,
      u0: 0,
      v0: -GUARD_V,
      du: 0,
      dv: 1,
      elapsed: 0,
      guardTime: 0,
      endTime: 0,
      resolved: true,
      parried: false,
      hit: -1,
      tumble: 0,
    },
    throws: 0,
    p1Throws: 0,
    p2Throws: 0,
    settle: 0,
    lastOutcome: 'none',
    lastHit: -1,
    winner: null,
  };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function fighterOf(state: State, seat: SeatId): Fighter {
  return seat === 'p1' ? state.p1 : state.p2;
}

/** The seat that is parrying: the one whose sword is not in the air. */
export function defenderOf(state: Readonly<State>): SeatId {
  return otherOf(state.thrower);
}

/**
 * Whose turn it is, in the sense the shell means: who may act right now.
 *
 * It is the thrower while a throw is being lined up and **the defender the moment the
 * sword leaves the hand**, because that is exactly when the defender has something to do
 * and the thrower has nothing. The seat therefore changes once per throw, on the step of
 * the release, and the shell hands the pointer surface over with it.
 */
export function activeOf(state: Readonly<State>): SeatId {
  return state.phase === 'aiming' ? state.thrower : otherOf(state.thrower);
}

/**
 * Set the arena up for a fresh match.
 *
 * Eight values off the seeded stream: one nudge per target slot, and one starting stance
 * that **both** fighters take. Identical numbers in two mirrored local frames are a
 * mirrored arena, so neither seat starts closer to anything than the other.
 */
/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK
 * alternates it across the rounds of a best-of so first-mover advantage washes out
 * (#2466), and a game that assumed seat one would leave that rotation reaching nothing.
 * The default exists only so the rules tests can name a concrete side.
 */
export function resetState(state: State, rng: Rng, opener: SeatId = 'p1'): void {
  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
    const slot = TARGET_SLOTS[i] ?? 0;
    state.slots[i] = slot + (rng.float() * 2 - 1) * SLOT_JITTER;
  }
  state.p1.blade = (rng.float() * 2 - 1) * BLADE_START_SPREAD;
  state.p2.blade = (rng.float() * 2 - 1) * BLADE_START_SPREAD;
  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
    state.p1.struck[i] = 0;
    state.p2.struck[i] = 0;
  }
  state.phase = 'aiming';
  state.thrower = opener;
  state.aim = 0;
  restShot(state);
  state.throws = 0;
  state.p1Throws = 0;
  state.p2Throws = 0;
  state.settle = 0;
  state.lastOutcome = 'none';
  state.lastHit = -1;
  state.winner = null;
}

function restShot(state: State): void {
  const shot = state.shot;
  shot.u = 0;
  shot.v = -GUARD_V;
  shot.u0 = 0;
  shot.v0 = -GUARD_V;
  shot.du = 0;
  shot.dv = 1;
  shot.elapsed = 0;
  shot.guardTime = 0;
  shot.endTime = 0;
  shot.resolved = true;
  shot.parried = false;
  shot.hit = -1;
  shot.tumble = 0;
}

/** Swords this seat has landed in the other seat's rack. The score, and the only tally. */
export function hitsFor(state: Readonly<State>, seat: SeatId): number {
  const rack = seat === 'p1' ? state.p2.struck : state.p1.struck;
  let total = 0;
  for (const count of rack) total += count;
  return total;
}

/** Point the throw. Refused once the sword has left the hand. */
export function aimAt(state: State, angle: number): void {
  if (state.phase !== 'aiming') return;
  if (!Number.isFinite(angle)) return;
  state.aim = clamp(angle, -MAX_AIM, MAX_AIM);
}

export function turnAim(state: State, delta: number): void {
  if (!Number.isFinite(delta)) return;
  aimAt(state, state.aim + delta);
}

/**
 * Point the throw at a place in the thrower's local frame, which is what a finger means.
 *
 * A finger exactly on the hand names no direction and leaves the sight alone; a finger
 * behind the hand still cannot aim backwards, because the clamp is applied to the angle
 * rather than to the finger.
 */
export function aimTowards(state: State, u: number, v: number): void {
  const hand = fighterOf(state, state.thrower).blade;
  const du = u - hand;
  const dv = v - GUARD_V;
  if (du === 0 && dv === 0) return;
  aimAt(state, Math.atan2(du, -dv));
}

/**
 * Carry the held sword along the guard line.
 *
 * Only the defender, and only while a sword is in the air. On your own turn your stance is
 * whatever the last parry left it as: you pivot and throw from there. That is the tension
 * the whole game is built on — chasing a throw to the far side wins you the exchange and
 * leaves you throwing the next one from the far side.
 */
export function slideBlade(state: State, seat: SeatId, delta: number): void {
  if (!Number.isFinite(delta)) return;
  if (state.phase !== 'flying' || seat === state.thrower) return;
  const fighter = fighterOf(state, seat);
  fighter.blade = clamp(fighter.blade + delta, -BLADE_RANGE, BLADE_RANGE);
}

/** Carry it towards a place, by at most `step`. Used by a bot and by a finger alike. */
export function slideBladeTowards(state: State, seat: SeatId, towards: number, step: number): void {
  if (!Number.isFinite(towards) || !Number.isFinite(step)) return;
  const fighter = fighterOf(state, seat);
  const delta = clamp(towards - fighter.blade, -Math.abs(step), Math.abs(step));
  slideBlade(state, seat, delta);
}

/**
 * Where a throw will cross the defender's guard line, in the defender's own frame.
 *
 * Straight from the geometry rather than from the flight: constant speed on a straight
 * line means the crossing point is known the instant the sword is released, and both the
 * bot and the tests want it without stepping anything.
 */
export function crossingOf(shot: Readonly<Shot>): number {
  return shot.u0 + shot.du * SWORD_SPEED * shot.guardTime;
}

/**
 * Where a throw aimed at target `index` from stance `stance` would cross the guard line.
 *
 * In the defender's frame, so it can be compared with the defender's blade directly. Note
 * what the algebra says: the crossing is `f · target − (1 − f) · stance`, so a quarter of
 * it is decided by where the thrower is standing rather than by what they are aiming at.
 * That is the room a thrower has to pull a defender off a target they are guarding.
 */
export function crossingFor(state: Readonly<State>, stance: number, index: number): number {
  const target = state.slots[index] ?? 0;
  return CROSS_FRACTION * target - (1 - CROSS_FRACTION) * stance;
}

/** The angle that sends a throw from `stance` into the centre of target `index`. */
export function aimFor(state: Readonly<State>, stance: number, index: number): number {
  const target = state.slots[index] ?? 0;
  // The target sits at −target in the thrower's frame: one seat's local right is the
  // other's local left, and negation is the whole of the mirror.
  return Math.atan2(-target - stance, GUARD_V + TARGET_V);
}

/** Seconds a throw at this angle takes to reach the defender's guard line. */
export function flightToGuard(aim: number): number {
  return (2 * GUARD_V) / (Math.cos(aim) * SWORD_SPEED);
}

/**
 * Let go. Only the seat whose turn it is may, and only while the arena is waiting.
 *
 * Everything the flight will do except the parry is decided here, in closed form: when it
 * reaches the guard line, and the latest it can still be in the air. Nothing is integrated
 * a step at a time, so a throw lands in the same place whatever size the steps are and a
 * fast sword cannot tunnel through a target.
 *
 * Returns whether the sword actually left the hand.
 */
export function throwSword(state: State, seat: SeatId): boolean {
  if (state.phase !== 'aiming' || seat !== state.thrower) return false;
  const shot = state.shot;
  const stance = fighterOf(state, seat).blade;
  // The one negation in the whole flight: the thrower's stance, read in the frame of the
  // seat being thrown at.
  shot.u0 = -stance;
  shot.v0 = -GUARD_V;
  shot.du = -Math.sin(state.aim);
  shot.dv = Math.cos(state.aim);
  shot.u = shot.u0;
  shot.v = shot.v0;
  shot.elapsed = 0;
  shot.parried = false;
  shot.hit = -1;

  const forward = shot.dv * SWORD_SPEED;
  shot.guardTime = (GUARD_V - shot.v0) / forward;
  const wallTime = (WALL_V - shot.v0) / forward;
  const sideTime =
    shot.du === 0
      ? Infinity
      : ((shot.du > 0 ? HALF_WIDTH : -HALF_WIDTH) - shot.u0) / (shot.du * SWORD_SPEED);
  const limit = Math.min(wallTime, sideTime, FLIGHT_LIMIT_SECONDS);
  shot.endTime = limit;
  // A throw flung so wide that it leaves the arena before it ever reaches the guard line
  // cannot be parried, and nothing is left to decide.
  shot.resolved = shot.guardTime >= limit;

  state.phase = 'flying';
  state.lastOutcome = 'none';
  state.lastHit = -1;
  state.throws += 1;
  if (seat === 'p1') state.p1Throws += 1;
  else state.p2Throws += 1;
  return true;
}

/** Scratch for {@link firstTargetHit}: a search runs on a step, so it may not allocate. */
const strike = { index: -1, time: Infinity };

/**
 * The first target a flight meets between `from` and `until`, or index −1.
 *
 * Solved rather than sampled. A straight line against a circle is a quadratic, and the
 * smaller root is the moment the sword's leading edge touches — so a 500-unit-a-second
 * sword cannot step over a 34-unit target however coarse the timestep, and the answer is
 * identical at 60 Hz and 120 Hz because no timestep appears in it.
 */
function firstTargetHit(
  state: Readonly<State>,
  shot: Readonly<Shot>,
  from: number,
  until: number,
): { index: number; time: number } {
  strike.index = -1;
  strike.time = Infinity;
  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
    const cu = state.slots[i] ?? 0;
    const ou = shot.u0 - cu;
    const ov = shot.v0 - TARGET_V;
    const b = 2 * SWORD_SPEED * (ou * shot.du + ov * shot.dv);
    const c = ou * ou + ov * ov - CAPTURE_RADIUS * CAPTURE_RADIUS;
    const a = SWORD_SPEED * SWORD_SPEED;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc);
    let t = (-b - root) / (2 * a);
    if (t < from) t = (-b + root) / (2 * a);
    if (t < from || t > until) continue;
    if (t < strike.time) {
      strike.time = t;
      strike.index = i;
    }
  }
  return strike;
}

export interface StepResult {
  /** Set on the step the sword came to rest. */
  readonly landed: boolean;
  readonly parried: boolean;
  /** Target struck on this step, or −1. */
  readonly struck: number;
  /** Set on the step the arena changed hands. */
  readonly handedOver: boolean;
}

const result = { landed: false, parried: false, struck: -1, handedOver: false };

/**
 * One fixed step. Allocates nothing: the result is one reused record.
 *
 * `bladeBefore` is where the defender's sword was at the *start* of this step, before any
 * input moved it. It is asked for rather than remembered because it is what makes the
 * parry independent of where in a step the crossing happens to fall — see
 * {@link resolveParry}.
 */
export function step(state: State, fixedDeltaSeconds: number, bladeBefore: number): StepResult {
  result.landed = false;
  result.parried = false;
  result.struck = -1;
  result.handedOver = false;
  if (state.phase === 'over') return result;

  if (state.phase === 'settling') {
    state.settle -= fixedDeltaSeconds;
    if (state.settle <= 0) {
      handOver(state);
      result.handedOver = true;
    }
    return result;
  }
  if (state.phase !== 'flying') return result;

  const shot = state.shot;
  const was = shot.elapsed;
  shot.elapsed = was + fixedDeltaSeconds;
  // Kept inside one turn, so a long match cannot drift into the range where a float can no
  // longer tell two nearby angles apart.
  shot.tumble += SWORD_TUMBLE * fixedDeltaSeconds;
  if (shot.tumble > TAU) shot.tumble -= TAU;
  placeShot(shot, shot.elapsed);

  if (!shot.resolved && shot.elapsed >= shot.guardTime) {
    resolveParry(state, was, fixedDeltaSeconds, bladeBefore);
  }

  if (shot.elapsed >= shot.endTime) {
    placeShot(shot, shot.endTime);
    shot.elapsed = shot.endTime;
    land(state);
    result.landed = true;
    result.parried = shot.parried;
    result.struck = shot.hit;
  }
  return result;
}

/**
 * Position from elapsed time rather than from the last position.
 *
 * Constant velocity, so this is the analytic integral exactly — and unlike `x += v · dt`
 * it cannot accumulate a different answer from a different number of steps.
 */
function placeShot(shot: Shot, at: number): void {
  shot.u = shot.u0 + shot.du * SWORD_SPEED * at;
  shot.v = shot.v0 + shot.dv * SWORD_SPEED * at;
}

/**
 * Decide the parry, at the exact instant the sword crosses the guard line.
 *
 * The crossing almost never falls on a step boundary, so the blade is read *between* the
 * two steps that bracket it: it moves at a constant rate inside a step, whether a key or a
 * finger is driving it, so a straight interpolation is its true position at that instant
 * rather than an approximation of it. Reading the blade at the end of the step instead
 * would have made the parry depend on where in a frame the crossing landed — up to five
 * units of blade against a 41-unit reach, which is small, and is exactly the sort of small
 * that decides a match once in fifty.
 */
function resolveParry(
  state: State,
  elapsedBefore: number,
  fixedDeltaSeconds: number,
  bladeBefore: number,
): void {
  const shot = state.shot;
  const defender = fighterOf(state, otherOf(state.thrower));
  const span = fixedDeltaSeconds > 0 ? (shot.guardTime - elapsedBefore) / fixedDeltaSeconds : 1;
  const frac = clamp(span, 0, 1);
  const bladeAt = bladeBefore + (defender.blade - bladeBefore) * frac;
  const crossing = crossingOf(shot);
  shot.resolved = true;
  if (Math.abs(crossing - bladeAt) <= PARRY_REACH) {
    shot.parried = true;
    shot.endTime = shot.guardTime;
    return;
  }
  const hit = firstTargetHit(state, shot, shot.guardTime, shot.endTime);
  if (hit.index >= 0) {
    shot.hit = hit.index;
    shot.endTime = hit.time;
  }
}

/** The sword has stopped. Record what it did. */
function land(state: State): void {
  const shot = state.shot;
  if (shot.parried) {
    state.lastOutcome = 'parried';
  } else if (shot.hit >= 0) {
    const rack = fighterOf(state, otherOf(state.thrower)).struck;
    rack[shot.hit] = (rack[shot.hit] ?? 0) + 1;
    state.lastOutcome = 'struck';
    state.lastHit = shot.hit;
  } else {
    state.lastOutcome = 'missed';
  }
  state.phase = 'settling';
  state.settle = SETTLE_SECONDS;
}

/**
 * Pass the arena to the other seat, and decide whether the match is over.
 *
 * **A match only ends on a completed round**, meaning both seats have thrown the same
 * number of times. p1 throws first, so ending the instant a seat reaches five would hand
 * p1 every match that was going to be close; the reply throw is what makes throwing first
 * an advantage of tempo rather than of a whole turn. Two seats arriving in the same round
 * draw, and that is a real result rather than a failure to finish.
 */
function handOver(state: State): void {
  state.thrower = otherOf(state.thrower);
  state.phase = 'aiming';
  // Every turn starts pointing straight down the arena. Carrying an aim over would mean
  // the second thrower inherits a sight the first one set.
  state.aim = 0;
  restShot(state);

  if (state.p1Throws !== state.p2Throws) return;
  winTally.p1 = hitsFor(state, 'p1');
  winTally.p2 = hitsFor(state, 'p2');
  winOptions.timeExpired = state.throws >= MAX_THROWS;
  const outcome = resolve(WIN_CONDITION, winTally, winOptions);
  if (outcome === null) return;
  state.winner = outcome;
  state.phase = 'over';
}

export function winnerOf(state: Readonly<State>): Outcome {
  return state.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * How a tier decides which target to go for.
 *
 * All three want the same thing — a throw the other fighter cannot reach — and differ in
 * how well they work out where it will have to be reached. None of them reads anything a
 * player cannot see: the rack, the other fighter's stance, and the flight model that is
 * drawn on the board every time anybody throws.
 */
export type ThrowJudgement =
  /** Aims at whichever target is furthest from the enemy blade *as the rack stands*. */
  | 'rack'
  /** Works out where the throw would actually cross, which is not where the target is. */
  | 'crossing'
  /** And weighs that against how long the throw takes to get there. */
  | 'slack';

/** How a tier decides where to carry its blade. */
export type ParryJudgement =
  /** Runs at the sword itself, which is behind where it needs to be the whole way. */
  | 'chase'
  /** Reads the line and goes to where it will cross, whether or not it can get there. */
  | 'intercept'
  /**
   * And gives up on a throw it cannot reach, resetting its guard to the middle instead.
   *
   * The best thing this buys is not the throw it gives up on — that one was lost anyway —
   * but the *next* one. A blade that chases an unreachable throw all the way finishes
   * standing exactly where that throw crossed, which is the worst place to be for whatever
   * comes next, and the two seats end up locked in opposite phases of the same oscillation:
   * measured over 300 hard-versus-hard matches, seat one hit 68% of its throws and seat two
   * 50%, which is not a difficulty ladder, it is a seat advantage.
   */
  | 'recover';

export interface BotProfile {
  readonly throwJudgement: ThrowJudgement;
  readonly parryJudgement: ParryJudgement;
  /** Radians of aiming error, drawn once a turn and thrown with. */
  readonly aimError: number;
  /** Units of error on where it thinks it has to be, drawn once a flight and moved to. */
  readonly parryError: number;
  /** Seconds it takes over a throw. */
  readonly think: number;
  /** Seconds before it starts moving to a throw it has just seen. */
  readonly react: number;
  /** Chance a decision is a genuine blunder, with both errors multiplied. */
  readonly wild: number;
}

/**
 * Three tiers, all of them throwing the same sword down the same arena at the same speed
 * and carrying the same blade at the same {@link BLADE_SPEED}.
 *
 * What differs is judgement and reaction, never the physics and never the information.
 *
 * **The error is drawn once and then acted on.** A fresh error every step averages to zero
 * sixty times a second and makes every tier identical — the mistake `bot-judgement` in the
 * SDK exists to document, made three times in this repository before it did.
 *
 * The ladder is set against the width of a target seen from the hand: 41 units of capture
 * at about 690 units away is 0.059 rad. The three aiming errors are 0.075, 0.032 and
 * 0.011 — wider than a target, half a target, a fifth of one. Straddling the target rather
 * than sitting inside it is what makes three tiers three tiers; had they all been well
 * inside it they would have been three spellings of "cannot miss".
 *
 * The parry ladder is set the same way, against {@link PARRY_REACH} of 41: 70 units of
 * error is most of a blade out of place, 46 is a blade, 13 is a third of one. And `easy`
 * is not merely inaccurate — it chases the sword rather than the place the sword is going,
 * which is the mistake a person makes on their first go and never quite stops making.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    throwJudgement: 'rack',
    parryJudgement: 'chase',
    aimError: 0.075,
    parryError: 70,
    think: 1.15,
    react: 0.42,
    wild: 0.3,
  }),
  normal: Object.freeze({
    throwJudgement: 'crossing',
    parryJudgement: 'recover',
    aimError: 0.032,
    parryError: 46,
    think: 0.85,
    react: 0.26,
    wild: 0.14,
  }),
  hard: Object.freeze({
    throwJudgement: 'slack',
    parryJudgement: 'recover',
    aimError: 0.011,
    parryError: 13,
    think: 0.62,
    react: 0.15,
    wild: 0.05,
  }),
});

/** What a blunder multiplies a tier's error by. */
export const WILD_MULTIPLIER = 3.5;

/**
 * The hair of slack a countdown is compared against, in seconds.
 *
 * Thirty subtractions of a sixtieth do not land on zero: they land about 1.4e-17 *above*
 * it, so a strict `> 0` spends one whole extra step on a delay that is arithmetically
 * over. Basketball shipped a half-second freeze that took thirty-one frames for exactly
 * this reason, and both of this game's countdowns — a bot's think and a bot's reaction —
 * are whole numbers of steps at 60 Hz, which is precisely where it bites.
 *
 * A nanosecond is fourteen orders of magnitude larger than the residue and five smaller
 * than a step, so it can only ever absorb the rounding.
 */
const SPENT_SECONDS = 1e-9;

/**
 * The nudge that separates two throws which are worth the same.
 *
 * Small enough that it can never outweigh a unit of the score it breaks ties in, and
 * applied to the size of the angle, so the tidier of two equal throws wins. It matters
 * because ties are everywhere: a rack of five is five candidates, and a tie broken by
 * candidate order alone would be broken the same way in both seats' frames — which here is
 * harmless, since both seats sweep one frame, but only by luck rather than by design.
 */
const TIDY = 0.001;

export interface ThrowPlan {
  aim: number;
  /** Seconds left of the pause before it lets go. */
  think: number;
  ready: boolean;
}

export function createThrowPlan(): ThrowPlan {
  return { aim: 0, think: 0, ready: false };
}

export function resetThrowPlan(plan: ThrowPlan): void {
  plan.aim = 0;
  plan.think = 0;
  plan.ready = false;
}

export interface ParryPlan {
  /** Seconds left before it starts moving. */
  delay: number;
  /** Where it has decided to carry the blade. Ignored while {@link ParryPlan.chase}. */
  target: number;
  /** Units it is wrong by, drawn once and carried the whole flight. */
  error: number;
  /** Whether it is running at the sword rather than at where the sword is going. */
  chase: boolean;
  ready: boolean;
}

export function createParryPlan(): ParryPlan {
  return { delay: 0, target: 0, error: 0, chase: false, ready: false };
}

export function resetParryPlan(plan: ParryPlan): void {
  plan.delay = 0;
  plan.target = 0;
  plan.error = 0;
  plan.chase = false;
  plan.ready = false;
}

/** Where a fighter resets a guard they have given up on. The middle of their own line. */
export const READY_STANCE = 0;

/**
 * Choose a throw. Called once a turn, never once a step.
 *
 * Five candidates, one per target, each scored by how far it would drag the other fighter
 * — and, at `hard`, by whether the time the throw takes gives them long enough to get
 * there. Then it draws its error for the turn and commits to throwing that, mistake and
 * all.
 *
 * **Two values off the stream every turn whatever it decides**, before anything branches on
 * them, so a replay from the seed is exact whether or not a blunder came up.
 */
export function planThrow(
  state: Readonly<State>,
  seat: SeatId,
  difficulty: BotDifficulty,
  plan: ThrowPlan,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const stance = seat === 'p1' ? state.p1.blade : state.p2.blade;
  const enemy = seat === 'p1' ? state.p2.blade : state.p1.blade;
  let bestScore = -Infinity;
  let bestAim = 0;

  for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
    const aim = aimFor(state, stance, i);
    if (Math.abs(aim) > MAX_AIM) continue;
    const crossing =
      profile.throwJudgement === 'rack' ? (state.slots[i] ?? 0) : crossingFor(state, stance, i);
    const travel = Math.abs(crossing - enemy);
    // How far the blade has to come, less how far it can come in the time the throw
    // takes. Only `slack` charges for the time; the other two look at distance alone.
    const score =
      profile.throwJudgement === 'slack'
        ? travel - BLADE_SPEED * flightToGuard(aim) - Math.abs(aim) * TIDY
        : travel - Math.abs(aim) * TIDY;
    if (score > bestScore) {
      bestScore = score;
      bestAim = aim;
    }
  }

  const wild = rng.bool(profile.wild) ? WILD_MULTIPLIER : 1;
  const slip = misjudgement(rng.float(), profile.aimError * wild);
  plan.aim = clamp(bestAim + slip, -MAX_AIM, MAX_AIM);
  plan.think = profile.think;
  plan.ready = true;
}

/**
 * A bot's turn at throwing, one step at a time: look once, line it up, take a moment.
 *
 * Returns true on the step it lets go, so the caller throws and resets the plan — the same
 * shape every bot in the collection uses, and the reason the tests and the game drive the
 * bot through one path rather than two that can drift.
 */
export function botThrow(
  state: State,
  seat: SeatId,
  difficulty: BotDifficulty,
  plan: ThrowPlan,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (state.phase !== 'aiming' || state.thrower !== seat) return false;
  if (!plan.ready) {
    planThrow(state, seat, difficulty, plan, rng);
    // The choice goes on the sight, so a player watching sees the bot line the throw up
    // rather than a sword appearing out of nowhere.
    aimAt(state, plan.aim);
  }
  plan.think -= fixedDeltaSeconds;
  return plan.think <= SPENT_SECONDS;
}

/**
 * Choose how to parry. Called once a flight, on the step the sword is first seen.
 *
 * Two values off the stream every flight whatever it decides, for the same reason
 * {@link planThrow} draws two.
 */
export function planParry(
  state: Readonly<State>,
  seat: SeatId,
  difficulty: BotDifficulty,
  plan: ParryPlan,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const wild = rng.bool(profile.wild) ? WILD_MULTIPLIER : 1;
  plan.error = misjudgement(rng.float(), profile.parryError * wild);
  plan.delay = profile.react;
  plan.chase = profile.parryJudgement === 'chase';
  const crossing = crossingOf(state.shot) + plan.error;
  plan.target = crossing;
  if (profile.parryJudgement === 'recover') {
    const blade = seat === 'p1' ? state.p1.blade : state.p2.blade;
    // What it would have to cover, against what it can cover in the time left after it has
    // finished noticing. Both halves are things a player watching the throw can see.
    const need = Math.abs(crossing - blade) - PARRY_REACH;
    const time = Math.max(0, state.shot.guardTime - profile.react);
    if (need > BLADE_SPEED * time) plan.target = READY_STANCE;
  }
  plan.ready = true;
}

/**
 * A bot's turn at parrying, one step at a time.
 *
 * It reads the sword's line, which is what is drawn on the board, and carries its blade at
 * exactly the speed a person's blade moves. What a tier buys is a shorter delay before it
 * starts and a better idea of where to go, never a faster arm.
 */
export function botParry(
  state: State,
  seat: SeatId,
  difficulty: BotDifficulty,
  plan: ParryPlan,
  rng: Rng,
  fixedDeltaSeconds: number,
): void {
  if (state.phase !== 'flying' || state.thrower === seat) return;
  if (!plan.ready) planParry(state, seat, difficulty, plan, rng);
  const shot = state.shot;
  // Once the throw is past the guard line there is nothing left to parry, so it stops
  // lunging. Leaving it running mattered a great deal more than it looks: a blade that
  // kept travelling for the rest of the flight finished every failed parry standing
  // exactly where the throw had crossed, which is the worst possible place to be for the
  // *next* throw — the bot was permanently one exchange behind and the measured parry rate
  // sat at 19% for `hard` against a 50% the geometry says it should reach.
  if (shot.elapsed >= shot.guardTime) return;
  if (plan.delay > SPENT_SECONDS) {
    plan.delay -= fixedDeltaSeconds;
    return;
  }
  // A chasing tier follows the sword itself, which is behind where it needs to be for the
  // whole flight; the other two go to the place they worked out at the start of it.
  const towards = plan.chase ? shot.u + plan.error : plan.target;
  slideBladeTowards(state, seat, towards, BLADE_SPEED * fixedDeltaSeconds);
}
