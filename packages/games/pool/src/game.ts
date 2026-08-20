import { Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALLS_PER_SIDE,
  BALL_RADIUS,
  CUSHION,
  POCKETS,
  POCKET_RADIUS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  botAim,
  createGame,
  cueBall,
  onBlack,
  remaining,
  resetGame,
  settleShot,
  step,
  strike,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/** How far a pull-back has to travel for full power, in logical units. */
export const PULL_FOR_FULL_POWER = 260;
/** A pull shorter than this is a tap rather than a shot, and is ignored. */
export const PULL_DEADZONE = 18;
/** Seconds of holding the action key for full power on a keyboard. */
export const HOLD_FOR_FULL_POWER = 1.1;
export const AIM_TURN_RATE = 2.2;

const COLOUR_BACKGROUND = '#12160f';
const COLOUR_RAIL = '#3d2a18';
const COLOUR_CLOTH = '#1d6b3f';
const COLOUR_CLOTH_EDGE = '#175733';
const COLOUR_POCKET = '#0a0c08';
const COLOUR_CUE = '#f6f3e7';
const COLOUR_BLACK = '#14161a';
const COLOUR_TEXT = '#e9f3ea';
const COLOUR_MUTED = 'rgba(233, 243, 234, 0.6)';
const COLOUR_GUIDE = 'rgba(246, 243, 231, 0.5)';

const SETTLE_SECONDS = 0.5;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export class PoolGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #angle = 0;
  #power = 0;
  #stepsPerSecond = 0;
  #settleSteps = 0;
  #thinkSteps = -1;
  /** Everything potted by the shot in progress. */
  readonly #potted: number[] = [];

  get position(): Position {
    return this.#position;
  }

  get aimAngle(): number {
    return this.#angle;
  }

  get power(): number {
    return this.#power;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#angle = 0;
    this.#resetAim();
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#potted.length = 0;
    resetGame(this.#position);
    this.#flip.snap(this.#shouldRotate());
  }

  #resetAim(): void {
    this.#power = 0;
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
      if (this.#settleSteps === 0) this.#matchWinner = this.#position.winner;
      return;
    }

    if (this.#position.phase === 'rolling') {
      const result = step(this.#position, fixedDeltaSeconds);
      this.#potted.push(...result.potted);
      if (result.settled) this.#finishShot();
      return;
    }
    if (this.#position.phase === 'over') return;

    const seat = this.#position.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#updateBot(difficulty);
      return;
    }
    if (!this.#flip.acceptsInput) return;
    this.#updateAim(fixedDeltaSeconds, input.seat(seat));
  }

  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0)
      this.#thinkSteps = Math.max(1, Math.round(0.8 * (this.#stepsPerSecond || 60)));
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;
    // One roll for the whole shot, so the tier's spread is a real error rather than one
    // that averages away over the frames of a stroke.
    const aim = botAim(this.#position, difficulty, this.#rng.float());
    this.#angle = aim.angle;
    this.#power = aim.power;
    this.#potted.length = 0;
    strike(this.#position, aim.angle, aim.power);
  }

  /**
   * Aiming.
   *
   * The gesture is drawing a cue back: put a finger down, pull away from the cue ball, and
   * let go. The ball leaves along the line from the finger *through* the ball, and how far
   * you pulled is how hard you hit it — the same thing the object itself suggests.
   */
  #updateAim(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const cue = cueBall(this.#position);
    const pointer = seatInput.pointer;

    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const dx = cue.x - this.#pointerWorld.x;
      const dy = cue.y - this.#pointerWorld.y;
      const pull = Math.hypot(dx, dy);
      if (pull > PULL_DEADZONE) {
        this.#angle = Math.atan2(dy, dx);
        this.#power = clamp(pull / PULL_FOR_FULL_POWER, 0, 1);
      }
    }

    // Keyboard: steer to turn the cue, hold to build power, release to strike.
    const axis = seatInput.move.x;
    if (Math.abs(axis) > 0.2) {
      this.#angle += axis * fixedDeltaSeconds * AIM_TURN_RATE;
    }
    if (pointer === null && seatInput.actionHeld) {
      this.#power = clamp(seatInput.holdSeconds / HOLD_FOR_FULL_POWER, 0, 1);
    }

    // `strike` already refuses a shot with no power, so the release does not re-check it:
    // a second copy of the rule here was redundant, which mutating it and failing no test
    // is exactly how it showed. The return value is what decides whether a shot happened.
    if (seatInput.actionReleased && strike(this.#position, this.#angle, this.#power)) {
      this.#potted.length = 0;
      this.#resetAim();
    }
  }

  #finishShot(): void {
    const outcome = settleShot(this.#position, this.#potted);
    this.#potted.length = 0;
    if (outcome.winner !== null) {
      this.#position.winner = outcome.winner;
      this.#position.phase = 'over';
      this.#settleSteps = Math.max(1, Math.round(SETTLE_SECONDS * (this.#stepsPerSecond || 60)));
      return;
    }
    this.#position.seat = outcome.next;
    this.#position.fouled = outcome.fouled;
    this.#position.phase = 'aiming';
    this.#resetAim();
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.#position.seat !== this.#localSeat;
  }

  getActiveSeat(): SeatId {
    return this.#position.seat;
  }

  getScore(): MatchScore {
    // Balls potted, which counts up.
    return {
      p1: BALLS_PER_SIDE - remaining(this.#position, 'p1'),
      p2: BALLS_PER_SIDE - remaining(this.#position, 'p2'),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {
    this.#resetAim();
  }

  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    this.#matchWinner = null;
    this.#potted.length = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#resetAim();
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawTable(renderer);
    this.#drawBalls(renderer);
    if (this.#position.phase === 'aiming') this.#drawAim(renderer);
    this.#drawStatus(renderer);
    renderer.popSeatRotation();
  }

  #drawTable(renderer: Renderer): void {
    renderer.rect(0, 0, TABLE_WIDTH, TABLE_HEIGHT, COLOUR_RAIL);
    renderer.rect(
      CUSHION,
      CUSHION,
      TABLE_WIDTH - CUSHION * 2,
      TABLE_HEIGHT - CUSHION * 2,
      COLOUR_CLOTH,
    );
    renderer.strokeRect(
      CUSHION,
      CUSHION,
      TABLE_WIDTH - CUSHION * 2,
      TABLE_HEIGHT - CUSHION * 2,
      3,
      COLOUR_CLOTH_EDGE,
    );
    for (const [px, py] of POCKETS) {
      renderer.circle(px, py, POCKET_RADIUS, COLOUR_POCKET);
    }
  }

  /**
   * Rule 7: a seat's balls are its colour **and** its shape — p1 solid with a ring, p2
   * with a stripe across it — so the two sides are told apart with the colour removed. The
   * black is the only ball with neither.
   */
  #drawBalls(renderer: Renderer): void {
    for (const b of this.#position.balls) {
      if (b.potted) continue;
      if (b.kind === 'cue') {
        renderer.circle(b.x, b.y, BALL_RADIUS, COLOUR_CUE);
        renderer.strokeCircle(b.x, b.y, BALL_RADIUS - 3, 2, 'rgba(0,0,0,0.25)');
        continue;
      }
      if (b.kind === 'black') {
        renderer.circle(b.x, b.y, BALL_RADIUS, COLOUR_BLACK);
        renderer.strokeCircle(b.x, b.y, BALL_RADIUS - 2, 2, COLOUR_MUTED);
        continue;
      }
      const palette = SEAT_PALETTE[b.kind];
      renderer.circle(b.x, b.y, BALL_RADIUS, palette.base);
      if (b.kind === 'p1') {
        renderer.strokeCircle(b.x, b.y, BALL_RADIUS * 0.5, 3, palette.deep);
      } else {
        renderer.rect(b.x - BALL_RADIUS, b.y - 4, BALL_RADIUS * 2, 8, palette.deep);
      }
    }
  }

  #drawAim(renderer: Renderer): void {
    const cue = cueBall(this.#position);
    if (cue.potted) return;
    const palette = SEAT_PALETTE[this.#position.seat];

    // The line the ball will take, drawn to the first cushion rather than for ever.
    const length = 180 + this.#power * 220;
    renderer.line(
      cue.x,
      cue.y,
      cue.x + Math.cos(this.#angle) * length,
      cue.y + Math.sin(this.#angle) * length,
      3,
      COLOUR_GUIDE,
    );
    renderer.strokeCircle(cue.x, cue.y, BALL_RADIUS + 5, 2, palette.base);

    // The cue itself, drawn back behind the ball by how hard the shot will be. A player
    // reads power from the cue's position, not from a number.
    const back = 34 + this.#power * 120;
    renderer.line(
      cue.x - Math.cos(this.#angle) * back,
      cue.y - Math.sin(this.#angle) * back,
      cue.x - Math.cos(this.#angle) * (back + 150),
      cue.y - Math.sin(this.#angle) * (back + 150),
      7,
      palette.base,
    );
  }

  #drawStatus(renderer: Renderer): void {
    const seat = this.#position.seat;
    const left = remaining(this.#position, seat);
    const line =
      this.#position.phase === 'over'
        ? 'Frame over'
        : this.#position.phase === 'rolling'
          ? 'Rolling'
          : onBlack(this.#position, seat)
            ? 'On the black'
            : `${String(left)} to go`;
    renderer.text(line, TABLE_WIDTH / 2, TABLE_HEIGHT + 44, 30, COLOUR_TEXT, 'centre');
    if (this.#position.fouled) {
      renderer.text(
        'Foul — cue ball replaced',
        TABLE_WIDTH / 2,
        TABLE_HEIGHT + 80,
        24,
        COLOUR_MUTED,
        'centre',
      );
    }
    // A marker a seat's own colour, so which side you are is never a memory test.
    const palette = SEAT_PALETTE[seat];
    renderer.rect(CUSHION, TABLE_HEIGHT + 26, 26, 26, palette.base);
    if (seat === 'p1') renderer.strokeCircle(CUSHION + 13, TABLE_HEIGHT + 39, 7, 3, palette.deep);
    else renderer.rect(CUSHION, TABLE_HEIGHT + 35, 26, 8, palette.deep);
  }
}
