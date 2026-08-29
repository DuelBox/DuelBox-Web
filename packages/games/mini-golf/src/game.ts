import { Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  CUP_RADIUS,
  GREEN_BOTTOM,
  GREEN_LEFT,
  GREEN_RIGHT,
  GREEN_TOP,
  HOLES,
  MAX_STROKES,
  ballOf,
  botAim,
  createGame,
  holeAt,
  putt,
  resetGame,
  settleHole,
  settleStroke,
  step,
} from './rules.js';
import type { Aim, BotDifficulty, Game as Position } from './rules.js';

/** How far back a finger has to travel for a full-blooded putt, in logical units. */
export const PULL_FOR_FULL_POWER = 240;
/** A pull shorter than this is a thumb resting on the ball, not a stroke. */
export const PULL_DEADZONE = 18;
/** Seconds of holding the action key for full power. */
export const HOLD_FOR_FULL_POWER = 1;
/** Radians a second the aim swings while a steering key is down. */
export const AIM_TURN_RATE = 2;

/** How long the bot looks at the hole before it plays. A person does not putt instantly. */
export const THINK_SECONDS = 0.45;
/** A beat after the ball stops, so both players see where it finished. */
export const REST_SECONDS = 0.3;
/** Long enough to read who took the hole. */
export const HOLE_SECONDS = 0.9;
/** And a beat on the last putt of the match, before the shell's result card. */
export const SETTLE_SECONDS = 0.6;

export const CARD_Y = 38;
export const BOARD_TOP = GREEN_BOTTOM + 16;

const COLOUR_SURROUND = '#101a14';
const COLOUR_ROUGH = '#1f5c37';
const COLOUR_GREEN = '#2f9c5c';
const COLOUR_GREEN_EDGE = '#248049';
const COLOUR_WALL = '#7a5230';
const COLOUR_WALL_TOP = '#a2703f';
const COLOUR_SAND = '#e3d09a';
const COLOUR_SAND_MARK = '#c3ad74';
const COLOUR_WATER = '#2f6ea8';
const COLOUR_WATER_MARK = '#7fb6de';
const COLOUR_CUP = '#12261a';
const COLOUR_FLAG = '#f4f0e2';
const COLOUR_TEXT = '#eef6ef';
const COLOUR_MUTED = 'rgba(238, 246, 239, 0.6)';
const COLOUR_GUIDE = 'rgba(244, 240, 226, 0.55)';
const COLOUR_BOARD = '#16241b';

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export class MiniGolfGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #aim: Aim = { angle: 0, power: 0 };

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #angle = 0;
  #power = 0;
  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #restSteps = 0;
  #holeSteps = 0;
  #settleSteps = 0;
  /** What just happened, for the card. Never a turn banner — the shell owns that. */
  #event = '';

  get position(): Position {
    return this.#position;
  }

  get aimAngle(): number {
    return this.#angle;
  }

  get power(): number {
    return this.#power;
  }

  get event(): string {
    return this.#event;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#restSteps = 0;
    this.#holeSteps = 0;
    this.#settleSteps = 0;
    this.#event = '';
    resetGame(this.#position);
    this.#beginStroke();
    this.#flip.snap(this.#shouldRotate());
  }

  /**
   * Line the putter up at the cup and empty the power.
   *
   * The aim starts pointed at the hole because that is where a person stands before they
   * adjust, and because an aim that stayed wherever the last stroke left it would make the
   * keyboard — four movement keys and an action key, nothing absolute — a game of finding
   * the hole again from scratch every stroke.
   */
  #beginStroke(): void {
    const side = ballOf(this.#position, this.#position.seat);
    const hole = holeAt(this.#position.hole);
    this.#angle = Math.atan2(hole.cup[1] - side.y, hole.cup[0] - side.x);
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

    // The hole is finished and being read before the next tee.
    if (this.#holeSteps > 0) {
      this.#holeSteps -= 1;
      if (this.#holeSteps === 0) this.#nextHole();
      return;
    }

    // The ball has stopped and is being looked at before the turn passes.
    if (this.#restSteps > 0) {
      this.#restSteps -= 1;
      if (this.#restSteps === 0) this.#finishStroke();
      return;
    }

    if (this.#position.phase === 'rolling') {
      const result = step(this.#position, fixedDeltaSeconds);
      if (result.settled) {
        this.#event = result.sunk ? 'IN THE CUP' : result.splashed ? 'IN THE WATER' : '';
        this.#restSteps = this.#stepsFor(REST_SECONDS);
      }
      return;
    }
    if (this.#position.phase !== 'aiming') return;

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
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;
    // Two rolls, drawn once for the whole stroke: its line and its weight. A fresh error
    // every step averages to zero and all three tiers would putt the same.
    const profile = BOT_PROFILES[difficulty];
    botAim(this.#aim, this.#position, profile, this.#rng.float(), this.#rng.float());
    this.#angle = this.#aim.angle;
    this.#power = this.#aim.power;
    if (putt(this.#position, this.#position.seat, this.#aim.angle, this.#aim.power)) {
      this.#event = '';
    }
  }

  /**
   * Aiming, on either instrument, with no mode to switch between them.
   *
   * The finger draws the putter back: put it down behind the ball, pull away from it, and
   * let go — the ball leaves along the line from the finger *through* the ball, and how far
   * you pulled is how hard it is struck. The keyboard says the same thing in the only terms
   * it has: steer to swing the line, hold to build the stroke, release to play it.
   */
  #updateAim(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const side = ballOf(this.#position, this.#position.seat);
    const pointer = seatInput.pointer;

    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const dx = side.x - this.#pointerWorld.x;
      const dy = side.y - this.#pointerWorld.y;
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
    // `holdSeconds` is zero on the step the key comes up, so the power has to be carried in
    // a field rather than read again at the release.
    if (pointer === null && seatInput.actionHeld) {
      this.#power = clamp(seatInput.holdSeconds / HOLD_FOR_FULL_POWER, 0, 1);
    }

    // `putt` refuses a stroke with no weight behind it, so the release does not re-check it:
    // its return value is what decides whether a stroke happened at all.
    if (seatInput.actionReleased) {
      if (putt(this.#position, this.#position.seat, this.#angle, this.#power)) this.#event = '';
      else this.#power = 0;
    }
  }

  #finishStroke(): void {
    // Held across the call, because `settleStroke` is what decides the ball has run out of
    // strokes and it also hands the turn to somebody else.
    const played = ballOf(this.#position, this.#position.seat);
    const outcome = settleStroke(this.#position);
    if (played.pickedUp && !played.holed) this.#event = 'PICKED UP';
    if (outcome.holeOver) {
      this.#holeSteps = this.#stepsFor(HOLE_SECONDS);
      return;
    }
    this.#beginStroke();
  }

  #nextHole(): void {
    settleHole(this.#position);
    this.#event =
      this.#position.lastHole === 'halved' ? 'HOLE HALVED' : `HOLE TO PLAYER ${this.#seatName()}`;
    if (this.#position.winner !== null) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }
    this.#beginStroke();
  }

  #seatName(): string {
    return this.#position.lastHole === 'p1' ? 'ONE' : 'TWO';
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
      p1: this.#position.points.p1,
      p2: this.#position.points.p2,
      winner: this.#matchWinner,
    };
  }

  onPause(): void {
    // Nobody comes back to a putter half drawn.
    this.#power = 0;
  }

  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#restSteps = 0;
    this.#holeSteps = 0;
    this.#settleSteps = 0;
    this.#power = 0;
    this.#event = '';
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SURROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawGreen(renderer);
    this.#drawHazards(renderer);
    this.#drawCup(renderer);
    this.#drawWalls(renderer);
    this.#drawBalls(renderer);
    if (this.#position.phase === 'aiming') this.#drawAim(renderer);
    this.#drawCard(renderer);
    this.#drawScoreboard(renderer);
    renderer.popSeatRotation();
  }

  #drawGreen(renderer: Renderer): void {
    const width = GREEN_RIGHT - GREEN_LEFT;
    const height = GREEN_BOTTOM - GREEN_TOP;
    renderer.rect(GREEN_LEFT - 12, GREEN_TOP - 12, width + 24, height + 24, COLOUR_ROUGH);
    renderer.rect(GREEN_LEFT, GREEN_TOP, width, height, COLOUR_GREEN);
    renderer.strokeRect(GREEN_LEFT, GREEN_TOP, width, height, 3, COLOUR_GREEN_EDGE);
  }

  /**
   * Rule 7 again, for the ground rather than the players: sand is hatched and water is
   * ruled with wave lines, so the two hazards are still different things in greyscale.
   */
  #drawHazards(renderer: Renderer): void {
    const hole = holeAt(this.#position.hole);
    for (const patch of hole.sand) {
      renderer.rect(patch.x, patch.y, patch.w, patch.h, COLOUR_SAND);
      for (let y = patch.y + 16; y < patch.y + patch.h; y += 22) {
        renderer.line(patch.x + 10, y, patch.x + patch.w - 10, y - 8, 2, COLOUR_SAND_MARK);
      }
    }
    for (const pond of hole.water) {
      renderer.rect(pond.x, pond.y, pond.w, pond.h, COLOUR_WATER);
      for (let y = pond.y + 20; y < pond.y + pond.h; y += 30) {
        renderer.line(pond.x + 14, y, pond.x + pond.w * 0.45, y, 3, COLOUR_WATER_MARK);
        renderer.line(pond.x + pond.w * 0.55, y, pond.x + pond.w - 14, y, 3, COLOUR_WATER_MARK);
      }
    }
  }

  /** Drawn before the walls, so a flag beside a block is behind it rather than through it. */
  #drawCup(renderer: Renderer): void {
    const hole = holeAt(this.#position.hole);
    const x = hole.cup[0];
    const y = hole.cup[1];
    renderer.circle(x, y, CUP_RADIUS, COLOUR_CUP);
    renderer.strokeCircle(x, y, CUP_RADIUS, 3, COLOUR_GREEN_EDGE);
    renderer.line(x, y, x, y - 46, 3, COLOUR_FLAG);
    renderer.rect(x + 2, y - 46, 26, 16, COLOUR_FLAG);
  }

  #drawWalls(renderer: Renderer): void {
    for (const wall of holeAt(this.#position.hole).walls) {
      renderer.rect(wall.x, wall.y, wall.w, wall.h, COLOUR_WALL);
      renderer.rect(wall.x, wall.y, wall.w, 6, COLOUR_WALL_TOP);
    }
  }

  /**
   * Rule 7 for the balls: seat one is a disc with a ring cut in it, seat two a disc with a
   * bar across it, so the two are told apart with every colour removed. The ball whose turn
   * it is wears a halo, which is how the board itself says who is to play.
   */
  #drawBalls(renderer: Renderer): void {
    for (const seat of ['p1', 'p2'] as const) {
      const side = ballOf(this.#position, seat);
      if (side.holed || side.pickedUp) continue;
      const palette = SEAT_PALETTE[seat];
      if (seat === this.#position.seat) {
        renderer.strokeCircle(side.x, side.y, BALL_RADIUS + 7, 3, palette.base);
      }
      renderer.circle(side.x, side.y, BALL_RADIUS, palette.base);
      if (seat === 'p1') renderer.strokeCircle(side.x, side.y, BALL_RADIUS * 0.5, 3, palette.deep);
      else renderer.rect(side.x - BALL_RADIUS, side.y - 3, BALL_RADIUS * 2, 6, palette.deep);
    }
  }

  #drawAim(renderer: Renderer): void {
    const seat = this.#position.seat;
    const side = ballOf(this.#position, seat);
    if (side.holed || side.pickedUp) return;
    const palette = SEAT_PALETTE[seat];
    const dx = Math.cos(this.#angle);
    const dy = Math.sin(this.#angle);

    // The line the ball will take, dashed so it reads as an intention rather than a wall,
    // and cut at the edge of the green so nothing is ever drawn off the board.
    const reach = this.#lengthInside(side.x, side.y, dx, dy, 110 + this.#power * 300);
    for (let at = BALL_RADIUS + 8; at < reach; at += 26) {
      const to = Math.min(at + 13, reach);
      const x2 = side.x + dx * to;
      const y2 = side.y + dy * to;
      renderer.line(side.x + dx * at, side.y + dy * at, x2, y2, 4, COLOUR_GUIDE);
    }

    // The putter, drawn back behind the ball by how hard the stroke will be. A player reads
    // the weight off the backswing, not off a number.
    const back = this.#lengthInside(side.x, side.y, -dx, -dy, 24 + this.#power * 96);
    const headX = side.x - dx * back;
    const headY = side.y - dy * back;
    renderer.line(
      headX - dy * 22,
      headY + dx * 22,
      headX + dy * 22,
      headY - dx * 22,
      7,
      palette.base,
    );
    const gripX = side.x - dx * (BALL_RADIUS + 4);
    const gripY = side.y - dy * (BALL_RADIUS + 4);
    renderer.line(gripX, gripY, headX, headY, 4, palette.deep);
  }

  /** How far a ray from a point may run before it leaves the green. */
  #lengthInside(x: number, y: number, dx: number, dy: number, wanted: number): number {
    let reach = wanted;
    if (dx > 0) reach = Math.min(reach, (GREEN_RIGHT - BALL_RADIUS - x) / dx);
    if (dx < 0) reach = Math.min(reach, (GREEN_LEFT + BALL_RADIUS - x) / dx);
    if (dy > 0) reach = Math.min(reach, (GREEN_BOTTOM - BALL_RADIUS - y) / dy);
    if (dy < 0) reach = Math.min(reach, (GREEN_TOP + BALL_RADIUS - y) / dy);
    return reach > 0 ? reach : 0;
  }

  #drawCard(renderer: Renderer): void {
    const hole = holeAt(this.#position.hole);
    const shown = Math.min(this.#position.hole + 1, HOLES);
    const card = `HOLE ${String(shown)} OF ${String(HOLES)}  ·  PAR ${String(hole.par)}`;
    renderer.text(card, this.#logical.width / 2, CARD_Y, 28, COLOUR_TEXT, 'centre');
    if (this.#event !== '') {
      renderer.text(this.#event, this.#logical.width / 2, CARD_Y + 28, 22, COLOUR_MUTED, 'centre');
    }
  }

  /**
   * The scoreboard: holes won, and strokes played at the hole in hand.
   *
   * Strokes matter as well as points, because the round is decided on them if the ninth hole
   * leaves the two level — and because a player needs to see how close they are to the
   * pick-up at {@link MAX_STROKES}.
   */
  #drawScoreboard(renderer: Renderer): void {
    const width = this.#logical.width;
    renderer.rect(0, BOARD_TOP, width, this.#logical.height - BOARD_TOP, COLOUR_BOARD);
    for (const seat of ['p1', 'p2'] as const) {
      const palette = SEAT_PALETTE[seat];
      const y = BOARD_TOP + (seat === 'p1' ? 34 : 78);
      const side = ballOf(this.#position, seat);

      if (seat === this.#position.seat) {
        // An arrowhead at whoever is to play. Shape as well as colour, per rule 7.
        renderer.line(18, y - 12, 34, y, 5, palette.base);
        renderer.line(34, y, 18, y + 12, 5, palette.base);
      }
      renderer.circle(62, y, 15, palette.base);
      if (seat === 'p1') renderer.strokeCircle(62, y, 7, 3, palette.deep);
      else renderer.rect(47, y - 4, 30, 8, palette.deep);

      const points = seat === 'p1' ? this.#position.points.p1 : this.#position.points.p2;
      renderer.text(`${String(points)} pts`, 96, y, 26, COLOUR_TEXT);
      const strokes = side.pickedUp
        ? 'picked up'
        : `${String(side.strokes)} of ${String(MAX_STROKES)}`;
      renderer.text(strokes, width - 20, y, 24, COLOUR_MUTED, 'right');
    }
  }
}
