import { resolve, resolveSimultaneous } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Taxi Race, as pure rules.
 *
 * A taxi each on one city road, four lanes wide, with traffic standing in it. A driver says
 * two things and only two: *how far across the road to be*, and *now*. The first steers
 * round a queue; the second hops the taxi over one. Traffic that leaves a lane open can be
 * driven past, and a jam that blocks all four lanes can only be jumped. First taxi to the
 * far end of the route wins.
 *
 * Five decisions shape everything below, and each is argued where it lives:
 *
 *  - **One road, read by both seats** ({@link fillTraffic}). A single {@link Int8Array} of
 *    cells, indexed by each taxi at its own distance. There is no second sequence that
 *    could diverge: the two drivers are not facing similar traffic, they are facing the
 *    same cars in the same order, and the fairness is structural rather than tuned.
 *  - **Steering is a rate, never a jump** ({@link STEER_SPEED}). A finger, a key and a bot
 *    all express *where across the road to be*, and all three get there at exactly this
 *    rate — which is what makes the game fair across input families rather than won by
 *    whoever's instrument repeats fastest.
 *  - **A hop is a fixed length of road, not a fixed hang time** ({@link HOP_LENGTH}). A hop
 *    clears the same stretch of tarmac whatever speed the taxi is doing, so "can I clear
 *    this jam?" has one answer at every speed instead of being impossible at a standing
 *    start. See the note on {@link HOP_WINDOW} for the arithmetic that guarantees it.
 *  - **Both mistakes cost, and they cost differently** ({@link speedOf}). A hop lands hard
 *    and throws away most of the wind-up; a crash throws away all of it and spins the taxi
 *    for most of a second. So driving past is better than hopping, hopping is better than
 *    crashing, and the rule the game is named after is the one a player actually wants.
 *  - **The race ends twice over** ({@link stepMatch}). A finish line nobody can fail to
 *    reach, because a taxi always moves forward; and a clock behind it that calls the race
 *    on distance if anything ever goes wrong enough that they do not.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and every duration is
 * in simulated seconds.
 */

/** The logical box the two windows are drawn into. Declared here so the manifest cannot drift. */
export const COURSE_WIDTH = 600;
export const COURSE_HEIGHT = 1000;

/**
 * Half the width of the road, measured from its centre line.
 *
 * The one lateral measurement the simulation is given; every other across-the-road number
 * below is derived from it, and the renderer scales nothing — a taxi sitting at
 * `across = 208` is against the right kerb in the picture too.
 */
export const ROAD_HALF_WIDTH = 240;

/** Lanes across the road, and the distance between two lane centres. */
export const LANES = 4;
export const LANE_PITCH = (ROAD_HALF_WIDTH * 2) / LANES;

/** Where across the road a lane's centre sits. Lane 0 is the far left, lane 3 the far right. */
export function laneAcross(lane: number): number {
  return (lane - (LANES - 1) / 2) * LANE_PITCH;
}

/** Half-widths of the two things that can be on the road. */
export const TAXI_HALF_WIDTH = 32;
export const TRAFFIC_HALF_WIDTH = 36;

/**
 * How close a taxi's centre may get to a traffic car's lane centre before they touch.
 *
 * The sum of the two half-widths, and the number that decides whether the game can be
 * cheated. It is **larger than half a lane pitch** (68 against 60), so a taxi cannot thread
 * the gap between two blocked lanes: it would be 60 from each and 60 is inside 68. A lane
 * is therefore either open or it is not, which is what makes "drive past *or* jump" a real
 * choice rather than a third option nobody mentioned. `rules.test.ts` asserts the
 * inequality rather than trusting this paragraph.
 */
export const CLEARANCE = TAXI_HALF_WIDTH + TRAFFIC_HALF_WIDTH;

/** How far off the centre line a taxi may get before the kerb stops it. */
export const ACROSS_LIMIT = ROAD_HALF_WIDTH - TAXI_HALF_WIDTH;

/**
 * Half-lengths along the road, and the span in which a taxi and a traffic car can touch.
 *
 * {@link HIT_ALONG} is deliberately shorter than half a cell, so the whole of a collision
 * happens inside the traffic's own cell. That is what lets the collision test look at one
 * cell rather than sweeping a range, and it is checked by a test rather than left here as
 * a comment.
 */
export const TAXI_HALF_LENGTH = 60;
export const TRAFFIC_HALF_LENGTH = 50;
export const HIT_ALONG = TAXI_HALF_LENGTH + TRAFFIC_HALF_LENGTH;

/** How long one cell of road is. Traffic stands in the middle of a cell. */
export const CELL_LENGTH = 300;

/** City blocks to the far end of the route, and the distance that comes to. */
export const RACE_CELLS = 62;
export const RACE_DISTANCE = RACE_CELLS * CELL_LENGTH;

/** The first cells are always empty, so nobody meets traffic before they have looked. */
export const CALM_CELLS = 3;

/**
 * How much road a driver can see in front of their own taxi, in track units.
 *
 * Fixed by the drawing — a seat's half of the box is a window on the road and this is how
 * much of it fits — and named here because the bot is held below it (rule 6): a bot reads
 * {@link BOT_LOOKAHEAD} units of road where a person reads this many. Both seats' windows
 * are this deep, so neither ever sees more of what is coming than the other (rule 9).
 */
export const VISIBLE_AHEAD = 720;

/** Cells of road that fit in the window, rounded up. The renderer walks this many. */
export const VISIBLE_CELLS = Math.ceil(VISIBLE_AHEAD / CELL_LENGTH);

/**
 * Cells generated.
 *
 * A driver reads {@link VISIBLE_AHEAD} beyond their own taxi and the race stops the instant
 * somebody reaches {@link RACE_DISTANCE}, so this is the furthest cell anybody can ask for,
 * plus two for comfort.
 */
export const TRACK_CELLS = RACE_CELLS + VISIBLE_CELLS + 2;

/**
 * Units a second at a standing start, at the top of the wind-up, and while spinning.
 *
 * Derived from this game's own geometry rather than inherited: {@link SPEED_FAST} is set by
 * the tightest reachable pair of queues the generator can produce, and the arithmetic is in
 * the note on {@link reachAt}. A copy of a sibling's numbers would have carried a sibling's
 * lane pitch into a road with different lanes.
 */
export const SPEED_SLOW = 300;
export const SPEED_FAST = 580;
export const SPEED_SPIN = 120;

/** Seconds of clean driving to reach full speed from a standing start. */
export const BOOST_SECONDS = 7;

/** Seconds a taxi spins after hitting traffic. Steering and hopping do nothing meanwhile. */
export const SPIN_SECONDS = 0.9;

/**
 * How fast a taxi crosses the road, in units a second.
 *
 * Two jobs, and the second one is a proof rather than a taste.
 *
 * It is the single number that makes this game fair across input families: a finger names a
 * point, a key names a direction and a bot names a point, and all three arrive at the same
 * rate — so no instrument steers sooner, further or finer than another, and what is left to
 * be good at is *which lane, and how early*, which every instrument expresses equally well.
 *
 * And it is what makes every generated route drivable **from any legal position**, not
 * merely from the line the generator threaded. See {@link MAX_SIDESTEP}: the widest move
 * two consecutive queues can ever ask for is 336 units, the least road they can ever leave
 * to make it in is {@link MIN_QUEUE_GAP}, and 336 / 640 = 0.525 s against 380 / 580 =
 * 0.655 s is a fifth of the time to spare. The first draft was 500 and it did **not**
 * close: a walk over four thousand seeded routes found one that asked 336 units of a driver
 * with 328 units' worth of time, so a taxi at the kerb at full speed was clipped by traffic
 * it could not avoid. The margin is asserted in `rules.test.ts` over every mask rather than
 * sampled. **[ours]**
 */
export const STEER_SPEED = 640;

/**
 * The widest move across the road two consecutive queues can ever ask for.
 *
 * From one kerb to the near edge of the safe span around the outermost lane on the far
 * side, which is {@link CLEARANCE} beyond the last blocked lane. Nothing a generator can
 * produce asks for more, because there is nowhere further apart on this road to be.
 */
export const MAX_SIDESTEP = ACROSS_LIMIT + LANE_PITCH / 2 + CLEARANCE;

/**
 * The least road two queues can ever leave between them, in track units.
 *
 * Queues stand at least two cells apart, the taxi may not leave the first until
 * {@link HIT_ALONG} past its centre, and it must be in place {@link HIT_ALONG} before the
 * second. Everything else is derived from these two numbers and {@link SPEED_FAST}.
 */
export const MIN_QUEUE_GAP = 2 * CELL_LENGTH - 2 * HIT_ALONG;

/**
 * How close to the asked-for point counts as arrived, in units.
 *
 * Steering eases off inside this band rather than stopping dead, so a taxi settles on a
 * lane instead of hunting either side of it — and so a bot and a resting finger produce the
 * same smooth approach rather than a per-step twitch. Comfortably inside the 52 units of
 * slack a free lane leaves either side of its centre, so a taxi that has arrived is clear
 * of the traffic beside it, and wider than the 10.7 units a step of steering covers, so it
 * is a band rather than a thing to overshoot.
 */
export const STEER_SNAP = 22;

/**
 * How much road one hop carries the taxi over, in track units.
 *
 * **A length, not a hang time**, and that is the whole reason a hop works at every speed.
 * A fixed hang time covers `speed × seconds` of road, so a taxi at a standing start would
 * come down inside a jam that the same taxi at full speed sails over — the same input
 * producing opposite outcomes for a reason the player cannot see. A fixed length spends
 * itself against the distance travelled instead, so the stretch cleared is the same 420
 * units whether that took two thirds of a second or one and a quarter.
 */
export const HOP_LENGTH = 420;

/**
 * The middle of the launch window, measured back from the traffic a hop is clearing.
 *
 * To clear a jam the taxi must leave the ground before the traffic's danger span begins and
 * come down after it ends. Both ends of the span are {@link HIT_ALONG} from the traffic's
 * centre, so the launch point must lie in `[centre - (HOP_LENGTH - HIT_ALONG),
 * centre - HIT_ALONG]` — a stretch of road exactly `HOP_LENGTH - 2 × HIT_ALONG` long,
 * centred `HOP_LENGTH / 2` before the traffic. Both numbers fall out of that rather than
 * being chosen: aim at 210, and there is 100 units of room either side of it.
 */
export const HOP_AIM = HOP_LENGTH / 2;
export const HOP_WINDOW = HOP_LENGTH / 2 - HIT_ALONG;

/** Seconds after a landing before the suspension will take another hop. */
export const SETTLE_SECONDS = 0.18;

/**
 * What is left of the wind-up after a landing.
 *
 * The price of the safe way past, and the reason a player prefers the lane when there is
 * one. Hopping every jam is fine; hopping *everything* settles at a crawl — the fixed point
 * of `b → (b + SETTLE_SECONDS / BOOST_SECONDS) × LANDING_KEEP` is 0.031, which is 310 units
 * a second against a clean driver's 580. `rules.test.ts` measures it rather than trusting
 * the algebra.
 */
export const LANDING_KEEP = 0.55;

/**
 * The race is called on distance after this long.
 *
 * A second guarantee behind the finish line, and the number is the *multiplied-out worst
 * case* rather than a round figure. A taxi always moves forward, so the slowest a race can
 * possibly go is a driver who hits every single queue: {@link SPIN_SECONDS} of spinning
 * covers `0.9 × 120 = 108` units, and the remaining `600 − 108 = 492` units to the next
 * queue — queues are never closer than two cells — take at least `492 / 300 = 1.64` s at
 * the post-crash speed. That is 600 units per 2.54 s, or 236 units a second, and the route
 * is 18 600 units: **78.8 s**. Hopping cannot be slower, because a hop never drops the taxi
 * below {@link SPEED_SLOW}. A hundred and five seconds therefore ends every match with a
 * third of the worst case to spare, and 105 s is a sixth of the ten-minute ceiling the
 * repository's `termination.test.ts` allows. `rules.test.ts` measures the worst pairing it
 * can build rather than trusting the sum.
 *
 * `roundSeconds` in the manifest ends nothing at all — it prints a number on the catalogue
 * card — so the guarantee has to live here.
 */
export const ROUND_SECONDS = 105;

/** Where the difficulty ramp changes gear, in cells. */
export const RAMP_EARLY = 16;
export const RAMP_LATE = 36;

/**
 * How many lanes the open lane may move between one queue and the next, at `index` cells in.
 *
 * Half the difficulty curve, and the half that decides how far a driver has to have looked
 * ahead. One lane early on is a nudge; two late on has to be begun while the previous queue
 * is still going past, because a queue is only legible once there is no longer time to
 * think about it.
 *
 * It is not what makes a route *drivable* — {@link STEER_SPEED} and {@link MAX_SIDESTEP}
 * are, and they cover a driver who ignored the line entirely. `rules.test.ts` walks every
 * generated route over thousands of seeds and asserts the margin from every legal resting
 * position rather than from the one the generator threaded.
 */
export function reachAt(index: number): number {
  return index < RAMP_EARLY ? 1 : 2;
}

/**
 * Clear cells left after a queue before the next one may stand, at `index` cells in.
 *
 * The other half of the curve. The reach grows while the room to use it shrinks, so a queue
 * goes from something to react to into something to commit to.
 */
export function spacingAt(index: number): number {
  if (index < RAMP_EARLY) return 3;
  if (index < RAMP_LATE) return 2;
  return 1;
}

/**
 * The most lanes a queue may block at `index` cells in, out of the three that are not the
 * open one.
 *
 * One early on is a single parked car to steer round; three late on is a wall with one lane
 * left in it, and at full speed the lane has to be chosen before it is comfortable to.
 */
export function maxBlockAt(index: number): number {
  if (index < RAMP_EARLY) return 1;
  if (index < RAMP_LATE) return 2;
  return 3;
}

/** How likely the queue at `index` blocks the road outright, ramping across the route. */
export function jamChanceAt(index: number): number {
  const along = index / RACE_CELLS;
  const clamped = along < 0 ? 0 : along > 1 ? 1 : along;
  return 0.16 + clamped * 0.18;
}

/**
 * Clear cells left after a jam.
 *
 * Always the widest spacing, whatever the ramp says, and it is a correctness rule rather
 * than a difficulty one. A jam is jumped, and a taxi in the air cannot steer, so it comes
 * down wherever it left the ground — anywhere on the road, up to 388 units from the next
 * open lane. Four cells is 1200 units; even the latest legal landing leaves 780 units of
 * road, which is 1.34 s at {@link SPEED_FAST} and 672 units of steering. A jam is never the
 * reason a route cannot be driven.
 */
export const JAM_SPACING = 3;

/** A cell with nothing in it. */
export const CLEAR = 0;

/** A cell with every lane blocked. The only way past one is over it. */
export const JAM = (1 << LANES) - 1;

/**
 * What stands in the cell at `index`, as a bitmask of blocked lanes.
 *
 * The cell value *is* the mask, which is why {@link CLEAR} is 0 and {@link JAM} is 15: no
 * packing, no unpacking, and the same array read by both taxis at their own distance.
 * Off either end of the route the road is empty.
 */
export function maskAt(track: Readonly<Int8Array>, index: number): number {
  return track[index] ?? CLEAR;
}

export function laneBlocked(mask: number, lane: number): boolean {
  return (mask & (1 << lane)) !== 0;
}

/** Which cell a point on the road falls in. */
export function cellOf(distance: number): number {
  return Math.floor(distance / CELL_LENGTH);
}

/** The middle of a cell's traffic, in track units. */
export function trafficAlong(index: number): number {
  return index * CELL_LENGTH + CELL_LENGTH / 2;
}

/**
 * The open lane nearest `across`, or -1 when every lane is blocked.
 *
 * Ties go to the lower lane, deterministically, because a tie broken by anything else is a
 * tie broken differently on two devices.
 */
export function freeLaneNear(mask: number, across: number): number {
  let best = -1;
  let bestGap = Infinity;
  for (let lane = 0; lane < LANES; lane += 1) {
    if (laneBlocked(mask, lane)) continue;
    const gap = Math.abs(across - laneAcross(lane));
    if (gap < bestGap) {
      bestGap = gap;
      best = lane;
    }
  }
  return best;
}

/**
 * Fill a road from the seeded generator.
 *
 * **One road, read by both seats.** Two independently generated roads would be fair only on
 * average, and a race is run once: a driver who drew three jams while their opponent drew
 * open tarmac has lost to the seed rather than to the other player. Handing both seats the
 * identical sequence deletes the question outright, and it is what makes this a race rather
 * than two solo drives shown side by side.
 *
 * **Four draws per queue, always**, whether or not the last two change anything. Drawing
 * the shape only when the ramp has opened it works — the stream is deterministic either
 * way — but it couples the sequence of lanes to the sequence of widths, so a tuning change
 * to {@link maxBlockAt} would silently rearrange every route in the game.
 *
 * `aim` is the open lane the generator is threading, and **a jam does not move it**: there
 * is no open lane at a jam to move it to, and the queue after a jam is placed relative to
 * where the driver was before the jam rather than to nothing at all.
 *
 * The last cell before the line is left clear, so nobody is caught out by traffic they
 * could not see past the finish.
 */
export function fillTraffic(track: Int8Array, rng: Rng): void {
  track.fill(CLEAR);
  let aim = 1;
  let index = CALM_CELLS;
  let afterJam = false;
  while (index < RACE_CELLS - 1) {
    const drawLane = rng.float();
    const drawJam = rng.float();
    const drawCount = rng.float();
    const drawShape = rng.float();

    // A queue after a jam may open anywhere, because the taxi came down anywhere.
    const reach = afterJam ? LANES - 1 : reachAt(index);
    const low = Math.max(0, aim - reach);
    const high = Math.min(LANES - 1, aim + reach);
    const picked = low + Math.floor(drawLane * (high - low + 1));
    const chosen = picked > high ? high : picked;

    const jam = drawJam < jamChanceAt(index);
    if (jam) {
      track[index] = JAM;
    } else {
      aim = chosen;
      const most = maxBlockAt(index);
      const wanted = 1 + Math.floor(drawCount * most);
      const count = wanted > most ? most : wanted;
      // The three lanes that are not the open one, taken consecutively from an offset. For
      // three lanes that reaches every subset of every size, so no arrangement is unreachable.
      const start = Math.min(LANES - 2, Math.floor(drawShape * (LANES - 1)));
      let mask = 0;
      for (let step = 0; step < count; step += 1) {
        const slot = (start + step) % (LANES - 1);
        let seen = 0;
        for (let lane = 0; lane < LANES; lane += 1) {
          if (lane === aim) continue;
          if (seen === slot) {
            mask |= 1 << lane;
            break;
          }
          seen += 1;
        }
      }
      track[index] = mask;
    }

    index += (jam ? JAM_SPACING : spacingAt(index)) + 1;
    afterJam = jam;
  }
}

/**
 * Whether the traffic in `index` catches a taxi at `distance` sitting `across` the road.
 *
 * The whole collision rule, in one place. Traffic stands still in the middle of its cell, so
 * *where along* the cell the taxi is only decides whether they are close enough to touch at
 * all; whether it is a crash is entirely about how far across the road the taxi is, and
 * about which lanes this queue is standing in.
 */
export function caughtBy(
  track: Readonly<Int8Array>,
  index: number,
  distance: number,
  across: number,
): boolean {
  const mask = maskAt(track, index);
  if (mask === CLEAR) return false;
  if (Math.abs(distance - trafficAlong(index)) >= HIT_ALONG) return false;
  for (let lane = 0; lane < LANES; lane += 1) {
    if (!laneBlocked(mask, lane)) continue;
    if (Math.abs(across - laneAcross(lane)) < CLEARANCE) return true;
  }
  return false;
}

export interface Taxi {
  /** How far along the route it has driven. This, in cells, is the score. */
  distance: number;
  /** How far across the road from the centre line, positive towards the driver's right. */
  across: number;
  /** How far up the wind-up it is, 0 to 1. Cut on a landing, lost outright in a crash. */
  boost: number;
  /** Track units left of the hop it is in the middle of; zero while its wheels are down. */
  hop: number;
  /** Seconds left before the suspension will take another hop. */
  settle: number;
  /** Seconds left of a spin; zero while driving. */
  spin: number;
  /**
   * The cell of the traffic that last caught it, or -1.
   *
   * A spinning taxi keeps rolling forward and is still among the cars it just hit for most
   * of a second, so without this it would be caught by the same queue on every one of the
   * next fifty steps and never leave it — a race that cannot end. It is not a general
   * invulnerability: any *other* queue still catches it.
   */
  hitCell: number;
  /** The cell whose traffic was last counted, so a queue is credited once and only once. */
  creditCell: number;
  /**
   * How far into the step it crossed the line, in seconds; zero while it is still racing.
   *
   * A race is decided by *who got there first*, and a fixed step cannot see inside itself:
   * at full speed one step of road is 9.7 units, so two taxis anywhere within nine units of
   * each other arrive on the same step and the finish reads as simultaneous when it was not.
   * The line is not crossed on a step boundary, though — it is crossed at a knowable instant
   * *inside* the step, and {@link stepTaxi} works that instant out from the distance left
   * over past the line. {@link judge} then settles a two-taxi step on it.
   *
   * Without this the clamp below would decide the race: both taxis are pinned to
   * {@link RACE_DISTANCE} on the step they finish, so the only number that separated them is
   * thrown away and a race one taxi led all the way is called a dead heat. Measured over
   * four hundred seeded matches of two `hard` bots, that was 18.5% of them, and in seven out
   * of eight one taxi had genuinely crossed first.
   */
  finishOffset: number;
  /** Queues hit. */
  crashes: number;
  /** Hops launched. */
  hops: number;
  /** Queues driven past on the ground — the first half of the rule the game is named after. */
  passed: number;
  /** Queues cleared in the air — the second half of it. */
  vaulted: number;
}

export function createTaxi(): Taxi {
  return {
    distance: 0,
    across: 0,
    boost: 0,
    hop: 0,
    settle: 0,
    spin: 0,
    hitCell: -1,
    creditCell: -1,
    finishOffset: 0,
    crashes: 0,
    hops: 0,
    passed: 0,
    vaulted: 0,
  };
}

export function resetTaxi(taxi: Taxi): void {
  taxi.distance = 0;
  taxi.across = 0;
  taxi.boost = 0;
  taxi.hop = 0;
  taxi.settle = 0;
  taxi.spin = 0;
  taxi.hitCell = -1;
  taxi.creditCell = -1;
  taxi.finishOffset = 0;
  taxi.crashes = 0;
  taxi.hops = 0;
  taxi.passed = 0;
  taxi.vaulted = 0;
}

/**
 * How fast a taxi is travelling now.
 *
 * **This is the rule that decides the race, and it exists because a fixed speed does not.**
 * At a fixed speed the only thing separating two drivers is how many cars they clipped, and
 * a spin is a very coarse unit to decide a race in. A wind-up costs a crash twice over: the
 * second of crawling, and the seven seconds of climbing back to speed, which is much the
 * larger of the two. A hop costs a fraction of the same thing, which is what puts the two
 * ways past a queue in the right order.
 */
export function speedOf(taxi: Readonly<Taxi>): number {
  if (taxi.spin > 0) return SPEED_SPIN;
  return SPEED_SLOW + (SPEED_FAST - SPEED_SLOW) * taxi.boost;
}

/** How many whole city blocks a taxi has driven. This is what the scoreboard shows. */
export function blocksOf(taxi: Readonly<Taxi>): number {
  const blocks = cellOf(taxi.distance);
  return blocks > RACE_CELLS ? RACE_CELLS : blocks;
}

/** Whether a taxi could leave the ground this instant. */
export function canHop(taxi: Readonly<Taxi>): boolean {
  return taxi.spin <= 0 && taxi.hop <= 0 && taxi.settle <= 0 && taxi.distance < RACE_DISTANCE;
}

/** What one taxi did this step. */
export type Stride = 'idle' | 'driving' | 'airborne' | 'spinning' | 'crashed' | 'home';

/**
 * Which way to steer to get from `across` to `target`, as a number in [-1, 1].
 *
 * Full lock until the last {@link STEER_SNAP} units, then proportionally less. Every source
 * of steering in the game goes through this or straight into the same integrator — a
 * finger, a bot, and the keys by way of their own sign — so none of them can steer harder
 * than another.
 */
export function steerFor(across: number, target: number): number {
  const delta = target - across;
  if (delta > STEER_SNAP) return 1;
  if (delta < -STEER_SNAP) return -1;
  return delta / STEER_SNAP;
}

function clampSteer(steer: number): number {
  if (!Number.isFinite(steer)) return 0;
  return steer > 1 ? 1 : steer < -1 ? -1 : steer;
}

/**
 * Drive one taxi for a step.
 *
 * `steer` is what that seat is asking for, in [-1, 1]; anything outside is clamped and a
 * value that is not a number at all reads as no steering, because the pointer positions a
 * browser produces are not always numbers a game would choose. `hop` is that seat asking to
 * leave the ground, and is simply ignored when the taxi is in no state to.
 *
 * A taxi in the air steers not at all and cannot be touched by traffic. A spinning one
 * steers not at all, cannot hop, and still moves forward. That last clause is what
 * guarantees the race ends.
 */
export function stepTaxi(
  track: Readonly<Int8Array>,
  taxi: Taxi,
  steer: number,
  hop: boolean,
  fixedDeltaSeconds: number,
): Stride {
  if (taxi.distance >= RACE_DISTANCE) return 'idle';

  let travel: number;
  let airborne = false;
  if (taxi.spin > 0) {
    taxi.spin -= fixedDeltaSeconds;
    // Snapped rather than carried over, so a recovery lands on a step boundary exactly and
    // the bar a renderer draws never runs past its own end.
    if (taxi.spin < 0) taxi.spin = 0;
    travel = SPEED_SPIN * fixedDeltaSeconds;
  } else {
    if (taxi.hop <= 0) {
      if (taxi.settle > 0) {
        taxi.settle -= fixedDeltaSeconds;
        if (taxi.settle < 0) taxi.settle = 0;
      }
      if (hop && taxi.settle <= 0) {
        taxi.hop = HOP_LENGTH;
        taxi.hops += 1;
      }
    }

    if (taxi.hop > 0) {
      airborne = true;
      // Speed is held for the whole hop — the wheels are off the road, so the wind-up neither
      // climbs nor decays — which makes the step exact rather than an integration.
      travel = speedOf(taxi) * fixedDeltaSeconds;
      taxi.hop -= travel;
      if (taxi.hop <= 0) {
        taxi.hop = 0;
        taxi.boost *= LANDING_KEEP;
        taxi.settle = SETTLE_SECONDS;
      }
    } else {
      taxi.across += clampSteer(steer) * STEER_SPEED * fixedDeltaSeconds;
      if (taxi.across > ACROSS_LIMIT) taxi.across = ACROSS_LIMIT;
      else if (taxi.across < -ACROSS_LIMIT) taxi.across = -ACROSS_LIMIT;
      const before = taxi.boost;
      taxi.boost += fixedDeltaSeconds / BOOST_SECONDS;
      if (taxi.boost > 1) taxi.boost = 1;
      // The *mean* speed over the step, not the speed at either end of it. The wind-up is a
      // straight line in time, so its midpoint is the exact average — which makes the
      // distance covered in a second of driving the same number whether that second arrived
      // as sixty steps or as a hundred and twenty. Taking the speed at one end instead is a
      // rectangle rule, and it makes the game a measurable fraction faster on one refresh
      // rate than on another.
      travel =
        (SPEED_SLOW + (SPEED_FAST - SPEED_SLOW) * ((before + taxi.boost) / 2)) * fixedDeltaSeconds;
    }
  }

  taxi.distance += travel;
  if (taxi.distance >= RACE_DISTANCE) {
    // How much of the step was still to run when the line went by. `travel` is the distance
    // this whole step covered, so the overshoot past the line is the fraction of it that
    // happened *after* the crossing — and the rest of it is when the crossing happened. The
    // clamp below then costs nothing, because the instant has already been taken off it.
    const overshoot = taxi.distance - RACE_DISTANCE;
    taxi.finishOffset = travel > 0 ? fixedDeltaSeconds * (1 - overshoot / travel) : 0;
    taxi.distance = RACE_DISTANCE;
    return 'home';
  }

  const cell = cellOf(taxi.distance);
  let stride: Stride = airborne ? 'airborne' : taxi.spin > 0 ? 'spinning' : 'driving';
  if (
    !airborne &&
    taxi.spin <= 0 &&
    cell !== taxi.hitCell &&
    caughtBy(track, cell, taxi.distance, taxi.across)
  ) {
    taxi.hitCell = cell;
    taxi.crashes += 1;
    taxi.spin = SPIN_SECONDS;
    taxi.boost = 0;
    stride = 'crashed';
  }

  // Credited once, at the moment the taxi is fully clear of the queue's danger span — the
  // far end of it, not the middle, so a taxi that came down among the cars is not credited
  // with having got over them. This is how the two halves of the rule the game is named
  // after are *counted* rather than asserted; `game.test.ts` reads both numbers back out of
  // real matches. A queue that caught the taxi is neither driven past nor cleared.
  if (
    maskAt(track, cell) !== CLEAR &&
    cell !== taxi.creditCell &&
    taxi.distance >= trafficAlong(cell) + HIT_ALONG
  ) {
    taxi.creditCell = cell;
    if (cell !== taxi.hitCell) {
      if (airborne) taxi.vaulted += 1;
      else taxi.passed += 1;
    }
  }

  return stride;
}

export type Phase = 'racing' | 'over';

export interface Match {
  /** The one road both seats drive. Allocated once; refilled on reset. */
  readonly track: Int8Array;
  readonly p1: Taxi;
  readonly p2: Taxi;
  /** Simulated seconds the race has run, so it can be called. */
  elapsed: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
}

export function createMatch(): Match {
  return {
    track: new Int8Array(TRACK_CELLS),
    p1: createTaxi(),
    p2: createTaxi(),
    elapsed: 0,
    phase: 'racing',
    winner: null,
  };
}

/**
 * Put both taxis back on the line, leaving the road as it is.
 *
 * Separate from {@link resetMatch} because tearing a match down is not the same as starting
 * one: `destroy` has to leave nothing behind, but generating a fresh road on the way out
 * would spend draws from the host's generator after the match they belong to has finished.
 */
export function clearMatch(match: Match): void {
  resetTaxi(match.p1);
  resetTaxi(match.p2);
  match.elapsed = 0;
  match.phase = 'racing';
  match.winner = null;
}

/** Start a fresh race on newly generated traffic. The only place the road is written. */
export function resetMatch(match: Match, rng: Rng): void {
  fillTraffic(match.track, rng);
  clearMatch(match);
}

export function taxiOf(match: Readonly<Match>, seat: SeatId): Taxi {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export interface StepResult {
  readonly p1: Stride;
  readonly p2: Stride;
}

/** Rewritten in place rather than allocated, so a step costs no garbage (rule 5). */
const result: { p1: Stride; p2: Stride } = { p1: 'idle', p2: 'idle' };

/**
 * The race, as the SDK spells it: first to the line, and the clock settles it otherwise.
 *
 * Held at module scope and rewritten rather than built per call, for the same reason the
 * step result is. `resolve` is the shared helper every game decides with, so "first past
 * the post" and "level is a draw" mean the same thing here as everywhere else.
 */
const FINISH_LINE: WinCondition = { kind: 'first-to', target: RACE_DISTANCE };
const winTally = { p1: 0, p2: 0 };
const winOptions = { timeExpired: false };

/**
 * The tolerance on a photo finish, in seconds. Zero, and that is a claim about this game
 * rather than a shortcut.
 *
 * The SDK's default allows eight milliseconds because it is written for two people on two
 * devices, where the two times are *measurements* and carry a measurement's noise. Nothing
 * is measured here: both taxis are stepped by one loop through the same arithmetic on the
 * same road, so two identical races produce two identical crossing instants to the last
 * bit, and any difference at all is a real difference in how the race was driven. Allowing
 * a window would only re-create the dead heats {@link Taxi.finishOffset} exists to stop.
 */
export const FINISH_TOLERANCE = 0;

/**
 * Who has won, or null while the race is live.
 *
 * Resolved on **distance** rather than on the block count the scoreboard prints: the count
 * is the distance rounded down, so deciding on it would turn a race that reached the clock
 * a taxi's length apart into a dead heat. A distance is what actually separates them.
 *
 * Except in the one case where a distance cannot, which is the finish itself. Both taxis are
 * pinned to {@link RACE_DISTANCE} the moment they cross, so a step in which both crossed
 * holds two identical distances however far apart they actually were — and because the match
 * ends the instant the *first* taxi is home, a step with both taxis home is always the same
 * step. That is the one place the race is settled on {@link Taxi.finishOffset} instead: the
 * instant inside the step at which each crossed, put to the SDK's own
 * {@link resolveSimultaneous} rather than to a comparison written again here.
 */
export function judge(match: Readonly<Match>): SeatId | 'draw' | null {
  if (match.p1.distance >= RACE_DISTANCE && match.p2.distance >= RACE_DISTANCE) {
    return resolveSimultaneous(match.p1.finishOffset, match.p2.finishOffset, FINISH_TOLERANCE);
  }
  winTally.p1 = match.p1.distance;
  winTally.p2 = match.p2.distance;
  winOptions.timeExpired = match.elapsed >= ROUND_SECONDS;
  return resolve(FINISH_LINE, winTally, winOptions);
}

/**
 * One fixed step of the whole race.
 *
 * Both taxis are driven before either is judged, so a step in which both cross the line is
 * the dead heat it actually is rather than a win for whichever seat the loop happened to
 * run first.
 *
 * The race is only put to {@link judge} on a step that could have decided it — a taxi home,
 * or the clock out. Asking on every step would be the same answer and one throwaway object
 * a step, and a step in this game allocates nothing at all.
 */
export function stepMatch(
  match: Match,
  fixedDeltaSeconds: number,
  p1Steer: number,
  p1Hop: boolean,
  p2Steer: number,
  p2Hop: boolean,
): StepResult {
  result.p1 = 'idle';
  result.p2 = 'idle';
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  result.p1 = stepTaxi(match.track, match.p1, p1Steer, p1Hop, fixedDeltaSeconds);
  result.p2 = stepTaxi(match.track, match.p2, p2Steer, p2Hop, fixedDeltaSeconds);

  if (result.p1 === 'home' || result.p2 === 'home' || match.elapsed >= ROUND_SECONDS) {
    const outcome = judge(match);
    if (outcome !== null) {
      match.phase = 'over';
      match.winner = outcome;
    }
  }
  return result;
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the road. Between them it holds the line it last chose and the
   * launch point it last planned, exactly as a driver whose eyes are still on the last
   * queue would.
   */
  readonly reaction: number;
  /** Magnitude of the random extra added to that delay, so it is never metronomic. */
  readonly waver: number;
  /**
   * Chance a look comes out wrong: a lane wide of the open one, or a jam it does not plan
   * to hop at all.
   */
  readonly blunder: number;
  /**
   * Track units of error either side of the ideal launch point, spread evenly.
   *
   * Against the {@link HOP_WINDOW} of 100 units this is what decides how often a tier
   * actually clears a jam, and it is the tier difference the game is named after.
   */
  readonly hopSlip: number;
}

/**
 * How far up the road a bot reads, in track units.
 *
 * **Re-derived for this game, not inherited.** The four-lane sibling declares the same 620
 * against a window 900 deep, where it is 69% of what a person sees; here the window is
 * {@link VISIBLE_AHEAD} = 720 and the same number is 86% of it, so the sibling's margin does
 * not carry over and the value has to earn its place from this game's own arithmetic. It
 * does, and it is bracketed from both sides:
 *
 *  - **Below {@link VISIBLE_AHEAD}**, which is rule 6 made arithmetic: the bot is the worse
 *    informed of the two drivers at every moment of the race. {@link readAhead} enforces it
 *    against the *distance*, not against the cell the distance lands in — see the note
 *    there, because reading whole cells is how this guarantee was quietly worth 770 units
 *    rather than 620.
 *  - **Below 651**, which is what a jam actually costs to answer: the launch point is
 *    {@link HOP_AIM} = 210 units before the traffic, and the slowest tier takes up to
 *    `reaction + waver` = 0.76 s to decide, which at {@link SPEED_FAST} is 441 units of
 *    road. A bot that could see 651 units would always have time to think; at 620 the
 *    weakest tier is still deciding when it should already be in the air, while `hard`
 *    needs only `0.15 s × 580 + 210` = 297 units and is never pressed. That is the split
 *    the measurement shows — `easy` clears about half the jams it meets and `hard`
 *    essentially all of them — and it is a consequence of this number rather than of the
 *    tier table.
 */
export const BOT_LOOKAHEAD = 620;

/**
 * The three tiers, expressed only as reaction delay, waver, blunder rate and launch error.
 *
 * No tier gets a faster taxi, a longer look up the road, quicker steering, a longer hop or
 * anything else a player cannot have (rule 6). What separates them is how often they are
 * still holding the last queue's answer when the next one arrives, how often the answer is
 * wrong, and how well they time the one thing this game asks for exactly.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.46, waver: 0.3, blunder: 0.28, hopSlip: 190 },
  normal: { reaction: 0.24, waver: 0.14, blunder: 0.12, hopSlip: 110 },
  hard: { reaction: 0.1, waver: 0.05, blunder: 0.02, hopSlip: 40 },
});

/**
 * Floats a bot spends on every look, whatever it goes on to decide.
 *
 * Asserted by a test that counts them. See {@link botDrive} for why a variable count is a
 * seat bias rather than a detail.
 */
export const BOT_DRAWS_PER_LOOK = 4;

export interface BotState {
  /** Seconds until it looks at the road again. */
  look: number;
  /** The line it settled on at the last look, which it holds until the next one. */
  want: number;
  /** The distance at which it means to leave the ground, or -1 for "not planning to". */
  launchAt: number;
  /** Whether it is asking to hop on this step. Rewritten every step, never accumulated. */
  hop: boolean;
}

export function createBotState(): BotState {
  return { look: 0, want: 0, launchAt: -1, hop: false };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.want = 0;
  state.launchAt = -1;
  state.hop = false;
}

/**
 * The nearest queue a driver at `seat` still has to deal with, or -1 for open road.
 *
 * Exactly what a person reads off their own half, which is why the depth is passed in: the
 * bot calls it with {@link BOT_LOOKAHEAD}, which is less than the {@link VISIBLE_AHEAD} a
 * person can see (rule 6). Queues already behind the taxi and the one that has just caught
 * it are skipped, because a driver steering for cars they are already past is a driver
 * pointing the wrong way for the next ones.
 *
 * **The depth is measured to the traffic, not to the cell it stands in**, and that is the
 * line that makes rule 6 true rather than nearly true. Walking cells and stopping at
 * `cellOf(distance + lookahead)` sounds like the same thing and is not: a taxi 280 units
 * into a cell reaches three cells out, whose traffic stands 770 units up the road — 150
 * units past the 620 this is called with, and close enough to the 788 units at which a
 * car stops being drawn at all that the rule was being kept by 18 units of luck. Comparing
 * the traffic's own position costs one subtraction and makes {@link BOT_LOOKAHEAD} mean
 * what it says at every point on the road.
 */
export function readAhead(match: Readonly<Match>, seat: SeatId, lookahead: number): number {
  const taxi = seat === 'p1' ? match.p1 : match.p2;
  const from = cellOf(taxi.distance);
  const to = cellOf(taxi.distance + lookahead);
  for (let cell = from; cell <= to; cell += 1) {
    // Traffic stands in the middle of its cell and the cells are walked in order, so the
    // first one out of range puts every later one out of range too.
    if (trafficAlong(cell) - taxi.distance > lookahead) break;
    if (cell === taxi.hitCell) continue;
    if (maskAt(match.track, cell) === CLEAR) continue;
    if (taxi.distance >= trafficAlong(cell) + HIT_ALONG) continue;
    return cell;
  }
  return -1;
}

/**
 * What a bot is asking of its taxi this step: a line to hold, and whether to leave the
 * ground.
 *
 * A point across the road, never a direction: a bot names a lane the way a finger resting on
 * the glass does, and {@link steerFor} is what turns that into steering. It has no way to
 * cross the road sooner than a person because there is no such way.
 *
 * The hop is planned at a look and executed by the taxi's own odometer, which is how a
 * person plays it too — you see the jam, you decide where you are going to jump, and then
 * you jump there. The delay is on the *deciding*, which is the part a reaction time is
 * about; the tier's `hopSlip` is the error in the decision.
 *
 * **All four draws are taken on every look whether or not they are used.** A seat whose
 * draw count depends on what it decided shifts the other seat's stream, and that is a seat
 * bias rather than a coincidence. Four floats a look, unconditionally, and `rules.test.ts`
 * counts them.
 */
export function botDrive(
  match: Readonly<Match>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): void {
  const taxi = seat === 'p1' ? match.p1 : match.p2;
  state.hop = false;
  state.look -= fixedDeltaSeconds;

  if (state.look <= 0) {
    const profile = BOT_PROFILES[difficulty];
    const waver = rng.float();
    const slip = rng.float();
    const side = rng.float();
    const timing = rng.float();
    state.look = profile.reaction + waver * profile.waver;

    const cell = readAhead(match, seat, BOT_LOOKAHEAD);
    if (cell < 0) {
      // Open road. The middle is the best place to wait, because it is never more than two
      // lanes from any of them.
      state.want = 0;
      state.launchAt = -1;
    } else {
      const mask = maskAt(match.track, cell);
      const open = freeLaneNear(mask, taxi.across);
      if (open < 0) {
        // Nothing to steer for: hold the line it is on and plan the jump. A jam already being
        // cleared is left alone, or the bot would come down and immediately hop again.
        state.want = taxi.across;
        const centre = trafficAlong(cell);
        const reachable = taxi.hop <= 0 && taxi.distance < centre - HIT_ALONG;
        const missed = slip < profile.blunder;
        state.launchAt =
          reachable && !missed ? centre - HOP_AIM + (timing * 2 - 1) * profile.hopSlip : -1;
      } else {
        // A lane's worth of misread — the car beside the gap rather than the gap. Steering
        // somewhere random would be a different game; being one lane out is what a driver who
        // glanced too late actually does.
        const line = laneAcross(open);
        state.want = slip < profile.blunder ? line + (side < 0.5 ? -LANE_PITCH : LANE_PITCH) : line;
        state.launchAt = -1;
      }
    }
  }

  if (state.launchAt >= 0 && taxi.distance >= state.launchAt) {
    state.launchAt = -1;
    state.hop = true;
  }
}
