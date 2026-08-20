import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';

/**
 * Crabby Volley, as pure rules.
 *
 * Two crabs, a net between them, and a ball. Move along your own half and jump; the ball
 * bounces off whatever it touches. Let it land on your side and the other player scores.
 * First to five.
 *
 * The whole simulation is a ball, two circles and three walls, on the fixed timestep. It
 * is the first game here with **continuous physics both players share at once**, so the
 * things that matter are that it is deterministic, that it cannot wedge, and that neither
 * player can reach the other's half.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const COURT_WIDTH = 1000;
export const COURT_HEIGHT = 620;
/** The floor. Below this is out of play. */
export const FLOOR_Y = 560;

export const NET_X = COURT_WIDTH / 2;
export const NET_TOP = 340;
export const NET_HALF_WIDTH = 8;

export const CRAB_RADIUS = 44;
export const BALL_RADIUS = 26;

export const CRAB_SPEED = 400;
export const JUMP_SPEED = 760;
export const GRAVITY = 1750;
/** The ball falls more slowly than a crab, so a rally is readable. */
export const BALL_GRAVITY = 900;

/** How fast the ball may ever travel, so a rally cannot accelerate out of control. */
export const MAX_BALL_SPEED = 1150;

/** How much of a crab's own motion the ball takes on when struck. */
export const CRAB_TRANSFER = 0.5;

/**
 * How much of its speed the ball keeps through a strike.
 *
 * Below one, so a rally decays and is therefore finite. A serve at about 500 is down to a
 * hundred after fifteen touches, and a ball that slow cannot clear the net — so the point
 * ends. This number, not the crabs, is what bounds a rally.
 */
export const STRIKE_DECAY = 0.88;

/**
 * Below this speed the ball is dead and cannot be returned.
 *
 * Without it a rally does not end even with decay, because a ball with no energy left
 * **rests on a crab and is struck again every single step** — a few units up, a few units
 * down, for ever. The crab holds it off the floor and the point never finishes. Measured,
 * two equal bots produced rallies of a hundred and fifty seconds.
 *
 * A serve at about 500 falls under this after nine touches, which bounds a rally at
 * roughly nine returns — long enough to be a rally, short enough to be a game.
 */
export const MIN_RALLY_SPEED = 150;

/** Whether a strike would put enough into the ball to keep the rally alive. */
export function canReturn(ball: Readonly<Ball>): boolean {
  return Math.hypot(ball.vx, ball.vy) * STRIKE_DECAY >= MIN_RALLY_SPEED;
}
/** How bouncy a wall is. Slightly lossy, so a rally settles rather than ringing. */
export const WALL_BOUNCE = 0.94;

export const TARGET_POINTS = 5;

/** How long the ball hangs before a serve, so both players can look up. */
export const SERVE_SECONDS = 1.1;

export interface Crab {
  x: number;
  y: number;
  /** Vertical speed. Zero while standing. */
  vy: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type Phase = 'serving' | 'rally' | 'point';

export interface Game {
  readonly p1: Crab;
  readonly p2: Crab;
  readonly ball: Ball;
  phase: Phase;
  /** Seconds left of the serve hang or the point pause. */
  timer: number;
  /** Who serves next, which is whoever just lost the point. */
  server: SeatId;
  /** Who took the last point, for the renderer. */
  scorer: SeatId | null;
  score: { p1: number; p2: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** The half a seat plays in: p1 on the left. */
export function halfOf(seat: SeatId): { min: number; max: number } {
  return seat === 'p1'
    ? { min: CRAB_RADIUS, max: NET_X - NET_HALF_WIDTH - CRAB_RADIUS }
    : { min: NET_X + NET_HALF_WIDTH + CRAB_RADIUS, max: COURT_WIDTH - CRAB_RADIUS };
}

function homeX(seat: SeatId): number {
  const half = halfOf(seat);
  return (half.min + half.max) / 2;
}

export function createGame(rng: Rng = new Rng(1)): Game {
  const game: Game = {
    p1: { x: 0, y: FLOOR_Y, vy: 0 },
    p2: { x: 0, y: FLOOR_Y, vy: 0 },
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    phase: 'serving',
    timer: SERVE_SECONDS,
    server: 'p1',
    scorer: null,
    score: { p1: 0, p2: 0 },
  };
  resetGame(game, rng);
  return game;
}

export function resetGame(game: Game, rng: Rng): void {
  game.score.p1 = 0;
  game.score.p2 = 0;
  game.server = 'p1';
  game.scorer = null;
  serve(game, rng);
}

/**
 * Put everything back on its mark and hang the ball over the server.
 *
 * The serve then goes **over the net**, as a serve does. Dropping it straight down on the
 * server's own head was the first version and it was quietly fatal: the server had to keep
 * their own serve up, could only knock it straight back up again, and eventually lost the
 * point — then served again. Whoever served first lost 0-5 every time, at every tier.
 */
export function serve(game: Game, rng: Rng): void {
  game.p1.x = homeX('p1');
  game.p1.y = FLOOR_Y;
  game.p1.vy = 0;
  game.p2.x = homeX('p2');
  game.p2.y = FLOOR_Y;
  game.p2.vy = 0;
  game.ball.x = homeX(game.server);
  game.ball.y = 150;
  // Held still through the hang, then released along this. Stored now so the release is
  // not a second decision made somewhere else.
  const towards = game.server === 'p1' ? 1 : -1;
  game.ball.vx = towards * (SERVE_SPEED + serveNudge(rng));
  game.ball.vy = SERVE_DROP;
  game.phase = 'serving';
  game.timer = SERVE_SECONDS;
}

/** How hard a serve goes across, and how much drop it starts with. */
export const SERVE_SPEED = 520;
/**
 * A serve starts with no drop at all.
 *
 * With 60 it could not clear the net: it had to cross 220 units before falling the 100 or
 * so that would bring it into the net's top, and it managed 163. The serve struck the net
 * and came back at the server, who then lost the point they had just served.
 */
export const SERVE_DROP = 0;

/** Move a crab along its own half. `direction` is -1, 0 or 1. */
export function steer(game: Game, seat: SeatId, direction: number, fixedDeltaSeconds: number): void {
  const crab = seat === 'p1' ? game.p1 : game.p2;
  const half = halfOf(seat);
  const step = (direction > 0 ? 1 : direction < 0 ? -1 : 0) * CRAB_SPEED * fixedDeltaSeconds;
  const next = crab.x + step;
  // A crab may never cross the net, whatever it is holding down. Neither player can reach
  // into the other's half, which is what makes the halves mean anything.
  crab.x = next < half.min ? half.min : next > half.max ? half.max : next;
}

/** Jump, if standing. Returns false when already in the air. */
export function jump(game: Game, seat: SeatId): boolean {
  const crab = seat === 'p1' ? game.p1 : game.p2;
  if (crab.y < FLOOR_Y) return false;
  crab.vy = -JUMP_SPEED;
  return true;
}

function clampSpeed(ball: Ball): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_BALL_SPEED) return;
  const scale = MAX_BALL_SPEED / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

/**
 * Bounce the ball off a crab.
 *
 * The ball leaves along the line between the two centres, at a speed that keeps most of
 * what it had and takes a little of the crab's own motion. Taking *some* of the crab's
 * movement is what lets a player aim: standing still returns the ball straight back, and
 * moving into it sends it on.
 */
export function strike(ball: Ball, crab: Crab, crabVx: number): void {
  const distance = Math.hypot(ball.x - crab.x, ball.y - crab.y);

  /**
   * Where on the crab it struck decides where it goes — the paddle model.
   *
   * The obvious model, sending the ball out along the line between the two centres, made
   * the game **chaotic rather than skilful**: a crab standing slightly off returned the
   * ball at a wildly different angle, so standing in the right place paid nothing. Swept
   * against a fixed opponent, every bot lever came back as noise between 33% and 67% with
   * no trend at all, and the baseline scored 58% against *itself*.
   *
   * Offset from the middle maps to a bounded horizontal angle instead. Hit it with your
   * middle and it goes straight up; hit it with your edge and it goes sideways. That is
   * predictable, so a player who positions well is rewarded for it — which is the whole
   * point of a game about positioning.
   */
  const offset = clamp((ball.x - crab.x) / (CRAB_RADIUS + BALL_RADIUS), -1, 1);
  const speed = Math.max(MIN_RALLY_SPEED, Math.hypot(ball.vx, ball.vy) * STRIKE_DECAY);

  // A moving crab tilts the return a little further, so a player can chase and place.
  const aim = clamp(offset + (crabVx / CRAB_SPEED) * CRAB_TRANSFER, -1, 1) * MAX_RETURN_ANGLE;
  ball.vx = Math.sin(aim) * speed;
  ball.vy = -Math.abs(Math.cos(aim)) * speed;

  // Pushed clear, so it cannot strike twice from inside the crab.
  const overlap = CRAB_RADIUS + BALL_RADIUS - distance;
  if (overlap > 0) {
    const nx = distance === 0 ? 0 : (ball.x - crab.x) / distance;
    const ny = distance === 0 ? -1 : (ball.y - crab.y) / distance;
    ball.x += nx * (overlap + 1);
    ball.y += ny * (overlap + 1);
  }
  clampSpeed(ball);
}

/** The widest a return may be turned from straight up. */
export const MAX_RETURN_ANGLE = 1.15;

export function touching(ball: Readonly<Ball>, crab: Readonly<Crab>): boolean {
  const dx = ball.x - crab.x;
  const dy = ball.y - crab.y;
  const reach = CRAB_RADIUS + BALL_RADIUS;
  return dx * dx + dy * dy <= reach * reach;
}

export type StepResult = 'playing' | 'point';

/**
 * Advance one fixed step.
 *
 * Order matters and is fixed: crabs fall, the ball flies, walls, net, crabs, floor. The
 * floor is checked last so a ball saved on the very step it would have landed is saved.
 */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  if (game.phase === 'point') {
    game.timer -= fixedDeltaSeconds;
    if (game.timer <= 0) serve(game, rng);
    return 'playing';
  }

  fall(game.p1, fixedDeltaSeconds);
  fall(game.p2, fixedDeltaSeconds);

  if (game.phase === 'serving') {
    game.timer -= fixedDeltaSeconds;
    if (game.timer <= 0) game.phase = 'rally';
    return 'playing';
  }

  const ball = game.ball;
  ball.vy += BALL_GRAVITY * fixedDeltaSeconds;
  ball.x += ball.vx * fixedDeltaSeconds;
  ball.y += ball.vy * fixedDeltaSeconds;

  // Side walls and the ceiling.
  if (ball.x < BALL_RADIUS) {
    ball.x = BALL_RADIUS;
    ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
  } else if (ball.x > COURT_WIDTH - BALL_RADIUS) {
    ball.x = COURT_WIDTH - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
  }
  if (ball.y < BALL_RADIUS) {
    ball.y = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * WALL_BOUNCE;
  }

  bounceOffNet(ball);

  // A dead ball is not returned: it drops through to the floor and the point ends, which
  // is the honest outcome for a player who could not keep it up.
  if (canReturn(ball)) {
    if (touching(ball, game.p1)) strike(ball, game.p1, 0);
    else if (touching(ball, game.p2)) strike(ball, game.p2, 0);
  }

  if (ball.y >= FLOOR_Y - BALL_RADIUS) {
    // Whoever's half it landed in loses the point.
    const loser: SeatId = ball.x < NET_X ? 'p1' : 'p2';
    award(game, otherOf(loser));
    return 'point';
  }
  return 'playing';
}

function fall(crab: Crab, fixedDeltaSeconds: number): void {
  if (crab.y >= FLOOR_Y && crab.vy >= 0) {
    crab.y = FLOOR_Y;
    crab.vy = 0;
    return;
  }
  crab.vy += GRAVITY * fixedDeltaSeconds;
  crab.y += crab.vy * fixedDeltaSeconds;
  if (crab.y > FLOOR_Y) {
    crab.y = FLOOR_Y;
    crab.vy = 0;
  }
}

/**
 * The net.
 *
 * A post rather than a line: the ball bounces off its side below the top, and off its top
 * edge from above. Without the top case a ball landing exactly on the net falls through
 * it, which looks like a bug however rare it is.
 */
function bounceOffNet(ball: Ball): void {
  const left = NET_X - NET_HALF_WIDTH - BALL_RADIUS;
  const right = NET_X + NET_HALF_WIDTH + BALL_RADIUS;
  if (ball.x <= left || ball.x >= right) return;
  if (ball.y < NET_TOP - BALL_RADIUS) return;

  if (ball.y < NET_TOP) {
    // Coming down onto the top of the net.
    ball.y = NET_TOP - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE;
    return;
  }
  if (ball.x < NET_X) {
    ball.x = left;
    ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
  } else {
    ball.x = right;
    ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
  }
}

function award(game: Game, seat: SeatId): void {
  if (seat === 'p1') game.score.p1 += 1;
  else game.score.p2 += 1;
  game.scorer = seat;
  // Whoever lost the point serves, which keeps a one-sided match from running away.
  game.server = otherOf(seat);
  game.phase = 'point';
  game.timer = SERVE_SECONDS;
}

export function winnerOf(game: Readonly<Game>): SeatId | null {
  if (game.score.p1 >= TARGET_POINTS) return 'p1';
  if (game.score.p2 >= TARGET_POINTS) return 'p2';
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far ahead it is able to predict the ball, in seconds. */
  readonly lookahead: number;
  /** How far off its chosen spot it settles, in logical units. */
  readonly slop: number;
  /** Chance per second of jumping when the ball is high and near. */
  readonly jumpRate: number;
  /**
   * How long it takes to notice the ball has changed course, in seconds.
   *
   * The lever that actually decides matches here. Look-ahead, slop and jump rate all came
   * back as **noise** when swept against a fixed opponent — no trend, 40% to 57%, with the
   * baseline scoring 43% against itself. A rally is fast enough that reacting late is what
   * loses points, and it is also the most human way to be worse at a game.
   *
   * No tier is quicker than a person: simple visual reaction is about 0.25s, and even the
   * hard tier is only quick within that, not past it.
   */
  readonly reaction: number;
}

/**
 * Measured rather than guessed, and two of the three levers pointed the wrong way first.
 *
 * `jumpRate` **falls** as the tier rises, which is not a mistake: a crab in the air returns
 * the ball more steeply and keeps a rally alive, so jumping at everything is a novice's
 * habit and it costs points. Sweeping it against a fixed opponent, 0.5–1.4 won 65% of
 * duels while 2.6 and 4.0 won 50% and 45%. The strong bot jumps when it needs to.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { lookahead: 0.4, slop: 110, jumpRate: 2.2, reaction: 0.42 },
  normal: { lookahead: 0.8, slop: 55, jumpRate: 1.2, reaction: 0.24 },
  hard: { lookahead: 1.4, slop: 18, jumpRate: 0.8, reaction: 0.1 },
});

/**
 * Where the ball will be **when it comes down to where a crab could hit it**.
 *
 * `maxSeconds` is how far ahead the bot is *able* to look, not how far ahead it looks: the
 * simulation stops early at crab height. A bot with a short horizon sees only part of the
 * flight and stands in the wrong place; one with a long horizon finds the true landing.
 *
 * Run with the same arithmetic the simulation uses — gravity, the side walls, the net —
 * rather than extrapolated in a straight line. That distinction is the whole difficulty
 * curve: a straight line is *worse* the further ahead it looks, because the ball bounces,
 * so the tier that looked furthest ahead was the tier that aimed most wrongly. Measured,
 * the hard bot lost 1-5 to the easy one.
 *
 * This is not information a person lacks. Everybody watching a ball fall predicts where it
 * will land; the tiers differ in how far ahead they manage it and how precisely they then
 * stand, which is exactly how people differ.
 */
export function predictX(ball: Readonly<Ball>, maxSeconds: number): number {
  const stepSeconds = 1 / 60;
  let x = ball.x;
  let y = ball.y;
  let vx = ball.vx;
  let vy = ball.vy;
  const steps = Math.min(180, Math.round(maxSeconds / stepSeconds));
  for (let i = 0; i < steps; i += 1) {
    vy += BALL_GRAVITY * stepSeconds;
    x += vx * stepSeconds;
    y += vy * stepSeconds;
    if (x < BALL_RADIUS) {
      x = BALL_RADIUS;
      vx = Math.abs(vx) * WALL_BOUNCE;
    } else if (x > COURT_WIDTH - BALL_RADIUS) {
      x = COURT_WIDTH - BALL_RADIUS;
      vx = -Math.abs(vx) * WALL_BOUNCE;
    }
    if (y < BALL_RADIUS) {
      y = BALL_RADIUS;
      vy = Math.abs(vy) * WALL_BOUNCE;
    }
    // The net, treated as the simulation treats it.
    const left = NET_X - NET_HALF_WIDTH - BALL_RADIUS;
    const right = NET_X + NET_HALF_WIDTH + BALL_RADIUS;
    if (x > left && x < right && y >= NET_TOP - BALL_RADIUS) {
      if (y < NET_TOP) {
        y = NET_TOP - BALL_RADIUS;
        vy = -Math.abs(vy) * WALL_BOUNCE;
      } else if (x < NET_X) {
        x = left;
        vx = -Math.abs(vx) * WALL_BOUNCE;
      } else {
        x = right;
        vx = Math.abs(vx) * WALL_BOUNCE;
      }
    }
    // Stop where a crab could reach it. That is the spot to stand on, and predicting past
    // it is worse than useless: a fixed time horizon has the bot standing where the ball
    // will be *after* it has already gone by. Measured, the tier that looked furthest
    // ahead lost 65% of its duels to the tier that barely looked at all.
    if (y >= FLOOR_Y - CRAB_RADIUS - BALL_RADIUS) break;
  }
  return x;
}

/**
 * What a bot remembers between steps.
 *
 * Only the misjudgement it has committed to. Re-rolling the slop every step was the first
 * version and it made the tiers meaningless: a fresh random offset sixty times a second
 * **averages to zero**, so the crab hovered around exactly the right spot however large
 * its supposed error. Measured, the hard tier beat the easy one six times in twelve, which
 * is a coin flip.
 *
 * A person misjudges where a ball will land and then commits to that misjudgement until
 * the ball changes direction. So does this.
 */
export interface BotState {
  /** The offset it is currently standing wrong by. */
  offset: number;
  /** Which way the ball was last going, so a new approach re-rolls the misjudgement. */
  lastDirection: number;
  /** Where it is currently heading, held between decisions. */
  target: number;
  /** Seconds until it looks again. */
  sinceDecision: number;
}

export function createBotState(): BotState {
  return { offset: 0, lastDirection: 0, target: 0, sinceDecision: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.offset = 0;
  bot.lastDirection = 0;
  bot.target = 0;
  bot.sinceDecision = 0;
}

/**
 * Where the bot wants to stand, and whether it jumps.
 *
 * It predicts the ball by running the same arithmetic the simulation does, which is the
 * only information a person does not literally have — but a person predicts a falling ball
 * too, and the tiers differ in *how far ahead* rather than in what they can see. It has no
 * knowledge of the other crab at all.
 */
export function botIntent(
  out: { direction: number; jump: boolean },
  game: Readonly<Game>,
  bot: BotState,
  seat: SeatId,
  profile: BotProfile,
  fixedDeltaSeconds: number,
  roll: number,
): { direction: number; jump: boolean } {
  const crab = seat === 'p1' ? game.p1 : game.p2;
  const half = halfOf(seat);
  const ball = game.ball;

  // A fresh approach is a fresh judgement, right or wrong.
  const direction = ball.vx > 0 ? 1 : ball.vx < 0 ? -1 : 0;
  if (direction !== bot.lastDirection) {
    bot.lastDirection = direction;
    bot.offset = (roll - 0.5) * 2 * profile.slop;
  }

  // It only looks again every `reaction` seconds; in between it keeps going where it was.
  bot.sinceDecision -= fixedDeltaSeconds;
  if (bot.sinceDecision <= 0 || bot.target === 0) {
    bot.sinceDecision = profile.reaction;
    const predictedX = predictX(ball, profile.lookahead);
    bot.target = clamp(predictedX + bot.offset, half.min, half.max);
  }

  const gap = bot.target - crab.x;
  out.direction = Math.abs(gap) < 12 ? 0 : gap > 0 ? 1 : -1;

  const nearBall = Math.abs(ball.x - crab.x) < CRAB_RADIUS * 2.4;
  const ballHigh = ball.y < FLOOR_Y - CRAB_RADIUS;
  out.jump =
    nearBall && ballHigh && crab.y >= FLOOR_Y && roll < profile.jumpRate * fixedDeltaSeconds;
  return out;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** A little variety on each serve, so an opening is not a fixed opening. */
export function serveNudge(rng: Rng): number {
  return (rng.float() - 0.5) * 90;
}
