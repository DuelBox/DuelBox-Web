import { Rng, SEAT_PALETTE, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  AIM_RATE,
  BALL_RADIUS,
  BOARD_WIDTH,
  HALF_HEIGHT,
  HALF_WIDTH,
  HOOP_HALF,
  HOOP_Y,
  MATCH_SECONDS,
  POOL_HALF_X,
  POOL_HALF_Y,
  POST_RADIUS,
  POST_X,
  ballOf,
  boardSignOf,
  botStep,
  createBotState,
  createState,
  resetBotState,
  resetState,
  secondsLeft,
  step,
} from './rules.js';
import type { Ball, BotDifficulty, BotState, State } from './rules.js';

/**
 * Water Game — one tank, two balls, a basket at each end.
 *
 * `rules.ts` owns the whole simulation and holds it in a **centred** coordinate system, so
 * the half-turn between the two seats is an exact sign flip. This file is the only place
 * that knows the manifest's 0…600 by 0…1000 box exists: it adds the half-extents back on at
 * draw time, and reads the simulation without ever adding to it.
 *
 * Nothing here is rotated and nothing here is a seat flip. The tank is common ground — one
 * body of water both players read the same way up — and the two baskets are half-turn images
 * of each other, so each player already has their own end nearest them. There is no text at
 * all; a test asserts `text` is never called through a whole match.
 */

/* --------------------------------------------------------------------- shapes */

/**
 * Half the side of seat two's square ball, chosen so the two kinds cover the **same area**:
 * `sqrt(pi) / 2`. Both are the identical circle to the simulation, so the two silhouettes
 * differ and nothing else about them does — neither seat has the bigger ball, and neither
 * is easier to spot than the other. `greyscale.test.ts` is what checks the pair apart.
 */
const SQUARE_FOR_CIRCLE = Math.sqrt(Math.PI) / 2;
const BALL_SQUARE_HALF = BALL_RADIUS * SQUARE_FOR_CIRCLE;
const POST_SQUARE_HALF = POST_RADIUS * SQUARE_FOR_CIRCLE;

/** How long the pointer's stalk is drawn, and how big its head is. */
const AIM_LENGTH = 46;
const AIM_HEAD = 8;
const AIM_HEAD_SQUARE = AIM_HEAD * SQUARE_FOR_CIRCLE;

/* -------------------------------------------------------------------- colours */

const COLOUR_DECK = '#061319';
const COLOUR_WATER = '#0e3446';
const COLOUR_DEEP = '#0b2938';
const COLOUR_RIM = 'rgba(206, 236, 250, 0.26)';
const COLOUR_LANE = 'rgba(206, 236, 250, 0.09)';
const COLOUR_CHALK = 'rgba(222, 242, 252, 0.5)';
const COLOUR_INK = '#04101a';

/** Steps a goal's flash stays on the basket that took it. */
export const FLASH_STEPS = 30;

/** One seat's presentation-only state. Allocated once, at construction. */
interface SeatRuntime {
  flashSteps: number;
}

function createRuntime(): SeatRuntime {
  return { flashSteps: 0 };
}

export class WaterGameGame implements Game {
  readonly #state: State = createState();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  /**
   * Where the two balls stood at the end of the *previous* step, for the interpolation.
   *
   * A ball crosses the tank at up to 640 units a second, which is 10.7 units a step, so on a
   * display running above the simulation rate an uninterpolated ball strobes visibly. Typed
   * arrays, allocated once here and written in place at the top of every step: `update`
   * allocates nothing. Index 0 is seat one, index 1 seat two.
   */
  readonly #prevX = new Float64Array(2);
  readonly #prevY = new Float64Array(2);
  readonly #prevAim = new Float64Array(2);

  /**
   * A generator per seat, and **which seat gets which is decided by `openingSeat`**.
   *
   * This game has no opener in the sense a turn game does — both balls are live from step
   * zero and the contract says a real-time game may ignore the field. It is read anyway, and
   * for a reason worth more than the line it costs: the tank, the two baskets and both
   * starting positions are exact half-turn images of one another, and the *only* thing that
   * distinguishes the two seats in a bot match is which stream drives which bot. Swapping
   * the streams therefore produces the exact mirror of the same match — the same rally,
   * played from the other chair.
   *
   * The SDK alternates `openingSeat` across the rounds of a best-of, and
   * `balance-aggregate.test.ts` plays every seed once from each. So seat one's share of
   * decided matches is **exactly 50.0% by construction**, not 49.7% by sampling, and
   * `rules.test.ts` asserts it seed by seed rather than in aggregate.
   */
  #botP1Rng = new Rng(1);
  #botP2Rng = new Rng(2);

  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #ready = false;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  get state(): Readonly<State> {
    return this.#state;
  }

  init(context: GameContext): void {
    const first = context.rng.next() | 0;
    const second = context.rng.next() | 0;
    const opener = context.openingSeat;
    const answerer = otherSeat(opener);
    this.#botP1Rng = new Rng(opener === 'p1' ? first : second);
    this.#botP2Rng = new Rng(answerer === 'p2' ? second : first);
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#ready = true;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#runtimeP1.flashSteps = 0;
    this.#runtimeP2.flashSteps = 0;
    resetState(this.#state);
    // So the first frame drawn interpolates from where the match starts rather than zero.
    this.#remember();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (!this.#ready) return;
    if (this.#state.winner !== null) return;

    // Taken before anything moves, so what render interpolates from is genuinely the state
    // at the end of the previous step — which is what the loop's `alpha` is measured against.
    this.#remember();

    const p1Press = this.#pressOf('p1', input, fixedDeltaSeconds);
    const p2Press = this.#pressOf('p2', input, fixedDeltaSeconds);
    step(this.#state, fixedDeltaSeconds, p1Press, p2Press);

    if (this.#runtimeP1.flashSteps > 0) this.#runtimeP1.flashSteps -= 1;
    if (this.#runtimeP2.flashSteps > 0) this.#runtimeP2.flashSteps -= 1;
    if (this.#state.p1Scored) this.#runtimeP1.flashSteps = FLASH_STEPS;
    if (this.#state.p2Scored) this.#runtimeP2.flashSteps = FLASH_STEPS;
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_DECK);
    this.#drawTank(renderer);
    this.#drawClock(renderer);
    this.#drawHoop(renderer, 'p1', this.#runtimeP1);
    this.#drawHoop(renderer, 'p2', this.#runtimeP2);
    this.#drawBall(renderer, 'p1', alpha);
    this.#drawBall(renderer, 'p2', alpha);
  }

  onPause(): void {}

  onResume(): void {
    // Nothing to settle: the shove is derived from an edge, so an action still held across a
    // pause cannot read as a fresh press when play comes back.
  }

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: this.#state.winner };
  }

  destroy(): void {
    this.#ready = false;
    this.#botP1 = null;
    this.#botP2 = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#runtimeP1.flashSteps = 0;
    this.#runtimeP2.flashSteps = 0;
    resetState(this.#state);
    this.#remember();
  }

  /* ------------------------------------------------------------------ driving */

  /**
   * Whether this seat shoves on this step.
   *
   * A bare press and nothing else, which is why there is no control mapping here at all:
   * `actionHeld` is `keys.action || pointerDown` in the engine, so a finger on the glass and
   * `Space` produce the identical edge, and neither carries a position that a presentation
   * could need to rotate. The two presentations are therefore the same code path rather than
   * two code paths asserted to agree.
   */
  #pressOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): boolean {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const bot = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const rng = seat === 'p1' ? this.#botP1Rng : this.#botP2Rng;
      return botStep(ballOf(this.#state, seat), difficulty, bot, rng, fixedDeltaSeconds);
    }
    return input.seat(seat).actionPressed;
  }

  /* ------------------------------------------------------------ interpolation */

  /** Copy where both balls stand into the previous-step arrays. Allocates nothing. */
  #remember(): void {
    const p1 = this.#state.p1Ball;
    const p2 = this.#state.p2Ball;
    this.#prevX[0] = p1.x;
    this.#prevY[0] = p1.y;
    this.#prevAim[0] = p1.aim;
    this.#prevX[1] = p2.x;
    this.#prevY[1] = p2.y;
    this.#prevAim[1] = p2.aim;
  }

  /**
   * A ball moves at most 10.7 units a step, so anything bigger than this is not motion — it
   * is a ball that has just scored and been put back on its spot, and drawing the line
   * between the two would streak it the length of the tank.
   */
  static readonly #TELEPORT = 40;

  #blend(previous: number, current: number, alpha: number): number {
    if (Math.abs(current - previous) > WaterGameGame.#TELEPORT) return current;
    return previous + (current - previous) * alpha;
  }

  /* ------------------------------------------------------------------ drawing */

  /** Board x for an own-frame x. The one place the manifest's box is put back on. */
  #boardX(value: number, sign: number): number {
    return value * sign + HALF_WIDTH;
  }

  #boardY(value: number, sign: number): number {
    return value * sign + HALF_HEIGHT;
  }

  #drawTank(renderer: Renderer): void {
    renderer.rect(
      HALF_WIDTH - POOL_HALF_X,
      HALF_HEIGHT - POOL_HALF_Y,
      POOL_HALF_X * 2,
      POOL_HALF_Y * 2,
      COLOUR_WATER,
    );

    // The deep water in the middle, where the two balls meet head on. One object, drawn
    // once, symmetric about the centre — so it belongs to neither player.
    renderer.rect(
      HALF_WIDTH - POOL_HALF_X,
      HALF_HEIGHT - HOOP_Y,
      POOL_HALF_X * 2,
      HOOP_Y * 2,
      COLOUR_DEEP,
    );
    renderer.line(
      HALF_WIDTH - POOL_HALF_X,
      HALF_HEIGHT,
      HALF_WIDTH + POOL_HALF_X,
      HALF_HEIGHT,
      2,
      COLOUR_LANE,
    );

    renderer.strokeRect(
      HALF_WIDTH - POOL_HALF_X,
      HALF_HEIGHT - POOL_HALF_Y,
      POOL_HALF_X * 2,
      POOL_HALF_Y * 2,
      4,
      COLOUR_RIM,
    );
  }

  /**
   * Seconds left, as a bar on each side margin growing out from the middle of the tank.
   *
   * One object, shared, and symmetric under the half-turn, so neither player is nearer to it
   * than the other. The clock is the game's own — the shell has no idea this match has one.
   */
  #drawClock(renderer: Renderer): void {
    const share = secondsLeft(this.#state) / MATCH_SECONDS;
    const half = POOL_HALF_Y * share;
    renderer.rect(9, HALF_HEIGHT - half, 8, half * 2, COLOUR_CHALK);
    renderer.rect(BOARD_WIDTH - 17, HALF_HEIGHT - half, 8, half * 2, COLOUR_CHALK);
  }

  /**
   * A basket: two posts, the mouth between them, and a short apron behind it.
   *
   * Rule 7 runs through every object either seat owns. **Seat one's furniture is round and
   * seat two's is square**, at equal area — its posts, its ball, and the head on its pointer.
   * A player who cannot see colour at all still knows which basket is theirs, because it is
   * the one built out of the same shape their ball is.
   */
  #drawHoop(renderer: Renderer, seat: SeatId, runtime: Readonly<SeatRuntime>): void {
    const palette = SEAT_PALETTE[seat];
    const sign = boardSignOf(seat);
    const mouthY = this.#boardY(-HOOP_Y, sign);
    const left = this.#boardX(-HOOP_HALF, sign);
    const right = this.#boardX(HOOP_HALF, sign);
    const flashing = runtime.flashSteps > 0;

    // The mouth, drawn at the width the rule actually uses.
    renderer.line(left, mouthY, right, mouthY, flashing ? 10 : 5, palette.base);

    // The apron behind it: the water a ball leaves through. Ticks rather than a fill, so it
    // reads as a net and never as a wall.
    const apron = this.#boardY(-POOL_HALF_Y + BALL_RADIUS, sign);
    for (let i = -2; i <= 2; i += 1) {
      const x = this.#boardX(i * (HOOP_HALF / 2), sign);
      renderer.line(x, mouthY, x, apron, 2, palette.soft);
    }

    this.#drawPost(renderer, seat, this.#boardX(-POST_X, sign), mouthY);
    this.#drawPost(renderer, seat, this.#boardX(POST_X, sign), mouthY);
  }

  #drawPost(renderer: Renderer, seat: SeatId, x: number, y: number): void {
    const palette = SEAT_PALETTE[seat];
    if (seat === 'p1') {
      renderer.circle(x, y, POST_RADIUS, palette.base);
      renderer.strokeCircle(x, y, POST_RADIUS - 2, 3, palette.deep);
      return;
    }
    const half = POST_SQUARE_HALF;
    renderer.rect(x - half, y - half, half * 2, half * 2, palette.base);
    renderer.strokeRect(
      x - half + 2,
      y - half + 2,
      (half - 2) * 2,
      (half - 2) * 2,
      3,
      palette.deep,
    );
  }

  /**
   * A ball and the pointer it is riding.
   *
   * The pointer is drawn thick and solid when a press would land and thin and faint while
   * the cooldown still has it, so the one thing a player has to time is the one thing on the
   * screen that changes appearance. Nothing the bot reads is hidden from a person: the ball,
   * its heading, the pointer and the basket are all of it (rule 6).
   */
  #drawBall(renderer: Renderer, seat: SeatId, alpha: number): void {
    const ball: Readonly<Ball> = ballOf(this.#state, seat);
    const palette = SEAT_PALETTE[seat];
    const sign = boardSignOf(seat);
    const index = seat === 'p1' ? 0 : 1;
    const localX = this.#blend(this.#prevX[index] ?? ball.x, ball.x, alpha);
    const localY = this.#blend(this.#prevY[index] ?? ball.y, ball.y, alpha);
    const x = this.#boardX(localX, sign);
    const y = this.#boardY(localY, sign);

    const ready = ball.cooldown <= 0;
    const aim = this.#aimOf(index, ball, alpha);
    // The pointer is an own-frame angle; the board turns it by the same half-turn the
    // positions get, which for a sign of -1 is simply half a turn added.
    const drawn = sign > 0 ? aim : aim + Math.PI;
    const tipX = x + Math.cos(drawn) * AIM_LENGTH;
    const tipY = y + Math.sin(drawn) * AIM_LENGTH;
    renderer.line(x, y, tipX, tipY, ready ? 6 : 3, ready ? palette.base : palette.soft);
    if (seat === 'p1') renderer.circle(tipX, tipY, AIM_HEAD, ready ? palette.base : palette.soft);
    else
      renderer.rect(
        tipX - AIM_HEAD_SQUARE,
        tipY - AIM_HEAD_SQUARE,
        AIM_HEAD_SQUARE * 2,
        AIM_HEAD_SQUARE * 2,
        ready ? palette.base : palette.soft,
      );

    if (seat === 'p1') {
      renderer.circle(x, y, BALL_RADIUS, palette.base);
      renderer.strokeCircle(x, y, BALL_RADIUS - 3, 4, palette.deep);
      renderer.circle(x, y, BALL_RADIUS * 0.4, COLOUR_INK);
    } else {
      const half = BALL_SQUARE_HALF;
      renderer.rect(x - half, y - half, half * 2, half * 2, palette.base);
      renderer.strokeRect(
        x - half + 3,
        y - half + 3,
        (half - 3) * 2,
        (half - 3) * 2,
        4,
        palette.deep,
      );
      const pip = half * 0.42;
      renderer.rect(x - pip, y - pip, pip * 2, pip * 2, COLOUR_INK);
    }
  }

  /**
   * How far round the pointer has turned, part-way between two steps.
   *
   * Only interpolated while it is still going the same way. The step a ball scores on puts
   * the pointer back to its starting angle, and running that backwards through the
   * interpolation would spin it the wrong way for one frame.
   */
  #aimOf(index: number, ball: Readonly<Ball>, alpha: number): number {
    const previous = this.#prevAim[index] ?? ball.aim;
    const delta = ball.aim - previous;
    if (delta < 0 || delta > AIM_RATE) return ball.aim;
    return previous + delta * alpha;
  }
}

/**
 * The two silhouettes, exported so `game.test.ts` can assert they cover the same area rather
 * than take the constant's word for it.
 */
export const SHAPE_AREAS = Object.freeze({
  circle: Math.PI * BALL_RADIUS * BALL_RADIUS,
  square: (BALL_SQUARE_HALF * 2) ** 2,
});
