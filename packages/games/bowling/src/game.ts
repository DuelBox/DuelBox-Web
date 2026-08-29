import { Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  FOUL_LINE_Y,
  FRAMES,
  GUTTER,
  LANE_WIDTH,
  PINS,
  PIN_RADIUS,
  botAim,
  bowl,
  createGame,
  frameOf,
  frameStarts,
  isStrike,
  recordBall,
  resetGame,
  rollsOf,
  scoreOf,
  standingCount,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/** How far a sideways drag has to travel to swing the aim from end to end. */
export const DRAG_RANGE = 220;
export const MAX_AIM = 0.42;
export const HOLD_FOR_FULL_POWER = 1.0;
export const AIM_TURN_RATE = 0.9;

export const SCOREBOARD_Y = 918;
export const SCOREBOARD_HEIGHT = 74;

const COLOUR_BACKGROUND = '#141019';
const COLOUR_LANE = '#c99a55';
const COLOUR_LANE_EDGE = '#a97e40';
const COLOUR_GUTTER = '#221a2c';
const COLOUR_PIN = '#f7f2e6';
const COLOUR_PIN_DOWN = 'rgba(247, 242, 230, 0.22)';
const COLOUR_INK = '#141019';
const COLOUR_TEXT = '#f0ebf6';
const COLOUR_MUTED = 'rgba(240, 235, 246, 0.55)';
const COLOUR_GUIDE = 'rgba(240, 235, 246, 0.45)';

const SETTLE_SECONDS = 0.6;
const RECORD_SECONDS = 0.8;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export class BowlingGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #frameIndex: number[] = [];

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #angle = 0;
  #power = 0;
  #dragging = false;
  #dragX = 0;
  #stepsPerSecond = 0;
  #recordSteps = 0;
  #settleSteps = 0;
  #thinkSteps = -1;
  #lastKnocked = -1;

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
    this.#recordSteps = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#lastKnocked = -1;
    resetGame(this.#position, context.openingSeat);
    this.#flip.snap(this.#shouldRotate());
  }

  #resetAim(): void {
    this.#power = 0;
    this.#dragging = false;
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
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#position);
      return;
    }

    // The pins are shown standing for a beat before they are counted and cleared, because
    // watching what you knocked down is most of the point of bowling.
    if (this.#recordSteps > 0) {
      this.#recordSteps -= 1;
      if (this.#recordSteps === 0) {
        const result = recordBall(this.#position);
        this.#lastKnocked = result.knocked;
        if (result.matchOver) {
          this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
        }
        this.#resetAim();
      }
      return;
    }

    if (this.#position.phase === 'rolling') {
      if (step(this.#position, fixedDeltaSeconds).settled) {
        this.#recordSteps = this.#stepsFor(RECORD_SECONDS);
      }
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
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(0.7);
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;
    const aim = botAim(this.#position, difficulty, this.#rng.float());
    this.#angle = aim.angle;
    this.#power = aim.power;
    bowl(this.#position, aim.angle, aim.power);
  }

  /**
   * Aiming.
   *
   * Sideways to steer and a hold to build power, which is the same idiom as Cornhole and
   * Darts — a player who has met one of them already knows this one.
   */
  #updateAim(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      if (!this.#dragging) {
        this.#dragging = true;
        this.#dragX = this.#pointerWorld.x;
      }
      this.#angle = clamp((this.#pointerWorld.x - this.#dragX) / DRAG_RANGE, -1, 1) * MAX_AIM;
      // Pulling back down the lane builds power, which is the run-up.
      this.#power = clamp((this.#pointerWorld.y - FOUL_LINE_Y) / 90, 0, 1);
      if (this.#power === 0) this.#power = 0.5;
    }

    const axis = seatInput.move.x;
    if (Math.abs(axis) > 0.2) {
      this.#angle = clamp(
        this.#angle + axis * fixedDeltaSeconds * AIM_TURN_RATE,
        -MAX_AIM,
        MAX_AIM,
      );
    }
    if (pointer === null && seatInput.actionHeld) {
      this.#power = clamp(seatInput.holdSeconds / HOLD_FOR_FULL_POWER, 0, 1);
    }

    if (seatInput.actionReleased && bowl(this.#position, this.#angle, this.#power)) {
      this.#resetAim();
    }
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.#position.seat !== this.#localSeat;
  }

  getActiveSeat(): SeatId {
    return this.#position.seat;
  }

  getScore(): MatchScore {
    return {
      p1: scoreOf(this.#position.rollsP1),
      p2: scoreOf(this.#position.rollsP2),
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
    this.#recordSteps = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#resetAim();
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawLane(renderer);
    this.#drawPins(renderer);
    this.#drawBall(renderer);
    if (this.#position.phase === 'aiming') this.#drawAim(renderer);
    this.#drawScoreboard(renderer);
    renderer.popSeatRotation();
  }

  #drawLane(renderer: Renderer): void {
    renderer.rect(0, 0, LANE_WIDTH, SCOREBOARD_Y, COLOUR_GUTTER);
    renderer.rect(GUTTER, 0, LANE_WIDTH - GUTTER * 2, SCOREBOARD_Y, COLOUR_LANE);
    renderer.line(GUTTER, 0, GUTTER, SCOREBOARD_Y, 3, COLOUR_LANE_EDGE);
    renderer.line(LANE_WIDTH - GUTTER, 0, LANE_WIDTH - GUTTER, SCOREBOARD_Y, 3, COLOUR_LANE_EDGE);
    renderer.line(GUTTER, FOUL_LINE_Y, LANE_WIDTH - GUTTER, FOUL_LINE_Y, 4, COLOUR_LANE_EDGE);
    // The arrows a bowler actually aims at, rather than at the pins themselves.
    for (let i = -3; i <= 3; i += 1) {
      const x = LANE_WIDTH / 2 + i * 46;
      renderer.line(x, 640, x, 668, 3, COLOUR_LANE_EDGE);
    }
  }

  /**
   * Rule 7: a pin still standing is a filled disc with an inked collar; a fallen one is a
   * faint outline. Shape and weight, not only brightness.
   */
  #drawPins(renderer: Renderer): void {
    for (const pin of this.#position.pins) {
      if (pin.swept) continue;
      if (pin.down) {
        renderer.strokeCircle(pin.x, pin.y, PIN_RADIUS, 2, COLOUR_PIN_DOWN);
        continue;
      }
      renderer.circle(pin.x, pin.y, PIN_RADIUS, COLOUR_PIN);
      renderer.strokeCircle(pin.x, pin.y, PIN_RADIUS - 4, 3, COLOUR_INK);
    }
  }

  #drawBall(renderer: Renderer): void {
    const ball = this.#position.ball;
    const palette = SEAT_PALETTE[this.#position.seat];
    renderer.circle(ball.x, ball.y, BALL_RADIUS, palette.base);
    if (this.#position.seat === 'p1') {
      renderer.strokeCircle(ball.x, ball.y, BALL_RADIUS * 0.45, 4, palette.deep);
    } else {
      renderer.rect(ball.x - BALL_RADIUS, ball.y - 5, BALL_RADIUS * 2, 10, palette.deep);
    }
  }

  #drawAim(renderer: Renderer): void {
    const ball = this.#position.ball;
    const palette = SEAT_PALETTE[this.#position.seat];
    const length = 200 + this.#power * 320;
    renderer.line(
      ball.x,
      ball.y,
      ball.x + Math.sin(this.#angle) * length,
      ball.y - Math.cos(this.#angle) * length,
      3,
      COLOUR_GUIDE,
    );
    // Power as a bar beside the foul line, so it is read without a number.
    renderer.rect(GUTTER + 8, FOUL_LINE_Y - 200, 10, 200, COLOUR_GUTTER);
    renderer.rect(GUTTER + 8, FOUL_LINE_Y - 200 * this.#power, 10, 200 * this.#power, palette.base);
  }

  /**
   * The scoreboard.
   *
   * Frame by frame rather than one running total, because **a frame's value is not known
   * when it is bowled** — a strike is worth ten plus your next two balls — and a player
   * needs to see which frames are still open.
   */
  #drawScoreboard(renderer: Renderer): void {
    renderer.rect(0, SCOREBOARD_Y, LANE_WIDTH, SCOREBOARD_HEIGHT, COLOUR_GUTTER);
    const cell = LANE_WIDTH / (FRAMES + 1);

    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const rolls = rollsOf(this.#position, seat);
      frameStarts(this.#frameIndex, rolls);
      const y = SCOREBOARD_Y + (seat === 'p1' ? 30 : 62);
      const palette = SEAT_PALETTE[seat];

      renderer.rect(6, y - 16, 16, 16, palette.base);
      if (seat === 'p1') renderer.strokeCircle(14, y - 8, 4, 2, palette.deep);
      else renderer.rect(6, y - 11, 16, 5, palette.deep);

      for (let frame = 0; frame < FRAMES; frame += 1) {
        const at = this.#frameIndex[frame] ?? -1;
        const x = 34 + frame * cell;
        if (at < 0) {
          renderer.text('–', x, y, 24, COLOUR_MUTED);
          continue;
        }
        const label = isStrike(rolls, at)
          ? 'X'
          : (rolls[at] ?? 0) + (rolls[at + 1] ?? 0) === PINS
            ? `${String(rolls[at] ?? 0)} /`
            : `${String(rolls[at] ?? 0)} ${rolls[at + 1] === undefined ? '' : String(rolls[at + 1])}`;
        renderer.text(label, x, y, 24, COLOUR_TEXT);
      }
      renderer.text(String(scoreOf(rolls)), LANE_WIDTH - 20, y, 26, palette.base, 'right');
    }

    const seat = this.#position.seat;
    const status =
      this.#position.phase === 'over'
        ? 'Match over'
        : this.#recordSteps > 0
          ? `${String(this.#lastKnocked)} down`
          : this.#position.ballInFrame === 0
            ? `Frame ${String(frameOf(this.#position, seat) + 1)} — first ball`
            : `${String(standingCount(this.#position))} standing`;
    // Above the rack, not above the scoreboard: at the foot of the lane it sat underneath
    // the ball on the foul line, which is where a player is looking.
    renderer.text(status, LANE_WIDTH / 2, 58, 26, COLOUR_MUTED, 'centre');
  }
}
