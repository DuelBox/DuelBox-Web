import { Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import { actionAbandoned } from '@duelbox/game-sdk';
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
import {
  CUE_STROKE_MARGIN,
  FOUL_ROW,
  FOUL_SIZE,
  GUIDE_STROKE_MARGIN,
  MARKER_SIZE,
  PULL_DEADZONE,
  STATUS_ROW,
  STATUS_SIZE,
  cueLength,
  cueTip,
  guideLength,
  powerForPull,
  roomAlong,
  rowCentre,
} from './layout.js';

// Re-exported rather than moved out of sight. Both are part of what this game's control
// *is*, and both were read from here before `layout.ts` existed; the placement lives with
// the rest of the placement now, and the name a caller reaches for has not moved.
export { PULL_DEADZONE, PULL_FOR_FULL_POWER } from './layout.js';

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
    resetGame(this.#position, context.openingSeat);
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
    // A cancel is the browser saying the gesture did not happen. It suppresses the release,
    // so nothing is fired — but without this the power the pull had built would simply stay
    // where it was, and the next release, from a gesture that aimed at nothing, would fire
    // it. The charge goes; the aim is left where it is, because it is a standing setting
    // this game carries from one shot to the next and an interruption must not also move it.
    // `actionAbandoned` is the mirror of `actionReleased`: the action ended, and it ended by
    // being taken away rather than let go. Its doc comment carries the reasoning, including
    // why a bare `pointerCancelled` is the wrong read.
    if (actionAbandoned(seatInput)) this.#resetAim();

    const cue = cueBall(this.#position);
    const pointer = seatInput.pointer;

    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      // Deliberately NOT clamped into the box, though it was for a while (#1965).
      //
      // The host captures the pointer and converts with `viewportToLogical`, which clamps
      // nothing, so a drag off the canvas keeps arriving in logical coordinates — and a
      // screen with letterbox bars to drag into would buy a harder shot than a phone whose
      // canvas meets the glass. Clamping looked like the fix and is not: `pullSpan` already
      // measures the draw against the room inside the box, so full power is reached *at* the
      // edge and a finger beyond it changes nothing. Putting the clamp back failed no test,
      // which is how a guard turns out to be guarding something else's property. What it did
      // do was bend the aim, because a per-axis clamp of a diagonal drag is not a point on
      // the same ray. Unclamped, the aim follows the finger and the power does not.
      const dx = cue.x - this.#pointerWorld.x;
      const dy = cue.y - this.#pointerWorld.y;
      const pull = Math.hypot(dx, dy);
      if (pull > PULL_DEADZONE) {
        this.#angle = Math.atan2(dy, dx);
        // Full power is the shorter of a full draw and the table actually behind the ball,
        // so a ball tight on a cushion is played with a short action rather than not at all.
        this.#power = powerForPull(
          pull,
          roomAlong(cue.x, cue.y, -dx / pull, -dy / pull, this.#logical),
        );
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

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
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

    const cos = Math.cos(this.#angle);
    const sin = Math.sin(this.#angle);

    // The line the ball will take, stopped at the first cushion rather than drawn for ever
    // and left to the frame clip to end. Same picture, and now a picture this game can be
    // held to: nothing it draws leaves the logical box.
    const length = guideLength(
      roomAlong(cue.x, cue.y, cos, sin, this.#logical, GUIDE_STROKE_MARGIN),
      this.#power,
    );
    renderer.line(cue.x, cue.y, cue.x + cos * length, cue.y + sin * length, 3, COLOUR_GUIDE);
    renderer.strokeCircle(cue.x, cue.y, BALL_RADIUS + 5, 2, palette.base);

    // The cue itself, drawn back behind the ball by how hard the shot will be. A player
    // reads power from the cue's position, not from a number — so it has to be on screen at
    // the moment they are pulling hardest, which a fixed-length cue behind a ball on the
    // cushion was not.
    const behind = roomAlong(cue.x, cue.y, -cos, -sin, this.#logical, CUE_STROKE_MARGIN);
    const tip = cueTip(behind, this.#power);
    const butt = tip + cueLength(behind);
    renderer.line(
      cue.x - cos * tip,
      cue.y - sin * tip,
      cue.x - cos * butt,
      cue.y - sin * butt,
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
    const statusY = rowCentre(this.#logical, STATUS_ROW, STATUS_SIZE);
    renderer.text(line, TABLE_WIDTH / 2, statusY, STATUS_SIZE, COLOUR_TEXT, 'centre');
    if (this.#position.fouled) {
      renderer.text(
        'Foul — cue ball replaced',
        TABLE_WIDTH / 2,
        rowCentre(this.#logical, FOUL_ROW, FOUL_SIZE),
        FOUL_SIZE,
        COLOUR_MUTED,
        'centre',
      );
    }
    // A marker a seat's own colour, so which side you are is never a memory test. Sat on the
    // status line rather than at its own offset from the table, so the two move together if
    // the strip ever changes shape.
    const palette = SEAT_PALETTE[seat];
    const markerTop = statusY - MARKER_SIZE / 2;
    renderer.rect(CUSHION, markerTop, MARKER_SIZE, MARKER_SIZE, palette.base);
    if (seat === 'p1') {
      renderer.strokeCircle(CUSHION + MARKER_SIZE / 2, statusY, 7, 3, palette.deep);
    } else {
      renderer.rect(CUSHION, statusY - 4, MARKER_SIZE, 8, palette.deep);
    }
  }
}
