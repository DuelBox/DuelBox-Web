import { Rng, SEAT_PALETTE, SeatFlip, seatRotated, set, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CELL_COUNT,
  DOWN,
  GAP,
  LEFT,
  MOVES_PER_SEAT,
  RIGHT,
  SIZE,
  UP,
  applyMove,
  botMove,
  createBotRngs,
  createMatch,
  homeCellFor,
  isLegalMove,
  opposite,
  resetMatch,
  stepCell,
} from './rules.js';
import type { BotDifficulty, Match } from './rules.js';

/**
 * Board geometry in logical units.
 *
 * The board is **centred in the logical box**, and that is a correctness requirement
 * rather than a taste: the shell turns the whole world half a turn about the centre when
 * the move changes hands, so a board drawn off-centre would sit somewhere different for
 * each player. The two margins left over are equal for the same reason — each holds one
 * seat's slide counter, and the half-turn carries each seat's counter to the edge nearest
 * them.
 */
export const BOARD_SPAN = 690;
export const BOARD_ORIGIN = (manifest.logical.width - BOARD_SPAN) / 2;
export const CELL_PITCH = BOARD_SPAN / SIZE;
/** The dead space between two tiles, so a tap that lands between them slides neither. */
const TILE_INSET = 12;
export const TILE_SIZE = CELL_PITCH - TILE_INSET * 2;

/**
 * Every delay is converted to whole simulation steps before it is counted down, so a
 * replay of the same inputs produces the same match on a 60 Hz phone and a 144 Hz laptop.
 */
export const THINK_SECONDS = 0.42;
export const SLIDE_SECONDS = 0.13;

/** Below this a direction is noise rather than intent. Matches the engine's grid cursor. */
const DEAD_ZONE = 0.5;

const COLOUR_BACKGROUND = '#111823';
const COLOUR_BOARD = '#1d2735';
const COLOUR_GAP = '#090e15';
const COLOUR_HATCH = '#33415a';
const COLOUR_TILE = '#e9edf5';
const COLOUR_TILE_HOME = '#ffffff';
const COLOUR_TILE_EDGE = '#0c121b';
const COLOUR_INK = '#141a24';
const COLOUR_SPENT = '#33415a';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

const BOARD_EDGE_WIDTH = 8;
const TILE_EDGE_WIDTH = 4;
const LABEL_SIZE = 96;
const BADGE_RADIUS = 17;
const BADGE_WIDTH = 6;
const BADGE_INSET = 34;
/** Half-diagonal of the cross, as a fraction of the ring's radius it stands in for. */
const CROSS_REACH = 0.78;

const CHEVRON_REACH = 30;
const CHEVRON_SPREAD = 24;
const CHEVRON_WIDTH = 7;
const BAR_Y = 848;
/** 23 pips at a pitch of 25 span 570, which centres the row on the board's own centre. */
const BAR_X = 165;
const PIP_PITCH = 25;
const PIP_WIDTH = 20;
const PIP_HEIGHT = 18;
const BAR_MARK_X = 110;
const BAR_MARK_RADIUS = 16;
const BAR_MARK_WIDTH = 5;

/**
 * Tile labels, looked up rather than built.
 *
 * `String(value)` in a draw loop is eight throwaway strings a frame for no reason at all.
 */
const TILE_LABELS: readonly string[] = Object.freeze(['', '1', '2', '3', '4', '5', '6', '7', '8']);

/** Centre of a cell in board space. Writes into `out` and allocates nothing. */
export function cellCentre(out: Vec2, cell: number): Vec2 {
  const column = cell % SIZE;
  const row = Math.floor(cell / SIZE);
  return set(
    out,
    BOARD_ORIGIN + (column + 0.5) * CELL_PITCH,
    BOARD_ORIGIN + (row + 0.5) * CELL_PITCH,
  );
}

/**
 * Cell a point in board space falls on, or -1 when it misses.
 *
 * The gap between two tiles is dead space rather than being rounded to the nearer tile,
 * so a tap that lands on the seam slides neither of them.
 */
export function cellAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN;
  const localY = y - BOARD_ORIGIN;
  if (localX < 0 || localY < 0) return -1;
  if (localX >= BOARD_SPAN || localY >= BOARD_SPAN) return -1;

  const column = Math.floor(localX / CELL_PITCH);
  const row = Math.floor(localY / CELL_PITCH);
  const offsetX = localX - column * CELL_PITCH;
  const offsetY = localY - row * CELL_PITCH;
  if (offsetX < TILE_INSET || offsetX > CELL_PITCH - TILE_INSET) return -1;
  if (offsetY < TILE_INSET || offsetY > CELL_PITCH - TILE_INSET) return -1;
  return row * SIZE + column;
}

/**
 * The direction a seat's movement vector names, in that seat's own frame, or -1.
 *
 * Quantised to one of four before anything else: a board has no use for the magnitude,
 * and quantising here means a thumbstick and a key say the same thing.
 */
export function directionOf(x: number, y: number): number {
  const across = Math.abs(x);
  const down = Math.abs(y);
  if (across < DEAD_ZONE && down < DEAD_ZONE) return -1;
  if (across >= down) return x > 0 ? RIGHT : LEFT;
  return y > 0 ? DOWN : UP;
}

export class SlidingPuzzleGame implements Game {
  readonly #match: Match = createMatch();
  readonly #pointerWorld: Vec2 = vec2();
  /** Render-only scratch. Written during render(), never read by the simulation. */
  readonly #scratch: Vec2 = vec2();
  readonly #scratchTo: Vec2 = vec2();

  /**
   * The board turning to face whoever has the move.
   *
   * Steps on the fixed timestep like everything else, so two devices rotate through the
   * same angles on the same steps.
   */
  readonly #flip = new SeatFlip();

  #logical: LogicalSize = manifest.logical;
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #rngP1: Rng = new Rng(0);
  #rngP2: Rng = new Rng(0);

  /** Direction each seat was pushing last step, so a slide fires on a press, not a hold. */
  #heldP1 = -1;
  #heldP2 = -1;

  #slideSteps = 0;
  #slideTotal = 1;
  /** Negative until this turn's think delay has been sized in steps. */
  #thinkSteps = -1;
  #stepsPerSecond = 0;

  init(context: GameContext): void {
    this.#logical = context.manifest.logical;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    const rngs = createBotRngs(context.rng);
    this.#rngP1 = rngs.p1;
    this.#rngP2 = rngs.p2;

    // The opener comes from the shell, which alternates it across the rounds of a best-of.
    resetMatch(this.#match, context.rng, context.openingSeat);

    this.#heldP1 = -1;
    this.#heldP2 = -1;
    this.#slideSteps = 0;
    this.#slideTotal = 1;
    this.#thinkSteps = -1;
    this.#stepsPerSecond = 0;
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);

    // Both seats are tracked every step, whether or not it is their turn: a direction held
    // through the hand-over must be released and pressed again to slide anything, or the
    // key a player was still leaning on would spend the first move of their turn.
    const p1Edge = this.#trackDirection(input, 'p1');
    const p2Edge = this.#trackDirection(input, 'p2');

    if (this.#match.winner !== null) return;
    if (this.#slideSteps > 0) {
      this.#slideSteps -= 1;
      return;
    }

    const active = this.#match.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      const rng = active === 'p1' ? this.#rngP1 : this.#rngP2;
      this.#play(botMove(this.#match, rng, difficulty));
      return;
    }

    // Nothing is accepted while the board is part-way round: the tile under a finger is
    // moving, so a tap would slide one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    const rotated = this.#flip.rotated;
    const edge = active === 'p1' ? p1Edge : p2Edge;
    if (edge >= 0) {
      // The far seat reads the board half a turn round, so their "left" is its right.
      this.#play(rotated ? opposite(edge) : edge);
      return;
    }

    const seatInput = input.seat(active);
    if (!seatInput.actionPressed) return;
    const pointer = seatInput.pointer;
    // Only a key raises a press with no pointer, and a key has already had its turn above.
    if (pointer === null) return;
    toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, rotated);
    this.#play(this.#directionOfCell(cellAt(this.#pointerWorld.x, this.#pointerWorld.y)));
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps — the slide is counted in whole steps — so the implementation ignores it.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawCells(renderer);
    this.#drawMovingTile(renderer);
    this.#drawHints(renderer);
    this.#drawSlidesLeft(renderer, 'p1');
    this.#drawSlidesLeft(renderer, 'p2');
    renderer.popSeatRotation();
  }

  // The shell stops stepping a paused match, and every delay here is counted in steps
  // rather than seconds, so there is nothing of its own to suspend or restart.
  onPause(): void {}

  onResume(): void {}

  /**
   * The two best-ever arrangements, which is what the match is decided on. A score that
   * only ever climbs, so the HUD never takes a tile back off a player who earned it.
   */
  getScore(): MatchScore {
    return { p1: this.#match.p1Best, p2: this.#match.p2Best, winner: this.#match.winner };
  }

  /** Whose turn it is. The shell's turn indicator and seat flip both read this. */
  getActiveSeat(): SeatId {
    return this.#match.active;
  }

  destroy(): void {
    this.#match.winner = null;
    this.#match.active = 'p1';
    this.#match.turnSlides = 0;
    this.#match.p1Moves = 0;
    this.#match.p2Moves = 0;
    this.#match.p1Best = 0;
    this.#match.p2Best = 0;
    this.#match.p1Closest = 0;
    this.#match.p2Closest = 0;
    this.#match.lastDirection = -1;
    this.#match.movedValue = GAP;
    this.#match.movedFrom = -1;
    this.#match.movedTo = -1;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) this.#match.board[cell] = GAP;
    this.#heldP1 = -1;
    this.#heldP2 = -1;
    this.#slideSteps = 0;
    this.#thinkSteps = -1;
  }

  /** Read-only view of the board, for the tests and any harness. Never mutate through it. */
  get board(): readonly number[] {
    return this.#match.board;
  }

  /** Read-only view of the match state. */
  get match(): Readonly<Match> {
    return this.#match;
  }

  /** Steps left in the slide animation; zero when nothing is moving. */
  get slideCountdown(): number {
    return this.#slideSteps;
  }

  #play(direction: number): void {
    if (direction < 0) return;
    if (!applyMove(this.#match, direction)) return;
    this.#slideTotal = this.#stepsFor(SLIDE_SECONDS);
    this.#slideSteps = this.#slideTotal;
    this.#thinkSteps = -1;
  }

  /**
   * The direction that slides the tile in `cell`, or -1 when that tile is not beside the
   * gap. A tap names a tile; the rules name a direction; this is the one translation.
   */
  #directionOfCell(cell: number): number {
    if (cell < 0) return -1;
    for (let direction = 0; direction < 4; direction += 1) {
      if (stepCell(this.#match.gap, direction) === cell) return direction;
    }
    return -1;
  }

  /** The fresh direction a seat pressed this step, in the seat's own frame, or -1. */
  #trackDirection(input: InputState, seat: SeatId): number {
    const seatInput = input.seat(seat);
    const now = directionOf(seatInput.move.x, seatInput.move.y);
    const held = seat === 'p1' ? this.#heldP1 : this.#heldP2;
    if (seat === 'p1') this.#heldP1 = now;
    else this.#heldP2 = now;
    // A press, never a hold: the slide budget is small enough that an auto-repeating key
    // would spend a player's whole turn allowance in a third of a second.
    return now >= 0 && now !== held ? now : -1;
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatRotated(this.#match.active, this.#presentation, this.#localSeat);
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #drawBoard(renderer: Renderer): void {
    renderer.rect(BOARD_ORIGIN, BOARD_ORIGIN, BOARD_SPAN, BOARD_SPAN, COLOUR_BOARD);
    const seat = this.#match.active;
    const colour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    renderer.strokeRect(
      BOARD_ORIGIN,
      BOARD_ORIGIN,
      BOARD_SPAN,
      BOARD_SPAN,
      BOARD_EDGE_WIDTH,
      colour,
    );
    // The same mark in both half-turn-opposite corners, so the frame reads the same way
    // round whichever seat is looking at it.
    this.#drawSeatMark(renderer, seat, BOARD_ORIGIN, BOARD_ORIGIN, BADGE_RADIUS, BADGE_WIDTH);
    const far = BOARD_ORIGIN + BOARD_SPAN;
    this.#drawSeatMark(renderer, seat, far, far, BADGE_RADIUS, BADGE_WIDTH);
  }

  #drawCells(renderer: Renderer): void {
    const half = TILE_SIZE / 2;
    const sliding = this.#slideSteps > 0;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const value = this.#match.board[cell] ?? GAP;
      cellCentre(this.#scratch, cell);
      const x = this.#scratch.x;
      const y = this.#scratch.y;

      // While a tile is in flight both the cell it left and the cell it has not reached
      // yet are drawn empty, and the tile itself is drawn on top between them.
      const empty = value === GAP || (sliding && cell === this.#match.movedTo);
      if (empty) {
        renderer.rect(x - half, y - half, TILE_SIZE, TILE_SIZE, COLOUR_GAP);
        const reach = half - 46;
        renderer.line(x - reach, y - reach, x + reach, y + reach, 5, COLOUR_HATCH);
        renderer.line(x + reach, y - reach, x - reach, y + reach, 5, COLOUR_HATCH);
        continue;
      }
      this.#drawTile(renderer, value, x, y);
    }
  }

  #drawMovingTile(renderer: Renderer): void {
    if (this.#slideSteps <= 0) return;
    const { movedValue, movedFrom, movedTo } = this.#match;
    if (movedValue === GAP || movedFrom < 0 || movedTo < 0) return;
    const progress = 1 - this.#slideSteps / this.#slideTotal;
    cellCentre(this.#scratch, movedFrom);
    cellCentre(this.#scratchTo, movedTo);
    const x = this.#scratch.x + (this.#scratchTo.x - this.#scratch.x) * progress;
    const y = this.#scratch.y + (this.#scratchTo.y - this.#scratch.y) * progress;
    this.#drawTile(renderer, movedValue, x, y);
  }

  /**
   * One tile: a number, and a badge for each seat whose order it is already correct for.
   *
   * The number carries the tile's identity and the badge shape carries whose home it is
   * standing in, so nothing on the board needs colour to be read. Seat one's ring sits in
   * the corner nearest seat one and seat two's cross in the corner nearest seat two, which
   * survives the half-turn: each player finds their own mark in the same place.
   */
  #drawTile(renderer: Renderer, value: number, x: number, y: number): void {
    const half = TILE_SIZE / 2;
    const cell = this.#cellUnder(value);
    const p1Home = homeCellFor('p1', value) === cell;
    const p2Home = homeCellFor('p2', value) === cell;
    const face = p1Home || p2Home ? COLOUR_TILE_HOME : COLOUR_TILE;
    renderer.rect(x - half, y - half, TILE_SIZE, TILE_SIZE, face);
    renderer.strokeRect(
      x - half,
      y - half,
      TILE_SIZE,
      TILE_SIZE,
      TILE_EDGE_WIDTH,
      COLOUR_TILE_EDGE,
    );
    renderer.text(TILE_LABELS[value] ?? '', x, y, LABEL_SIZE, COLOUR_INK, 'centre');
    if (p1Home) {
      this.#drawSeatMark(
        renderer,
        'p1',
        x - half + BADGE_INSET,
        y - half + BADGE_INSET,
        BADGE_RADIUS,
        BADGE_WIDTH,
      );
    }
    if (p2Home) {
      this.#drawSeatMark(
        renderer,
        'p2',
        x + half - BADGE_INSET,
        y + half - BADGE_INSET,
        BADGE_RADIUS,
        BADGE_WIDTH,
      );
    }
  }

  /** Which cell a tile is standing in, or -1. Eight cells, so a scan is the whole cost. */
  #cellUnder(value: number): number {
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      if (this.#match.board[cell] === value) return cell;
    }
    return -1;
  }

  /**
   * What may be slid, and what may not.
   *
   * An arrow on every tile that can move into the gap, and a bar across the one tile that
   * cannot — the slide that would immediately undo the last one. The ban is a rule a
   * player has to know about, so it is drawn rather than explained.
   */
  #drawHints(renderer: Renderer): void {
    if (this.#match.winner !== null || this.#slideSteps > 0) return;
    const gap = this.#match.gap;
    cellCentre(this.#scratchTo, gap);
    const gapX = this.#scratchTo.x;
    const gapY = this.#scratchTo.y;
    const colour = this.#match.active === 'p1' ? COLOUR_P1 : COLOUR_P2;

    for (let direction = 0; direction < 4; direction += 1) {
      const cell = stepCell(gap, direction);
      if (cell < 0) continue;
      cellCentre(this.#scratch, cell);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      const unitX = (gapX - x) / CELL_PITCH;
      const unitY = (gapY - y) / CELL_PITCH;

      if (!isLegalMove(this.#match, direction)) {
        // A bar across the face of the tile that is locked this turn.
        const barX = x + unitX * (TILE_SIZE / 2 - CHEVRON_REACH);
        const barY = y + unitY * (TILE_SIZE / 2 - CHEVRON_REACH);
        renderer.line(
          barX - unitY * CHEVRON_SPREAD,
          barY + unitX * CHEVRON_SPREAD,
          barX + unitY * CHEVRON_SPREAD,
          barY - unitX * CHEVRON_SPREAD,
          CHEVRON_WIDTH,
          COLOUR_SPENT,
        );
        continue;
      }

      const tipX = x + unitX * (TILE_SIZE / 2 - 14);
      const tipY = y + unitY * (TILE_SIZE / 2 - 14);
      const backX = tipX - unitX * CHEVRON_REACH;
      const backY = tipY - unitY * CHEVRON_REACH;
      renderer.line(
        tipX,
        tipY,
        backX - unitY * CHEVRON_SPREAD,
        backY + unitX * CHEVRON_SPREAD,
        CHEVRON_WIDTH,
        colour,
      );
      renderer.line(
        tipX,
        tipY,
        backX + unitY * CHEVRON_SPREAD,
        backY - unitX * CHEVRON_SPREAD,
        CHEVRON_WIDTH,
        colour,
      );
    }
  }

  /**
   * One seat's remaining slides, as pips, in the margin nearest that seat.
   *
   * Seat two's row is the exact half-turn of seat one's, so when the board turns each
   * player's own counter arrives at the edge in front of them, counting the same way.
   */
  #drawSlidesLeft(renderer: Renderer, seat: SeatId): void {
    const left = seat === 'p1' ? this.#match.p1Moves : this.#match.p2Moves;
    const colour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    const mirror = seat === 'p2';
    const width = manifest.logical.width;
    const height = manifest.logical.height;

    for (let i = 0; i < MOVES_PER_SEAT; i += 1) {
      const x = BAR_X + i * PIP_PITCH;
      const y = BAR_Y;
      const drawX = mirror ? width - x - PIP_WIDTH : x;
      const drawY = mirror ? height - y - PIP_HEIGHT : y;
      if (i < left) renderer.rect(drawX, drawY, PIP_WIDTH, PIP_HEIGHT, colour);
      else renderer.strokeRect(drawX, drawY, PIP_WIDTH, PIP_HEIGHT, 3, COLOUR_SPENT);
    }

    const markX = mirror ? width - BAR_MARK_X : BAR_MARK_X;
    const markY = mirror ? height - BAR_Y - PIP_HEIGHT / 2 : BAR_Y + PIP_HEIGHT / 2;
    this.#drawSeatMark(renderer, seat, markX, markY, BAR_MARK_RADIUS, BAR_MARK_WIDTH);
  }

  /**
   * A ring for seat one and a cross for seat two, the pairing the rest of the catalogue
   * uses. The shape carries the seat on its own, so nothing here needs colour to be read.
   */
  #drawSeatMark(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    width: number,
  ): void {
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, radius, width, COLOUR_P1);
      return;
    }
    const reach = radius * CROSS_REACH;
    renderer.line(x - reach, y - reach, x + reach, y + reach, width, COLOUR_P2);
    renderer.line(x + reach, y - reach, x - reach, y + reach, width, COLOUR_P2);
  }
}
