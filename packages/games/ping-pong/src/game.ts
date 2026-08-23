import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BALL_RADIUS,
  P1_RACKET_Y,
  P2_RACKET_Y,
  RACKET_HALF_HEIGHT,
  RACKET_HALF_WIDTH,
  RACKET_SPEED,
  RAIL,
  ROUND_SECONDS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  TARGET_POINTS,
  botAim,
  callOnTime,
  clampRacket,
  createBotState,
  createGame,
  driveRacket,
  racketOf,
  racketYOf,
  reachOf,
  resetBotState,
  resetGame,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Ping Pong — a racket each end, and a ball that takes your sweep with it.
 *
 * The rules module holds the whole simulation. What lives here is how a person expresses
 * an intent through it, and how the table is drawn.
 */

const COLOUR_SURROUND = '#0b1f17';
const COLOUR_TABLE = '#12513c';
const COLOUR_TABLE_FAR = '#0f452f';
const COLOUR_RAIL = '#e8f1ec';
const COLOUR_LINE = 'rgba(232, 241, 236, 0.55)';
const COLOUR_NET = '#dbe6df';
const COLOUR_NET_SHADOW = 'rgba(6, 20, 15, 0.45)';
const COLOUR_BALL = '#fdf6d8';
const COLOUR_INK = '#0b1f17';

/** How long after the last point the ball is drawn pulsing rather than still. */
const SERVE_PULSE = 0.5;

export class PingPongGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    // Rackets first, so their velocity this step is the sweep the ball meets.
    this.#driveSeat('p1', input, fixedDeltaSeconds);
    this.#driveSeat('p2', input, fixedDeltaSeconds);

    step(this.#position, fixedDeltaSeconds, this.#rng);

    if (this.#position.elapsed >= ROUND_SECONDS) callOnTime(this.#position);
    this.#winner = winnerOf(this.#position);
  }

  #driveSeat(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    const wanted =
      difficulty !== null
        ? botAim(
            this.#position,
            seat,
            difficulty,
            seat === 'p1' ? this.#botP1State : this.#botP2State,
            fixedDeltaSeconds,
            this.#rng,
          )
        : this.#humanAim(seat, input, fixedDeltaSeconds);
    driveRacket(racketOf(this.#position, seat), wanted, fixedDeltaSeconds);
  }

  /**
   * Where a person wants their racket.
   *
   * A finger names an **absolute** column, unlike Snake Clash's relative drag, and it can
   * here because the split is horizontal: each seat owns a full-width band of the table
   * and every column their racket can reach is directly under their own thumb. Asking
   * them to drag relatively would be asking them to aim at a place they can already touch.
   *
   * Keys steer at the racket's own speed, and that parity is the point: a key held down
   * and a finger dragged across the table cover the table in the same time, because
   * `driveRacket` rate-limits both. What a key cannot do is *stop* on the ball, which is
   * how spin stays a thing a finger is better at without a key being unfair.
   */
  #humanAim(seat: SeatId, input: InputState, fixedDeltaSeconds: number): number {
    const seatInput = input.seat(seat);
    const racket = racketOf(this.#position, seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) return clampRacket(pointer.x);
    if (seatInput.move.x !== 0) {
      return clampRacket(racket.x + seatInput.move.x * RACKET_SPEED * fixedDeltaSeconds * 2);
    }
    return racket.x;
  }

  getActiveSeat(): SeatId | null {
    // Never: both rackets are live at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.p1Points,
      p2: this.#position.p2Points,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  render(renderer: Renderer): void {
    this.#drawTable(renderer);
    this.#drawRacket(renderer, 'p1');
    this.#drawRacket(renderer, 'p2');
    this.#drawBall(renderer);
  }

  #drawTable(renderer: Renderer): void {
    renderer.clear(COLOUR_SURROUND);

    // Two shades either side of the net, so which half is yours is readable in greyscale
    // and at a glance — the only thing on a table that tells you where you are.
    renderer.rect(RAIL, RAIL, TABLE_WIDTH - RAIL * 2, TABLE_HEIGHT / 2 - RAIL, COLOUR_TABLE_FAR);
    renderer.rect(
      RAIL,
      TABLE_HEIGHT / 2,
      TABLE_WIDTH - RAIL * 2,
      TABLE_HEIGHT / 2 - RAIL,
      COLOUR_TABLE,
    );

    renderer.strokeRect(
      RAIL,
      RAIL,
      TABLE_WIDTH - RAIL * 2,
      TABLE_HEIGHT - RAIL * 2,
      5,
      COLOUR_RAIL,
    );
    // The centre line down the length of the table, as on a real doubles table.
    renderer.line(TABLE_WIDTH / 2, RAIL, TABLE_WIDTH / 2, TABLE_HEIGHT - RAIL, 3, COLOUR_LINE);

    this.#drawNet(renderer);
    this.#drawServeCounter(renderer);
  }

  #drawNet(renderer: Renderer): void {
    const y = TABLE_HEIGHT / 2;
    renderer.rect(RAIL - 8, y - 3, TABLE_WIDTH - (RAIL - 8) * 2, 6, COLOUR_NET_SHADOW);
    renderer.rect(RAIL - 8, y - 6, TABLE_WIDTH - (RAIL - 8) * 2, 4, COLOUR_NET);
    // The net's mesh, as ticks. Cheap, and it stops the middle of the table reading as
    // a fold in the surface.
    for (let x = RAIL; x < TABLE_WIDTH - RAIL; x += 26) {
      renderer.line(x, y - 6, x, y + 2, 1.5, COLOUR_NET_SHADOW);
    }
  }

  /**
   * Points, as pips along the rails rather than as numerals.
   *
   * The shell's HUD already prints the score. What a player cannot get from it mid-rally
   * is *how close the match is* without reading two numbers, so each seat's pips run up
   * its own rail toward its own end: yours fills toward you.
   */
  #drawServeCounter(renderer: Renderer): void {
    const spacing = (TABLE_HEIGHT / 2 - RAIL * 2 - 40) / TARGET_POINTS;
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const palette = SEAT_PALETTE[seat];
      const points = seat === 'p1' ? this.#position.p1Points : this.#position.p2Points;
      const direction = seat === 'p1' ? 1 : -1;
      const start = TABLE_HEIGHT / 2 + direction * (RAIL + 26);
      for (let i = 0; i < TARGET_POINTS; i += 1) {
        const y = start + direction * i * spacing;
        const filled = i < points;
        renderer.rect(RAIL - 12, y - 6, 8, 12, filled ? palette.base : COLOUR_NET_SHADOW);
        // Rule 7: the far seat's pips carry a notch, so the two columns differ by shape
        // and not only by colour.
        if (seat === 'p2' && filled) renderer.rect(RAIL - 12, y - 1, 8, 2, COLOUR_INK);
      }
    }
  }

  /**
   * Rule 7 again: p1's racket is solid with a centre spot, p2's is barred across its
   * face. Two rackets at opposite ends are rarely confused, but a screenshot in greyscale
   * still has to say which is which.
   */
  #drawRacket(renderer: Renderer, seat: SeatId): void {
    const racket = racketOf(this.#position, seat);
    const y = racketYOf(seat);
    const palette = SEAT_PALETTE[seat];
    // Drawn at its *current* width, which is the whole point: a player watching their own
    // racket narrow as the rally goes on is the only warning the rule gives, and it needs
    // no words in any language.
    const half = reachOf(this.#position, seat);

    renderer.rect(
      racket.x - half,
      y - RACKET_HALF_HEIGHT,
      half * 2,
      RACKET_HALF_HEIGHT * 2,
      palette.base,
    );
    // A ghost of the full-width racket, so what has been lost is visible beside what is
    // left rather than having to be remembered.
    if (half < RACKET_HALF_WIDTH) {
      renderer.strokeRect(
        racket.x - RACKET_HALF_WIDTH,
        y - RACKET_HALF_HEIGHT,
        RACKET_HALF_WIDTH * 2,
        RACKET_HALF_HEIGHT * 2,
        1.5,
        palette.soft,
      );
    }
    if (seat === 'p1') {
      renderer.circle(racket.x, y, Math.min(RACKET_HALF_HEIGHT - 3, half - 2), palette.deep);
    } else {
      for (let i = -2; i <= 2; i += 1) {
        const x = racket.x + i * (half / 2.5);
        renderer.rect(x - 2, y - RACKET_HALF_HEIGHT, 4, RACKET_HALF_HEIGHT * 2, palette.deep);
      }
    }

    // The handle, pointing at the player it belongs to, so each end reads as *facing* you.
    const handleY = seat === 'p1' ? y + RACKET_HALF_HEIGHT : y - RACKET_HALF_HEIGHT - 14;
    renderer.rect(racket.x - 7, handleY, 14, 14, palette.deep);
  }

  #drawBall(renderer: Renderer): void {
    const ball = this.#position.ball;
    if (this.#position.phase === 'serving') {
      // A ring that closes as the serve arrives, so the launch is never a surprise.
      const left = Math.max(0, Math.min(1, this.#position.serveDelay / SERVE_PULSE));
      renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS + 8 + 40 * left, 3, COLOUR_LINE);
    }

    // A short tail along its own heading. It costs one line and it is what makes a fast
    // ball readable at all on a phone.
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 1) {
      renderer.line(
        ball.x - (ball.vx / speed) * 34,
        ball.y - (ball.vy / speed) * 34,
        ball.x,
        ball.y,
        4,
        COLOUR_LINE,
      );
    }

    renderer.circle(ball.x, ball.y, BALL_RADIUS, COLOUR_BALL);
    renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS - 4, 2, COLOUR_INK);
  }
}

/** Re-exported so the shell's layout tests can name the two baselines. */
export { P1_RACKET_Y, P2_RACKET_Y };
