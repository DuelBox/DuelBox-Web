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
  COLUMNS,
  HIDDEN,
  MOVE_BANK_COLUMN,
  MOVE_BANK_WASTE,
  MOVE_COLUMN_TO_COLUMN,
  MOVE_DRAW,
  MOVE_NONE,
  MOVE_WASTE_TO_COLUMN,
  NONE,
  RANKS,
  SUITS,
  botMove,
  cardAt,
  createMatch,
  faceDownIn,
  isLegal,
  letGo,
  play,
  rankOf,
  suitOf,
  topOf,
  wasteTop,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, MatchState } from './rules.js';

/**
 * Geometry in logical units, exported because working out which pile a tap landed in is not a
 * rendering question — the tests and the control-parity harness need the same mapping the game
 * uses.
 *
 * The board is **one seven-column lattice with two rows**, and that is what makes a keyboard
 * and a thumb the same instrument here. The top row is the solitaire header, in the order every
 * solitaire has it: the stock, then the waste across two slots, then the four foundations. The
 * bottom row is the seven tableau columns. Every action in the game is one press on one of
 * fourteen slots; there is no drag, no charge and no continuous quantity anywhere, so no input
 * family can aim finer than another.
 */
export const CARD_WIDTH = 112;
export const CARD_HEIGHT = 156;
export const COLUMN_PITCH = 125;
export const BOARD_X = 19;
export const HEADER_Y = 24;
export const TABLEAU_Y = 210;
export const TABLEAU_BOTTOM = 872;
/** The ledger: four suit rows of thirteen, showing who took which card. */
export const LEDGER_X = 92;
export const LEDGER_Y = 898;
export const LEDGER_PITCH_X = 60;
export const LEDGER_PITCH_Y = 25;

/** Lattice slots. 0..6 across the header, then 7..13 for the tableau columns. */
export const SLOT_STOCK = 0;
export const SLOT_WASTE = 1;
/** The waste fan is two slots wide, so the header has no dead cell in it. */
export const SLOT_WASTE_FAN = 2;
export const SLOT_FOUNDATION = 3;
export const SLOT_TABLEAU = COLUMNS;
export const SLOT_COUNT = COLUMNS * 2;

const COLOUR_BACKGROUND = '#14261d';
const COLOUR_FELT = '#1c3a2b';
const COLOUR_SLOT = '#163023';
const COLOUR_SLOT_EDGE = '#2f5a44';
const COLOUR_CARD = '#f6f4ec';
const COLOUR_CARD_EDGE = '#c9c4b4';
const COLOUR_BACK = '#2c4f7c';
const COLOUR_BACK_LINE = '#4d76ac';
const COLOUR_INK = '#181b22';
const COLOUR_RED = '#b0202a';
const COLOUR_FAINT = '#7d8a83';

const P1 = SEAT_PALETTE.p1;
const P2 = SEAT_PALETTE.p2;

const RANK_SIZE = 34;
const PIP_SIZE = 11;

/**
 * The turn's shape, in seconds. Every one is turned into whole simulation steps before it is
 * counted, so a replay is exact.
 *
 * `READY_SECONDS` is longer than the shell's 0.36 s seat flip on purpose, and it lives here
 * rather than being keyed off the flip because **`seatRotated` reports no rotation at all in
 * single-seat play**. A freeze that asked the flip whether it had finished would step one match
 * on a shared phone and a different one on two phones playing remotely — and the turn clock
 * below would then run out on different frames in the two presentations, so the two devices
 * would disagree about who owned a card. Cup Pong and Sudoku both documented this trap before
 * us; a test drives one seed through both presentations and compares.
 */
const READY_SECONDS = 0.5;
const BOT_THINK_SECONDS = 0.25;
const REVEAL_SECONDS = 0.2;
const SETTLE_SECONDS = 1;
/**
 * How long a person has before the turn is let go.
 *
 * A shot clock rather than furniture. The move set is small and entirely visible, so the work
 * in a turn is deciding which of your opponent's options to open rather than finding a move at
 * all — and unlimited time makes that work optional. It is also what stops two people who have
 * put the phone down holding a tournament match open: a turn let go passes, and two let go in a
 * row end the deal.
 */
const TURN_SECONDS = 20;

/** The left edge of a lattice slot's card. */
export function slotX(slot: number): number {
  return BOARD_X + (slot % COLUMNS) * COLUMN_PITCH;
}

/** The top edge of a lattice slot's card. */
export function slotY(slot: number): number {
  return slot < COLUMNS ? HEADER_Y : TABLEAU_Y;
}

/** The centre of a lattice slot, for the keyboard cursor's highlight. */
export function slotCentre(out: Vec2, slot: number): Vec2 {
  return set(out, slotX(slot) + CARD_WIDTH / 2, slotY(slot) + CARD_HEIGHT / 2);
}

/**
 * The slot a point falls in, or -1 for the felt.
 *
 * Bands rather than card rectangles: the gap between two columns belongs to the nearer one, so
 * a thumb that lands between cards still means something. A tableau column's band runs the whole
 * height of the tableau, whether or not there are cards that far down.
 */
export function slotIndexAt(x: number, y: number): number {
  const local = x - BOARD_X;
  if (local < 0) return -1;
  const column = Math.floor(local / COLUMN_PITCH);
  if (column >= COLUMNS) return -1;
  if (y >= HEADER_Y && y < HEADER_Y + CARD_HEIGHT) return column;
  if (y >= TABLEAU_Y && y < TABLEAU_BOTTOM) return SLOT_TABLEAU + column;
  return -1;
}

/** Which tableau column a slot is, or -1 for a header slot. */
export function columnOfSlot(slot: number): number {
  return slot >= SLOT_TABLEAU ? slot - SLOT_TABLEAU : -1;
}

/** How far apart a column fans its cards. A face-down card needs less room than a face-up one. */
export const FAN_DOWN = 15;
export const FAN_UP = 34;

/**
 * How much a column has to squeeze its fan to fit the board, in [0, 1].
 *
 * One is roomy, and everything below it is a long column being compressed. The deal cannot make
 * a column longer than seven, but play can: every card the waste lends the tableau lands on one.
 * A logical box is a fixed size and this is how a column stays inside it — no branch on the
 * device anywhere, because there is no device to branch on.
 */
export function fanScale(length: number, down: number): number {
  if (length <= 1) return 1;
  const wanted = down * FAN_DOWN + (length - down - 1) * FAN_UP;
  const room = TABLEAU_BOTTOM - TABLEAU_Y - CARD_HEIGHT;
  return wanted <= room ? 1 : room / wanted;
}

export class SolitaireGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  /** Two rows of seven: the header, then the tableau. */
  readonly #cursor = new GridCursor({ columns: COLUMNS, rows: 2, startIndex: SLOT_TABLEAU + 3 });

  #state: MatchState = createMatch(new Rng(1));
  #rngP1 = new Rng(1);
  #rngP2 = new Rng(2);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  /** The pile a player has picked up, as a lattice slot. -1 for nothing held. */
  #picked = -1;
  #stepsPerSecond = 60;
  #readySteps = 0;
  #thinkSteps = 0;
  #clockSteps = 0;
  #revealSteps = 0;
  #settleSteps = 0;

  init(context: GameContext): void {
    // Three draws from the match generator in a fixed order: the deal, then a stream each. A
    // stream each means neither seat's play is a function of how its opponent is playing, which
    // one shared generator cannot promise once a turn's draw count depends on the position.
    this.#state = createMatch(context.rng, context.openingSeat);
    this.#rngP1 = new Rng(context.rng.int(1, 0x7fff_ffff));
    this.#rngP2 = new Rng(context.rng.int(1, 0x7fff_ffff));

    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#picked = -1;
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
      if (this.#revealSteps === 0 && this.#state.over) {
        this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      }
      return;
    }

    if (this.#state.over) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    // Nobody acts while the board is turning to face the seat that is to move. Counted in the
    // simulation rather than off the flip, so both presentations step the same match.
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
      letGo(this.#state);
      this.#afterTurn();
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
    this.#press(slot);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks against
  // the class as well as against `Game`. This game does not interpolate between fixed steps,
  // so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    renderer.rect(0, 0, this.#logical.width, this.#logical.height, COLOUR_FELT);
    this.#drawStock(renderer);
    this.#drawWaste(renderer);
    this.#drawFoundations(renderer);
    this.#drawTableau(renderer);
    this.#drawLedger(renderer);
    this.#drawSelection(renderer);
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
    this.#picked = -1;
  }

  /** Read-only views, for the tests and the harness. */
  get state(): MatchState {
    return this.#state;
  }

  get picked(): number {
    return this.#picked;
  }

  get cursorIndex(): number {
    return this.#cursor.index;
  }

  get secondsLeft(): number {
    return this.#clockSteps / this.#stepsPerSecond;
  }

  /**
   * One press on one slot.
   *
   * Picking a pile up commits nothing and is free to change; the **destination decides what
   * moves**, which is what lets a single press mean the same thing for a thumb and for a key
   * with no modes anywhere. A column put down on a foundation sends its top card up; the same
   * column put down on another column moves its whole face-up run. The stock is the one slot
   * that is a move all by itself.
   */
  #press(slot: number): void {
    const state = this.#state;

    if (slot === SLOT_STOCK) {
      this.#picked = -1;
      this.#attempt(MOVE_DRAW);
      return;
    }

    const wasteSlot = slot === SLOT_WASTE || slot === SLOT_WASTE_FAN;
    if (this.#picked < 0) {
      // Nothing held: pick up the waste or a column, if there is anything there to pick up.
      if (wasteSlot) {
        if (wasteTop(state) !== NONE) this.#picked = SLOT_WASTE;
        return;
      }
      const column = columnOfSlot(slot);
      if (column >= 0 && topOf(state, column) !== NONE) this.#picked = slot;
      return;
    }

    if (slot === this.#picked || (wasteSlot && this.#picked === SLOT_WASTE)) {
      this.#picked = -1;
      return;
    }

    const from = this.#picked;
    this.#picked = -1;
    if (slot >= SLOT_FOUNDATION && slot < SLOT_TABLEAU) {
      this.#attempt(from === SLOT_WASTE ? MOVE_BANK_WASTE : MOVE_BANK_COLUMN + columnOfSlot(from));
      return;
    }
    const to = columnOfSlot(slot);
    if (to < 0) return;
    if (from === SLOT_WASTE) {
      this.#attempt(MOVE_WASTE_TO_COLUMN + to);
      return;
    }
    this.#attempt(MOVE_COLUMN_TO_COLUMN + columnOfSlot(from) * COLUMNS + to);
  }

  #attempt(move: number): void {
    if (!play(this.#state, move)) return;
    this.#afterTurn();
  }

  #afterTurn(): void {
    this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
    this.#beginTurn();
  }

  #beginTurn(): void {
    this.#picked = -1;
    this.#readySteps = this.#stepsFor(READY_SECONDS);
    this.#thinkSteps = this.#stepsFor(BOT_THINK_SECONDS);
    this.#clockSteps = this.#stepsFor(TURN_SECONDS);
  }

  /**
   * A bot's turn.
   *
   * The fallback is not decoration. A turn that plays nothing is the one way this game could
   * fail to end, so a move the bot somehow offered that is refused is followed by letting the
   * turn go — which passes, and two passes end the deal. In measurement it has never fired:
   * `botMove` returns only moves it read out of `legalMoves`.
   */
  #playBot(seat: SeatId, difficulty: BotDifficulty): void {
    const rng = seat === 'p1' ? this.#rngP1 : this.#rngP2;
    const move = botMove(this.#state, rng, difficulty);
    if (move === MOVE_NONE || !play(this.#state, move)) {
      letGo(this.#state);
    }
    this.#afterTurn();
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatRotated(this.#state.active, this.#presentation, this.#localSeat);
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #activeIsHuman(): boolean {
    return (this.#state.active === 'p1' ? this.#botP1 : this.#botP2) === null;
  }

  /* ---------------------------------------------------------------------------- drawing */

  #drawEmptySlot(renderer: Renderer, x: number, y: number): void {
    renderer.rect(x, y, CARD_WIDTH, CARD_HEIGHT, COLOUR_SLOT);
    renderer.strokeRect(x, y, CARD_WIDTH, CARD_HEIGHT, 3, COLOUR_SLOT_EDGE);
  }

  /**
   * A face-down card: a plain back with three rules across it.
   *
   * Drawn from primitives like everything else in this package — the catalogue ships no image
   * assets, and a card back is exactly the sort of thing that would tempt somebody to.
   */
  #drawBack(renderer: Renderer, x: number, y: number): void {
    renderer.rect(x, y, CARD_WIDTH, CARD_HEIGHT, COLOUR_BACK);
    renderer.strokeRect(x, y, CARD_WIDTH, CARD_HEIGHT, 3, COLOUR_CARD_EDGE);
    for (let i = 1; i <= 3; i += 1) {
      const at = y + (CARD_HEIGHT * i) / 4;
      renderer.line(x + 12, at, x + CARD_WIDTH - 12, at, 3, COLOUR_BACK_LINE);
    }
  }

  /**
   * A face-up card: rank at the top left, suit pip beside it, and the big pip in the middle.
   *
   * Rule 7 is carried by **shape**, not by the red and the black. The four suits are four
   * different constructions, and they stay different in greyscale:
   *
   * - spades — one filled disc on a stem
   * - clubs — three filled discs on a stem
   * - hearts — two filled discs over a block
   * - diamonds — an open diamond of four lines, and nothing filled at all
   *
   * The colour agrees with the shape and never carries anything on its own. The rank is a
   * label, and it is drawn at a size that survives a card fanned down to its top edge.
   */
  #drawFace(renderer: Renderer, card: number, x: number, y: number): void {
    renderer.rect(x, y, CARD_WIDTH, CARD_HEIGHT, COLOUR_CARD);
    renderer.strokeRect(x, y, CARD_WIDTH, CARD_HEIGHT, 3, COLOUR_CARD_EDGE);
    const suit = suitOf(card);
    const ink = suit >> 1 ? COLOUR_RED : COLOUR_INK;
    renderer.text(RANK_LABEL[rankOf(card)] ?? '?', x + 13, y + 26, RANK_SIZE, ink, 'left');
    this.#drawPip(renderer, suit, x + CARD_WIDTH - 25, y + 26, PIP_SIZE, ink);
    this.#drawPip(renderer, suit, x + CARD_WIDTH / 2, y + CARD_HEIGHT * 0.62, PIP_SIZE * 2, ink);
  }

  /** One suit pip, `size` being roughly its half-width. */
  #drawPip(
    renderer: Renderer,
    suit: number,
    cx: number,
    cy: number,
    size: number,
    ink: string,
  ): void {
    const r = size * 0.42;
    if (suit === 0) {
      renderer.circle(cx, cy - r * 0.35, r, ink);
      renderer.rect(cx - r * 0.35, cy, r * 0.7, size * 0.8, ink);
    } else if (suit === 1) {
      renderer.circle(cx, cy - r * 0.75, r * 0.8, ink);
      renderer.circle(cx - r * 0.85, cy + r * 0.35, r * 0.8, ink);
      renderer.circle(cx + r * 0.85, cy + r * 0.35, r * 0.8, ink);
      renderer.rect(cx - r * 0.3, cy + r * 0.4, r * 0.6, size * 0.6, ink);
    } else if (suit === 2) {
      renderer.circle(cx - r * 0.55, cy - r * 0.45, r * 0.75, ink);
      renderer.circle(cx + r * 0.55, cy - r * 0.45, r * 0.75, ink);
      renderer.rect(cx - r * 1.05, cy - r * 0.4, r * 2.1, r * 1.1, ink);
    } else {
      const w = size * 0.7;
      const h = size * 0.95;
      const line = Math.max(2, size * 0.16);
      renderer.line(cx, cy - h, cx + w, cy, line, ink);
      renderer.line(cx + w, cy, cx, cy + h, line, ink);
      renderer.line(cx, cy + h, cx - w, cy, line, ink);
      renderer.line(cx - w, cy, cx, cy - h, line, ink);
    }
  }

  #drawStock(renderer: Renderer): void {
    const x = slotX(SLOT_STOCK);
    const y = HEADER_Y;
    if (this.#state.stockLeft === 0) {
      this.#drawEmptySlot(renderer, x, y);
      return;
    }
    // The pile's depth is the clock of this game, so it is drawn as depth: a stack of edges.
    const edges = Math.min(6, this.#state.stockLeft);
    for (let i = edges - 1; i >= 1; i -= 1) {
      renderer.rect(x + i * 3, y - i * 3, CARD_WIDTH, CARD_HEIGHT, COLOUR_BACK_LINE);
    }
    this.#drawBack(renderer, x, y);
    renderer.text(
      String(this.#state.stockLeft),
      x + CARD_WIDTH / 2,
      y + CARD_HEIGHT / 2,
      36,
      COLOUR_CARD,
      'centre',
    );
  }

  /** The waste, fanned right so the two cards under the live one stay readable. */
  #drawWaste(renderer: Renderer): void {
    const state = this.#state;
    const x = slotX(SLOT_WASTE);
    if (state.wasteLen === 0) {
      this.#drawEmptySlot(renderer, x, HEADER_Y);
      return;
    }
    const shown = Math.min(3, state.wasteLen);
    for (let i = shown - 1; i >= 0; i -= 1) {
      const card = cardAtWaste(state, state.wasteLen - 1 - i);
      this.#drawFace(renderer, card, x + (shown - 1 - i) * 54, HEADER_Y);
    }
  }

  #drawFoundations(renderer: Renderer): void {
    for (let suit = 0; suit < SUITS; suit += 1) {
      const x = slotX(SLOT_FOUNDATION + suit);
      const up = this.#state.foundation[suit] ?? 0;
      if (up === 0) {
        this.#drawEmptySlot(renderer, x, HEADER_Y);
        this.#drawPip(
          renderer,
          suit,
          x + CARD_WIDTH / 2,
          HEADER_Y + CARD_HEIGHT / 2,
          PIP_SIZE * 2,
          COLOUR_SLOT_EDGE,
        );
        continue;
      }
      this.#drawFace(renderer, suit * RANKS + up - 1, x, HEADER_Y);
    }
  }

  /**
   * The seven columns, fanned down.
   *
   * Drawn deepest first, so each card covers all but the top of the one beneath it — which is
   * what a fanned pile of cards is. A card is always drawn at its full size and simply hidden;
   * there is no separate "part of a card" to keep in step with the whole one.
   */
  #drawTableau(renderer: Renderer): void {
    const state = this.#state;
    for (let column = 0; column < COLUMNS; column += 1) {
      const x = slotX(SLOT_TABLEAU + column);
      const length = state.pileLen[column] ?? 0;
      if (length === 0) {
        this.#drawEmptySlot(renderer, x, TABLEAU_Y);
        continue;
      }
      const down = faceDownIn(state, column);
      const scale = fanScale(length, down);
      let y = TABLEAU_Y;
      for (let depth = 0; depth < length; depth += 1) {
        if (depth < down) this.#drawBack(renderer, x, y);
        else this.#drawFace(renderer, cardAt(state, column, depth), x, y);
        y += (depth < down ? FAN_DOWN : FAN_UP) * scale;
      }
    }
  }

  /**
   * The ledger: four rows of thirteen, one cell per card in the deck, filled in as cards go up.
   *
   * This is the score, drawn where the thing being scored is — the same argument Sudoku makes
   * for putting its unit marks on the grid. **Seat one is a filled disc and seat two an open
   * square**, everywhere in this package, so who took what reads without any colour at all; a
   * card still to come is a faint dot. A player can see at a glance which suits are being
   * shared out evenly and which one they are losing, and the row's filled prefix is exactly how
   * far that foundation has got.
   */
  #drawLedger(renderer: Renderer): void {
    const owner = this.#state.owner;
    for (let suit = 0; suit < SUITS; suit += 1) {
      const y = LEDGER_Y + suit * LEDGER_PITCH_Y;
      this.#drawPip(renderer, suit, BOARD_X + 26, y, 10, suit >> 1 ? COLOUR_RED : COLOUR_FAINT);
      for (let rank = 0; rank < RANKS; rank += 1) {
        const x = LEDGER_X + rank * LEDGER_PITCH_X;
        const held = owner[suit * RANKS + rank] ?? 0;
        if (held === 1) renderer.circle(x, y, 8, P1.base);
        else if (held === 2) renderer.strokeRect(x - 8, y - 8, 16, 16, 4, P2.base);
        else renderer.circle(x, y, 2.5, COLOUR_FAINT);
      }
    }
  }

  /**
   * What is picked up, where the keyboard cursor is, and which slots this press could reach.
   *
   * A slot the held pile can legally be put down on is ringed, which is the same argument
   * Reversi makes for drawing a dot on every legal square: counting descending alternating runs
   * by eye is bookkeeping, not skill, and it is bookkeeping a thumb and a keyboard are not
   * equally quick at. What is never shown is which of them is the move worth making.
   */
  #drawSelection(renderer: Renderer): void {
    if (this.#matchWinner !== null) return;
    const seat = this.#state.active === 'p1' ? P1 : P2;

    if (this.#picked >= 0) {
      for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
        if (slot === this.#picked) continue;
        if (!this.#wouldBeLegal(this.#picked, slot)) continue;
        const x = slotX(slot);
        const y = slotY(slot);
        renderer.strokeRect(x - 5, y - 5, CARD_WIDTH + 10, CARD_HEIGHT + 10, 4, seat.soft);
      }
      const x = slotX(this.#picked);
      const y = slotY(this.#picked);
      renderer.strokeRect(x - 3, y - 3, CARD_WIDTH + 6, CARD_HEIGHT + 6, 7, seat.base);
    }

    if (this.#cursor.visible) {
      const x = slotX(this.#cursor.index);
      const y = slotY(this.#cursor.index);
      renderer.strokeRect(x + 6, y + 6, CARD_WIDTH - 12, CARD_HEIGHT - 12, 5, seat.deep);
    }
  }

  /** Whether pressing `slot` while holding `from` would play a legal move. */
  #wouldBeLegal(from: number, slot: number): boolean {
    if (slot === SLOT_STOCK) return false;
    if (slot >= SLOT_FOUNDATION && slot < SLOT_TABLEAU) {
      const move = from === SLOT_WASTE ? MOVE_BANK_WASTE : MOVE_BANK_COLUMN + columnOfSlot(from);
      if (!isLegal(this.#state, move)) return false;
      // A card only goes up on its own suit's pile, so only that foundation lights up.
      const card =
        from === SLOT_WASTE ? wasteTop(this.#state) : topOf(this.#state, columnOfSlot(from));
      return SLOT_FOUNDATION + suitOf(card) === slot;
    }
    const to = columnOfSlot(slot);
    if (to < 0) return false;
    if (from === SLOT_WASTE) return isLegal(this.#state, MOVE_WASTE_TO_COLUMN + to);
    return isLegal(this.#state, MOVE_COLUMN_TO_COLUMN + columnOfSlot(from) * COLUMNS + to);
  }

  /**
   * How long the person to move has left, as a bar with ticks under the tableau. Drawn only
   * when a person is to move — a bot plays inside a second and a countdown against it would be
   * theatre.
   */
  #drawClock(renderer: Renderer): void {
    if (this.#matchWinner !== null || !this.#activeIsHuman()) return;
    const full = this.#stepsFor(TURN_SECONDS);
    const share = Math.max(0, Math.min(1, this.#clockSteps / full));
    const width = COLUMN_PITCH * COLUMNS - (COLUMN_PITCH - CARD_WIDTH);
    const y = TABLEAU_BOTTOM + 4;
    const seat = this.#state.active === 'p1' ? P1 : P2;
    renderer.rect(BOARD_X, y, width, 9, COLOUR_SLOT_EDGE);
    renderer.rect(BOARD_X, y, width * share, 9, seat.base);
    for (let i = 1; i < 4; i += 1) {
      const at = BOARD_X + (width * i) / 4;
      renderer.line(at, y - 3, at, y + 12, 3, COLOUR_FELT);
    }
  }
}

/** The labels on the cards. Ten is two characters; every other rank is one. */
const RANK_LABEL: readonly string[] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
];

function cardAtWaste(state: MatchState, index: number): number {
  return state.waste[index] ?? HIDDEN;
}

export default {
  manifest,
  create: (): Game => new SolitaireGame(),
};
