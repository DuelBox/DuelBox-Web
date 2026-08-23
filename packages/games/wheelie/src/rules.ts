import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Wheelie, as pure rules.
 *
 * Two bikes, one lane each, one course. Lean back and the front wheel comes up; the higher
 * it rides the faster the bike goes. Lean too far and you go over backwards and lose the
 * best part of two seconds. Let the nose drop and you are slow again. The lane is strewn
 * with bumps that kick the nose up whether you wanted it or not.
 *
 * ## The lane is one number long **[ours]**
 *
 * A bike that cannot steer has a **distance and a speed**, and a pitch that is the whole
 * game. So the simulation is four numbers a rider — where it is, how fast, how far back it
 * is leaning, and how fast that angle is changing — plus a list of bumps read off by
 * distance. The side view exists only in the renderer.
 *
 * Both riders run the **identical** course from the identical start, so "was one lane
 * kinder?" has an answer before anybody moves, and the answer is no. That is the same
 * shared-deal trick as Star Catcher's sky and Slot Cars' circuit, and it costs one array.
 *
 * ## Why the pitch is a pendulum and not a slider
 *
 * Gravity's pull on the nose is `GRAVITY_TORQUE · cos(pitch)`: strongest with the wheel
 * on the ground and **nothing at all** at the balance point, where the rider is over the
 * rear axle. So the higher you ride the less help you get holding it there, and the lean
 * that holds 80° would fling you over from 30°. That single cosine is where the skill
 * lives, and it is why a wheelie is a thing people practise rather than a thing people do.
 *
 * No rendering, no timing, no DOM.
 */

/** How long the course is, in lane units. Fixed — this is the termination guarantee. */
export const COURSE_LENGTH = 7200;

/** Marker posts, so progress is a small legible number rather than a distance. */
export const SECTORS = 6;

/**
 * How far up the lane a rider can see, in lane units.
 *
 * A rules-module constant rather than a render one because **the bot is held to it**
 * (rule 6): it may not plan for a bump it could not have seen. `game.ts` scales its lane
 * so exactly this much course fits on screen ahead of the bike, which is what makes the
 * claim true rather than merely asserted.
 */
export const VISIBLE_AHEAD = 1000;

/**
 * Where the balance point sits, in radians, and therefore where a wheelie ends.
 *
 * Set just under a right angle on purpose. Gravity's restoring torque is
 * `GRAVITY_TORQUE · cos(pitch)`, which reaches zero at 90° and turns *helpful to the
 * flip* beyond it — so past the balance point no amount of anything saves you and the
 * rules would be lying to draw a recovery. Ending the wheelie a hair short of it means
 * every angle the game contains is one the rider could in principle have held.
 */
export const FLIP_PITCH = 1.55;

/** Below this the front wheel is on the ground: no wheelie, and a bump hits it head on. */
export const WHEEL_DOWN_PITCH = 0.1;

/**
 * The lean's authority against gravity's.
 *
 * `LEAN_TORQUE` must be the larger, and the reason is structural rather than a matter of
 * taste: at full lean the nose rises only while `LEAN_TORQUE > GRAVITY_TORQUE · cos(pitch)`,
 * and `cos` is one on the ground — so at any ratio of one or less the front wheel can never
 * leave the ground at all and the only control in the game does nothing. The same
 * inequality means **full lean has no equilibrium anywhere**: pinning the control flips you
 * every time, which is what makes holding a wheelie a skill rather than a switch. The lean
 * that holds a given angle is `(GRAVITY_TORQUE / LEAN_TORQUE) · cos(pitch)` — 0.80 flat on
 * the ground, 0.14 at 80°, so the whole craft is yank it up and then feather it.
 */
export const LEAN_TORQUE = 23.5;
export const GRAVITY_TORQUE = 18.75;

/**
 * How much the suspension takes out of the pitch rate, per second.
 *
 * With the torques above it sets how long a rider has to catch a runaway: linearised at
 * 80°, the pitch doubles its error in about a fifth of a second. That is what makes a
 * quarter-second reaction visibly worse than a twentieth. The first draft ran the whole
 * pendulum at a third of these torques, which put the runaway at about 0.6 s — and at 0.6 s
 * every reaction between 0.02 and 0.20 measured the *same* time to the line, so the tiers
 * had no axis at all. Scaling the pendulum up and the damping with it is what made the
 * reaction knob mean something.
 */
export const PITCH_DAMPING = 4.1;

/**
 * How fast the rider's weight can actually move, in lean units a second.
 *
 * The rate limit is the whole of rule 10 here. The control is a *level*, and both a held
 * key and a thumb slid up the lane change it at exactly this rate — so there is no repeat
 * rate to win, and a mashed key can only reach a lean a held one passed through on the
 * way. See `driveLean`.
 */
export const LEAN_RATE = 3.5;

/**
 * What the bike is worth flat and what it is worth up on the back wheel.
 *
 * Thrust is linear in pitch, so speed is a legible function of the angle: the terminal
 * speed is `thrust / DRAG` — 189 units a second with the nose down, 422 at the flip
 * angle. A little over two to one, which is enough that dropping the front wheel is a
 * real cost and not so much that one mistake ends the race.
 */
export const THRUST_LOW = 170;
export const THRUST_HIGH = 380;
/** Linear drag, so every pitch has its own terminal speed and the top speed needs no clamp. */
export const DRAG = 0.9;

/** Seconds lost going over backwards, and the speed you pick the bike back up at. */
export const FALL_SECONDS = 1.6;
export const REJOIN_SPEED = 90;

/**
 * What putting the front wheel back down costs, per radian a second of drop rate.
 *
 * Dropping the nose is not a crash — it is the cheap mistake, and the asymmetry against
 * `FALL_SECONDS` is the whole decision at a bump. But it is not free either: slamming it
 * down scrubs speed and easing it down does not, so there is something to be good at even
 * in giving up.
 */
export const LANDING_SCRUB = 22;
/** Drop rates past this scrub no more; a landing has a worst case. */
export const LANDING_REF = 3;

/**
 * The bumps: how many, how they are spread, and how hard they kick.
 *
 * `BUMPS` is a plain count, which is what makes termination structural — but it is not
 * the termination argument by itself, because a rider who never touches the control still
 * rolls (see `THRUST_LOW`). The course is a fixed length and the bikes always move
 * forward, so every match ends whatever anybody does.
 */
export const BUMPS = 18;
export const FIRST_BUMP = 620;
export const BUMP_SPACING = 360;
/** How far a bump may slide from its nominal place, as a fraction of the spacing. */
export const BUMP_JITTER = 0.32;
/**
 * How hard a bump kicks, at {@link KICK_REFERENCE}. Seeded per bump, so the read differs.
 *
 * Swept as a pair. Below about 2.5 the bumps were decoration — every tier rode its target
 * angle to the line without a single fall, and only `ride` moved the result. Above about
 * 8 every tier flipped a dozen times a race and their times came out within a second and a
 * half of each other, which is the same reading with the sign reversed: the game was
 * deciding the race, not the rider.
 */
export const BUMP_KICK_MIN = 3.2;
export const BUMP_KICK_MAX = 7;
/**
 * The speed a bump's rated kick is quoted at. Faster hits harder, in proportion.
 *
 * **This is the join between the two halves of the game, and without it there is no
 * game.** With a flat kick, a bump was either survivable at every speed — in which case
 * every tier rode its target angle to the line and only `ride` moved the result — or
 * survivable at none, in which case every tier flipped six times a race and the times came
 * out within a second of each other. Neither reading had a bot knob in it. Scaling the kick
 * by speed makes the risk a function of the greed: ride high and you go fast, and going
 * fast is exactly what makes the next bump able to throw you. It also drains the flip loop
 * that a flat kick created, where a rider picked the bike up slow, was thrown by the next
 * bump at the same strength, and never got going again.
 */
export const KICK_REFERENCE = 300;
/**
 * Speed lost hitting a bump with the front wheel on the ground.
 *
 * The other half of the decision. Take a bump in a wheelie and it is free — the kick is
 * even useful, since it is the cheapest lift there is. Take it flat and it costs this.
 */
export const BUMP_JOLT = 55;

/** Values drawn per bump when the course is dealt. Always exactly this many. */
export const BUMP_DRAWS = 2;

export type Phase = 'riding' | 'over';

export interface Bump {
  /** Distance along the course. */
  position: number;
  /** Radians a second of nose-up it adds. */
  kick: number;
}

export interface Rider {
  distance: number;
  speed: number;
  /** Radians. Zero is both wheels down; `FLIP_PITCH` is over. */
  pitch: number;
  pitchRate: number;
  /** The rider's weight, as a level in [0, 1]. What the control actually sets. */
  lean: number;
  /** Seconds left on the ground after going over; zero when riding. */
  down: number;
  falls: number;
  jolts: number;
  /** Index of the next bump this rider has yet to reach. */
  nextBump: number;
  /** Lane units covered with the front wheel up, which is what a wheelie is worth. */
  held: number;
  /** Set once it crosses the line, in seconds. */
  finished: number;
}

export interface Game {
  /** The course, dealt once and shared: both riders meet these same bumps. */
  readonly bumps: Bump[];
  readonly p1: Rider;
  readonly p2: Rider;
  phase: Phase;
  elapsed: number;
  winner: SeatId | 'draw' | null;
}

function makeRider(): Rider {
  return {
    distance: 0,
    speed: REJOIN_SPEED,
    pitch: 0,
    pitchRate: 0,
    lean: 0,
    down: 0,
    falls: 0,
    jolts: 0,
    nextBump: 0,
    held: 0,
    finished: -1,
  };
}

export function createGame(): Game {
  const bumps: Bump[] = [];
  for (let i = 0; i < BUMPS; i += 1) bumps.push({ position: 0, kick: BUMP_KICK_MIN });
  return { bumps, p1: makeRider(), p2: makeRider(), phase: 'riding', elapsed: 0, winner: null };
}

export function riderOf(game: Readonly<Game>, seat: SeatId): Rider {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * Deal the course.
 *
 * Every bump draws exactly {@link BUMP_DRAWS} values whatever it turns out to be, and the
 * whole course is dealt here rather than during the ride — so `step` touches no generator
 * at all and the lane cannot depend on how anybody rode it. That is the strongest form of
 * the separation Star Catcher had to argue for: there is no world stream left to share.
 */
export function resetGame(game: Game, rng: Rng): void {
  for (let i = 0; i < game.bumps.length; i += 1) {
    const slide = rng.float();
    const strength = rng.float();
    const bump = game.bumps[i] as Bump;
    bump.position = FIRST_BUMP + (i + (slide * 2 - 1) * BUMP_JITTER) * BUMP_SPACING;
    bump.kick = BUMP_KICK_MIN + strength * (BUMP_KICK_MAX - BUMP_KICK_MIN);
  }
  for (const rider of [game.p1, game.p2]) {
    rider.distance = 0;
    rider.speed = REJOIN_SPEED;
    rider.pitch = 0;
    rider.pitchRate = 0;
    rider.lean = 0;
    rider.down = 0;
    rider.falls = 0;
    rider.jolts = 0;
    rider.nextBump = 0;
    rider.held = 0;
    rider.finished = -1;
  }
  game.phase = 'riding';
  game.elapsed = 0;
  game.winner = null;
}

/**
 * Move a rider's weight toward a level, no faster than a rider can shift it.
 *
 * **A rate, never a set** — the same shape as Star Catcher's `driveNet` and for the same
 * reason. A pointer gives an absolute level and the keys give a direction, and because
 * both arrive here neither instrument can change the lean faster than the other. It also
 * means a *mashed* key is strictly weaker than a held one: mashing reaches, at best, a
 * lean the held key passed through on its way, and reaches it later.
 */
export function driveLean(rider: Rider, wantedLean: number, fixedDeltaSeconds: number): void {
  const wanted = clamp(wantedLean, 0, 1);
  const reach = LEAN_RATE * fixedDeltaSeconds;
  const gap = wanted - rider.lean;
  if (gap > reach) rider.lean += reach;
  else if (gap < -reach) rider.lean -= reach;
  else rider.lean = wanted;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** The lean that exactly holds a given pitch. The number a rider learns by feel. */
export function holdingLean(pitch: number): number {
  return clamp((GRAVITY_TORQUE / LEAN_TORQUE) * Math.cos(pitch), 0, 1);
}

/** Terminal speed at a pitch: thrust over drag. What the bike is worth at this angle. */
export function speedAt(pitch: number): number {
  const lift = clamp(pitch / FLIP_PITCH, 0, 1);
  return (THRUST_LOW + (THRUST_HIGH - THRUST_LOW) * lift) / DRAG;
}

/** Which sector a rider is in, from zero. The scoreboard number. */
export function sectorOf(rider: Readonly<Rider>): number {
  return Math.min(SECTORS, Math.floor((rider.distance / COURSE_LENGTH) * SECTORS));
}

export interface StepResult {
  /** Seats that went over backwards this step. */
  readonly fell: readonly SeatId[];
  /** Seats that took a bump with the front wheel down. */
  readonly jolted: readonly SeatId[];
  /** Seats that crossed the line this step. */
  readonly finished: readonly SeatId[];
}

const fellScratch: SeatId[] = [];
const joltedScratch: SeatId[] = [];
const finishedScratch: SeatId[] = [];
const result = { fell: fellScratch, jolted: joltedScratch, finished: finishedScratch };
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * One fixed step. Leans are set by the caller first, through {@link driveLean}.
 *
 * Both riders are advanced from the same state before either finish is recorded, so two
 * bikes crossing on the same step is a genuine dead heat rather than whichever was read
 * first. Nothing here draws a random value: the course was dealt at reset.
 */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  fellScratch.length = 0;
  joltedScratch.length = 0;
  finishedScratch.length = 0;
  if (game.phase === 'over') return result;

  game.elapsed += fixedDeltaSeconds;

  for (const seat of SEATS) {
    const rider = riderOf(game, seat);
    if (rider.finished >= 0) continue;

    if (rider.down > 0) {
      rider.down -= fixedDeltaSeconds;
      if (rider.down <= 0) {
        rider.down = 0;
        rider.speed = REJOIN_SPEED;
      }
      continue;
    }

    // The pendulum. Gravity's pull vanishes at the balance point, which is the whole game.
    const wasUp = rider.pitch > 0;
    const torque =
      LEAN_TORQUE * rider.lean -
      GRAVITY_TORQUE * Math.cos(rider.pitch) -
      PITCH_DAMPING * rider.pitchRate;
    rider.pitchRate += torque * fixedDeltaSeconds;
    rider.pitch += rider.pitchRate * fixedDeltaSeconds;

    if (rider.pitch >= FLIP_PITCH) {
      rider.pitch = 0;
      rider.pitchRate = 0;
      rider.lean = 0;
      rider.speed = 0;
      rider.down = FALL_SECONDS;
      rider.falls += 1;
      fellScratch.push(seat);
      continue;
    }

    if (rider.pitch <= 0) {
      // The front wheel lands. Slamming it down scrubs speed; easing it down does not.
      //
      // Only on the step it actually *arrives*: charging it on every step the wheel is
      // already down billed a stationary bike 165 units a second of scrub, because the
      // pitch rate gravity applies against the ground never reaches zero. An idle rider
      // then never finished the course at all — the termination argument failed on a
      // single missing edge test.
      if (wasUp && rider.pitchRate < 0) {
        rider.speed = Math.max(
          0,
          rider.speed + LANDING_SCRUB * Math.max(-LANDING_REF, rider.pitchRate),
        );
      }
      rider.pitch = 0;
      rider.pitchRate = 0;
    }

    const thrust = THRUST_LOW + (THRUST_HIGH - THRUST_LOW) * clamp(rider.pitch / FLIP_PITCH, 0, 1);
    rider.speed += (thrust - DRAG * rider.speed) * fixedDeltaSeconds;
    if (rider.speed < 0) rider.speed = 0;

    const travelled = rider.speed * fixedDeltaSeconds;
    rider.distance += travelled;
    if (rider.pitch > WHEEL_DOWN_PITCH) rider.held += travelled;

    // Bumps, taken in order. A rider on the back wheel rides over one for nothing and
    // keeps the kick; a rider with the wheel down wears it.
    for (;;) {
      const bump = rider.nextBump < game.bumps.length ? game.bumps[rider.nextBump] : undefined;
      if (bump === undefined || rider.distance < bump.position) break;
      rider.nextBump += 1;
      rider.pitchRate += kickOf(bump.kick, rider.speed);
      if (rider.pitch <= WHEEL_DOWN_PITCH) {
        rider.speed = Math.max(0, rider.speed - BUMP_JOLT);
        rider.jolts += 1;
        joltedScratch.push(seat);
      }
    }
  }

  for (const seat of SEATS) {
    const rider = riderOf(game, seat);
    if (rider.finished >= 0 || rider.distance < COURSE_LENGTH) continue;
    rider.finished = game.elapsed;
    finishedScratch.push(seat);
  }

  if (game.p1.finished >= 0 || game.p2.finished >= 0) settle(game);
  return result;
}

/**
 * Decide the race once anybody has crossed.
 *
 * The moment one bike finishes the other's place is already known, so the race is called
 * there rather than making the loser ride the rest of the course alone.
 */
function settle(game: Game): void {
  const p1 = game.p1.finished;
  const p2 = game.p2.finished;
  game.phase = 'over';
  if (p1 >= 0 && p2 >= 0) game.winner = p1 === p2 ? 'draw' : p1 < p2 ? 'p1' : 'p2';
  else game.winner = p1 >= 0 ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/** What a bump of a given rating actually delivers at a given speed. */
export function kickOf(rating: number, speed: number): number {
  return (rating * speed) / KICK_REFERENCE;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between decisions; between them it holds the lean it chose.
   *
   * **The one axis that is live everywhere**, and the only one that moves every tier in
   * both directions. Swept alone at each tier's own settings, in seconds to the line:
   * 0.42 / 0.30 / 0.18 / 0.11 / 0.055 gave `easy` 40.9 / 33.3 / 26.7 / 25.9 / 25.7 and
   * `hard` did not finish at all at 0.42. It flattens below about 0.1, which is why `hard`
   * sits at 0.055 rather than lower — 0.02 buys it 0.7 s and would be a number chosen for
   * the look of it.
   */
  readonly reaction: number;
  /**
   * The pitch it tries to hold, as a fraction of {@link FLIP_PITCH}.
   *
   * **Not a difficulty axis, and saying so is the point.** Swept alone, riding higher is
   * worth almost nothing to a tier that can hold it and is ruinous to one that cannot:
   * `hard` measured 25.6 / 25.0 / 24.7 / 25.5 seconds at 0.42 / 0.58 / 0.72 / 0.85, a
   * spread of under a second, while `easy` measured 30.4 at 0.42 and failed to finish 195
   * times in 200 at 0.72. That near-neutrality at the top is the *game* working rather
   * than the bot failing — the central decision is meant to have no dominant answer — but
   * it means the ladder cannot lean on it, and it does not: `reaction`, `foresight` and
   * `read` carry it. Each tier's value here is that tier's own measured best, and the
   * plateaus move up with tier because a rider who can catch it can afford to be up there.
   */
  readonly ride: number;
  /**
   * How far up the lane it notices a bump, in seconds of travel — capped at what is drawn.
   *
   * Strongly live downward at every tier and flat above each tier's knee: `hard` measured
   * 47.8 (192 unfinished) / 42.4 / 32.2 / 24.8 / 24.7 seconds at 0.12 / 0.26 / 0.4 / 0.7 /
   * 1.1. The knee climbs with the ride height, because a rider who is further up has
   * further to duck and so must start sooner.
   */
  readonly foresight: number;
  /**
   * How much of a bump's kick it accounts for when it decides how far to duck.
   *
   * Under-reading a bump is the commonest way to go over, and it is the thing a person
   * gets better at. Live below each tier's knee and flat above: `hard` measured 47.1 (187
   * unfinished) / 36.4 / 24.9 / 24.5 at 0.35 / 0.5 / 0.64 / 0.82. The knee is near 0.5 for
   * `easy` and near 0.7 for `hard`, again because of the ride height, so no tier is parked
   * on the flat for the shape of the table.
   */
  readonly read: number;
}

/**
 * Three tiers, and nothing in any of them is information a person cannot have.
 *
 * The lane is drawn ahead of the bike out to {@link VISIBLE_AHEAD} and the bot may not
 * look past it; the pitch, the rate and the speed are all on the screen; and the bot
 * writes a *lean*, which {@link driveLean} applies at the same rate a thumb gets. There is
 * nothing withheld here, only accuracy withdrawn — which is what rule 6 asks for.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.26, ride: 0.42, foresight: 0.3, read: 0.46 },
  normal: { reaction: 0.18, ride: 0.55, foresight: 0.42, read: 0.6 },
  hard: { reaction: 0.055, ride: 0.72, foresight: 1.1, read: 0.85 },
});

/**
 * The gains the bot holds its own pitch with, and the bot's skill floor rather than a
 * difficulty axis: every tier uses these.
 *
 * A proportional-derivative hold on top of {@link holdingLean}, which is the arithmetic
 * form of what a rider does by feel — lean the amount that holds this angle, plus a bit
 * for how far off it is, less a bit for how fast it is moving. Swept together: at a
 * proportional gain of 2.6 or more the bot fought the lean rate limit and shook itself
 * over (13 falls a race at `normal`), and at 1.8 with a slack derivative term it wandered
 * into the ground and paid the jolt eight times a race. 1.2 and 0.18 is the pair that
 * neither oscillates nor sags.
 */
export const PITCH_GAIN = 1.2;
export const RATE_GAIN = 0.18;

/** Seconds a rider needs per radian of nose dropped, at the point gravity pulls hardest. */
export const DUCK_LEAD = 0.6;

/**
 * How long a rider needs to drop the nose from one pitch to another.
 *
 * Gravity's pull is `cos(pitch)`, so the nose falls quickly near the ground and barely at
 * all near the balance point — which makes a *flat* seconds-per-radian wrong at both ends,
 * and wrong in a way that inverted a difficulty axis. With a flat 0.9 the bot began its
 * duck about three times too early for a shallow drop, and a tier that could see further
 * merely began that over-long duck sooner: `normal` measured 25.7 s at a foresight of 0.6
 * and 27.6 s at 1.1, so **more sight was worse** — the same shape Star Catcher's `sight`
 * had before it was fixed. Dividing by the cosine at the midpoint makes the estimate track
 * the physics, and foresight came out monotone at all three tiers.
 */
export function duckSeconds(fromPitch: number, toPitch: number): number {
  const drop = Math.max(0, fromPitch - toPitch);
  return (DUCK_LEAD * drop) / Math.max(0.25, Math.cos((fromPitch + toPitch) / 2));
}

/**
 * How much a bot's reaction wanders, as a fraction of it.
 *
 * **Without this two equal tiers dead-heat every match.** One course, one start, and a bot
 * with no randomness in it is a pure function of the state, so two of the same tier duck on
 * the same step and cross on the identical thousandth of a second. Measured before it
 * existed: 60 matches of `normal` against itself, 60 draws. A wander in *when it looks* is
 * the smallest honest separation and it is what distinguishes two people of the same
 * ability.
 */
export const REACTION_WANDER = 0.12;

/**
 * How far off its own decision a bot actually leans. Tier-independent on purpose.
 *
 * It began as a fourth difficulty axis and **it was a lie**: swept alone from 0 to 0.22 it
 * moved `normal` from 29.1 s to 28.1 s — that is, more slop measured *better*, because
 * shaking the bike about dropped its speed and a slower bike takes a gentler kick. Only
 * past 0.35 did it start to cost anything. A knob that reads as sloppiness and pays for
 * itself over its whole useful range is worse than no knob, so it is one small constant
 * now: nobody holds a wheelie perfectly steady, and no tier is claimed to.
 */
export const LEAN_WANDER = 0.05;

/**
 * Values a bot draws per decision. Always exactly this many, drawn before any branch.
 *
 * One for the reaction wander, one for the lean slip. **Each seat draws from its own
 * generator** (see `WheelieGame`), which is the half that is easy to miss: a constant count
 * is not enough on its own, because whichever seat is polled first still takes the earlier
 * value from a shared stream every single time.
 */
export const BOT_DRAWS_PER_DECISION = 2;

export interface BotState {
  cooldown: number;
  /** The lean it last decided on, held between decisions. */
  lean: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, lean: 0 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.lean = 0;
}

/**
 * The lean a bot is asking for this step. The caller feeds it to {@link driveLean}, so a
 * bot's weight moves at exactly the rate a person's does.
 *
 * It reads its own pitch, its own rate, its own speed and the bumps it can see. It cannot
 * see the other lane and it cannot see past {@link VISIBLE_AHEAD} — both are asserted by
 * rewriting the parts of the world it should not know about and checking the answer does
 * not move.
 */
export function botLean(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): number {
  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown > 0) return state.lean;
  // Both drawn before any branch on what it sees, so the count is constant.
  const wander = (rng.float() * 2 - 1) * REACTION_WANDER;
  const slip = (rng.float() * 2 - 1) * LEAN_WANDER;
  const profile = BOT_PROFILES[difficulty];
  state.cooldown = profile.reaction * (1 + wander);

  const rider = riderOf(game, seat);
  const ride = profile.ride * FLIP_PITCH;
  let target = ride;
  const speed = Math.max(rider.speed, 1);
  const horizon = Math.min(profile.foresight * speed, VISIBLE_AHEAD);
  // Every bump it can see, not merely the next one: two close together want one duck deep
  // enough for both, and noticing the second is exactly what more foresight buys.
  for (let i = rider.nextBump; i < game.bumps.length; i += 1) {
    const bump = game.bumps[i] as Bump;
    const gap = bump.position - rider.distance;
    if (gap > horizon) break;
    const rise = (kickOf(bump.kick, rider.speed) / PITCH_DAMPING) * profile.read;
    const ducked = clamp(ride - rise, WHEEL_DOWN_PITCH + 0.05, FLIP_PITCH);
    if (ducked >= target) continue;
    // Seen is not the same as due. Every tier starts its duck at the same moment; what a
    // short sight costs is the bumps it has not noticed by then.
    if (gap / speed <= duckSeconds(rider.pitch, ducked)) target = ducked;
  }

  const wanted =
    holdingLean(target) + PITCH_GAIN * (target - rider.pitch) - RATE_GAIN * rider.pitchRate + slip;
  state.lean = clamp(wanted, 0, 1);
  return state.lean;
}
