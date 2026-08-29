import {
  GridCursor,
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  seatRotated,
  set,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CELL_COUNT,
  MARK_P1,
  PIECES,
  PIECES_PER_MATCH,
  SIZE,
  TRAY_SIZE,
  chooseMove,
  columnOf,
  createMatch,
  fitsAt,
  encodeMove,
  isOver,
  playMove,
  rowOf,
  topLeftFor,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, MatchState } from './rules.js';

/**
 * Geometry in logical units. Exported because working out which slot a tap landed in is
 * not a rendering question — the tests and the control-parity harness need the same
 * mapping the game uses.
 *
 * The board and the tray are **one ten-row lattice**, not two widgets. Row 9 is the tray,
 * three shapes each three columns wide. That is what lets a single `GridCursor` carry a
 * keyboard player from the shape they want to the square they want with no modes and no
 * second control scheme, and it makes a tap and a key press mean exactly the same thing:
 * the slot under me. Sudoku's digit pad is the same idea and the reasoning is its.
 */
export const BOARD_X = 54;
export const BOARD_Y = 46;
export const CELL_EXTENT = 88;
export const BOARD_EXTENT = CELL_EXTENT * SIZE;
export const TRAY_GAP = 30;
export const TRAY_Y = BOARD_Y + BOARD_EXTENT + TRAY_GAP;
export const TRAY_HEIGHT = 100;
export const TRAY_SLOT_WIDTH = BOARD_EXTENT / TRAY_SIZE;
export const SLOT_COUNT = CELL_COUNT + TRAY_SIZE;

/** The box of shapes still to be dealt, as a bar above the board. */
const DEAL_BAR_Y = 16;
const DEAL_BAR_HEIGHT = 14;

const COLOUR_BACKGROUND = '#0f1218';
const COLOUR_FRAME = '#1b212b';
const COLOUR_WELL = '#232b37';
const COLOUR_GRID = '#2f3a49';
const COLOUR_GRID_HEAVY = '#4b5a6e';
const COLOUR_TRAY = '#1a2029';
const COLOUR_TRAY_SPENT = '#151a21';
const COLOUR_HINT = '#8ea0b6';
const COLOUR_CLEAR = '#f2efe6';

const P1 = SEAT_PALETTE.p1;
const P2 = SEAT_PALETTE.p2;

const BLOCK_INSET = 5;
const BLOCK_STUD = 15;
const STUD_WIDTH = 5;
const GRID_WIDTH = 2;
const HEAVY_WIDTH = 5;
const CURSOR_WIDTH = 6;
const SELECT_WIDTH = 7;
const HINT_RADIUS = 9;
const GHOST_WIDTH = 4;
const TRAY_CELL = 26;
const TRAY_STUD = 5;

/**
 * The turn's shape, in seconds. Each is converted to whole simulation steps before being
 * counted, so a replay is exact.
 *
 * `READY_SECONDS` is longer than the shell's 0.36 s seat flip on purpose, and it is in the
 * rules rather than keyed off the flip because **`seatView` reports no rotation at all in
 * single-seat play**: a freeze that asked the flip whether it had finished would step one
 * match on a shared phone and a different one on two phones playing remotely. It applies to
 * a bot as much as to a person, because a bot does not go through the shell and would
 * otherwise get half a second of free thinking a person cannot have.
 */
const READY_SECONDS = 0.5;
const BOT_THINK_SECONDS = 0.35;
const CLEAR_SECONDS = 0.45;
const SETTLE_SECONDS = 1;

/** The centre of a slot: board squares 0..80, then the three tray slots. */
export function slotCentre(out: Vec2, slot: number): Vec2 {
  if (slot < CELL_COUNT) {
    return set(
      out,
      BOARD_X + (columnOf(slot) + 0.5) * CELL_EXTENT,
      BOARD_Y + (rowOf(slot) + 0.5) * CELL_EXTENT,
    );
  }
  const tray = slot - CELL_COUNT;
  return set(out, BOARD_X + (tray + 0.5) * TRAY_SLOT_WIDTH, TRAY_Y + TRAY_HEIGHT / 2);
}

/** The slot a point falls in, or -1 for neither the board nor the tray. */
export function slotIndexAt(x: number, y: number): number {
  const localX = x - BOARD_X;
  if (localX < 0 || localX >= BOARD_EXTENT) return -1;

  const onBoard = y - BOARD_Y;
  if (onBoard >= 0 && onBoard < BOARD_EXTENT) {
    const column = Math.min(SIZE - 1, Math.floor(localX / CELL_EXTENT));
    return Math.min(SIZE - 1, Math.floor(onBoard / CELL_EXTENT)) * SIZE + column;
  }
  const onTray = y - TRAY_Y;
  if (onTray >= 0 && onTray < TRAY_HEIGHT) {
    return CELL_COUNT + Math.min(TRAY_SIZE - 1, Math.floor(localX / TRAY_SLOT_WIDTH));
  }
  return -1;
}

/** Which tray slot a cursor index in row 9 names: three columns each. */
export function traySlotOfCursor(index: number): number {
  return Math.min(TRAY_SIZE - 1, Math.floor((index - CELL_COUNT) / 3));
}

export class BlocksGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  /** Ten rows: the nine of the board, then the tray. */
  readonly #cursor = new GridCursor({ columns: SIZE, rows: SIZE + 1, startIndex: 40 });

  #state: MatchState = createMatch(new Rng(1));
  #rngOpening = new Rng(1);
  #rngResponding = new Rng(2);
  #openingSeat: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #selected = -1;
  #stepsPerSecond = 60;
  #readySteps = 0;
  #thinkSteps = 0;
  #revealSteps = 0;
  #settleSteps = 0;

  init(context: GameContext): void {
    // Two draws from the match generator, in a fixed order: **a stream for the seat that
    // opens and a stream for the seat that answers**, assigned by role rather than by seat
    // label. The two halves of a paired seed — the same match played once with each opening
    // seat — are then exact relabellings of each other, so a seat cannot inherit a bias
    // from which generator it happened to be given. See SPEC.md.
    this.#openingSeat = context.openingSeat;
    this.#state = createMatch(context.rng, context.openingSeat);
    this.#rngOpening = new Rng(context.rng.int(1, 0x7fff_ffff));
    this.#rngResponding = new Rng(context.rng.int(1, 0x7fff_ffff));

    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#revealSteps = 0;
    this.#settleSteps = 0;
    this.#cursor.reset();
    this.#flip.snap(this.#shouldRotate());
    this.#beginTurn();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#state);
      return;
    }

    if (this.#revealSteps > 0) {
      this.#revealSteps -= 1;
      if (this.#revealSteps === 0) this.#afterMove();
      return;
    }

    // Nobody acts while the board is turning to face the seat that is to move. Counted in
    // the simulation rather than off the flip, so both presentations step the same match.
    if (this.#readySteps > 0) {
      this.#readySteps -= 1;
      return;
    }

    const active = this.#state.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      const rng = active === this.#openingSeat ? this.#rngOpening : this.#rngResponding;
      this.#play(chooseMove(this.#state.board, this.#state.tray, active, rng, difficulty));
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the square under a finger is
    // moving, so a tap would name one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);
    if (!seatInput.actionPressed) return;

    let slot = this.#cursor.index;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = slotIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      // A tap on a tray slot is turned back into a lattice index, so the keyboard cursor
      // ends up where the finger went and the two instruments never disagree about state.
      slot = tapped;
      this.#cursor.moveTo(tapped < CELL_COUNT ? tapped : CELL_COUNT + (tapped - CELL_COUNT) * 3);
    } else if (slot >= CELL_COUNT) {
      slot = CELL_COUNT + traySlotOfCursor(slot);
    }

    if (slot >= CELL_COUNT) {
      // Choosing a shape is free and reversible: it commits nothing, and the squares it
      // could go on light up. Only a square spends the turn.
      const tray = slot - CELL_COUNT;
      if ((this.#state.tray[tray] ?? -1) >= 0) this.#selected = tray;
      return;
    }
    if (this.#selected < 0) return;
    const piece = this.#state.tray[this.#selected] ?? -1;
    if (piece < 0) return;
    const topLeft = topLeftFor(piece, slot);
    if (topLeft < 0) return;
    this.#play(encodeMove(this.#selected, topLeft));
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawDealBar(renderer);
    this.#drawWell(renderer);
    this.#drawHints(renderer);
    this.#drawBlocks(renderer);
    this.#drawClearing(renderer);
    this.#drawGhost(renderer);
    this.#drawTray(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#state.scoredP1, p2: this.#state.scoredP2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#state.active;
  }

  destroy(): void {
    this.#state.board.fill(0);
    this.#state.cleared.fill(0);
    this.#state.placedCells.fill(0);
    this.#selected = -1;
  }

  /** Read-only views, for the tests and the harness. */
  get state(): MatchState {
    return this.#state;
  }

  get selectedSlot(): number {
    return this.#selected;
  }

  get cursorIndex(): number {
    return this.#cursor.index;
  }

  get revealing(): boolean {
    return this.#revealSteps > 0;
  }

  #play(move: number): void {
    if (move < 0) {
      // Nowhere to put anything: the match is over and the result stands.
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }
    if (playMove(this.#state, move) < 0) return;
    if (this.#state.lastGain + this.#state.lastLoss > 0) {
      this.#revealSteps = this.#stepsFor(CLEAR_SECONDS);
      return;
    }
    this.#afterMove();
  }

  #afterMove(): void {
    if (isOver(this.#state)) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }
    this.#beginTurn();
  }

  /**
   * The default selection is the first shape in the tray that fits anywhere.
   *
   * Without it a player who only ever taps would have to select before placing, and the
   * first tap of every turn would be swallowed. With it a turn is one press for a thumb
   * and one press for a key, which is what rule 10 asks for.
   */
  #beginTurn(): void {
    this.#readySteps = this.#stepsFor(READY_SECONDS);
    this.#thinkSteps = this.#stepsFor(BOT_THINK_SECONDS);
    this.#selected = -1;
    for (let tray = 0; tray < TRAY_SIZE; tray += 1) {
      const piece = this.#state.tray[tray] ?? -1;
      if (piece < 0) continue;
      if (this.#selected < 0) this.#selected = tray;
      if (this.#anyPlacement(piece)) {
        this.#selected = tray;
        return;
      }
    }
  }

  #anyPlacement(piece: number): boolean {
    const shape = PIECES[piece];
    if (shape === undefined) return false;
    for (let row = 0; row + shape.height <= SIZE; row += 1) {
      for (let column = 0; column + shape.width <= SIZE; column += 1) {
        if (fitsAt(this.#state.board, piece, row * SIZE + column)) return true;
      }
    }
    return false;
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatRotated(this.#state.active, this.#presentation, this.#localSeat);
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  /** How many shapes the box still holds. One object, shared by both players. */
  #drawDealBar(renderer: Renderer): void {
    renderer.rect(BOARD_X, DEAL_BAR_Y, BOARD_EXTENT, DEAL_BAR_HEIGHT, COLOUR_FRAME);
    const left = PIECES_PER_MATCH - this.#state.placed;
    const width = (BOARD_EXTENT * left) / PIECES_PER_MATCH;
    renderer.rect(BOARD_X, DEAL_BAR_Y, width, DEAL_BAR_HEIGHT, COLOUR_GRID_HEAVY);
    // Ticks every six, so it reads as a count of shapes rather than only as a length.
    for (let tick = 6; tick < PIECES_PER_MATCH; tick += 6) {
      const at = BOARD_X + (BOARD_EXTENT * tick) / PIECES_PER_MATCH;
      renderer.line(at, DEAL_BAR_Y, at, DEAL_BAR_Y + DEAL_BAR_HEIGHT, 2, COLOUR_BACKGROUND);
    }
  }

  #drawWell(renderer: Renderer): void {
    renderer.rect(BOARD_X - 10, BOARD_Y - 10, BOARD_EXTENT + 20, BOARD_EXTENT + 20, COLOUR_FRAME);
    renderer.rect(BOARD_X, BOARD_Y, BOARD_EXTENT, BOARD_EXTENT, COLOUR_WELL);
    for (let i = 1; i < SIZE; i += 1) {
      const at = BOARD_X + i * CELL_EXTENT;
      const heavy = i % 3 === 0;
      const width = heavy ? HEAVY_WIDTH : GRID_WIDTH;
      const colour = heavy ? COLOUR_GRID_HEAVY : COLOUR_GRID;
      renderer.line(at, BOARD_Y, at, BOARD_Y + BOARD_EXTENT, width, colour);
      const down = BOARD_Y + i * CELL_EXTENT;
      renderer.line(BOARD_X, down, BOARD_X + BOARD_EXTENT, down, width, colour);
    }
  }

  /**
   * A dot on every square the selected shape may be dropped on.
   *
   * Not advice: which squares a shape fits on is a fact about the position, and working it
   * out by eye for a five-long bar is bookkeeping rather than skill — bookkeeping a thumb
   * and a keyboard are not equally quick at, which would quietly make the game a test of
   * the peripheral. It is the same argument Reversi makes for marking its legal squares.
   */
  #drawHints(renderer: Renderer): void {
    if (this.#matchWinner !== null || this.#revealSteps > 0) return;
    if (this.#selected < 0) return;
    const piece = this.#state.tray[this.#selected] ?? -1;
    if (piece < 0) return;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const topLeft = topLeftFor(piece, cell);
      if (topLeft < 0 || !fitsAt(this.#state.board, piece, topLeft)) continue;
      slotCentre(this.#scratch, cell);
      renderer.circle(this.#scratch.x, this.#scratch.y, HINT_RADIUS, COLOUR_HINT);
    }
  }

  #drawBlocks(renderer: Renderer): void {
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const mark = this.#state.board[cell] ?? 0;
      if (mark === 0) continue;
      this.#drawBlock(
        renderer,
        BOARD_X + columnOf(cell) * CELL_EXTENT,
        BOARD_Y + rowOf(cell) * CELL_EXTENT,
        CELL_EXTENT,
        mark === MARK_P1,
        BLOCK_STUD,
      );
    }
  }

  /**
   * One block.
   *
   * Rule 7: **seat one's blocks carry a solid stud and seat two's carry a ring**, at every
   * size the game draws a block at — on the board and in the tray alike. The two seats'
   * material sits mixed together on one shared board, which is exactly the case the rule
   * was written about, so the shape is the signal and the colour only confirms it.
   */
  #drawBlock(
    renderer: Renderer,
    x: number,
    y: number,
    extent: number,
    first: boolean,
    stud: number,
  ): void {
    const palette = first ? P1 : P2;
    const inset = (extent * BLOCK_INSET) / CELL_EXTENT;
    renderer.rect(x + inset, y + inset, extent - inset * 2, extent - inset * 2, palette.base);
    const cx = x + extent / 2;
    const cy = y + extent / 2;
    if (first) renderer.circle(cx, cy, stud, palette.deep);
    else renderer.strokeCircle(cx, cy, stud, (stud * STUD_WIDTH) / BLOCK_STUD, palette.deep);
  }

  /** The lines that are going: a bright cross through every square coming off the board. */
  #drawClearing(renderer: Renderer): void {
    if (this.#revealSteps === 0) return;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      if ((this.#state.cleared[cell] ?? 0) === 0) continue;
      const x = BOARD_X + columnOf(cell) * CELL_EXTENT;
      const y = BOARD_Y + rowOf(cell) * CELL_EXTENT;
      const inset = 16;
      renderer.line(
        x + inset,
        y + inset,
        x + CELL_EXTENT - inset,
        y + CELL_EXTENT - inset,
        6,
        COLOUR_CLEAR,
      );
      renderer.line(
        x + CELL_EXTENT - inset,
        y + inset,
        x + inset,
        y + CELL_EXTENT - inset,
        6,
        COLOUR_CLEAR,
      );
    }
  }

  /**
   * Where the selected shape would land, under the keyboard cursor.
   *
   * Only once a direction key has been used, so a player who only taps never sees a
   * highlight they did not summon. The legal squares are marked for everybody either way,
   * which is the information the choice actually needs.
   */
  #drawGhost(renderer: Renderer): void {
    if (!this.#cursor.visible || this.#matchWinner !== null) return;
    const index = this.#cursor.index;
    const colour = this.#state.active === 'p1' ? P1.base : P2.base;
    if (index >= CELL_COUNT) {
      const tray = traySlotOfCursor(index);
      renderer.strokeRect(
        BOARD_X + tray * TRAY_SLOT_WIDTH + 4,
        TRAY_Y + 4,
        TRAY_SLOT_WIDTH - 8,
        TRAY_HEIGHT - 8,
        CURSOR_WIDTH,
        colour,
      );
      return;
    }
    renderer.strokeRect(
      BOARD_X + columnOf(index) * CELL_EXTENT + 6,
      BOARD_Y + rowOf(index) * CELL_EXTENT + 6,
      CELL_EXTENT - 12,
      CELL_EXTENT - 12,
      CURSOR_WIDTH,
      colour,
    );
    if (this.#selected < 0) return;
    const piece = this.#state.tray[this.#selected] ?? -1;
    if (piece < 0) return;
    const topLeft = topLeftFor(piece, index);
    if (topLeft < 0) return;
    const shape = PIECES[piece];
    if (shape === undefined) return;
    for (const offset of shape.offsets) {
      const cell = topLeft + offset;
      renderer.strokeRect(
        BOARD_X + columnOf(cell) * CELL_EXTENT + 10,
        BOARD_Y + rowOf(cell) * CELL_EXTENT + 10,
        CELL_EXTENT - 20,
        CELL_EXTENT - 20,
        GHOST_WIDTH,
        colour,
      );
    }
  }

  /** The three shapes on offer, in the colour of whoever is about to own them. */
  #drawTray(renderer: Renderer): void {
    const first = this.#state.active === 'p1';
    for (let tray = 0; tray < TRAY_SIZE; tray += 1) {
      const x = BOARD_X + tray * TRAY_SLOT_WIDTH;
      const piece = this.#state.tray[tray] ?? -1;
      renderer.rect(
        x + 4,
        TRAY_Y,
        TRAY_SLOT_WIDTH - 8,
        TRAY_HEIGHT,
        piece < 0 ? COLOUR_TRAY_SPENT : COLOUR_TRAY,
      );
      if (piece < 0) continue;
      const shape = PIECES[piece];
      if (shape === undefined) continue;
      const originX = x + TRAY_SLOT_WIDTH / 2 - (shape.width * TRAY_CELL) / 2;
      const originY = TRAY_Y + TRAY_HEIGHT / 2 - (shape.height * TRAY_CELL) / 2;
      for (const offset of shape.offsets) {
        const dx = offset % SIZE;
        const dy = (offset - dx) / SIZE;
        this.#drawBlock(
          renderer,
          originX + dx * TRAY_CELL,
          originY + dy * TRAY_CELL,
          TRAY_CELL,
          first,
          TRAY_STUD,
        );
      }
      if (tray === this.#selected) {
        renderer.strokeRect(
          x + 4,
          TRAY_Y,
          TRAY_SLOT_WIDTH - 8,
          TRAY_HEIGHT,
          SELECT_WIDTH,
          first ? P1.base : P2.base,
        );
      }
    }
  }
}

export default {
  manifest,
  create: (): Game => new BlocksGame(),
};
