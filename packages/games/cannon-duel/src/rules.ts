import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Cannon Duel, as pure rules.
 *
 * Two cannons facing each other down the board, and a crosswind. Aim by timing: a needle
 * sweeps, you press to keep the angle, it sweeps again for the power, you press again and
 * the shot goes. Three hits wins.
 *
 * ## Two decisions carry the whole game
 *
 * **Aiming is a press, never a drag.** A sweeping needle stopped by a button is the one
 * aiming idiom where a key and a thumb are *identical instruments* — both are a single
 * binary event with a timestamp, and neither can be aimed more finely than the other. Every
 * other aiming game in this catalogue has to think about whether a mouse out-points a
 * thumb; this one cannot have that problem.
 *
 * **The wind changes between volleys, never between shots.** Both players fire under the
 * same wind, and only then does it change — so a match is a sequence of identical problems
 * posed to two people, rather than a sequence of different problems handed out in turn. It
 * is the same idea as the equal-turns rule below, applied to the weather. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;

/**
 * The two cannons sit on the centre line, equally far from it.
 *
 * On the *same* vertical line deliberately: a shot then travels straight down the board and
 * the crosswind pushes it sideways, so both players face the identical problem in the
 * identical wind. Offsetting them would make one of them shoot across the wind and the
 * other along it.
 */
export const CANNON_OFFSET = 380;
export const P1_CANNON_Y = CENTRE_Y + CANNON_OFFSET;
export const P2_CANNON_Y = CENTRE_Y - CANNON_OFFSET;
export const CANNON_RADIUS = 34;

/** How near a shot has to land to count. */
export const HIT_RADIUS = 52;

export const SHOT_RADIUS = 12;
/**
 * The pull that brings a shot back down the board.
 *
 * Together with the power range this decides how much of the gauge is *usable*, and the
 * first numbers made most of it dead: at 620 with a 520-1150 power range, a straight shot
 * needed a muzzle speed of 949 to reach the far cannon at all, so the bottom two thirds of
 * the power gauge could not cross the board under any angle. A gauge that is mostly a
 * losing move is not a decision, it is a formality with a needle on it.
 */
export const GRAVITY = 480;

/** The needle sweeps between these, in radians from straight at the opponent. */
export const AIM_SWEEP = 0.72;
/** Radians a second the aim needle travels. */
export const AIM_RATE = 1.35;

export const MIN_POWER = 700;
export const MAX_POWER = 1250;
/** Fraction of the power range travelled per second. */
export const POWER_RATE = 0.85;

/** Wind, as a sideways acceleration. Redrawn once a volley. */
export const MAX_WIND = 210;

export const TARGET_HITS = 3;
/**
 * Volleys in a match, after which it is called on hits.
 *
 * A structural cap: two players who never hit anything would otherwise fire for ever, and
 * no clock would change that. Twelve volleys is twelve shots each.
 */
export const MAX_VOLLEYS = 12;

/** Seconds the result of a shot is held before the board turns. */
export const SETTLE_SECONDS = 0.7;

export type Phase = 'aiming' | 'powering' | 'flying' | 'settling' | 'over';

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Game {
  readonly shot: Shot;
  phase: Phase;
  active: SeatId;
  /** Sideways acceleration on a shot. Positive is toward +x. */
  wind: number;
  /** Where the aim needle is, in radians either side of straight ahead. */
  aim: number;
  /** Which way the needle is travelling. */
  aimRising: boolean;
  /** Where the power needle is, in 0..1. */
  power: number;
  powerRising: boolean;
  /** The angle locked in by the first press, once `phase` is past `aiming`. */
  lockedAim: number;
  p1Hits: number;
  p2Hits: number;
  /** Shots fired by each seat, so a match can only end on a completed volley. */
  p1Shots: number;
  p2Shots: number;
  volleys: number;
  settle: number;
  /** Whether the last shot landed. */
  lastHit: boolean;
  winner: SeatId | 'draw' | null;
}

export function createGame(): Game {
  return {
    shot: { x: 0, y: 0, vx: 0, vy: 0 },
    phase: 'aiming',
    active: 'p1',
    wind: 0,
    aim: 0,
    aimRising: true,
    power: 0,
    powerRising: true,
    lockedAim: 0,
    p1Hits: 0,
    p2Hits: 0,
    p1Shots: 0,
    p2Shots: 0,
    volleys: 1,
    settle: 0,
    lastHit: false,
    winner: null,
  };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function hitsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Hits : game.p2Hits;
}

export function cannonYOf(seat: SeatId): number {
  return seat === 'p1' ? P1_CANNON_Y : P2_CANNON_Y;
}

/** Which way a seat shoots: p1 fires up the board, p2 down it. */
export function firingSign(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

/** Roll a fresh crosswind. Called once a volley, never once a shot. */
export function rollWind(game: Game, rng: Rng): void {
  game.wind = (rng.float() * 2 - 1) * MAX_WIND;
}

/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK
 * alternates it across the rounds of a best-of so first-mover advantage washes out
 * (#2466), and a game that assumed seat one would leave that rotation reaching nothing.
 * The default exists only so the rules tests can name a concrete side.
 */
export function resetGame(game: Game, rng: Rng, opener: SeatId = 'p1'): void {
  game.p1Hits = 0;
  game.p2Hits = 0;
  game.p1Shots = 0;
  game.p2Shots = 0;
  game.volleys = 1;
  game.active = opener;
  game.winner = null;
  game.lastHit = false;
  beginAim(game);
  rollWind(game, rng);
}

function beginAim(game: Game): void {
  game.phase = 'aiming';
  game.aim = 0;
  game.aimRising = true;
  game.power = 0;
  game.powerRising = true;
  game.lockedAim = 0;
  game.settle = 0;
}

/**
 * Accept a press from the seat whose turn it is.
 *
 * The first locks the angle, the second the power and fires. Returns whether the press did
 * anything, so a caller need not re-derive the phase.
 */
export function press(game: Game, seat: SeatId): boolean {
  if (seat !== game.active) return false;
  if (game.phase === 'aiming') {
    game.lockedAim = game.aim;
    game.phase = 'powering';
    return true;
  }
  if (game.phase === 'powering') {
    fire(game);
    return true;
  }
  return false;
}

function fire(game: Game): void {
  const seat = game.active;
  const sign = firingSign(seat);
  const speed = MIN_POWER + game.power * (MAX_POWER - MIN_POWER);
  // The locked angle is measured from straight at the opponent, so the same number means
  // the same shot for both seats — the board is mirrored, and so is the geometry.
  const angle = game.lockedAim;
  game.shot.x = CENTRE_X + Math.sin(angle) * CANNON_RADIUS;
  game.shot.y = cannonYOf(seat) + sign * CANNON_RADIUS;
  game.shot.vx = Math.sin(angle) * speed * sign * -1;
  game.shot.vy = Math.cos(angle) * speed * sign;
  game.phase = 'flying';
  if (seat === 'p1') game.p1Shots += 1;
  else game.p2Shots += 1;
}

export interface StepResult {
  /** Set on the step a shot landed. */
  readonly landed: boolean;
  /** True when that shot hit the opposing cannon. */
  readonly hit: boolean;
  /** True on the step the turn passed. */
  readonly handedOver: boolean;
}

const result = { landed: false, hit: false, handedOver: false };

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  result.landed = false;
  result.hit = false;
  result.handedOver = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'settling') {
    game.settle -= fixedDeltaSeconds;
    if (game.settle <= 0) {
      handOver(game, rng);
      result.handedOver = true;
    }
    return result;
  }

  if (game.phase === 'aiming') {
    sweep(game, fixedDeltaSeconds);
    return result;
  }
  if (game.phase === 'powering') {
    sweepPower(game, fixedDeltaSeconds);
    return result;
  }

  // Flying.
  //
  // **The travel carries its `½·a·dt²` term, and that is what makes {@link predictLanding}
  // true.** Both accelerations are constant for the whole flight — the wind is rolled at
  // the handover, not during it — so `x += v·dt + a·dt²/2` is the exact integral, not an
  // improvement on an approximation of one.
  //
  // Written as `v += a·dt` and then `x += v·dt`, as it was, the step lands a whole `a·dt²`
  // rather than half of one, and the shortfall accumulates down the board: measured across
  // seats, angles, powers and winds, the stepped shot crossed the far cannon's line up to
  // **7.6 units** from where the closed form said it would, against a `HIT_RADIUS` of 52.
  // The bot aims by sweeping 441 pairs of that closed form and taking the nearest miss
  // (see {@link planShot}), so every tier was aiming at a board the game was not playing —
  // a systematic bias, not noise, and one no amount of tuning its timing error could reach.
  // That is CLAUDE.md rule 6 read backwards: the bot was handicapped by physics it did not
  // share. Crash It and Beach Ball already carry the term for the same reason.
  const shot = game.shot;
  const ax = game.wind;
  // Gravity pulls a shot back toward the seat that fired it, so an arc is an arc for both
  // players — down the board is "down" for whoever is shooting.
  const ay = -firingSign(game.active) * GRAVITY;
  const halfStepSq = 0.5 * fixedDeltaSeconds * fixedDeltaSeconds;
  shot.x += shot.vx * fixedDeltaSeconds + ax * halfStepSq;
  shot.y += shot.vy * fixedDeltaSeconds + ay * halfStepSq;
  shot.vx += ax * fixedDeltaSeconds;
  shot.vy += ay * fixedDeltaSeconds;

  const target = otherOf(game.active);
  const targetY = cannonYOf(target);
  const hit = Math.hypot(shot.x - CENTRE_X, shot.y - targetY) < HIT_RADIUS;
  const spent =
    hit ||
    shot.x < -SHOT_RADIUS ||
    shot.x > BOARD_WIDTH + SHOT_RADIUS ||
    shot.y < -SHOT_RADIUS ||
    shot.y > BOARD_HEIGHT + SHOT_RADIUS;
  if (!spent) return result;

  if (hit) {
    if (game.active === 'p1') game.p1Hits += 1;
    else game.p2Hits += 1;
  }
  game.lastHit = hit;
  game.phase = 'settling';
  game.settle = SETTLE_SECONDS;
  result.landed = true;
  result.hit = hit;
  return result;
}

function sweep(game: Game, fixedDeltaSeconds: number): void {
  game.aim += (game.aimRising ? 1 : -1) * AIM_RATE * fixedDeltaSeconds;
  if (game.aim >= AIM_SWEEP) {
    game.aim = AIM_SWEEP;
    game.aimRising = false;
  } else if (game.aim <= -AIM_SWEEP) {
    game.aim = -AIM_SWEEP;
    game.aimRising = true;
  }
}

function sweepPower(game: Game, fixedDeltaSeconds: number): void {
  game.power += (game.powerRising ? 1 : -1) * POWER_RATE * fixedDeltaSeconds;
  if (game.power >= 1) {
    game.power = 1;
    game.powerRising = false;
  } else if (game.power <= 0) {
    game.power = 0;
    game.powerRising = true;
  }
}

/**
 * Pass the cannon, and decide whether the match is over.
 *
 * **A match ends only on a completed volley** — both seats having fired the same number of
 * times — and only if one of them is then ahead. First-to-three would otherwise be won by
 * whoever shoots first whenever both players are good, which is the same trap Knife Thrower
 * fell into and the same answer darts and cricket reach.
 *
 * The wind is rolled here, at the end of a volley, so both players shot in the same one.
 */
function handOver(game: Game, rng: Rng): void {
  game.active = otherOf(game.active);
  beginAim(game);

  if (game.p1Shots !== game.p2Shots) return;

  game.volleys += 1;
  rollWind(game, rng);

  const ahead = game.p1Hits !== game.p2Hits;
  const reached = game.p1Hits >= TARGET_HITS || game.p2Hits >= TARGET_HITS;
  if ((reached && ahead) || game.volleys > MAX_VOLLEYS) finish(game);
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner = game.p1Hits === game.p2Hits ? 'draw' : game.p1Hits > game.p2Hits ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/**
 * Where a shot fired now, at `angle` and `power`, would cross the opposing cannon's line.
 *
 * Closed form rather than stepped, because it is exact and because the bot calls it many
 * times per decision. It is arithmetic on numbers a player can see: the wind arrow, the
 * needle, and the distance down the board.
 */
export function predictLanding(seat: SeatId, angle: number, power: number, wind: number): number {
  const sign = firingSign(seat);
  const speed = MIN_POWER + power * (MAX_POWER - MIN_POWER);
  const vy = Math.cos(angle) * speed * sign;
  const vx = Math.sin(angle) * speed * sign * -1;
  const distance = cannonYOf(otherOf(seat)) - (cannonYOf(seat) + sign * CANNON_RADIUS);

  // Solve distance = vy·t − sign·GRAVITY·t²/2 for the first positive t.
  const a = (-sign * GRAVITY) / 2;
  const b = vy;
  const c = -distance;
  const time = smallestPositiveRoot(a, b, c);
  if (time === null) return Number.NaN;

  const startX = CENTRE_X + Math.sin(angle) * CANNON_RADIUS;
  return startX + vx * time + (wind * time * time) / 2;
}

function smallestPositiveRoot(a: number, b: number, c: number): number | null {
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) return null;
    const root = -c / b;
    return root > 0 ? root : null;
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const sqrt = Math.sqrt(discriminant);
  const first = (-b + sqrt) / (2 * a);
  const second = (-b - sqrt) / (2 * a);
  const positives = [first, second].filter((root) => root > 1e-6).sort((x, y) => x - y);
  return positives.length > 0 ? (positives[0] as number) : null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the ideal moment it presses, in seconds. */
  readonly timing: number;
  /** How often it presses at an outright wrong moment. */
  readonly blunder: number;
}

/**
 * Three tiers, expressed only as how accurately a tier hits the moment it meant to.
 *
 * That is the whole of the skill this game asks for, so it is the whole of what the tiers
 * differ in. None of them sees the wind before it is drawn, and none can stop the needle
 * anywhere a person could not.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.115, blunder: 0.16 },
  normal: { timing: 0.05, blunder: 0.06 },
  hard: { timing: 0.018, blunder: 0.02 },
});

export interface BotState {
  /** The aim it wants, and the power it wants, decided once per shot. */
  wantAim: number;
  wantPower: number;
  /** Whether the plan has been made for this shot. */
  planned: boolean;
  /** Seconds of timing error committed to for this press. */
  offset: number;
}

export function createBotState(): BotState {
  return { wantAim: 0, wantPower: 0.5, planned: false, offset: 0 };
}

export function resetBotState(state: BotState): void {
  state.wantAim = 0;
  state.wantPower = 0.5;
  state.planned = false;
  state.offset = 0;
}

/**
 * Values a bot draws per shot. Always exactly this many.
 *
 * Both bots share the game's single `Rng`; a seat whose draw count depended on what it
 * chose would shift the other seat's stream, which is a seat bias made of arithmetic. Fruit
 * Duel was caught by exactly that.
 */
export const BOT_DRAWS_PER_SHOT = 3;

/**
 * Choose the shot, once, at the start of a turn.
 *
 * It searches the same two dials a player is watching, for the pair that lands nearest the
 * opposing cannon in the wind on the board. Every number it uses is on the screen.
 */
export function planShot(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const timingRoll = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  let bestAim = 0;
  let bestPower = 0.5;
  let bestMiss = Infinity;
  const aimSteps = 21;
  const powerSteps = 21;
  for (let i = 0; i < aimSteps; i += 1) {
    const angle = -AIM_SWEEP + (i / (aimSteps - 1)) * AIM_SWEEP * 2;
    for (let j = 0; j < powerSteps; j += 1) {
      const power = j / (powerSteps - 1);
      const landing = predictLanding(seat, angle, power, game.wind);
      if (!Number.isFinite(landing)) continue;
      const miss = Math.abs(landing - CENTRE_X);
      if (miss < bestMiss) {
        bestMiss = miss;
        bestAim = angle;
        bestPower = power;
      }
    }
  }

  state.wantAim = bestAim;
  state.wantPower = bestPower;
  state.offset = (timingRoll * 2 - 1) * profile.timing;
  if (blunderRoll < profile.blunder) state.offset += (blunderSize * 2 - 1) * profile.timing * 6;
  state.planned = true;
}

/**
 * Whether the bot presses this step.
 *
 * It presses when the needle is within one step's travel of where it wants it, offset by
 * the timing error it committed to. The error is in *seconds*, which is what a person's
 * error is; converting it to needle units here is what makes a fast sweep genuinely harder
 * for every tier.
 */
export function botPresses(
  game: Readonly<Game>,
  state: Readonly<BotState>,
  fixedDeltaSeconds: number,
): boolean {
  if (game.phase === 'aiming') {
    const wanted = state.wantAim + state.offset * AIM_RATE * (game.aimRising ? 1 : -1);
    return crossed(game.aim, wanted, AIM_RATE * fixedDeltaSeconds, game.aimRising);
  }
  if (game.phase === 'powering') {
    const wanted = state.wantPower + state.offset * POWER_RATE * (game.powerRising ? 1 : -1);
    return crossed(game.power, wanted, POWER_RATE * fixedDeltaSeconds, game.powerRising);
  }
  return false;
}

/** Whether a needle at `at`, moving `rising`, has reached `wanted` this step. */
function crossed(at: number, wanted: number, travel: number, rising: boolean): boolean {
  if (rising) return at >= wanted - travel;
  return at <= wanted + travel;
}
