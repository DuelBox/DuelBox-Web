import type { LogicalSize, Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  WinCondition,
} from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  MARKS_TO_WIN,
  MARK_SPACING,
  PULL_STRENGTH,
  STAMINA_MAX,
  WIN_DISTANCE,
  botPull,
  createState,
  decay,
  marksHeld,
  pull,
  recover,
} from './rules.js';
import type { BotDifficulty, RopeState } from './rules.js';

/** Steps a seat's grip stays lit after a tap, so every pull gets a visible answer. */
export const TUG_STEPS = 7;

const COLOUR_BACKGROUND = '#0e1726';
const COLOUR_ROPE = '#c8a870';
const COLOUR_ROPE_TWIST = '#8d7442';
const COLOUR_LINE = 'rgba(233, 240, 252, 0.55)';
const COLOUR_LINE_SOFT = 'rgba(233, 240, 252, 0.22)';
const COLOUR_DEAD = 'rgba(233, 240, 252, 0.06)';
const COLOUR_P1 = '#3d7bff';
const COLOUR_P2 = '#ff8a3d';
const COLOUR_P1_SOFT = 'rgba(61, 123, 255, 0.45)';
const COLOUR_P2_SOFT = 'rgba(255, 138, 61, 0.45)';
const COLOUR_KNOT = '#e9f0fc';
const COLOUR_INK = '#0b1220';
const COLOUR_FLASH = 'rgba(233, 240, 252, 0.85)';

const ROPE_OVERHANG = 40;
const ROPE_WIDTH = 16;
const TWIST_SPACING = 26;
const TWIST_REACH = 7;
const TWIST_RAKE = 10;
const MARK_REACH = 34;
const MARK_SPLIT = 4;
const CENTRE_WIDTH = 6;
const WIN_LINE_WIDTH = 12;
const WIN_LINE_SPLIT = 8;

const KNOT_HALF_WIDTH = 62;
const KNOT_HEIGHT = 30;
const CHEVRON_REACH = 26;
const CHEVRON_DROP = 22;
const CHEVRON_GAP = 10;
const CHEVRON_WIDTH = 7;

const BAR_X = 108;
const BAR_WIDTH = 428;
const BAR_HEIGHT = 34;
const BAR_MARGIN = 30;
const BAR_PAD = 5;
/** Tick spacing is the seats' pattern: p1 reads coarse, p2 reads fine, in any palette. */
const BAR_TICK_P1 = 56;
const BAR_TICK_P2 = 28;
const GLYPH_X = 62;
const GLYPH_RADIUS = 15;
const GLYPH_WIDTH = 5;

const CLOCK_WIDTH = 12;
const CLOCK_INSET = 10;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

export class PullTheRopeGame implements Game {
  readonly #state: RopeState = createState();
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };
  readonly #condition: WinCondition = { kind: 'first-to', target: MARKS_TO_WIN };
  readonly #options = { timeExpired: false };

  #context: GameContext | null = null;
  #logical: LogicalSize = manifest.logical;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #flipped = false;

  #prevPosition = 0;
  #tugP1 = 0;
  #tugP2 = 0;
  #elapsedSteps = 0;
  #roundSteps = 0;
  #stepsPerSecond = 0;

  /** Read-only view for the bot harness and tests. Never mutate through it. */
  get rope(): Readonly<RopeState> {
    return this.#state;
  }

  /** Steps the round lasts, or 0 until the first update has sized the step. */
  get roundSteps(): number {
    return this.#roundSteps;
  }

  get elapsedSteps(): number {
    return this.#elapsedSteps;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#logical = context.manifest.logical;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    // Shared-screen seats sit at their own end of the rope already; a lone p2 has the
    // whole device and reads its own end from the bottom.
    this.#flipped = context.presentation === 'single-seat' && context.localSeat === 'p2';

    this.#state.position = 0;
    this.#state.p1Stamina = STAMINA_MAX;
    this.#state.p2Stamina = STAMINA_MAX;
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#options.timeExpired = false;
    this.#prevPosition = 0;
    this.#tugP1 = 0;
    this.#tugP2 = 0;
    this.#elapsedSteps = 0;
    this.#roundSteps = 0;
    this.#stepsPerSecond = 0;
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#score.winner !== null) return;

    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
      // The clock is counted in whole steps, so a replay of the same inputs ends on the
      // same step on every machine.
      const seconds = context.manifest.roundSeconds;
      this.#roundSteps = Math.max(1, Math.round(seconds * this.#stepsPerSecond));
    }

    this.#prevPosition = this.#state.position;
    if (this.#tugP1 > 0) this.#tugP1 -= 1;
    if (this.#tugP2 > 0) this.#tugP2 -= 1;
    this.#elapsedSteps += 1;

    const rng = context.rng;
    this.#pullFor('p1', this.#botP1, input, fixedDeltaSeconds, rng);
    this.#pullFor('p2', this.#botP2, input, fixedDeltaSeconds, rng);

    // Settled before the drift, so a pull that reaches the line takes the match on that
    // step instead of being dragged back inside it first.
    if (this.#settle()) return;

    recover(this.#state, fixedDeltaSeconds);
    decay(this.#state, fixedDeltaSeconds);
  }

  render(renderer: Renderer, alpha: number): void {
    const width = this.#logical.width;
    const height = this.#logical.height;
    const centreX = width / 2;
    const centreY = height / 2;
    const position = this.#prevPosition + (this.#state.position - this.#prevPosition) * alpha;

    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushSeatRotation(this.#flipped);

    this.#drawRope(renderer, centreX, centreY);
    this.#drawMarks(renderer, width, centreX, centreY);
    this.#drawClock(renderer, width, height, centreY);
    this.#drawKnot(renderer, centreX, centreY + position);
    this.#drawStamina(
      renderer,
      'p1',
      height - BAR_MARGIN - BAR_HEIGHT,
      this.#state.p1Stamina,
      this.#tugP1,
    );
    this.#drawStamina(renderer, 'p2', BAR_MARGIN, this.#state.p2Stamina, this.#tugP2);

    renderer.popSeatRotation();
  }

  onPause(): void {
    this.#tugP1 = 0;
    this.#tugP2 = 0;
  }

  onResume(): void {
    this.#tugP1 = 0;
    this.#tugP2 = 0;
    // Interpolation must not smear the marker across the rope on the first frame back.
    this.#prevPosition = this.#state.position;
  }

  getScore(): MatchScore {
    return this.#score;
  }

  destroy(): void {
    this.#context = null;
    this.#botP1 = null;
    this.#botP2 = null;
  }

  #pullFor(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    input: InputState,
    dt: number,
    rng: Rng,
  ): void {
    let strength = 0;
    if (difficulty !== null) {
      strength = botPull(this.#state, seat, difficulty, rng, dt);
    } else if (input.seat(seat).actionPressed) {
      // The pressed edge only: a held key or a resting thumb is not a pull, so the rope
      // moves on taps and on nothing else.
      strength = PULL_STRENGTH;
    }
    if (strength <= 0) return;
    pull(this.#state, seat, strength);
    if (seat === 'p1') this.#tugP1 = TUG_STEPS;
    else this.#tugP2 = TUG_STEPS;
  }

  /** Recomputes the score and reports whether the match has now been decided. */
  #settle(): boolean {
    this.#score.p1 = marksHeld(this.#state, 'p1');
    this.#score.p2 = marksHeld(this.#state, 'p2');
    this.#options.timeExpired = this.#roundSteps > 0 && this.#elapsedSteps >= this.#roundSteps;
    this.#score.winner = resolve(this.#condition, this.#score, this.#options);
    return this.#score.winner !== null;
  }

  #drawRope(renderer: Renderer, centreX: number, centreY: number): void {
    const top = centreY - WIN_DISTANCE - ROPE_OVERHANG;
    const bottom = centreY + WIN_DISTANCE + ROPE_OVERHANG;
    renderer.line(centreX, top, centreX, bottom, ROPE_WIDTH, COLOUR_ROPE);
    for (let y = top; y < bottom - TWIST_RAKE; y += TWIST_SPACING) {
      renderer.line(
        centreX - TWIST_REACH,
        y,
        centreX + TWIST_REACH,
        y + TWIST_RAKE,
        3,
        COLOUR_ROPE_TWIST,
      );
    }
  }

  #drawMarks(renderer: Renderer, width: number, centreX: number, centreY: number): void {
    renderer.rect(0, centreY - MARK_SPACING, width, MARK_SPACING * 2, COLOUR_DEAD);

    // One rung per mark on p1's side, a pair on p2's: the sides stay apart in greyscale.
    for (let mark = 1; mark < MARKS_TO_WIN; mark += 1) {
      const offset = mark * MARK_SPACING;
      const low = centreY + offset;
      const high = centreY - offset;
      renderer.line(centreX - MARK_REACH, low, centreX + MARK_REACH, low, 4, COLOUR_P1_SOFT);
      renderer.line(
        centreX - MARK_REACH,
        high - MARK_SPLIT,
        centreX + MARK_REACH,
        high - MARK_SPLIT,
        3,
        COLOUR_P2_SOFT,
      );
      renderer.line(
        centreX - MARK_REACH,
        high + MARK_SPLIT,
        centreX + MARK_REACH,
        high + MARK_SPLIT,
        3,
        COLOUR_P2_SOFT,
      );
    }

    renderer.line(0, centreY, width, centreY, CENTRE_WIDTH, COLOUR_LINE);

    const p1Line = centreY + WIN_DISTANCE;
    const p2Line = centreY - WIN_DISTANCE;
    renderer.line(0, p1Line, width, p1Line, WIN_LINE_WIDTH, COLOUR_P1);
    renderer.line(0, p2Line - WIN_LINE_SPLIT, width, p2Line - WIN_LINE_SPLIT, 5, COLOUR_P2);
    renderer.line(0, p2Line + WIN_LINE_SPLIT, width, p2Line + WIN_LINE_SPLIT, 5, COLOUR_P2);
  }

  #drawClock(renderer: Renderer, width: number, height: number, centreY: number): void {
    const total = this.#roundSteps;
    const remaining = total > 0 ? clamp01(1 - this.#elapsedSteps / total) : 1;
    const reach = (height / 2 - CLOCK_INSET) * remaining;
    renderer.rect(CLOCK_INSET, centreY - reach, CLOCK_WIDTH, reach * 2, COLOUR_LINE_SOFT);
    renderer.rect(
      width - CLOCK_INSET - CLOCK_WIDTH,
      centreY - reach,
      CLOCK_WIDTH,
      reach * 2,
      COLOUR_LINE_SOFT,
    );
  }

  #drawKnot(renderer: Renderer, centreX: number, markerY: number): void {
    const left = centreX - KNOT_HALF_WIDTH;
    const top = markerY - KNOT_HEIGHT / 2;
    renderer.rect(left, top, KNOT_HALF_WIDTH * 2, KNOT_HEIGHT, COLOUR_KNOT);
    renderer.strokeRect(left, top, KNOT_HALF_WIDTH * 2, KNOT_HEIGHT, 4, COLOUR_INK);

    const lead = this.#state.position;
    if (lead === 0) return;
    // A chevron pointing the way the rope is going: which side is winning survives both
    // greyscale and a colour-blind reading.
    const towardP1 = lead > 0;
    const colour = towardP1 ? COLOUR_P1 : COLOUR_P2;
    const base = towardP1
      ? markerY + KNOT_HEIGHT / 2 + CHEVRON_GAP
      : markerY - KNOT_HEIGHT / 2 - CHEVRON_GAP;
    const tip = towardP1 ? base + CHEVRON_DROP : base - CHEVRON_DROP;
    renderer.line(centreX - CHEVRON_REACH, base, centreX, tip, CHEVRON_WIDTH, colour);
    renderer.line(centreX + CHEVRON_REACH, base, centreX, tip, CHEVRON_WIDTH, colour);
  }

  #drawStamina(renderer: Renderer, seat: SeatId, y: number, stamina: number, tug: number): void {
    const isP1 = seat === 'p1';
    const colour = isP1 ? COLOUR_P1 : COLOUR_P2;
    const inner = BAR_WIDTH - BAR_PAD * 2;

    renderer.strokeRect(BAR_X, y, BAR_WIDTH, BAR_HEIGHT, 4, COLOUR_LINE);
    renderer.rect(
      BAR_X + BAR_PAD,
      y + BAR_PAD,
      inner * clamp01(stamina),
      BAR_HEIGHT - BAR_PAD * 2,
      colour,
    );

    const spacing = isP1 ? BAR_TICK_P1 : BAR_TICK_P2;
    for (let x = BAR_X + spacing; x < BAR_X + BAR_WIDTH; x += spacing) {
      renderer.line(x, y + BAR_PAD, x, y + BAR_HEIGHT - BAR_PAD, 3, COLOUR_INK);
    }

    const midY = y + BAR_HEIGHT / 2;
    if (isP1) {
      renderer.circle(GLYPH_X, midY, GLYPH_RADIUS, colour);
    } else {
      renderer.strokeRect(
        GLYPH_X - GLYPH_RADIUS,
        midY - GLYPH_RADIUS,
        GLYPH_RADIUS * 2,
        GLYPH_RADIUS * 2,
        GLYPH_WIDTH,
        colour,
      );
    }

    if (tug > 0) {
      renderer.strokeRect(BAR_X - 6, y - 6, BAR_WIDTH + 12, BAR_HEIGHT + 12, 5, COLOUR_FLASH);
    }
  }
}
