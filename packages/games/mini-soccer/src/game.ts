import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  GOAL_DEPTH,
  MATCH_SECONDS,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PLAYER_RADIUS,
  WALL,
  botHeading,
  createBotState,
  createGame,
  drive,
  goalMouth,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Mini Soccer — a pitch, two goals, and one player each.
 *
 * Both players roam the whole pitch, so this is a shared field rather than two halves,
 * and neither seat's view is turned: a pitch read the same way up by two people sitting
 * either side of it is what a real table-top game looks like.
 */

const COLOUR_BACKGROUND = '#0b1c10';
const COLOUR_GRASS = '#16351f';
const COLOUR_GRASS_ALT = '#183a22';
const COLOUR_LINE = 'rgba(233, 250, 236, 0.5)';
const COLOUR_BALL = '#f7f9f4';
const COLOUR_INK = '#0a150d';

/** How far a drag must travel before it counts as a direction. */
const DRAG_DEADZONE = 16;

/** Bands of mown grass, so the pitch has a scale to read speed against. */
const STRIPES = 8;

export class MiniSoccerGame implements Game {
  #position: Position;
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #heading = { x: 0, y: 0 };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

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
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    this.#driveSeat('p1', this.#botP1, this.#botP1State, input, fixedDeltaSeconds);
    this.#driveSeat('p2', this.#botP2, this.#botP2State, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawPitch(renderer);
    this.#drawPlayer(renderer, 'p1');
    this.#drawPlayer(renderer, 'p2');
    this.#drawBall(renderer);
    this.#drawClock(renderer);
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return {
      p1: this.#position.score.p1,
      p2: this.#position.score.p2,
      winner: this.#winner,
    };
  }

  destroy(): void {
    resetGame(this.#position, this.#rng);
    this.#winner = null;
  }

  #driveSeat(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    bot: BotState,
    input: InputState,
    dt: number,
  ): void {
    if (difficulty !== null) {
      botHeading(
        this.#heading,
        this.#position,
        bot,
        seat,
        BOT_PROFILES[difficulty],
        dt,
        this.#rng.float(),
      );
      drive(this.#position, seat, this.#heading.x, this.#heading.y, dt);
      return;
    }

    const seatInput = input.seat(seat);
    let dx = seatInput.move.x;
    let dy = seatInput.move.y;

    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const me = seat === 'p1' ? this.#position.p1 : this.#position.p2;
      const gapX = pointer.x - me.x;
      const gapY = pointer.y - me.y;
      if (Math.hypot(gapX, gapY) > DRAG_DEADZONE) {
        dx = gapX;
        dy = gapY;
      }
    }
    drive(this.#position, seat, dx, dy, dt);
  }

  #drawPitch(renderer: Renderer): void {
    for (let i = 0; i < STRIPES; i += 1) {
      const width = PITCH_WIDTH / STRIPES;
      renderer.rect(
        i * width,
        0,
        width,
        PITCH_HEIGHT,
        i % 2 === 0 ? COLOUR_GRASS : COLOUR_GRASS_ALT,
      );
    }
    renderer.strokeRect(
      WALL,
      WALL,
      PITCH_WIDTH - WALL * 2,
      PITCH_HEIGHT - WALL * 2,
      4,
      COLOUR_LINE,
    );
    renderer.line(PITCH_WIDTH / 2, WALL, PITCH_WIDTH / 2, PITCH_HEIGHT - WALL, 4, COLOUR_LINE);
    renderer.strokeCircle(PITCH_WIDTH / 2, PITCH_HEIGHT / 2, 88, 4, COLOUR_LINE);

    // Each goal is drawn in the colour of the seat that defends it, so a glance says
    // which way you are shooting — the thing a new player gets wrong first.
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const mouth = goalMouth(seat);
      const x = seat === 'p1' ? mouth.x - GOAL_DEPTH : mouth.x;
      renderer.rect(x, mouth.top, GOAL_DEPTH, mouth.bottom - mouth.top, SEAT_PALETTE[seat].deep);
      renderer.strokeRect(
        x,
        mouth.top,
        GOAL_DEPTH,
        mouth.bottom - mouth.top,
        4,
        SEAT_PALETTE[seat].base,
      );
    }
  }

  /** Rule 7: p1 is a disc, p2 a square, and each carries its own goal's colour. */
  #drawPlayer(renderer: Renderer, seat: SeatId): void {
    const me = seat === 'p1' ? this.#position.p1 : this.#position.p2;
    const palette = SEAT_PALETTE[seat];
    if (seat === 'p1') {
      renderer.circle(me.x, me.y, PLAYER_RADIUS, palette.base);
      renderer.strokeCircle(me.x, me.y, PLAYER_RADIUS - 4, 5, COLOUR_INK);
    } else {
      renderer.rect(
        me.x - PLAYER_RADIUS,
        me.y - PLAYER_RADIUS,
        PLAYER_RADIUS * 2,
        PLAYER_RADIUS * 2,
        palette.base,
      );
      renderer.strokeRect(
        me.x - PLAYER_RADIUS + 4,
        me.y - PLAYER_RADIUS + 4,
        PLAYER_RADIUS * 2 - 8,
        PLAYER_RADIUS * 2 - 8,
        5,
        COLOUR_INK,
      );
    }
  }

  #drawBall(renderer: Renderer): void {
    const ball = this.#position.ball;
    renderer.circle(ball.x, ball.y, BALL_RADIUS, COLOUR_BALL);
    renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS - 3, 4, COLOUR_INK);
    // A dark cap, so the ball is not a plain disc against a pale player in greyscale.
    renderer.rect(ball.x - BALL_RADIUS * 0.6, ball.y - 4, BALL_RADIUS * 1.2, 8, COLOUR_INK);
  }

  /**
   * The clock, as a bar across the halfway line.
   *
   * The shell shows the score; nobody shows the time, and in a game decided *by* the whistle
   * a player who cannot see how long is left cannot decide whether to attack or hold.
   */
  #drawClock(renderer: Renderer): void {
    const left = Math.max(0, Math.min(1, this.#position.clock / MATCH_SECONDS));
    const width = PITCH_WIDTH - WALL * 2;
    renderer.rect(WALL, WALL - 14, width, 8, COLOUR_INK);
    renderer.rect(WALL, WALL - 14, width * left, 8, COLOUR_LINE);
  }
}

const gameModule = {
  manifest,
  create: (): Game => new MiniSoccerGame(),
};

export default gameModule;
