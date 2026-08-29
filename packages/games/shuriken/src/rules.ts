import type { Rng, SeatId } from '@duelbox/engine';
import { misjudgement, resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Shuriken, as pure rules.
 *
 * A bamboo grove stands between the two players. Each seat owns six canes; on your turn you
 * grab a shuriken, point it, put spin on it and let go. It flies a curve, cuts whatever it
 * passes through, and stops dead against a rock. Cut all six of your opponent's canes and
 * the match is yours — but the blade does not care whose bamboo it meets, and an over-spun
 * throw comes back through your own.
 *
 * The grove is mirror-symmetric about the centre line and both seats throw from the same
 * point on it, so p1's problem is p2's problem reflected. That is not decoration: it is the
 * only reason a shared board can be fair when only one player is looking at it upright.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit (rule 8) and every angle
 * is radians. Headings are measured from straight up the board, positive towards +x, so a
 * mirrored shot is exactly the negated one.
 */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;
export const CENTRE_X = BOARD_WIDTH / 2;

/**
 * Where the shuriken leaves the hand.
 *
 * On the centre line, so neither seat throws from a better place than the other, and near
 * the bottom edge, so it lands under the thumb of whoever the board has turned to face.
 */
export const THROW_X = CENTRE_X;
export const THROW_Y = 892;

export const CANE_RADIUS = 21;
export const SHURIKEN_RADIUS = 10;
export const CANES_PER_SEAT = 6;
export const CANE_COUNT = CANES_PER_SEAT * 2;

/** Logical units a second. Constant: the blade neither speeds up nor slows down. */
export const SHURIKEN_SPEED = 820;

/** How far off straight-up a throw may be pointed, either way. */
export const MAX_AIM = 0.95;

/**
 * How hard a throw may be spun, in radians a second of turn on the flight path.
 *
 * At this speed it bends the path around a circle of radius `SHURIKEN_SPEED / MAX_SPIN` —
 * about 430 units, which is a little under half the board. Enough to reach behind a rock,
 * not enough to make aiming pointless.
 */
export const MAX_SPIN = 1.9;

/** After this long the blade has spent itself and drops, wherever it is. */
export const FLIGHT_LIMIT_SECONDS = 2;

/** Seconds the grove is held after a throw before the board turns to the other player. */
export const SETTLE_SECONDS = 0.55;

/**
 * Throws in a match, both seats together, after which it is settled on canes left standing.
 *
 * A structural limit rather than a clock: two players who never hit anything would otherwise
 * throw for ever, and no amount of waiting would change it. Twenty-two each is roughly twice
 * what a `normal` bot needs to clear six canes, so the cap decides only matches that deserve
 * to be decided that way.
 */
export const MAX_THROWS = 44;

/**
 * Substeps the flight is advanced in per fixed step.
 *
 * At 820 units a second a 60 Hz step covers 13.7 units, and a cane plus a blade is 31 across
 * — so a whole-step test would already be marginal, and a slow step would tunnel straight
 * through the bamboo. Four slices put every sample 3.4 units apart.
 */
export const FLIGHT_SUBSTEPS = 4;

/** The slice the bot pictures the flight in: one 60 Hz step divided the same way. */
export const SAMPLE_SECONDS = 1 / 60 / FLIGHT_SUBSTEPS;

/** How far outside the board the blade travels before it is gone for good. */
export const OUT_OF_BOUNDS = 40;

/** Radians a second the blade appears to turn. Cosmetic, but stepped so a replay is exact. */
export const BLADE_SPIN = 21;

const TAU = Math.PI * 2;

export interface Rock {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * The stones in the grove, which stop a blade dead.
 *
 * The middle one sits on the mirror line and the other two are a mirrored pair, so the
 * obstacle course is the same one seen from either side.
 *
 * They are what makes spin worth having, and the amount is measured rather than asserted.
 * Swept over 200 seeded groves at a 400 × 200 grid of throws, the outermost cane of each
 * six — slot 5 — is behind the far stone in **every** grove and needs between 0.04 and 0.76
 * rad/s of spin to reach, median 0.34; slots 2 and 4 need a touch of it on 18% and 20% of
 * groves; the other three never do. So no grove can be cleared without at least one spun
 * throw, and none is ever unwinnable: the worst cane in the worst grove measured wants 0.76
 * of the 1.9 available. The full table is in SPEC.md.
 */
export const ROCKS: readonly Rock[] = Object.freeze([
  Object.freeze({ x: CENTRE_X, y: 470, radius: 46 }),
  Object.freeze({ x: CENTRE_X - 168, y: 636, radius: 44 }),
  Object.freeze({ x: CENTRE_X + 168, y: 636, radius: 44 }),
]);

/**
 * Where one seat's six canes stand, as an offset from the centre line.
 *
 * Only half a grove is written down. The other half is this one mirrored, which is what
 * makes the two seats' tasks identical rather than merely similar — see {@link dressGrove}.
 */
const HALF_SLOTS: readonly { readonly dx: number; readonly y: number }[] = Object.freeze([
  Object.freeze({ dx: 92, y: 300 }),
  Object.freeze({ dx: 176, y: 246 }),
  Object.freeze({ dx: 258, y: 330 }),
  Object.freeze({ dx: 100, y: 432 }),
  Object.freeze({ dx: 182, y: 512 }),
  Object.freeze({ dx: 262, y: 424 }),
]);

/** How far a cane may wander from its slot, so no two matches are the same grove. */
export const SLOT_JITTER_X = 22;
export const SLOT_JITTER_Y = 26;

export type Phase = 'aiming' | 'flying' | 'settling' | 'over';

export interface Cane {
  x: number;
  y: number;
  /** Who loses it when it falls. Never changes: a cane belongs to a seat for the match. */
  readonly seat: SeatId;
  standing: boolean;
}

/** A blade in the air. Position, direction of travel, and the turn on the path. */
export interface Shot {
  x: number;
  y: number;
  /** Direction of travel in radians, measured from straight up the board towards +x. */
  heading: number;
  spin: number;
  elapsed: number;
}

export interface State {
  /** Indices 0–5 are p1's canes, 6–11 are p2's, each the mirror of the one six before it. */
  readonly canes: Cane[];
  phase: Phase;
  active: SeatId;
  /** Where the next throw points, and how hard it is spun. Both reset every turn. */
  aim: number;
  spin: number;
  readonly shot: Shot;
  /** The blade's own rotation, for the renderer. */
  blade: number;
  throws: number;
  /** Throws each seat has made, so a match can only end on a completed round. */
  p1Throws: number;
  p2Throws: number;
  settle: number;
  /** What the last throw did, for the renderer and the tests. */
  lastCut: number;
  lastOwnCut: number;
  lastBlocked: boolean;
  winner: Outcome;
}

/**
 * First seat to cut every one of the other's canes.
 *
 * `reduce-to-zero` over a tally of canes still standing, so "reduced to nothing" means the
 * same here as it does everywhere else in the collection, and two seats felled in the same
 * throw are a draw rather than whichever the code happened to look at first.
 */
const WIN_CONDITION: WinCondition = { kind: 'reduce-to-zero' };

/** Preallocated arguments for {@link resolve}: it is called on a step, so it may not allocate. */
const winTally = { p1: 0, p2: 0 };
const winOptions = { timeExpired: false };

export function createState(): State {
  const canes: Cane[] = [];
  for (let i = 0; i < CANE_COUNT; i += 1) {
    canes.push({ x: 0, y: 0, seat: i < CANES_PER_SEAT ? 'p1' : 'p2', standing: true });
  }
  return {
    canes,
    phase: 'aiming',
    active: 'p1',
    aim: 0,
    spin: 0,
    shot: { x: THROW_X, y: THROW_Y, heading: 0, spin: 0, elapsed: 0 },
    blade: 0,
    throws: 0,
    p1Throws: 0,
    p2Throws: 0,
    settle: 0,
    lastCut: 0,
    lastOwnCut: 0,
    lastBlocked: false,
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

/**
 * Plant the grove for a fresh match.
 *
 * Every slot is nudged from the seeded stream so no two matches are the same puzzle, and
 * **the same nudge is applied to both seats' canes**. A grove jittered independently would
 * hand one player an easier six than the other, which over a match is exactly the sort of
 * bias nobody notices and everybody feels.
 */
export function dressGrove(state: State, rng: Rng): void {
  for (let i = 0; i < CANES_PER_SEAT; i += 1) {
    const slot = HALF_SLOTS[i];
    if (slot === undefined) continue;
    const dx = slot.dx + (rng.float() * 2 - 1) * SLOT_JITTER_X;
    const y = slot.y + (rng.float() * 2 - 1) * SLOT_JITTER_Y;
    const mine = state.canes[i];
    const theirs = state.canes[i + CANES_PER_SEAT];
    if (mine === undefined || theirs === undefined) continue;
    mine.x = CENTRE_X - dx;
    mine.y = y;
    mine.standing = true;
    theirs.x = CENTRE_X + dx;
    theirs.y = y;
    theirs.standing = true;
  }
}

/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK
 * alternates it across the rounds of a best-of so first-mover advantage washes out
 * (#2466), and a game that assumed seat one would leave that rotation reaching nothing.
 * The default exists only so the rules tests can name a concrete side.
 */
export function resetState(state: State, rng: Rng, opener: SeatId = 'p1'): void {
  dressGrove(state, rng);
  state.phase = 'aiming';
  state.active = opener;
  state.aim = 0;
  state.spin = 0;
  state.shot.x = THROW_X;
  state.shot.y = THROW_Y;
  state.shot.heading = 0;
  state.shot.spin = 0;
  state.shot.elapsed = 0;
  state.blade = 0;
  state.throws = 0;
  state.p1Throws = 0;
  state.p2Throws = 0;
  state.settle = 0;
  state.lastCut = 0;
  state.lastOwnCut = 0;
  state.lastBlocked = false;
  state.winner = null;
}

/** Canes a seat still has standing. This is the seat's health, and the number the HUD shows. */
export function standingFor(state: Readonly<State>, seat: SeatId): number {
  let count = 0;
  for (const cane of state.canes) {
    if (cane.standing && cane.seat === seat) count += 1;
  }
  return count;
}

/** Point the next throw. Refused once the blade has left the hand. */
export function aimAt(state: State, angle: number): void {
  if (state.phase !== 'aiming') return;
  if (!Number.isFinite(angle)) return;
  state.aim = clamp(angle, -MAX_AIM, MAX_AIM);
}

/** Point the next throw at a place on the board, which is what a finger on the glass means. */
export function aimTowards(state: State, worldX: number, worldY: number): void {
  const dx = worldX - THROW_X;
  const dy = worldY - THROW_Y;
  if (dx === 0 && dy === 0) return;
  aimAt(state, Math.atan2(dx, -dy));
}

export function turnAim(state: State, delta: number): void {
  if (!Number.isFinite(delta)) return;
  aimAt(state, state.aim + delta);
}

export function spinTo(state: State, value: number): void {
  if (state.phase !== 'aiming') return;
  if (!Number.isFinite(value)) return;
  state.spin = clamp(value, -MAX_SPIN, MAX_SPIN);
}

export function addSpin(state: State, delta: number): void {
  if (!Number.isFinite(delta)) return;
  spinTo(state, state.spin + delta);
}

/**
 * Let go. Only the seat whose turn it is may, and only while the grove is waiting.
 *
 * Returns whether the blade actually left the hand, so a caller need not re-derive the phase
 * to know whether the throw counted.
 */
export function throwShuriken(state: State, seat: SeatId): boolean {
  if (state.phase !== 'aiming' || seat !== state.active) return false;
  const shot = state.shot;
  shot.x = THROW_X;
  shot.y = THROW_Y;
  shot.heading = state.aim;
  shot.spin = state.spin;
  shot.elapsed = 0;
  state.phase = 'flying';
  state.lastCut = 0;
  state.lastOwnCut = 0;
  state.lastBlocked = false;
  state.throws += 1;
  if (seat === 'p1') state.p1Throws += 1;
  else state.p2Throws += 1;
  return true;
}

/** Anything that can be walked along a flight path: the live blade, or a bot's imagined one. */
export interface ArcPoint {
  x: number;
  y: number;
  heading: number;
}

/** Below this, a spin is straight: the arc formula divides by it. */
const STRAIGHT = 1e-9;

/**
 * Advance a point along its flight arc, exactly.
 *
 * Constant speed and a constant turn rate make the path a circle, and the closed form of
 * that integral is written out here rather than approximated a step at a time. It is not
 * fussiness: Euler integration lands a curved throw in a different place at 60 Hz than at
 * 120 Hz, and rule 8 says a phone and a laptop step the identical match. Splitting a step
 * in two and taking both halves gives the same answer as taking it whole.
 *
 * Mirroring is exact too. Negating the heading and the spin negates dx and leaves dy alone,
 * so p2's mirrored throw is p1's throw reflected and neither seat has the easier grove.
 */
export function advanceArc(point: ArcPoint, spin: number, seconds: number): void {
  const start = point.heading;
  if (spin > -STRAIGHT && spin < STRAIGHT) {
    point.x += Math.sin(start) * SHURIKEN_SPEED * seconds;
    point.y -= Math.cos(start) * SHURIKEN_SPEED * seconds;
    return;
  }
  const end = start + spin * seconds;
  const radius = SHURIKEN_SPEED / spin;
  point.x += radius * (Math.cos(start) - Math.cos(end));
  point.y += radius * (Math.sin(start) - Math.sin(end));
  point.heading = end;
}

/** Whether a blade centred here is touching this cane. */
export function hitsCane(cane: Readonly<Cane>, x: number, y: number): boolean {
  const dx = x - cane.x;
  const dy = y - cane.y;
  const reach = CANE_RADIUS + SHURIKEN_RADIUS;
  return dx * dx + dy * dy <= reach * reach;
}

/** Whether a blade centred here has met a stone, which ends the throw where it stands. */
export function hitsRock(x: number, y: number): boolean {
  for (const rock of ROCKS) {
    const dx = x - rock.x;
    const dy = y - rock.y;
    const reach = rock.radius + SHURIKEN_RADIUS;
    if (dx * dx + dy * dy <= reach * reach) return true;
  }
  return false;
}

export function offBoard(x: number, y: number): boolean {
  return (
    x < -OUT_OF_BOUNDS ||
    x > BOARD_WIDTH + OUT_OF_BOUNDS ||
    y < -OUT_OF_BOUNDS ||
    y > BOARD_HEIGHT + OUT_OF_BOUNDS
  );
}

export interface StepResult {
  /** Canes cut on this step. */
  readonly cut: number;
  /** Set on the step the throw came to rest. */
  readonly landed: boolean;
  readonly blocked: boolean;
  /** Set on the step the turn passed to the other seat. */
  readonly handedOver: boolean;
}

const result = { cut: 0, landed: false, blocked: false, handedOver: false };

/** One fixed step. Allocates nothing: the result is one reused record. */
export function step(state: State, fixedDeltaSeconds: number): StepResult {
  result.cut = 0;
  result.landed = false;
  result.blocked = false;
  result.handedOver = false;
  if (state.phase === 'over') return result;

  state.blade += BLADE_SPIN * fixedDeltaSeconds;
  // Kept inside one turn, so a long match cannot drift into the range where a float can no
  // longer tell two nearby angles apart.
  if (state.blade > TAU) state.blade -= TAU;

  if (state.phase === 'settling') {
    state.settle -= fixedDeltaSeconds;
    if (state.settle <= 0) {
      handOver(state);
      result.handedOver = true;
    }
    return result;
  }

  if (state.phase !== 'flying') return result;

  const before = state.lastCut;
  if (fly(state, fixedDeltaSeconds)) {
    state.phase = 'settling';
    state.settle = SETTLE_SECONDS;
    result.landed = true;
    result.blocked = state.lastBlocked;
  }
  result.cut = state.lastCut - before;
  return result;
}

/** Carry the blade through one step, cutting what it meets. True once the throw is over. */
function fly(state: State, fixedDeltaSeconds: number): boolean {
  const shot = state.shot;
  const slice = fixedDeltaSeconds / FLIGHT_SUBSTEPS;
  for (let s = 0; s < FLIGHT_SUBSTEPS; s += 1) {
    advanceArc(shot, shot.spin, slice);
    shot.elapsed += slice;

    for (const cane of state.canes) {
      if (!cane.standing) continue;
      if (!hitsCane(cane, shot.x, shot.y)) continue;
      // A shuriken does not stop at bamboo, so one throw can take several — and can take
      // one of yours on the way through, which is the whole risk of a heavy spin.
      cane.standing = false;
      state.lastCut += 1;
      if (cane.seat === state.active) state.lastOwnCut += 1;
    }

    if (hitsRock(shot.x, shot.y)) {
      state.lastBlocked = true;
      return true;
    }
    if (offBoard(shot.x, shot.y)) return true;
    if (shot.elapsed >= FLIGHT_LIMIT_SECONDS) return true;
  }
  return false;
}

/**
 * Pass the grove to the other seat, and decide whether the match is over.
 *
 * **A match only ends on a completed round**, meaning both seats have thrown the same number
 * of times. p1 throws first, so ending the instant a seat is cleared would hand p1 every
 * match that was going to be close: the reply throw is what makes the first throw an
 * advantage of tempo rather than of a whole turn. Two seats cleared in the same round draw,
 * and that is a real result rather than a failure to finish.
 */
function handOver(state: State): void {
  state.active = otherOf(state.active);
  state.phase = 'aiming';
  // Every turn starts from straight up with no spin, for both seats alike. Carrying an aim
  // over would mean the second thrower inherits a sight the first one set.
  state.aim = 0;
  state.spin = 0;

  if (state.p1Throws !== state.p2Throws) return;
  winTally.p1 = standingFor(state, 'p1');
  winTally.p2 = standingFor(state, 'p2');
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

export interface BotProfile {
  /** How many directions it tries. A finer sweep is a better eye, not better information. */
  readonly aims: number;
  /** How many spins it tries against each direction. */
  readonly spins: number;
  /** Radians of aiming error, drawn once a turn and thrown with. */
  readonly aimError: number;
  /** Error on the spin it puts on, in radians a second. */
  readonly spinError: number;
  /** Seconds it takes over the throw. */
  readonly think: number;
  /** Chance a throw is a genuine blunder, with its error multiplied. */
  readonly wild: number;
  /** How much it minds cutting one of its own canes, per cane. */
  readonly caution: number;
}

/**
 * Three tiers, all of them throwing the same blade through the same grove.
 *
 * What differs is how carefully a tier looks and how well it throws what it chose — never
 * the physics, never the grove, and never anything a player cannot see (rule 6). The bot
 * reads cane positions, stone positions and the flight model, which is precisely what is
 * drawn on the screen in front of both players.
 *
 * **The error is drawn once a turn and then thrown with.** A fresh error every step averages
 * to zero sixty times a second and makes every tier identical — the mistake `bot-judgement`
 * in the SDK exists to document, made three times in this repository before it did.
 *
 * `hard` blunders one throw in twenty, and it has to. Given a grove it can solve exactly and
 * an opponent that solves it the same way, two `hard` bots simply trade perfect throws and
 * the match is decided by who threw first — measured at 42 draws in 60 with the blunder rate
 * at nothing. One bad throw in twenty is enough to tell two very good players apart, and it
 * is a great deal more like playing somebody very good than playing something perfect.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({
    aims: 9,
    spins: 5,
    aimError: 0.12,
    spinError: 0.55,
    think: 1.05,
    wild: 0.3,
    caution: 0.4,
  }),
  normal: Object.freeze({
    aims: 13,
    spins: 7,
    aimError: 0.05,
    spinError: 0.24,
    think: 0.8,
    wild: 0.13,
    caution: 1,
  }),
  hard: Object.freeze({
    aims: 19,
    spins: 9,
    aimError: 0.014,
    spinError: 0.06,
    think: 0.6,
    wild: 0.05,
    caution: 1.6,
  }),
});

/** What a blunder multiplies a tier's error by. */
export const WILD_MULTIPLIER = 3.5;

/**
 * The nudge that separates two shots which cut the same canes.
 *
 * Small enough that it can never outweigh a cane, and symmetric in the spin, so the tidier
 * of two equal throws wins and the tie-break is the same one from either seat.
 */
const TIDY = 0.02;

export interface ShotOutcome {
  /** Canes of the other seat this throw would cut. */
  enemy: number;
  /** Canes of the throwing seat it would cut on the way. */
  own: number;
  blocked: boolean;
  /** Where the blade came to rest, and how long it took. */
  x: number;
  y: number;
  seconds: number;
}

export function createShotOutcome(): ShotOutcome {
  return { enemy: 0, own: 0, blocked: false, x: THROW_X, y: THROW_Y, seconds: 0 };
}

/** Scratch for {@link predictShot}. Module-level so a search allocates nothing. */
const imagined: ArcPoint = { x: 0, y: 0, heading: 0 };

/**
 * What a throw would do, without throwing it.
 *
 * The same arc, the same slice length and the same cane test the live flight uses, so what
 * the bot pictures and what happens are the same calculation rather than two that drift.
 * `game.test.ts` throws several hundred shots and checks the two agree exactly.
 *
 * Canes are never touched: which ones have already been cut is carried in a bitmask, which
 * is also why the grove is capped at twelve.
 */
export function predictShot(
  state: Readonly<State>,
  seat: SeatId,
  aim: number,
  spin: number,
  out: ShotOutcome,
): void {
  imagined.x = THROW_X;
  imagined.y = THROW_Y;
  imagined.heading = aim;
  out.enemy = 0;
  out.own = 0;
  out.blocked = false;
  out.seconds = 0;
  let taken = 0;

  for (;;) {
    advanceArc(imagined, spin, SAMPLE_SECONDS);
    out.seconds += SAMPLE_SECONDS;

    for (let i = 0; i < state.canes.length; i += 1) {
      const bit = 1 << i;
      if ((taken & bit) !== 0) continue;
      const cane = state.canes[i];
      if (cane === undefined || !cane.standing) continue;
      if (!hitsCane(cane, imagined.x, imagined.y)) continue;
      taken |= bit;
      if (cane.seat === seat) out.own += 1;
      else out.enemy += 1;
    }

    if (hitsRock(imagined.x, imagined.y)) {
      out.blocked = true;
      break;
    }
    if (offBoard(imagined.x, imagined.y)) break;
    if (out.seconds >= FLIGHT_LIMIT_SECONDS) break;
  }

  out.x = imagined.x;
  out.y = imagined.y;
}

export interface BotPlan {
  aim: number;
  spin: number;
  /** Seconds left of the pause before it lets go. */
  think: number;
  /** Whether it has looked at the grove yet this turn. */
  ready: boolean;
}

export function createBotPlan(): BotPlan {
  return { aim: 0, spin: 0, think: 0, ready: false };
}

export function resetBotPlan(plan: BotPlan): void {
  plan.aim = 0;
  plan.spin = 0;
  plan.think = 0;
  plan.ready = false;
}

const candidate = createShotOutcome();

/**
 * Choose a throw. Called once a turn, never once a step.
 *
 * It sweeps directions against spins, imagines each one, and keeps the best — cutting the
 * other seat's bamboo, less what it would cost in its own. Then it draws its error for the
 * turn and commits to throwing that, mistake and all.
 *
 * **The sweep runs outward from the target side rather than left to right**, and that is a
 * fairness fix rather than a detail. Ties are everywhere here: most throws cut exactly one
 * cane. Broken by candidate order, p1 would settle every tie towards one edge of its fan and
 * p2 towards the other edge of *its own*, which is not the same shot reflected — so the two
 * seats would play measurably different games on a grove built to be identical.
 */
export function planShot(
  state: Readonly<State>,
  seat: SeatId,
  difficulty: BotDifficulty,
  plan: BotPlan,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  // p1's targets lie to the left of the centre line and p2's to the right, so each seat
  // sweeps towards the other's grove and the two searches are exact mirrors.
  const side = seat === 'p1' ? -1 : 1;
  let bestScore = -Infinity;
  let bestAim = 0;
  let bestSpin = 0;

  for (let a = 0; a < profile.aims; a += 1) {
    const aim = side * (-MAX_AIM + (2 * MAX_AIM * a) / (profile.aims - 1));
    for (let s = 0; s < profile.spins; s += 1) {
      const spin = side * (-MAX_SPIN + (2 * MAX_SPIN * s) / (profile.spins - 1));
      predictShot(state, seat, aim, spin, candidate);
      const score = candidate.enemy - candidate.own * profile.caution - Math.abs(spin) * TIDY;
      if (score > bestScore) {
        bestScore = score;
        bestAim = aim;
        bestSpin = spin;
      }
    }
  }

  // Three draws every turn whatever happens, so the stream stays in step whether or not a
  // blunder comes up and a replay from the seed is exact.
  //
  // The error is taken through the same mirror as the sweep. It is drawn from a symmetric
  // distribution, so turning it round changes nothing about how badly the bot throws — but
  // it makes p2 with a given draw the exact reflection of p1 with that draw, which is the
  // only way two seats sharing one seeded stream can be shown to be playing one game.
  const wild = rng.bool(profile.wild) ? WILD_MULTIPLIER : 1;
  const aimSlip = side * misjudgement(rng.float(), profile.aimError * wild);
  const spinSlip = side * misjudgement(rng.float(), profile.spinError * wild);
  plan.aim = clamp(bestAim + aimSlip, -MAX_AIM, MAX_AIM);
  plan.spin = clamp(bestSpin + spinSlip, -MAX_SPIN, MAX_SPIN);
  plan.think = profile.think;
  plan.ready = true;
}

/**
 * A bot's turn, one step at a time: look once, line the throw up, take a moment over it.
 *
 * Returns true on the step it lets go, so the caller throws and resets the plan — the same
 * shape every bot in the collection uses, and the reason the tests and the game drive the
 * bot through exactly one path rather than two that can drift.
 *
 * The plan is made once and then thrown with. Re-planning every step would average the
 * error away sixty times a second and make all three tiers identical.
 */
export function botTurn(
  state: State,
  seat: SeatId,
  difficulty: BotDifficulty,
  plan: BotPlan,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (state.phase !== 'aiming' || state.active !== seat) return false;
  if (!plan.ready) {
    planShot(state, seat, difficulty, plan, rng);
    // The choice goes on the sight, so a player watching sees the bot line the throw up
    // rather than a blade appearing out of nowhere.
    aimAt(state, plan.aim);
    spinTo(state, plan.spin);
  }
  plan.think -= fixedDeltaSeconds;
  return plan.think <= 0;
}
