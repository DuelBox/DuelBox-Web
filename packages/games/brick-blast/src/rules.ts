import { circleAabb, createContact } from '@duelbox/engine';
import type { Aabb, Circle, Rng, SeatId } from '@duelbox/engine';

/**
 * Brick Blast, as pure rules: two paddles, two balls, and a wall of bricks between them.
 *
 * No rendering, no wall clock, no DOM. The game, the bot and the balance harness all drive
 * this same file, so what the harness measures is what a player feels.
 *
 * Every length is a logical unit and every speed a logical unit per second. p1 defends the
 * bottom baseline (y = height) and p2 the top (y = 0), matching the horizontal zone split
 * the manifest declares. The whole court is symmetric under a half turn about its centre:
 * every brick has a partner at (width - x, height - y), the two serve spots are each
 * other's image, and the two balls are launched as exact opposites. Neither seat is ever
 * handed the easier half.
 */

export interface Court {
  readonly width: number;
  readonly height: number;
}

/** Portrait, because two people share one phone held upright, one at each end. */
export const COURT: Court = { width: 640, height: 1000 };

export const BALL_RADIUS = 13;

export const PADDLE_HALF_WIDTH = 60;
export const PADDLE_HALF_HEIGHT = 13;

/** How far a paddle's centre line sits from its own baseline. */
export const PADDLE_INSET = 66;

/**
 * Units a second a paddle may travel. One ceiling for every driver of a paddle — a thumb,
 * a key, or a bot — so no instrument and no difficulty can out-run any other (rule 6).
 */
export const PADDLE_SPEED = 620;

/** Balls in play at once. Two, and they are launched as a mirrored pair. */
export const BALL_COUNT = 2;

/** Speed a ball leaves its serve spot with. */
export const SERVE_SPEED = 420;

/**
 * Ceiling on ball speed. One step at the simulation rate must move a ball less than the
 * ball-plus-paddle contact distance, or a fast ball would pass straight through a paddle
 * between two discrete tests: 1000 / 60 is 16.7 units against a contact distance of 26.
 */
export const MAX_BALL_SPEED = 1000;

/** Speed multiplier on every paddle return, so a rally tightens rather than idling. */
export const PADDLE_GAIN = 1.06;

/** Speed multiplier on every brick broken. Smaller: a wall break is not a rally. */
export const BRICK_GAIN = 1.012;

/**
 * Widest angle from straight-on that a paddle can send a ball, in radians.
 *
 * This is the whole skill of the game: a ball is not mirrored off a paddle, it leaves at
 * an angle set by **where along the paddle it struck**. A hit on the near edge sends it
 * out at 60 degrees; a hit on the middle sends it straight back. Both a dragged thumb and
 * a held key place a paddle, so both instruments express it equally.
 */
export const MAX_DEFLECTION = 1.05;

/**
 * The least vertical a ball may travel, as a fraction of its speed.
 *
 * A ball skimming sideways between two brick rows is the one position this court cannot
 * resolve on its own: nothing reaches it, so no point can be scored and the wall simply
 * regrows around it. Enforcing a floor on the vertical component costs nothing anybody can
 * feel — a paddle return is already at least 0.49 of its speed vertical — and removes the
 * stalemate outright rather than waiting for the backstop clock to notice.
 */
export const MIN_VERTICAL_FRACTION = 0.28;

/** Half-angle of the serve, in radians: about 13 degrees either side of straight. */
export const SERVE_SPREAD = 0.22;

/** How far the two serve spots sit either side of the centre of the court. */
export const SERVE_OFFSET_X = 150;
export const SERVE_OFFSET_Y = 140;

export const BRICK_COLUMNS = 8;
export const BRICK_ROWS = 4;
export const BRICK_COUNT = BRICK_COLUMNS * BRICK_ROWS;

/** Empty margin either side of the wall, so a ball can always be steered round it. */
export const BRICK_MARGIN = 40;
export const BRICK_GAP = 6;
export const BRICK_HEIGHT = 26;
export const BRICK_ROW_PITCH = 34;

/** Hit points a brick in one of the two centre rows starts with. */
export const BRICK_INNER_HP = 2;

/** Steps before rubble becomes a brick again. Counted in steps, never in seconds. */
export const REGROW_STEPS = 420;

/** A regrown brick comes back thin: a hole you punched stays easier than the wall was. */
export const REGROW_HP = 1;

/** The rate the fixed loop always runs at, for anything measured against a step. */
export const STEP_SECONDS = 1 / 60;

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** Which seat SCORED, i.e. the one whose baseline was NOT crossed. */
export type PointResult = 'none' | 'p1' | 'p2';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A paddle only ever moves along its own baseline, so one coordinate is the whole body. */
export interface Paddle {
  x: number;
}

export interface Wall {
  /** Hit points left in each brick, indexed by {@link brickIndex}; 0 while it is rubble. */
  readonly hp: Int16Array;
  /** Steps until rubble becomes a brick again; 0 for a brick that is standing. */
  readonly regrow: Int16Array;
}

interface BotProfile {
  /** Seconds of stale information the bot acts on. */
  readonly reactionSeconds: number;
  /** Logical units of noise on the place it aims for. */
  readonly aimError: number;
  /** Logical units per second it may ask its paddle to travel. Never above a human's. */
  readonly topSpeed: number;
}

/**
 * Difficulty is reaction delay, aim error and top speed, and nothing else. Every tier
 * reads the same two balls a player reads off the same screen, none of them is told where
 * a ball will go after it meets a brick, and none exceeds {@link PADDLE_SPEED}.
 */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { reactionSeconds: 0.38, aimError: 145, topSpeed: 260 },
  normal: { reactionSeconds: 0.2, aimError: 78, topSpeed: 400 },
  hard: { reactionSeconds: 0.06, aimError: 14, topSpeed: 610 },
};

/** Scratch shapes, at module scope so a step allocates nothing. */
const contact = createContact();
const ballShape: Circle = { x: 0, y: 0, radius: BALL_RADIUS };
const box: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Mirror `value` back and forth into [min, max], which is what a straight line does when
 * it bounces between two parallel walls. The bot predicts with it; nothing else does.
 */
export function foldIntoBand(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return min;
  const period = span * 2;
  let t = (value - min) % period;
  if (t < 0) t += period;
  return t <= span ? min + t : min + (period - t);
}

/** The y a seat's paddle sits on. Fixed: a paddle slides, it never advances. */
export function paddleY(seat: SeatId): number {
  return seat === 'p1' ? COURT.height - PADDLE_INSET : PADDLE_INSET;
}

export function createBall(): Ball {
  return { x: COURT.width / 2, y: COURT.height / 2, vx: 0, vy: 0 };
}

export function createPaddle(): Paddle {
  return { x: COURT.width / 2 };
}

export function brickIndex(column: number, row: number): number {
  return row * BRICK_COLUMNS + column;
}

export function brickColumn(index: number): number {
  return index % BRICK_COLUMNS;
}

export function brickRow(index: number): number {
  return Math.floor(index / BRICK_COLUMNS);
}

/** Width of one brick, gap included on one side only. */
export function brickWidth(): number {
  return (COURT.width - BRICK_MARGIN * 2) / BRICK_COLUMNS - BRICK_GAP;
}

export function brickCentreX(column: number): number {
  const pitch = (COURT.width - BRICK_MARGIN * 2) / BRICK_COLUMNS;
  return BRICK_MARGIN + pitch * (column + 0.5);
}

export function brickCentreY(row: number): number {
  const top = COURT.height / 2 - (BRICK_ROWS * BRICK_ROW_PITCH) / 2;
  return top + BRICK_ROW_PITCH * (row + 0.5);
}

/** The brick's box, written into `out`. Allocates nothing, so a step may call it freely. */
export function brickBounds(index: number, out: Aabb): Aabb {
  const halfWidth = brickWidth() / 2;
  const halfHeight = BRICK_HEIGHT / 2;
  const cx = brickCentreX(brickColumn(index));
  const cy = brickCentreY(brickRow(index));
  out.minX = cx - halfWidth;
  out.maxX = cx + halfWidth;
  out.minY = cy - halfHeight;
  out.maxY = cy + halfHeight;
  return out;
}

/**
 * Hit points a brick starts a point with.
 *
 * The two rows either side of the halfway line are double: the middle of the wall is what
 * both players are shooting through, so it is the part worth making them work for. Read
 * from the distance to the halfway row rather than from the row number, so the layout is
 * its own mirror image and neither seat faces the tougher face of the wall.
 */
export function initialHp(row: number): number {
  const middle = (BRICK_ROWS - 1) / 2;
  return Math.abs(row - middle) < 1 ? BRICK_INNER_HP : 1;
}

export function createWall(): Wall {
  const wall: Wall = { hp: new Int16Array(BRICK_COUNT), regrow: new Int16Array(BRICK_COUNT) };
  resetWall(wall);
  return wall;
}

/** Stand the whole wall back up. Called at every serve. */
export function resetWall(wall: Wall): void {
  for (let i = 0; i < BRICK_COUNT; i += 1) {
    wall.hp[i] = initialHp(brickRow(i));
    wall.regrow[i] = 0;
  }
}

export function brickHp(wall: Wall, index: number): number {
  return wall.hp[index] ?? 0;
}

export function brickRegrow(wall: Wall, index: number): number {
  return wall.regrow[index] ?? 0;
}

export function standingBricks(wall: Wall): number {
  let standing = 0;
  for (let i = 0; i < BRICK_COUNT; i += 1) {
    if (brickHp(wall, i) > 0) standing += 1;
  }
  return standing;
}

/**
 * One step of the wall's own life: rubble counts down and comes back.
 *
 * Counted in whole steps rather than in seconds so that the wall breathes at the same rate
 * on every device, whatever the frame rate the host happens to be running at.
 */
export function stepWall(wall: Wall): void {
  for (let i = 0; i < BRICK_COUNT; i += 1) {
    if (brickHp(wall, i) > 0) continue;
    const left = brickRegrow(wall, i) - 1;
    if (left > 0) {
      wall.regrow[i] = left;
      continue;
    }
    wall.regrow[i] = 0;
    wall.hp[i] = REGROW_HP;
  }
}

/** Take a hit point off a brick, and start its regrowth timer if that was the last one. */
export function damageBrick(wall: Wall, index: number): void {
  const left = brickHp(wall, index) - 1;
  if (left > 0) {
    wall.hp[index] = left;
    return;
  }
  wall.hp[index] = 0;
  wall.regrow[index] = REGROW_STEPS;
}

/** Where the ball with this index is served from. Spot 1 is spot 0 turned half a turn. */
export function serveSpotX(index: number): number {
  const offset = index === 0 ? -SERVE_OFFSET_X : SERVE_OFFSET_X;
  return COURT.width / 2 + offset;
}

export function serveSpotY(index: number): number {
  const offset = index === 0 ? SERVE_OFFSET_Y : -SERVE_OFFSET_Y;
  return COURT.height / 2 + offset;
}

/** Park both balls on their serve spots, at rest. The countdown runs, then they launch. */
export function placeServe(balls: readonly Ball[]): void {
  for (let i = 0; i < balls.length; i += 1) {
    const ball = balls[i];
    if (ball === undefined) continue;
    ball.x = serveSpotX(i);
    ball.y = serveSpotY(i);
    ball.vx = 0;
    ball.vy = 0;
  }
}

/**
 * Launch both balls, one at each player, as exact opposites.
 *
 * The angle is drawn once and spent twice — the second ball takes the negation of the
 * first's velocity, so the pair is its own half-turn image to the last bit. A serve can
 * therefore never favour a seat, however the angle falls.
 */
export function launchServe(balls: readonly Ball[], angle: number): void {
  const vx = Math.sin(angle) * SERVE_SPEED;
  const vy = Math.cos(angle) * SERVE_SPEED;
  const first = balls[0];
  const second = balls[1];
  if (first !== undefined) {
    first.vx = vx;
    first.vy = vy;
  }
  if (second !== undefined) {
    second.vx = -vx;
    second.vy = -vy;
  }
}

function clampSpeed(ball: Ball): void {
  const speedSq = ball.vx * ball.vx + ball.vy * ball.vy;
  if (speedSq <= MAX_BALL_SPEED * MAX_BALL_SPEED) return;
  const scale = MAX_BALL_SPEED / Math.sqrt(speedSq);
  ball.vx *= scale;
  ball.vy *= scale;
}

/** Multiply a ball's speed, keeping its direction and respecting the ceiling. */
export function accelerate(ball: Ball, gain: number): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= 0) return;
  const wanted = Math.min(speed * gain, MAX_BALL_SPEED);
  const scale = wanted / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

/** Keep the ball's travel at least {@link MIN_VERTICAL_FRACTION} vertical. */
export function enforceVertical(ball: Ball): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= 0) return;
  const least = speed * MIN_VERTICAL_FRACTION;
  if (Math.abs(ball.vy) >= least) return;
  // A ball with no vertical travel at all has no side to keep, so it is sent towards the
  // baseline it is already nearer — which is the mirror of what its own mirror is sent to.
  const towards = ball.vy < 0 ? -1 : ball.vy > 0 ? 1 : ball.y <= COURT.height / 2 ? -1 : 1;
  const across = Math.sqrt(Math.max(0, speed * speed - least * least));
  ball.vy = least * towards;
  ball.vx = ball.vx < 0 ? -across : across;
}

/**
 * Move a ball one step and bounce it off the side walls.
 *
 * There is no drag: a ball travels at a constant velocity between events, so the position
 * integral is exact however the step is chopped up and a 144 Hz laptop plays the same
 * match as a 60 Hz phone. Speed changes only at contacts, which are discrete events.
 */
export function stepBall(ball: Ball, dt: number): void {
  clampSpeed(ball);
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < BALL_RADIUS) {
    ball.x = BALL_RADIUS;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x > COURT.width - BALL_RADIUS) {
    ball.x = COURT.width - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx);
  }
}

/**
 * Resolve the ball against the wall and report the brick it broke into, or -1.
 *
 * At most one brick per ball per step, the deepest overlap of the ones it touches, so a
 * ball landing in the seam between two bricks resolves once against the one it is further
 * into rather than twice against both — which would cancel the bounce and leave it inside.
 */
export function collideBallBricks(ball: Ball, wall: Wall): number {
  ballShape.x = ball.x;
  ballShape.y = ball.y;

  let hit = -1;
  let depth = -1;
  let normalX = 0;
  let normalY = 0;
  for (let i = 0; i < BRICK_COUNT; i += 1) {
    if (brickHp(wall, i) <= 0) continue;
    brickBounds(i, box);
    if (!circleAabb(contact, ballShape, box)) continue;
    if (contact.depth <= depth) continue;
    depth = contact.depth;
    hit = i;
    normalX = contact.normalX;
    normalY = contact.normalY;
  }
  if (hit < 0) return -1;

  ball.x += normalX * depth;
  ball.y += normalY * depth;
  const into = ball.vx * normalX + ball.vy * normalY;
  if (into < 0) {
    ball.vx -= 2 * into * normalX;
    ball.vy -= 2 * into * normalY;
  }
  accelerate(ball, BRICK_GAIN);
  enforceVertical(ball);
  damageBrick(wall, hit);
  return hit;
}

/**
 * Resolve the ball against one seat's paddle and report whether it was returned.
 *
 * A paddle always sends a ball back up the court, whichever face it caught it on, so a
 * ball can never be knocked *behind* the paddle that just saved it. The angle comes from
 * where along the paddle the contact fell, and the speed goes up by {@link PADDLE_GAIN}.
 */
export function collideBallPaddle(ball: Ball, paddleX: number, seat: SeatId): boolean {
  const centreY = paddleY(seat);
  box.minX = paddleX - PADDLE_HALF_WIDTH;
  box.maxX = paddleX + PADDLE_HALF_WIDTH;
  box.minY = centreY - PADDLE_HALF_HEIGHT;
  box.maxY = centreY + PADDLE_HALF_HEIGHT;
  ballShape.x = ball.x;
  ballShape.y = ball.y;
  if (!circleAabb(contact, ballShape, box)) return false;

  ball.x += contact.normalX * contact.depth;
  ball.y += contact.normalY * contact.depth;

  // A ball already travelling away has been dealt with; it is only pushed clear so that it
  // cannot be dragged along inside the paddle by a player chasing it.
  const arriving = seat === 'p1' ? ball.vy > 0 : ball.vy < 0;
  if (!arriving) return false;

  const offset = clamp((ball.x - paddleX) / PADDLE_HALF_WIDTH, -1, 1);
  const angle = offset * MAX_DEFLECTION;
  const speed = Math.min(
    Math.max(Math.hypot(ball.vx, ball.vy), SERVE_SPEED) * PADDLE_GAIN,
    MAX_BALL_SPEED,
  );
  const away = seat === 'p1' ? -1 : 1;
  ball.vx = Math.sin(angle) * speed;
  ball.vy = Math.cos(angle) * speed * away;
  return true;
}

/** Which seat scored, once a ball has passed a baseline entirely. */
export function ballOut(ball: Ball): PointResult {
  if (ball.y - BALL_RADIUS > COURT.height) return 'p2';
  if (ball.y + BALL_RADIUS < 0) return 'p1';
  return 'none';
}

/**
 * Move a paddle towards a place on its baseline, under a speed ceiling.
 *
 * Every driver goes through this one function — a thumb, a key and a bot alike — so a
 * paddle can never be teleported and no instrument can cover the court faster than another.
 */
export function movePaddle(paddle: Paddle, targetX: number, speed: number, dt: number): void {
  const min = PADDLE_HALF_WIDTH;
  const max = COURT.width - PADDLE_HALF_WIDTH;
  const wanted = clamp(targetX, min, max);
  const reach = speed * dt;
  let travel = wanted - paddle.x;
  if (travel > reach) travel = reach;
  else if (travel < -reach) travel = -reach;
  paddle.x = clamp(paddle.x + travel, min, max);
}

/**
 * Where a bot wants its paddle, in logical units along its baseline.
 *
 * It reads the two balls' positions and velocities and nothing else: no future state, no
 * opponent intent, no knowledge of which brick a ball is about to meet. It picks whichever
 * ball reaches its own baseline first and predicts a straight line, folded off the side
 * walls — exactly the reading a player makes from the same picture. Its difficulty lives
 * entirely in how stale that reading is, how much noise sits on the answer, and how fast
 * it may ask its paddle to move.
 */
export function botTargetX(
  balls: readonly Ball[],
  seat: SeatId,
  difficulty: BotDifficulty,
  rng: Rng,
): number {
  const profile = BOT_PROFILES[difficulty];
  // Drawn every step whether or not it is used, so the stream advances at one rate.
  const noise = (rng.float() * 2 - 1) * profile.aimError;

  const line = paddleY(seat);
  const arriving = seat === 'p1' ? 1 : -1;
  let soonest = Infinity;
  let aim = COURT.width / 2;

  for (let i = 0; i < balls.length; i += 1) {
    const ball = balls[i];
    if (ball === undefined) continue;
    if (ball.vy * arriving <= 0) continue;
    // Acting on where the ball WAS is strictly less information than the player at the
    // other end has, never more.
    const wasX = ball.x - ball.vx * profile.reactionSeconds;
    const wasY = ball.y - ball.vy * profile.reactionSeconds;
    const time = (line - wasY) / ball.vy;
    if (time <= 0 || time >= soonest) continue;
    soonest = time;
    aim = foldIntoBand(wasX + ball.vx * time, BALL_RADIUS, COURT.width - BALL_RADIUS);
  }

  return clamp(aim + noise, PADDLE_HALF_WIDTH, COURT.width - PADDLE_HALF_WIDTH);
}
