import { Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  DISC_RADIUS,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_LEFT,
  GOAL_RIGHT,
  PITCH_BOTTOM,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  PITCH_WIDTH,
  attackingGoalY,
  ballOf,
  botAim,
  createMatch,
  fumbleShot,
  otherOf,
  resetMatch,
  settleShot,
  shotsLeft,
  step,
  strike,
} from './rules.js';
import type { BotDifficulty, Match, ShotOutcome } from './rules.js';

/** How far a pull-back has to travel for full power, in logical units. */
export const PULL_FOR_FULL_POWER = 300;
/** A pull shorter than this is a rest, not a shot, and is ignored. */
export const PULL_DEADZONE = 20;
/** Seconds of holding the action key for full power on a keyboard. */
export const HOLD_FOR_FULL_POWER = 1.1;
/** Radians per second the keyboard swings the aim. */
export const AIM_TURN_RATE = 2.2;
/**
 * Seconds a seat has to strike before the turn passes.
 *
 * Long enough to line a shot up on a phone, short enough that a match with nobody at the
 * device still reaches full time. It is the second half of the termination guarantee: the
 * shot limit bounds how many turns there are, and this bounds how long one can last.
 */
export const SHOT_CLOCK_SECONDS = 9;
/**
 * A shot that has not settled by now is stopped dead.
 *
 * Unreachable, and deliberately close to unreachable. `SETTLE_BOUND_SECONDS` proves every
 * shot is stopped by 3.06 s — nothing on the pitch adds energy and the decay is a fixed
 * per-second factor — so this is a guard against a physics change, not against the physics
 * we have, and a test asserts it stays above the bound. It was nine seconds, which is the
 * number Bowling shipped: a ball that "has stopped" as far as the rules are concerned but
 * is still visibly sailing on is the fault this replaces, and a cap so far above the real
 * settling time that it can never fire is a cap that hides one.
 */
export const MAX_ROLL_SECONDS = 4;
/** How long the board holds still after a goal, so both players see it happen. */
export const GOAL_PAUSE_SECONDS = 0.8;
/** How long the final position stays up before the shell is told there is a winner. */
export const SETTLE_SECONDS = 0.5;

const COLOUR_SURROUND = '#0e1a12';
const COLOUR_BOARD = '#5a3b21';
const COLOUR_GRASS = '#1f7a45';
const COLOUR_GRASS_BAND = '#1b6d3d';
const COLOUR_LINE = 'rgba(240, 255, 244, 0.65)';
const COLOUR_NET = '#0a1410';
const COLOUR_BALL = '#f7f7f2';
const COLOUR_BALL_MARK = '#1b1f1c';
const COLOUR_TEXT = '#e9f3ea';
const COLOUR_MUTED = 'rgba(233, 243, 234, 0.62)';
const COLOUR_GUIDE = 'rgba(247, 247, 242, 0.55)';
const COLOUR_TICK = 'rgba(233, 243, 234, 0.28)';

/** Mown bands across the pitch. Texture only — nothing simulates against them. */
const GRASS_BANDS = 6;
/** Segments of the aim guide, drawn broken so it reads as a line of intent. */
const GUIDE_SEGMENTS = 4;
/** Notches in the power ladder. */
const POWER_TICKS = 10;

const STATUS_Y = 958;
const LADDER_Y = 958;
const LADDER_LEFT = 396;
const LADDER_RIGHT = PITCH_RIGHT;

/** Hoisted so the two per-frame loops over the ends allocate nothing (rule 5). */
const GOAL_LINES: readonly number[] = Object.freeze([PITCH_TOP, PITCH_BOTTOM]);

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export class SoccerPoolGame implements Game {
  readonly #match: Match = createMatch();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #angle = -Math.PI / 2;
  #power = 0;
  #stepsPerSecond = 0;
  /** Steps this seat has spent aiming, against the shot clock. */
  #aimSteps = 0;
  /** Steps the current shot has been rolling, against the runaway cap. */
  #rollSteps = 0;
  /** Counts down while a bot is deciding; -1 when it has not started thinking. */
  #thinkSteps = -1;
  /** Counts down while a goal is being shown. */
  #goalSteps = 0;
  /** Counts down on the final position before the shell is told the match is over. */
  #settleSteps = 0;

  get match(): Match {
    return this.#match;
  }

  get aimAngle(): number {
    return this.#angle;
  }

  get power(): number {
    return this.#power;
  }

  /** Seconds left on the shot clock, for the status line and for tests. */
  get shotClockLeft(): number {
    const perSecond = this.#stepsPerSecond || 60;
    return Math.max(0, SHOT_CLOCK_SECONDS - this.#aimSteps / perSecond);
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetMatch(this.#match, context.openingSeat);
    this.#aimSteps = 0;
    this.#rollSteps = 0;
    this.#thinkSteps = -1;
    this.#goalSteps = 0;
    this.#settleSteps = 0;
    this.#power = 0;
    this.#angle = this.#defaultAim();
    this.#flip.snap(this.#shouldRotate());
  }

  /**
   * Where a fresh turn points before anybody has aimed: from the ball at the middle of the
   * goal being attacked.
   *
   * Not cosmetic. A keyboard swings the aim at a fixed rate, so a turn that started at an
   * arbitrary angle would spend its first second turning round — and the two instruments
   * would not be playing the same game, which is what `control-parity.test.ts` measures. A
   * finger overrides it the moment it pulls further than the deadzone.
   */
  #defaultAim(): number {
    const ball = ballOf(this.#match);
    return Math.atan2(attackingGoalY(this.#match.seat) - ball.y, CENTRE_X - ball.x);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#matchWinner = this.#match.winner;
      return;
    }
    if (this.#goalSteps > 0) {
      this.#goalSteps -= 1;
      return;
    }

    if (this.#match.phase === 'rolling') {
      this.#rollSteps += 1;
      const result = step(this.#match, fixedDeltaSeconds);
      const stalled = this.#rollSteps >= this.#secondsToSteps(MAX_ROLL_SECONDS);
      if (result.settled || stalled) this.#finishShot(result.goal);
      return;
    }
    if (this.#match.phase === 'over') return;

    // The board is turning to face the other player; a tap on it would land where nobody
    // aimed, and the clock a seat cannot yet use must not be running against them.
    if (!this.#flip.acceptsInput) return;

    this.#aimSteps += 1;
    if (this.#aimSteps >= this.#secondsToSteps(SHOT_CLOCK_SECONDS)) {
      this.#applyOutcome(fumbleShot(this.#match));
      return;
    }

    const seat = this.#match.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#updateBot(difficulty);
      return;
    }
    this.#updateAim(fixedDeltaSeconds, input.seat(seat));
  }

  #secondsToSteps(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  /**
   * The bot picks its line first and strikes a moment later, so the aim it chose is on the
   * screen while it "thinks" — the same information a player gets from watching an
   * opponent line a shot up, and no more.
   */
  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) {
      // One roll for the whole shot: a per-step error averages away and every tier plays
      // the same, which is exactly the failure `bot-parity.test.ts` exists to catch.
      const aim = botAim(this.#match, difficulty, this.#rng.float());
      this.#angle = aim.angle;
      this.#power = aim.power;
      this.#thinkSteps = this.#secondsToSteps(BOT_PROFILES[difficulty].thinkSeconds);
      return;
    }
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;
    strike(this.#match, this.#angle, this.#power);
  }

  /**
   * Aiming.
   *
   * The gesture is a boot drawn back: put a finger down, pull away from the ball, and let
   * go. The ball leaves along the line from the finger *through* it, and how far you pulled
   * is how hard you hit it. On a keyboard the same shot is steer, hold, release.
   */
  #updateAim(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const ball = ballOf(this.#match);
    const pointer = seatInput.pointer;

    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const dx = ball.x - this.#pointerWorld.x;
      const dy = ball.y - this.#pointerWorld.y;
      const pull = Math.hypot(dx, dy);
      if (pull > PULL_DEADZONE) {
        this.#angle = Math.atan2(dy, dx);
        this.#power = clamp(pull / PULL_FOR_FULL_POWER, 0, 1);
      }
    }

    const axis = seatInput.move.x;
    if (Math.abs(axis) > 0.2) {
      this.#angle += axis * fixedDeltaSeconds * AIM_TURN_RATE;
    }
    // A finger owns power outright while it is down: `actionHeld` is true for a pointer
    // too, so reading the hold as well would fight the pull for the same number.
    if (pointer === null && seatInput.actionHeld) {
      this.#power = clamp(seatInput.holdSeconds / HOLD_FOR_FULL_POWER, 0, 1);
    }

    // `strike` owns the rule that a shot needs power behind it; re-checking it here would
    // be a second copy of one rule, and the return value already says what happened.
    if (seatInput.actionReleased) strike(this.#match, this.#angle, this.#power);
  }

  #finishShot(goal: SeatId | null): void {
    const outcome = settleShot(this.#match, goal);
    this.#applyOutcome(outcome);
    if (outcome.scored !== null && this.#match.phase !== 'over') {
      this.#goalSteps = this.#secondsToSteps(GOAL_PAUSE_SECONDS);
    }
  }

  #applyOutcome(outcome: ShotOutcome): void {
    if (outcome.winner !== null) {
      this.#match.winner = outcome.winner;
      this.#match.phase = 'over';
      this.#settleSteps = this.#secondsToSteps(SETTLE_SECONDS);
      return;
    }
    this.#match.seat = outcome.next;
    this.#match.phase = 'aiming';
    this.#aimSteps = 0;
    this.#rollSteps = 0;
    this.#thinkSteps = -1;
    this.#power = 0;
    this.#angle = this.#defaultAim();
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.#match.seat !== this.#localSeat;
  }

  getActiveSeat(): SeatId {
    return this.#match.seat;
  }

  getScore(): MatchScore {
    return { p1: this.#match.p1, p2: this.#match.p2, winner: this.#matchWinner };
  }

  onPause(): void {
    // Nobody comes back to a boot half drawn.
    this.#power = 0;
  }

  onResume(): void {}

  destroy(): void {
    resetMatch(this.#match);
    this.#matchWinner = null;
    this.#aimSteps = 0;
    this.#rollSteps = 0;
    this.#thinkSteps = -1;
    this.#goalSteps = 0;
    this.#settleSteps = 0;
    this.#power = 0;
    this.#angle = -Math.PI / 2;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SURROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawPitch(renderer);
    this.#drawGoals(renderer);
    this.#drawDiscs(renderer);
    if (this.#match.phase === 'aiming') this.#drawAim(renderer);
    this.#drawStatus(renderer);
    renderer.popSeatRotation();
  }

  #drawPitch(renderer: Renderer): void {
    renderer.rect(
      PITCH_LEFT - 14,
      PITCH_TOP - 14,
      PITCH_WIDTH + 28,
      PITCH_HEIGHT + 28,
      COLOUR_BOARD,
    );
    renderer.rect(PITCH_LEFT, PITCH_TOP, PITCH_WIDTH, PITCH_HEIGHT, COLOUR_GRASS);
    const band = PITCH_HEIGHT / GRASS_BANDS;
    for (let i = 1; i < GRASS_BANDS; i += 2) {
      renderer.rect(PITCH_LEFT, PITCH_TOP + band * i, PITCH_WIDTH, band, COLOUR_GRASS_BAND);
    }
    renderer.strokeRect(
      PITCH_LEFT + 10,
      PITCH_TOP + 10,
      PITCH_WIDTH - 20,
      PITCH_HEIGHT - 20,
      3,
      COLOUR_LINE,
    );
    renderer.line(PITCH_LEFT + 10, CENTRE_Y, PITCH_RIGHT - 10, CENTRE_Y, 3, COLOUR_LINE);
    renderer.strokeCircle(CENTRE_X, CENTRE_Y, 96, 3, COLOUR_LINE);
    renderer.circle(CENTRE_X, CENTRE_Y, 5, COLOUR_LINE);
    // The two penalty areas, drawn from the same numbers so they cannot drift apart.
    for (const goalY of GOAL_LINES) {
      const top = goalY === PITCH_TOP ? goalY + 10 : goalY - 150;
      renderer.strokeRect(CENTRE_X - 170, top, 340, 140, 3, COLOUR_LINE);
    }
  }

  /**
   * Each net is drawn in the colour of the seat that **defends** it, and carries that
   * seat's own shape as well — a ring for p1, a bar for p2 — so which end is yours reads
   * without colour at all (CLAUDE.md rule 7).
   */
  #drawGoals(renderer: Renderer): void {
    for (const goalY of GOAL_LINES) {
      const defender = otherOf(goalY === PITCH_TOP ? 'p1' : 'p2');
      const palette = SEAT_PALETTE[defender];
      const netY = goalY === PITCH_TOP ? goalY - GOAL_DEPTH : goalY;
      renderer.rect(GOAL_LEFT, netY, GOAL_HALF_WIDTH * 2, GOAL_DEPTH, COLOUR_NET);
      renderer.strokeRect(GOAL_LEFT, netY, GOAL_HALF_WIDTH * 2, GOAL_DEPTH, 4, palette.base);
      renderer.line(GOAL_LEFT, goalY, GOAL_RIGHT, goalY, 5, palette.base);
      const markY = netY + GOAL_DEPTH / 2;
      if (defender === 'p1') {
        renderer.strokeCircle(CENTRE_X, markY, 11, 4, palette.base);
      } else {
        renderer.rect(CENTRE_X - 13, markY - 4, 26, 8, palette.base);
      }
    }
  }

  #drawDiscs(renderer: Renderer): void {
    for (const disc of this.#match.discs) {
      if (disc.kind === 'ball') {
        renderer.circle(disc.x, disc.y, BALL_RADIUS, COLOUR_BALL);
        renderer.strokeCircle(disc.x, disc.y, BALL_RADIUS - 2, 2, COLOUR_BALL_MARK);
        renderer.circle(disc.x, disc.y, 5, COLOUR_BALL_MARK);
        continue;
      }
      const palette = SEAT_PALETTE[disc.kind];
      renderer.circle(disc.x, disc.y, DISC_RADIUS, palette.base);
      renderer.strokeCircle(disc.x, disc.y, DISC_RADIUS, 3, palette.deep);
      if (disc.kind === 'p1') {
        renderer.strokeCircle(disc.x, disc.y, DISC_RADIUS * 0.5, 4, palette.deep);
      } else {
        renderer.rect(disc.x - DISC_RADIUS, disc.y - 5, DISC_RADIUS * 2, 10, palette.deep);
      }
    }
  }

  #drawAim(renderer: Renderer): void {
    const ball = ballOf(this.#match);
    const palette = SEAT_PALETTE[this.#match.seat];
    const cos = Math.cos(this.#angle);
    const sin = Math.sin(this.#angle);

    // A broken guide, so it reads as intent rather than as a solid part of the pitch.
    const reach = 150 + this.#power * 320;
    const stride = reach / (GUIDE_SEGMENTS * 2 - 1);
    for (let i = 0; i < GUIDE_SEGMENTS; i += 1) {
      const from = BALL_RADIUS + stride * i * 2;
      const to = from + stride;
      renderer.line(
        ball.x + cos * from,
        ball.y + sin * from,
        ball.x + cos * to,
        ball.y + sin * to,
        3,
        COLOUR_GUIDE,
      );
    }
    renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS + 7, 3, palette.base);

    // The boot, drawn back behind the ball by how hard the shot will be, so power is read
    // from where it sits rather than from a number.
    const back = BALL_RADIUS + 16 + this.#power * 110;
    renderer.line(
      ball.x - cos * back,
      ball.y - sin * back,
      ball.x - cos * (back + 46),
      ball.y - sin * (back + 46),
      11,
      palette.base,
    );
  }

  #drawStatus(renderer: Renderer): void {
    const match = this.#match;
    const line =
      match.phase === 'over'
        ? 'Full time'
        : match.lastGoal !== null
          ? 'Goal!'
          : match.fumbled
            ? 'Shot clock — turn passed'
            : match.phase === 'rolling'
              ? 'Rolling'
              : `${String(shotsLeft(match))} shots left`;
    renderer.text(line, PITCH_LEFT + 46, STATUS_Y, 26, COLOUR_TEXT, 'left');

    // A marker in the seat's own colour and its own shape, so which side you are is never
    // a memory test with the colour taken away.
    const palette = SEAT_PALETTE[match.seat];
    renderer.rect(PITCH_LEFT, STATUS_Y - 15, 30, 30, palette.base);
    if (match.seat === 'p1') {
      renderer.strokeCircle(PITCH_LEFT + 15, STATUS_Y, 8, 4, palette.deep);
    } else {
      renderer.rect(PITCH_LEFT, STATUS_Y - 4, 30, 8, palette.deep);
    }

    // The power ladder. Length alone is hard to judge, and a player who liked a shot needs
    // to be able to repeat it.
    const filled = Math.round(this.#power * POWER_TICKS);
    const gap = (LADDER_RIGHT - LADDER_LEFT) / POWER_TICKS;
    for (let i = 0; i < POWER_TICKS; i += 1) {
      const height = 8 + i * 1.6;
      renderer.rect(
        LADDER_LEFT + i * gap,
        LADDER_Y - height / 2,
        gap - 5,
        height,
        i < filled ? palette.base : COLOUR_TICK,
      );
    }
    if (this.#match.phase === 'aiming' && this.shotClockLeft <= 3) {
      renderer.text(
        String(Math.ceil(this.shotClockLeft)),
        CENTRE_X + 30,
        BOARD_HEIGHT - 18,
        22,
        COLOUR_MUTED,
        'centre',
      );
    }
  }
}
