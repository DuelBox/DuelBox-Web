import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import { resolveSimultaneous } from '@duelbox/game-sdk';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARRIVE_SECONDS,
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CATCH_RADIUS,
  HIPPO_SPEED,
  LUNGE_REACH,
  MATCH_SECONDS,
  MOUTH_RADIUS,
  POND_BALLS,
  POND_BOTTOM,
  POND_LEFT,
  POND_RIGHT,
  POND_TOP,
  botStep,
  chomp,
  createBotState,
  createState,
  driveHippo,
  homeYOf,
  hippoOf,
  mouthOpen,
  mouthYOf,
  reaches,
  resetBotState,
  resetState,
  resting,
  secondsLeft,
  step,
} from './rules.js';
import type { Ball, BotDifficulty, BotState, Hippo, State } from './rules.js';

/**
 * Happy Hippos — one pond, two banks, and everything in it drawn in board orientation.
 *
 * The pond is common ground: both players read the same water the same way up, so nothing here
 * is rotated except the per-chomp feedback, which belongs to one seat and is turned to face it.
 * `rules.ts` owns the whole simulation; this file reads it, places a finger on it and draws it.
 */

/* --------------------------------------------------------------------- shapes */

/**
 * Half the side of seat two's square ball, chosen so the two kinds cover the **same area**:
 * `sqrt(pi) / 2`. Both are caught by the identical circular test at {@link CATCH_RADIUS}, so
 * the two silhouettes differ and nothing else about them does — neither kind is a bigger
 * target, and neither is easier to spot than the other.
 */
const BALL_SQUARE_HALF = BALL_RADIUS * (Math.sqrt(Math.PI) / 2);

/** The same square rule for a mouth, so seat two's head reads as square at every size. */
const MOUTH_SQUARE_HALF = MOUTH_RADIUS * (Math.sqrt(Math.PI) / 2);

const BODY_RADIUS = 54;
const BODY_OFFSET = 66;

/* -------------------------------------------------------------------- colours */

const COLOUR_GROUND = '#0c1620';
const COLOUR_BANK = '#17252f';
const COLOUR_WATER = '#123646';
const COLOUR_WATER_CONTESTED = '#17485e';
const COLOUR_RIM = 'rgba(214, 236, 246, 0.24)';
const COLOUR_LINE = 'rgba(214, 236, 246, 0.13)';
const COLOUR_CHALK = 'rgba(226, 240, 248, 0.5)';
const COLOUR_INK = '#07131b';
const COLOUR_CLASH = '#f6d365';

/* ------------------------------------------------------------------- feedback */

/** Steps a chomp's tally stays beside the hippo that took it. */
export const FEEDBACK_STEPS = 42;

/**
 * Signed labels for a chomp's net, looked up rather than built.
 *
 * A chomp can take at most a handful of balls, so the whole range fits in a frozen table and
 * `render` never allocates a string. The floor at zero means a *score* never goes negative;
 * a single chomp's net still can, and that is the number a player wants to see.
 */
const GAIN_FLOOR = -8;
const GAIN_LABELS: readonly string[] = Object.freeze(
  Array.from({ length: 29 }, (_unused, i) => {
    const value = GAIN_FLOOR + i;
    return value > 0 ? `+${String(value)}` : String(value);
  }),
);

function gainLabel(gain: number): string {
  const index = gain - GAIN_FLOOR;
  if (index < 0 || index >= GAIN_LABELS.length) return '';
  return GAIN_LABELS[index] ?? '';
}

/** How far a key has to be open before it counts as a direction. */
const AXIS_THRESHOLD = 0.35;

function axis(value: number): number {
  if (value > AXIS_THRESHOLD) return 1;
  if (value < -AXIS_THRESHOLD) return -1;
  return 0;
}

/** One seat's presentation-only state. Allocated once, at construction. */
interface SeatRuntime {
  /** Net of the chomp being shown, and how many steps it has left on screen. */
  gain: number;
  gainSteps: number;
  /** Whether the hippo was mid-chomp last step, so the end of one can be noticed. */
  wasChomping: boolean;
}

function createRuntime(): SeatRuntime {
  return { gain: 0, gainSteps: 0, wasChomping: false };
}

function resetRuntime(runtime: SeatRuntime): void {
  runtime.gain = 0;
  runtime.gainSteps = 0;
  runtime.wasChomping = false;
}

export class HappyHipposGame implements Game {
  readonly #state: State = createState();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  /**
   * Where everything stood at the end of the *previous* step, for the render interpolation.
   *
   * The mouth is the reason this exists. It crosses the pond at 2176 units a second, which is
   * 36 units a step — so on a display running above the simulation rate an uninterpolated
   * mouth strobes visibly, and the mouth is the object a player is watching. Typed arrays,
   * allocated once here, written in place at the top of every step: `update` allocates nothing.
   */
  readonly #prevBallX = new Float64Array(POND_BALLS);
  readonly #prevBallY = new Float64Array(POND_BALLS);
  /** Index 0 is seat one, index 1 seat two. */
  readonly #prevHippoX = new Float64Array(2);
  readonly #prevChompSeconds = new Float64Array(2);
  /** Whether that seat was mid-chomp at the end of the previous step. */
  readonly #wasMidChomp = new Uint8Array(2);

  /**
   * Three streams from the one seed the shell gives us.
   *
   * The pond has its own, so what rolls in is a function of the match seed and never of how
   * often a tier happened to look at the water — `hard` looks three times as often as `easy`,
   * and on a shared stream that alone would deal the two pairings different ponds. Each seat's
   * bot has its own for the other half of the same argument: with one stream, whichever seat is
   * polled first takes the earlier value every time, which is a seat bias dressed as chance.
   */
  #pondRng = new Rng(1);
  #botP1Rng = new Rng(2);
  #botP2Rng = new Rng(3);

  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #openingSeat: SeatId = 'p1';
  #ready = false;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  get state(): Readonly<State> {
    return this.#state;
  }

  init(context: GameContext): void {
    this.#pondRng = new Rng(context.rng.next() | 0);
    this.#botP1Rng = new Rng(context.rng.next() | 0);
    this.#botP2Rng = new Rng(context.rng.next() | 0);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    // Read rather than assumed, even though both hippos act from step zero: it decides which
    // slot parity is whose colour, which is the one place this game is not already symmetric.
    // See `colourOfSlot` for exactly how little that buys and why it is still worth a line.
    this.#openingSeat = context.openingSeat;
    this.#ready = true;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetState(this.#state, this.#pondRng, this.#openingSeat);
    // So the first frame drawn interpolates from where the match starts rather than from zero.
    this.#remember();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (!this.#ready) return;
    if (this.#state.winner !== null) return;

    // Taken before anything moves, so what render interpolates from is genuinely the state at
    // the end of the previous step — which is what the loop's `alpha` is measured against.
    this.#remember();

    // Both seats are driven before the pond is stepped, so neither is a step ahead of the
    // other. Nothing here decides anything: a chomp only records the time it was committed,
    // and `step` settles every contested ball afterwards from those two times.
    this.#driveSeat('p1', input, fixedDeltaSeconds);
    this.#driveSeat('p2', input, fixedDeltaSeconds);

    step(this.#state, fixedDeltaSeconds, this.#pondRng);

    this.#latchFeedback('p1', this.#runtimeP1);
    this.#latchFeedback('p2', this.#runtimeP2);
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_GROUND);
    this.#drawPond(renderer);
    this.#drawClock(renderer);
    this.#drawBalls(renderer, alpha);
    this.#drawHippo(renderer, 'p1', alpha);
    this.#drawHippo(renderer, 'p2', alpha);
    this.#drawFeedback(renderer, 'p1', this.#runtimeP1, alpha);
    this.#drawFeedback(renderer, 'p2', this.#runtimeP2, alpha);
  }

  onPause(): void {}

  onResume(): void {
    // Nothing to settle: a hippo has no held-key repeat, and the engine derives the chomp from
    // an edge, so an action still down across a pause cannot read as a fresh tap.
  }

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: this.#state.winner };
  }

  destroy(): void {
    this.#ready = false;
    this.#botP1 = null;
    this.#botP2 = null;
    this.#openingSeat = 'p1';
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetState(this.#state, this.#pondRng);
    this.#remember();
  }

  /* ------------------------------------------------------------------ driving */

  /** True when this seat reads the device upside down, so its keys mean the mirror image. */
  #isRotated(seat: SeatId): boolean {
    return this.#presentation === 'shared-screen' && seat !== this.#localSeat;
  }

  #driveSeat(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const bot = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const rng = seat === 'p1' ? this.#botP1Rng : this.#botP2Rng;
      if (botStep(this.#state, seat, difficulty, bot, rng, fixedDeltaSeconds)) {
        chomp(this.#state, seat);
      }
      return;
    }

    const hippo = hippoOf(this.#state, seat);
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // Absolute, and no mirror: the pond is one shared board drawn in one orientation, so a
      // finger is already over the water it is pointing at whichever side of the device its
      // owner is sitting on. `driveHippo` rate-limits it, so a thumb that jumps across the
      // bank cannot drag the hippo there faster than a held key would.
      driveHippo(hippo, pointer.x, fixedDeltaSeconds);
    } else {
      // A key is a direction, and a seat reading the device upside down means the opposite one.
      // This is control mapping, which is allowed to differ between the two presentations;
      // nothing in the simulation reads the presentation.
      const mirror = this.#isRotated(seat) ? -1 : 1;
      const direction = axis(seatInput.move.x) * mirror;
      const wanted =
        direction === 0 ? hippo.x : hippo.x + direction * HIPPO_SPEED * fixedDeltaSeconds * 2;
      driveHippo(hippo, wanted, fixedDeltaSeconds);
    }

    if (seatInput.actionPressed) chomp(this.#state, seat);
  }

  /** Hold a finished chomp's net beside its hippo for a moment. */
  #latchFeedback(seat: SeatId, runtime: SeatRuntime): void {
    const hippo = hippoOf(this.#state, seat);
    if (runtime.gainSteps > 0) runtime.gainSteps -= 1;
    if (runtime.wasChomping && resting(hippo)) {
      runtime.gain = hippo.chompGain;
      runtime.gainSteps = FEEDBACK_STEPS;
    }
    runtime.wasChomping = !resting(hippo);
  }

  /* ------------------------------------------------------------ interpolation */

  /** Copy where everything stands into the previous-step arrays. Allocates nothing. */
  #remember(): void {
    for (let i = 0; i < this.#state.balls.length; i += 1) {
      const ball = this.#state.balls[i];
      if (ball === undefined) continue;
      this.#prevBallX[i] = ball.x;
      this.#prevBallY[i] = ball.y;
    }
    this.#prevHippoX[0] = this.#state.p1Hippo.x;
    this.#prevHippoX[1] = this.#state.p2Hippo.x;
    this.#prevChompSeconds[0] = this.#state.p1Hippo.chompSeconds;
    this.#prevChompSeconds[1] = this.#state.p2Hippo.chompSeconds;
    this.#wasMidChomp[0] = this.#state.p1Hippo.chomping ? 1 : 0;
    this.#wasMidChomp[1] = this.#state.p2Hippo.chomping ? 1 : 0;
  }

  /**
   * A ball moves at most three and a half units a step, so anything bigger than this is not
   * motion — it is an eaten ball reappearing on a wall, and drawing the line between the two
   * would streak it across the pond.
   */
  static readonly #TELEPORT = 20;

  #ballX(index: number, ball: Readonly<Ball>, alpha: number): number {
    const previous = this.#prevBallX[index] ?? ball.x;
    if (Math.abs(ball.x - previous) > HappyHipposGame.#TELEPORT) return ball.x;
    return previous + (ball.x - previous) * alpha;
  }

  #ballY(index: number, ball: Readonly<Ball>, alpha: number): number {
    const previous = this.#prevBallY[index] ?? ball.y;
    if (Math.abs(ball.y - previous) > HappyHipposGame.#TELEPORT) return ball.y;
    return previous + (ball.y - previous) * alpha;
  }

  #hippoX(seat: SeatId, alpha: number): number {
    const hippo = hippoOf(this.#state, seat);
    const previous = this.#prevHippoX[seat === 'p1' ? 0 : 1] ?? hippo.x;
    return previous + (hippo.x - previous) * alpha;
  }

  /**
   * How far through its chomp a hippo is, part-way between two steps.
   *
   * Only interpolated *within* one chomp. A chomp that started or ended this step would run the
   * clock backwards through the whole profile, so those two frames are drawn where they are.
   */
  #chompSecondsOf(seat: SeatId, alpha: number): number {
    const hippo = hippoOf(this.#state, seat);
    const index = seat === 'p1' ? 0 : 1;
    if (!hippo.chomping || this.#wasMidChomp[index] !== 1) return hippo.chompSeconds;
    const previous = this.#prevChompSeconds[index] ?? hippo.chompSeconds;
    return previous + (hippo.chompSeconds - previous) * alpha;
  }

  /* ------------------------------------------------------------------ drawing */

  #drawPond(renderer: Renderer): void {
    renderer.rect(0, 0, BOARD_WIDTH, POND_TOP, COLOUR_BANK);
    renderer.rect(0, POND_BOTTOM, BOARD_WIDTH, BOARD_HEIGHT - POND_BOTTOM, COLOUR_BANK);
    renderer.rect(
      POND_LEFT,
      POND_TOP,
      POND_RIGHT - POND_LEFT,
      POND_BOTTOM - POND_TOP,
      COLOUR_WATER,
    );

    // The band both hippos can reach, drawn as its own shade of water with a line at each
    // edge. A ball in here can be snapped at from both banks at once — which is the one place
    // in the pond where two chomps can block each other — so the picture says where that is
    // rather than leaving a player to discover it.
    const near = POND_BOTTOM - LUNGE_REACH - CATCH_RADIUS;
    const far = POND_TOP + LUNGE_REACH + CATCH_RADIUS;
    renderer.rect(POND_LEFT, near, POND_RIGHT - POND_LEFT, far - near, COLOUR_WATER_CONTESTED);
    renderer.line(POND_LEFT, near, POND_RIGHT, near, 2, COLOUR_LINE);
    renderer.line(POND_LEFT, far, POND_RIGHT, far, 2, COLOUR_LINE);

    renderer.strokeRect(
      POND_LEFT,
      POND_TOP,
      POND_RIGHT - POND_LEFT,
      POND_BOTTOM - POND_TOP,
      4,
      COLOUR_RIM,
    );
  }

  /**
   * Seconds left, as a bar on each side margin growing out from the middle of the board.
   *
   * One object, shared, and symmetric under the half-turn, so neither player is nearer to it
   * than the other. The clock is the game's own — the shell has no idea this match has one.
   */
  #drawClock(renderer: Renderer): void {
    const share = secondsLeft(this.#state) / MATCH_SECONDS;
    const half = ((POND_BOTTOM - POND_TOP) / 2) * share;
    const mid = BOARD_HEIGHT / 2;
    renderer.rect(10, mid - half, 8, half * 2, COLOUR_CHALK);
    renderer.rect(BOARD_WIDTH - 18, mid - half, 8, half * 2, COLOUR_CHALK);
  }

  #drawBalls(renderer: Renderer, alpha: number): void {
    for (let i = 0; i < this.#state.balls.length; i += 1) {
      const ball = this.#state.balls[i];
      if (ball === undefined) continue;
      // A replacement waiting on a wall is not moving, so it needs no interpolation and would
      // be wrong to interpolate: its previous position is wherever it was eaten.
      const x = ball.live ? this.#ballX(i, ball, alpha) : ball.x;
      const y = ball.live ? this.#ballY(i, ball, alpha) : ball.y;
      if (ball.live) this.#drawLiveBall(renderer, ball, x, y);
      else this.#drawArrivingBall(renderer, ball, x, y);
    }
  }

  /**
   * Rule 7, and in this game it is the whole of the rules rather than a finish on them.
   *
   * The entire scoring rule is "two for your kind, minus one for theirs", so a player who
   * cannot separate the two kinds cannot play at all. **Seat one's ball is round and seat
   * two's is square**, at equal area, and each carries a hollow mark of its own silhouette in
   * the middle. Nothing about telling them apart needs colour; the two seat colours only
   * confirm what the shape has already said.
   */
  #drawLiveBall(renderer: Renderer, ball: Readonly<Ball>, x: number, y: number): void {
    const palette = SEAT_PALETTE[ball.seat];
    if (ball.seat === 'p1') {
      renderer.circle(x, y, BALL_RADIUS, palette.base);
      renderer.strokeCircle(x, y, BALL_RADIUS - 2, 4, palette.deep);
      renderer.strokeCircle(x, y, BALL_RADIUS * 0.42, 4, COLOUR_INK);
    } else {
      const h = BALL_SQUARE_HALF;
      renderer.rect(x - h, y - h, h * 2, h * 2, palette.base);
      renderer.strokeRect(x - h + 2, y - h + 2, (h - 2) * 2, (h - 2) * 2, 4, palette.deep);
      const inner = h * 0.44;
      renderer.strokeRect(x - inner, y - inner, inner * 2, inner * 2, 4, COLOUR_INK);
    }
    if (this.#standoff(ball)) {
      // Both mouths are on it and neither can have it. A double ring, so the reason the ball
      // survived is on the board rather than a mystery.
      renderer.strokeCircle(x, y, BALL_RADIUS + 8, 4, COLOUR_CLASH);
      renderer.strokeCircle(x, y, BALL_RADIUS + 16, 2, COLOUR_CLASH);
    }
  }

  /** A replacement waiting on the wall: outline only, growing. Not in play, and it shows. */
  #drawArrivingBall(renderer: Renderer, ball: Readonly<Ball>, x: number, y: number): void {
    const palette = SEAT_PALETTE[ball.seat];
    const grown = 0.35 + 0.65 * (1 - ball.arriveSeconds / ARRIVE_SECONDS);
    if (ball.seat === 'p1') {
      renderer.strokeCircle(x, y, BALL_RADIUS * grown, 3, palette.soft);
      return;
    }
    const h = BALL_SQUARE_HALF * grown;
    renderer.strokeRect(x - h, y - h, h * 2, h * 2, 3, palette.soft);
  }

  /** True when two chomps committed on the same step are both on this ball. */
  #standoff(ball: Readonly<Ball>): boolean {
    const p1 = this.#state.p1Hippo;
    const p2 = this.#state.p2Hippo;
    if (!mouthOpen(p1) || !mouthOpen(p2)) return false;
    if (resolveSimultaneous(p1.chompAt, p2.chompAt) !== 'draw') return false;
    const y1 = mouthYOf('p1', p1.chompSeconds);
    const y2 = mouthYOf('p2', p2.chompSeconds);
    return reaches(p1.x, y1, y1, ball.x, ball.y) && reaches(p2.x, y2, y2, ball.x, ball.y);
  }

  /**
   * A hippo: a body on its own bank, a neck, and a head at the mouth.
   *
   * Seat one is round throughout — round body, round ears, round head — and seat two is square
   * throughout, the same pair the balls use. So "which of these is mine" is answered by the
   * outline of every object a seat owns, and a greyscale board loses nothing.
   */
  #drawHippo(renderer: Renderer, seat: SeatId, alpha: number): void {
    const hippo: Readonly<Hippo> = hippoOf(this.#state, seat);
    const palette = SEAT_PALETTE[seat];
    const homeY = homeYOf(seat);
    const sign = seat === 'p1' ? -1 : 1;
    const bodyY = homeY - sign * BODY_OFFSET;
    const x = this.#hippoX(seat, alpha);
    const mouthY = mouthYOf(seat, this.#chompSecondsOf(seat, alpha));
    const open = mouthOpen(hippo);

    // Where it is steering, marked on its own bank in its own silhouette.
    if (Math.abs(hippo.targetX - hippo.x) > 1) {
      if (seat === 'p1') renderer.strokeCircle(hippo.targetX, bodyY, 22, 3, palette.soft);
      else renderer.strokeRect(hippo.targetX - 20, bodyY - 20, 40, 40, 3, palette.soft);
    }

    renderer.line(x, bodyY, x, mouthY, 26, palette.deep);

    if (seat === 'p1') {
      renderer.circle(x - 34, bodyY - 34, 16, palette.deep);
      renderer.circle(x + 34, bodyY - 34, 16, palette.deep);
      renderer.circle(x, bodyY, BODY_RADIUS, palette.base);
      renderer.circle(x - 20, bodyY - 16, 8, COLOUR_INK);
      renderer.circle(x + 20, bodyY - 16, 8, COLOUR_INK);
    } else {
      renderer.rect(x - 46, bodyY + 22, 22, 22, palette.deep);
      renderer.rect(x + 24, bodyY + 22, 22, 22, palette.deep);
      const h = BODY_RADIUS * (Math.sqrt(Math.PI) / 2);
      renderer.rect(x - h, bodyY - h, h * 2, h * 2, palette.base);
      renderer.rect(x - 28, bodyY + 8, 16, 16, COLOUR_INK);
      renderer.rect(x + 12, bodyY + 8, 16, 16, COLOUR_INK);
    }

    this.#drawMouth(renderer, seat, x, mouthY, open);
  }

  #drawMouth(renderer: Renderer, seat: SeatId, x: number, y: number, open: boolean): void {
    const palette = SEAT_PALETTE[seat];
    const scale = open ? 1 : 0.72;
    if (seat === 'p1') {
      renderer.circle(x, y, MOUTH_RADIUS * scale, palette.base);
      renderer.strokeCircle(x, y, MOUTH_RADIUS * scale - 2, 4, palette.deep);
      if (open) renderer.circle(x, y, MOUTH_RADIUS * 0.5, COLOUR_INK);
      else renderer.line(x - MOUTH_RADIUS * 0.6, y, x + MOUTH_RADIUS * 0.6, y, 5, COLOUR_INK);
      return;
    }
    const h = MOUTH_SQUARE_HALF * scale;
    renderer.rect(x - h, y - h, h * 2, h * 2, palette.base);
    renderer.strokeRect(x - h + 2, y - h + 2, (h - 2) * 2, (h - 2) * 2, 4, palette.deep);
    if (open) {
      const inner = MOUTH_SQUARE_HALF * 0.5;
      renderer.rect(x - inner, y - inner, inner * 2, inner * 2, COLOUR_INK);
    } else {
      renderer.line(x - h * 0.6, y, x + h * 0.6, y, 5, COLOUR_INK);
    }
  }

  /**
   * What the last chomp was worth, beside the hippo that took it.
   *
   * The only text on the board, and it is feedback rather than a game element: a signed number
   * needs no language and nothing in the pond has to be read to play. It is turned half a turn
   * for the seat sitting opposite, so both players read their own tally the right way up.
   */
  #drawFeedback(renderer: Renderer, seat: SeatId, runtime: SeatRuntime, alpha: number): void {
    if (runtime.gainSteps === 0 || runtime.gain === 0) return;
    const label = gainLabel(runtime.gain);
    if (label === '') return;

    const sign = seat === 'p1' ? 1 : -1;
    let x = this.#hippoX(seat, alpha) + sign * 96;
    if (x < 70) x = 70;
    if (x > BOARD_WIDTH - 70) x = BOARD_WIDTH - 70;
    const y = seat === 'p1' ? POND_BOTTOM + 62 : POND_TOP - 62;

    const rotated = this.#isRotated(seat);
    renderer.pushSeatRotation(rotated);
    const drawX = rotated ? BOARD_WIDTH - x : x;
    const drawY = rotated ? BOARD_HEIGHT - y : y;
    const colour = runtime.gain > 0 ? SEAT_PALETTE[seat].base : COLOUR_CLASH;
    renderer.text(label, drawX, drawY, 44, colour, 'centre');
    renderer.popSeatRotation();
  }
}
