import { SEAT_PALETTE } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  WinCondition,
} from '@duelbox/game-sdk';
import type { Ball, BotDifficulty, BotMemory, FlipperSide } from './rules.js';
import {
  BALL_RADIUS,
  BUMPERS,
  CENTRE_X,
  CENTRE_Y,
  FLIPPER_COUNT,
  FLIPPER_LENGTH,
  FLIPPER_RADIUS,
  GOAL_HALF_WIDTH,
  SERVE_SPREAD,
  SUBSTEPS,
  TABLE,
  WALLS,
  ballLost,
  botFlipperSide,
  clampBallSpeed,
  collideBallBumper,
  collideBallFlipper,
  collideBallWall,
  createBall,
  createBotMemory,
  flipperIndex,
  flipperPivotX,
  flipperPivotY,
  flipperSeatOf,
  flipperSideOf,
  flipperTipX,
  flipperTipY,
  goalScored,
  launchServe,
  nextFlipperPhase,
  flipperPhaseRate,
  placeServe,
  stepBall,
  wantsFlipper,
} from './rules.js';

/** Goals that win a match. */
export const GOAL_TARGET = 5;

/**
 * The longest a match can run, in seconds. Most goals at the whistle, drawn if level.
 *
 * First to five is the rule and this is the backstop, not a redesign. `roundSeconds` ends
 * nothing — it is validated by the manifest schema and read only by the catalogue card that
 * prints "about a minute" — so every game guarantees its own termination and this is how
 * this one does. The clock is decremented on **every** step, serve countdowns included, so
 * the arithmetic is exact rather than an estimate: 100 s is 6000 steps at 60 Hz against the
 * termination guard's ceiling of 36 000, a margin of six. Measured over 1080 bot matches the
 * worst match actually seen was 6001 steps, which is that bound rather than an estimate of it.
 */
export const MATCH_SECONDS = 100;

/** Length of the pause before a serve, counted in simulation steps rather than seconds. */
export const SERVE_STEPS = 45;

/**
 * Steps without the ball touching a bumper or a flipper before it is re-served, no score.
 *
 * **Counted on contact rather than on goals, and the difference is the whole rule.** The
 * first version re-served after twenty seconds without a goal, which is a plausible-looking
 * number and a wrong one: two `hard` bots defend nearly everything and genuinely go
 * forty seconds between goals, so the stalemate rule was firing two and a half times a match
 * on rallies that were not stalled at all — it was interrupting the best play in the game.
 *
 * What a stalled ball actually looks like is a ball bouncing between two flat walls and
 * meeting nothing: every real path on this table hits a bumper or a flipper within a second
 * or two, and a rail-to-rail orbit hits neither, ever. Six seconds of touching nothing is a
 * position an orbit reaches immediately and a rally reaches about once in seventy matches: it
 * fired 15 times across the 1080 bot matches SPEC.md reports, and never twice in one match.
 */
export const IDLE_STEPS = 60 * 6;

/** Steps a bumper stays lit after it is struck. */
export const FLASH_STEPS = 12;

const COLOUR_TABLE = '#0a1020';
const COLOUR_WALL = '#93a4c6';
const COLOUR_WALL_SOFT = 'rgba(147, 164, 198, 0.28)';
const COLOUR_BUMPER = '#f2c14e';
const COLOUR_BUMPER_LIT = '#fff6d8';
const COLOUR_BALL = '#eef4ff';
const COLOUR_INK = '#0b1220';
const COLOUR_LINE = 'rgba(233, 240, 252, 0.5)';
const COLOUR_LINE_SOFT = 'rgba(233, 240, 252, 0.18)';

/** Passed to resolve() at the whistle. Module scope, so a step allocates nothing. */
const TIME_EXPIRED = { timeExpired: true } as const;

const RAIL = 10;
const MOUTH_DEPTH = 26;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

/** Where the ball was at the end of the previous step, for render interpolation only. */
interface Ghost {
  x: number;
  y: number;
}

export class PinballDuelGame implements Game {
  readonly #ball: Ball = createBall();
  readonly #ghost: Ghost = { x: CENTRE_X, y: CENTRE_Y };
  /** 0 at rest, 1 fully raised, indexed by `flipperIndex`. */
  readonly #phase = new Float64Array(FLIPPER_COUNT);
  readonly #prevPhase = new Float64Array(FLIPPER_COUNT);
  /** The phase rate the current substep actually travelled at, for the surface velocity. */
  readonly #rate = new Float64Array(FLIPPER_COUNT);
  /** Whether each flipper's driver is asking for it this step. */
  readonly #want = new Uint8Array(FLIPPER_COUNT);
  readonly #flash = new Int16Array(BUMPERS.length);
  readonly #memoryP1: BotMemory = createBotMemory();
  readonly #memoryP2: BotMemory = createBotMemory();
  readonly #condition: WinCondition = { kind: 'first-to', target: GOAL_TARGET };
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #context: GameContext | null = null;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #serveCountdown = SERVE_STEPS;
  #serveTarget: SeatId = 'p1';
  #clock = MATCH_SECONDS;
  #idleSteps = 0;
  #stallResets = 0;

  /** Seconds left before the whistle. Exposed so tests reach it without playing it out. */
  get clock(): number {
    return this.#clock;
  }

  set clock(seconds: number) {
    this.#clock = seconds;
  }

  /** Read-only view for the balance harness and tests. Never mutate through it. */
  get ball(): Readonly<Ball> {
    return this.#ball;
  }

  /** Steps left before the ball is launched, or 0 while play is live. */
  get serveCountdown(): number {
    return this.#serveCountdown;
  }

  /** The seat the next serve is aimed at. Alternates, so neither seat receives more. */
  get serveTarget(): SeatId {
    return this.#serveTarget;
  }

  /** How many times a stalled ball has been re-served. A healthy match reports zero. */
  get stallResets(): number {
    return this.#stallResets;
  }

  /** Steps the ball has gone without touching a bumper or a flipper. */
  get idleSteps(): number {
    return this.#idleSteps;
  }

  /** 0 at rest, 1 fully raised. */
  phase(seat: SeatId, side: FlipperSide): number {
    return this.#phase[flipperIndex(seat, side)] ?? 0;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#clock = MATCH_SECONDS;
    this.#stallResets = 0;
    for (let i = 0; i < FLIPPER_COUNT; i += 1) {
      this.#phase[i] = 0;
      this.#prevPhase[i] = 0;
      this.#rate[i] = 0;
      this.#want[i] = 0;
    }
    for (let i = 0; i < BUMPERS.length; i += 1) this.#flash[i] = 0;
    this.#memoryP1.noise = 0;
    this.#memoryP1.drift = 0;
    this.#memoryP1.approaching = false;
    this.#memoryP2.noise = 0;
    this.#memoryP2.drift = 0;
    this.#memoryP2.approaching = false;
    // Which end the first serve is aimed at is the one thing about a serve that is not
    // fixed by the mirror, so it is drawn from the seeded stream and then simply alternates.
    this.#serveTarget = context.rng.bool() ? 'p1' : 'p2';
    this.#serve(this.#serveTarget);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#score.winner !== null) return;

    this.#clock = Math.max(0, this.#clock - fixedDeltaSeconds);
    this.#ghost.x = this.#ball.x;
    this.#ghost.y = this.#ball.y;
    for (let i = 0; i < FLIPPER_COUNT; i += 1) this.#prevPhase[i] = this.#phase[i] ?? 0;
    for (let i = 0; i < BUMPERS.length; i += 1) {
      const left = this.#flash[i] ?? 0;
      if (left > 0) this.#flash[i] = left - 1;
    }

    const rng = context.rng;
    this.#driveSeat('p1', this.#botP1, this.#memoryP1, input, rng);
    this.#driveSeat('p2', this.#botP2, this.#memoryP2, input, rng);

    const live = this.#serveCountdown === 0;
    const sub = fixedDeltaSeconds / SUBSTEPS;
    let touched = false;
    for (let pass = 0; pass < SUBSTEPS; pass += 1) {
      this.#advanceFlippers(sub);
      if (!live) continue;
      stepBall(this.#ball, sub);
      if (this.#resolveContacts()) touched = true;
      clampBallSpeed(this.#ball);
    }

    let scored = false;
    if (live) {
      const goal = goalScored(this.#ball);
      if (goal !== 'none') {
        this.#award(goal);
        scored = true;
        // The next serve is aimed at the other end from the last one, whoever scored: the
        // ball is a turn at attacking as much as a thing to defend, so alternating is the
        // only division of it that cannot accumulate in one seat's favour.
        this.#serve(this.#serveTarget === 'p1' ? 'p2' : 'p1');
      } else if (ballLost(this.#ball)) {
        this.#stallResets += 1;
        this.#serve(this.#serveTarget === 'p1' ? 'p2' : 'p1');
      } else {
        this.#idleSteps = touched ? 0 : this.#idleSteps + 1;
        if (this.#idleSteps >= IDLE_STEPS) {
          this.#stallResets += 1;
          this.#serve(this.#serveTarget === 'p1' ? 'p2' : 'p1');
        }
      }
    } else {
      this.#serveCountdown -= 1;
      if (this.#serveCountdown === 0) {
        launchServe(this.#ball, this.#serveTarget, (rng.float() * 2 - 1) * SERVE_SPREAD);
      }
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
    renderer.clear(COLOUR_TABLE);
    this.#drawClock(renderer);
    this.#drawMouths(renderer);
    this.#drawWalls(renderer);
    this.#drawBumpers(renderer);
    this.#drawFlippers(renderer, alpha);
    this.#drawBall(renderer, alpha);
  }

  onPause(): void {
    // Nothing carries momentum across a pause: a flipper is a position and the ball is held
    // by the simulation rather than by whatever a finger happened to be doing.
    this.#settle();
  }

  onResume(): void {
    // The ghosts are where the renderer interpolates from, so a pause must not be drawn as a
    // smear across the table on the first frame back.
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

  #award(seat: SeatId): void {
    if (seat === 'p1') this.#score.p1 += 1;
    else this.#score.p2 += 1;
  }

  #serve(target: SeatId): void {
    this.#serveTarget = target;
    placeServe(this.#ball, target);
    this.#serveCountdown = SERVE_STEPS;
    this.#idleSteps = 0;
    this.#settle();
  }

  #settle(): void {
    this.#ghost.x = this.#ball.x;
    this.#ghost.y = this.#ball.y;
    for (let i = 0; i < FLIPPER_COUNT; i += 1) this.#prevPhase[i] = this.#phase[i] ?? 0;
  }

  /**
   * Decide what one seat's two flippers are being asked for this step.
   *
   * A bot and a person write into the same two slots and the simulation cannot tell them
   * apart afterwards: the bot has no way to move a flipper faster, hold two at once, or
   * reach a position a person's key cannot (rule 6).
   */
  #driveSeat(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    memory: BotMemory,
    input: InputState,
    rng: Rng,
  ): void {
    const left = flipperIndex(seat, 'left');
    const right = flipperIndex(seat, 'right');
    if (difficulty !== null) {
      const side = botFlipperSide(this.#ball, seat, difficulty, memory, rng);
      this.#want[left] = side === 'left' ? 1 : 0;
      this.#want[right] = side === 'right' ? 1 : 0;
      return;
    }
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    const pointerX = pointer !== null ? pointer.x : null;
    const moveX = seatInput.move.x;
    this.#want[left] = wantsFlipper('left', moveX, pointerX) ? 1 : 0;
    this.#want[right] = wantsFlipper('right', moveX, pointerX) ? 1 : 0;
  }

  #advanceFlippers(dt: number): void {
    for (let i = 0; i < FLIPPER_COUNT; i += 1) {
      const phase = this.#phase[i] ?? 0;
      const next = nextFlipperPhase(phase, this.#want[i] === 1, dt);
      this.#rate[i] = flipperPhaseRate(phase, next, dt);
      this.#phase[i] = next;
    }
  }

  /**
   * Walls, then bumpers, then flippers: the moving body has the last word on the ball.
   *
   * Reports whether the ball met a bumper or a flipper — a wall does not count, because a
   * ball meeting nothing but walls is exactly the stalled position {@link IDLE_STEPS} exists
   * to end.
   */
  #resolveContacts(): boolean {
    for (let i = 0; i < WALLS.length; i += 1) {
      const wall = WALLS[i];
      if (wall === undefined) continue;
      collideBallWall(this.#ball, wall);
    }
    let touched = false;
    for (let i = 0; i < BUMPERS.length; i += 1) {
      const bumper = BUMPERS[i];
      if (bumper === undefined) continue;
      if (collideBallBumper(this.#ball, bumper)) {
        this.#flash[i] = FLASH_STEPS;
        touched = true;
      }
    }
    for (let i = 0; i < FLIPPER_COUNT; i += 1) {
      const met = collideBallFlipper(
        this.#ball,
        flipperSeatOf(i),
        flipperSideOf(i),
        this.#phase[i] ?? 0,
        this.#rate[i] ?? 0,
      );
      if (met) touched = true;
    }
    return touched;
  }

  /**
   * The backstop clock, as a pair of bars filling from the halfway line outwards.
   *
   * Two of them, one on each rail, because one bar down one edge is nearer to one player
   * than the other — and a rule one seat reads more easily than the other is not the same
   * rule for both. The idea is Brick Blast's; the reason is the same one.
   */
  #drawClock(renderer: Renderer): void {
    const left = Math.max(0, Math.min(1, this.#clock / MATCH_SECONDS));
    const span = (TABLE.height - 40) * left;
    const top = CENTRE_Y - span / 2;
    renderer.rect(RAIL - 6, 20, 4, TABLE.height - 40, COLOUR_LINE_SOFT);
    renderer.rect(TABLE.width - RAIL + 2, 20, 4, TABLE.height - 40, COLOUR_LINE_SOFT);
    renderer.rect(RAIL - 6, top, 4, span, COLOUR_LINE);
    renderer.rect(TABLE.width - RAIL + 2, top, 4, span, COLOUR_LINE);
  }

  /**
   * The two mouths, each in its defender's colour and each carrying its defender's pips —
   * one for p1 and two for p2, so the ends stay apart with the colour taken away (rule 7).
   */
  #drawMouths(renderer: Renderer): void {
    this.#drawMouth(renderer, 'p1', 1);
    this.#drawMouth(renderer, 'p2', 2);
  }

  #drawMouth(renderer: Renderer, seat: SeatId, pips: number): void {
    const palette = SEAT_PALETTE[seat];
    const width = GOAL_HALF_WIDTH * 2;
    const y = seat === 'p1' ? TABLE.height - MOUTH_DEPTH : 0;
    renderer.rect(CENTRE_X - GOAL_HALF_WIDTH, y, width, MOUTH_DEPTH, palette.soft);
    const line = seat === 'p1' ? TABLE.height - 3 : 3;
    renderer.rect(CENTRE_X - GOAL_HALF_WIDTH, line - 3, width, 6, palette.base);
    const pipY = seat === 'p1' ? TABLE.height - MOUTH_DEPTH / 2 : MOUTH_DEPTH / 2;
    for (let i = 0; i < pips; i += 1) {
      renderer.circle(CENTRE_X + (i - (pips - 1) / 2) * 22, pipY, 5, palette.base);
    }
  }

  #drawWalls(renderer: Renderer): void {
    for (let i = 0; i < WALLS.length; i += 1) {
      const wall = WALLS[i];
      if (wall === undefined) continue;
      renderer.line(wall.x1, wall.y1, wall.x2, wall.y2, 6, COLOUR_WALL);
    }
    renderer.line(0, CENTRE_Y, TABLE.width, CENTRE_Y, 2, COLOUR_WALL_SOFT);
  }

  #drawBumpers(renderer: Renderer): void {
    for (let i = 0; i < BUMPERS.length; i += 1) {
      const bumper = BUMPERS[i];
      if (bumper === undefined) continue;
      const lit = (this.#flash[i] ?? 0) > 0;
      renderer.circle(bumper.x, bumper.y, bumper.radius, lit ? COLOUR_BUMPER_LIT : COLOUR_BUMPER);
      renderer.strokeCircle(bumper.x, bumper.y, bumper.radius - 5, 3, COLOUR_INK);
      renderer.circle(bumper.x, bumper.y, 4, COLOUR_INK);
    }
  }

  #drawFlippers(renderer: Renderer, alpha: number): void {
    for (let i = 0; i < FLIPPER_COUNT; i += 1) {
      const seat = flipperSeatOf(i);
      const side = flipperSideOf(i);
      const from = this.#prevPhase[i] ?? 0;
      const to = this.#phase[i] ?? 0;
      const phase = from + (to - from) * alpha;
      const pivotX = flipperPivotX(side);
      const pivotY = flipperPivotY(seat);
      const tipX = flipperTipX(side, phase);
      const tipY = flipperTipY(seat, phase);
      const palette = SEAT_PALETTE[seat];
      renderer.line(pivotX, pivotY, tipX, tipY, FLIPPER_RADIUS * 2, palette.base);
      renderer.circle(pivotX, pivotY, FLIPPER_RADIUS + 3, palette.deep);
      renderer.circle(tipX, tipY, FLIPPER_RADIUS - 2, COLOUR_INK);
      // One notch on p1's flippers, two on p2's: the same count as its mouth carries.
      const pips = seat === 'p1' ? 1 : 2;
      for (let pip = 0; pip < pips; pip += 1) {
        const at = (0.42 + pip * 0.22) * FLIPPER_LENGTH;
        const t = at / FLIPPER_LENGTH;
        renderer.circle(pivotX + (tipX - pivotX) * t, pivotY + (tipY - pivotY) * t, 3, COLOUR_INK);
      }
    }
  }

  #drawBall(renderer: Renderer, alpha: number): void {
    const x = this.#ghost.x + (this.#ball.x - this.#ghost.x) * alpha;
    const y = this.#ghost.y + (this.#ball.y - this.#ghost.y) * alpha;
    if (this.#serveCountdown > 0) {
      const remaining = this.#serveCountdown / SERVE_STEPS;
      renderer.strokeCircle(x, y, BALL_RADIUS + 42 * remaining, 3, COLOUR_LINE_SOFT);
    }
    renderer.circle(x, y, BALL_RADIUS, COLOUR_BALL);
    renderer.strokeCircle(x, y, BALL_RADIUS - 5, 3, COLOUR_INK);
  }
}
