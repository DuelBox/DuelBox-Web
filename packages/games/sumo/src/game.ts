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
import type { Arena, BotDifficulty, Wrestler } from './rules.js';
import {
  START_RADIUS,
  WRESTLER_RADIUS,
  botInput,
  collideWrestlers,
  createArena,
  createWrestler,
  isOut,
  shrinkArena,
  stepWrestler,
} from './rules.js';

/** Ring-outs that win a match. */
export const RING_OUT_TARGET = 3;

/** Length of the pause after a ring-out, counted in simulation steps rather than seconds. */
export const RESET_STEPS = 66;

/**
 * How far from the middle each wrestler starts. Further out than the ring's minimum
 * radius, so a bout in which neither seat ever moves is ended by the closing ring rather
 * than running for ever.
 */
const START_OFFSET = 150;

/** Half-width of the spread on the starting axis, in radians. */
const START_SPREAD = 0.35;

/** A pointer inside this distance is a tap on the wrestler, not a direction to drive in. */
const POINTER_DEADZONE = 8;

/** Straight down the device in logical space, i.e. towards p1's side. */
const QUARTER_TURN = Math.PI / 2;

const COLOUR_SURROUND = '#101722';
const COLOUR_CLAY = '#b98b4e';
const COLOUR_EDGE = '#f2e6d0';
const COLOUR_START = 'rgba(242, 230, 208, 0.16)';
const COLOUR_LIMIT = 'rgba(242, 230, 208, 0.26)';
const COLOUR_COUNTDOWN = 'rgba(242, 230, 208, 0.45)';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_INK = '#0b1220';

const EDGE_WIDTH = 6;
const BELT_WIDTH = 4;
const BELT_INSET = 10;
const BELT_GAP = 11;
const COUNTDOWN_MIN = 20;
const COUNTDOWN_SPAN = 60;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class SumoPushGame implements Game {
  readonly #arena: Arena = createArena();
  readonly #p1: Wrestler = createWrestler(0, 0);
  readonly #p2: Wrestler = createWrestler(0, 0);
  readonly #driveP1: Vec2 = vec2();
  readonly #driveP2: Vec2 = vec2();
  readonly #condition: WinCondition = { kind: 'first-to', target: RING_OUT_TARGET };
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #context: GameContext | null = null;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #resetSteps = 0;
  #regrowFrom = START_RADIUS;

  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP2X = 0;
  #prevP2Y = 0;
  #prevRadius = START_RADIUS;

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  wrestler(seat: SeatId): Readonly<Wrestler> {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  get ring(): Readonly<Arena> {
    return this.#arena;
  }

  /** Steps left before the next bout starts, or 0 while one is being fought. */
  get resetCountdown(): number {
    return this.#resetSteps;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#arena.radius = START_RADIUS;
    this.#regrowFrom = START_RADIUS;
    this.#resetSteps = RESET_STEPS;
    this.#place(context.rng);
    this.#syncInterpolation();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#score.winner !== null) return;

    this.#prevP1X = this.#p1.x;
    this.#prevP1Y = this.#p1.y;
    this.#prevP2X = this.#p2.x;
    this.#prevP2Y = this.#p2.y;
    this.#prevRadius = this.#arena.radius;

    const rng = context.rng;

    if (this.#resetSteps > 0) {
      this.#resetSteps -= 1;
      const grown = (RESET_STEPS - this.#resetSteps) / RESET_STEPS;
      // Written as a weighted sum rather than from + (to - from) * t so the last step of
      // the countdown lands on START_RADIUS exactly, whatever the ring shrank to.
      this.#arena.radius = this.#regrowFrom * (1 - grown) + START_RADIUS * grown;
      return;
    }

    // Both seats are read before either moves, so neither ever acts on the other's
    // post-step position.
    this.#steer('p1', this.#p1, this.#p2, this.#botP1, this.#driveP1, input, rng);
    this.#steer('p2', this.#p2, this.#p1, this.#botP2, this.#driveP2, input, rng);

    stepWrestler(this.#p1, this.#driveP1.x, this.#driveP1.y, this.#arena, fixedDeltaSeconds);
    stepWrestler(this.#p2, this.#driveP2.x, this.#driveP2.y, this.#arena, fixedDeltaSeconds);
    collideWrestlers(this.#p1, this.#p2);
    shrinkArena(this.#arena, fixedDeltaSeconds);

    const outP1 = isOut(this.#p1, this.#arena);
    const outP2 = isOut(this.#p2, this.#arena);
    if (!outP1 && !outP2) return;

    // A double ring-out counts for both seats, so a genuinely simultaneous fall resolves
    // as a draw rather than as a win for whichever seat happened to be tested first.
    if (outP2) this.#score.p1 += 1;
    if (outP1) this.#score.p2 += 1;
    this.#score.winner = resolve(this.#condition, this.#score);
    // A decided match keeps the losing wrestler where it fell, so the last frame shows
    // how the bout ended instead of a tidied-up ring.
    if (this.#score.winner === null) this.#beginReset(rng);
  }

  render(renderer: Renderer, alpha: number): void {
    const arena = this.#arena;
    const centreX = arena.centreX;
    const centreY = arena.centreY;
    const radius = this.#prevRadius + (arena.radius - this.#prevRadius) * alpha;

    renderer.clear(COLOUR_SURROUND);
    renderer.strokeCircle(centreX, centreY, START_RADIUS, 3, COLOUR_START);
    renderer.circle(centreX, centreY, radius, COLOUR_CLAY);
    renderer.strokeCircle(centreX, centreY, arena.minRadius, 2, COLOUR_LIMIT);

    if (this.#resetSteps > 0) {
      const remaining = this.#resetSteps / RESET_STEPS;
      renderer.strokeCircle(
        centreX,
        centreY,
        COUNTDOWN_MIN + COUNTDOWN_SPAN * remaining,
        4,
        COLOUR_COUNTDOWN,
      );
    }

    this.#drawWrestler(
      renderer,
      this.#prevP2X + (this.#p2.x - this.#prevP2X) * alpha,
      this.#prevP2Y + (this.#p2.y - this.#prevP2Y) * alpha,
      COLOUR_P2,
      2,
    );
    this.#drawWrestler(
      renderer,
      this.#prevP1X + (this.#p1.x - this.#prevP1X) * alpha,
      this.#prevP1Y + (this.#p1.y - this.#prevP1Y) * alpha,
      COLOUR_P1,
      1,
    );

    // Last, and at exactly the radius isOut() tests: the losing line is the line the
    // player sees, and by the end of a bout the ring is narrower than a wrestler, so a
    // disc drawn over it must never be able to hide it.
    renderer.strokeCircle(centreX, centreY, radius, EDGE_WIDTH, COLOUR_EDGE);
  }

  // Momentum here is state of its own rather than something derived from the pointer, so
  // a paused match simply stops being stepped and resumes exactly as it stood.
  onPause(): void {}

  onResume(): void {
    this.#syncInterpolation();
  }

  getScore(): MatchScore {
    return this.#score;
  }

  destroy(): void {
    this.#context = null;
    this.#botP1 = null;
    this.#botP2 = null;
  }

  #beginReset(rng: Rng): void {
    this.#regrowFrom = this.#arena.radius;
    this.#resetSteps = RESET_STEPS;
    this.#place(rng);
    // Interpolation must not drag a wrestler across the ring on the reset frame.
    this.#syncInterpolation();
  }

  /**
   * Both seats are placed on one diameter from a single draw, so however the spread
   * falls neither seat starts nearer the edge than the other.
   */
  #place(rng: Rng): void {
    const angle = QUARTER_TURN + (rng.float() * 2 - 1) * START_SPREAD;
    const offsetX = Math.cos(angle) * START_OFFSET;
    const offsetY = Math.sin(angle) * START_OFFSET;
    const p1 = this.#p1;
    // y grows downwards, so the +offset seat starts on p1's side of the device.
    p1.x = this.#arena.centreX + offsetX;
    p1.y = this.#arena.centreY + offsetY;
    p1.vx = 0;
    p1.vy = 0;
    const p2 = this.#p2;
    p2.x = this.#arena.centreX - offsetX;
    p2.y = this.#arena.centreY - offsetY;
    p2.vx = 0;
    p2.vy = 0;
  }

  #steer(
    seat: SeatId,
    self: Wrestler,
    other: Wrestler,
    difficulty: BotDifficulty | null,
    out: Vec2,
    input: InputState,
    rng: Rng,
  ): void {
    if (difficulty !== null) {
      botInput(out, self, other, this.#arena, difficulty, rng);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer === null) {
      out.x = seatInput.move.x;
      out.y = seatInput.move.y;
      return;
    }

    const dx = pointer.x - self.x;
    const dy = pointer.y - self.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= POINTER_DEADZONE * POINTER_DEADZONE) {
      out.x = 0;
      out.y = 0;
      return;
    }
    const inv = 1 / Math.sqrt(distSq);
    out.x = dx * inv;
    out.y = dy * inv;
  }

  #syncInterpolation(): void {
    this.#prevP1X = this.#p1.x;
    this.#prevP1Y = this.#p1.y;
    this.#prevP2X = this.#p2.x;
    this.#prevP2Y = this.#p2.y;
    this.#prevRadius = this.#arena.radius;
  }

  /**
   * p1 wears one belt and p2 two, so the seats are told apart by the count of rings on
   * the disc and not by colour alone.
   */
  #drawWrestler(renderer: Renderer, x: number, y: number, colour: string, belts: number): void {
    renderer.circle(x, y, WRESTLER_RADIUS, colour);
    for (let i = 0; i < belts; i += 1) {
      const belt = WRESTLER_RADIUS - BELT_INSET - i * BELT_GAP;
      renderer.strokeCircle(x, y, belt, BELT_WIDTH, COLOUR_INK);
    }
  }
}
