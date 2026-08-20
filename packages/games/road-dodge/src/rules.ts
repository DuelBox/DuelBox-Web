import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Road Dodge, as pure rules.
 *
 * The first `rt-race` game in the catalogue. Each seat drives its own lane strip, dodging
 * obstacles that come down it; the one who lasts longer wins. Both seats race at once but
 * neither can touch the other's road, so this is a race rather than a fight.
 *
 * No rendering, no timing, no DOM.
 */

/** Lanes per seat. Three is enough to make a dodge a choice rather than a reflex. */
export const LANES = 3;

/** How far down a seat's strip an obstacle travels, in logical units. */
export const TRACK_LENGTH = 1000;

/** Where the car sits along the strip. Obstacles are dangerous only near it. */
export const CAR_Y = 860;

/** Half-height of the band in which a car and an obstacle can collide. */
export const HIT_BAND = 46;

/** How wide a lane is, as a fraction of a seat's strip. Used by the renderer and by aim. */
export const LANE_FRACTION = 1 / LANES;

/** Obstacles start at this speed and reach the maximum after the ramp. */
export const BASE_SPEED = 320;
export const MAX_SPEED = 900;
export const RAMP_SECONDS = 45;

/** Seconds between spawns at the start, and at full speed. */
export const BASE_SPAWN_INTERVAL = 1.05;
export const MIN_SPAWN_INTERVAL = 0.34;

/**
 * How often a spawn blocks two lanes at once rather than one, at the start and at full
 * speed.
 *
 * This is what makes the game end. With only ever one obstacle at a time there is always
 * a lane to slide into, and a competent player never crashes — measured, a bot survived
 * three minutes at every difficulty and a bot-versus-bot match would have run forever.
 * Blocking two lanes leaves exactly one, so the player must already be in it or next to
 * it: reacting is no longer enough, and anticipating is the skill the game escalates
 * towards. One lane is always left open, so it is never unwinnable — only harder.
 */
export const BASE_PAIR_CHANCE = 0;
export const MAX_PAIR_CHANCE = 0.72;

/** How long a lane change takes. Movement is not instant, which is what makes it a skill. */
export const LANE_CHANGE_SECONDS = 0.14;

/** Obstacles live in a fixed pool, so a step never allocates. */
export const OBSTACLE_POOL = 12;

export interface Obstacle {
  /** -1 when this slot is unused. */
  lane: number;
  /** Distance travelled down the strip, in logical units. */
  y: number;
  /** Set once this obstacle has been counted as passed, so it scores exactly once. */
  scored: boolean;
}

export interface SeatState {
  /** The lane the car is in, or heading to. */
  lane: number;
  /** Where the car actually is, in lanes — fractional while changing lane. */
  position: number;
  readonly obstacles: Obstacle[];
  /** Obstacles cleared, which is the score. */
  passed: number;
  /** True once this seat has crashed. A crashed seat stops scoring. */
  crashed: boolean;
  /** Seconds until the next spawn. */
  spawnIn: number;
  /** Seconds this seat has been racing, which drives the difficulty ramp. */
  elapsed: number;
}

export function createSeatState(): SeatState {
  return {
    lane: 1,
    position: 1,
    obstacles: Array.from({ length: OBSTACLE_POOL }, () => ({ lane: -1, y: 0, scored: false })),
    passed: 0,
    crashed: false,
    spawnIn: BASE_SPAWN_INTERVAL,
    elapsed: 0,
  };
}

export function resetSeatState(state: SeatState): void {
  state.lane = 1;
  state.position = 1;
  for (const obstacle of state.obstacles) {
    obstacle.lane = -1;
    obstacle.y = 0;
    obstacle.scored = false;
  }
  state.passed = 0;
  state.crashed = false;
  state.spawnIn = BASE_SPAWN_INTERVAL;
  state.elapsed = 0;
}

/** How fast obstacles travel now, ramping with time. */
export function speedAt(elapsed: number): number {
  const t = Math.min(1, elapsed / RAMP_SECONDS);
  return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * t;
}

/** How long until the next spawn, tightening with time. */
export function spawnIntervalAt(elapsed: number): number {
  const t = Math.min(1, elapsed / RAMP_SECONDS);
  return BASE_SPAWN_INTERVAL + (MIN_SPAWN_INTERVAL - BASE_SPAWN_INTERVAL) * t;
}

/** How likely a spawn blocks two lanes rather than one, ramping with time. */
export function pairChanceAt(elapsed: number): number {
  const t = Math.min(1, elapsed / RAMP_SECONDS);
  return BASE_PAIR_CHANCE + (MAX_PAIR_CHANCE - BASE_PAIR_CHANCE) * t;
}

/** Steer one lane, clamped to the road. Returns the lane now aimed at. */
export function steer(state: SeatState, direction: number): number {
  if (state.crashed) return state.lane;
  const next = state.lane + (direction > 0 ? 1 : direction < 0 ? -1 : 0);
  state.lane = next < 0 ? 0 : next > LANES - 1 ? LANES - 1 : next;
  return state.lane;
}

/**
 * Choose a lane for a new obstacle.
 *
 * Never the lane that would be unavoidable: if an obstacle already sits close behind, a
 * new one in the only free lane leaves the player nowhere to go. A game that can kill you
 * regardless of what you do is not a game, it is a countdown.
 */
export function spawnLane(state: SeatState, rng: Rng): number {
  const blocked = new Set<number>();
  for (const obstacle of state.obstacles) {
    if (obstacle.lane < 0) continue;
    // Anything still in the top third of the strip is "recent" enough to matter.
    if (obstacle.y < TRACK_LENGTH / 3) blocked.add(obstacle.lane);
  }
  const free: number[] = [];
  for (let lane = 0; lane < LANES; lane += 1) {
    if (!blocked.has(lane)) free.push(lane);
  }
  // If every lane is recently occupied the road is already busy; pick any, since the
  // player has had time to react to what is there.
  if (free.length === 0) return rng.int(0, LANES);
  return free[rng.int(0, free.length)] as number;
}

/**
 * A second lane to block, leaving exactly one open.
 *
 * Never returns the lane already taken, and never leaves zero lanes free — the game gets
 * harder, never unwinnable.
 */
export function otherBlockableLane(taken: number, rng: Rng): number {
  const options: number[] = [];
  for (let lane = 0; lane < LANES; lane += 1) {
    if (lane !== taken) options.push(lane);
  }
  // With three lanes, blocking one more always leaves one. With two it would leave none,
  // so the guard is real rather than defensive.
  if (options.length < 2) return -1;
  return options[rng.int(0, options.length)] as number;
}

/** Put an obstacle into the first free pool slot. Returns false when the pool is full. */
export function spawn(state: SeatState, lane: number): boolean {
  for (const obstacle of state.obstacles) {
    if (obstacle.lane >= 0) continue;
    obstacle.lane = lane;
    obstacle.y = 0;
    obstacle.scored = false;
    return true;
  }
  return false;
}

export type StepResult = 'racing' | 'crashed';

/**
 * Advance one seat by one fixed step.
 *
 * Returns `'crashed'` on the step the car is hit, and only that step — the caller decides
 * what a crash means, and repeating it every step afterwards would make that impossible.
 */
export function stepSeat(state: SeatState, fixedDeltaSeconds: number, rng: Rng): StepResult {
  if (state.crashed) return 'racing';

  state.elapsed += fixedDeltaSeconds;

  // The car eases towards its lane rather than snapping, so a change costs time and a
  // late dodge can fail. That is the whole skill of the game.
  const target = state.lane;
  const travel = fixedDeltaSeconds / LANE_CHANGE_SECONDS;
  if (Math.abs(target - state.position) <= travel) state.position = target;
  else state.position += Math.sign(target - state.position) * travel;

  const speed = speedAt(state.elapsed);
  let crashed = false;

  for (const obstacle of state.obstacles) {
    if (obstacle.lane < 0) continue;
    obstacle.y += speed * fixedDeltaSeconds;

    // A hit needs the obstacle inside the band *and* the car in that lane. Position is
    // fractional mid-change, so a car halfway between lanes is in neither — which is
    // what makes threading a late dodge possible.
    if (!crashed && Math.abs(obstacle.y - CAR_Y) < HIT_BAND) {
      if (Math.abs(state.position - obstacle.lane) < 0.5) crashed = true;
    }

    if (!obstacle.scored && obstacle.y > CAR_Y + HIT_BAND) {
      obstacle.scored = true;
      state.passed += 1;
    }
    if (obstacle.y > TRACK_LENGTH) obstacle.lane = -1;
  }

  state.spawnIn -= fixedDeltaSeconds;
  if (state.spawnIn <= 0) {
    state.spawnIn += spawnIntervalAt(state.elapsed);
    const first = spawnLane(state, rng);
    spawn(state, first);
    // Later in a race a spawn may block a second lane, leaving exactly one way through.
    if (rng.bool(pairChanceAt(state.elapsed))) {
      const second = otherBlockableLane(first, rng);
      if (second >= 0) spawn(state, second);
    }
  }

  if (crashed) {
    state.crashed = true;
    return 'crashed';
  }
  return 'racing';
}

/**
 * Who has won, or null while the race is live.
 *
 * The first to crash loses. Both crashing on the same step is a draw — possible because
 * both seats are stepped in the same frame, and resolving it by whichever was checked
 * first would be an arbitrary tie-break.
 */
export function winnerOf(p1: SeatState, p2: SeatState): SeatId | 'draw' | null {
  if (p1.crashed && p2.crashed) return 'draw';
  if (p1.crashed) return 'p2';
  if (p2.crashed) return 'p1';
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How far up the road the bot looks, in logical units.
   *
   * A distance rather than a reaction *time*, which is how I first wrote it and had
   * backwards: expressing it as "seconds of hesitation" and subtracting `speed * seconds`
   * from the car's position means a slower bot starts looking **further** away, so the
   * easy tier survived twenty times longer than the hard one. A distance says plainly
   * what it means — a sharp bot sees trouble coming, a dull one notices it late.
   */
  readonly lookahead: number;
  /** Chance, when a dodge is needed, of freezing instead of steering. */
  readonly mistake: number;
  /**
   * How long a freeze lasts, in seconds.
   *
   * This has to be a duration held in state rather than a per-step coin flip. `botSteer`
   * runs on every one of the sixty steps a second, so a mistake that lasts a single step
   * is re-decided 16ms later and costs nothing: sweeping the per-step rate from 0 to 0.5
   * moved survival by 0.00s. A hesitation is only a hesitation if it lasts a beat.
   */
  readonly hesitation: number;
  /**
   * How reliably the bot returns to the middle lane when the road is clear.
   *
   * The middle has two escapes and an edge lane has one, so waiting in the middle is
   * simply better play — it is what a good player does without thinking about it. Without
   * this the tiers barely differed: seeing further is only an advantage if you also put
   * yourself somewhere you can use what you saw.
   */
  readonly recentre: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { lookahead: 190, mistake: 0.5, hesitation: 0.34, recentre: 0 },
  normal: { lookahead: 300, mistake: 0.35, hesitation: 0.26, recentre: 0.55 },
  hard: { lookahead: 400, mistake: 0, hesitation: 0, recentre: 1 },
});

/**
 * What a bot remembers between steps.
 *
 * Only a hesitation, which is the one thing that cannot be recomputed from the road. It is
 * deliberately *not* part of `SeatState`: the car is the car whoever is driving it, and a
 * human seat has no bot state to carry.
 */
export interface BotState {
  /** Seconds left of a freeze. Zero when the bot is driving normally. */
  frozen: number;
}

export function createBotState(): BotState {
  return { frozen: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.frozen = 0;
}

/**
 * Which way the bot steers: -1, 0 or 1.
 *
 * It looks only at what is on its own strip and how close it is — the same thing a player
 * sees. It cannot see an obstacle before it spawns, which is the property that would be
 * trivial to break here and would make the hard tier feel like cheating.
 */
export function botSteer(
  state: SeatState,
  bot: BotState,
  profile: BotProfile,
  dt: number,
  judgementRoll: number,
  choiceRoll: number,
): number {
  if (state.crashed) return 0;
  // Still frozen from an earlier mistake: the bot can see the obstacle and cannot act.
  if (bot.frozen > 0) {
    bot.frozen = Math.max(0, bot.frozen - dt);
    return 0;
  }

  // The nearest obstacle inside this bot's field of view.
  const lookahead = CAR_Y - profile.lookahead;
  let threat: Obstacle | null = null;
  for (const obstacle of state.obstacles) {
    if (obstacle.lane < 0) continue;
    if (obstacle.y < lookahead) continue;
    if (obstacle.y > CAR_Y + HIT_BAND) continue;
    if (threat === null || obstacle.y > threat.y) threat = obstacle;
  }
  if (threat === null || Math.abs(state.lane - threat.lane) >= 1) {
    // Nothing to dodge. Drift back to the middle, which has two escapes rather than one.
    const middle = Math.floor(LANES / 2);
    if (
      state.lane !== middle &&
      judgementRoll < profile.recentre &&
      laneIsClear(state, middle, profile.lookahead)
    ) {
      return state.lane < middle ? 1 : -1;
    }
    return 0;
  }

  // Head for the nearest clear lane, stepping one lane at a time towards it.
  //
  // Considering only *adjacent* clear lanes is not enough, and was the bug that made
  // every tier die at about the same moment: a pair blocking the car's lane and the one
  // beside it leaves a free lane two moves away, and a bot that will not take the first
  // of two moves simply sits still and is hit. Pathing towards it is both correct play
  // and the thing that lets seeing further actually pay.
  const options: number[] = [];
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let lane = 0; lane < LANES; lane += 1) {
    if (lane === state.lane) continue;
    if (!laneIsClear(state, lane, profile.lookahead)) continue;
    const distance = Math.abs(lane - state.lane);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = lane;
    }
  }
  if (nearest >= 0) options.push(nearest > state.lane ? 1 : -1);
  // Nowhere is clear over the whole window; take an adjacent lane that is at least clear
  // right now, which buys a step to reassess.
  if (options.length === 0) {
    for (const direction of [-1, 1]) {
      const lane = state.lane + direction;
      if (lane < 0 || lane > LANES - 1) continue;
      if (laneIsClear(state, lane)) options.push(direction);
    }
  }
  if (options.length === 0) return 0;

  // Two independent draws, and both are required rather than defaulted: with one roll
  // doing double duty a low value always picked the first option *and* always fired the
  // mistake, so the two were perfectly correlated and the mistake rate did not mean what
  // it said. A default for the second would let a caller slip back into that silently.
  const chosen =
    options[Math.floor(choiceRoll * options.length) % options.length] ?? options[0] ?? 0;
  // A mistake is hesitation: the bot sees the obstacle and does not move in time.
  //
  // Steering the *wrong* way was the first model and it barely graded at all, because on a
  // three lane road the wrong way is often still out of the obstacle's lane — a 40% error
  // rate cost only a fraction of a second over a 0% one. Freezing is both what a weak
  // player actually does and the thing that is reliably punished.
  if (judgementRoll < profile.mistake) {
    bot.frozen = profile.hesitation;
    return 0;
  }
  return chosen;
}

/**
 * Whether a lane is clear for as far as the bot can see.
 *
 * `lookahead` matters, and getting it wrong inverted the difficulty tiers. Checking only
 * for obstacles *near the car* meant a lane with something already on its way looked
 * clear, so the bot dodged into it — and a bot with a longer lookahead moved earlier and
 * was therefore trapped more often. The sharp tier survived less time than the dull one,
 * which is precisely backwards.
 *
 * A bot should judge a lane over the same window it watches its own, so "somewhere to go"
 * means somewhere that stays safe rather than somewhere that is safe this instant.
 */
export function laneIsClear(state: SeatState, lane: number, lookahead = HIT_BAND * 2.2): boolean {
  const from = CAR_Y - lookahead;
  for (const obstacle of state.obstacles) {
    if (obstacle.lane !== lane) continue;
    if (obstacle.y >= from && obstacle.y <= CAR_Y + HIT_BAND) return false;
  }
  return true;
}
