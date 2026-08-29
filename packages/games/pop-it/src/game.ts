import {
  GridCursor,
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  seatView,
  set,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  ROW_COUNT,
  WIDEST_ROW,
  applyMove,
  bestMove,
  createGame,
  isLegalMove,
  resetGame,
  rowStart,
  sizeOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/**
 * Pop It — press any run of bubbles in one row, and do not press the last one.
 *
 * The interaction this game adds is a **run**: a move is two bubbles and everything
 * between them, so it has a beginning and an end rather than being a single tap.
 */

export const BUBBLE_PITCH = 132;
export const BUBBLE_RADIUS = 52;
const SHEET_PAD = 34;

const COLOUR_BACKGROUND = '#141b28';
const COLOUR_SHEET = '#f2e9dc';
const COLOUR_SHEET_EDGE = '#d8cbb8';
const COLOUR_UP = '#ffffff';
const COLOUR_UP_EDGE = '#c9bba6';
const COLOUR_DOWN = '#cdbfa9';
const COLOUR_INK = '#2a2016';

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.55;
const SETTLE_SECONDS = 1.2;

/** Width of the widest row, used to centre every other row under it. */
const SHEET_WIDTH = (WIDEST_ROW - 1) * BUBBLE_PITCH;
const SHEET_HEIGHT = (ROW_COUNT - 1) * BUBBLE_PITCH;

/** The sheet's full extent, bubbles and border together. */
const SHEET_OUTER_WIDTH = SHEET_WIDTH + (SHEET_PAD + BUBBLE_RADIUS) * 2;
const SHEET_OUTER_HEIGHT = SHEET_HEIGHT + (SHEET_PAD + BUBBLE_RADIUS) * 2;

/**
 * Where the first bubble sits — **derived so the sheet is centred in the logical box**.
 *
 * It was a hand-picked 120 first, which left the sheet 66 units up and to the left of
 * centre. That is invisible until the board turns: `pushRotation` turns about the logical
 * centre, so an off-centre board *moves* when it rotates. The sheet jumped across the
 * screen between turns, and every tap the second player aimed at it landed on nothing.
 *
 * Any game that rotates its board has to be centred, so this is computed rather than
 * chosen, and a test asserts it.
 */
export const BOARD_ORIGIN_X = (900 - SHEET_OUTER_WIDTH) / 2 + SHEET_PAD + BUBBLE_RADIUS;
export const BOARD_ORIGIN_Y = (900 - SHEET_OUTER_HEIGHT) / 2 + SHEET_PAD + BUBBLE_RADIUS;

/** The centre of a bubble, in logical units. */
export function bubbleCentre(out: Vec2, row: number, index: number): Vec2 {
  const size = sizeOf(row);
  const indent = ((WIDEST_ROW - size) * BUBBLE_PITCH) / 2;
  return set(
    out,
    BOARD_ORIGIN_X + indent + index * BUBBLE_PITCH,
    BOARD_ORIGIN_Y + row * BUBBLE_PITCH,
  );
}

/** The bubble a point falls on, or null. */
export function bubbleAt(x: number, y: number): { row: number; index: number } | null {
  for (let row = 0; row < ROW_COUNT; row += 1) {
    const size = sizeOf(row);
    for (let index = 0; index < size; index += 1) {
      bubbleCentre(hitScratch, row, index);
      const dx = x - hitScratch.x;
      const dy = y - hitScratch.y;
      if (dx * dx + dy * dy <= BUBBLE_RADIUS * BUBBLE_RADIUS) return { row, index };
    }
  }
  return null;
}

const hitScratch: Vec2 = vec2();

export class PopItGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({ columns: WIDEST_ROW, rows: ROW_COUNT, startIndex: 0 });

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | null = null;
  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #settleSteps = 0;

  /** Where a run started, or -1. A run has a beginning and an end. */
  #anchorRow = -1;
  #anchorIndex = -1;
  /** The far end of the run being chosen, which follows the finger or the cursor. */
  #reachIndex = -1;
  /**
   * Whether the run being chosen was begun by a finger rather than by the cursor.
   *
   * The pointer is already gone on the step a release is reported, so the release cannot
   * ask where the finger is — it can only ask how the run started. A run begun from the
   * keyboard must not be committed by a release at all, or a single tap of the action key
   * would begin and end it at once.
   */
  #anchorFromPointer = false;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetGame(this.#position);
    this.#clearRun();
    this.#thinkSteps = -1;
    this.#settleSteps = 0;
    this.#cursor.reset();
    this.#flip.snap(this.#shouldRotate());
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
    if (winnerOf(this.#position) !== null) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    const active = this.#position.toMove;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      const move = bestMove(this.#position, this.#rng, difficulty);
      if (move !== null) applyMove(this.#position, move.row, move.from, move.to);
      return;
    }

    const seatInput = input.seat(active);
    if (!this.#flip.acceptsInput) return;
    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    // Two different questions, and conflating them was a bug: *where is the finger now*
    // decides whether a press counts, and *what did it last touch* decides what a release
    // commits — because the pointer is already gone on the step the release is reported.
    let overNow: { row: number; index: number } | null = null;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      overNow = bubbleAt(this.#pointerWorld.x, this.#pointerWorld.y);
      // Dragging extends the run, but only within the row it began in.
      if (overNow !== null && this.#anchorRow === overNow.row) this.#reachIndex = overNow.index;
    }

    // Press and release are handled in the same step, not as alternatives.
    //
    // A quick tap arrives with both flags set on one step — press and release inside a
    // single frame is what most touchscreen taps look like — so treating the release as
    // an `else` meant a tap began a run and never finished it. Nothing happened at all
    // unless you held the finger down long enough to straddle two steps. This codebase
    // has shipped that exact bug once before, in the very first game.
    if (seatInput.actionPressed) {
      // A finger that went down between the bubbles has hit nothing, and must not fall
      // back on either the cursor or whichever bubble it happened to touch last.
      if (pointer === null) this.#beginRun(null);
      else if (overNow !== null) this.#beginRun(overNow);
    }
    if (seatInput.actionReleased && this.#anchorRow >= 0 && this.#anchorFromPointer) {
      // A finger lifting commits. A keyboard has no release worth the name, so a run
      // begun from the cursor waits for a second press instead.
      this.#commitRun();
    }
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawSheet(renderer);
    this.#drawBubbles(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {
    // A half-chosen run does not survive a pause: coming back to a selection you cannot
    // remember starting is worse than starting again.
    this.#clearRun();
  }

  onResume(): void {
    // Nothing: `onPause` already dropped any half-chosen run, and clearing again here
    // would be a second mechanism for one rule. A mutation of a redundant line fails no
    // test, which is how this one was noticed.
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.pressed.p1,
      p2: this.#position.pressed.p2,
      winner: this.#matchWinner,
    };
  }

  getActiveSeat(): SeatId {
    return this.#position.toMove;
  }

  destroy(): void {
    resetGame(this.#position);
    this.#clearRun();
    this.#matchWinner = null;
  }

  /** Read-only views for the tests and the harness. */
  get position(): Readonly<Position> {
    return this.#position;
  }

  /** The run being chosen, or null. */
  get run(): { row: number; from: number; to: number } | null {
    if (this.#anchorRow < 0) return null;
    const from = Math.min(this.#anchorIndex, this.#reachIndex);
    const to = Math.max(this.#anchorIndex, this.#reachIndex);
    return { row: this.#anchorRow, from, to };
  }

  get cursorBubble(): { row: number; index: number } | null {
    const row = this.#cursor.row;
    const index = this.#cursor.column;
    if (index >= sizeOf(row)) return null;
    return { row, index };
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    return seatView(this.#position.toMove, this.#presentation, this.#localSeat).rotated;
  }

  #clearRun(): void {
    this.#anchorRow = -1;
    this.#anchorIndex = -1;
    this.#reachIndex = -1;
    this.#anchorFromPointer = false;
  }

  /**
   * Begin a run, or end one.
   *
   * A finger begins on press and commits on release. A keyboard has no release to speak
   * of, so its second press is what commits — which also lets a player see the run they
   * are about to make before making it.
   */
  #beginRun(fromPointer: { row: number; index: number } | null): void {
    const at = fromPointer ?? this.cursorBubble;
    if (at === null || at.row < 0 || at.index < 0) return;

    if (fromPointer === null && this.#anchorRow >= 0) {
      this.#reachIndex = this.#anchorRow === at.row ? at.index : this.#reachIndex;
      this.#commitRun();
      return;
    }
    if (!isLegalMove(this.#position, at.row, at.index, at.index)) return;
    this.#anchorRow = at.row;
    this.#anchorIndex = at.index;
    this.#reachIndex = at.index;
    this.#anchorFromPointer = fromPointer !== null;
  }

  #commitRun(): void {
    const run = this.run;
    this.#clearRun();
    if (run === null) return;
    applyMove(this.#position, run.row, run.from, run.to);
  }

  #drawSheet(renderer: Renderer): void {
    const left = BOARD_ORIGIN_X - SHEET_PAD - BUBBLE_RADIUS;
    const top = BOARD_ORIGIN_Y - SHEET_PAD - BUBBLE_RADIUS;
    renderer.rect(left, top, SHEET_OUTER_WIDTH, SHEET_OUTER_HEIGHT, COLOUR_SHEET);
    renderer.strokeRect(left, top, SHEET_OUTER_WIDTH, SHEET_OUTER_HEIGHT, 6, COLOUR_SHEET_EDGE);
  }

  /**
   * A bubble is up, down, chosen, or under the cursor.
   *
   * Pressed bubbles are drawn **sunken and darker**, and the run being chosen is ringed in
   * the seat's own colour with a bar across it, so it reads as a shape rather than a
   * shade — rule 7, and the difference between up and down is the whole board.
   */
  #drawBubbles(renderer: Renderer): void {
    const run = this.run;
    const cursor = this.cursorBubble;
    const seat = this.#position.toMove;
    const palette = SEAT_PALETTE[seat];

    for (let row = 0; row < ROW_COUNT; row += 1) {
      const start = rowStart(row);
      const size = sizeOf(row);
      for (let index = 0; index < size; index += 1) {
        bubbleCentre(this.#scratch, row, index);
        const x = this.#scratch.x;
        const y = this.#scratch.y;
        const down = this.#position.popped[start + index] === true;

        if (down) {
          renderer.circle(x, y, BUBBLE_RADIUS * 0.82, COLOUR_DOWN);
          renderer.strokeCircle(x, y, BUBBLE_RADIUS * 0.82, 4, COLOUR_INK);
        } else {
          renderer.circle(x, y, BUBBLE_RADIUS, COLOUR_UP);
          renderer.strokeCircle(x, y, BUBBLE_RADIUS - 3, 5, COLOUR_UP_EDGE);
        }

        const chosen =
          run !== null && run.row === row && index >= run.from && index <= run.to && !down;
        if (chosen) {
          renderer.strokeCircle(x, y, BUBBLE_RADIUS + 6, 6, palette.base);
          renderer.rect(x - BUBBLE_RADIUS * 0.5, y - 4, BUBBLE_RADIUS, 8, palette.base);
        }
        if (
          cursor !== null &&
          cursor.row === row &&
          cursor.index === index &&
          this.#cursor.visible
        ) {
          renderer.strokeCircle(x, y, BUBBLE_RADIUS + 14, 4, palette.deep);
        }
      }
    }
  }
}

const gameModule = {
  manifest,
  create: (): Game => new PopItGame(),
};

export default gameModule;
