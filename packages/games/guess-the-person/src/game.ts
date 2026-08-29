import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CAST,
  CAST_ROWS,
  COLUMNS,
  QUESTIONS,
  applyAction,
  attributeOfQuestion,
  boardOf,
  characterAt,
  chooseAction,
  createAction,
  createMatch,
  dealAgain,
  dealsWon,
  isLive,
  playName,
  playQuestion,
  resetMatch,
  splitsQuestion,
  valueOf,
  valueOfQuestion,
  winnerOf,
} from './rules.js';
import type { Action, BotDifficulty, Match } from './rules.js';

/**
 * Board geometry, in logical units.
 *
 * Exported because working out which slot a finger is on is not a rendering question: the
 * tests need the same mapping the game uses, and so does anything that later replays a
 * trace.
 *
 * The lattice is one rectangle — ten columns by four rows — and that is the whole reason a
 * keyboard can play this game with one `GridCursor` and no bespoke navigation. The top
 * three rows are the cast, thirty characters; the fourth is the ten question chips, one
 * per attribute value.
 *
 * There are no holes in it, and that is why the cast is thirty rather than the twenty-four
 * a physical set carries. Five outlines, three cores and two feet multiply to thirty and
 * add to ten, so the same three numbers fill the cast rows and the question row exactly.
 * A ragged lattice would have meant either a bespoke cursor or dead cells for a keyboard
 * player to walk through, and `ARITY` in rules.ts was chosen to avoid both.
 */
export const BOARD_X = 12;
export const CELL_W = 87;
export const BOARD_W = CELL_W * COLUMNS;
export const CAST_Y = 206;
export const CELL_H = 142;
export const CAST_H = CELL_H * CAST_ROWS;
export const CHIP_Y = 668;
export const CHIP_H = 126;

/** Where the last question and its answer are shown, above the board. */
const REVEAL_Y = 108;

const COLOUR_BACKGROUND = '#eef1f7';
const COLOUR_PLATE = '#ffffff';
const COLOUR_PLATE_OUT = '#c3cad8';
const COLOUR_INK = '#1b2030';
const COLOUR_MUTED = '#8a93a6';
const COLOUR_FAINT = '#dfe4ee';

/** Long enough to read as deliberation, short enough not to be a wait. */
const THINK_SECONDS = 0.75;
/**
 * How long the answer stands before the next seat may act.
 *
 * **Longer than a seat flip on purpose.** `SeatFlip`'s half-turn is 0.36 s and the board
 * starts turning on the same step the answer appears, so by the time this expires the
 * board has settled in shared-screen play and has never moved at all in single-seat play.
 * Both presentations therefore accept the next press on exactly the same step. Shorten
 * this below the flip and the two presentations start dropping different presses, which is
 * the defect `presentation-parity.test.ts` names three games for.
 */
const REVEAL_SECONDS = 1;
const SETTLE_SECONDS = 1.2;

/** Radius of the character drawn on a tile, and of the one drawn in the reveal panel. */
const GLYPH_RADIUS = 27;
const REVEAL_RADIUS = 34;

/** The two little verdict pips every tile carries, one per seat. */
const PIP_RADIUS = 8;

export class GuessWhoGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #match: Match = createMatch(new Rng(1), 'p1');
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({ columns: COLUMNS, rows: CAST_ROWS + 1, startIndex: 15 });
  readonly #pointerWorld = vec2();
  readonly #action: Action = createAction();

  /**
   * One generator per **role**, never per seat.
   *
   * The opener draws from the first and the seat that answers from the second, so swapping
   * `openingSeat` on the same seed gives the identical match with the two seats exchanged
   * rather than a different one. That is what makes seat one's share exactly a half by
   * construction; the tests assert it board by board rather than measuring it.
   */
  #openerRng = new Rng(2);
  #answererRng = new Rng(3);
  /** The match generator, kept so the next deal can be laid out from it in order. */
  #rng = new Rng(1);

  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #revealSteps = 0;
  #settleSteps = 0;

  /** Exposed for tests, which need to state a position rather than play into one. */
  get match(): Match {
    return this.#match;
  }

  /**
   * Whose turn it is.
   *
   * The shell decides a game is turn-based by the presence of this method, and only then
   * does it hand the whole board to the active seat and map both keyboard halves onto
   * them. Leave it out of a `turn-*` game and the arrow keys drive the player who is not
   * playing, while half the device goes dead to a finger.
   */
  getActiveSeat(): SeatId {
    return this.#match.seat;
  }

  init(context: GameContext): void {
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#revealSteps = 0;
    this.#settleSteps = 0;

    // The first deal, so the arrangement of the cast belongs to the table rather than to
    // either seat; then a stream each for the two roles. Later deals come off the same
    // generator, in order, so the whole match is one seeded sequence.
    this.#rng = context.rng;
    resetMatch(this.#match, context.rng, context.openingSeat);
    this.#openerRng = new Rng(context.rng.next() | 0);
    this.#answererRng = new Rng(context.rng.next() | 0);

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
      if (this.#settleSteps === 0) {
        if (this.#match.setOver) this.#matchWinner = winnerOf(this.#match);
        else {
          dealAgain(this.#match, this.#rng);
          this.#cursor.reset();
        }
      }
      return;
    }
    if (this.#revealSteps > 0) {
      this.#revealSteps -= 1;
      if (this.#revealSteps === 0 && this.#match.over) {
        this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      }
      return;
    }

    const seat = this.#match.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#updateBot(seat, difficulty);
      return;
    }

    // The one gate that differs between the two presentations, and it is control mapping
    // rather than simulation: shared-screen refuses a press while the board is part-way
    // through its half-turn, and single-seat never turns at all. Everything above this
    // line runs identically in both.
    if (!this.#flip.acceptsInput) return;
    this.#updateHuman(seat, fixedDeltaSeconds, input);
  }

  #updateBot(seat: SeatId, difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;
    const board = boardOf(this.#match, seat);
    const stream = seat === this.#match.opener ? this.#openerRng : this.#answererRng;
    chooseAction(this.#action, board, stream, difficulty);
    if (applyAction(this.#match, this.#action)) this.#afterAction();
  }

  #updateHuman(seat: SeatId, fixedDeltaSeconds: number, input: InputState): void {
    const seatInput = input.seat(seat);
    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);
    if (!seatInput.actionPressed) return;

    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = slotAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      this.#cursor.moveTo(tapped);
      this.#commit(tapped);
      return;
    }
    this.#commit(this.#cursor.index);
  }

  /** One press on one slot: a question in the bottom row, a character anywhere above it. */
  #commit(slot: number): void {
    if (slot < 0 || slot >= CAST + QUESTIONS) return;
    const done =
      slot >= CAST
        ? playQuestion(this.#match, slot - CAST)
        : playName(this.#match, characterAt(this.#match, slot));
    if (done) this.#afterAction();
  }

  #afterAction(): void {
    this.#thinkSteps = -1;
    this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
    this.#cursor.reset();
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.#match.seat !== this.#localSeat;
  }

  onPause(): void {}
  onResume(): void {}

  getScore(): MatchScore {
    // Deals won, out of three. The characters a seat has struck off is the number moving
    // every turn, but it resets with every deal and saturates at twenty-nine, so it is a
    // progress bar rather than a score — and the pips on the grid already say it exactly.
    return {
      p1: dealsWon(this.#match, 'p1'),
      p2: dealsWon(this.#match, 'p2'),
      winner: this.#matchWinner,
    };
  }

  destroy(): void {
    this.#rng = new Rng(1);
    resetMatch(this.#match, this.#rng, 'p1');
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#revealSteps = 0;
    this.#settleSteps = 0;
    this.#cursor.reset();
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#renderReveal(renderer);
    this.#renderCast(renderer);
    this.#renderChips(renderer);
    // The board takes the colour of whoever is to move. It covers most of the play area,
    // so it is field rather than a player-owned element — which is why every piece of
    // seat identity below is carried by a pip that also differs in shape.
    renderer.strokeRect(
      BOARD_X - 8,
      CAST_Y - 12,
      BOARD_W + 16,
      CAST_H + CHIP_H + 54,
      5,
      SEAT_PALETTE[this.#match.seat].base,
    );
    renderer.popSeatRotation();
  }

  /** What just happened: the question that was asked, or the character that was named. */
  #renderReveal(renderer: Renderer): void {
    const match = this.#match;
    if (match.lastKind === 'none') return;
    const middle = this.#logical.width / 2;
    const leftX = middle - 110;
    const rightX = middle + 110;

    if (match.lastKind === 'ask') {
      drawQuestion(renderer, leftX, REVEAL_Y, REVEAL_RADIUS, match.lastQuestion, COLOUR_INK);
    } else {
      drawCharacter(renderer, leftX, REVEAL_Y, REVEAL_RADIUS, match.lastCharacter, COLOUR_INK);
    }

    // Yes is a ring and no is a cross: two outcomes told apart by shape, with nothing at
    // all riding on colour and no text anywhere in the game.
    if (match.lastAnswer) {
      renderer.strokeCircle(rightX, REVEAL_Y, 30, 8, COLOUR_INK);
    } else {
      renderer.line(rightX - 24, REVEAL_Y - 24, rightX + 24, REVEAL_Y + 24, 8, COLOUR_INK);
      renderer.line(rightX + 24, REVEAL_Y - 24, rightX - 24, REVEAL_Y + 24, 8, COLOUR_INK);
    }
  }

  #renderCast(renderer: Renderer): void {
    const match = this.#match;
    const mover = boardOf(match, match.seat);
    for (let slot = 0; slot < CAST; slot += 1) {
      const x = slotX(slot);
      const y = slotY(slot);
      const character = characterAt(match, slot);
      const standing = isLive(mover, character);
      renderer.rect(x + 3, y + 3, CELL_W - 6, CELL_H - 6, standing ? COLOUR_PLATE : COLOUR_FAINT);
      drawCharacter(
        renderer,
        x + CELL_W / 2,
        y + CELL_H / 2 - 6,
        GLYPH_RADIUS,
        character,
        standing ? COLOUR_INK : COLOUR_PLATE_OUT,
      );
      // Both boards, on one grid. Seat one's verdict on this character sits in the left
      // corner and seat two's in the right, and neither leaks: seat one's board is about
      // the character seat one is hunting, which is not the character seat two is hunting.
      drawPip(renderer, x + 15, y + 15, 'p1', isLive(match.p1, character));
      drawPip(renderer, x + CELL_W - 15, y + 15, 'p2', isLive(match.p2, character));
    }
    if (this.#cursor.visible && this.#cursor.index < CAST) {
      drawCursor(renderer, this.#cursor.index, match.seat);
    }
  }

  #renderChips(renderer: Renderer): void {
    const match = this.#match;
    const board = boardOf(match, match.seat);
    for (let question = 0; question < QUESTIONS; question += 1) {
      const x = BOARD_X + question * CELL_W;
      const legal = splitsQuestion(board, question);
      renderer.rect(x + 3, CHIP_Y + 3, CELL_W - 6, CHIP_H - 6, legal ? COLOUR_PLATE : COLOUR_FAINT);
      drawQuestion(
        renderer,
        x + CELL_W / 2,
        CHIP_Y + CHIP_H / 2,
        24,
        question,
        legal ? COLOUR_INK : COLOUR_PLATE_OUT,
      );
      // A question that no longer divides the board is struck through rather than merely
      // faded, so the board still reads with the colour taken out.
      if (!legal) {
        renderer.line(x + 14, CHIP_Y + CHIP_H - 14, x + CELL_W - 14, CHIP_Y + 14, 4, COLOUR_MUTED);
      }
    }
    if (this.#cursor.visible && this.#cursor.index >= CAST) {
      drawCursor(renderer, this.#cursor.index, match.seat);
    }
  }
}

/* ------------------------------------------------------------------- the lattice */

export function slotX(slot: number): number {
  const column = slot >= CAST ? slot - CAST : slot % COLUMNS;
  return BOARD_X + column * CELL_W;
}

export function slotY(slot: number): number {
  return slot >= CAST ? CHIP_Y : CAST_Y + Math.floor(slot / COLUMNS) * CELL_H;
}

export function slotHeight(slot: number): number {
  return slot >= CAST ? CHIP_H : CELL_H;
}

/** The slot a point falls on, or -1. */
export function slotAt(x: number, y: number): number {
  const column = Math.floor((x - BOARD_X) / CELL_W);
  if (column < 0 || column >= COLUMNS) return -1;
  if (y >= CHIP_Y && y < CHIP_Y + CHIP_H) return CAST + column;
  const row = Math.floor((y - CAST_Y) / CELL_H);
  if (row < 0 || row >= CAST_ROWS) return -1;
  return row * COLUMNS + column;
}

/* -------------------------------------------------------------------- the glyphs */

/**
 * A character: an outline, a core, and one to three feet.
 *
 * Three attributes of three values each, and **not one of them is a colour**. Everything
 * on this board is drawn in one ink, so a player who cannot separate the two seat colours
 * — or who has turned the saturation off entirely — reads every character exactly as
 * anybody else does.
 */
export function drawCharacter(
  renderer: Renderer,
  cx: number,
  cy: number,
  radius: number,
  character: number,
  ink: string,
): void {
  drawOutline(renderer, cx, cy, radius, valueOf(character, 0), ink);
  drawCore(renderer, cx, cy, radius, valueOf(character, 1), ink);
  drawFeet(renderer, cx, cy, radius, valueOf(character, 2), ink);
}

/** A question chip shows the one feature it asks about, drawn on its own. */
export function drawQuestion(
  renderer: Renderer,
  cx: number,
  cy: number,
  radius: number,
  question: number,
  ink: string,
): void {
  const attribute = attributeOfQuestion(question);
  const value = valueOfQuestion(question);
  if (attribute === 0) drawOutline(renderer, cx, cy, radius, value, ink);
  else if (attribute === 1) drawCore(renderer, cx, cy, radius, value, ink);
  else drawFeet(renderer, cx, cy - radius * 0.6, radius, value, ink);
}

/**
 * The outline: five silhouettes, told apart by shape alone.
 *
 * A round head, a square one, a diamond, and the two triangles — which are the same three
 * strokes pointing opposite ways, and are the pair a player learns to read last, so they
 * are drawn at full width rather than nested.
 */
function drawOutline(
  renderer: Renderer,
  cx: number,
  cy: number,
  radius: number,
  value: number,
  ink: string,
): void {
  const width = 5;
  if (value === 0) {
    renderer.strokeCircle(cx, cy, radius, width, ink);
    return;
  }
  if (value === 1) {
    renderer.strokeRect(cx - radius, cy - radius, radius * 2, radius * 2, width, ink);
    return;
  }
  if (value === 2) {
    renderer.line(cx, cy - radius, cx + radius, cy, width, ink);
    renderer.line(cx + radius, cy, cx, cy + radius, width, ink);
    renderer.line(cx, cy + radius, cx - radius, cy, width, ink);
    renderer.line(cx - radius, cy, cx, cy - radius, width, ink);
    return;
  }
  const point = value === 3 ? cy - radius : cy + radius;
  const base = value === 3 ? cy + radius : cy - radius;
  renderer.line(cx, point, cx + radius, base, width, ink);
  renderer.line(cx + radius, base, cx - radius, base, width, ink);
  renderer.line(cx - radius, base, cx, point, width, ink);
}

function drawCore(
  renderer: Renderer,
  cx: number,
  cy: number,
  radius: number,
  value: number,
  ink: string,
): void {
  const long = radius;
  const thick = radius * 0.28;
  if (value === 0) {
    renderer.circle(cx, cy, radius * 0.3, ink);
    return;
  }
  if (value === 1) {
    renderer.rect(cx - long / 2, cy - thick / 2, long, thick, ink);
    return;
  }
  renderer.rect(cx - thick / 2, cy - long / 2, thick, long, ink);
}

/** The feet: one stroke or two. A fixed multiplicity, which reads with no colour at all. */
function drawFeet(
  renderer: Renderer,
  cx: number,
  cy: number,
  radius: number,
  value: number,
  ink: string,
): void {
  const count = value + 1;
  const spread = radius * 0.45;
  const top = cy + radius + 8;
  const bottom = top + radius * 0.5;
  for (let index = 0; index < count; index += 1) {
    const offset = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;
    renderer.line(cx + offset * spread, top, cx + offset * spread, bottom, 5, ink);
  }
}

/**
 * A seat's verdict on one character.
 *
 * **Seat one is round and seat two is square, everywhere in this game**, and a candidate
 * still standing is solid where one struck off is a wire outline. Four marks, two axes,
 * and colour agrees with the shape rather than carrying it: with the colour removed a
 * player still reads whose pip it is and what it says.
 */
function drawPip(
  renderer: Renderer,
  cx: number,
  cy: number,
  seat: SeatId,
  standing: boolean,
): void {
  const colour = SEAT_PALETTE[seat].base;
  if (seat === 'p1') {
    if (standing) renderer.circle(cx, cy, PIP_RADIUS, colour);
    else renderer.strokeCircle(cx, cy, PIP_RADIUS, 3, colour);
    return;
  }
  // Equal area to the disc, so neither seat's pip reads as the heavier one.
  const side = PIP_RADIUS * Math.sqrt(Math.PI);
  if (standing) renderer.rect(cx - side / 2, cy - side / 2, side, side, colour);
  else renderer.strokeRect(cx - side / 2, cy - side / 2, side, side, 3, colour);
}

/** The keyboard cursor, in the same two shapes the seats are told apart by. */
function drawCursor(renderer: Renderer, slot: number, seat: SeatId): void {
  const x = slotX(slot);
  const y = slotY(slot);
  const height = slotHeight(slot);
  const colour = SEAT_PALETTE[seat].base;
  if (seat === 'p1') {
    renderer.strokeCircle(x + CELL_W / 2, y + height / 2, CELL_W / 2 - 6, 6, colour);
    return;
  }
  renderer.strokeRect(x + 8, y + 8, CELL_W - 16, height - 16, 6, colour);
}
