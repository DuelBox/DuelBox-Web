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
  BOARD_SIZE,
  applyMove,
  bestMove,
  columnOf,
  createGame,
  isCapture,
  legalMoves,
  resetGame,
  rowOf,
  slotAt,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position, Move } from './rules.js';

/**
 * Checkers, on one board both players reach across.
 *
 * The board rotates to face whoever is to move, so each player reads their own men coming
 * towards them — the seat flip and the cursor both come from the engine, as they must.
 *
 * The only interaction this game adds over a place-a-mark board is that a move has **two
 * halves**: lift a piece, then choose where it goes. Everything about that is here rather
 * than in the rules, which know only about positions.
 */

export const BOARD_ORIGIN = 90;
export const BOARD_EXTENT = 720;
export const CELL_EXTENT = BOARD_EXTENT / BOARD_SIZE;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_LIGHT = '#e8dcc4';
const COLOUR_DARK = '#7a5a3c';
const COLOUR_EDGE = 'rgba(232, 220, 196, 0.35)';
const COLOUR_INK = '#161a20';
const COLOUR_HINT = 'rgba(255, 255, 255, 0.62)';
const COLOUR_FORCED = '#ffc94a';

const PIECE_RADIUS = CELL_EXTENT * 0.36;
const PIECE_RING = 5;
const CURSOR_INSET = 6;
const CURSOR_WIDTH = 5;
const HINT_RADIUS = 10;

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.55;
const SETTLE_SECONDS = 1.1;

/** Scratch for asking the rules what is legal. Never allocated per step. */
const moveScratch: Move[] = new Array<Move>(64);

/** The centre of a square, in logical units. */
export function squareCentre(out: Vec2, row: number, column: number): Vec2 {
  return set(
    out,
    BOARD_ORIGIN + (column + 0.5) * CELL_EXTENT,
    BOARD_ORIGIN + (row + 0.5) * CELL_EXTENT,
  );
}

/** The centre of a playable slot. */
export function slotCentre(out: Vec2, slot: number): Vec2 {
  return squareCentre(out, rowOf(slot), columnOf(slot));
}

/** The square index a point falls in, or -1 if it is off the board. */
export function squareAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN;
  const localY = y - BOARD_ORIGIN;
  if (localX < 0 || localY < 0 || localX >= BOARD_EXTENT || localY >= BOARD_EXTENT) return -1;
  const column = Math.min(BOARD_SIZE - 1, Math.floor(localX / CELL_EXTENT));
  const row = Math.min(BOARD_SIZE - 1, Math.floor(localY / CELL_EXTENT));
  return row * BOARD_SIZE + column;
}

/** The playable slot a point falls in, or -1 for a light square or off the board. */
export function slotAtPoint(x: number, y: number): number {
  const square = squareAt(x, y);
  if (square < 0) return -1;
  return slotAt(Math.floor(square / BOARD_SIZE), square % BOARD_SIZE);
}

export class CheckersGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  // The cursor walks all sixty-four squares, light ones included: a cursor that skipped
  // half the board would jump two columns at a time and read as broken.
  readonly #cursor = new GridCursor({
    columns: BOARD_SIZE,
    rows: BOARD_SIZE,
    startIndex: BOARD_SIZE * 5 + 1,
  });

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;
  /** The lifted piece's slot, or -1 when nothing is lifted. */
  #selected = -1;
  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #settleSteps = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetGame(this.#position);
    this.#selected = -1;
    this.#thinkSteps = -1;
    this.#settleSteps = 0;
    this.#cursor.reset();
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Sized here rather than in init: a delay sized before the step rate is known is a
    // delay in the wrong units, and it has bitten this codebase before.
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
      if (move !== null) {
        // Shown lifted for the step it moves, so a watching player sees which piece went.
        this.#selected = move.from;
        applyMove(this.#position, move.from, move.to);
        this.#selected = -1;
      }
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the square under a finger is
    // moving, so a tap would name one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    // A jump that can continue must continue, so the chaining piece is always the lifted
    // one — the player is never asked which piece they meant when there is only one.
    if (this.#position.chain >= 0) this.#selected = this.#position.chain;

    if (!seatInput.actionPressed) return;

    let square = this.#cursor.index;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = squareAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      square = tapped;
      this.#cursor.moveTo(tapped);
    }

    this.#choose(square, active);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawHints(renderer);
    this.#drawCursor(renderer);
    this.#drawPieces(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    const { p1, p2 } = tallyOf(this.#position);
    return { p1, p2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#position.toMove;
  }

  destroy(): void {
    resetGame(this.#position);
    this.#selected = -1;
    this.#matchWinner = null;
  }

  /** Read-only views for the tests and the harness. Never mutate through these. */
  get position(): Readonly<Position> {
    return this.#position;
  }

  get selected(): number {
    return this.#selected;
  }

  get cursorSquare(): number {
    return this.#cursor.index;
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    return seatView(this.#position.toMove, this.#presentation, this.#localSeat).rotated;
  }

  /**
   * One press: either lift a piece, or place the lifted one.
   *
   * Pressing a different piece of your own **re-lifts** rather than being refused. A
   * player changing their mind is the common case, and making them press twice to undo a
   * selection is a worse answer than simply believing the second press.
   */
  #choose(square: number, seat: SeatId): void {
    const row = Math.floor(square / BOARD_SIZE);
    const column = square % BOARD_SIZE;
    const slot = slotAt(row, column);
    // A light square is never a move and never a piece; pressing one is simply nothing.
    if (slot < 0) return;

    const piece = this.#position.slots[slot];
    if (piece !== null && piece !== undefined && piece.seat === seat) {
      // While a chain is running the player has no choice of piece, so a press on another
      // of their own is not a change of mind — it is a misunderstanding, and refusing it
      // silently is kinder than lifting a piece that then cannot move.
      if (this.#position.chain >= 0) return;
      this.#selected = this.#selected === slot ? -1 : slot;
      return;
    }
    if (this.#selected < 0) return;
    if (applyMove(this.#position, this.#selected, slot)) {
      this.#selected = this.#position.chain >= 0 ? this.#position.chain : -1;
    }
  }

  /** Where the lifted piece may go. Written into `out`, returns the count. */
  #destinations(out: number[]): number {
    if (this.#selected < 0) return 0;
    const count = legalMoves(moveScratch, this.#position);
    let found = 0;
    for (let i = 0; i < count; i += 1) {
      const move = moveScratch[i];
      if (move !== undefined && move.from === this.#selected) out[found++] = move.to;
    }
    return found;
  }

  readonly #destinationBuffer: number[] = new Array<number>(16).fill(-1);

  #drawBoard(renderer: Renderer): void {
    renderer.rect(BOARD_ORIGIN, BOARD_ORIGIN, BOARD_EXTENT, BOARD_EXTENT, COLOUR_LIGHT);
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let column = 0; column < BOARD_SIZE; column += 1) {
        if (slotAt(row, column) < 0) continue;
        renderer.rect(
          BOARD_ORIGIN + column * CELL_EXTENT,
          BOARD_ORIGIN + row * CELL_EXTENT,
          CELL_EXTENT,
          CELL_EXTENT,
          COLOUR_DARK,
        );
      }
    }
    renderer.strokeRect(BOARD_ORIGIN, BOARD_ORIGIN, BOARD_EXTENT, BOARD_EXTENT, 4, COLOUR_EDGE);
  }

  /**
   * Where the lifted piece can go, and — when nothing is lifted — which pieces are
   * *forced* to move.
   *
   * The forced-capture marker matters more than it looks: capturing is compulsory, so a
   * player who has not noticed a capture will find every other move refused with no
   * explanation. Marking it turns a mystery into a rule.
   */
  #drawHints(renderer: Renderer): void {
    if (this.#selected >= 0) {
      const count = this.#destinations(this.#destinationBuffer);
      for (let i = 0; i < count; i += 1) {
        const slot = this.#destinationBuffer[i];
        if (slot === undefined || slot < 0) continue;
        slotCentre(this.#scratch, slot);
        renderer.circle(this.#scratch.x, this.#scratch.y, HINT_RADIUS, COLOUR_HINT);
      }
      return;
    }

    const count = legalMoves(moveScratch, this.#position);
    let anyCapture = false;
    for (let i = 0; i < count; i += 1) {
      const move = moveScratch[i];
      if (move !== undefined && isCapture(move)) anyCapture = true;
    }
    if (!anyCapture) return;
    for (let i = 0; i < count; i += 1) {
      const move = moveScratch[i];
      if (move === undefined || !isCapture(move)) continue;
      slotCentre(this.#scratch, move.from);
      renderer.strokeCircle(this.#scratch.x, this.#scratch.y, PIECE_RADIUS + 8, 4, COLOUR_FORCED);
    }
  }

  #drawCursor(renderer: Renderer): void {
    if (!this.#cursor.visible) return;
    renderer.strokeRect(
      BOARD_ORIGIN + this.#cursor.column * CELL_EXTENT + CURSOR_INSET,
      BOARD_ORIGIN + this.#cursor.row * CELL_EXTENT + CURSOR_INSET,
      CELL_EXTENT - CURSOR_INSET * 2,
      CELL_EXTENT - CURSOR_INSET * 2,
      CURSOR_WIDTH,
      SEAT_PALETTE[this.#position.toMove].base,
    );
  }

  /**
   * Rule 7: the two seats' pieces differ in shape as well as colour.
   *
   * p1's are round, p2's are eight-sided. A king carries a raised centre and a ring, so
   * the crown is legible in greyscale too — and telling a king from a man matters as much
   * as telling the seats apart, because it decides which way a piece may go.
   */
  #drawPieces(renderer: Renderer): void {
    for (let slot = 0; slot < this.#position.slots.length; slot += 1) {
      const piece = this.#position.slots[slot];
      if (piece === null || piece === undefined) continue;
      slotCentre(this.#scratch, slot);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      const palette = SEAT_PALETTE[piece.seat];
      const lifted = slot === this.#selected;
      const radius = lifted ? PIECE_RADIUS * 1.1 : PIECE_RADIUS;

      if (piece.seat === 'p1') {
        renderer.circle(x, y, radius, palette.base);
        renderer.strokeCircle(x, y, radius - PIECE_RING / 2, PIECE_RING, palette.deep);
      } else {
        this.#drawOctagon(renderer, x, y, radius, palette.base);
        this.#drawOctagon(renderer, x, y, radius - PIECE_RING, palette.deep);
        this.#drawOctagon(renderer, x, y, radius - PIECE_RING * 1.6, palette.base);
      }

      if (piece.kind === 'king') {
        renderer.circle(x, y, radius * 0.42, COLOUR_INK);
        renderer.strokeCircle(x, y, radius * 0.62, 3, COLOUR_LIGHT);
      }
      if (lifted) renderer.strokeCircle(x, y, radius + 6, 4, COLOUR_LIGHT);
    }
  }

  /** An eight-sided piece, drawn as four bars. Distinct from a disc at a glance. */
  #drawOctagon(renderer: Renderer, x: number, y: number, radius: number, colour: string): void {
    if (radius <= 0) return;
    const across = radius * 2;
    const short = radius * 0.83;
    renderer.rect(x - radius, y - short, across, short * 2, colour);
    renderer.rect(x - short, y - radius, short * 2, across, colour);
  }
}

const gameModule = {
  manifest,
  create: (): Game => new CheckersGame(),
};

export default gameModule;
