import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Robot Arena, as pure rules.
 *
 * Two robots in one square arena that is trying to kill both of them. Dodge the sweeping
 * blade, the lasers and the cannonballs; the last one moving wins the round. First to three.
 *
 * ## The whole design rests on one property
 *
 * **Every hazard is point-symmetric about the centre of the arena.** The blade is a bar
 * through the middle, so it is its own reflection. Lasers and cannonballs are spawned in
 * pairs, each the other turned half a turn about the centre. The two robots start at
 * reflected positions, and the two seats read the shared board from opposite sides.
 *
 * That is not decoration. In a survival game the obvious fairness question — "is the left
 * half as dangerous as the right?" — cannot be answered by tuning, only by measuring, and
 * a measurement is only ever evidence. Point symmetry makes it a *theorem*: whatever
 * threatens one robot threatens the other identically, at the same instant, at the
 * reflected place. There is no half that is safer, no seat that is favoured, and no
 * balance number to defend. **[ours]**
 *
 * It also gives the game its look for free — a board that is exactly the same upside down,
 * which is what a game played from two sides of one device should be.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const ARENA = 900;
export const CENTRE = ARENA / 2;
/** The rim. A robot outside this has left the floor. */
export const FLOOR_RADIUS = 400;

export const ROBOT_RADIUS = 24;
export const ROBOT_SPEED = 300;

/** Rounds a seat must win to take the match. */
export const TARGET_ROUNDS = 3;
/** Hard cap, so a match cannot go on for ever however it is played. */
export const MAX_ROUNDS = 9;

/** Seconds of calm at the start of a round, so both players can find their robot. */
export const GRACE_SECONDS = 1.2;
/** Seconds the result is held before the next round. */
export const SETTLE_SECONDS = 1.1;

/**
 * The blade: one bar through the centre, turning.
 *
 * A bar through the centre is its own point reflection, so a single blade is already fair
 * to both seats — the elegance that made it the first hazard rather than the third.
 */
export const BLADE_HALF_LENGTH = 330;
export const BLADE_HALF_WIDTH = 16;
export const BLADE_BASE_SPIN = 0.9;
/** Radians a second added to the blade for each second the round has run. */
export const BLADE_SPIN_RAMP = 0.075;

/** Lasers: a telegraphed line, then a lethal one. */
export const LASER_HALF_WIDTH = 15;
export const LASER_WARN_SECONDS = 0.85;
export const LASER_FIRE_SECONDS = 0.45;

export const SHOT_RADIUS = 15;
export const SHOT_SPEED = 340;

/** How many of each hazard may be live at once. Fixed, so nothing allocates per step. */
export const MAX_LASERS = 6;
export const MAX_SHOTS = 12;

/**
 * How the round escalates.
 *
 * Hazards arrive faster the longer the round runs, and this is what guarantees the round
 * ends: the interval falls without bound toward `MIN_INTERVAL`, and at that rate the floor
 * is covered faster than a robot at `ROBOT_SPEED` can cross it. There is no wall clock in
 * the termination argument at all — a round between two players who never move and a round
 * between two who never miss both finish, for the same reason.
 */
export const FIRST_INTERVAL = 2.1;
export const MIN_INTERVAL = 0.34;
/** Multiplied into the interval after each wave. */
export const INTERVAL_DECAY = 0.9;

export type Phase = 'grace' | 'live' | 'settling' | 'over';

export interface Robot {
  x: number;
  y: number;
  alive: boolean;
}

export interface Laser {
  active: boolean;
  /** True for a beam across the arena, false for one up it. */
  horizontal: boolean;
  /** The line's position on the other axis. */
  at: number;
  /** Counts down through the warning, then through the firing. */
  timer: number;
  firing: boolean;
}

export interface Shot {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Game {
  readonly p1: Robot;
  readonly p2: Robot;
  readonly lasers: Laser[];
  readonly shots: Shot[];
  bladeAngle: number;
  phase: Phase;
  /** Seconds the round has run. Drives the escalation, and nothing else. */
  elapsed: number;
  /** Seconds until the next wave of hazards. */
  nextWave: number;
  /** The interval the next wave will use. */
  interval: number;
  /** Counts down the grace period and the settle. */
  hold: number;
  p1Rounds: number;
  p2Rounds: number;
  rounds: number;
  /** Who took the last round, or 'draw'. Null before the first is decided. */
  lastRound: SeatId | 'draw' | null;
  winner: SeatId | 'draw' | null;
}

function makeLaser(): Laser {
  return { active: false, horizontal: true, at: 0, timer: 0, firing: false };
}

function makeShot(): Shot {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0 };
}

/** The two starting positions, reflected through the centre. */
export const START_OFFSET = 220;

export function createGame(): Game {
  const lasers: Laser[] = [];
  for (let i = 0; i < MAX_LASERS; i += 1) lasers.push(makeLaser());
  const shots: Shot[] = [];
  for (let i = 0; i < MAX_SHOTS; i += 1) shots.push(makeShot());

  return {
    p1: { x: CENTRE, y: CENTRE + START_OFFSET, alive: true },
    p2: { x: CENTRE, y: CENTRE - START_OFFSET, alive: true },
    lasers,
    shots,
    bladeAngle: 0,
    phase: 'grace',
    elapsed: 0,
    nextWave: 0,
    interval: FIRST_INTERVAL,
    hold: GRACE_SECONDS,
    p1Rounds: 0,
    p2Rounds: 0,
    rounds: 0,
    lastRound: null,
    winner: null,
  };
}

export function robotOf(game: Readonly<Game>, seat: SeatId): Robot {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function roundsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Rounds : game.p2Rounds;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Reflect a point through the centre of the arena. The one operation fairness rests on. */
export function reflect(value: number): number {
  return ARENA - value;
}

export function startRound(game: Game): void {
  game.p1.x = CENTRE;
  game.p1.y = CENTRE + START_OFFSET;
  game.p1.alive = true;
  game.p2.x = reflect(game.p1.x);
  game.p2.y = reflect(game.p1.y);
  game.p2.alive = true;

  for (const laser of game.lasers) laser.active = false;
  for (const shot of game.shots) shot.active = false;
  game.bladeAngle = 0;
  game.elapsed = 0;
  game.interval = FIRST_INTERVAL;
  game.nextWave = FIRST_INTERVAL;
  game.phase = 'grace';
  game.hold = GRACE_SECONDS;
  game.rounds += 1;
}

export function resetGame(game: Game): void {
  game.p1Rounds = 0;
  game.p2Rounds = 0;
  game.rounds = 0;
  game.lastRound = null;
  game.winner = null;
  startRound(game);
}

/** Whether a point is off the floor. */
export function offFloor(x: number, y: number): boolean {
  return Math.hypot(x - CENTRE, y - CENTRE) > FLOOR_RADIUS - ROBOT_RADIUS;
}

/** Move a robot by an intent vector, each component in −1..1, and hold it on the floor. */
export function driveRobot(robot: Robot, dx: number, dy: number, fixedDeltaSeconds: number): void {
  if (!robot.alive) return;
  const length = Math.hypot(dx, dy);
  if (length > 1e-6) {
    // Normalised, so a diagonal is not faster than a straight line — the oldest bug in
    // eight-way movement, and one a keyboard makes very easy to hit.
    const scale = (ROBOT_SPEED * fixedDeltaSeconds) / Math.max(1, length);
    robot.x += dx * scale;
    robot.y += dy * scale;
  }
  // Held on the floor rather than killed by it: the arena is the safe place and the
  // hazards are the danger. A rim that killed would make the game about the rim.
  const offsetX = robot.x - CENTRE;
  const offsetY = robot.y - CENTRE;
  const distance = Math.hypot(offsetX, offsetY);
  const limit = FLOOR_RADIUS - ROBOT_RADIUS;
  if (distance > limit && distance > 0) {
    robot.x = CENTRE + (offsetX / distance) * limit;
    robot.y = CENTRE + (offsetY / distance) * limit;
  }
}

/** Distance from a point to the blade's bar, which passes through the centre. */
export function bladeDistance(game: Readonly<Game>, x: number, y: number): number {
  const dx = x - CENTRE;
  const dy = y - CENTRE;
  const cos = Math.cos(game.bladeAngle);
  const sin = Math.sin(game.bladeAngle);
  // Along the bar, and across it.
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  if (Math.abs(along) > BLADE_HALF_LENGTH) {
    // Past the tip: measure to the tip itself, so the end of the bar is round rather than
    // a step change that a robot could stand inside.
    const overshoot = Math.abs(along) - BLADE_HALF_LENGTH;
    return Math.hypot(overshoot, across);
  }
  return Math.abs(across);
}

function spawnLaserPair(game: Game, rng: Rng): void {
  // A line and its reflection. `at` is measured on the other axis, so reflecting it is
  // `ARENA - at` — the same operation the robots' start positions use.
  const horizontal = rng.float() < 0.5;
  const at = CENTRE - FLOOR_RADIUS * 0.8 + rng.float() * FLOOR_RADIUS * 0.8;
  addLaser(game, horizontal, at);
  addLaser(game, horizontal, reflect(at));
}

function addLaser(game: Game, horizontal: boolean, at: number): void {
  for (const laser of game.lasers) {
    if (laser.active) continue;
    laser.active = true;
    laser.horizontal = horizontal;
    laser.at = at;
    laser.timer = LASER_WARN_SECONDS;
    laser.firing = false;
    return;
  }
}

function spawnShotPair(game: Game, rng: Rng): void {
  const angle = rng.float() * Math.PI * 2;
  const x = CENTRE + Math.cos(angle) * FLOOR_RADIUS;
  const y = CENTRE + Math.sin(angle) * FLOOR_RADIUS;
  // Aimed across the floor rather than at anybody: a shot that tracked a robot would be
  // information a player cannot have, and it would not reflect.
  const spread = (rng.float() - 0.5) * 0.9;
  const heading = angle + Math.PI + spread;
  addShot(game, x, y, Math.cos(heading) * SHOT_SPEED, Math.sin(heading) * SHOT_SPEED);
  addShot(
    game,
    reflect(x),
    reflect(y),
    -Math.cos(heading) * SHOT_SPEED,
    -Math.sin(heading) * SHOT_SPEED,
  );
}

function addShot(game: Game, x: number, y: number, vx: number, vy: number): void {
  for (const shot of game.shots) {
    if (shot.active) continue;
    shot.active = true;
    shot.x = x;
    shot.y = y;
    shot.vx = vx;
    shot.vy = vy;
    return;
  }
}

export interface StepResult {
  /** Seats that died this step. Both can, which is a drawn round. */
  readonly died: readonly SeatId[];
  /** True on the step a round was decided. */
  readonly roundOver: boolean;
}

const diedScratch: SeatId[] = [];
const result: { died: SeatId[]; roundOver: boolean } = { died: diedScratch, roundOver: false };
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** One fixed step. Robots are moved by the caller first. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  diedScratch.length = 0;
  result.roundOver = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'settling') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) {
      if (decided(game)) finish(game);
      else startRound(game);
    }
    return result;
  }

  // The blade turns through the grace period too, so the first thing a player sees is the
  // hazard they will have to read for the rest of the round.
  game.bladeAngle += (BLADE_BASE_SPIN + game.elapsed * BLADE_SPIN_RAMP) * fixedDeltaSeconds;
  if (game.bladeAngle > Math.PI * 2) game.bladeAngle -= Math.PI * 2;

  if (game.phase === 'grace') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) game.phase = 'live';
    return result;
  }

  game.elapsed += fixedDeltaSeconds;
  advanceHazards(game, fixedDeltaSeconds);

  game.nextWave -= fixedDeltaSeconds;
  if (game.nextWave <= 0) {
    if (rng.float() < 0.5) spawnLaserPair(game, rng);
    else spawnShotPair(game, rng);
    game.interval = Math.max(MIN_INTERVAL, game.interval * INTERVAL_DECAY);
    game.nextWave = game.interval;
  }

  // Both robots are tested against the same board before either death is applied, so a
  // step that kills both kills both.
  for (const seat of SEATS) {
    const robot = robotOf(game, seat);
    if (!robot.alive) continue;
    if (struck(game, robot.x, robot.y)) diedScratch.push(seat);
  }
  for (const seat of diedScratch) robotOf(game, seat).alive = false;

  if (!game.p1.alive || !game.p2.alive) {
    endRound(game);
    result.roundOver = true;
  }
  return result;
}

function advanceHazards(game: Game, fixedDeltaSeconds: number): void {
  for (const laser of game.lasers) {
    if (!laser.active) continue;
    laser.timer -= fixedDeltaSeconds;
    if (laser.timer > 0) continue;
    if (laser.firing) laser.active = false;
    else {
      laser.firing = true;
      laser.timer = LASER_FIRE_SECONDS;
    }
  }

  for (const shot of game.shots) {
    if (!shot.active) continue;
    shot.x += shot.vx * fixedDeltaSeconds;
    shot.y += shot.vy * fixedDeltaSeconds;
    if (Math.hypot(shot.x - CENTRE, shot.y - CENTRE) > FLOOR_RADIUS + SHOT_RADIUS * 3) {
      shot.active = false;
    }
  }
}

/** Whether a robot at (x, y) is being hit by anything right now. */
export function struck(game: Readonly<Game>, x: number, y: number): boolean {
  if (bladeDistance(game, x, y) < BLADE_HALF_WIDTH + ROBOT_RADIUS) return true;

  for (const laser of game.lasers) {
    if (!laser.active || !laser.firing) continue;
    const offset = laser.horizontal ? y - laser.at : x - laser.at;
    if (Math.abs(offset) < LASER_HALF_WIDTH + ROBOT_RADIUS) return true;
  }

  for (const shot of game.shots) {
    if (!shot.active) continue;
    if (Math.hypot(shot.x - x, shot.y - y) < SHOT_RADIUS + ROBOT_RADIUS) return true;
  }
  return false;
}

function endRound(game: Game): void {
  const winner = game.p1.alive ? 'p1' : game.p2.alive ? 'p2' : 'draw';
  game.lastRound = winner;
  if (winner === 'p1') game.p1Rounds += 1;
  else if (winner === 'p2') game.p2Rounds += 1;
  game.phase = 'settling';
  game.hold = SETTLE_SECONDS;
}

function decided(game: Readonly<Game>): boolean {
  return (
    game.p1Rounds >= TARGET_ROUNDS || game.p2Rounds >= TARGET_ROUNDS || game.rounds >= MAX_ROUNDS
  );
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner =
    game.p1Rounds === game.p2Rounds ? 'draw' : game.p1Rounds > game.p2Rounds ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between decisions. Between them it holds the heading it chose. */
  readonly reaction: number;
  /** How far ahead it tests a heading for danger, in seconds. */
  readonly lookahead: number;
  /** How many headings it considers. More is finer dodging. */
  readonly fanSize: number;
}

/**
 * Three tiers, all of them seeing exactly the arena a player sees.
 *
 * They differ in how often they look, how far ahead they check, and how finely they can
 * pick a direction — never in speed, size, or knowledge of where the next wave will land.
 * Rule 6 is easy to keep here because the hazards are not aimed at anybody: a bot that
 * knew where a shot was going would know no more than the person watching it fly.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.28, lookahead: 0.3, fanSize: 5 },
  normal: { reaction: 0.13, lookahead: 0.55, fanSize: 9 },
  hard: { reaction: 0.05, lookahead: 0.95, fanSize: 17 },
});

export interface BotState {
  /** Seconds until it looks again. */
  cooldown: number;
  /** The heading it is holding, in radians. */
  heading: number;
  /** Whether it is moving at all. */
  moving: boolean;
}

export function createBotState(): BotState {
  return { cooldown: 0, heading: 0, moving: false };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.heading = 0;
  state.moving = false;
}

/**
 * Values a bot draws from the shared stream per decision. Always exactly this many.
 *
 * The two bots share the game's single `Rng`, so a seat whose draw count depended on what
 * it decided would shift the other seat's stream — a seat bias made of arithmetic, of
 * exactly the kind Fruit Duel was caught by. One draw, unconditionally, whatever it decides.
 */
export const BOT_DRAWS_PER_DECISION = 1;

/**
 * How long a robot at (x, y) heading `heading` survives, up to `seconds`.
 *
 * Sampled forward rather than solved: the arena is a rotating bar, a set of lines and a
 * handful of moving discs, and walking the path is both exact enough and cheaper than any
 * closed form. It reads the same board a player is looking at.
 */

/**
 * How many samples to take over `seconds`, at a fixed spacing.
 *
 * **A fixed sample *count* made the best tier the worst one.** Six samples over `hard`'s
 * 0.95 s lookahead are 158 ms apart, and a cannonball covers 54 units in that — about the
 * width of the collision it is being tested for, so shots passed clean between two samples
 * and `hard` walked into things `normal` saw at 92 ms spacing. Measured: `hard` against
 * `normal` lost 3-37, with both beating `easy` by the same margin.
 *
 * A fixed *spacing* means a longer lookahead costs proportionally more work rather than
 * proportionally more blindness, which is what looking further ahead should mean.
 */
const SAMPLE_SECONDS = 0.075;

function samplesFor(seconds: number): number {
  return Math.max(4, Math.round(seconds / SAMPLE_SECONDS));
}
export function survivalAlong(
  game: Readonly<Game>,
  x: number,
  y: number,
  heading: number,
  seconds: number,
): number {
  const steps = samplesFor(seconds);
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  for (let i = 1; i <= steps; i += 1) {
    const time = (seconds * i) / steps;
    const distance = ROBOT_SPEED * time;
    let atX = x + cos * distance;
    let atY = y + sin * distance;
    // A path that leaves the floor is not an escape: the rim holds a robot, so pressing
    // into it simply stops you somewhere predictable and lethal.
    const offsetX = atX - CENTRE;
    const offsetY = atY - CENTRE;
    const away = Math.hypot(offsetX, offsetY);
    const limit = FLOOR_RADIUS - ROBOT_RADIUS;
    if (away > limit && away > 0) {
      atX = CENTRE + (offsetX / away) * limit;
      atY = CENTRE + (offsetY / away) * limit;
    }
    if (struckAhead(game, atX, atY, time)) return time;
  }
  return seconds;
}

/**
 * Whether the board will be dangerous at (x, y) in `time` seconds.
 *
 * The blade's future angle and a shot's future position are both arithmetic a player does
 * by eye. A laser's warning is on the screen for everybody; a laser that has not been
 * announced yet is not consulted, because nobody can see it.
 */
function struckAhead(game: Readonly<Game>, x: number, y: number, time: number): boolean {
  const dx = x - CENTRE;
  const dy = y - CENTRE;
  const futureAngle = game.bladeAngle + (BLADE_BASE_SPIN + game.elapsed * BLADE_SPIN_RAMP) * time;
  const cos = Math.cos(futureAngle);
  const sin = Math.sin(futureAngle);
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  const bladeGap =
    Math.abs(along) > BLADE_HALF_LENGTH
      ? Math.hypot(Math.abs(along) - BLADE_HALF_LENGTH, across)
      : Math.abs(across);
  if (bladeGap < BLADE_HALF_WIDTH + ROBOT_RADIUS * 1.5) return true;

  for (const laser of game.lasers) {
    if (!laser.active) continue;
    // A warning that will still be a warning is not yet a threat; one that will be firing
    // is. Both are visible on screen.
    const firingThen = laser.firing ? laser.timer > time : laser.timer <= time;
    if (!firingThen) continue;
    const offset = laser.horizontal ? y - laser.at : x - laser.at;
    if (Math.abs(offset) < LASER_HALF_WIDTH + ROBOT_RADIUS * 1.5) return true;
  }

  for (const shot of game.shots) {
    if (!shot.active) continue;
    const atX = shot.x + shot.vx * time;
    const atY = shot.y + shot.vy * time;
    if (Math.hypot(atX - x, atY - y) < SHOT_RADIUS + ROBOT_RADIUS * 1.5) return true;
  }
  return false;
}

/**
 * Where the bot goes. Writes its intent into `out`, which the caller passes to
 * {@link driveRobot}, so a bot is subject to the same speed limit as a person.
 */
export function botIntent(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
  out: { x: number; y: number },
): void {
  const profile = BOT_PROFILES[difficulty];
  const robot = robotOf(game, seat);
  out.x = 0;
  out.y = 0;
  if (!robot.alive) return;

  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown <= 0) {
    state.cooldown = profile.reaction;

    /*
     * The fan is turned by a random fraction of one slot before it is walked.
     *
     * **Without it two equal bots draw every single round**, and that is the point
     * symmetry the whole game rests on turning round and biting. The board is its own
     * reflection and the two robots start at reflected positions, so two identical bots
     * facing it play mirror-image games and die on the same step, for ever. Measured
     * before this line existed: `hard` against `hard` finished 0-0 in every one of forty
     * matches.
     *
     * A phase offset is the smallest thing that breaks the mirror without breaking the
     * fairness — both seats draw from the same distribution, one value each, alternately,
     * and neither gets a better set of headings than the other. It is also more like a
     * person, who does not choose from a fixed compass rose.
     */
    const phase = rng.float() * ((Math.PI * 2) / profile.fanSize);

    // Standing still is a real option, and often the right one when the blade is on the
    // far side. A bot that always moved would walk into things nothing was pushing it into.
    let best = stillnessScore(game, robot.x, robot.y, profile.lookahead);
    let bestHeading = state.heading;
    let bestMoving = false;

    for (let i = 0; i < profile.fanSize; i += 1) {
      const heading = phase + (i / profile.fanSize) * Math.PI * 2;
      let score = survivalAlong(game, robot.x, robot.y, heading, profile.lookahead);
      // Faintly prefer the middle of the floor: a robot pinned to the rim has half the
      // escapes of one in the open, and nothing else in the scoring notices.
      const distance = Math.hypot(
        robot.x + Math.cos(heading) * 60 - CENTRE,
        robot.y + Math.sin(heading) * 60 - CENTRE,
      );
      score -= (distance / FLOOR_RADIUS) * 0.05;
      if (score > best) {
        best = score;
        bestHeading = heading;
        bestMoving = true;
      }
    }

    state.heading = bestHeading;
    state.moving = bestMoving;
  }

  if (!state.moving) return;
  out.x = Math.cos(state.heading);
  out.y = Math.sin(state.heading);
}

/** How long standing exactly here stays safe. */
function stillnessScore(game: Readonly<Game>, x: number, y: number, seconds: number): number {
  const steps = samplesFor(seconds);
  for (let i = 1; i <= steps; i += 1) {
    const time = (seconds * i) / steps;
    if (struckAhead(game, x, y, time)) return time;
  }
  return seconds;
}
