import { SEAT_PALETTE } from '@duelbox/engine';
import type { Aabb, Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  WinCondition,
} from '@duelbox/game-sdk';
import type { Ball, BotDifficulty, Paddle, Wall } from './rules.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  BRICK_COUNT,
  BRICK_HEIGHT,
  BRICK_INNER_HP,
  COURT,
  PADDLE_HALF_HEIGHT,
  PADDLE_HALF_WIDTH,
  PADDLE_SPEED,
  REGROW_STEPS,
  SERVE_SPREAD,
  ballOut,
  botTargetX,
  brickBounds,
  brickHp,
  brickRegrow,
  collideBallBricks,
  collideBallPaddle,
  createBall,
  createPaddle,
  createWall,
  launchServe,
  movePaddle,
  paddleY,
  placeServe,
  resetWall,
  stepBall,
  stepWall,
} from './rules.js';

/** Points that win a match. */
export const POINT_TARGET = 5;

/**
 * The longest a match can run, in seconds. Most points at the whistle, drawn if level.
 *
 * First to five is the rule and this is the backstop, not a redesign. Two players trading
 * misses reach five inside a minute and never see it; two very good ones might not, and
 * `roundSeconds` ends nothing — it is validated by the manifest schema and read only by the
 * catalogue card that prints "about 40s". Every game has to guarantee its own termination,
 * and between this clock and the vertical floor in the rules, this one does.
 */
export const MATCH_SECONDS = 100;

/** Length of the pause before a serve, counted in simulation steps rather than seconds. */
export const SERVE_STEPS = 48;

const COLOUR_COURT = '#0d1220';
const COLOUR_RAIL = 'rgba(233, 240, 252, 0.14)';
const COLOUR_LINE = 'rgba(233, 240, 252, 0.5)';
const COLOUR_LINE_SOFT = 'rgba(233, 240, 252, 0.2)';
const COLOUR_BRICK = '#8fa2c4';
const COLOUR_BRICK_HARD = '#f2c14e';
const COLOUR_RUBBLE = 'rgba(143, 162, 196, 0.18)';
const COLOUR_BALL = '#eef4ff';
const COLOUR_INK = '#0b1220';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

/** Passed to resolve() at the whistle. Module scope, so a step allocates nothing. */
const TIME_EXPIRED = { timeExpired: true } as const;

const RAIL = 12;
const BASELINE_BAR = 10;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

/** Where a ball was at the end of the previous step, for render interpolation only. */
interface Ghost {
  x: number;
  y: number;
}

export class BrickBlastGame implements Game {
  readonly #balls: readonly [Ball, Ball] = [createBall(), createBall()];
  readonly #ghosts: readonly [Ghost, Ghost] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  readonly #paddleP1: Paddle = createPaddle();
  readonly #paddleP2: Paddle = createPaddle();
  readonly #wall: Wall = createWall();
  readonly #condition: WinCondition = { kind: 'first-to', target: POINT_TARGET };
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };
  readonly #box: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  #context: GameContext | null = null;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #serveCountdown = SERVE_STEPS;
  #clock = MATCH_SECONDS;
  #prevP1X = COURT.width / 2;
  #prevP2X = COURT.width / 2;

  /** Seconds left before the whistle. Exposed so tests reach it without playing it out. */
  get clock(): number {
    return this.#clock;
  }

  set clock(seconds: number) {
    this.#clock = seconds;
  }

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  get balls(): readonly Ball[] {
    return this.#balls;
  }

  get wall(): Wall {
    return this.#wall;
  }

  /** Steps left before the balls are launched, or 0 while play is live. */
  get serveCountdown(): number {
    return this.#serveCountdown;
  }

  paddle(seat: SeatId): Readonly<Paddle> {
    return seat === 'p1' ? this.#paddleP1 : this.#paddleP2;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#clock = MATCH_SECONDS;
    this.#paddleP1.x = COURT.width / 2;
    this.#paddleP2.x = COURT.width / 2;
    this.#prevP1X = this.#paddleP1.x;
    this.#prevP2X = this.#paddleP2.x;
    this.#serve();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#score.winner !== null) return;

    this.#clock = Math.max(0, this.#clock - fixedDeltaSeconds);

    this.#prevP1X = this.#paddleP1.x;
    this.#prevP2X = this.#paddleP2.x;
    this.#ghosts[0].x = this.#balls[0].x;
    this.#ghosts[0].y = this.#balls[0].y;
    this.#ghosts[1].x = this.#balls[1].x;
    this.#ghosts[1].y = this.#balls[1].y;

    const rng = context.rng;
    this.#drivePaddle('p1', this.#paddleP1, this.#botP1, input, fixedDeltaSeconds, rng);
    this.#drivePaddle('p2', this.#paddleP2, this.#botP2, input, fixedDeltaSeconds, rng);
    stepWall(this.#wall);

    let scored = false;
    if (this.#serveCountdown > 0) {
      this.#serveCountdown -= 1;
      if (this.#serveCountdown === 0) {
        launchServe(this.#balls, (rng.float() * 2 - 1) * SERVE_SPREAD);
      }
    } else {
      const first = this.#advance(this.#balls[0], fixedDeltaSeconds);
      const second = this.#advance(this.#balls[1], fixedDeltaSeconds);
      if (first !== 'none') {
        this.#award(first);
        scored = true;
      }
      if (second !== 'none') {
        this.#award(second);
        scored = true;
      }
      // Both balls are re-served together: a point ends the rally, not one ball of it.
      if (scored) this.#serve();
    }

    // Only the two events that can end a match ask the helper, so the common step neither
    // recomputes an answer that cannot have changed nor allocates an options record.
    const expired = this.#clock === 0;
    if (scored || expired) {
      this.#score.winner = expired
        ? resolve(this.#condition, this.#score, TIME_EXPIRED)
        : resolve(this.#condition, this.#score);
    }
  }

  render(renderer: Renderer, alpha: number): void {
    const width = COURT.width;
    const height = COURT.height;

    renderer.clear(COLOUR_COURT);
    renderer.rect(0, 0, RAIL, height, COLOUR_RAIL);
    renderer.rect(width - RAIL, 0, RAIL, height, COLOUR_RAIL);
    renderer.line(0, height / 2, width, height / 2, 2, COLOUR_LINE_SOFT);

    this.#drawClock(renderer);
    this.#drawWall(renderer);
    this.#drawServe(renderer);

    // p2 defends the top: its baseline and its paddle both carry two pips, p1's carry one,
    // so the two seats stay apart with the colour taken away.
    renderer.rect(RAIL, 0, width - RAIL * 2, BASELINE_BAR, COLOUR_P2);
    renderer.rect(RAIL, BASELINE_BAR + 6, width - RAIL * 2, BASELINE_BAR / 2, COLOUR_P2);
    renderer.rect(RAIL, height - BASELINE_BAR, width - RAIL * 2, BASELINE_BAR, COLOUR_P1);

    this.#drawPaddle(renderer, this.#prevP2X + (this.#paddleP2.x - this.#prevP2X) * alpha, 'p2', 2);
    this.#drawPaddle(renderer, this.#prevP1X + (this.#paddleP1.x - this.#prevP1X) * alpha, 'p1', 1);

    this.#drawBall(renderer, this.#balls[0], this.#ghosts[0], alpha, false);
    this.#drawBall(renderer, this.#balls[1], this.#ghosts[1], alpha, true);
  }

  onPause(): void {
    // Nothing carries momentum across a pause: a paddle is a position, not a body, and the
    // balls are held by the simulation rather than by whatever the pointer was doing.
    this.#settle();
  }

  onResume(): void {
    // The ghosts are where the renderer interpolates from, so a pause that moved a paddle
    // must not be drawn as a smear across the court on the first frame back.
    this.#settle();
  }

  getScore(): MatchScore {
    return this.#score;
  }

  destroy(): void {
    this.#context = null;
    this.#botP1 = null;
    this.#botP2 = null;
  }

  /** One ball's step: travel, wall, both paddles, then the baselines. */
  #advance(ball: Ball, dt: number): 'none' | SeatId {
    stepBall(ball, dt);
    collideBallBricks(ball, this.#wall);
    collideBallPaddle(ball, this.#paddleP1.x, 'p1');
    collideBallPaddle(ball, this.#paddleP2.x, 'p2');
    return ballOut(ball);
  }

  #award(seat: SeatId): void {
    if (seat === 'p1') this.#score.p1 += 1;
    else this.#score.p2 += 1;
  }

  #serve(): void {
    placeServe(this.#balls);
    resetWall(this.#wall);
    this.#serveCountdown = SERVE_STEPS;
    this.#settle();
  }

  #settle(): void {
    this.#ghosts[0].x = this.#balls[0].x;
    this.#ghosts[0].y = this.#balls[0].y;
    this.#ghosts[1].x = this.#balls[1].x;
    this.#ghosts[1].y = this.#balls[1].y;
    this.#prevP1X = this.#paddleP1.x;
    this.#prevP2X = this.#paddleP2.x;
  }

  #drivePaddle(
    seat: SeatId,
    paddle: Paddle,
    difficulty: BotDifficulty | null,
    input: InputState,
    dt: number,
    rng: Rng,
  ): void {
    let targetX: number;
    let speed: number;
    if (difficulty !== null) {
      targetX = botTargetX(this.#balls, seat, difficulty, rng);
      speed = BOT_PROFILES[difficulty].topSpeed;
    } else {
      const seatInput = input.seat(seat);
      const pointer = seatInput.pointer;
      // A finger names the place; a key names a direction. Both feed the same target and
      // the same ceiling, and there is no mode to switch between them.
      targetX = pointer !== null ? pointer.x : paddle.x + seatInput.move.x * PADDLE_SPEED * dt;
      speed = PADDLE_SPEED;
    }
    movePaddle(paddle, targetX, speed, dt);
  }

  /**
   * The backstop clock, as a pair of bars filling from the halfway line outwards.
   *
   * Two of them, one on each rail, because one bar down one edge is nearer to one player
   * than the other — and a rule one seat reads more easily than the other is not the same
   * rule for both. Filling from the centre keeps the picture its own half-turn image.
   */
  #drawClock(renderer: Renderer): void {
    const height = COURT.height;
    const left = Math.max(0, Math.min(1, this.#clock / MATCH_SECONDS));
    const span = (height - 40) * left;
    const top = height / 2 - span / 2;
    renderer.rect(RAIL + 2, 20, 4, height - 40, COLOUR_LINE_SOFT);
    renderer.rect(COURT.width - RAIL - 6, 20, 4, height - 40, COLOUR_LINE_SOFT);
    renderer.rect(RAIL + 2, top, 4, span, COLOUR_LINE);
    renderer.rect(COURT.width - RAIL - 6, top, 4, span, COLOUR_LINE);
  }

  #drawWall(renderer: Renderer): void {
    const box = this.#box;
    for (let i = 0; i < BRICK_COUNT; i += 1) {
      brickBounds(i, box);
      const width = box.maxX - box.minX;
      const hp = brickHp(this.#wall, i);
      if (hp <= 0) {
        // Rubble is drawn as the outline of the brick that will come back, with a bar
        // counting it in: a hole that is about to close is a thing worth aiming at.
        const left = brickRegrow(this.#wall, i) / REGROW_STEPS;
        renderer.strokeRect(box.minX, box.minY, width, BRICK_HEIGHT, 2, COLOUR_RUBBLE);
        renderer.rect(box.minX, box.maxY - 3, width * (1 - left), 3, COLOUR_RUBBLE);
        continue;
      }
      const hard = hp >= BRICK_INNER_HP;
      renderer.rect(
        box.minX,
        box.minY,
        width,
        BRICK_HEIGHT,
        hard ? COLOUR_BRICK_HARD : COLOUR_BRICK,
      );
      renderer.strokeRect(box.minX, box.minY, width, BRICK_HEIGHT, 2, COLOUR_INK);
      // A doubled brick carries a second outline as well as a warmer fill, so the wall
      // still reads in greyscale.
      if (hard) {
        renderer.strokeRect(
          box.minX + 6,
          box.minY + 6,
          width - 12,
          BRICK_HEIGHT - 12,
          2,
          COLOUR_INK,
        );
      }
    }
  }

  #drawServe(renderer: Renderer): void {
    if (this.#serveCountdown <= 0) return;
    const remaining = this.#serveCountdown / SERVE_STEPS;
    for (const ball of this.#balls) {
      renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS + 40 * remaining, 3, COLOUR_LINE_SOFT);
    }
  }

  #drawPaddle(renderer: Renderer, x: number, seat: SeatId, pips: number): void {
    const y = paddleY(seat);
    const colour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    renderer.rect(
      x - PADDLE_HALF_WIDTH,
      y - PADDLE_HALF_HEIGHT,
      PADDLE_HALF_WIDTH * 2,
      PADDLE_HALF_HEIGHT * 2,
      colour,
    );
    renderer.strokeRect(
      x - PADDLE_HALF_WIDTH,
      y - PADDLE_HALF_HEIGHT,
      PADDLE_HALF_WIDTH * 2,
      PADDLE_HALF_HEIGHT * 2,
      3,
      COLOUR_INK,
    );
    // The pips also mark the middle of the paddle, which is the part that sends a ball
    // straight back — the one thing a player needs to be able to see at a glance.
    for (let i = 0; i < pips; i += 1) {
      const offset = (i - (pips - 1) / 2) * 16;
      renderer.circle(x + offset, y, 4, COLOUR_INK);
    }
  }

  #drawBall(renderer: Renderer, ball: Ball, ghost: Ghost, alpha: number, ringed: boolean): void {
    const x = ghost.x + (ball.x - ghost.x) * alpha;
    const y = ghost.y + (ball.y - ghost.y) * alpha;
    renderer.circle(x, y, BALL_RADIUS, COLOUR_BALL);
    renderer.strokeCircle(x, y, BALL_RADIUS - 4, 3, COLOUR_INK);
    // The second ball wears a hollow centre, so two balls crossing are still two balls.
    if (ringed) renderer.circle(x, y, 3, COLOUR_INK);
  }
}
