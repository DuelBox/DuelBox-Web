import { circleCircle, createContact, set } from '@duelbox/engine';
import type { Rng, Vec2 } from '@duelbox/engine';

/**
 * Sumo Push, as pure rules: two wrestlers, the ring they stand on, and the four moves a
 * step is made of.
 *
 * No rendering, no wall clock, no DOM. The game, the bot and the balance harness all
 * drive this same file, so what the harness measures is what the player feels.
 *
 * Every length is a logical unit and every speed a logical unit per second. The ring is
 * a disc in the middle of the square play area and belongs to neither seat, which is the
 * shared-board split the manifest declares.
 */

export interface Wrestler {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Must be positive and finite: it divides the collision impulse. */
  mass: number;
}

export interface Arena {
  centreX: number;
  centreY: number;
  radius: number;
  /** Logical units of radius lost per second, which is what stops a bout stalling. */
  shrinkPerSecond: number;
  /** The ring never shrinks past this. See {@link MIN_RADIUS} for why it is so small. */
  minRadius: number;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const WRESTLER_RADIUS = 46;
export const WRESTLER_MASS = 1;

export const ARENA_CENTRE_X = 400;
export const ARENA_CENTRE_Y = 400;
export const START_RADIUS = 330;

/**
 * Smaller than one wrestler's radius, and that is the whole anti-stall guarantee: two
 * separated wrestlers stand at least {@link WRESTLER_RADIUS} * 2 apart, so at least one
 * of them is more than {@link WRESTLER_RADIUS} from the middle, so once the ring is
 * narrower than that somebody is out. No amount of hugging the centre can hold a bout
 * open, whether the seats are played by people or by bots.
 */
export const MIN_RADIUS = 34;

export const SHRINK_PER_SECOND = 20;

/** Drive strength in logical units per second squared, identical for both seats. */
export const DRIVE_ACCELERATION = 1500;

/**
 * Friction as a decay RATE in 1/s, not a per-step multiplier. Velocity is multiplied by
 * e^(-friction * dt) and the position uses the matching analytic integral, so two steps
 * of h and one step of 2h land on identical numbers and a 144 Hz laptop plays the same
 * match as a 60 Hz phone.
 */
export const FRICTION = 2.4;

/**
 * Ceiling on speed, applied to the velocity a step STARTS with. One step at the
 * simulation rate must move a wrestler less than the pair's contact distance, or a hard
 * shove would pass straight through the opponent between two discrete tests. The drive's
 * own terminal speed is {@link DRIVE_ACCELERATION} / {@link FRICTION}, which is below the
 * cap, so a step can never restore a speed the cap has just trimmed.
 */
export const MAX_SPEED = 1000;

/** Perfectly elastic: two equal masses swap the normal part of their velocity. */
const PUSH_RESTITUTION = 1;

/** Fraction of the ring's radius past which a bot starts pulling back towards the middle. */
const SAFE_EDGE = 0.55;

/** Fraction past which an opponent is close enough to falling out to be worth charging. */
const CHARGE_EDGE = 0.7;

/**
 * How much nearer the edge than itself the opponent has to be before a bot abandons its
 * own footing. Without the margin a bot on the brink would charge an opponent a hair
 * further out and take a double ring-out, which scores for both seats.
 */
const CHARGE_MARGIN = 0.15;

interface BotProfile {
  /** Seconds of stale information the bot acts on. */
  readonly reactionSeconds: number;
  /** Radians of noise on the steering direction. */
  readonly steerError: number;
}

/**
 * Difficulty is reaction delay and steering error and nothing else: every bot reads the
 * same two discs and the same ring the player reads, and drives with the identical
 * acceleration, friction and speed cap.
 */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { reactionSeconds: 0.32, steerError: 0.55 },
  normal: { reactionSeconds: 0.15, steerError: 0.25 },
  hard: { reactionSeconds: 0.05, steerError: 0.08 },
};

/** Scratch contact for {@link collideWrestlers}. Module scope so a step allocates nothing. */
const contact = createContact();

/** Allocates, so setup only. */
export function createWrestler(x: number, y: number): Wrestler {
  return { x, y, vx: 0, vy: 0, radius: WRESTLER_RADIUS, mass: WRESTLER_MASS };
}

/** Allocates, so setup only. */
export function createArena(): Arena {
  return {
    centreX: ARENA_CENTRE_X,
    centreY: ARENA_CENTRE_Y,
    radius: START_RADIUS,
    shrinkPerSecond: SHRINK_PER_SECOND,
    minRadius: MIN_RADIUS,
  };
}

/**
 * Share of the drive a wrestler can put down, in [0, 1].
 *
 * A wrestler whose disc hangs over the edge has that much less clay underneath to push
 * against, so leaning out costs control rather than being free. It is sampled once from
 * the position the step starts at, which is the only thing that makes a step's answer
 * depend on the step size, and only for a wrestler already over the edge.
 */
export function traction(w: Wrestler, arena: Arena): number {
  const dx = w.x - arena.centreX;
  const dy = w.y - arena.centreY;
  const overhang = Math.sqrt(dx * dx + dy * dy) + w.radius - arena.radius;
  if (overhang <= 0) return 1;
  const footing = 1 - overhang / (w.radius * 2);
  return footing > 0 ? footing : 0;
}

/**
 * Advance one wrestler by `dt`, driven towards `(inputX, inputY)`.
 *
 * The input is a direction, not a speed: anything longer than the unit circle is
 * rescaled, so a diagonal push is no faster than a straight one, while a stick held
 * gently stays gentle.
 */
export function stepWrestler(
  w: Wrestler,
  inputX: number,
  inputY: number,
  arena: Arena,
  dt: number,
): void {
  let vx = w.vx;
  let vy = w.vy;
  const speedSq = vx * vx + vy * vy;
  if (speedSq > MAX_SPEED * MAX_SPEED) {
    const trim = MAX_SPEED / Math.sqrt(speedSq);
    vx *= trim;
    vy *= trim;
  }

  let dirX = inputX;
  let dirY = inputY;
  const lenSq = dirX * dirX + dirY * dirY;
  if (lenSq > 1) {
    const inv = 1 / Math.sqrt(lenSq);
    dirX *= inv;
    dirY *= inv;
  }

  const drive = DRIVE_ACCELERATION * traction(w, arena);
  const decay = Math.exp(-FRICTION * dt);
  // v' = drive - friction * v, solved over the whole step rather than stepped by Euler,
  // with the position taken from the matching integral, so the step size never changes
  // the answer and a resting wrestler is the case where the drive term is zero.
  const terminalX = (dirX * drive) / FRICTION;
  const terminalY = (dirY * drive) / FRICTION;
  const travel = (1 - decay) / FRICTION;
  w.x += terminalX * dt + (vx - terminalX) * travel;
  w.y += terminalY * dt + (vy - terminalY) * travel;
  w.vx = terminalX + (vx - terminalX) * decay;
  w.vy = terminalY + (vy - terminalY) * decay;
}

/**
 * Resolve one wrestler-against-wrestler contact and report whether it happened, for the
 * sound and juice layer.
 *
 * The overlap is undone before the impulse and shared by mass, so a pair that arrives
 * overlapping can never end the step still overlapping and grind against each other.
 * The impulse is proportional to the closing speed, which is what makes a charge shove
 * harder than a lean.
 */
export function collideWrestlers(a: Wrestler, b: Wrestler): boolean {
  if (!circleCircle(contact, a, b)) return false;

  const nx = contact.normalX;
  const ny = contact.normalY;
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const invSum = invA + invB;

  const depth = contact.depth;
  if (depth > 0) {
    const shareA = (invA / invSum) * depth;
    const shareB = depth - shareA;
    a.x += nx * shareA;
    a.y += ny * shareA;
    b.x -= nx * shareB;
    b.y -= ny * shareB;
  }

  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  // Already separating: an impulse here would pull them back together.
  if (closing >= 0) return true;

  const j = (-(1 + PUSH_RESTITUTION) * closing) / invSum;
  a.vx += j * invA * nx;
  a.vy += j * invA * ny;
  b.vx -= j * invB * nx;
  b.vy -= j * invB * ny;
  return true;
}

/** Close the ring in, never past {@link Arena.minRadius}. */
export function shrinkArena(arena: Arena, dt: number): void {
  const next = arena.radius - arena.shrinkPerSecond * dt;
  arena.radius = next < arena.minRadius ? arena.minRadius : next;
}

/**
 * Out once the wrestler's CENTRE has left the ring, not once its rim has.
 *
 * Leaning out over the edge is then a legal and useful move — it is how a wrestler
 * absorbs a charge without being carried off — and the losing line is the one point of a
 * disc a player can judge exactly. A centre lying exactly on the boundary is still in.
 */
export function isOut(w: Wrestler, arena: Arena): boolean {
  const dx = w.x - arena.centreX;
  const dy = w.y - arena.centreY;
  return dx * dx + dy * dy > arena.radius * arena.radius;
}

/**
 * The direction a bot wants to drive, written into `out` as a unit vector or zero.
 *
 * The bot reads the opponent's current position and velocity and the ring, and nothing
 * else — no future state, no seat intent, no privileged physics. Its difficulty lives
 * entirely in how stale that reading is and how much noise it puts on its steering; the
 * vector it returns is the same length a player's held stick produces.
 */
export function botInput(
  out: Vec2,
  self: Wrestler,
  other: Wrestler,
  arena: Arena,
  difficulty: BotDifficulty,
  rng: Rng,
): Vec2 {
  const profile = BOT_PROFILES[difficulty];

  // Acting on where the opponent WAS is strictly less information than the player
  // opposite has, never more.
  const lag = profile.reactionSeconds;
  const targetX = other.x - other.vx * lag;
  const targetY = other.y - other.vy * lag;

  const selfX = self.x - arena.centreX;
  const selfY = self.y - arena.centreY;
  const selfDist = Math.sqrt(selfX * selfX + selfY * selfY);
  const otherX = targetX - arena.centreX;
  const otherY = targetY - arena.centreY;
  const otherDist = Math.sqrt(otherX * otherX + otherY * otherY);
  const selfEdge = selfDist / arena.radius;
  const otherEdge = otherDist / arena.radius;

  let aimX = 0;
  let aimY = 0;
  const reachX = targetX - self.x;
  const reachY = targetY - self.y;
  const reach = Math.sqrt(reachX * reachX + reachY * reachY);
  if (reach > 0) {
    aimX = reachX / reach;
    aimY = reachY / reach;
  }

  let retreat = (selfEdge - SAFE_EDGE) / (1 - SAFE_EDGE);
  if (retreat < 0) retreat = 0;
  else if (retreat > 1) retreat = 1;
  // A bot still finishes the push when the opponent is the one about to go out: that
  // trade is exactly what wins a round.
  if (otherEdge > CHARGE_EDGE && otherEdge - selfEdge > CHARGE_MARGIN) retreat = 0;
  if (retreat > 0 && selfDist > 0) {
    const inwardX = -selfX / selfDist;
    const inwardY = -selfY / selfDist;
    aimX = aimX * (1 - retreat) + inwardX * retreat;
    aimY = aimY * (1 - retreat) + inwardY * retreat;
  }

  // One draw on every path, whatever the branch above chose, so a replay of the same
  // bout stays in step with the generator.
  const wobble = (rng.float() * 2 - 1) * profile.steerError;
  const cos = Math.cos(wobble);
  const sin = Math.sin(wobble);
  const steerX = aimX * cos - aimY * sin;
  const steerY = aimX * sin + aimY * cos;

  const steer = Math.sqrt(steerX * steerX + steerY * steerY);
  if (steer === 0) return set(out, 0, 0);
  return set(out, steerX / steer, steerY / steer);
}
