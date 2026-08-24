import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARENA_HALF,
  BALL_RADIUS,
  BASE_RADIUS,
  BEETLE_BUG_TOUCH,
  BEETLE_RADIUS,
  LADYBUG_RADIUS,
  MATCH_SECONDS,
  SEATS,
  TARGET_DELIVERIES,
  baseYOf,
  beetleOf,
  BOT_PROFILES,
  botInput,
  createBotState,
  createGame,
  resetBotState,
  resetGame,
  step,
} from './rules.js';
import type { BotDifficulty, BotState, Phase, Game as Pit } from './rules.js';

/**
 * Dung Battle — the Game contract, the two seats' controls, and the picture.
 *
 * The rules module simulates a pit centred on `(0, 0)` and spanning `[-450, 450]` in both
 * axes. This file is the only place that knows the pit is drawn in an 800 x 800 logical box
 * whose corner is the origin, and the conversion is one addition: `board = sim + ARENA_HALF`.
 * Keeping the corner out of the simulation is what makes a seat's reflection exact — see the
 * note at the top of `rules.ts`.
 */

/** The logical box the manifest declares. The pit fills it exactly. */
export const BOARD = ARENA_HALF * 2;

/** A finger within this of its own beetle is resting on it, not steering it. */
export const POINTER_DEADZONE = 10;

const COLOUR_PIT = '#211710';
const COLOUR_FLOOR = '#3a2a1b';
const COLOUR_GRAIN = 'rgba(255, 238, 210, 0.05)';
const COLOUR_RULE = 'rgba(255, 238, 210, 0.16)';
const COLOUR_CLOCK = 'rgba(255, 238, 210, 0.5)';
const COLOUR_BALL = '#8a6134';
const COLOUR_BALL_RIM = '#5b3d1e';
const COLOUR_BALL_PIT = '#6b4726';
const COLOUR_BUG = '#d24a3d';
const COLOUR_BUG_INK = '#1b1310';
const COLOUR_DANGER = 'rgba(255, 226, 200, 0.22)';
const COLOUR_BELLY = '#e8dcc6';
const COLOUR_INK = '#191009';

/** How many grains of soil the floor is speckled with, laid out on a fixed lattice. */
const GRAIN_ROWS = 7;

export class DungBattleGame implements Game {
  readonly #pit: Pit;
  readonly #driveP1: Vec2 = vec2();
  readonly #driveP2: Vec2 = vec2();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  /**
   * One stream per bot seat, both drawn from the match seed.
   *
   * Not one shared stream: whichever seat is polled first would take the earlier value out
   * of it on every single decision, which is a seat bias made of arithmetic rather than of
   * rules. With a stream each, the order the two seats are polled in is not observable at
   * all — `game.test.ts` asserts that by reversing it and comparing the match bit for bit.
   */
  #botRng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  /** The phase the last step ended in, so a reset is noticed once rather than every step. */
  #wasPhase: Phase = 'kickoff';

  /**
   * The score the shell reads, held rather than built.
   *
   * `getScore` is called every step by the host, and a fresh object each time is an
   * allocation on the frame path for no reason. The same object is rewritten in place, which
   * is what Sumo does and for the same reason.
   */
  readonly #score = { p1: 0, p2: 0, winner: null as SeatId | 'draw' | null };

  /** Previous positions, for the interpolated frame. Allocated once, never per frame. */
  readonly #prevBugX: number[];
  readonly #prevBugY: number[];
  #prevBallX = 0;
  #prevBallY = 0;
  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP2X = 0;
  #prevP2Y = 0;

  constructor() {
    // A generator is needed to deal the bugs before the shell has handed one over; init()
    // deals them again from the match seed the moment it does.
    this.#pit = createGame(new Rng(1));
    this.#prevBugX = this.#pit.bugs.map((bug) => bug.x);
    this.#prevBugY = this.#pit.bugs.map((bug) => bug.y);
  }

  /** Read-only view for the tests and the measurement harness. Never mutate through it. */
  get pit(): Readonly<Pit> {
    return this.#pit;
  }

  init(context: GameContext): void {
    const seed = context.rng;
    // Three independent streams from the one seed the shell gave us: the pit's own, and one
    // per bot seat.
    const pitRng = new Rng(seed.next() | 0);
    this.#botRng = { p1: new Rng(seed.next() | 0), p2: new Rng(seed.next() | 0) };
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#pit, pitRng);
    this.#wasPhase = this.#pit.phase;
    this.#publish();
    this.#syncInterpolation();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#pit.winner !== null) return;

    this.#prevBallX = this.#pit.ball.x;
    this.#prevBallY = this.#pit.ball.y;
    this.#prevP1X = this.#pit.p1.x;
    this.#prevP1Y = this.#pit.p1.y;
    this.#prevP2X = this.#pit.p2.x;
    this.#prevP2Y = this.#pit.p2.y;
    for (let i = 0; i < this.#pit.bugs.length; i += 1) {
      const bug = this.#pit.bugs[i];
      if (bug === undefined) continue;
      this.#prevBugX[i] = bug.x;
      this.#prevBugY[i] = bug.y;
    }

    // Both seats are read before either beetle moves, so neither can act on the other's
    // post-step position.
    this.#steer('p1', this.#driveP1, input, fixedDeltaSeconds);
    this.#steer('p2', this.#driveP2, input, fixedDeltaSeconds);
    step(
      this.#pit,
      fixedDeltaSeconds,
      this.#driveP1.x,
      this.#driveP1.y,
      this.#driveP2.x,
      this.#driveP2.y,
    );
    // A kick-off puts both beetles back on their marks; interpolating from where they were
    // would drag them across the pit on that one frame. Only on the step the phase changes,
    // so the ladybugs — which keep walking through a pause — stay interpolated.
    if (this.#pit.phase === 'kickoff' && this.#wasPhase !== 'kickoff') this.#syncInterpolation();
    this.#wasPhase = this.#pit.phase;
    this.#publish();
  }

  #publish(): void {
    this.#score.p1 = this.#pit.score.p1;
    this.#score.p2 = this.#pit.score.p2;
    this.#score.winner = this.#pit.winner;
  }

  /**
   * One seat's drive direction, from a bot or from whichever instrument that seat is using.
   *
   * The two instruments are the same instrument. A key gives a direction outright; a finger
   * gives a point, and the direction is the way from the beetle to that point — so a finger
   * held straight out to the right of a beetle and the right-hand key produce the identical
   * drive. Neither can move a beetle faster than {@link BEETLE_SPEED}, because both end up
   * in the same `driveBeetle`.
   *
   * A touch belongs to the seat it started in and keeps that ownership across the middle of
   * the device — that is the engine's, and this file does not reimplement it. It is also why
   * the pointer is read as a *direction* rather than as a place to be: the pit is a shared
   * board and neither seat owns the half of the surface its beetle may need to reach.
   */
  #steer(seat: SeatId, out: Vec2, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      botInput(
        out,
        this.#pit,
        seat,
        BOT_PROFILES[difficulty],
        seat === 'p1' ? this.#botP1State : this.#botP2State,
        this.#botRng[seat],
        fixedDeltaSeconds,
      );
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer === null) {
      out.x = seatInput.move.x;
      out.y = seatInput.move.y;
      return;
    }

    const beetle = beetleOf(this.#pit, seat);
    const dx = pointer.x - ARENA_HALF - beetle.x;
    const dy = pointer.y - ARENA_HALF - beetle.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= POINTER_DEADZONE * POINTER_DEADZONE) {
      out.x = 0;
      out.y = 0;
      return;
    }
    const inv = 1 / Math.sqrt(distanceSq);
    out.x = dx * inv;
    out.y = dy * inv;
  }

  /** Never: both beetles run at once, so the shell keeps its two pointer zones. */
  getActiveSeat(): SeatId | null {
    return null;
  }

  getScore(): MatchScore {
    return this.#score;
  }

  // Nothing here is derived from a pointer or a wall clock, so a paused match simply stops
  // being stepped and resumes exactly as it stood.
  onPause(): void {}

  onResume(): void {
    this.#syncInterpolation();
  }

  destroy(): void {
    this.#botP1 = null;
    this.#botP2 = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
  }

  #syncInterpolation(): void {
    this.#prevBallX = this.#pit.ball.x;
    this.#prevBallY = this.#pit.ball.y;
    this.#prevP1X = this.#pit.p1.x;
    this.#prevP1Y = this.#pit.p1.y;
    this.#prevP2X = this.#pit.p2.x;
    this.#prevP2Y = this.#pit.p2.y;
    for (let i = 0; i < this.#pit.bugs.length; i += 1) {
      const bug = this.#pit.bugs[i];
      if (bug === undefined) continue;
      this.#prevBugX[i] = bug.x;
      this.#prevBugY[i] = bug.y;
    }
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_PIT);
    this.#drawFloor(renderer);
    this.#drawBase(renderer, 'p1');
    this.#drawBase(renderer, 'p2');
    this.#drawClock(renderer);

    const ballX = mix(this.#prevBallX, this.#pit.ball.x, alpha) + ARENA_HALF;
    const ballY = mix(this.#prevBallY, this.#pit.ball.y, alpha) + ARENA_HALF;
    this.#drawBall(renderer, ballX, ballY);

    this.#drawBeetle(renderer, 'p2', alpha);
    this.#drawBeetle(renderer, 'p1', alpha);
    this.#drawBugs(renderer, alpha);
    this.#drawPips(renderer);
  }

  #drawFloor(renderer: Renderer): void {
    renderer.rect(0, 0, BOARD, BOARD, COLOUR_FLOOR);
    // A fixed lattice of grains, so the floor has a texture that is the same every frame and
    // in every match. Nothing here is drawn from the generator.
    const spacing = BOARD / (GRAIN_ROWS + 1);
    for (let row = 1; row <= GRAIN_ROWS; row += 1) {
      for (let column = 1; column <= GRAIN_ROWS; column += 1) {
        const offset = row % 2 === 0 ? spacing / 2 : 0;
        renderer.circle(column * spacing + offset - spacing / 2, row * spacing, 5, COLOUR_GRAIN);
      }
    }
  }

  /**
   * A seat's base: a disc on that seat's own wall, patterned differently for each seat.
   *
   * p1's is drawn as concentric rings and p2's as spokes, and each carries its seat's own
   * mark — a disc for p1, a square for p2 — which is the same mark its score pips use. Three
   * signals, only one of them colour, so the board reads in greyscale (rule 7).
   */
  #drawBase(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const x = ARENA_HALF;
    const y = baseYOf(seat) + ARENA_HALF;
    renderer.circle(x, y, BASE_RADIUS, palette.soft);
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, BASE_RADIUS - 22, 4, palette.deep);
      renderer.strokeCircle(x, y, BASE_RADIUS - 52, 4, palette.deep);
      renderer.circle(x, y, 16, palette.base);
    } else {
      for (let spoke = 0; spoke < 6; spoke += 1) {
        const angle = Math.PI + (spoke / 5) * Math.PI;
        renderer.line(
          x + Math.cos(angle) * 26,
          y + Math.sin(angle) * 26,
          x + Math.cos(angle) * (BASE_RADIUS - 12),
          y + Math.sin(angle) * (BASE_RADIUS - 12),
          4,
          palette.deep,
        );
      }
      renderer.rect(x - 15, y - 15, 30, 30, palette.base);
    }
    // Last, and at exactly the radius `deliveryIn` tests: the line that scores is the line
    // the player sees, and nothing drawn afterwards can cover it.
    renderer.strokeCircle(x, y, BASE_RADIUS, 5, palette.base);
  }

  /**
   * How much of the match is left, as a bar on the halfway line that closes in from both
   * ends towards the middle.
   *
   * Symmetric about the centre of the board on purpose: a bar down one edge would be nearer
   * one seat than the other, and this is a shared board that never rotates.
   */
  #drawClock(renderer: Renderer): void {
    renderer.line(0, ARENA_HALF, BOARD, ARENA_HALF, 2, COLOUR_RULE);
    const left = this.#pit.clock / MATCH_SECONDS;
    const half = (BOARD / 2 - 40) * (left < 0 ? 0 : left);
    renderer.line(ARENA_HALF - half, ARENA_HALF, ARENA_HALF + half, ARENA_HALF, 6, COLOUR_CLOCK);
  }

  #drawBall(renderer: Renderer, x: number, y: number): void {
    renderer.circle(x, y, BALL_RADIUS, COLOUR_BALL);
    renderer.strokeCircle(x, y, BALL_RADIUS - 2, 4, COLOUR_BALL_RIM);
    // Five dimples on a fixed pattern: the ball is the one thing on the board neither seat
    // owns, so it carries no seat mark at all and cannot be mistaken for a beetle.
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      renderer.circle(
        x + Math.cos(angle) * (BALL_RADIUS * 0.45),
        y + Math.sin(angle) * (BALL_RADIUS * 0.45),
        6,
        COLOUR_BALL_PIT,
      );
    }
    renderer.circle(x, y, 7, COLOUR_BALL_PIT);
  }

  /**
   * A beetle: p1 wears one stripe across its shell and p2 wears two, so the seats differ by
   * a count as well as by colour. Flipped, it is drawn belly-up with its legs in the air —
   * a different silhouette rather than a different shade.
   */
  #drawBeetle(renderer: Renderer, seat: SeatId, alpha: number): void {
    const beetle = beetleOf(this.#pit, seat);
    const palette = SEAT_PALETTE[seat];
    const x = mix(seat === 'p1' ? this.#prevP1X : this.#prevP2X, beetle.x, alpha) + ARENA_HALF;
    const y = mix(seat === 'p1' ? this.#prevP1Y : this.#prevP2Y, beetle.y, alpha) + ARENA_HALF;
    const faceX = beetle.faceX;
    const faceY = beetle.faceY;
    const flipped = beetle.stun > 0;
    const stripes = seat === 'p1' ? 1 : 2;

    // Six legs, out along the sides. Up in the air when the beetle is on its back.
    const legLength = flipped ? BEETLE_RADIUS + 16 : BEETLE_RADIUS + 9;
    for (let leg = 0; leg < 6; leg += 1) {
      const spread = (leg < 3 ? leg - 1 : leg - 4) * 0.55;
      const side = leg < 3 ? 1 : -1;
      const dirX = -faceY * side + faceX * spread;
      const dirY = faceX * side + faceY * spread;
      const length = Math.hypot(dirX, dirY) || 1;
      renderer.line(
        x + (dirX / length) * (BEETLE_RADIUS - 6),
        y + (dirY / length) * (BEETLE_RADIUS - 6),
        x + (dirX / length) * legLength,
        y + (dirY / length) * legLength,
        4,
        COLOUR_INK,
      );
    }

    renderer.circle(x, y, BEETLE_RADIUS, flipped ? COLOUR_BELLY : palette.base);
    if (flipped) {
      renderer.strokeCircle(x, y, BEETLE_RADIUS - 9, 4, palette.deep);
    } else {
      renderer.circle(
        x + faceX * (BEETLE_RADIUS - 4),
        y + faceY * (BEETLE_RADIUS - 4),
        13,
        COLOUR_INK,
      );
    }
    // The stripes run across the shell, whichever way up it is, and always in the seat's
    // own deep colour — one for p1 and two for p2, so the seats differ by a count as well
    // as by a hue (rule 7). `game.test.ts` counts them.
    for (let stripe = 0; stripe < stripes; stripe += 1) {
      const offset = stripes === 1 ? 0 : (stripe === 0 ? -1 : 1) * 12;
      const alongX = faceX * offset;
      const alongY = faceY * offset;
      const reach = Math.sqrt(Math.max(1, BEETLE_RADIUS * BEETLE_RADIUS - offset * offset)) - 6;
      renderer.line(
        x + alongX - faceY * reach,
        y + alongY + faceX * reach,
        x + alongX + faceY * reach,
        y + alongY - faceX * reach,
        4,
        palette.deep,
      );
    }
  }

  /**
   * The ladybugs, and the ring that says how close is too close.
   *
   * The rings are drawn after every bug body so that no bug can cover another's, and at
   * exactly the distance `flipCaught` tests — the same rule as the base rims.
   */
  #drawBugs(renderer: Renderer, alpha: number): void {
    for (let i = 0; i < this.#pit.bugs.length; i += 1) {
      const bug = this.#pit.bugs[i];
      if (bug === undefined) continue;
      const x = mix(this.#prevBugX[i] ?? bug.x, bug.x, alpha) + ARENA_HALF;
      const y = mix(this.#prevBugY[i] ?? bug.y, bug.y, alpha) + ARENA_HALF;
      renderer.circle(x, y, LADYBUG_RADIUS, COLOUR_BUG);
      // The wing split, along the way it is walking, plus four spots. A ladybug is the only
      // spotted thing in the pit and the only thing with a black head.
      renderer.line(
        x - bug.hx * LADYBUG_RADIUS,
        y - bug.hy * LADYBUG_RADIUS,
        x + bug.hx * LADYBUG_RADIUS * 0.3,
        y + bug.hy * LADYBUG_RADIUS * 0.3,
        3,
        COLOUR_BUG_INK,
      );
      for (let spot = 0; spot < 4; spot += 1) {
        const along = spot < 2 ? -0.3 : -0.75;
        const across = spot % 2 === 0 ? 0.45 : -0.45;
        renderer.circle(
          x + bug.hx * LADYBUG_RADIUS * along - bug.hy * LADYBUG_RADIUS * across,
          y + bug.hy * LADYBUG_RADIUS * along + bug.hx * LADYBUG_RADIUS * across,
          4,
          COLOUR_BUG_INK,
        );
      }
      renderer.circle(
        x + bug.hx * LADYBUG_RADIUS * 0.72,
        y + bug.hy * LADYBUG_RADIUS * 0.72,
        LADYBUG_RADIUS * 0.55,
        COLOUR_BUG_INK,
      );
    }
    for (const bug of this.#pit.bugs) {
      renderer.strokeCircle(
        bug.x + ARENA_HALF,
        bug.y + ARENA_HALF,
        BEETLE_BUG_TOUCH,
        2,
        COLOUR_DANGER,
      );
    }
  }

  /** Deliveries so far, as pips in each seat's own corner: discs for p1, blocks for p2. */
  #drawPips(renderer: Renderer): void {
    // SEATS is a module constant in rules.ts: a literal here would allocate an array on
    // every frame, and the rule about not allocating on a hot path does not stop at update.
    for (const seat of SEATS) {
      const palette = SEAT_PALETTE[seat];
      const scored = seat === 'p1' ? this.#pit.score.p1 : this.#pit.score.p2;
      const y = seat === 'p1' ? BOARD - 34 : 34;
      for (let i = 0; i < TARGET_DELIVERIES; i += 1) {
        const offset = 34 + i * 46;
        const x = seat === 'p1' ? offset : BOARD - offset;
        const filled = i < scored;
        if (seat === 'p1') renderer.circle(x, y, 15, filled ? palette.base : COLOUR_RULE);
        else renderer.rect(x - 14, y - 14, 28, 28, filled ? palette.base : COLOUR_RULE);
      }
    }
  }
}

function mix(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}
