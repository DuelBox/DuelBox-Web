import { SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { Rng, SeatId, Vec2 } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  WinCondition,
} from '@duelbox/game-sdk';
import type { Body, BotDifficulty } from './rules.js';
import {
  MALLET_RADIUS,
  PUCK_RADIUS,
  TABLE,
  botTarget,
  collidePuckMallet,
  stepMallet,
  stepPuck,
} from './rules.js';

/** Goals that win a match. */
export const GOAL_TARGET = 7;

/** Length of the post-goal pause, counted in simulation steps rather than seconds. */
export const SERVE_STEPS = 60;

/** Speed the puck leaves the centre spot with. */
const SERVE_SPEED = 330;

/**
 * Half-angle of the serve, in radians. Narrow enough that an unopposed serve always
 * reaches the goal mouth rather than the post beside it.
 */
const SERVE_SPREAD = 0.12;

/** Mallet speed for a seat steering with the movement axes instead of a pointer. */
const KEYBOARD_MALLET_SPEED = 900;

const COLOUR_TABLE = '#0e1726';
const COLOUR_LINE = 'rgba(233, 240, 252, 0.55)';
const COLOUR_LINE_SOFT = 'rgba(233, 240, 252, 0.22)';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_INK = '#0b1220';
const COLOUR_PUCK = '#e9f0fc';
const COLOUR_SERVE = 'rgba(233, 240, 252, 0.38)';

const BORDER = 10;
const GOAL_BAR = 16;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class AirHockeyGame implements Game {
  readonly #puck: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: PUCK_RADIUS };
  readonly #malletP1: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: MALLET_RADIUS };
  readonly #malletP2: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: MALLET_RADIUS };
  readonly #botAim: Vec2 = vec2();
  readonly #condition: WinCondition = { kind: 'first-to', target: GOAL_TARGET };
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #context: GameContext | null = null;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #serveCountdown = 0;
  #serveToward: SeatId = 'p1';

  #prevPuckX = 0;
  #prevPuckY = 0;
  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP2X = 0;
  #prevP2Y = 0;

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  get puck(): Readonly<Body> {
    return this.#puck;
  }

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  mallet(seat: SeatId): Readonly<Body> {
    return seat === 'p1' ? this.#malletP1 : this.#malletP2;
  }

  /** Steps left before the puck is served, or 0 while play is live. */
  get serveCountdown(): number {
    return this.#serveCountdown;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#serveToward = context.rng.bool() ? 'p1' : 'p2';

    const p1 = this.#malletP1;
    p1.x = TABLE.width / 2;
    p1.y = TABLE.height * 0.8;
    p1.vx = 0;
    p1.vy = 0;

    const p2 = this.#malletP2;
    p2.x = TABLE.width / 2;
    p2.y = TABLE.height * 0.2;
    p2.vx = 0;
    p2.vy = 0;

    this.#resetPuck();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#score.winner !== null) return;

    this.#prevPuckX = this.#puck.x;
    this.#prevPuckY = this.#puck.y;
    this.#prevP1X = this.#malletP1.x;
    this.#prevP1Y = this.#malletP1.y;
    this.#prevP2X = this.#malletP2.x;
    this.#prevP2Y = this.#malletP2.y;

    const rng = context.rng;
    this.#driveMallet('p1', this.#malletP1, this.#botP1, input, fixedDeltaSeconds, rng);
    this.#driveMallet('p2', this.#malletP2, this.#botP2, input, fixedDeltaSeconds, rng);

    if (this.#serveCountdown > 0) {
      this.#serveCountdown -= 1;
      if (this.#serveCountdown === 0) {
        const spread = (rng.float() * 2 - 1) * SERVE_SPREAD;
        const towards = this.#serveToward === 'p1' ? 1 : -1;
        this.#puck.vx = Math.sin(spread) * SERVE_SPEED;
        this.#puck.vy = Math.cos(spread) * SERVE_SPEED * towards;
      }
      return;
    }

    const scored = stepPuck(this.#puck, TABLE, fixedDeltaSeconds);
    if (scored !== 'none') {
      if (scored === 'p1') {
        this.#score.p1 += 1;
      } else {
        this.#score.p2 += 1;
      }
      this.#score.winner = resolve(this.#condition, this.#score);
      // The seat that conceded receives the next serve.
      this.#serveToward = scored === 'p1' ? 'p2' : 'p1';
      this.#resetPuck();
      return;
    }

    collidePuckMallet(this.#puck, this.#malletP1);
    collidePuckMallet(this.#puck, this.#malletP2);
  }

  render(renderer: Renderer, alpha: number): void {
    const width = TABLE.width;
    const height = TABLE.height;
    const centreX = width / 2;
    const centreY = height / 2;
    const goalMinX = (width - TABLE.goalWidth) / 2;

    renderer.clear(COLOUR_TABLE);
    renderer.strokeRect(BORDER, BORDER, width - BORDER * 2, height - BORDER * 2, 4, COLOUR_LINE);
    renderer.line(0, centreY, width, centreY, 5, COLOUR_LINE);
    renderer.strokeCircle(centreX, centreY, 110, 5, COLOUR_LINE);
    renderer.strokeCircle(centreX, centreY, 9, 5, COLOUR_LINE);
    renderer.strokeCircle(centreX, 0, 170, 4, COLOUR_LINE_SOFT);
    renderer.strokeCircle(centreX, height, 170, 4, COLOUR_LINE_SOFT);

    // p2 defends the top; its goal and its mallet both carry two stripes, p1's carry
    // one, so the seats stay apart in greyscale.
    renderer.rect(goalMinX, 0, TABLE.goalWidth, GOAL_BAR, COLOUR_P2);
    renderer.rect(goalMinX, GOAL_BAR + 8, TABLE.goalWidth, GOAL_BAR / 2, COLOUR_P2);
    renderer.rect(goalMinX, height - GOAL_BAR, TABLE.goalWidth, GOAL_BAR, COLOUR_P1);

    if (this.#serveCountdown > 0) {
      const remaining = this.#serveCountdown / SERVE_STEPS;
      renderer.strokeCircle(centreX, centreY, 34 + 76 * remaining, 4, COLOUR_SERVE);
    }

    this.#drawMallet(
      renderer,
      this.#prevP2X + (this.#malletP2.x - this.#prevP2X) * alpha,
      this.#prevP2Y + (this.#malletP2.y - this.#prevP2Y) * alpha,
      COLOUR_P2,
      2,
    );
    this.#drawMallet(
      renderer,
      this.#prevP1X + (this.#malletP1.x - this.#prevP1X) * alpha,
      this.#prevP1Y + (this.#malletP1.y - this.#prevP1Y) * alpha,
      COLOUR_P1,
      1,
    );

    const puckX = this.#prevPuckX + (this.#puck.x - this.#prevPuckX) * alpha;
    const puckY = this.#prevPuckY + (this.#puck.y - this.#prevPuckY) * alpha;
    renderer.circle(puckX, puckY, PUCK_RADIUS, COLOUR_PUCK);
    renderer.strokeCircle(puckX, puckY, PUCK_RADIUS - 5, 3, COLOUR_INK);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // Mallet velocity is derived from the movement of one step, so a pointer that moved
    // during the pause must not read as a swing on the first step back.
    this.#settle();
    this.#prevPuckX = this.#puck.x;
    this.#prevPuckY = this.#puck.y;
    this.#prevP1X = this.#malletP1.x;
    this.#prevP1Y = this.#malletP1.y;
    this.#prevP2X = this.#malletP2.x;
    this.#prevP2Y = this.#malletP2.y;
  }

  getScore(): MatchScore {
    return this.#score;
  }

  destroy(): void {
    this.#context = null;
    this.#botP1 = null;
    this.#botP2 = null;
  }

  #driveMallet(
    seat: SeatId,
    mallet: Body,
    difficulty: BotDifficulty | null,
    input: InputState,
    dt: number,
    rng: Rng,
  ): void {
    let targetX: number;
    let targetY: number;
    if (difficulty !== null) {
      botTarget(this.#botAim, this.#puck, mallet, TABLE, seat, difficulty, rng);
      targetX = this.#botAim.x;
      targetY = this.#botAim.y;
    } else {
      const seatInput = input.seat(seat);
      const pointer = seatInput.pointer;
      if (pointer !== null) {
        targetX = pointer.x;
        targetY = pointer.y;
      } else {
        targetX = mallet.x + seatInput.move.x * KEYBOARD_MALLET_SPEED * dt;
        targetY = mallet.y + seatInput.move.y * KEYBOARD_MALLET_SPEED * dt;
      }
    }
    stepMallet(mallet, targetX, targetY, TABLE, seat, dt);
  }

  #resetPuck(): void {
    const puck = this.#puck;
    puck.x = TABLE.width / 2;
    puck.y = TABLE.height / 2;
    puck.vx = 0;
    puck.vy = 0;
    this.#serveCountdown = SERVE_STEPS;
    // Interpolation must not smear the puck across the table on the reset frame.
    this.#prevPuckX = puck.x;
    this.#prevPuckY = puck.y;
  }

  #settle(): void {
    this.#malletP1.vx = 0;
    this.#malletP1.vy = 0;
    this.#malletP2.vx = 0;
    this.#malletP2.vy = 0;
  }

  #drawMallet(renderer: Renderer, x: number, y: number, colour: string, rings: number): void {
    renderer.circle(x, y, MALLET_RADIUS, colour);
    renderer.strokeCircle(x, y, MALLET_RADIUS - 2, 4, COLOUR_INK);
    for (let i = 0; i < rings; i += 1) {
      renderer.strokeCircle(x, y, MALLET_RADIUS - 11 - i * 9, 3, COLOUR_INK);
    }
  }
}
