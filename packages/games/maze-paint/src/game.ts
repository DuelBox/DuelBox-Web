import { Rng, SEAT_PALETTE, SeatFlip, seatRotated, set, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CELL_COUNT,
  COLUMNS,
  DIRECTION_COUNT,
  FLOOR,
  OPPOSITE,
  P1_PAINT,
  P2_PAINT,
  ROWS,
  UNPAINTED,
  canRoll,
  columnOf,
  createMatch,
  directionContaining,
  isLegalDirection,
  neighbour,
  paintCount,
  rowOf,
  seatCode,
  startMatch,
  stepMatch,
  travelLength,
} from './rules.js';
import type { BotDifficulty, Match } from './rules.js';

/**
 * Board geometry in logical units. Exported because working out which square a tap landed
 * in is not a rendering question — the tests and the control-parity harness need the same
 * mapping the game uses.
 */
export const BOARD_ORIGIN = 32;
export const CELL_EXTENT = 76;
export const BOARD_EXTENT = CELL_EXTENT * COLUMNS;

const COLOUR_BACKGROUND = '#eaeef6';
const COLOUR_FLOOR = '#fbfcfe';
const COLOUR_WALL = '#333f52';
const COLOUR_WALL_NOTCH = '#4a596f';
const COLOUR_GRID = '#d7dde9';
const COLOUR_INK = '#1d2635';
const COLOUR_FRAME = '#8d99ad';

const GRID_WIDTH = 2;
const FRAME_WIDTH = 4;

/** Seat one is round and seat two is square, on the paint and on the roller alike. */
const PAINT_DISC = CELL_EXTENT * 0.22;
const PAINT_SQUARE = CELL_EXTENT * 0.4;
const PAINT_SQUARE_WIDTH = 5;
const ROLLER_DISC = CELL_EXTENT * 0.36;
const ROLLER_SQUARE = CELL_EXTENT * 0.62;
const ROLLER_INNER = CELL_EXTENT * 0.2;
const ROLLER_RING = 5;

const LANE_INSET = 8;
const LANE_WIDTH = 3;
const LANE_END = CELL_EXTENT * 0.3;
const BLOCKED_ARM = CELL_EXTENT * 0.26;
const BLOCKED_WIDTH = 5;

/** Below this a direction is noise rather than intent, matching the engine's grid cursor. */
const DEAD_ZONE = 0.5;

/** The top-left corner of a square, in logical units. */
export function cellOrigin(out: Vec2, index: number): Vec2 {
  return set(
    out,
    BOARD_ORIGIN + columnOf(index) * CELL_EXTENT,
    BOARD_ORIGIN + rowOf(index) * CELL_EXTENT,
  );
}

/** The centre of a square, in logical units. */
export function cellCentre(out: Vec2, index: number): Vec2 {
  return set(
    out,
    BOARD_ORIGIN + (columnOf(index) + 0.5) * CELL_EXTENT,
    BOARD_ORIGIN + (rowOf(index) + 0.5) * CELL_EXTENT,
  );
}

/** The square a point falls in, or -1 if it is off the board. */
export function cellIndexAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN;
  const localY = y - BOARD_ORIGIN;
  if (localX < 0 || localY < 0 || localX >= BOARD_EXTENT || localY >= BOARD_EXTENT) return -1;
  const column = Math.min(COLUMNS - 1, Math.floor(localX / CELL_EXTENT));
  const row = Math.min(ROWS - 1, Math.floor(localY / CELL_EXTENT));
  return row * COLUMNS + column;
}

/**
 * The direction a movement vector names, in the board's frame.
 *
 * A lattice has no use for the magnitude: what a swipe means on a grid is one of four
 * values, which is exactly what a key already is. The dominant axis wins, and an exact tie
 * — which for a keyboard means two keys held at once, a real thing a person does — resolves
 * horizontally rather than being refused, so a press never silently does nothing. That rule
 * is covariant under the half-turn, because a half-turn maps each axis onto itself.
 */
export function quantiseDirection(x: number, y: number, rotated: boolean): number {
  let dir = -1;
  if (Math.abs(x) >= Math.abs(y)) {
    if (x > DEAD_ZONE) dir = 1;
    else if (x < -DEAD_ZONE) dir = 3;
  } else if (y > DEAD_ZONE) {
    dir = 2;
  } else if (y < -DEAD_ZONE) {
    dir = 0;
  }
  if (dir < 0) return -1;
  // The far seat reads the board half a turn round, so their up is the board's down.
  return rotated ? (OPPOSITE[dir] ?? dir) : dir;
}

export class MazePaintGame implements Game {
  readonly #match: Match = createMatch();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();

  #rngP1 = new Rng(1);
  #rngP2 = new Rng(2);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;

  /**
   * The direction the seat at the controls is currently holding, and whose it is.
   *
   * A roll is one press, the way a swipe is one gesture: holding a key does not repeat, and
   * a key still held when a new turn opens does not fire on its own. Cleared when the turn
   * changes so the next press is a fresh one.
   */
  #trackedSeat: SeatId | null = null;
  #heldDirection = -1;

  /**
   * Whose turn it is.
   *
   * The shell decides a game is turn-based by the presence of this method, and only then
   * does it hand the whole board to the active seat and map both keyboard halves onto them.
   */
  getActiveSeat(): SeatId {
    return this.#match.active;
  }

  init(context: GameContext): void {
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    startMatch(this.#match, context.rng, context.openingSeat);

    /*
     * A generator each, assigned by **role rather than by seat**: whoever opens gets the
     * first stream.
     *
     * A stream each is Cup Pong's guard, and it is the one that keeps a seat's play from
     * becoming a function of its opponent's. Handing them out by role rather than by chair
     * buys the second, stronger property this game is built around: the maze is symmetric
     * under the half-turn and the two starts are each other's image, so the same seed played
     * from both openings is one match and its exact mirror. Seat balance is then structural
     * rather than measured — and any rule that is *not* covariant shows up immediately as a
     * seat-one share away from fifty percent instead of hiding inside the noise.
     */
    const first = new Rng(context.rng.next() | 0);
    const second = new Rng(context.rng.next() | 0);
    if (context.openingSeat === 'p1') {
      this.#rngP1 = first;
      this.#rngP2 = second;
    } else {
      this.#rngP2 = first;
      this.#rngP1 = second;
    }

    this.#trackedSeat = null;
    this.#heldDirection = -1;
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);

    const match = this.#match;
    if (match.phase === 'over') return;

    const active = match.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    let request = -1;
    if (difficulty === null) {
      request = this.#readRequest(input, active);
    } else if (this.#trackedSeat !== null) {
      // Nothing a person does to the device may reach a seat a bot is holding.
      this.#trackedSeat = null;
      this.#heldDirection = -1;
    }

    stepMatch(
      match,
      fixedDeltaSeconds,
      request,
      difficulty,
      active === 'p1' ? this.#rngP1 : this.#rngP2,
    );
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawMaze(renderer);
    this.#drawPaint(renderer);
    this.#drawLanes(renderer);
    this.#drawRollers(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return {
      p1: paintCount(this.#match.position, 'p1'),
      p2: paintCount(this.#match.position, 'p2'),
      winner: this.#match.winner,
    };
  }

  destroy(): void {
    this.#match.position.paint.fill(UNPAINTED);
    this.#match.phase = 'over';
    this.#trackedSeat = null;
  }

  /* ---------------------------------------------------------- read-only views */

  get phase(): Match['phase'] {
    return this.#match.phase;
  }

  get moves(): number {
    return this.#match.moves;
  }

  get position(): Match['position'] {
    return this.#match.position;
  }

  get rotated(): boolean {
    return this.#flip.rotated;
  }

  /* ---------------------------------------------------------- input */

  /**
   * What the seat at the controls has asked for this step, or -1.
   *
   * Both instruments say the same thing — one of four directions — and neither can say it
   * more finely than the other. A press names a lane; a key names a direction. There is no
   * drag, no charge and no continuous quantity anywhere, which is what lets this game be
   * fair across input families rather than same-class-only.
   */
  #readRequest(input: InputState, active: SeatId): number {
    const seatInput = input.seat(active);
    if (this.#trackedSeat !== active) {
      this.#trackedSeat = active;
      this.#heldDirection = -1;
    }

    const live = this.#match.phase === 'live';
    let request = -1;

    const pointer = seatInput.pointer;
    if (live && seatInput.actionPressed && pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const cell = cellIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      const dir = directionContaining(this.#match.position, active, cell);
      if (dir >= 0) request = dir;
    }

    const pressed = quantiseDirection(seatInput.move.x, seatInput.move.y, this.#flip.rotated);
    if (live && request < 0 && pressed >= 0 && pressed !== this.#heldDirection) request = pressed;
    // Updated every step whatever the phase, so a key held through the opening freeze is
    // already accounted for when the turn goes live and cannot fire by itself.
    this.#heldDirection = pressed;
    return request;
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatRotated(this.#match.active, this.#presentation, this.#localSeat);
  }

  /* ---------------------------------------------------------- drawing */

  #drawMaze(renderer: Renderer): void {
    renderer.rect(BOARD_ORIGIN, BOARD_ORIGIN, BOARD_EXTENT, BOARD_EXTENT, COLOUR_FLOOR);
    for (let i = 1; i < COLUMNS; i += 1) {
      const at = BOARD_ORIGIN + i * CELL_EXTENT;
      renderer.line(at, BOARD_ORIGIN, at, BOARD_ORIGIN + BOARD_EXTENT, GRID_WIDTH, COLOUR_GRID);
      renderer.line(BOARD_ORIGIN, at, BOARD_ORIGIN + BOARD_EXTENT, at, GRID_WIDTH, COLOUR_GRID);
    }
    renderer.strokeRect(
      BOARD_ORIGIN,
      BOARD_ORIGIN,
      BOARD_EXTENT,
      BOARD_EXTENT,
      FRAME_WIDTH,
      COLOUR_FRAME,
    );

    const terrain = this.#match.position.terrain;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if ((terrain[index] ?? FLOOR) === FLOOR) continue;
      cellOrigin(this.#scratch, index);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      renderer.rect(x, y, CELL_EXTENT, CELL_EXTENT, COLOUR_WALL);
      // A notch across every block, so a wall reads as a wall in greyscale as well as by
      // being the one dark thing on a pale board.
      renderer.line(
        x + CELL_EXTENT * 0.2,
        y + CELL_EXTENT * 0.8,
        x + CELL_EXTENT * 0.8,
        y + CELL_EXTENT * 0.2,
        GRID_WIDTH,
        COLOUR_WALL_NOTCH,
      );
    }
  }

  /**
   * Painted squares.
   *
   * The wash says whose it is in colour; the mark inside it says whose it is in shape —
   * a filled disc for seat one and an open square for seat two, the same two shapes their
   * rollers carry. In greyscale the two washes are near enough the same and the marks are
   * not, which is the whole of rule 7 for this game.
   */
  #drawPaint(renderer: Renderer): void {
    const paint = this.#match.position.paint;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const owner = paint[index] ?? UNPAINTED;
      if (owner === UNPAINTED) continue;
      const palette = owner === P1_PAINT ? SEAT_PALETTE.p1 : SEAT_PALETTE.p2;
      cellOrigin(this.#scratch, index);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      renderer.rect(x, y, CELL_EXTENT, CELL_EXTENT, palette.soft);
      if (owner === P1_PAINT) {
        renderer.circle(x + CELL_EXTENT / 2, y + CELL_EXTENT / 2, PAINT_DISC, palette.base);
      } else {
        renderer.strokeRect(
          x + (CELL_EXTENT - PAINT_SQUARE) / 2,
          y + (CELL_EXTENT - PAINT_SQUARE) / 2,
          PAINT_SQUARE,
          PAINT_SQUARE,
          PAINT_SQUARE_WIDTH,
          palette.base,
        );
      }
    }
  }

  /**
   * The runs the seat to move may take, drawn square by square along the whole travel.
   *
   * This is the target a tap has to land in, and it is drawn before the tap rather than
   * inferred afterwards — `docs/input-idiom.md` is explicit that a `turn-board` press
   * commits if and only if it lands inside a drawn region, and never picks the nearest one.
   * It is also what a keyboard player is choosing between, so both instruments are looking
   * at the same four things.
   */
  #drawLanes(renderer: Renderer): void {
    const match = this.#match;
    if (match.phase === 'settle' || match.phase === 'over') return;
    const seat = match.active;
    const palette = seat === 'p1' ? SEAT_PALETTE.p1 : SEAT_PALETTE.p2;
    const from = match.position.roller[seatCode(seat)] ?? 0;

    for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
      // Only lanes that are really moves are drawn, and only what is drawn may be pressed.
      if (!isLegalDirection(match.position, seat, dir)) continue;
      const travel = travelLength(match.position, seat, dir);
      let walk = from;
      for (let i = 0; i < travel; i += 1) {
        walk = neighbour(walk, dir);
        if (walk < 0) break;
        cellOrigin(this.#scratch, walk);
        renderer.strokeRect(
          this.#scratch.x + LANE_INSET,
          this.#scratch.y + LANE_INSET,
          CELL_EXTENT - LANE_INSET * 2,
          CELL_EXTENT - LANE_INSET * 2,
          LANE_WIDTH,
          palette.base,
        );
        if (i === travel - 1) {
          cellCentre(this.#scratch, walk);
          // Where the roll would stop, in the mover's own shape.
          if (seat === 'p1') {
            renderer.strokeCircle(
              this.#scratch.x,
              this.#scratch.y,
              LANE_END,
              LANE_WIDTH,
              palette.deep,
            );
          } else {
            renderer.line(
              this.#scratch.x - LANE_END,
              this.#scratch.y,
              this.#scratch.x + LANE_END,
              this.#scratch.y,
              LANE_WIDTH,
              palette.deep,
            );
          }
        }
      }
    }
  }

  #drawRollers(renderer: Renderer): void {
    const position = this.#match.position;
    for (const seat of ['p1', 'p2'] as const) {
      const cell = position.roller[seat === 'p1' ? P1_PAINT : P2_PAINT] ?? 0;
      const palette = seat === 'p1' ? SEAT_PALETTE.p1 : SEAT_PALETTE.p2;
      cellCentre(this.#scratch, cell);
      const cx = this.#scratch.x;
      const cy = this.#scratch.y;
      if (seat === 'p1') {
        renderer.circle(cx, cy, ROLLER_DISC, palette.deep);
        renderer.circle(cx, cy, ROLLER_INNER, COLOUR_FLOOR);
      } else {
        renderer.rect(
          cx - ROLLER_SQUARE / 2,
          cy - ROLLER_SQUARE / 2,
          ROLLER_SQUARE,
          ROLLER_SQUARE,
          palette.deep,
        );
        renderer.strokeRect(
          cx - ROLLER_INNER,
          cy - ROLLER_INNER,
          ROLLER_INNER * 2,
          ROLLER_INNER * 2,
          ROLLER_RING,
          COLOUR_FLOOR,
        );
      }
      // A roller that can no longer move is crossed out, so a player can see why the turn
      // stopped coming back to them without anything having to be written down.
      if (!canRoll(position, seat)) {
        renderer.line(
          cx - BLOCKED_ARM,
          cy - BLOCKED_ARM,
          cx + BLOCKED_ARM,
          cy + BLOCKED_ARM,
          BLOCKED_WIDTH,
          COLOUR_INK,
        );
        renderer.line(
          cx - BLOCKED_ARM,
          cy + BLOCKED_ARM,
          cx + BLOCKED_ARM,
          cy - BLOCKED_ARM,
          BLOCKED_WIDTH,
          COLOUR_INK,
        );
      }
    }
  }
}

export default {
  manifest,
  create: (): Game => new MazePaintGame(),
};
