import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Bowling, as pure rules.
 *
 * Four frames each. Two balls a frame to knock down ten pins, three in the last frame if
 * you earn them. Highest total wins.
 *
 * Two separate problems live here and they are kept apart on purpose:
 *
 * 1. **Scoring**, which is the intricate part — a strike is worth ten plus your *next two
 *    balls* and a spare ten plus your next one, so a frame's value is not known when it is
 *    bowled. Kept as a flat list of rolls with the score computed by walking it, which is
 *    the only shape where the bonuses stay obvious.
 * 2. **The lane**, which is a ball and ten pins knocking each other about.
 *
 * No rendering, no timing, no DOM.
 */

export const FRAMES = 4;
export const PINS = 10;
export const BALLS_PER_FRAME = 2;

export const LANE_WIDTH = 700;
export const LANE_LENGTH = 1000;
/** The gutters, measured in from each edge. */
export const GUTTER = 96;
export const FOUL_LINE_Y = 880;
export const HEAD_PIN_Y = 250;

export const BALL_RADIUS = 30;
export const PIN_RADIUS = 15;
/** Pins are far lighter than the ball, which is why a strike carries through the rack. */
export const BALL_MASS = 7;
export const PIN_MASS = 1;

/** How far off the head pin the pocket sits. Half a pin spacing, to the right. */
export const POCKET_OFFSET = 22;

export const THROW_SPEED = 1500;
export const ROLL_DRAG = 0.6;
export const PIN_DRAG = 0.08;
/**
 * How fast speed bleeds off, as the exponents behind the two drags.
 *
 * `v(t) = v₀ · DRAG^t` is the same statement as `v(t) = v₀ · e^(-RATE·t)`, and having the
 * rates as numbers is what lets {@link step} move a body by the *integral* of its decay
 * rather than by `v · dt`. A body running free covers exactly
 * `(v₀ - STOP_SPEED) / RATE` before it stops.
 *
 * A pin's rate is five times a ball's — it is felt-footed and stops quickly — which is why
 * the pins, not the ball, were the worse offender when the travel was a rectangle rule:
 * 2.10% long a step against the ball's 0.43%.
 */
export const ROLL_DRAG_RATE = -Math.log(ROLL_DRAG);
export const PIN_DRAG_RATE = -Math.log(PIN_DRAG);
/**
 * Below this a body is stopped, so the lane settles instead of creeping.
 *
 * Part of the distance law rather than a fudge on the end of one: a body covers
 * `(v₀ - STOP_SPEED) / RATE` and then stops dead on the stop line, whatever step size
 * happens to carry it across.
 */
export const STOP_SPEED = 14;
/** A pin knocked more than this from where it stood is down. */
export const FALL_DISTANCE = 26;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where a pin was set, so a knock can be measured against it. */
  readonly homeX: number;
  readonly homeY: number;
  /** Counted as knocked down. A scoring flag: a down pin is still sliding and still hits. */
  down: boolean;
  /** Cleared from the deck between balls. A swept pin is not there at all. */
  swept: boolean;
}

export type Phase = 'aiming' | 'rolling' | 'over';

export interface Game {
  readonly ball: Body;
  readonly pins: Body[];
  /** Every ball bowled, in order, by seat. The score is computed from these. */
  readonly rollsP1: number[];
  readonly rollsP2: number[];
  seat: SeatId;
  phase: Phase;
  /** 0-based frame each seat is on. */
  frameP1: number;
  frameP2: number;
  /** Balls bowled in the current frame. */
  ballInFrame: number;
  /** Pins standing at the start of the current ball, for the roll about to be recorded. */
  standingBefore: number;
}

/** The classic triangle, apex nearest the bowler. */
export const PIN_SPOTS: readonly (readonly [number, number])[] = Object.freeze(
  (() => {
    const spots: [number, number][] = [];
    const spacing = PIN_RADIUS * 2 + 22;
    for (let row = 0; row < 4; row += 1) {
      for (let slot = 0; slot <= row; slot += 1) {
        spots.push([
          LANE_WIDTH / 2 + (slot - row / 2) * spacing,
          HEAD_PIN_Y - row * spacing * 0.87,
        ]);
      }
    }
    return spots;
  })(),
);

function body(x: number, y: number): Body {
  return { x, y, vx: 0, vy: 0, homeX: x, homeY: y, down: false, swept: false };
}

export function createGame(): Game {
  return {
    ball: body(LANE_WIDTH / 2, FOUL_LINE_Y),
    pins: PIN_SPOTS.map(([x, y]) => body(x, y)),
    rollsP1: [],
    rollsP2: [],
    seat: 'p1',
    phase: 'aiming',
    frameP1: 0,
    frameP2: 0,
    ballInFrame: 0,
    standingBefore: PINS,
  };
}

export function rollsOf(game: Game, seat: SeatId): number[] {
  return seat === 'p1' ? game.rollsP1 : game.rollsP2;
}

export function frameOf(game: Game, seat: SeatId): number {
  return seat === 'p1' ? game.frameP1 : game.frameP2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Resets the rack and puts the ball back on the foul line. */
export function resetRack(game: Game, standing: readonly boolean[] | null = null): void {
  for (let i = 0; i < game.pins.length; i += 1) {
    const pin = game.pins[i];
    if (pin === undefined) continue;
    pin.x = pin.homeX;
    pin.y = pin.homeY;
    pin.vx = 0;
    pin.vy = 0;
    // `standing` re-sets only the pins that survived, which is what a second ball faces.
    // The rest are swept: off the deck, hitting nothing.
    const gone = standing !== null && standing[i] !== true;
    pin.down = gone;
    pin.swept = gone;
  }
  resetBall(game);
}

export function resetBall(game: Game): void {
  const ball = game.ball;
  ball.x = LANE_WIDTH / 2;
  ball.y = FOUL_LINE_Y;
  ball.vx = 0;
  ball.vy = 0;
  ball.down = false;
}

export function resetGame(game: Game): void {
  game.rollsP1.length = 0;
  game.rollsP2.length = 0;
  game.seat = 'p1';
  game.phase = 'aiming';
  game.frameP1 = 0;
  game.frameP2 = 0;
  game.ballInFrame = 0;
  game.standingBefore = PINS;
  resetRack(game);
}

export function standingCount(game: Game): number {
  let count = 0;
  for (const pin of game.pins) {
    if (!pin.down) count += 1;
  }
  return count;
}

/** Pins still physically on the deck, fallen or not. */
export function onDeckCount(game: Game): number {
  let count = 0;
  for (const pin of game.pins) {
    if (!pin.swept) count += 1;
  }
  return count;
}

/** Throw the ball. Angle is measured from straight up the lane; power is 0..1. */
export function bowl(game: Game, angle: number, power: number): boolean {
  if (game.phase !== 'aiming') return false;
  const clamped = Math.max(0, Math.min(1, power));
  if (clamped <= 0) return false;
  const ball = game.ball;
  ball.vx = Math.sin(angle) * THROW_SPEED * clamped;
  ball.vy = -Math.cos(angle) * THROW_SPEED * clamped;
  game.phase = 'rolling';
  game.standingBefore = standingCount(game);
  return true;
}

export function laneIsStill(game: Game): boolean {
  if (game.ball.vx !== 0 || game.ball.vy !== 0) return false;
  for (const pin of game.pins) {
    if (pin.swept) continue;
    if (pin.vx !== 0 || pin.vy !== 0) return false;
  }
  return true;
}

/** A ball past the pins, in a gutter, or stopped is spent. */
function ballIsSpent(game: Game): boolean {
  return game.ball.y < -BALL_RADIUS || (game.ball.vx === 0 && game.ball.vy === 0);
}

export interface StepResult {
  readonly settled: boolean;
}

/**
 * Roll one body by the analytic integral of its own decay, rather than by `v · dt`.
 *
 * `v · dt` is the rectangle rule under a curve that is falling all the way across the step,
 * so it overshoots by `dt · rate / 2` — measured, 0.43% a step for the ball and **2.10% for
 * a pin**, whose drag is five times heavier. The decay itself was already step-size exact;
 * only the travel was not. Under `v(t) = v₀ · DRAG^t` a body covers
 * `(v_before - v_after) / rate` in a step, and those terms telescope, so a free run totals
 * `(v₀ - STOP_SPEED) / rate` however finely it is sliced.
 *
 * The last step is coasted to the stop line rather than truncated at it, so where a body
 * finishes does not depend on which step happened to cross it. Soccer Pool's `step` is the
 * same three branches for the same reason; Mini Golf reaches the same place from constant
 * deceleration.
 *
 * Allocation-free (CLAUDE.md rule 5): scalars only, and the body is written in place.
 */
function roll(body: Body, keep: number, rate: number): void {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed === 0) return;
  if (speed <= STOP_SPEED) {
    body.vx = 0;
    body.vy = 0;
    return;
  }
  const ux = body.vx / speed;
  const uy = body.vy / speed;
  const next = speed * keep;
  if (next <= STOP_SPEED) {
    const travel = (speed - STOP_SPEED) / rate;
    body.x += ux * travel;
    body.y += uy * travel;
    body.vx = 0;
    body.vy = 0;
    return;
  }
  const travel = (speed - next) / rate;
  body.x += ux * travel;
  body.y += uy * travel;
  body.vx = ux * next;
  body.vy = uy * next;
}

/**
 * One fixed step of the lane.
 *
 * The moves are {@link roll} — the integral of the drag, not `v · dt`. See its note.
 */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  if (game.phase !== 'rolling') return { settled: true };

  const ball = game.ball;
  const ballKeep = Math.pow(ROLL_DRAG, fixedDeltaSeconds);
  const pinKeep = Math.pow(PIN_DRAG, fixedDeltaSeconds);

  roll(ball, ballKeep, ROLL_DRAG_RATE);
  // A ball in the gutter is gone: the channel walls straighten it and it runs on past the
  // rack. Zeroing the sideways velocity is the whole of the rule — a second guard skipping
  // the pin collision was redundant, since a ball held at x < 96 cannot reach a pin at
  // x > 270 anyway, and mutating it failed no test, which is how it showed.
  if (ball.x < GUTTER || ball.x > LANE_WIDTH - GUTTER) ball.vx = 0;

  // A ball past the deck has dropped into the pit. Without this it sails on above the
  // lane, still carrying speed, and takes about **eight seconds** to fall below the crawl
  // threshold — so every ball was followed by a long dead wait before the pins were
  // counted. Invisible in the unit tests, which simply stepped until it settled, and
  // obvious the first time a ball was bowled in a browser.
  if (ball.y < -BALL_RADIUS) {
    ball.vx = 0;
    ball.vy = 0;
  }

  // Every pin still on the deck moves and collides, **including ones already counted
  // down**. A pin that has been hit is sliding across the lane, and in bowling that is
  // exactly what takes out the pins behind it.
  //
  // Measured: with fallen pins removed from the physics the best tier strikes 50.7% of
  // first balls, and with them carrying it strikes 61.3%. (An earlier draft measured 0%,
  // but that was this and the pocket aim both missing at once — the pocket does most of
  // the work, and the carry is worth about ten points on top.)
  //
  // `down` is a scoring flag, not a physics one. Fallen pins are swept between balls by
  // `resetRack`, which is when a real lane clears them too.
  for (const pin of game.pins) {
    if (pin.swept) continue;
    roll(pin, pinKeep, PIN_DRAG_RATE);
    if (Math.hypot(pin.x - pin.homeX, pin.y - pin.homeY) > FALL_DISTANCE) pin.down = true;

    // The pit. A real deck has walls either side and a well behind it; without them a
    // struck pin slides off across empty space for ever, which is invisible on screen —
    // the renderer clips — but leaves the lane never settling and draw coordinates
    // hundreds of units outside the box.
    //
    // Bounded to the lane rather than to the whole logical width: pins belong on the deck,
    // and letting them come to rest out in the gutters read as a bug when it was drawn.
    const wall = GUTTER + PIN_RADIUS;
    if (pin.x < wall || pin.x > LANE_WIDTH - wall || pin.y < PIN_RADIUS) {
      pin.x = Math.max(wall, Math.min(LANE_WIDTH - wall, pin.x));
      pin.y = Math.max(PIN_RADIUS, pin.y);
      pin.vx = 0;
      pin.vy = 0;
      pin.down = true;
    }
  }

  resolveBallPins(game);
  resolvePins(game);

  return { settled: ballIsSpent(game) && laneIsStill(game) };
}

/**
 * The ball against a pin.
 *
 * The ball is seven times the mass of a pin, which is what makes a strike carry through the
 * rack rather than stopping dead on the head pin. Momentum along the line of centres, with
 * the ball keeping most of its speed.
 */
function resolveBallPins(game: Game): void {
  const ball = game.ball;
  const minimum = BALL_RADIUS + PIN_RADIUS;
  for (const pin of game.pins) {
    if (pin.swept) continue;
    const dx = pin.x - ball.x;
    const dy = pin.y - ball.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq >= minimum * minimum || distanceSq === 0) continue;
    const distance = Math.sqrt(distanceSq);
    const nx = dx / distance;
    const ny = dy / distance;

    const overlap = minimum - distance;
    pin.x += nx * overlap;
    pin.y += ny * overlap;

    const along = (pin.vx - ball.vx) * nx + (pin.vy - ball.vy) * ny;
    if (along > 0) continue;
    const total = BALL_MASS + PIN_MASS;
    const impulse = (2 * along) / total;
    ball.vx += impulse * PIN_MASS * nx;
    ball.vy += impulse * PIN_MASS * ny;
    pin.vx -= impulse * BALL_MASS * nx;
    pin.vy -= impulse * BALL_MASS * ny;
  }
}

/** Pin against pin, equal masses. */
function resolvePins(game: Game): void {
  const pins = game.pins;
  const minimum = PIN_RADIUS * 2;
  for (let i = 0; i < pins.length; i += 1) {
    const a = pins[i];
    if (a === undefined || a.swept) continue;
    for (let j = i + 1; j < pins.length; j += 1) {
      const b = pins[j];
      if (b === undefined || b.swept) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= minimum * minimum || distanceSq === 0) continue;
      const distance = Math.sqrt(distanceSq);
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = (minimum - distance) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      const along = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (along > 0) continue;
      a.vx += along * nx;
      a.vy += along * ny;
      b.vx -= along * nx;
      b.vy -= along * ny;
    }
  }
}

/**
 * The score of a list of rolls.
 *
 * Walked frame by frame rather than accumulated as the balls are bowled, because **a
 * frame's value is not known when it is bowled**: a strike is worth ten plus the next two
 * balls and a spare ten plus the next one. Keeping the rolls and walking them is the only
 * shape where those bonuses stay obvious, and an incomplete list simply scores what is
 * known so far.
 */
export function scoreOf(rolls: readonly number[], frames = FRAMES): number {
  let total = 0;
  let at = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const first = rolls[at];
    if (first === undefined) break;
    if (first === PINS) {
      total += PINS + (rolls[at + 1] ?? 0) + (rolls[at + 2] ?? 0);
      at += 1;
      continue;
    }
    const second = rolls[at + 1];
    if (second === undefined) {
      total += first;
      break;
    }
    if (first + second === PINS) {
      total += PINS + (rolls[at + 2] ?? 0);
    } else {
      total += first + second;
    }
    at += 2;
  }
  return total;
}

/** Whether a frame's first ball took everything. */
export function isStrike(rolls: readonly number[], at: number): boolean {
  return rolls[at] === PINS;
}

/**
 * Where each frame starts in the roll list, so a scoreboard can show frames.
 *
 * Returns one index a frame, and -1 for a frame not yet begun.
 */
export function frameStarts(out: number[], rolls: readonly number[], frames = FRAMES): number[] {
  out.length = 0;
  let at = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    if (at >= rolls.length) {
      out.push(-1);
      continue;
    }
    out.push(at);
    at += isStrike(rolls, at) ? 1 : 2;
  }
  return out;
}

export interface BallResult {
  /** Pins taken by this ball. */
  readonly knocked: number;
  /** True when the frame is finished and the lane changes hands. */
  readonly frameOver: boolean;
  /** True when both seats have bowled every frame. */
  readonly matchOver: boolean;
}

/**
 * Record the ball that has just come to rest.
 *
 * The last frame earns a third ball on a strike or a spare, which is the rule that makes a
 * final strike worth having rather than a formality.
 */
export function recordBall(game: Game): BallResult {
  const seat = game.seat;
  const rolls = rollsOf(game, seat);
  const knocked = game.standingBefore - standingCount(game);
  rolls.push(knocked);

  const isLastFrame = frameOf(game, seat) === FRAMES - 1;
  const framePins = game.ballInFrame === 0 ? knocked : (rolls[rolls.length - 2] ?? 0) + knocked;

  let frameOver: boolean;
  if (game.ballInFrame === 0) {
    // A strike ends the frame — unless it is the last, where it earns two more balls.
    frameOver = knocked === PINS && !isLastFrame;
  } else if (game.ballInFrame === 1) {
    frameOver = !(isLastFrame && framePins >= PINS);
  } else {
    frameOver = true;
  }

  if (!frameOver) {
    game.ballInFrame += 1;
    // A cleared rack is set up again; a partial one leaves the survivors standing.
    if (standingCount(game) === 0) resetRack(game);
    else
      resetRack(
        game,
        game.pins.map((pin) => !pin.down),
      );
    game.phase = 'aiming';
    return { knocked, frameOver: false, matchOver: false };
  }

  if (seat === 'p1') game.frameP1 += 1;
  else game.frameP2 += 1;
  game.ballInFrame = 0;
  resetRack(game);

  const matchOver = game.frameP1 >= FRAMES && game.frameP2 >= FRAMES;
  if (matchOver) {
    game.phase = 'over';
    return { knocked, frameOver: true, matchOver: true };
  }
  game.seat = otherOf(seat);
  game.phase = 'aiming';
  return { knocked, frameOver: true, matchOver: false };
}

export function winnerOf(game: Game): SeatId | 'draw' | null {
  if (game.phase !== 'over') return null;
  const p1 = scoreOf(game.rollsP1);
  const p2 = scoreOf(game.rollsP2);
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BOT_PROFILES: Readonly<
  Record<BotDifficulty, { readonly spread: number; readonly power: number }>
> = Object.freeze({
  easy: { spread: 0.24, power: 0.62 },
  normal: { spread: 0.1, power: 0.74 },
  hard: { spread: 0.045, power: 0.84 },
});

export interface Aim {
  readonly angle: number;
  readonly power: number;
}

/**
 * Where the bot rolls.
 *
 * It aims at the middle of what is still standing, which is what a person does, and its
 * error is drawn once for the ball rather than per step — a per-step error averages to zero
 * and every tier would bowl the same.
 */
export function botAim(game: Game, difficulty: BotDifficulty, roll: number): Aim {
  const profile = BOT_PROFILES[difficulty];
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const pin of game.pins) {
    if (pin.down || pin.swept) continue;
    sumX += pin.x;
    sumY += pin.y;
    count += 1;
  }
  if (count === 0) return { angle: 0, power: profile.power };

  let targetX = sumX / count;
  const targetY = sumY / count;

  // At a full rack, aim at the **pocket** rather than at the head pin.
  //
  // This is not a flourish: a ball that hits the one pin dead centre leaves a split, which
  // is why every bowler is taught to come in between the one and the three. Aiming at the
  // centroid made the most accurate tier the worst — `hard` averaged 8.9 pins against
  // `normal`'s 9.9, because it hit the middle every single time.
  if (count === PINS) targetX += POCKET_OFFSET;
  const ball = game.ball;
  const angle = Math.atan2(targetX - ball.x, ball.y - targetY);
  return { angle: angle + (roll * 2 - 1) * profile.spread, power: profile.power };
}

/** Unused by the game; the bot's error needs a seeded source in tests. */
export function rollFor(rng: Rng): number {
  return rng.float();
}
