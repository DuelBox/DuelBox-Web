import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Mini Golf, as pure rules.
 *
 * Both players putt at the same hole, one after the other, from the same tee. Sink it in
 * fewer strokes than your opponent and you take the hole. **Get two holes clear and you
 * win** — so being one ahead is never enough, and a player who is behind is never out of it.
 *
 * That win condition is the interesting one. Every other game here is first-to-N or most
 * at the whistle; a two-clear lead means the match length is not bounded by the score, and
 * something else has to bound it.
 *
 * No rendering, no timing, no DOM.
 */

export const COURSE_WIDTH = 700;
export const COURSE_HEIGHT = 1000;
export const WALL = 26;

export const BALL_RADIUS = 14;
export const HOLE_RADIUS = 26;
/** Above this the ball rattles out rather than dropping. */
export const HOLE_CAPTURE_SPEED = 320;

export const PUTT_MAX_SPEED = 1250;
/** Per second. */
export const ROLL_DRAG = 0.18;
export const STOP_SPEED = 14;
export const WALL_BOUNCE = 0.72;

/** Holes clear that wins the match. */
export const LEAD_TO_WIN = 2;
/** The most holes a match can run, so a match always ends. */
export const MAX_HOLES = 9;
/** Strokes after which a hole is conceded, so one bad hole cannot run for ever. */
export const STROKE_LIMIT = 8;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Set once it has dropped. */
  sunk: boolean;
}

export interface Block {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type Phase = 'aiming' | 'rolling' | 'over';

export interface Game {
  readonly ball: Ball;
  /** The obstacles on this hole. Rebuilt each hole from the seeded rng. */
  readonly blocks: Block[];
  hole: { x: number; y: number };
  /** Whose putt it is. */
  seat: SeatId;
  phase: Phase;
  /** Strokes taken on this hole by each seat. */
  strokesP1: number;
  strokesP2: number;
  /** Whether each seat has finished this hole. */
  doneP1: boolean;
  doneP2: boolean;
  /** Holes won. */
  holesP1: number;
  holesP2: number;
  /** 0-based hole number. */
  holeNumber: number;
  winner: SeatId | 'draw' | null;
}

export const TEE_X = COURSE_WIDTH / 2;
export const TEE_Y = COURSE_HEIGHT - 140;

export function createGame(): Game {
  return {
    ball: { x: TEE_X, y: TEE_Y, vx: 0, vy: 0, sunk: false },
    blocks: [],
    hole: { x: COURSE_WIDTH / 2, y: 200 },
    seat: 'p1',
    phase: 'aiming',
    strokesP1: 0,
    strokesP2: 0,
    doneP1: false,
    doneP2: false,
    holesP1: 0,
    holesP2: 0,
    holeNumber: 0,
    winner: null,
  };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function strokesOf(game: Game, seat: SeatId): number {
  return seat === 'p1' ? game.strokesP1 : game.strokesP2;
}

export function isDone(game: Game, seat: SeatId): boolean {
  return seat === 'p1' ? game.doneP1 : game.doneP2;
}

export function holesOf(game: Game, seat: SeatId): number {
  return seat === 'p1' ? game.holesP1 : game.holesP2;
}

/**
 * Lay out a hole.
 *
 * The hole and the obstacles are drawn from the seeded rng, so a course is different every
 * match and identical on both devices. **Both players putt the same hole from the same
 * tee** — a course that differed between them would make the comparison meaningless.
 */
export function layOutHole(game: Game, rng: Rng): void {
  const margin = WALL + HOLE_RADIUS * 2;
  game.hole.x = margin + rng.float() * (COURSE_WIDTH - margin * 2);
  game.hole.y = margin + rng.float() * (COURSE_HEIGHT * 0.45 - margin);

  game.blocks.length = 0;
  const count = 2 + rng.int(0, 3);
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const w = 70 + rng.float() * 180;
      const h = 26 + rng.float() * 40;
      const x = WALL + rng.float() * (COURSE_WIDTH - WALL * 2 - w);
      // Never in the run-up to the tee, or the first putt is blind.
      const y = COURSE_HEIGHT * 0.18 + rng.float() * (COURSE_HEIGHT * 0.58 - h);
      const block = { x, y, w, h };
      if (blockBlocks(block, game.hole.x, game.hole.y, HOLE_RADIUS * 2)) continue;
      if (blockBlocks(block, TEE_X, TEE_Y, BALL_RADIUS * 4)) continue;
      game.blocks.push(block);
      break;
    }
  }
}

function blockBlocks(block: Block, x: number, y: number, room: number): boolean {
  return (
    x > block.x - room &&
    x < block.x + block.w + room &&
    y > block.y - room &&
    y < block.y + block.h + room
  );
}

export function teeUp(game: Game): void {
  const ball = game.ball;
  ball.x = TEE_X;
  ball.y = TEE_Y;
  ball.vx = 0;
  ball.vy = 0;
  ball.sunk = false;
}

export function resetGame(game: Game, rng: Rng): void {
  game.seat = 'p1';
  game.phase = 'aiming';
  game.strokesP1 = 0;
  game.strokesP2 = 0;
  game.doneP1 = false;
  game.doneP2 = false;
  game.holesP1 = 0;
  game.holesP2 = 0;
  game.holeNumber = 0;
  game.winner = null;
  layOutHole(game, rng);
  teeUp(game);
}

/** Strike the ball. Angle in radians, power 0..1. */
export function putt(game: Game, angle: number, power: number): boolean {
  if (game.phase !== 'aiming') return false;
  const clamped = power < 0 ? 0 : power > 1 ? 1 : power;
  if (clamped <= 0) return false;
  const ball = game.ball;
  ball.vx = Math.cos(angle) * PUTT_MAX_SPEED * clamped;
  ball.vy = Math.sin(angle) * PUTT_MAX_SPEED * clamped;
  ball.sunk = false;
  game.phase = 'rolling';
  if (game.seat === 'p1') game.strokesP1 += 1;
  else game.strokesP2 += 1;
  return true;
}

export function ballIsStill(game: Game): boolean {
  return game.ball.vx === 0 && game.ball.vy === 0;
}

export interface StepResult {
  /** True on the step the ball comes to rest or drops. */
  readonly settled: boolean;
  readonly sunk: boolean;
}

/** One fixed step of the ball. */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  if (game.phase !== 'rolling') return { settled: true, sunk: game.ball.sunk };

  const ball = game.ball;
  const keep = Math.pow(ROLL_DRAG, fixedDeltaSeconds);
  ball.x += ball.vx * fixedDeltaSeconds;
  ball.y += ball.vy * fixedDeltaSeconds;
  ball.vx *= keep;
  ball.vy *= keep;
  if (Math.hypot(ball.vx, ball.vy) < STOP_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
  }

  bounceOffWalls(ball);
  for (const block of game.blocks) bounceOffBlock(ball, block);

  // The hole only takes a ball that is not travelling too fast — a putt hit hard enough
  // rattles across it, which is what makes power a decision rather than a formality.
  const toHole = Math.hypot(ball.x - game.hole.x, ball.y - game.hole.y);
  if (toHole < HOLE_RADIUS && Math.hypot(ball.vx, ball.vy) < HOLE_CAPTURE_SPEED) {
    ball.sunk = true;
    ball.vx = 0;
    ball.vy = 0;
    ball.x = game.hole.x;
    ball.y = game.hole.y;
    return { settled: true, sunk: true };
  }

  return { settled: ballIsStill(game), sunk: false };
}

function bounceOffWalls(ball: Ball): void {
  const low = WALL + BALL_RADIUS;
  const highX = COURSE_WIDTH - low;
  const highY = COURSE_HEIGHT - low;
  if (ball.x < low) {
    ball.x = low;
    ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
  } else if (ball.x > highX) {
    ball.x = highX;
    ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
  }
  if (ball.y < low) {
    ball.y = low;
    ball.vy = Math.abs(ball.vy) * WALL_BOUNCE;
  } else if (ball.y > highY) {
    ball.y = highY;
    ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE;
  }
}

/**
 * A ball against a rectangle.
 *
 * Pushed out along whichever axis it is least deep in, which is what stops a ball that
 * clips a corner from being flung along the wrong axis.
 */
function bounceOffBlock(ball: Ball, block: Block): void {
  const left = block.x - BALL_RADIUS;
  const right = block.x + block.w + BALL_RADIUS;
  const top = block.y - BALL_RADIUS;
  const bottom = block.y + block.h + BALL_RADIUS;
  if (ball.x < left || ball.x > right || ball.y < top || ball.y > bottom) return;

  const fromLeft = ball.x - left;
  const fromRight = right - ball.x;
  const fromTop = ball.y - top;
  const fromBottom = bottom - ball.y;
  const least = Math.min(fromLeft, fromRight, fromTop, fromBottom);

  if (least === fromLeft) {
    ball.x = left;
    ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
  } else if (least === fromRight) {
    ball.x = right;
    ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
  } else if (least === fromTop) {
    ball.y = top;
    ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE;
  } else {
    ball.y = bottom;
    ball.vy = Math.abs(ball.vy) * WALL_BOUNCE;
  }
}

export interface PuttOutcome {
  /** Who putts next. */
  readonly next: SeatId;
  /** True when this putt finished the hole for everyone. */
  readonly holeOver: boolean;
  /** Who took the hole, or 'draw'; null while it is still being played. */
  readonly holeWinner: SeatId | 'draw' | null;
  readonly winner: SeatId | 'draw' | null;
}

/**
 * Settle a putt that has come to rest.
 *
 * A seat keeps putting until it is done — sunk, or out of strokes — and only then does the
 * other take its turn. Alternating stroke by stroke would mean re-teeing the ball twice a
 * stroke, and the ball is the thing a player is looking at.
 */
export function settlePutt(game: Game, rng: Rng): PuttOutcome {
  const seat = game.seat;
  if (game.ball.sunk) markDone(game, seat);
  else if (strokesOf(game, seat) >= STROKE_LIMIT) markDone(game, seat);

  if (!isDone(game, seat)) {
    game.phase = 'aiming';
    return { next: seat, holeOver: false, holeWinner: null, winner: null };
  }

  const other = otherOf(seat);
  if (!isDone(game, other)) {
    game.seat = other;
    game.phase = 'aiming';
    teeUp(game);
    return { next: other, holeOver: false, holeWinner: null, winner: null };
  }

  // Both are done: fewer strokes takes the hole.
  const mine = strokesOf(game, seat);
  const theirs = strokesOf(game, other);
  const holeWinner: SeatId | 'draw' = mine === theirs ? 'draw' : mine < theirs ? seat : other;
  if (holeWinner === 'p1') game.holesP1 += 1;
  else if (holeWinner === 'p2') game.holesP2 += 1;

  game.holeNumber += 1;
  const winner = winnerOf(game);
  if (winner !== null) {
    game.winner = winner;
    game.phase = 'over';
    return { next: seat, holeOver: true, holeWinner, winner };
  }

  // The player who lost the hole tees off first on the next, which is the honour rule
  // upside down — it gives the trailing player the information advantage of going second.
  game.seat = holeWinner === 'draw' ? 'p1' : otherOf(holeWinner);
  game.strokesP1 = 0;
  game.strokesP2 = 0;
  game.doneP1 = false;
  game.doneP2 = false;
  game.phase = 'aiming';
  layOutHole(game, rng);
  teeUp(game);
  return { next: game.seat, holeOver: true, holeWinner, winner: null };
}

function markDone(game: Game, seat: SeatId): void {
  if (seat === 'p1') game.doneP1 = true;
  else game.doneP2 = true;
}

/**
 * The winner, or null while the match is live.
 *
 * Two holes clear, or the higher score at the hole cap. **A lead-based win has no bound of
 * its own** — two players trading holes could play for ever — so the cap is what makes the
 * match end at all, exactly as `roundSeconds` does not.
 */
export function winnerOf(game: Game): SeatId | 'draw' | null {
  const p1 = game.holesP1;
  const p2 = game.holesP2;
  if (p1 - p2 >= LEAD_TO_WIN) return 'p1';
  if (p2 - p1 >= LEAD_TO_WIN) return 'p2';
  if (game.holeNumber < MAX_HOLES) return null;
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Angular error, drawn once per putt. */
  readonly spread: number;
  /** How wrong its power can be, as a fraction. */
  readonly powerError: number;
  /** Whether it aims round a block rather than straight through it. */
  readonly avoidsBlocks: boolean;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { spread: 0.2, powerError: 0.35, avoidsBlocks: false },
  normal: { spread: 0.08, powerError: 0.16, avoidsBlocks: true },
  hard: { spread: 0.03, powerError: 0.07, avoidsBlocks: true },
});

/** Whether a straight line from the ball to a point passes through a block. */
export function lineIsClear(game: Game, toX: number, toY: number): boolean {
  const ball = game.ball;
  const steps = 24;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = ball.x + (toX - ball.x) * t;
    const y = ball.y + (toY - ball.y) * t;
    for (const block of game.blocks) {
      if (blockBlocks(block, x, y, BALL_RADIUS)) return false;
    }
  }
  return true;
}

export interface Aim {
  readonly angle: number;
  readonly power: number;
}

/**
 * How hard to hit it to arrive at a given distance, given the drag.
 *
 * Solved rather than guessed: with a per-second decay the ball travels
 * `v0 * (1 - keep) / -ln(keep)` before the stop threshold, near enough, so the inverse is
 * a closed form. A bot that guesses at power either always overshoots or never reaches.
 */
export function powerForDistance(distance: number): number {
  const perSecond = -Math.log(ROLL_DRAG);
  const speed = distance * perSecond;
  return Math.max(0.05, Math.min(1, speed / PUTT_MAX_SPEED));
}

/**
 * Where the bot putts.
 *
 * Straight at the hole when the line is clear; otherwise at a point beside the nearest
 * block, which is what a person does. Its error is drawn **once per putt** rather than per
 * step: a per-step error averages to zero and every tier plays the same.
 */
export function botAim(
  game: Game,
  difficulty: BotDifficulty,
  angleRoll: number,
  powerRoll: number,
): Aim {
  const profile = BOT_PROFILES[difficulty];
  const ball = game.ball;
  let targetX = game.hole.x;
  let targetY = game.hole.y;

  if (profile.avoidsBlocks && !lineIsClear(game, targetX, targetY)) {
    // Try a fan of aiming points and take the first clear one, widening the angle as it
    // goes. The **short** reaches matter as much as the wide angles: against a block that
    // spans most of the course every full-length line runs out of the walls, and the only
    // move left is the one a person makes — lay up beside it and putt again next stroke.
    const toHole = Math.atan2(game.hole.y - ball.y, game.hole.x - ball.x);
    const reach = Math.hypot(game.hole.x - ball.x, game.hole.y - ball.y);
    let found = false;
    for (const fraction of [1, 0.62, 0.38]) {
      for (let i = 1; i <= 8 && !found; i += 1) {
        for (const side of [1, -1]) {
          const angle = toHole + side * (i * 0.18);
          const x = ball.x + Math.cos(angle) * reach * fraction;
          const y = ball.y + Math.sin(angle) * reach * fraction;
          if (x < WALL || x > COURSE_WIDTH - WALL || y < WALL || y > COURSE_HEIGHT - WALL) continue;
          if (!lineIsClear(game, x, y)) continue;
          targetX = x;
          targetY = y;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  const angle =
    Math.atan2(targetY - ball.y, targetX - ball.x) + (angleRoll * 2 - 1) * profile.spread;
  const distance = Math.hypot(targetX - ball.x, targetY - ball.y);
  const wanted = powerForDistance(distance);
  const power = wanted * (1 + (powerRoll * 2 - 1) * profile.powerError);
  return { angle, power: power < 0.05 ? 0.05 : power > 1 ? 1 : power };
}

/** Unused by the game; tests seed rolls through it. */
export function rollFor(rng: Rng): number {
  return rng.float();
}
