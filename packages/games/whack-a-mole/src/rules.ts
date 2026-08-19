import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Whack a Mole as pure rules: a fixed pool of moles, the holes they rise from, and the
 * three moves a step is made of — age, strike, spawn.
 *
 * No rendering, no wall clock, no DOM. A hole is a plain index here; where that hole sits
 * in logical units is the game's business, not the rules'. The game, the bot and the
 * balance harness all drive this same file, so there is one definition of what a hit is.
 */

export const GRID_COLUMNS = 4;
export const GRID_ROWS = 3;
export const HOLE_COUNT = GRID_COLUMNS * GRID_ROWS;

/**
 * Mole slots the pool holds, and therefore the hard ceiling on how many can be up at
 * once. Sized above the busiest spawn rate the ramp reaches so the cap never quietly
 * becomes the rate limiter, and well below {@link HOLE_COUNT} so the board stays readable.
 */
export const MOLE_POOL = 8;

/** A free slot parks here. It is not a hole, and nothing can be struck on it. */
export const NO_HOLE = -1;

export interface Mole {
  /** Hole this mole occupies, or {@link NO_HOLE} while the slot is free. */
  hole: number;
  seat: SeatId;
  /** Seconds this mole has been up. */
  upSeconds: number;
  /** Seconds it stays up before it retires itself. */
  lifetime: number;
}

/** Own colour scores, the other seat's costs a point, an empty hole does nothing. */
export type HitResult = 'own' | 'other' | 'miss';

export type MoleShape = 'round' | 'horned';

/**
 * The silhouette each seat's mole wears.
 *
 * The whole mechanic is telling the two colours apart at speed, so colour alone cannot
 * carry it: p1's mole is round with big ears, p2's is square with horns, and the two are
 * separable from the outline with no colour at all. A renderer that draws both seats the
 * same shape has broken the game for a colour-blind player, not merely styled it badly.
 */
export const MOLE_SHAPE: Readonly<Record<SeatId, MoleShape>> = { p1: 'round', p2: 'horned' };

/** Shortest and longest a mole stays up. Only the rate ramps; the window never shrinks. */
export const MIN_LIFETIME = 0.8;
export const MAX_LIFETIME = 1.4;

/** Moles per second at the first step of a match. */
export const BASE_SPAWN_RATE = 1.8;

/** Moles per second once the ramp has run out. */
export const MAX_SPAWN_RATE = 4.5;

/** Seconds of play over which the rate climbs from base to max. */
export const RAMP_SECONDS = 40;

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds a mole must have been up before the bot has noticed it at all. */
  readonly reactionSeconds: number;
  /** Chance a swing lands on some other hole entirely. */
  readonly errorChance: number;
  /** Seconds between swings — a hand's speed, and never faster than a thumb. */
  readonly strikeSeconds: number;
}

/**
 * Difficulty is reaction delay, error and swing speed and nothing else. Every bot reads
 * the same board the player reads, through {@link botTarget}, and none of them may act on
 * a mole sooner than its own reaction delay allows.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reactionSeconds: 0.46, errorChance: 0.24, strikeSeconds: 0.6 },
  normal: { reactionSeconds: 0.3, errorChance: 0.1, strikeSeconds: 0.4 },
  hard: { reactionSeconds: 0.18, errorChance: 0.03, strikeSeconds: 0.26 },
});

/**
 * Scratch for the free-hole draw. Module scope rather than a local because {@link spawn}
 * is called from the fixed-step update, which may not allocate. Sized for the grid this
 * game plays on; a larger `holes` argument is clamped to it rather than growing it.
 */
const freeHoles: number[] = new Array<number>(HOLE_COUNT).fill(0);

/** A fresh pool, every slot free. Allocates, so call it from init() and never per step. */
export function createMoles(): Mole[] {
  const moles: Mole[] = [];
  for (let i = 0; i < MOLE_POOL; i += 1) {
    moles.push({ hole: NO_HOLE, seat: 'p1', upSeconds: 0, lifetime: 0 });
  }
  return moles;
}

/** Sends every mole down without touching the pool itself. */
export function retireAll(moles: readonly Mole[]): void {
  for (let i = 0; i < moles.length; i += 1) {
    const mole = moles[i];
    if (mole === undefined) continue;
    mole.hole = NO_HOLE;
    mole.upSeconds = 0;
    mole.lifetime = 0;
  }
}

/** Slot holding the mole in `hole`, or -1. {@link NO_HOLE} never matches a free slot. */
export function moleAt(moles: readonly Mole[], hole: number): number {
  if (hole < 0) return -1;
  for (let i = 0; i < moles.length; i += 1) {
    const mole = moles[i];
    if (mole !== undefined && mole.hole === hole) return i;
  }
  return -1;
}

export function upCount(moles: readonly Mole[]): number {
  let count = 0;
  for (let i = 0; i < moles.length; i += 1) {
    const mole = moles[i];
    if (mole !== undefined && mole.hole !== NO_HOLE) count += 1;
  }
  return count;
}

/** Moles per second at this point in a match, climbing so a long match keeps getting harder. */
export function spawnRateAt(elapsedSeconds: number): number {
  let t = elapsedSeconds / RAMP_SECONDS;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return BASE_SPAWN_RATE + (MAX_SPAWN_RATE - BASE_SPAWN_RATE) * t;
}

/**
 * Age every mole that is up and retire the ones whose lifetime has run out. Returns how
 * many went down, for the sound and juice layer.
 */
export function step(moles: readonly Mole[], dt: number): number {
  let retired = 0;
  for (let i = 0; i < moles.length; i += 1) {
    const mole = moles[i];
    if (mole === undefined || mole.hole === NO_HOLE) continue;
    mole.upSeconds += dt;
    if (mole.upSeconds >= mole.lifetime) {
      mole.hole = NO_HOLE;
      retired += 1;
    }
  }
  return retired;
}

/**
 * Raise at most one mole of a random seat colour in a free hole, and report which hole it
 * took or {@link NO_HOLE} when nothing rose.
 *
 * `spawnRate` is a rate in moles per second, not a per-step chance: the draw is the
 * probability that a Poisson process of that rate fires at least once in `dt`, so the
 * density of moles is the same whatever step size the loop runs at. Exactly one boolean
 * is drawn per call whatever the outcome, so a full board and an empty one leave the
 * generator in comparable places.
 */
export function spawn(
  moles: readonly Mole[],
  holes: number,
  rng: Rng,
  dt: number,
  spawnRate: number,
): number {
  const chance = spawnRate > 0 && dt > 0 ? 1 - Math.exp(-spawnRate * dt) : 0;
  if (!rng.bool(chance)) return NO_HOLE;

  let slot = -1;
  for (let i = 0; i < moles.length; i += 1) {
    const candidate = moles[i];
    if (candidate !== undefined && candidate.hole === NO_HOLE) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return NO_HOLE;

  const limit = holes < freeHoles.length ? holes : freeHoles.length;
  let free = 0;
  for (let hole = 0; hole < limit; hole += 1) {
    if (moleAt(moles, hole) >= 0) continue;
    freeHoles[free] = hole;
    free += 1;
  }
  if (free === 0) return NO_HOLE;

  const hole = freeHoles[rng.int(0, free)];
  const mole = moles[slot];
  if (hole === undefined || mole === undefined) return NO_HOLE;
  mole.hole = hole;
  mole.seat = rng.bool() ? 'p1' : 'p2';
  mole.upSeconds = 0;
  mole.lifetime = MIN_LIFETIME + rng.float() * (MAX_LIFETIME - MIN_LIFETIME);
  return hole;
}

/**
 * Resolve one swing at one hole.
 *
 * A struck mole always goes down, whoever swung — the mallet landed on it. Hitting the
 * other seat's colour therefore costs the striker a point *and* denies the owner one,
 * which is what stops the match being two people racing side by side and makes reading
 * the board the thing the game is actually about.
 */
export function hit(moles: readonly Mole[], hole: number, seat: SeatId): HitResult {
  const slot = moleAt(moles, hole);
  if (slot < 0) return 'miss';
  const mole = moles[slot];
  if (mole === undefined) return 'miss';
  const own = mole.seat === seat;
  mole.hole = NO_HOLE;
  return own ? 'own' : 'other';
}

/**
 * The hole a bot swings at, or {@link NO_HOLE} when it has nothing to swing at yet.
 *
 * The bot reads the board a player reads and no more: which moles are up, whose colour
 * they are, and how long each has been visible. It takes the one that has been up longest
 * because that is the one about to sink, which is the same cue the picture gives a human.
 * Its reaction delay is checked before anything else, so a mole that has only just
 * appeared is invisible to it however easy the swing would be.
 */
export function botTarget(
  moles: readonly Mole[],
  seat: SeatId,
  difficulty: BotDifficulty,
  rng: Rng,
): number {
  const profile = BOT_PROFILES[difficulty];
  // Drawn every call, including the ones with nothing to hit, so the generator advances
  // the same way whether or not the board happens to be busy.
  const blunder = rng.bool(profile.errorChance);

  let target = NO_HOLE;
  let ripest = -1;
  for (let i = 0; i < moles.length; i += 1) {
    const mole = moles[i];
    if (mole === undefined || mole.hole === NO_HOLE) continue;
    if (mole.seat !== seat) continue;
    if (mole.upSeconds < profile.reactionSeconds) continue;
    if (mole.upSeconds > ripest) {
      ripest = mole.upSeconds;
      target = mole.hole;
    }
  }
  if (target === NO_HOLE) return NO_HOLE;
  // A blunder is a swing at the wrong hole, never extra knowledge: the bot still only
  // swings when a human would have seen something worth swinging at.
  return blunder ? rng.int(0, HOLE_COUNT) : target;
}
