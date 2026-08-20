import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Mini Soccer, as pure rules.
 *
 * A pitch, two goals, a ball, and one player each. Push the ball into the other goal.
 * Whoever has scored more when the whistle goes wins.
 *
 * The lesson Crabby Volley paid for applies here too and is why this plays at all: a
 * simulation that only ever *adds* energy never settles. The ball has drag, a kick
 * transfers a bounded share of the striker's motion, and both are what stop a rally
 * turning into a pinball table nobody can read.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const PITCH_WIDTH = 1000;
export const PITCH_HEIGHT = 640;
export const WALL = 26;

/** The goal mouth, centred on each end. */
export const GOAL_HEIGHT = 300;
export const GOAL_DEPTH = 34;

export const PLAYER_RADIUS = 44;
export const BALL_RADIUS = 22;

export const PLAYER_SPEED = 420;
/** How much of its speed the ball keeps each second. Below one, so a loose ball settles. */
export const BALL_DRAG = 0.42;
/** How hard a player kicks a ball they run into. */
export const KICK_SPEED = 620;
/** How much of the striker's own motion the ball takes on top. */
export const KICK_TRANSFER = 0.55;
export const MAX_BALL_SPEED = 900;
/** How bouncy the side walls are. */
export const WALL_BOUNCE = 0.7;

/** Seconds a match lasts, and how long a goal is held before the kick-off. */
export const MATCH_SECONDS = 90;
export const CELEBRATE_SECONDS = 1.6;

export interface Mover {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type Phase = 'kickoff' | 'playing' | 'celebrating' | 'over';

export interface Game {
  readonly p1: Mover;
  readonly p2: Mover;
  readonly ball: Mover;
  phase: Phase;
  /** Seconds left of the match. */
  clock: number;
  /** Seconds left of the goal celebration or the kick-off pause. */
  hold: number;
  /** Who scored last, for the renderer. */
  scorer: SeatId | null;
  readonly score: { p1: number; p2: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** The half a seat defends: p1 on the left. */
export function goalMouth(seat: SeatId): { x: number; top: number; bottom: number } {
  const top = (PITCH_HEIGHT - GOAL_HEIGHT) / 2;
  return {
    x: seat === 'p1' ? WALL : PITCH_WIDTH - WALL,
    top,
    bottom: top + GOAL_HEIGHT,
  };
}

export function createGame(rng: Rng): Game {
  const game: Game = {
    p1: { x: 0, y: 0, vx: 0, vy: 0 },
    p2: { x: 0, y: 0, vx: 0, vy: 0 },
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    phase: 'kickoff',
    clock: MATCH_SECONDS,
    hold: 1,
    scorer: null,
    score: { p1: 0, p2: 0 },
  };
  resetGame(game, rng);
  return game;
}

export function resetGame(game: Game, rng: Rng): void {
  game.score.p1 = 0;
  game.score.p2 = 0;
  game.clock = MATCH_SECONDS;
  game.scorer = null;
  kickOff(game, rng);
}

/** Everything back on its mark, with the ball nudged so an opening is not fixed. */
export function kickOff(game: Game, rng: Rng): void {
  game.p1.x = PITCH_WIDTH * 0.25;
  game.p1.y = PITCH_HEIGHT / 2;
  game.p2.x = PITCH_WIDTH * 0.75;
  game.p2.y = PITCH_HEIGHT / 2;
  for (const mover of [game.p1, game.p2]) {
    mover.vx = 0;
    mover.vy = 0;
  }
  game.ball.x = PITCH_WIDTH / 2;
  game.ball.y = PITCH_HEIGHT / 2;
  game.ball.vx = 0;
  game.ball.vy = (rng.float() - 0.5) * 60;
  game.phase = 'kickoff';
  game.hold = 1;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Drive a player. `dx`/`dy` are a direction, normalised so a diagonal is not faster.
 *
 * A player's velocity is recorded as well as their position, because a kick takes some of
 * it — running onto a ball has to be different from standing in front of one, or there is
 * no skill in the approach.
 */
export function drive(
  game: Game,
  seat: SeatId,
  dx: number,
  dy: number,
  fixedDeltaSeconds: number,
): void {
  const mover = seat === 'p1' ? game.p1 : game.p2;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    mover.vx = 0;
    mover.vy = 0;
    return;
  }
  mover.vx = (dx / length) * PLAYER_SPEED;
  mover.vy = (dy / length) * PLAYER_SPEED;
  mover.x = clamp(
    mover.x + mover.vx * fixedDeltaSeconds,
    WALL + PLAYER_RADIUS,
    PITCH_WIDTH - WALL - PLAYER_RADIUS,
  );
  mover.y = clamp(
    mover.y + mover.vy * fixedDeltaSeconds,
    WALL + PLAYER_RADIUS,
    PITCH_HEIGHT - WALL - PLAYER_RADIUS,
  );
}

function clampSpeed(ball: Mover): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_BALL_SPEED) return;
  ball.vx = (ball.vx / speed) * MAX_BALL_SPEED;
  ball.vy = (ball.vy / speed) * MAX_BALL_SPEED;
}

/**
 * A player running into the ball kicks it away from themselves.
 *
 * The direction is the line between the two centres, so where you meet the ball decides
 * where it goes — the same model Crabby Volley settled on, for the same reason: sending it
 * somewhere that does not depend on the approach makes positioning worthless.
 */
export function kick(ball: Mover, player: Readonly<Mover>): void {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const distance = Math.hypot(dx, dy);
  const nx = distance === 0 ? 1 : dx / distance;
  const ny = distance === 0 ? 0 : dy / distance;

  ball.vx = nx * KICK_SPEED + player.vx * KICK_TRANSFER;
  ball.vy = ny * KICK_SPEED + player.vy * KICK_TRANSFER;
  clampSpeed(ball);

  // Pushed clear, so a player standing on the ball does not kick it every step.
  const overlap = PLAYER_RADIUS + BALL_RADIUS - distance;
  if (overlap > 0) {
    ball.x += nx * (overlap + 1);
    ball.y += ny * (overlap + 1);
  }
}

export function touching(ball: Readonly<Mover>, player: Readonly<Mover>): boolean {
  const reach = PLAYER_RADIUS + BALL_RADIUS;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  return dx * dx + dy * dy <= reach * reach;
}

/** Whether the ball has crossed into a seat's goal — which is a goal *for the other*. */
export function inGoal(ball: Readonly<Mover>, seat: SeatId): boolean {
  const mouth = goalMouth(seat);
  if (ball.y < mouth.top || ball.y > mouth.bottom) return false;
  return seat === 'p1' ? ball.x - BALL_RADIUS <= mouth.x : ball.x + BALL_RADIUS >= mouth.x;
}

export type StepResult = 'playing' | 'goal' | 'over';

/**
 * Advance one fixed step.
 *
 * Drag first, then movement, then the walls, then the players, then the goals. The goals
 * are checked last so a ball saved on the very step it would have crossed is saved.
 */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  if (game.phase === 'over') return 'over';

  if (game.phase === 'celebrating' || game.phase === 'kickoff') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) {
      if (game.phase === 'celebrating') kickOff(game, rng);
      else game.phase = 'playing';
    }
    return 'playing';
  }

  game.clock -= fixedDeltaSeconds;
  if (game.clock <= 0) {
    game.clock = 0;
    game.phase = 'over';
    return 'over';
  }

  const ball = game.ball;
  // Drag as a per-second decay, so the step rate cannot change how far a ball rolls.
  const keep = Math.pow(BALL_DRAG, fixedDeltaSeconds);
  ball.vx *= keep;
  ball.vy *= keep;
  ball.x += ball.vx * fixedDeltaSeconds;
  ball.y += ball.vy * fixedDeltaSeconds;

  // Top and bottom walls. The ends are handled by the goal check and the side rails.
  if (ball.y < WALL + BALL_RADIUS) {
    ball.y = WALL + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * WALL_BOUNCE;
  } else if (ball.y > PITCH_HEIGHT - WALL - BALL_RADIUS) {
    ball.y = PITCH_HEIGHT - WALL - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE;
  }

  // The ends, except where the goal mouth is.
  const leftMouth = goalMouth('p1');
  const insideMouth = ball.y >= leftMouth.top && ball.y <= leftMouth.bottom;
  if (!insideMouth) {
    if (ball.x < WALL + BALL_RADIUS) {
      ball.x = WALL + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
    } else if (ball.x > PITCH_WIDTH - WALL - BALL_RADIUS) {
      ball.x = PITCH_WIDTH - WALL - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
    }
  }

  if (touching(ball, game.p1)) kick(ball, game.p1);
  else if (touching(ball, game.p2)) kick(ball, game.p2);

  for (const seat of ['p1', 'p2'] as SeatId[]) {
    if (!inGoal(ball, seat)) continue;
    const scorer = otherOf(seat);
    if (scorer === 'p1') game.score.p1 += 1;
    else game.score.p2 += 1;
    game.scorer = scorer;
    game.phase = 'celebrating';
    game.hold = CELEBRATE_SECONDS;
    return 'goal';
  }
  return 'playing';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  if (game.phase !== 'over') return null;
  if (game.score.p1 === game.score.p2) return 'draw';
  return game.score.p1 > game.score.p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between decisions. The lever that decides a chase. */
  readonly reaction: number;
  /** How far off its heading it commits, in radians. */
  readonly wobble: number;
  /** How far ahead of the ball it aims, in seconds. */
  readonly lead: number;
  /**
   * How far behind the ball it tries to stand before striking, in logical units.
   *
   * Running straight at the ball knocks it *away from* the goal as often as towards it,
   * because the kick leaves along the line between the two centres. A good player gets
   * behind it first. Zero means charging blindly, which is what a novice does.
   */
  readonly approach: number;
}

/**
 * The hard tier is deliberately **not** the most positionally perfect one available.
 *
 * With `approach: 58` and almost no wobble it became an emergent perfect defender: it
 * stands between the ball and its own goal whenever the ball is on its side, and two of
 * them produced **0.3 goals a match** across ten matches. A tier nobody can score against
 * is a wall rather than an opponent — the same objection raised against Cornhole's and Hot
 * Potato's first bots, and it applies to a defender as much as to a marksman.
 *
 * Backed off to 40 with a little more wobble: self-play gives 3.3 goals a match and it
 * still beats the easy tier ten times in twelve.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.42, wobble: 0.8, lead: 0, approach: 0 },
  normal: { reaction: 0.24, wobble: 0.35, lead: 0.18, approach: 30 },
  hard: { reaction: 0.13, wobble: 0.16, lead: 0.3, approach: 40 },
});

export interface BotState {
  headingX: number;
  headingY: number;
  sinceDecision: number;
}

export function createBotState(): BotState {
  return { headingX: 0, headingY: 0, sinceDecision: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.headingX = 0;
  bot.headingY = 0;
  bot.sinceDecision = 0;
}

/**
 * Where the bot runs.
 *
 * It aims for a spot **behind** the ball relative to the goal it is attacking, so its kick
 * sends the ball forward rather than wherever it happened to arrive from. It sees only the
 * ball and its own position, and it commits to a heading between decisions.
 */
export function botHeading(
  out: { x: number; y: number },
  game: Readonly<Game>,
  bot: BotState,
  seat: SeatId,
  profile: BotProfile,
  fixedDeltaSeconds: number,
  roll: number,
): { x: number; y: number } {
  bot.sinceDecision -= fixedDeltaSeconds;
  if (bot.sinceDecision <= 0) {
    bot.sinceDecision = profile.reaction;
    const me = seat === 'p1' ? game.p1 : game.p2;
    const ball = game.ball;
    const target = goalMouth(otherOf(seat));

    // Where the ball will be, and where to stand to send it at the goal from there.
    const aheadX = ball.x + ball.vx * profile.lead;
    const aheadY = ball.y + ball.vy * profile.lead;
    const toGoalX = target.x - aheadX;
    const toGoalY = (target.top + target.bottom) / 2 - aheadY;
    const length = Math.hypot(toGoalX, toGoalY) || 1;
    const standX = aheadX - (toGoalX / length) * profile.approach;
    const standY = aheadY - (toGoalY / length) * profile.approach;

    const angle = Math.atan2(standY - me.y, standX - me.x) + (roll - 0.5) * 2 * profile.wobble;
    bot.headingX = Math.cos(angle);
    bot.headingY = Math.sin(angle);
  }
  out.x = bot.headingX;
  out.y = bot.headingY;
  return out;
}
