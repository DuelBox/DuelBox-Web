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
import {
  ARENA_HALF,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BODY_LENGTH,
  GUSTS_PER_ROUND,
  GUST_SECONDS,
  MAT_Y,
  MAX_ROUNDS,
  ROPE_HALF,
  ROUNDS_TO_WIN,
  TELEGRAPH_SECONDS,
  WIND_MAX,
  botDrive,
  createBotState,
  createBout,
  createDrive,
  createWind,
  drawWindSchedule,
  judgeRound,
  readWind,
  resetBotState,
  resetBout,
  stepBout,
  wrestlerOf,
} from './rules.js';
import type {
  BotDifficulty,
  BotState,
  Bout,
  Drive,
  RoundOutcome,
  Wind,
  Wrestler,
} from './rules.js';

/**
 * Steps between rounds, counted in simulation steps rather than seconds so that a replay
 * of the same inputs restarts on the same step on every machine.
 *
 * The fallen pose is held for the whole countdown: a round is lost in about a fifth of a
 * second and nobody would otherwise see how.
 */
export const RESET_STEPS = 72;

/** How far from a wrestler a finger has to be for a full lean. */
export const LEAN_REACH = 120;

/**
 * Radian-seconds of lean that empties a steadiness bar.
 *
 * A display scale only — the tie-break compares the raw totals — but it has to be a
 * number a round can plausibly reach, or the bar never moves and the rule the players are
 * being judged by is invisible.
 */
const WOBBLE_SCALE = 9;

const COLOUR_SKY = '#101a2c';
const COLOUR_CROWD = '#1b2740';
const COLOUR_MAT = '#2f4258';
const COLOUR_APRON = '#16203a';
const COLOUR_EDGE = '#e8eefb';
const COLOUR_POST = '#c9d4e8';
const COLOUR_ROPE = 'rgba(232, 238, 251, 0.35)';
const COLOUR_INK = '#0b1220';
const COLOUR_CHROME = 'rgba(232, 238, 251, 0.55)';
const COLOUR_FAINT = 'rgba(232, 238, 251, 0.16)';
const COLOUR_WIND = 'rgba(232, 238, 251, 0.8)';
const COLOUR_WIND_NEXT = 'rgba(255, 214, 102, 0.9)';
const COLOUR_ALARM = '#ffd666';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

const CROWD_HEIGHT = 92;
const TORSO_WIDTH = 22;
const HEAD_RADIUS = 26;
const STRIPE_HALF = 13;
const STRIPE_WIDTH = 6;
const ARM_HALF = 30;
const ARM_WIDTH = 7;
const FOOT_RADIUS = 11;

const WIND_Y = 150;
const WIND_SPAN = 300;
const WIND_CHEVRONS = 5;
const WIND_CHEVRON_HALF = 13;
const WIND_NEXT_Y = 190;

const CLOCK_Y = 12;
const CLOCK_HEIGHT = 7;

/** Top of both steadiness bars. Exported so a test can find their ticks by geometry. */
export const BAR_Y = 40;
const BAR_WIDTH = 220;
const BAR_HEIGHT = 18;
const BAR_MARGIN = 30;
const BAR_PAD = 3;
/** Tick spacing is the seats' pattern: p1 reads coarse, p2 reads fine, in any palette. */
const BAR_TICK_P1 = 55;
const BAR_TICK_P2 = 27.5;

const PIP_Y = 486;
const PIP_RADIUS = 12;
const PIP_GAP = 34;
const PIP_MARGIN = 34;

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export class WrestleGame implements Game {
  readonly #bout: Bout = createBout();
  readonly #wind: Wind = createWind();
  /** One round's gusts, drawn from the seed. Sized once; never reallocated. */
  readonly #schedule: number[] = new Array<number>(GUSTS_PER_ROUND).fill(0);
  readonly #driveP1: Drive = createDrive();
  readonly #driveP2: Drive = createDrive();
  readonly #botStateP1: BotState = createBotState();
  readonly #botStateP2: BotState = createBotState();
  readonly #condition: WinCondition = { kind: 'first-to', target: ROUNDS_TO_WIN };
  readonly #options = { timeExpired: false };
  /** Doubles as the tally handed to resolve(): the score is the tally. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #context: GameContext | null = null;
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;

  #roundIndex = 0;
  /**
   * A coin drawn once a match, added to the round number before the wind is drawn.
   *
   * Without it the wind blows towards p2 at the start of every first round of every match
   * ever played, which is a measurable advantage rather than a cosmetic one — see
   * `drawWindSchedule`.
   */
  #windFlip = 0;
  #resetSteps = RESET_STEPS;
  #elapsed = 0;
  #roundSteps = 0;
  #gustSteps = 0;
  #telegraphSteps = 0;
  #stepsPerSecond = 0;
  /** Built when a round opens, so drawing a frame never builds a string. */
  #roundLabel = `1/${String(MAX_ROUNDS)}`;

  #prevP1X = 0;
  #prevP1Y = 0;
  #prevP1Angle = 0;
  #prevP2X = 0;
  #prevP2Y = 0;
  #prevP2Angle = 0;

  /** Read-only view for tests and the balance harness. Never mutate through it. */
  wrestler(seat: SeatId): Readonly<Wrestler> {
    return wrestlerOf(this.#bout, seat);
  }

  /** Read-only view of what the players can see of the wind. Never mutate through it. */
  get wind(): Readonly<Wind> {
    return this.#wind;
  }

  /** Steps left before the next round starts, or 0 while one is being fought. */
  get resetCountdown(): number {
    return this.#resetSteps;
  }

  /** Rounds already settled, in [0, {@link MAX_ROUNDS}]. */
  get roundsPlayed(): number {
    return this.#roundIndex;
  }

  /** Steps the live round has run for. */
  get roundElapsed(): number {
    return this.#elapsed;
  }

  /** Steps a round lasts, or 0 until the first update has sized the clock. */
  get roundSteps(): number {
    return this.#roundSteps;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#options.timeExpired = false;
    this.#roundIndex = 0;
    this.#resetSteps = RESET_STEPS;
    this.#elapsed = 0;
    this.#roundSteps = 0;
    this.#gustSteps = 0;
    this.#telegraphSteps = 0;
    this.#stepsPerSecond = 0;
    resetBout(this.#bout);
    resetBotState(this.#botStateP1);
    resetBotState(this.#botStateP2);
    this.#windFlip = context.rng.int(0, 2);
    this.#openRound(context.rng);
    this.#syncInterpolation();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null) return;
    if (this.#score.winner !== null) return;

    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      // Every delay in this game is counted in whole steps, so a replay of the same
      // inputs ends on the same step whatever rate the host runs the loop at.
      const rate = Math.max(1, Math.round(1 / fixedDeltaSeconds));
      this.#stepsPerSecond = rate;
      this.#roundSteps = Math.max(1, Math.round(context.manifest.roundSeconds * rate));
      this.#gustSteps = Math.max(1, Math.round(GUST_SECONDS * rate));
      this.#telegraphSteps = Math.max(1, Math.round(TELEGRAPH_SECONDS * rate));
    }
    if (this.#stepsPerSecond === 0) return;

    this.#prevP1X = this.#bout.p1.x;
    this.#prevP1Y = this.#bout.p1.y;
    this.#prevP1Angle = this.#bout.p1.angle;
    this.#prevP2X = this.#bout.p2.x;
    this.#prevP2Y = this.#bout.p2.y;
    this.#prevP2Angle = this.#bout.p2.angle;

    if (this.#resetSteps > 0) {
      this.#resetSteps -= 1;
      return;
    }

    const rng = context.rng;
    readWind(this.#wind, this.#schedule, this.#elapsed, this.#gustSteps, this.#telegraphSteps);
    this.#elapsed += 1;

    // Both seats are read before either moves, so neither ever acts on the other's
    // post-step position.
    this.#steer('p1', this.#botP1, this.#botStateP1, this.#driveP1, input, fixedDeltaSeconds, rng);
    this.#steer('p2', this.#botP2, this.#botStateP2, this.#driveP2, input, fixedDeltaSeconds, rng);

    stepBout(this.#bout, this.#driveP1, this.#driveP2, this.#wind.strength, fixedDeltaSeconds);

    const outcome = judgeRound(this.#bout, this.#elapsed >= this.#roundSteps);
    if (outcome === 'live') return;
    this.#awardRound(outcome, rng);
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_SKY);
    renderer.rect(0, 0, ARENA_WIDTH, CROWD_HEIGHT, COLOUR_CROWD);

    this.#drawWind(renderer);
    this.#drawClock(renderer);

    renderer.rect(0, MAT_Y, ARENA_WIDTH, ARENA_HEIGHT - MAT_Y, COLOUR_APRON);
    renderer.rect(ARENA_HALF - ROPE_HALF, MAT_Y, ROPE_HALF * 2, ARENA_HEIGHT - MAT_Y, COLOUR_MAT);
    this.#drawRopes(renderer);
    // The floor line last of the scenery and at exactly the height the fall predicate
    // tests, so the losing line is the line the player sees.
    renderer.line(0, MAT_Y, ARENA_WIDTH, MAT_Y, 4, COLOUR_EDGE);

    this.#drawWrestler(
      renderer,
      this.#bout.p2,
      this.#prevP2X + (this.#bout.p2.x - this.#prevP2X) * alpha,
      this.#prevP2Y + (this.#bout.p2.y - this.#prevP2Y) * alpha,
      this.#prevP2Angle + (this.#bout.p2.angle - this.#prevP2Angle) * alpha,
      COLOUR_P2,
      2,
    );
    this.#drawWrestler(
      renderer,
      this.#bout.p1,
      this.#prevP1X + (this.#bout.p1.x - this.#prevP1X) * alpha,
      this.#prevP1Y + (this.#bout.p1.y - this.#prevP1Y) * alpha,
      this.#prevP1Angle + (this.#bout.p1.angle - this.#prevP1Angle) * alpha,
      COLOUR_P1,
      1,
    );

    this.#drawSteadiness(renderer, 'p1');
    this.#drawSteadiness(renderer, 'p2');
    this.#drawPips(renderer);

    if (this.#resetSteps > 0) {
      const share = this.#resetSteps / RESET_STEPS;
      renderer.rect(
        ARENA_HALF - (ROPE_HALF * share) / 2,
        MAT_Y - 3,
        ROPE_HALF * share,
        6,
        COLOUR_CHROME,
      );
    }
  }

  // Every delay is state of its own and nothing here reads a clock, so a paused match
  // simply stops being stepped and resumes exactly as it stood.
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

  /* ------------------------------------------------------------------- the match */

  #awardRound(outcome: RoundOutcome, rng: Rng): void {
    // A double fall scores for both seats, exactly as a double ring-out does in Sumo
    // Push: a genuinely simultaneous knock-down must not be handed to whichever body the
    // loop tested first. On the clock the steadier wrestler takes it, and a dead-level
    // pair score nothing at all.
    if (outcome === 'p1' || outcome === 'both') this.#score.p1 += 1;
    if (outcome === 'p2' || outcome === 'both') this.#score.p2 += 1;

    this.#roundIndex += 1;
    // The outer guarantee that a match ends: after MAX_ROUNDS the shared resolver settles
    // it on the tally, drawn if the tally is level. Nothing about the state of the mat can
    // hold a sixth round open.
    this.#options.timeExpired = this.#roundIndex >= MAX_ROUNDS;
    this.#score.winner = resolve(this.#condition, this.#score, this.#options);
    // A decided match keeps the losing wrestler where it fell, so the last frame shows
    // how the match ended rather than a tidied-up mat.
    if (this.#score.winner === null) this.#beginReset(rng);
  }

  #beginReset(rng: Rng): void {
    this.#resetSteps = RESET_STEPS;
    resetBout(this.#bout);
    resetBotState(this.#botStateP1);
    resetBotState(this.#botStateP2);
    this.#openRound(rng);
    // Interpolation must not drag a wrestler across the mat on the reset frame.
    this.#syncInterpolation();
  }

  /** Draw the round's wind, and show its first gust through the countdown. */
  #openRound(rng: Rng): void {
    this.#elapsed = 0;
    this.#roundLabel = `${String(Math.min(this.#roundIndex + 1, MAX_ROUNDS))}/${String(MAX_ROUNDS)}`;
    drawWindSchedule(this.#schedule, this.#roundIndex + this.#windFlip, rng);
    this.#wind.strength = this.#schedule[0] ?? 0;
    this.#wind.upcoming = 0;
    this.#wind.warning = 0;
  }

  #steer(
    seat: SeatId,
    difficulty: BotDifficulty | null,
    bot: BotState,
    out: Drive,
    input: InputState,
    dt: number,
    rng: Rng,
  ): void {
    const self = wrestlerOf(this.#bout, seat);
    if (difficulty !== null) {
      const other = seat === 'p1' ? this.#bout.p2 : this.#bout.p1;
      // One draw on every step whatever the bot decides, so a replay of the same match
      // stays in step with the generator.
      botDrive(out, bot, self, other, this.#wind, difficulty, dt, rng.float());
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer === null) {
      out.lean = clamp(seatInput.move.x, -1, 1);
    } else {
      // A finger leans towards the side of the wrestler it is on. Horizontal only: the
      // two seats own a half of the glass each, and a lean has no vertical meaning.
      out.lean = clamp((pointer.x - ARENA_HALF - self.x) / LEAN_REACH, -1, 1);
    }
    // The pressed edge only, so a held key or a resting thumb is one leap, not sixty.
    out.jump = seatInput.actionPressed;
  }

  #syncInterpolation(): void {
    this.#prevP1X = this.#bout.p1.x;
    this.#prevP1Y = this.#bout.p1.y;
    this.#prevP1Angle = this.#bout.p1.angle;
    this.#prevP2X = this.#bout.p2.x;
    this.#prevP2Y = this.#bout.p2.y;
    this.#prevP2Angle = this.#bout.p2.angle;
  }

  /* ------------------------------------------------------------------ the drawing */

  /**
   * p1 is a **disc-headed** wrestler wearing one stripe, p2 a **square-headed** one
   * wearing two, and each stands over its own numeral on the mat.
   *
   * Three signals that survive greyscale, because who is who is the only thing either
   * player has to read at a glance and there is no time to check a colour (CLAUDE.md
   * rule 7).
   */
  #drawWrestler(
    renderer: Renderer,
    w: Readonly<Wrestler>,
    x: number,
    y: number,
    angle: number,
    colour: string,
    stripes: number,
  ): void {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const footX = ARENA_HALF + x;
    const footY = MAT_Y - y;
    // Along the body, in screen space, where y grows downwards.
    const alongX = sin;
    const alongY = -cos;
    const headX = footX + alongX * BODY_LENGTH;
    const headY = footY + alongY * BODY_LENGTH;

    renderer.line(footX, footY, headX, headY, TORSO_WIDTH, colour);
    renderer.circle(footX, footY, FOOT_RADIUS, colour);

    for (let i = 0; i < stripes; i += 1) {
      const s = 46 + i * 26;
      const cx = footX + alongX * s;
      const cy = footY + alongY * s;
      renderer.line(
        cx - cos * STRIPE_HALF,
        cy - sin * STRIPE_HALF,
        cx + cos * STRIPE_HALF,
        cy + sin * STRIPE_HALF,
        STRIPE_WIDTH,
        COLOUR_INK,
      );
    }

    const armX = footX + alongX * 96;
    const armY = footY + alongY * 96;
    renderer.line(
      armX - cos * ARM_HALF,
      armY - sin * ARM_HALF,
      armX + cos * ARM_HALF,
      armY + sin * ARM_HALF,
      ARM_WIDTH,
      colour,
    );

    if (stripes === 1) {
      renderer.circle(headX, headY, HEAD_RADIUS, colour);
      renderer.strokeCircle(headX, headY, HEAD_RADIUS, 4, COLOUR_INK);
    } else {
      renderer.rect(
        headX - HEAD_RADIUS,
        headY - HEAD_RADIUS,
        HEAD_RADIUS * 2,
        HEAD_RADIUS * 2,
        colour,
      );
      renderer.strokeRect(
        headX - HEAD_RADIUS,
        headY - HEAD_RADIUS,
        HEAD_RADIUS * 2,
        HEAD_RADIUS * 2,
        4,
        COLOUR_INK,
      );
    }

    // Past the tipping point nothing can save this wrestler, and the players deserve to
    // know that before the head lands rather than after.
    if (w.stance === 'toppling' || w.stance === 'fallen') {
      renderer.strokeCircle(headX, headY, HEAD_RADIUS + 9, 4, COLOUR_ALARM);
    }
    renderer.text(stripes === 1 ? '1' : '2', footX, MAT_Y + 26, 24, colour, 'centre');
  }

  /**
   * The wind now, and the gust that has been announced.
   *
   * Drawn from exactly the struct the bot reads, so the arrow and the bot's knowledge
   * cannot come apart: `upcoming` is zero until it is telegraphed, which is the instant
   * the second row of chevrons appears.
   */
  #drawWind(renderer: Renderer): void {
    this.#drawGust(renderer, this.#wind.strength, WIND_Y, 6, COLOUR_WIND);
    if (this.#wind.warning <= 0) return;
    this.#drawGust(renderer, this.#wind.upcoming, WIND_NEXT_Y, 3, COLOUR_WIND_NEXT);
    const span = WIND_SPAN * this.#wind.warning;
    renderer.rect(ARENA_HALF - span / 2, WIND_NEXT_Y + 18, span, 4, COLOUR_WIND_NEXT);
  }

  #drawGust(renderer: Renderer, strength: number, y: number, width: number, colour: string): void {
    const share = clamp(strength / WIND_MAX, -1, 1);
    if (share === 0) {
      // A calm gust is still information, and an arrow of no length would read as none.
      renderer.line(ARENA_HALF - 26, y, ARENA_HALF + 26, y, width, COLOUR_FAINT);
      return;
    }
    const reach = WIND_SPAN * share;
    renderer.line(ARENA_HALF, y, ARENA_HALF + reach, y, width, colour);
    const sign = share > 0 ? 1 : -1;
    for (let i = 1; i <= WIND_CHEVRONS; i += 1) {
      const tip = ARENA_HALF + (reach * i) / WIND_CHEVRONS;
      renderer.line(tip, y, tip - sign * WIND_CHEVRON_HALF, y - WIND_CHEVRON_HALF, width, colour);
      renderer.line(tip, y, tip - sign * WIND_CHEVRON_HALF, y + WIND_CHEVRON_HALF, width, colour);
    }
  }

  #drawClock(renderer: Renderer): void {
    if (this.#roundSteps <= 0) return;
    const left = clamp(1 - this.#elapsed / this.#roundSteps, 0, 1);
    renderer.rect(0, CLOCK_Y, ARENA_WIDTH, CLOCK_HEIGHT, COLOUR_FAINT);
    renderer.rect(
      ARENA_HALF - (ARENA_WIDTH * left) / 2,
      CLOCK_Y,
      ARENA_WIDTH * left,
      CLOCK_HEIGHT,
      COLOUR_CHROME,
    );
  }

  #drawRopes(renderer: Renderer): void {
    renderer.rect(ARENA_HALF - ROPE_HALF - 6, MAT_Y - 150, 12, 150, COLOUR_POST);
    renderer.rect(ARENA_HALF + ROPE_HALF - 6, MAT_Y - 150, 12, 150, COLOUR_POST);
    for (let i = 0; i < 3; i += 1) {
      const y = MAT_Y - 30 - i * 46;
      renderer.line(ARENA_HALF - ROPE_HALF, y, ARENA_HALF + ROPE_HALF, y, 3, COLOUR_ROPE);
    }
  }

  /**
   * How steady each seat has been this round, which is what settles a round on the clock.
   *
   * The bar empties as the lean piles up, and the tick spacing tells the two seats apart
   * without a colour: p1's bar is ruled coarse, p2's fine.
   */
  #drawSteadiness(renderer: Renderer, seat: SeatId): void {
    const w = wrestlerOf(this.#bout, seat);
    const left = seat === 'p1' ? BAR_MARGIN : ARENA_WIDTH - BAR_MARGIN - BAR_WIDTH;
    const colour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    const share = clamp(1 - w.wobble / WOBBLE_SCALE, 0, 1);
    renderer.rect(left, BAR_Y, BAR_WIDTH, BAR_HEIGHT, COLOUR_FAINT);
    const inner = (BAR_WIDTH - BAR_PAD * 2) * share;
    const anchor = seat === 'p1' ? left + BAR_PAD : left + BAR_WIDTH - BAR_PAD - inner;
    renderer.rect(anchor, BAR_Y + BAR_PAD, inner, BAR_HEIGHT - BAR_PAD * 2, colour);
    const tick = seat === 'p1' ? BAR_TICK_P1 : BAR_TICK_P2;
    for (let x = left + tick; x < left + BAR_WIDTH; x += tick) {
      renderer.line(x, BAR_Y, x, BAR_Y + BAR_HEIGHT, 2, COLOUR_SKY);
    }
    renderer.strokeRect(left, BAR_Y, BAR_WIDTH, BAR_HEIGHT, 2, COLOUR_CHROME);
  }

  /** Rounds won, as p1's discs and p2's squares: the seat's shape, not only its colour. */
  #drawPips(renderer: Renderer): void {
    for (let i = 0; i < ROUNDS_TO_WIN; i += 1) {
      const x1 = PIP_MARGIN + i * PIP_GAP;
      if (i < this.#score.p1) renderer.circle(x1, PIP_Y, PIP_RADIUS, COLOUR_P1);
      else renderer.strokeCircle(x1, PIP_Y, PIP_RADIUS, 3, COLOUR_FAINT);

      const x2 = ARENA_WIDTH - PIP_MARGIN - i * PIP_GAP - PIP_RADIUS;
      if (i < this.#score.p2) {
        renderer.rect(x2, PIP_Y - PIP_RADIUS, PIP_RADIUS * 2, PIP_RADIUS * 2, COLOUR_P2);
      } else {
        renderer.strokeRect(
          x2,
          PIP_Y - PIP_RADIUS,
          PIP_RADIUS * 2,
          PIP_RADIUS * 2,
          3,
          COLOUR_FAINT,
        );
      }
    }
    renderer.text(this.#roundLabel, ARENA_HALF, PIP_Y, 22, COLOUR_CHROME, 'centre');
  }
}
