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
  CELL_COUNT,
  CLAIMED_P1,
  CLAIMED_P2,
  GIVEN,
  SIZE,
  UNIT_COUNT,
  applyEntry,
  applyForfeit,
  boxUnit,
  candidateMask,
  chooseMove,
  columnOf,
  columnUnit,
  createMatch,
  createMove,
  forcedMove,
  isAllowed,
  isOver,
  rowOf,
  rowUnit,
  unitLeader,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, MatchState, Move } from './rules.js';

/**
 * Geometry in logical units. Exported because working out which square a tap landed in is
 * not a rendering question — the tests and the control-parity harness need the same
 * mapping the game uses.
 *
 * The grid and the digit pad are **one ten-row lattice**, not two widgets. Row 9 is the
 * pad. That is what lets a single `GridCursor` carry a keyboard player from the square
 * they want to the digit they want with no modes, no second control scheme and no way to
 * be stuck in a picker they did not mean to open, and it makes a tap and a key press mean
 * exactly the same thing: "the slot under me".
 */
export const BOARD_X = 45;
export const BOARD_Y = 40;
export const CELL_EXTENT = 90;
export const BOARD_EXTENT = CELL_EXTENT * SIZE;
/** The digit pad sits below the grid, one row of nine, with a gap so it reads as separate. */
export const PAD_GAP = 25;
export const PAD_Y = BOARD_Y + BOARD_EXTENT + PAD_GAP;
export const SLOT_COUNT = CELL_COUNT + SIZE;

const COLOUR_BACKGROUND = '#101317';
const COLOUR_PAPER = '#f3f1e9';
const COLOUR_PAPER_DIM = '#e2dfd3';
const COLOUR_RULE = '#b8b3a3';
const COLOUR_RULE_HEAVY = '#4a4638';
const COLOUR_INK = '#1a1a20';
const COLOUR_INK_SOFT = '#6d6a60';
const COLOUR_MARGIN = '#20242b';

const P1 = SEAT_PALETTE.p1;
const P2 = SEAT_PALETTE.p2;

const DIGIT_SIZE = 52;
const PAD_DIGIT_SIZE = 46;
const GRID_WIDTH = 2;
const HEAVY_WIDTH = 6;
const CURSOR_WIDTH = 6;
const SELECT_WIDTH = 7;
const MARK_RADIUS = 11;

/**
 * The turn's shape, in seconds. Every one of these is converted to whole simulation steps
 * before being counted, so a replay is exact.
 *
 * `READY_SECONDS` is longer than the shell's 0.36 s seat flip on purpose, and it lives
 * here rather than being keyed off the flip because **`seatView` reports no rotation at
 * all in single-seat play**. A freeze that asked the flip whether it had finished would
 * step one match on a shared phone and a different one on two phones playing remotely, and
 * the clock below would then expire on different frames in the two presentations. A test
 * drives the same seed through both and compares.
 */
const READY_SECONDS = 0.5;
const BOT_THINK_SECONDS = 0.35;
const REVEAL_SECONDS = 0.55;
const SETTLE_SECONDS = 1;
/**
 * How long a person has to answer before the square is given away.
 *
 * A shot clock rather than furniture: with the legal digits for a chosen square shown, the
 * work left in a turn is finding *which* square to take and where it sends the other seat,
 * and unlimited time makes that work optional. It is also what stops two people who have
 * put the phone down leaving a tournament match open for ever — and because a timeout
 * fills the square exactly as a wrong answer does, it cannot break the arithmetic the
 * match terminates on.
 */
const TURN_SECONDS = 20;

/** The centre of a slot: squares 0..80, then the nine digit keys. */
export function slotCentre(out: Vec2, slot: number): Vec2 {
  if (slot < CELL_COUNT) {
    return set(
      out,
      BOARD_X + (columnOf(slot) + 0.5) * CELL_EXTENT,
      BOARD_Y + (rowOf(slot) + 0.5) * CELL_EXTENT,
    );
  }
  const key = slot - CELL_COUNT;
  return set(out, BOARD_X + (key + 0.5) * CELL_EXTENT, PAD_Y + CELL_EXTENT / 2);
}

/** The slot a point falls in, or -1 for neither the grid nor the pad. */
export function slotIndexAt(x: number, y: number): number {
  const localX = x - BOARD_X;
  if (localX < 0 || localX >= BOARD_EXTENT) return -1;
  const column = Math.min(SIZE - 1, Math.floor(localX / CELL_EXTENT));

  const onBoard = y - BOARD_Y;
  if (onBoard >= 0 && onBoard < BOARD_EXTENT) {
    return Math.min(SIZE - 1, Math.floor(onBoard / CELL_EXTENT)) * SIZE + column;
  }
  const onPad = y - PAD_Y;
  if (onPad >= 0 && onPad < CELL_EXTENT) return CELL_COUNT + column;
  return -1;
}

export class SudokuGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  /** Ten rows: the nine of the grid, then the digit pad. */
  readonly #cursor = new GridCursor({ columns: SIZE, rows: SIZE + 1, startIndex: 40 });
  readonly #move: Move = createMove();

  #state: MatchState = createMatch(new Rng(1));
  #rngP1 = new Rng(1);
  #rngP2 = new Rng(2);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #selected = -1;
  #stepsPerSecond = 60;
  #readySteps = 0;
  #thinkSteps = 0;
  #clockSteps = 0;
  #revealSteps = 0;
  #settleSteps = 0;

  init(context: GameContext): void {
    // Three draws from the match generator, in a fixed order: the puzzle, then a stream
    // each. Per-seat streams mean neither seat's play is a function of how its opponent is
    // playing, which one shared generator cannot promise the moment a turn's draw count
    // starts depending on the position — and here it does, because a turn costs one draw
    // per square the mover may answer.
    this.#state = createMatch(context.rng, context.openingSeat);
    this.#rngP1 = new Rng(context.rng.int(1, 0x7fff_ffff));
    this.#rngP2 = new Rng(context.rng.int(1, 0x7fff_ffff));

    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#selected = -1;
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
      if (this.#revealSteps === 0 && isOver(this.#state)) {
        this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      }
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
      this.#playBot(active, difficulty);
      return;
    }

    this.#clockSteps -= 1;
    if (this.#clockSteps <= 0) {
      this.#forfeit();
      return;
    }

    const seatInput = input.seat(active);
    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);
    if (!seatInput.actionPressed) return;

    let slot = this.#cursor.index;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = slotIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      slot = tapped;
      this.#cursor.moveTo(tapped);
    }

    if (slot < CELL_COUNT) {
      // Choosing a square is free and reversible: it commits nothing, and the digits it
      // could hold appear on the pad. Only a digit spends the turn.
      if (isAllowed(this.#state, slot)) this.#selected = slot;
      return;
    }
    if (this.#selected < 0) return;
    this.#play(this.#selected, slot - CELL_COUNT + 1);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawPaper(renderer);
    this.#drawSquares(renderer);
    this.#drawRules(renderer);
    this.#drawUnitMarks(renderer);
    this.#drawSelection(renderer);
    this.#drawReveal(renderer);
    this.#drawPad(renderer);
    this.#drawClock(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#state.active;
  }

  destroy(): void {
    this.#selected = -1;
  }

  /** Read-only views, for the tests and the harness. */
  get state(): MatchState {
    return this.#state;
  }

  get selected(): number {
    return this.#selected;
  }

  get cursorIndex(): number {
    return this.#cursor.index;
  }

  get secondsLeft(): number {
    return this.#clockSteps / this.#stepsPerSecond;
  }

  #beginTurn(): void {
    this.#selected = -1;
    this.#readySteps = this.#stepsFor(READY_SECONDS);
    this.#thinkSteps = this.#stepsFor(BOT_THINK_SECONDS);
    this.#clockSteps = this.#stepsFor(TURN_SECONDS);
  }

  #play(cell: number, digit: number): void {
    if (applyEntry(this.#state, cell, digit) === 'refused') return;
    this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
    this.#beginTurn();
  }

  /**
   * The clock ran out. The square the player had chosen — or the first one they could have
   * chosen — is revealed and goes to the other seat.
   */
  #forfeit(): void {
    let cell = this.#selected;
    if (!isAllowed(this.#state, cell)) {
      cell = forcedMove(this.#move, this.#state) ? this.#move.cell : -1;
    }
    if (cell < 0 || applyForfeit(this.#state, cell) === 'refused') return;
    this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
    this.#beginTurn();
  }

  /**
   * A bot's turn.
   *
   * The fallbacks are not decoration. A turn that fills no square is the one way this game
   * could fail to end, so if the bot's answer is somehow refused the forced answer is
   * tried, and if that is refused too the first square it may play is simply given away.
   * One of the three always lands while a square remains.
   */
  #playBot(seat: SeatId, difficulty: BotDifficulty): void {
    const state = this.#state;
    const rng = seat === 'p1' ? this.#rngP1 : this.#rngP2;
    if (
      !chooseMove(
        this.#move,
        state.cells,
        state.owner,
        state.head,
        seat,
        state.anchor,
        rng,
        difficulty,
      )
    ) {
      forcedMove(this.#move, state);
    }
    let result = applyEntry(state, this.#move.cell, this.#move.digit);
    if (result === 'refused' && forcedMove(this.#move, state)) {
      result = applyEntry(state, this.#move.cell, this.#move.digit);
    }
    if (result === 'refused') {
      for (let index = 0; index < CELL_COUNT; index += 1) {
        if (!isAllowed(state, index)) continue;
        result = applyForfeit(state, index);
        break;
      }
    }
    if (result === 'refused') return;
    this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
    this.#beginTurn();
  }

  /** The orientation the grid should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatView(this.#state.active, this.#presentation, this.#localSeat).rotated;
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #activeIsHuman(): boolean {
    return (this.#state.active === 'p1' ? this.#botP1 : this.#botP2) === null;
  }

  #drawPaper(renderer: Renderer): void {
    renderer.rect(0, 0, this.#logical.width, this.#logical.height, COLOUR_MARGIN);
    renderer.rect(BOARD_X, BOARD_Y, BOARD_EXTENT, BOARD_EXTENT, COLOUR_PAPER);
  }

  /**
   * Every square: its digit, who owns it, whether it may be answered this turn, and
   * whether it is a head.
   *
   * Rule 7 is carried by shape throughout. A square seat one owns has a **filled disc** in
   * its corner and one seat two owns has a **hollow square**; the wash behind the digit
   * only confirms what the corner already said, and the two washes are almost the same
   * grey. The squares that may be answered this turn are the only ones drawn on bright
   * paper, so the cross reads as a shape on the grid rather than as a colour.
   */
  #drawSquares(renderer: Renderer): void {
    const state = this.#state;
    const live = this.#matchWinner === null && this.#revealSteps === 0;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const x = BOARD_X + columnOf(index) * CELL_EXTENT;
      const y = BOARD_Y + rowOf(index) * CELL_EXTENT;
      const owner = state.owner[index] as number;

      if (owner === CLAIMED_P1) renderer.rect(x, y, CELL_EXTENT, CELL_EXTENT, P1.tint);
      else if (owner === CLAIMED_P2) renderer.rect(x, y, CELL_EXTENT, CELL_EXTENT, P2.tint);
      else if (owner === GIVEN) renderer.rect(x, y, CELL_EXTENT, CELL_EXTENT, COLOUR_PAPER_DIM);
      else if (!(live && isAllowed(state, index))) {
        // An empty square outside this turn's cross is shaded back, so the cross is the
        // bright shape on the grid.
        renderer.rect(x, y, CELL_EXTENT, CELL_EXTENT, COLOUR_PAPER_DIM);
      }

      this.#drawHeadMarks(renderer, index, x, y);

      const digit = state.cells[index] as number;
      if (digit !== 0) {
        renderer.text(
          String(digit),
          x + CELL_EXTENT / 2,
          y + CELL_EXTENT / 2,
          DIGIT_SIZE,
          owner === GIVEN ? COLOUR_INK_SOFT : COLOUR_INK,
          'centre',
        );
      }

      if (owner === CLAIMED_P1) {
        renderer.circle(x + CELL_EXTENT - 17, y + CELL_EXTENT - 17, 8, P1.deep);
      } else if (owner === CLAIMED_P2) {
        renderer.strokeRect(x + CELL_EXTENT - 25, y + CELL_EXTENT - 25, 16, 16, 4, P2.deep);
      }
    }
  }

  /**
   * The three head marks, each a different shape: a bar on the left edge for a row's head,
   * a bar on the top edge for a column's head, a small block in the corner for a box's.
   *
   * They are on the grid from the first turn because they are worth knowing from the first
   * turn — a line that ends level goes to whoever holds its head, so these are the squares
   * a close line is decided on.
   */
  #drawHeadMarks(renderer: Renderer, index: number, x: number, y: number): void {
    const head = this.#state.head;
    if ((head[rowUnit(index)] as number) === index) {
      renderer.line(x + 5, y + 24, x + 5, y + CELL_EXTENT - 24, 5, COLOUR_RULE_HEAVY);
    }
    if ((head[columnUnit(index)] as number) === index) {
      renderer.line(x + 24, y + 5, x + CELL_EXTENT - 24, y + 5, 5, COLOUR_RULE_HEAVY);
    }
    if ((head[boxUnit(index)] as number) === index) {
      renderer.rect(x + 10, y + 10, 11, 11, COLOUR_RULE_HEAVY);
    }
  }

  #drawRules(renderer: Renderer): void {
    for (let i = 0; i <= SIZE; i += 1) {
      const heavy = i % 3 === 0;
      const width = heavy ? HEAVY_WIDTH : GRID_WIDTH;
      const colour = heavy ? COLOUR_RULE_HEAVY : COLOUR_RULE;
      const at = BOARD_X + i * CELL_EXTENT;
      renderer.line(at, BOARD_Y, at, BOARD_Y + BOARD_EXTENT, width, colour);
      const down = BOARD_Y + i * CELL_EXTENT;
      renderer.line(BOARD_X, down, BOARD_X + BOARD_EXTENT, down, width, colour);
    }
  }

  /**
   * Who leads each of the twenty-seven units, in the margins: rows down the left, columns
   * across the top, boxes in their own corner. A disc for seat one, a ring for seat two,
   * a faint dot for a line nobody leads yet.
   */
  #drawUnitMarks(renderer: Renderer): void {
    for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
      let x: number;
      let y: number;
      if (unit < SIZE) {
        x = BOARD_X / 2;
        y = BOARD_Y + (unit + 0.5) * CELL_EXTENT;
      } else if (unit < SIZE * 2) {
        x = BOARD_X + (unit - SIZE + 0.5) * CELL_EXTENT;
        y = BOARD_Y / 2;
      } else {
        const box = unit - SIZE * 2;
        x = BOARD_X + ((box % 3) * 3 + 1.5) * CELL_EXTENT;
        y = BOARD_Y + (((box / 3) | 0) * 3 + 1.5) * CELL_EXTENT;
      }
      const leader = unitLeader(this.#state, unit);
      if (leader === 'p1') renderer.circle(x, y, MARK_RADIUS, P1.base);
      else if (leader === 'p2') renderer.strokeCircle(x, y, MARK_RADIUS - 2, 5, P2.base);
      else renderer.circle(x, y, 4, COLOUR_INK_SOFT);
    }
  }

  #drawSelection(renderer: Renderer): void {
    if (this.#matchWinner !== null) return;
    const seat = this.#state.active === 'p1' ? P1 : P2;

    if (this.#cursor.visible) {
      const slot = this.#cursor.index;
      slotCentre(this.#scratch, slot);
      renderer.strokeRect(
        this.#scratch.x - CELL_EXTENT / 2 + 7,
        this.#scratch.y - CELL_EXTENT / 2 + 7,
        CELL_EXTENT - 14,
        CELL_EXTENT - 14,
        CURSOR_WIDTH,
        seat.deep,
      );
    }

    if (this.#selected < 0) return;
    slotCentre(this.#scratch, this.#selected);
    renderer.strokeRect(
      this.#scratch.x - CELL_EXTENT / 2 + 2,
      this.#scratch.y - CELL_EXTENT / 2 + 2,
      CELL_EXTENT - 4,
      CELL_EXTENT - 4,
      SELECT_WIDTH,
      seat.base,
    );
  }

  /**
   * What the last answer was: a ring round the square for one that was right, a cross
   * through it for one that was not. Two shapes, so it reads without colour.
   */
  #drawReveal(renderer: Renderer): void {
    if (this.#revealSteps === 0) return;
    const cell = this.#state.lastCell;
    if (cell < 0) return;
    slotCentre(this.#scratch, cell);
    const x = this.#scratch.x;
    const y = this.#scratch.y;
    const taker = (this.#state.owner[cell] as number) === CLAIMED_P1 ? P1 : P2;
    if (this.#state.lastCorrect) {
      renderer.strokeCircle(x, y, CELL_EXTENT * 0.42, 6, taker.base);
    } else {
      const arm = CELL_EXTENT * 0.32;
      renderer.line(x - arm, y - arm, x + arm, y + arm, 6, taker.base);
      renderer.line(x - arm, y + arm, x + arm, y - arm, 6, taker.base);
    }
  }

  /**
   * The nine digit keys.
   *
   * With a square chosen, a digit that already stands in that square's row, column or box
   * is struck through and refused. Showing it is not a hint: it is a fact about digits
   * already on the grid, and a player who could not see it would be counting along rows by
   * eye — bookkeeping rather than skill, and bookkeeping a thumb and a keyboard are not
   * equally quick at. What the pad never shows is which of the remaining digits is right.
   */
  #drawPad(renderer: Renderer): void {
    const state = this.#state;
    const armed = this.#selected >= 0 && this.#matchWinner === null;
    const mask = armed ? candidateMask(state.cells, this.#selected) : 0;
    const seat = state.active === 'p1' ? P1 : P2;

    for (let key = 0; key < SIZE; key += 1) {
      const x = BOARD_X + key * CELL_EXTENT;
      const digit = key + 1;
      const legal = armed && (mask & (1 << key)) !== 0;
      renderer.rect(x, PAD_Y, CELL_EXTENT, CELL_EXTENT, legal ? COLOUR_PAPER : COLOUR_PAPER_DIM);
      renderer.strokeRect(x, PAD_Y, CELL_EXTENT, CELL_EXTENT, 3, legal ? seat.base : COLOUR_RULE);
      renderer.text(
        String(digit),
        x + CELL_EXTENT / 2,
        PAD_Y + CELL_EXTENT / 2,
        PAD_DIGIT_SIZE,
        legal ? COLOUR_INK : COLOUR_INK_SOFT,
        'centre',
      );
      if (armed && !legal) {
        renderer.line(
          x + 18,
          PAD_Y + 18,
          x + CELL_EXTENT - 18,
          PAD_Y + CELL_EXTENT - 18,
          5,
          COLOUR_RULE_HEAVY,
        );
      }
    }
  }

  /**
   * How long the person to move has left, as a bar under the pad. Drawn only when a person
   * is to move — a bot answers inside a second and a countdown against it would be theatre.
   */
  #drawClock(renderer: Renderer): void {
    if (this.#matchWinner !== null || !this.#activeIsHuman()) return;
    const full = this.#stepsFor(TURN_SECONDS);
    const share = Math.max(0, Math.min(1, this.#clockSteps / full));
    const y = PAD_Y + CELL_EXTENT + 12;
    const seat = this.#state.active === 'p1' ? P1 : P2;
    renderer.rect(BOARD_X, y, BOARD_EXTENT, 10, COLOUR_RULE);
    renderer.rect(BOARD_X, y, BOARD_EXTENT * share, 10, seat.base);
    // Ticks, so the bar is readable as a quantity and not only as a colour.
    for (let i = 1; i < 4; i += 1) {
      const at = BOARD_X + (BOARD_EXTENT * i) / 4;
      renderer.line(at, y - 4, at, y + 14, 3, COLOUR_MARGIN);
    }
  }
}

export default {
  manifest,
  create: (): Game => new SudokuGame(),
};
