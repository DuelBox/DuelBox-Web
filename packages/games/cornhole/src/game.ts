import { Rng, SEAT_PALETTE, SeatFlip, seatView, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BAG_RADIUS,
  BOARD_BOTTOM,
  BOARD_LEFT,
  BOARD_RIGHT,
  BOARD_TOP,
  BOT_PROFILES,
  FLIGHT_SECONDS,
  HOLE_RADIUS,
  HOLE_X,
  HOLE_Y,
  MAX_DRIFT,
  THROW_X,
  THROW_Y,
  botAim,
  createGame,
  resetGame,
  settleRound,
  step,
  throwBag,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/**
 * Cornhole — aim, pull back for power, let go.
 *
 * The archetype's second game, and the first place the aiming control had to be designed
 * rather than copied: Darts moves a reticle, and a throw here has a *power* as well as a
 * direction, so it is a pull-back rather than a point.
 */

const COLOUR_BACKGROUND = '#16241c';
const COLOUR_GRASS = '#1d3327';
const COLOUR_BOARD = '#b8834a';
const COLOUR_BOARD_EDGE = '#7d5630';
const COLOUR_HOLE = '#0d1410';
const COLOUR_INK = '#111a14';
const COLOUR_GUIDE = 'rgba(240, 246, 240, 0.4)';

/** How long the round result is held before the next round starts. */
const ROUND_PAUSE_SECONDS = 1.6;
const THINK_SECONDS = 0.7;

/** How long a full-power keyboard hold takes. */
const HOLD_FOR_FULL_POWER = 1.1;

/** How far the drag control reaches, in logical units. */
const DRAG_RANGE = 260;

export class CornholeGame implements Game {
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
  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #pauseSteps = 0;

  /** The aim being set up, in the same units the rules take. */
  #angle = 0;
  #power = 0;
  /** True once this seat has touched the controls, so an untouched throw is not sent. */
  #ready = false;
  /** Where a drag began, or null. */
  #dragX = 0;
  #dragY = 0;
  #dragging = false;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetGame(this.#position);
    this.#resetAim();
    this.#thinkSteps = -1;
    this.#pauseSteps = 0;
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#matchWinner !== null) return;

    step(this.#position, fixedDeltaSeconds);

    if (this.#position.phase === 'round-over') {
      if (this.#pauseSteps === 0) this.#pauseSteps = this.#stepsFor(ROUND_PAUSE_SECONDS);
      this.#pauseSteps -= 1;
      if (this.#pauseSteps === 0) {
        settleRound(this.#position);
        this.#position.phase = 'aiming';
        this.#resetAim();
        this.#matchWinner = winnerOf(this.#position);
      }
      return;
    }
    if (this.#position.phase !== 'aiming') return;

    const active = this.#position.toThrow;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      const aim = { angle: 0, power: 0 };
      botAim(aim, BOT_PROFILES[difficulty], this.#rng);
      this.#angle = aim.angle;
      this.#power = aim.power;
      throwBag(this.#position, active, aim.angle, aim.power, this.#rng);
      this.#resetAim();
      return;
    }

    const seatInput = input.seat(active);
    if (!this.#flip.acceptsInput) return;

    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      if (!this.#dragging) {
        this.#dragging = true;
        this.#dragX = this.#pointerWorld.x;
        this.#dragY = this.#pointerWorld.y;
      }
      // Sideways for aim, and **pulling back** — down the screen — for power, which is the
      // gesture the object itself suggests.
      this.#angle = clamp((this.#pointerWorld.x - this.#dragX) / DRAG_RANGE, -1, 1);
      this.#power = clamp((this.#pointerWorld.y - this.#dragY) / DRAG_RANGE, 0, 1);
      this.#ready = true;
    }

    // Keyboard: steer to aim, hold to build power, release to throw.
    const axis = seatInput.move.x;
    if (Math.abs(axis) > 0.2) {
      this.#angle = clamp(this.#angle + axis * fixedDeltaSeconds * 1.4, -1, 1);
      this.#ready = true;
    }
    if (pointer === null && seatInput.actionHeld) {
      this.#power = clamp(seatInput.holdSeconds / HOLD_FOR_FULL_POWER, 0, 1);
      this.#ready = true;
    }

    // Release throws — a finger lifting or an action key coming up — and both arrive with
    // the pointer already gone, so the aim has to have been kept rather than re-read.
    if (seatInput.actionReleased && this.#ready && this.#power > 0) {
      throwBag(this.#position, active, this.#angle, this.#power, this.#rng);
      this.#resetAim();
    }
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawField(renderer);
    this.#drawBags(renderer);
    if (this.#position.phase === 'flying') this.#drawFlight(renderer, alpha);
    else if (this.#position.phase === 'aiming') this.#drawAim(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {
    this.#resetAim();
  }

  onResume(): void {
    // An aim half-pulled when the game paused is not an aim anybody still means.
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.score.p1,
      p2: this.#position.score.p2,
      winner: this.#matchWinner,
    };
  }

  getActiveSeat(): SeatId {
    return this.#position.toThrow;
  }

  destroy(): void {
    resetGame(this.#position);
    this.#resetAim();
    this.#matchWinner = null;
  }

  /** Read-only views for the tests and the harness. */
  get position(): Readonly<Position> {
    return this.#position;
  }

  get aim(): { angle: number; power: number; ready: boolean } {
    return { angle: this.#angle, power: this.#power, ready: this.#ready };
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    return seatView(this.#position.toThrow, this.#presentation, this.#localSeat).rotated;
  }

  #resetAim(): void {
    this.#angle = 0;
    this.#power = 0;
    this.#ready = false;
    this.#dragging = false;
  }

  #drawField(renderer: Renderer): void {
    renderer.rect(0, 0, this.#logical.width, this.#logical.height, COLOUR_GRASS);
    renderer.rect(
      BOARD_LEFT,
      BOARD_TOP,
      BOARD_RIGHT - BOARD_LEFT,
      BOARD_BOTTOM - BOARD_TOP,
      COLOUR_BOARD,
    );
    renderer.strokeRect(
      BOARD_LEFT,
      BOARD_TOP,
      BOARD_RIGHT - BOARD_LEFT,
      BOARD_BOTTOM - BOARD_TOP,
      6,
      COLOUR_BOARD_EDGE,
    );
    renderer.circle(HOLE_X, HOLE_Y, HOLE_RADIUS, COLOUR_HOLE);
    renderer.strokeCircle(HOLE_X, HOLE_Y, HOLE_RADIUS, 4, COLOUR_INK);
  }

  /**
   * Bags, told apart by shape as well as colour.
   *
   * p1's are round and p2's are square — rule 7, and it matters more here than it looks,
   * because working out whose bags are where *is* the scoring.
   */
  #drawBags(renderer: Renderer): void {
    for (const bag of this.#position.bags) {
      if (bag.holed) continue;
      const palette = SEAT_PALETTE[bag.seat];
      if (bag.seat === 'p1') {
        renderer.circle(bag.x, bag.y, BAG_RADIUS, palette.base);
        renderer.strokeCircle(bag.x, bag.y, BAG_RADIUS - 3, 4, COLOUR_INK);
      } else {
        renderer.rect(bag.x - BAG_RADIUS, bag.y - BAG_RADIUS, BAG_RADIUS * 2, BAG_RADIUS * 2, palette.base);
        renderer.strokeRect(
          bag.x - BAG_RADIUS + 3,
          bag.y - BAG_RADIUS + 3,
          BAG_RADIUS * 2 - 6,
          BAG_RADIUS * 2 - 6,
          4,
          COLOUR_INK,
        );
      }
    }
  }

  #drawFlight(renderer: Renderer, alpha: number): void {
    const position = this.#position;
    // How far through the flight, including the fraction of the step still unplayed.
    const left = Math.max(0, position.flight - alpha * (1 / (this.#stepsPerSecond || 60)));
    const t = 1 - clamp(left / FLIGHT_SECONDS, 0, 1);
    const x = position.from.x + (position.to.x - position.from.x) * t;
    const y = position.from.y + (position.to.y - position.from.y) * t;
    // A lob rather than a slide: it rises and falls, so the throw reads as a throw.
    const lift = Math.sin(t * Math.PI) * 70;
    const palette = SEAT_PALETTE[position.toThrow];
    renderer.circle(x, y - lift, BAG_RADIUS * 0.95, palette.base);
    renderer.strokeCircle(x, y - lift, BAG_RADIUS * 0.95, 3, COLOUR_INK);
  }

  /**
   * The aim, shown as a line from the throwing spot.
   *
   * Length is power and direction is aim, so both halves of the throw are one gesture and
   * one picture. A player who has not touched the controls sees nothing, which is how they
   * can tell it is their turn but nothing is committed.
   */
  #drawAim(renderer: Renderer): void {
    if (!this.#ready) return;
    const reach = 60 + this.#power * 200;
    const tipX = THROW_X + this.#angle * MAX_DRIFT * (reach / 260);
    const tipY = THROW_Y - reach;
    const palette = SEAT_PALETTE[this.#position.toThrow];
    renderer.line(THROW_X, THROW_Y, tipX, tipY, 8, palette.base);
    renderer.circle(tipX, tipY, 14, palette.base);
    // A ladder of ticks, so power is legible as a count and not only as a length.
    const ticks = Math.round(this.#power * 5);
    for (let i = 0; i < ticks; i += 1) {
      renderer.rect(THROW_X - 74, THROW_Y - 20 - i * 26, 32, 16, palette.base);
    }
    renderer.strokeRect(THROW_X - 78, THROW_Y - 156, 40, 152, 3, COLOUR_GUIDE);
  }
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

const gameModule = {
  manifest,
  create: (): Game => new CornholeGame(),
};

export default gameModule;
