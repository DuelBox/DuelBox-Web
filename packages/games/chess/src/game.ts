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
  BOARD_SIZE,
  MOVE_CAPACITY,
  NO_MOVE,
  chooseMove,
  createMatch,
  inCheck,
  kingOf,
  legalMoves,
  moveFrom,
  moveTo,
  playMove,
  playPacked,
  resetMatch,
  signOf,
} from './rules.js';
import type { BotDifficulty, Match } from './rules.js';

/**
 * Chess, on one board both players reach across.
 *
 * The board turns to face whoever is to move, so each person reads their own army coming
 * towards them. The flip, the keyboard cursor and the seat palette all come from the
 * engine; nothing about turns, pausing, scoring or rematch is decided here.
 *
 * A move is two presses — lift a piece, then say where it goes — the same idiom Checkers
 * uses, and the only one that is identical for a thumb, a trackpad and a keyboard.
 * Castling needs no third press: a king moving two squares can only be a castle, so the
 * rules resolve the pair of squares into the move the player must have meant. Promotion
 * needs no press at all, because a promotion here is always to a queen. See SPEC.md.
 *
 * All of the rules live in `rules.ts`. This file knows about squares, presses and paint.
 */

export const BOARD_ORIGIN = 90;
export const BOARD_EXTENT = 720;
export const CELL_EXTENT = BOARD_EXTENT / BOARD_SIZE;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_LIGHT = '#e9ddc6';
const COLOUR_DARK = '#7d6142';
const COLOUR_EDGE = 'rgba(233, 221, 198, 0.35)';
const COLOUR_INK = '#14181e';
const COLOUR_HINT = 'rgba(255, 255, 255, 0.62)';
const COLOUR_TRACK = 'rgba(255, 201, 74, 0.34)';
const COLOUR_CHECK = '#ffc94a';

const PLATE_RADIUS = CELL_EXTENT * 0.38;
const PLATE_RING = 5;
const GLYPH_SIZE = CELL_EXTENT * 0.48;
const CURSOR_INSET = 6;
const CURSOR_WIDTH = 5;
const HINT_RADIUS = 11;

/**
 * The letters on the pieces, indexed by piece type.
 *
 * Rule 7 is answered by the *plate*, not by these: seat one's pieces stand on discs and
 * seat two's on squares, so the two armies differ in shape before any colour is read. The
 * letters do the other half of the job, which is telling a bishop from a knight — a
 * distinction chess needs as much as it needs to tell the sides apart, and one that no
 * amount of colour supplies.
 */
const GLYPH = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.4;
const SETTLE_SECONDS = 1;

/** Scratch for asking the rules what is legal. Never allocated per step. */
const moveScratch = new Int32Array(MOVE_CAPACITY);

/** The centre of a square, in logical units. */
export function squareCentre(out: Vec2, square: number): Vec2 {
  return set(
    out,
    BOARD_ORIGIN + ((square & 7) + 0.5) * CELL_EXTENT,
    BOARD_ORIGIN + ((square >> 3) + 0.5) * CELL_EXTENT,
  );
}

/** The square a point falls in, or −1 if it is off the board. */
export function squareAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN;
  const localY = y - BOARD_ORIGIN;
  if (localX < 0 || localY < 0 || localX >= BOARD_EXTENT || localY >= BOARD_EXTENT) return -1;
  const column = Math.min(BOARD_SIZE - 1, Math.floor(localX / CELL_EXTENT));
  const row = Math.min(BOARD_SIZE - 1, Math.floor(localY / CELL_EXTENT));
  return (row << 3) | column;
}

export class ChessGame implements Game {
  readonly #match: Match = createMatch();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  // Starts on e2 — a square seat one can actually move from — rather than in the middle of
  // the board, so the first press of a direction key is next to something useful.
  readonly #cursor = new GridCursor({ columns: BOARD_SIZE, rows: BOARD_SIZE, startIndex: 52 });

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;
  /** The lifted piece's square, or −1 when nothing is lifted. */
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
    this.#winner = null;
    // The SDK alternates who opens across the rounds of a best-of so that first-mover
    // advantage washes out. The armies never move: seat one is always at the bottom of the
    // board and only the side to move changes, which is exactly the σ-symmetry the rules
    // are built around, so opening as seat two is the same match seen from the other side.
    resetMatch(this.#match, context.openingSeat);
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
    if (this.#winner !== null) return;

    // The final position is held for a beat before the shell's result card covers it, so
    // whoever lost gets to see the move that did it.
    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#winner = this.#match.result;
      return;
    }
    if (this.#match.result !== null) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    const active = this.#match.position.toMove;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      const move = chooseMove(this.#match.position, this.#rng, difficulty);
      if (move !== NO_MOVE) {
        // Shown lifted for the step it moves, so a watching player sees which piece went.
        this.#selected = moveFrom(move);
        playPacked(this.#match, move);
        this.#selected = -1;
      }
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the square under a finger is
    // moving, so a tap would name one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);
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
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps, so the implementation below ignores alpha.
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

  /**
   * Pieces taken, per seat.
   *
   * Not material, and not "who is winning" — those are the bot's opinion, and the shell
   * shows a score to a person. A count of enemy pieces off the board is the one number
   * both players can check by looking. The winner is decided by the rules and never by
   * this count: a mate delivered a rook down still wins.
   */
  getScore(): MatchScore {
    return { p1: this.#match.takenByP1, p2: this.#match.takenByP2, winner: this.#winner };
  }

  getActiveSeat(): SeatId {
    return this.#match.position.toMove;
  }

  destroy(): void {
    resetMatch(this.#match, 'p1');
    this.#selected = -1;
    this.#winner = null;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
  }

  /** Read-only views for the tests and the harness. Never mutate through these. */
  get match(): Readonly<Match> {
    return this.#match;
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
    return seatRotated(this.#match.position.toMove, this.#presentation, this.#localSeat);
  }

  /**
   * One press: either lift a piece, or place the lifted one.
   *
   * Pressing another of your own pieces **re-lifts** rather than being refused. A player
   * changing their mind is the common case, and making them press twice to undo a
   * selection is a worse answer than believing the second press.
   */
  #choose(square: number, seat: SeatId): void {
    const piece = this.#match.position.board[square] ?? 0;
    if (piece * signOf(seat) > 0) {
      this.#selected = this.#selected === square ? -1 : square;
      return;
    }
    if (this.#selected < 0) return;
    if (playMove(this.#match, this.#selected, square)) this.#selected = -1;
  }

  #drawBoard(renderer: Renderer): void {
    renderer.rect(BOARD_ORIGIN, BOARD_ORIGIN, BOARD_EXTENT, BOARD_EXTENT, COLOUR_LIGHT);
    for (let square = 0; square < BOARD_SIZE * BOARD_SIZE; square += 1) {
      const row = square >> 3;
      const column = square & 7;
      if (((row + column) & 1) === 0) continue;
      renderer.rect(
        BOARD_ORIGIN + column * CELL_EXTENT,
        BOARD_ORIGIN + row * CELL_EXTENT,
        CELL_EXTENT,
        CELL_EXTENT,
        COLOUR_DARK,
      );
    }
    // Where the last move came from and where it went. On a board where every piece looks
    // like every other piece of its type, "what just moved" is otherwise unanswerable —
    // and on a shared device the person who was not watching has just picked the phone up.
    this.#shade(renderer, this.#match.lastFrom);
    this.#shade(renderer, this.#match.lastTo);
    renderer.strokeRect(BOARD_ORIGIN, BOARD_ORIGIN, BOARD_EXTENT, BOARD_EXTENT, 4, COLOUR_EDGE);
  }

  #shade(renderer: Renderer, square: number): void {
    if (square < 0) return;
    renderer.rect(
      BOARD_ORIGIN + (square & 7) * CELL_EXTENT,
      BOARD_ORIGIN + (square >> 3) * CELL_EXTENT,
      CELL_EXTENT,
      CELL_EXTENT,
      COLOUR_TRACK,
    );
  }

  /**
   * Where the lifted piece may go, and whether a king is in check.
   *
   * The destinations are the *legal* ones, castling and en passant included, so a player
   * never has to know which of the special moves exists in order to find it — the dot is
   * simply there. Chess's hardest lesson for a new player is the pinned piece, and showing
   * only legal destinations teaches it without a word.
   */
  #drawHints(renderer: Renderer): void {
    const position = this.#match.position;
    if (inCheck(position, position.toMove)) {
      squareCentre(this.#scratch, kingOf(position, position.toMove));
      renderer.strokeCircle(this.#scratch.x, this.#scratch.y, PLATE_RADIUS + 9, 4, COLOUR_CHECK);
    }
    if (this.#selected < 0) return;
    const count = legalMoves(moveScratch, position);
    for (let i = 0; i < count; i += 1) {
      const move = moveScratch[i] ?? 0;
      if (moveFrom(move) !== this.#selected) continue;
      squareCentre(this.#scratch, moveTo(move));
      renderer.circle(this.#scratch.x, this.#scratch.y, HINT_RADIUS, COLOUR_HINT);
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
      SEAT_PALETTE[this.#match.position.toMove].base,
    );
  }

  /**
   * Rule 7: the two armies differ in shape before they differ in colour.
   *
   * Seat one's pieces stand on **discs**, seat two's on **squares**, and every piece
   * carries its letter in ink. Told apart from the other army by the plate; told apart
   * from each other by the letter. A player who sees no colour at all loses nothing.
   */
  #drawPieces(renderer: Renderer): void {
    const board = this.#match.position.board;
    for (let square = 0; square < BOARD_SIZE * BOARD_SIZE; square += 1) {
      const piece = board[square] ?? 0;
      if (piece === 0) continue;
      squareCentre(this.#scratch, square);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      const seat: SeatId = piece > 0 ? 'p1' : 'p2';
      const palette = SEAT_PALETTE[seat];
      const type = piece > 0 ? piece : -piece;

      if (seat === 'p1') {
        renderer.circle(x, y, PLATE_RADIUS, palette.base);
        renderer.strokeCircle(x, y, PLATE_RADIUS - PLATE_RING / 2, PLATE_RING, palette.deep);
      } else {
        const side = PLATE_RADIUS * 1.78;
        renderer.rect(x - side / 2, y - side / 2, side, side, palette.base);
        renderer.strokeRect(
          x - side / 2 + PLATE_RING / 2,
          y - side / 2 + PLATE_RING / 2,
          side - PLATE_RING,
          side - PLATE_RING,
          PLATE_RING,
          palette.deep,
        );
      }

      renderer.text(GLYPH[type] ?? '?', x, y, GLYPH_SIZE, COLOUR_INK, 'centre');
      if (square === this.#selected) {
        renderer.strokeCircle(x, y, PLATE_RADIUS + 6, 4, COLOUR_LIGHT);
      }
    }
  }
}

const gameModule = {
  manifest,
  create: (): Game => new ChessGame(),
};

export default gameModule;
