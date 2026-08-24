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
import type { BotDifficulty, Bowl, RoundPoints, Spinner, SpringStep } from './rules.js';
import {
  POINTS_TO_WIN,
  SPIN_FULL,
  SPINNER_RADIUS,
  botInput,
  collideSpinners,
  createBowl,
  createRoundPoints,
  createSpinner,
  createSpringStep,
  scoreRound,
  solveSpring,
  stepSpinner,
  wearSpin,
} from './rules.js';

/** Length of the pause between rounds, counted in simulation steps rather than seconds. */
export const RESET_STEPS = 66;

/**
 * How far from the middle each top is launched, at the nearest and furthest.
 *
 * Well inside the crest, and far enough out that the dish pulls the pair together into a
 * clash within the first second whether or not anybody touches the screen.
 *
 * A BAND rather than one distance, drawn per round. The bowl is a circle and every rule in
 * it is the same in every direction, so a launch that only varied the angle produced the
 * same round rotated: forty seeded bot matches finished within four steps of each other and
 * a tournament of them would have been one match played forty times. Varying how far out
 * the pair start varies the speed of the first clash, which is what actually makes one round
 * different from the next. Both tops still start at the same distance as each other — that
 * part is fairness and is not up for variation.
 */
const START_OFFSET_NEAR = 130;
const START_OFFSET_FAR = 225;

/** Half-width of the spread on the launching axis, in radians. */
const START_SPREAD = 0.35;

/** A pointer inside this distance is a tap on the top, not a direction to drive in. */
const POINTER_DEADZONE = 8;

/** Straight down the device in logical space, i.e. towards p1's side. */
const QUARTER_TURN = Math.PI / 2;

const TAU = Math.PI * 2;

/** Blades a top carries, so the two seats differ by a count and not by colour alone. */
const P1_BLADES = 3;
const P2_BLADES = 5;

/** Radians per second a top's blades appear to turn at full spin. Render only. */
const BLADE_RATE = 13;

const COLOUR_SURROUND = '#0b1020';
const COLOUR_LIP = '#39456b';
const COLOUR_DISH = '#171f36';
const COLOUR_CONTOUR = 'rgba(214, 226, 255, 0.1)';
const COLOUR_CREST = '#d8e4ff';
const COLOUR_COUNTDOWN = 'rgba(216, 228, 255, 0.42)';
const COLOUR_PIP_DIM = 'rgba(216, 228, 255, 0.22)';
const COLOUR_HUB = '#0b1020';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P1_DEEP = SEAT_PALETTE.p1.deep;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_P2_DEEP = SEAT_PALETTE.p2.deep;

const LIP_WIDTH = 18;
const CREST_WIDTH = 6;
const CONTOUR_WIDTH = 2;
const CENTRE_DOT = 7;
const COUNTDOWN_MIN = 24;
const COUNTDOWN_SPAN = 64;

/** The spin gauge: eight ticks round each top, of which the lit ones are the spin left. */
const PIP_COUNT = 8;
const PIP_GAP = 9;
const PIP_LIT_LENGTH = 13;
const PIP_DIM_LENGTH = 5;
const PIP_WIDTH = 4;

const HUB_SHARE = 0.42;
const BLADE_INSET = 5;
const BLADE_WIDTH = 6;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class SpinWarGame implements Game {
  readonly #bowl: Bowl = createBowl();
  readonly #p1: Spinner = createSpinner(0, 0);
  readonly #p2: Spinner = createSpinner(0, 0);
  readonly #driveP1: Vec2 = vec2();
  readonly #driveP2: Vec2 = vec2();
  readonly #solution: SpringStep = createSpringStep();
  readonly #round: RoundPoints = createRoundPoints();
  readonly #condition: WinCondition = { kind: 'first-to', target: POINTS_TO_WIN };
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #context: GameContext | null = null;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #resetSteps = 0;

  /** Blade angles. Presentation only, but stepped in update() so replays stay identical. */
  #phaseP1 = 0;
  #phaseP2 = 0;

  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP2X = 0;
  #prevP2Y = 0;

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  spinner(seat: SeatId): Readonly<Spinner> {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  get bowl(): Readonly<Bowl> {
    return this.#bowl;
  }

  /** Steps left before the next round is launched, or 0 while one is being fought. */
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
    this.#resetSteps = RESET_STEPS;
    this.#phaseP1 = 0;
    this.#phaseP2 = 0;
    this.#launch(context.rng);
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

    if (this.#resetSteps > 0) {
      this.#resetSteps -= 1;
      return;
    }

    const rng = context.rng;

    // Both seats are read before either moves, so neither ever acts on the other's
    // post-step position.
    this.#steer('p1', this.#p1, this.#p2, this.#botP1, this.#driveP1, input, rng);
    this.#steer('p2', this.#p2, this.#p1, this.#botP2, this.#driveP2, input, rng);

    const solution = solveSpring(
      this.#solution,
      this.#bowl.spring,
      this.#bowl.drag,
      fixedDeltaSeconds,
    );
    stepSpinner(this.#p1, this.#driveP1.x, this.#driveP1.y, this.#bowl, solution);
    stepSpinner(this.#p2, this.#driveP2.x, this.#driveP2.y, this.#bowl, solution);
    collideSpinners(this.#p1, this.#p2);

    wearSpin(this.#p1, effort(this.#driveP1), this.#bowl, fixedDeltaSeconds);
    wearSpin(this.#p2, effort(this.#driveP2), this.#bowl, fixedDeltaSeconds);
    this.#phaseP1 = advancePhase(this.#phaseP1, this.#p1.spin, fixedDeltaSeconds);
    this.#phaseP2 = advancePhase(this.#phaseP2, this.#p2.spin, fixedDeltaSeconds);

    if (!scoreRound(this.#round, this.#p1, this.#p2, this.#bowl)) return;

    this.#score.p1 += this.#round.p1;
    this.#score.p2 += this.#round.p2;
    this.#score.winner = resolve(this.#condition, this.#score);
    // A decided match leaves both tops where they fell, so the last frame shows how the
    // match ended instead of a tidied-up bowl.
    if (this.#score.winner === null) this.#beginReset(rng);
  }

  render(renderer: Renderer, alpha: number): void {
    const bowl = this.#bowl;
    const centreX = bowl.centreX;
    const centreY = bowl.centreY;

    renderer.clear(COLOUR_SURROUND);
    renderer.circle(centreX, centreY, bowl.radius + LIP_WIDTH, COLOUR_LIP);
    renderer.circle(centreX, centreY, bowl.radius, COLOUR_DISH);
    // Contour lines, the way a map draws a hollow: they read as depth without colour.
    renderer.strokeCircle(centreX, centreY, bowl.radius * 0.66, CONTOUR_WIDTH, COLOUR_CONTOUR);
    renderer.strokeCircle(centreX, centreY, bowl.radius * 0.33, CONTOUR_WIDTH, COLOUR_CONTOUR);
    renderer.circle(centreX, centreY, CENTRE_DOT, COLOUR_CONTOUR);

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

    this.#drawSpinner(
      renderer,
      this.#prevP2X + (this.#p2.x - this.#prevP2X) * alpha,
      this.#prevP2Y + (this.#p2.y - this.#prevP2Y) * alpha,
      this.#p2.spin,
      this.#phaseP2,
      COLOUR_P2,
      COLOUR_P2_DEEP,
      P2_BLADES,
    );
    this.#drawSpinner(
      renderer,
      this.#prevP1X + (this.#p1.x - this.#prevP1X) * alpha,
      this.#prevP1Y + (this.#p1.y - this.#prevP1Y) * alpha,
      this.#p1.spin,
      this.#phaseP1,
      COLOUR_P1,
      COLOUR_P1_DEEP,
      P1_BLADES,
    );

    // Last, and at exactly the radius isOut() tests: the losing line is the line the player
    // sees, and a top drawn over it must never be able to hide it.
    renderer.strokeCircle(centreX, centreY, bowl.radius, CREST_WIDTH, COLOUR_CREST);
  }

  // Momentum and spin are state of their own rather than something derived from the
  // pointer, so a paused match simply stops being stepped and resumes exactly as it stood.
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
    this.#resetSteps = RESET_STEPS;
    this.#launch(rng);
    // Interpolation must not drag a top across the bowl on the reset frame.
    this.#syncInterpolation();
  }

  /**
   * Launch both tops, fully charged, on one diameter from a single draw — so however the
   * spread falls neither seat starts nearer the crest or with more spin than the other.
   */
  #launch(rng: Rng): void {
    const angle = QUARTER_TURN + (rng.float() * 2 - 1) * START_SPREAD;
    const offset = START_OFFSET_NEAR + rng.float() * (START_OFFSET_FAR - START_OFFSET_NEAR);
    const offsetX = Math.cos(angle) * offset;
    const offsetY = Math.sin(angle) * offset;
    const p1 = this.#p1;
    // y grows downwards, so the +offset seat starts on p1's side of the device.
    p1.x = this.#bowl.centreX + offsetX;
    p1.y = this.#bowl.centreY + offsetY;
    p1.vx = 0;
    p1.vy = 0;
    p1.spin = SPIN_FULL;
    const p2 = this.#p2;
    p2.x = this.#bowl.centreX - offsetX;
    p2.y = this.#bowl.centreY - offsetY;
    p2.vx = 0;
    p2.vy = 0;
    p2.spin = SPIN_FULL;
  }

  /**
   * One seat's intent for this step.
   *
   * A pointer names a place on the dish and the top drives towards it; keys name a
   * direction and the top drives that way. Both come out as a direction of at most unit
   * length, which is what makes the two instruments the same game.
   */
  #steer(
    seat: SeatId,
    self: Readonly<Spinner>,
    other: Readonly<Spinner>,
    difficulty: BotDifficulty | null,
    out: Vec2,
    input: InputState,
    rng: Rng,
  ): void {
    if (difficulty !== null) {
      botInput(out, self, other, this.#bowl, difficulty, rng);
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
  }

  /**
   * One top: its spin gauge, its body and its blades.
   *
   * Three signals name a seat and only one of them is colour. The blade COUNT differs —
   * three against five — so the two tops are told apart in greyscale and by anybody who
   * cannot separate red from blue, and the gauge is a count of lit ticks rather than a
   * coloured bar, so how much spin is left reads the same way.
   */
  #drawSpinner(
    renderer: Renderer,
    x: number,
    y: number,
    spin: number,
    phase: number,
    colour: string,
    deep: string,
    blades: number,
  ): void {
    let share = spin / SPIN_FULL;
    if (!(share > 0)) share = 0;
    else if (share > 1) share = 1;
    const lit = Math.ceil(share * PIP_COUNT);

    const gauge = SPINNER_RADIUS + PIP_GAP;
    for (let i = 0; i < PIP_COUNT; i += 1) {
      const angle = (i / PIP_COUNT) * TAU - QUARTER_TURN;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const on = i < lit;
      const outer = gauge + (on ? PIP_LIT_LENGTH : PIP_DIM_LENGTH);
      renderer.line(
        x + cos * gauge,
        y + sin * gauge,
        x + cos * outer,
        y + sin * outer,
        PIP_WIDTH,
        on ? colour : COLOUR_PIP_DIM,
      );
    }

    const hub = SPINNER_RADIUS * HUB_SHARE;
    renderer.circle(x, y, SPINNER_RADIUS, colour);
    for (let i = 0; i < blades; i += 1) {
      const angle = phase + (i / blades) * TAU;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      renderer.line(
        x + cos * hub,
        y + sin * hub,
        x + cos * (SPINNER_RADIUS - BLADE_INSET),
        y + sin * (SPINNER_RADIUS - BLADE_INSET),
        BLADE_WIDTH,
        deep,
      );
    }
    renderer.circle(x, y, hub, COLOUR_HUB);
  }
}

/** How hard a seat is pushing this step, in [0, 1]. */
function effort(drive: Readonly<Vec2>): number {
  const lengthSq = drive.x * drive.x + drive.y * drive.y;
  if (lengthSq <= 0) return 0;
  return lengthSq >= 1 ? 1 : Math.sqrt(lengthSq);
}

/** Blade angle for the next frame, wrapped so it can never drift out of precision. */
function advancePhase(phase: number, spin: number, dt: number): number {
  const next = phase + BLADE_RATE * (spin / SPIN_FULL) * dt;
  return next >= TAU ? next % TAU : next;
}
