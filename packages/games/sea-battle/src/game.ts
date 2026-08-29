import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CELL_COUNT,
  FLEET,
  GRID,
  botShot,
  canPlace,
  cellAt,
  columnOf,
  createBotMemory,
  createGame,
  fire,
  fleetOf,
  isSunk,
  nextShipLength,
  otherOf,
  place,
  placeRandomFleet,
  recordPlacement,
  rememberShot,
  resetBotMemory,
  resetGame,
  rowOf,
  shipCells,
  shipsRemaining,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotMemory, Fleet, Game as Position, Orientation } from './rules.js';

/**
 * Board geometry in logical units. Exported because working out which cell a finger is on
 * is not a rendering question — the tests need the same mapping the game uses.
 */
export const BOARD_ORIGIN_X = 130;
export const BOARD_ORIGIN_Y = 170;
/**
 * 640, not 700. At 700 the board ran to y = 890 in a 900-unit box and the fleet status
 * below it was drawn at 932 — outside the logical area, where the renderer's clip threw it
 * away. Nothing errored; the markers were simply never there.
 */
export const BOARD_EXTENT = 640;
export const CELL_EXTENT = BOARD_EXTENT / GRID;

/** During placement the two seats work side by side, so each gets half the width. */
export const HALF_ORIGIN_Y = 150;
export const HALF_EXTENT = 380;
export const HALF_CELL = HALF_EXTENT / GRID;
export const HALF_LEFT_X = 40;
export const HALF_RIGHT_X = 900 - 40 - HALF_EXTENT;

const COLOUR_BACKGROUND = '#0b1521';
const COLOUR_WATER = '#12314c';

const COLOUR_LINE = 'rgba(198, 226, 246, 0.35)';
const COLOUR_TEXT = '#dcecf8';
const COLOUR_MUTED = 'rgba(220, 236, 248, 0.6)';
const COLOUR_MISS = 'rgba(220, 236, 248, 0.5)';
const COLOUR_HIT = '#ff8a3d';
const COLOUR_SUNK = '#b6220f';
const COLOUR_HULL = '#7f8c99';

/** The seat mark above each half during placement, when both fleets share the screen. */
const SEAT_MARK_RADIUS = 11;

const THINK_SECONDS = 0.7;
const REVEAL_SECONDS = 0.9;
const SETTLE_SECONDS = 1.2;

export class SeaBattleGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({ columns: GRID, rows: GRID });
  readonly #placeCursorP1 = new GridCursor({ columns: GRID, rows: GRID });
  readonly #placeCursorP2 = new GridCursor({ columns: GRID, rows: GRID });
  readonly #botMemoryP1: BotMemory = createBotMemory();
  readonly #botMemoryP2: BotMemory = createBotMemory();
  readonly #cellScratch: number[] = [];

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | null = null;
  #orientationP1: Orientation = 'across';
  #orientationP2: Orientation = 'across';
  #lastResult = '';

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #revealSteps = 0;
  #settleSteps = 0;

  /** Exposed for tests, which need to state a position rather than play into one. */
  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#orientationP1 = 'across';
    this.#orientationP2 = 'across';
    this.#lastResult = '';
    this.#thinkSteps = -1;
    this.#revealSteps = 0;
    this.#settleSteps = 0;
    resetGame(this.#position, context.openingSeat);
    resetBotMemory(this.#botMemoryP1);
    resetBotMemory(this.#botMemoryP2);
    this.#cursor.reset();
    this.#placeCursorP1.reset();
    this.#placeCursorP2.reset();

    // A bot lays its fleet out at once; it has nothing to deliberate over and a player
    // should not wait while it pretends to.
    if (this.#botP1 !== null) this.#autoPlace('p1');
    if (this.#botP2 !== null) this.#autoPlace('p2');
    this.#flip.snap(this.#shouldRotate());
  }

  #autoPlace(seat: SeatId): void {
    placeRandomFleet(fleetOf(this.#position, seat), this.#rng);
    for (let i = 0; i < FLEET.length; i += 1) recordPlacement(this.#position, seat);
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

    if (this.#revealSteps > 0) {
      this.#revealSteps -= 1;
      if (this.#revealSteps === 0) this.#afterShot();
      return;
    }

    if (this.#position.phase === 'placing') {
      this.#updatePlacing(fixedDeltaSeconds, input);
      return;
    }
    this.#updateFiring(fixedDeltaSeconds, input);
  }

  /**
   * Both seats lay out at the same time, each on their own half of the device.
   *
   * This is what lets Sea Battle work on one screen without a hand-the-device-over
   * ceremony: nobody is waiting, and once firing starts **a fleet is never drawn again**,
   * so there is nothing on screen for the other player to read.
   */
  #updatePlacing(fixedDeltaSeconds: number, input: InputState): void {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      if (nextShipLength(this.#position, seat) === 0) continue;
      if ((seat === 'p1' ? this.#botP1 : this.#botP2) !== null) continue;

      const seatInput = input.seat(seat);
      const cursor = seat === 'p1' ? this.#placeCursorP1 : this.#placeCursorP2;
      cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, false);

      const pointer = seatInput.pointer;
      if (pointer !== null && seatInput.actionPressed) {
        toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, false);
        const tapped = this.#halfCellAt(seat, this.#pointerWorld.x, this.#pointerWorld.y);
        if (tapped < 0) continue;
        // Tapping the cell the cursor is already on turns the ship instead of placing it
        // on top of itself, which is the only rotation gesture a one-finger board affords.
        if (tapped === cursor.index) this.#turn(seat);
        else cursor.moveTo(tapped);
        this.#tryPlace(seat, cursor.index);
        continue;
      }
      if (seatInput.actionPressed) this.#tryPlace(seat, cursor.index);
      // `holdSeconds` is zero on the release step by contract, so the obvious spelling of
      // this — `actionReleased && holdSeconds > 0.4` — is a contradiction, and the rotate
      // it guards had never once fired for a keyboard player (#2475).
      if (seatInput.actionReleased && seatInput.holdSecondsAtRelease > 0.4) this.#turn(seat);
    }
  }

  #turn(seat: SeatId): void {
    if (seat === 'p1') this.#orientationP1 = this.#orientationP1 === 'across' ? 'down' : 'across';
    else this.#orientationP2 = this.#orientationP2 === 'across' ? 'down' : 'across';
  }

  #tryPlace(seat: SeatId, cell: number): void {
    const length = nextShipLength(this.#position, seat);
    if (length === 0) return;
    const orientation = seat === 'p1' ? this.#orientationP1 : this.#orientationP2;
    if (!place(fleetOf(this.#position, seat), cell, length, orientation)) return;
    recordPlacement(this.#position, seat);
  }

  #updateFiring(fixedDeltaSeconds: number, input: InputState): void {
    const seat = this.#position.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      const target = fleetOf(this.#position, otherOf(seat));
      const memory = seat === 'p1' ? this.#botMemoryP1 : this.#botMemoryP2;
      const cell = botShot(target, memory, this.#rng, difficulty);
      if (cell < 0) return;
      const shot = fire(this.#position, otherOf(seat), cell);
      rememberShot(memory, difficulty, cell, shot);
      this.#recordShot(shot.result);
      return;
    }

    if (!this.#flip.acceptsInput) return;
    const seatInput = input.seat(seat);
    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    if (!seatInput.actionPressed) return;
    let cell = this.#cursor.index;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = this.#boardCellAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      cell = tapped;
      this.#cursor.moveTo(tapped);
    }
    const shot = fire(this.#position, otherOf(seat), cell);
    if (shot.result === 'repeat') return;
    this.#recordShot(shot.result);
  }

  #recordShot(result: string): void {
    this.#lastResult = result;
    this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
  }

  /**
   * After a shot has been shown.
   *
   * A hit buys another shot — the rule that makes finding a ship worth something and the
   * reason a good player's turn can run long.
   */
  #afterShot(): void {
    if (winnerOf(this.#position) !== null) {
      this.#position.phase = 'over';
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }
    if (this.#lastResult === 'miss') {
      this.#position.seat = otherOf(this.#position.seat);
      this.#cursor.reset();
    }
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    if (this.#position.phase !== 'firing') return false;
    return this.#position.seat !== this.#localSeat;
  }

  /** No turns while both seats lay out at once — which is how the shell knows to split. */
  getActiveSeat(): SeatId | null {
    return this.#position.phase === 'placing' ? null : this.#position.seat;
  }

  getScore(): MatchScore {
    // Ships sunk, which counts up and is the number a player is actually tracking.
    //
    // Counted against the fleet's own size rather than FLEET.length: before placement a
    // fleet has no ships, and "all five of nothing are sunk" put the match at 5–5 on the
    // lobby screen. The same trap caught `fleetDestroyed` in the rules module.
    return {
      p1: sunkCount(this.#position.p2),
      p2: sunkCount(this.#position.p1),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotMemory(this.#botMemoryP1);
    resetBotMemory(this.#botMemoryP2);
    this.#matchWinner = null;
    this.#revealSteps = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
  }

  /** The cell of the shared firing board a point falls on, or -1. */
  #boardCellAt(x: number, y: number): number {
    return cellIn(x, y, BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CELL_EXTENT);
  }

  /** The cell of one seat's placement half a point falls on, or -1. */
  #halfCellAt(seat: SeatId, x: number, y: number): number {
    const originX = seat === 'p1' ? HALF_LEFT_X : HALF_RIGHT_X;
    return cellIn(x, y, originX, HALF_ORIGIN_Y, HALF_CELL);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    if (this.#position.phase === 'placing') {
      this.#renderPlacing(renderer);
      return;
    }
    renderer.pushRotation(this.#flip.angle);
    this.#renderFiring(renderer);
    renderer.popSeatRotation();
  }

  #renderPlacing(renderer: Renderer): void {
    renderer.text('Lay out your fleet', 450, 90, 40, COLOUR_TEXT, 'centre');
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const originX = seat === 'p1' ? HALF_LEFT_X : HALF_RIGHT_X;
      const fleet = fleetOf(this.#position, seat);
      const palette = SEAT_PALETTE[seat];
      renderer.rect(originX, HALF_ORIGIN_Y, HALF_EXTENT, HALF_EXTENT, COLOUR_WATER);
      drawGrid(renderer, originX, HALF_ORIGIN_Y, HALF_CELL);
      renderer.strokeRect(originX, HALF_ORIGIN_Y, HALF_EXTENT, HALF_EXTENT, 5, palette.base);
      // Both halves are on screen at once during placement, drawn from the identical
      // strokeRect and the identical grid, so only the colour told them apart — rule 7,
      // and the board was unreadable in greyscale (#2496). The seat mark is the shell's
      // own: a disc for seat one, a square for seat two, at equal area so neither half
      // reads as the heavier one.
      const markX = originX + HALF_EXTENT / 2;
      const markY = HALF_ORIGIN_Y - 26;
      if (seat === 'p1') {
        renderer.circle(markX, markY, SEAT_MARK_RADIUS, palette.base);
      } else {
        const side = SEAT_MARK_RADIUS * Math.sqrt(Math.PI);
        renderer.rect(markX - side / 2, markY - side / 2, side, side, palette.base);
      }

      // Your own fleet, in your own half, while you are laying it out. This is the only
      // moment either fleet is ever drawn.
      for (const ship of fleet.ships) {
        shipCells(this.#cellScratch, ship.cell, ship.length, ship.orientation);
        for (const cell of this.#cellScratch) {
          fillCell(renderer, originX, HALF_ORIGIN_Y, HALF_CELL, cell, COLOUR_HULL);
        }
      }

      const remaining = nextShipLength(this.#position, seat);
      if (remaining === 0) {
        renderer.text(
          'Ready',
          originX + HALF_EXTENT / 2,
          HALF_ORIGIN_Y + HALF_EXTENT + 46,
          32,
          palette.base,
          'centre',
        );
        continue;
      }

      // The ship being placed, previewed under the cursor and marked when it will not fit.
      const cursor = seat === 'p1' ? this.#placeCursorP1 : this.#placeCursorP2;
      const orientation = seat === 'p1' ? this.#orientationP1 : this.#orientationP2;
      const fits = canPlace(fleet, cursor.index, remaining, orientation);
      if (shipCells(this.#cellScratch, cursor.index, remaining, orientation) > 0) {
        for (const cell of this.#cellScratch) {
          outlineCell(
            renderer,
            originX,
            HALF_ORIGIN_Y,
            HALF_CELL,
            cell,
            fits ? palette.base : COLOUR_SUNK,
          );
        }
      } else {
        outlineCell(renderer, originX, HALF_ORIGIN_Y, HALF_CELL, cursor.index, COLOUR_SUNK);
      }
      renderer.text(
        `Ship of ${String(remaining)} — ${orientation}`,
        originX + HALF_EXTENT / 2,
        HALF_ORIGIN_Y + HALF_EXTENT + 46,
        28,
        COLOUR_MUTED,
        'centre',
      );
    }
  }

  /**
   * The firing board.
   *
   * **Neither fleet is drawn.** A player sees the enemy water with their own shots on it,
   * and a row of markers for how many of their own ships are still afloat — never where
   * those ships are. That is the whole of the hidden-information problem on a shared
   * screen: solve it in what is rendered and there is nothing to hide.
   */
  #renderFiring(renderer: Renderer): void {
    const seat = this.#position.seat;
    const target = fleetOf(this.#position, otherOf(seat));
    const palette = SEAT_PALETTE[seat];

    renderer.rect(BOARD_ORIGIN_X, BOARD_ORIGIN_Y, BOARD_EXTENT, BOARD_EXTENT, COLOUR_WATER);
    drawGrid(renderer, BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CELL_EXTENT);

    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      if (target.shotAt[cell] !== true) continue;
      const index = target.occupancy[cell] ?? -1;
      const ship = index >= 0 ? target.ships[index] : undefined;
      if (ship === undefined) {
        // A miss: a small dot, not a filled cell, so the board stays readable.
        const centre = cellCentre(BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CELL_EXTENT, cell);
        renderer.circle(centre.x, centre.y, CELL_EXTENT * 0.12, COLOUR_MISS);
        continue;
      }
      const sunk = isSunk(ship);
      fillCell(
        renderer,
        BOARD_ORIGIN_X,
        BOARD_ORIGIN_Y,
        CELL_EXTENT,
        cell,
        sunk ? COLOUR_SUNK : COLOUR_HIT,
      );
      // Rule 7: a hit is crossed and a sunk cell is crossed both ways, so the two are
      // told apart with the colour removed.
      crossCell(renderer, BOARD_ORIGIN_X, BOARD_ORIGIN_Y, CELL_EXTENT, cell, sunk);
    }

    renderer.strokeRect(
      BOARD_ORIGIN_X,
      BOARD_ORIGIN_Y,
      BOARD_EXTENT,
      BOARD_EXTENT,
      5,
      palette.base,
    );

    const cursorFits = this.#position.phase === 'firing' && this.#revealSteps === 0;
    if (cursorFits) {
      outlineCell(
        renderer,
        BOARD_ORIGIN_X,
        BOARD_ORIGIN_Y,
        CELL_EXTENT,
        this.#cursor.index,
        palette.base,
      );
    }

    const line =
      this.#revealSteps > 0
        ? this.#lastResult === 'sunk'
          ? 'Sunk!'
          : this.#lastResult === 'hit'
            ? 'Hit — fire again'
            : 'Miss'
        : 'Call a shot';
    renderer.text(line, 450, 130, 40, COLOUR_TEXT, 'centre');

    this.#drawOwnFleetStatus(renderer, seat);
  }

  /** How many of your own ships are afloat — a count, never a position. */
  #drawOwnFleetStatus(renderer: Renderer, seat: SeatId): void {
    const mine = fleetOf(this.#position, seat);
    const y = BOARD_ORIGIN_Y + BOARD_EXTENT + 30;
    let x = BOARD_ORIGIN_X;
    for (const ship of mine.ships) {
      const width = ship.length * 12;
      renderer.rect(x, y, width, 16, isSunk(ship) ? COLOUR_SUNK : COLOUR_HULL);
      if (isSunk(ship)) renderer.line(x, y + 16, x + width, y, 3, COLOUR_TEXT);
      x += width + 10;
    }
    renderer.text('Your fleet', x + 16, y + 15, 24, COLOUR_MUTED);
  }
}

/** How many of a fleet's ships are sunk. Zero for a fleet that has not been laid out. */
function sunkCount(fleet: Fleet): number {
  return fleet.ships.length - shipsRemaining(fleet);
}

function cellIn(x: number, y: number, originX: number, originY: number, size: number): number {
  const localX = x - originX;
  const localY = y - originY;
  const extent = size * GRID;
  if (localX < 0 || localY < 0 || localX >= extent || localY >= extent) return -1;
  const column = Math.min(GRID - 1, Math.floor(localX / size));
  const row = Math.min(GRID - 1, Math.floor(localY / size));
  return cellAt(column, row);
}

function cellCentre(
  originX: number,
  originY: number,
  size: number,
  cell: number,
): { x: number; y: number } {
  return {
    x: originX + (columnOf(cell) + 0.5) * size,
    y: originY + (rowOf(cell) + 0.5) * size,
  };
}

function drawGrid(renderer: Renderer, originX: number, originY: number, size: number): void {
  const extent = size * GRID;
  for (let i = 1; i < GRID; i += 1) {
    renderer.line(
      originX + i * size,
      originY,
      originX + i * size,
      originY + extent,
      1,
      COLOUR_LINE,
    );
    renderer.line(
      originX,
      originY + i * size,
      originX + extent,
      originY + i * size,
      1,
      COLOUR_LINE,
    );
  }
}

function fillCell(
  renderer: Renderer,
  originX: number,
  originY: number,
  size: number,
  cell: number,
  colour: string,
): void {
  renderer.rect(
    originX + columnOf(cell) * size + 2,
    originY + rowOf(cell) * size + 2,
    size - 4,
    size - 4,
    colour,
  );
}

function outlineCell(
  renderer: Renderer,
  originX: number,
  originY: number,
  size: number,
  cell: number,
  colour: string,
): void {
  renderer.strokeRect(
    originX + columnOf(cell) * size + 1,
    originY + rowOf(cell) * size + 1,
    size - 2,
    size - 2,
    4,
    colour,
  );
}

function crossCell(
  renderer: Renderer,
  originX: number,
  originY: number,
  size: number,
  cell: number,
  both: boolean,
): void {
  const x = originX + columnOf(cell) * size;
  const y = originY + rowOf(cell) * size;
  const inset = size * 0.24;
  renderer.line(x + inset, y + inset, x + size - inset, y + size - inset, 3, COLOUR_BACKGROUND);
  if (both) {
    renderer.line(x + size - inset, y + inset, x + inset, y + size - inset, 3, COLOUR_BACKGROUND);
  }
}
