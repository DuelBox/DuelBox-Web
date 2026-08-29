import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  COURT_WIDTH,
  CRAB_RADIUS,
  FLOOR_Y,
  NET_HALF_WIDTH,
  NET_TOP,
  NET_X,
  botIntent,
  createBotState,
  createGame,
  jump,
  resetBotState,
  resetGame,
  steer,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Crabby Volley — two crabs, a net, and a ball that never stops falling.
 *
 * The first game here with **continuous physics both seats share at once**. What that
 * demands is not cleverness but discipline: it has to be deterministic, it must not wedge,
 * and neither player may reach into the other's half.
 */

const COLOUR_SKY = '#0e2436';
const COLOUR_SAND = '#c9a26b';
const COLOUR_SAND_DEEP = '#a8834f';
const COLOUR_NET = '#eef3f8';
const COLOUR_NET_POST = '#8fa3b8';
const COLOUR_BALL = '#ffd23f';
const COLOUR_INK = '#10202e';

/** How close a finger has to be before the crab stops fidgeting toward it. */
const POINTER_DEADZONE = 14;

/** The crab's eye, so it has a front and the two seats read as facing each other. */
const EYE_OFFSET = 0.42;

export class CrabbyVolleyGame implements Game {
  #position: Position;
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #intent = { direction: 0, jump: false };

  #rng = new Rng(1);
  /**
   * Neither the presentation nor the local seat is read, and that is deliberate.
   *
   * The court is split left and right, so the two players sit either side of the device
   * and both read it the same way up — there is nothing to rotate and nothing to mirror.
   * A `turn-board` game needs `seatView`; a side-by-side one does not, and pretending
   * otherwise would add a branch that could only ever be wrong.
   */
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | null = null;
  /** Whether each seat's action was down last step, so a hold is one jump. */
  #heldP1 = false;
  #heldP2 = false;

  constructor() {
    this.#position = createGame(this.#rng);
  }

  /** Read-only view for the harness and the tests. */
  get position(): Readonly<Position> {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetGame(this.#position, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#heldP1 = false;
    this.#heldP2 = false;
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    this.#driveSeat('p1', this.#botP1, this.#botP1State, input, fixedDeltaSeconds);
    this.#driveSeat('p2', this.#botP2, this.#botP2State, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    this.#drawCourt(renderer);
    this.#drawCrab(renderer, 'p1');
    this.#drawCrab(renderer, 'p2');
    this.#drawBall(renderer);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // A key still down across a pause must not read as a fresh jump on the way back.
    this.#settle();
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.score.p1,
      p2: this.#position.score.p2,
      winner: this.#winner,
    };
  }

  destroy(): void {
    resetGame(this.#position, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  #settle(): void {
    // Marked held, not released: the next step sees a button already down and waits for a
    // genuine release before believing the next press.
    this.#heldP1 = true;
    this.#heldP2 = true;
  }

  #driveSeat(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    bot: BotState,
    input: InputState,
    dt: number,
  ): void {
    if (difficulty !== null) {
      botIntent(
        this.#intent,
        this.#position,
        bot,
        seat,
        BOT_PROFILES[difficulty],
        dt,
        this.#rng.float(),
      );
      steer(this.#position, seat, this.#intent.direction, dt);
      if (this.#intent.jump) jump(this.#position, seat);
      return;
    }

    const seatInput = input.seat(seat);
    let direction = 0;
    const axis = seatInput.move.x;
    if (axis > 0.2) direction = 1;
    else if (axis < -0.2) direction = -1;

    // A finger on your half is a place to walk to.
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // No clamping here: `steer` already confines a crab to its own half, and a second
      // copy of that rule is a second place for it to be wrong. Pointing at the far side
      // simply walks the crab to its own edge and stops.
      const crab = seat === 'p1' ? this.#position.p1 : this.#position.p2;
      const gap = pointer.x - crab.x;
      if (Math.abs(gap) > POINTER_DEADZONE) direction = gap > 0 ? 1 : -1;
    }
    steer(this.#position, seat, direction, dt);

    // One press, one jump. A held button must not pump the crab up the screen.
    const down = seatInput.actionHeld || seatInput.actionPressed;
    const wasHeld = seat === 'p1' ? this.#heldP1 : this.#heldP2;
    if (down && !wasHeld) jump(this.#position, seat);
    if (seat === 'p1') this.#heldP1 = down;
    else this.#heldP2 = down;
  }

  #drawCourt(renderer: Renderer): void {
    renderer.rect(0, FLOOR_Y, COURT_WIDTH, manifest.logical.height - FLOOR_Y, COLOUR_SAND);
    renderer.rect(0, FLOOR_Y, COURT_WIDTH, 8, COLOUR_SAND_DEEP);
    // The net: a post with a banded top, so its height is legible at a glance.
    renderer.rect(
      NET_X - NET_HALF_WIDTH,
      NET_TOP,
      NET_HALF_WIDTH * 2,
      FLOOR_Y - NET_TOP,
      COLOUR_NET_POST,
    );
    renderer.rect(NET_X - NET_HALF_WIDTH - 6, NET_TOP, NET_HALF_WIDTH * 2 + 12, 14, COLOUR_NET);
  }

  /**
   * A crab, told apart by shape as well as colour.
   *
   * p1 is round with two eyes on top; p2 is squared off with a single band. Rule 7 — and
   * in a fast game with two similar shapes bouncing about, the silhouette is what a player
   * actually tracks.
   */
  #drawCrab(renderer: Renderer, seat: SeatId): void {
    const crab = seat === 'p1' ? this.#position.p1 : this.#position.p2;
    const palette = SEAT_PALETTE[seat];
    const facing = seat === 'p1' ? 1 : -1;

    if (seat === 'p1') {
      renderer.circle(crab.x, crab.y, CRAB_RADIUS, palette.base);
      renderer.strokeCircle(crab.x, crab.y, CRAB_RADIUS - 4, 5, palette.deep);
      renderer.circle(
        crab.x + facing * CRAB_RADIUS * EYE_OFFSET,
        crab.y - CRAB_RADIUS * 0.45,
        8,
        COLOUR_INK,
      );
      renderer.circle(
        crab.x + facing * CRAB_RADIUS * 0.12,
        crab.y - CRAB_RADIUS * 0.55,
        8,
        COLOUR_INK,
      );
    } else {
      renderer.rect(
        crab.x - CRAB_RADIUS,
        crab.y - CRAB_RADIUS * 0.8,
        CRAB_RADIUS * 2,
        CRAB_RADIUS * 1.6,
        palette.base,
      );
      renderer.strokeRect(
        crab.x - CRAB_RADIUS + 4,
        crab.y - CRAB_RADIUS * 0.8 + 4,
        CRAB_RADIUS * 2 - 8,
        CRAB_RADIUS * 1.6 - 8,
        5,
        palette.deep,
      );
      renderer.rect(
        crab.x - CRAB_RADIUS * 0.55,
        crab.y - CRAB_RADIUS * 0.35,
        CRAB_RADIUS * 1.1,
        10,
        COLOUR_INK,
      );
    }
  }

  #drawBall(renderer: Renderer): void {
    const ball = this.#position.ball;
    renderer.circle(ball.x, ball.y, BALL_RADIUS, COLOUR_BALL);
    renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS - 3, 4, COLOUR_INK);
    // A stripe, so the ball is not a plain disc in greyscale next to a pale crab.
    renderer.rect(ball.x - BALL_RADIUS * 0.75, ball.y - 4, BALL_RADIUS * 1.5, 8, COLOUR_INK);
  }
}

const gameModule = {
  manifest,
  create: (): Game => new CrabbyVolleyGame(),
};

export default gameModule;
