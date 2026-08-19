import { circleCircle, createContact, set } from '@duelbox/engine';
import type { Rng, SeatId, Vec2 } from '@duelbox/engine';

/**
 * Air hockey, as pure rules: bodies, the table, and the three moves a step is made of.
 *
 * No rendering, no wall clock, no DOM. The game, the bot and the balance harness all
 * drive this same file, so what the harness measures is what the player feels.
 *
 * Every length is a logical unit and every speed a logical unit per second. p1 defends
 * the bottom end (y = height) and p2 the top (y = 0), matching the horizontal zone
 * split the manifest declares.
 */

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Table {
  width: number;
  height: number;
  goalWidth: number;
  wallRestitution: number;
  /**
   * Air resistance as a decay RATE in 1/s, not a per-step multiplier. Velocity is
   * multiplied by e^(-friction * dt) and the position uses the matching analytic
   * integral, so two steps of h and one step of 2h land on identical numbers and a
   * 144 Hz laptop plays the same match as a 60 Hz phone.
   */
  friction: number;
}

/** Which seat SCORED, i.e. whose goal was NOT entered. */
export type GoalResult = 'none' | 'p1' | 'p2';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const PUCK_RADIUS = 18;
export const MALLET_RADIUS = 34;

export const TABLE: Table = {
  width: 600,
  height: 1000,
  goalWidth: 200,
  wallRestitution: 0.92,
  friction: 0.4,
};

/**
 * Ceiling on puck speed. One step at the simulation rate must move the puck less than
 * the puck-plus-mallet contact distance, or a hard hit would pass straight through a
 * mallet between two discrete tests.
 */
export const MAX_PUCK_SPEED = 1600;

/** Ceiling on mallet speed. A pointer that jumps further than this drags its mallet. */
export const MALLET_MAX_SPEED = 1400;

/**
 * The rate the fixed loop always runs at. {@link botTarget} takes no dt, so its
 * top-speed cap is measured against this step rather than against the caller's.
 */
export const STEP_SECONDS = 1 / 60;

/** Bounce the puck keeps off a mallet face, before the mallet's own momentum is added. */
const PUCK_RESTITUTION = 0.95;

/** Share of the mallet's closing speed handed to the puck, so a swing beats a wall. */
const MALLET_TRANSFER = 1.6;

/** Floor on separation speed, so a puck can never be trapped underneath a mallet. */
const MIN_KNOCK_SPEED = 45;

/** How far off its own goal line a defending bot sits. */
const GUARD_DEPTH = 140;

/** Distance at which a bot stops defending and goes for the puck. */
const STRIKE_RANGE = 240;

/** How far past the puck a bot aims when it swings, so the mallet drives through. */
const STRIKE_FOLLOW = 95;

interface BotProfile {
  /** Seconds of stale information the bot acts on. */
  readonly reactionSeconds: number;
  /** Logical units of noise on the aim point. */
  readonly aimError: number;
  /** Logical units per second the bot may ask its mallet to travel. */
  readonly topSpeed: number;
}

/**
 * Difficulty is reaction delay, aim error and top speed and nothing else: every bot
 * reads the same puck the player reads, and none of them exceeds {@link MALLET_MAX_SPEED}.
 */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { reactionSeconds: 0.24, aimError: 80, topSpeed: 380 },
  normal: { reactionSeconds: 0.11, aimError: 34, topSpeed: 620 },
  hard: { reactionSeconds: 0.04, aimError: 12, topSpeed: 900 },
};

/** Scratch contact for {@link collidePuckMallet}. Module scope so a step allocates nothing. */
const contact = createContact();

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Mirror `value` back and forth into [min, max], which is what a straight line does
 * when it bounces between two parallel walls.
 */
function foldIntoBand(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return min;
  const period = span * 2;
  let t = (value - min) % period;
  if (t < 0) t += period;
  return t <= span ? min + t : min + (period - t);
}

/**
 * Advance the puck one step and report which seat scored.
 *
 * The end walls stop the puck everywhere except the goal mouth, and a puck is only in
 * the mouth once its whole disc fits between the posts — clipping a post bounces, which
 * is both what the picture shows and a rule with no ambiguous middle case.
 */
export function stepPuck(puck: Body, table: Table, dt: number): GoalResult {
  const speedSq = puck.vx * puck.vx + puck.vy * puck.vy;
  if (speedSq > MAX_PUCK_SPEED * MAX_PUCK_SPEED) {
    const s = MAX_PUCK_SPEED / Math.sqrt(speedSq);
    puck.vx *= s;
    puck.vy *= s;
  }

  const decay = Math.exp(-table.friction * dt);
  // Analytic integral of v0 * e^(-friction * t) over the step, so position composes
  // across step sizes exactly as velocity does.
  const travel = table.friction > 0 ? (1 - decay) / table.friction : dt;
  puck.x += puck.vx * travel;
  puck.y += puck.vy * travel;
  puck.vx *= decay;
  puck.vy *= decay;

  const r = puck.radius;
  const restitution = table.wallRestitution;

  if (puck.x - r < 0) {
    puck.x = r;
    puck.vx = Math.abs(puck.vx) * restitution;
  } else if (puck.x + r > table.width) {
    puck.x = table.width - r;
    puck.vx = -Math.abs(puck.vx) * restitution;
  }

  const halfGoal = table.goalWidth / 2;
  const centreX = table.width / 2;
  const inMouth = puck.x - r >= centreX - halfGoal && puck.x + r <= centreX + halfGoal;

  if (puck.y - r < 0) {
    if (!inMouth) {
      puck.y = r;
      puck.vy = Math.abs(puck.vy) * restitution;
    } else if (puck.y <= 0) {
      return 'p1';
    }
  } else if (puck.y + r > table.height) {
    if (!inMouth) {
      puck.y = table.height - r;
      puck.vy = -Math.abs(puck.vy) * restitution;
    } else if (puck.y >= table.height) {
      return 'p2';
    }
  }

  return 'none';
}

/**
 * Move a mallet toward a target and derive its velocity from the movement it actually
 * made, so a mallet held against a wall carries no momentum into the puck.
 *
 * The seat's half is a hard constraint applied to the target and again to the result:
 * a mallet may never touch the far side of the centre line, however the target is aimed.
 */
export function stepMallet(
  mallet: Body,
  targetX: number,
  targetY: number,
  table: Table,
  seat: SeatId,
  dt: number,
): void {
  const r = mallet.radius;
  const half = table.height / 2;
  const minX = r;
  const maxX = table.width - r;
  const minY = seat === 'p1' ? half + r : r;
  const maxY = seat === 'p1' ? table.height - r : half - r;

  const fromX = mallet.x;
  const fromY = mallet.y;

  let dx = 0;
  let dy = 0;
  if (dt > 0) {
    dx = clamp(targetX, minX, maxX) - fromX;
    dy = clamp(targetY, minY, maxY) - fromY;
    const distSq = dx * dx + dy * dy;
    const maxStep = MALLET_MAX_SPEED * dt;
    if (distSq > maxStep * maxStep) {
      const s = maxStep / Math.sqrt(distSq);
      dx *= s;
      dy *= s;
    }
  }

  const toX = clamp(fromX + dx, minX, maxX);
  const toY = clamp(fromY + dy, minY, maxY);
  mallet.vx = dt > 0 ? (toX - fromX) / dt : 0;
  mallet.vy = dt > 0 ? (toY - fromY) / dt : 0;
  mallet.x = toX;
  mallet.y = toY;
}

/**
 * Resolve one puck-mallet contact and report whether it happened, for the sound and
 * juice layer. The mallet is treated as infinitely massive — a player's hand does not
 * recoil — so the puck takes the whole exchange.
 */
export function collidePuckMallet(puck: Body, mallet: Body): boolean {
  if (!circleCircle(contact, puck, mallet)) return false;

  const nx = contact.normalX;
  const ny = contact.normalY;
  puck.x += nx * contact.depth;
  puck.y += ny * contact.depth;

  const vn = puck.vx * nx + puck.vy * ny;
  if (vn < 0) {
    const j = (1 + PUCK_RESTITUTION) * vn;
    puck.vx -= j * nx;
    puck.vy -= j * ny;
  }

  // The normal points from the mallet out to the puck, so a positive component is a
  // mallet driving into the puck: that is what makes a swing hit harder than a block.
  const mn = mallet.vx * nx + mallet.vy * ny;
  if (mn > 0) {
    puck.vx += MALLET_TRANSFER * mn * nx;
    puck.vy += MALLET_TRANSFER * mn * ny;
  }

  const out = puck.vx * nx + puck.vy * ny;
  if (out < MIN_KNOCK_SPEED) {
    const deficit = MIN_KNOCK_SPEED - out;
    puck.vx += deficit * nx;
    puck.vy += deficit * ny;
  }

  return true;
}

/**
 * Where a bot wants its mallet next, written into `out`.
 *
 * The bot reads the puck's current position and velocity and nothing else — no future
 * state, no opponent intent, no privileged physics. Its difficulty lives entirely in
 * how stale that reading is, how much noise it puts on the aim point, and how fast it
 * is allowed to ask its mallet to move.
 */
export function botTarget(
  out: Vec2,
  puck: Body,
  mallet: Body,
  table: Table,
  seat: SeatId,
  difficulty: BotDifficulty,
  rng: Rng,
): Vec2 {
  const profile = BOT_PROFILES[difficulty];

  // Acting on where the puck WAS is strictly less information than the player at the
  // other end has, never more.
  const lag = profile.reactionSeconds;
  const px = puck.x - puck.vx * lag;
  const py = puck.y - puck.vy * lag;

  const half = table.height / 2;
  const intoOwnHalf = seat === 'p1' ? 1 : -1;
  const ownGoalY = seat === 'p1' ? table.height : 0;
  const guardY = ownGoalY - intoOwnHalf * GUARD_DEPTH;

  const r = mallet.radius;
  const minX = r;
  const maxX = table.width - r;
  const minY = seat === 'p1' ? half + r : r;
  const maxY = seat === 'p1' ? table.height - r : half - r;

  let aimX = px;
  let aimY = guardY;

  if (puck.vy * intoOwnHalf > 1) {
    const t = (guardY - py) / puck.vy;
    if (t > 0) {
      aimX = foldIntoBand(px + puck.vx * t, puck.radius, table.width - puck.radius);
    }
  }

  const inOwnHalf = seat === 'p1' ? py >= half : py <= half;
  const gapX = px - mallet.x;
  const gapY = py - mallet.y;
  if (inOwnHalf && gapX * gapX + gapY * gapY < STRIKE_RANGE * STRIKE_RANGE) {
    const shootY = seat === 'p1' ? 0 : table.height;
    // Unit vector from the goal being shot at out to the puck: the side a mallet has
    // to be on for a push to send the puck goalwards.
    let ux = px - table.width / 2;
    let uy = py - shootY;
    const len = Math.sqrt(ux * ux + uy * uy);
    if (len > 0) {
      ux /= len;
      uy /= len;
    } else {
      ux = 0;
      uy = intoOwnHalf;
    }
    if ((mallet.x - px) * ux + (mallet.y - py) * uy > 0) {
      aimX = px - ux * STRIKE_FOLLOW;
      aimY = py - uy * STRIKE_FOLLOW;
    } else {
      const reach = puck.radius + mallet.radius;
      aimX = px + ux * reach;
      aimY = py + uy * reach;
    }
  }

  const error = profile.aimError;
  aimX += (rng.float() * 2 - 1) * error;
  aimY += (rng.float() * 2 - 1) * error * 0.34;

  let dx = clamp(aimX, minX, maxX) - mallet.x;
  let dy = clamp(aimY, minY, maxY) - mallet.y;
  const maxOffer = profile.topSpeed * STEP_SECONDS;
  const distSq = dx * dx + dy * dy;
  if (distSq > maxOffer * maxOffer) {
    const s = maxOffer / Math.sqrt(distSq);
    dx *= s;
    dy *= s;
  }

  return set(out, clamp(mallet.x + dx, minX, maxX), clamp(mallet.y + dy, minY, maxY));
}
