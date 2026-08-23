import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  COLUMNS,
  ROWS,
  TARGET_ROUNDS,
  TILES,
  TILE_STRENGTH,
  ask,
  botDirection,
  columnOf,
  createBotState,
  createGame,
  floorOf,
  resetBotState,
  resetGame,
  rowOf,
  skaterOf,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Broken Tiles — two floors of ice, one each, and neither of them getting any bigger.
 *
 * The rules module holds two arrays of numbers. What this file does is make "how much of
 * this tile is left" legible at a glance, because that is the only thing a player is
 * reading and they are reading it while running.
 */

export const BOARD_WIDTH = 640;
export const BOARD_HEIGHT = 1000;

/**
 * Each floor is a square, centred in its own half.
 *
 * Sized from the half rather than chosen: seven tiles of 76 came to 532 units against a
 * 500-unit half, so the first floor overhung its own board and the two would have
 * overlapped in the middle. 62 leaves 33 units of margin above and below, which is where
 * the round pips sit.
 */
const TILE = 62;
const FLOOR_SIZE = TILE * COLUMNS;
const FLOOR_LEFT = (BOARD_WIDTH - FLOOR_SIZE) / 2;
const P1_FLOOR_TOP = BOARD_HEIGHT / 2 + (BOARD_HEIGHT / 2 - FLOOR_SIZE) / 2;
const P2_FLOOR_TOP = (BOARD_HEIGHT / 2 - FLOOR_SIZE) / 2;

const COLOUR_WATER = '#0a1620';
const COLOUR_ICE_FULL = '#cfe6f2';
const COLOUR_ICE_THIN = '#7ba6bd';
const COLOUR_CRACK = 'rgba(10, 22, 32, 0.55)';
const COLOUR_MUTED = 'rgba(207, 230, 242, 0.4)';

/** A drag shorter than this is a rest, not a direction. */
export const DRAG_DEADZONE = 18;

function floorTopOf(seat: SeatId): number {
  return seat === 'p1' ? P1_FLOOR_TOP : P2_FLOOR_TOP;
}

/** Where a tile's centre sits on the board. */
export function tileCentre(seat: SeatId, tile: number, out: { x: number; y: number }): void {
  out.x = FLOOR_LEFT + columnOf(tile) * TILE + TILE / 2;
  out.y = floorTopOf(seat) + rowOf(tile) * TILE + TILE / 2;
}

export class BrokenTilesGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #point = { x: 0, y: 0 };
  readonly #dragOrigin: Record<SeatId, Vec2 | null> = { p1: null, p2: null };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drive(seat, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  #drive(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const direction = botDirection(
        this.#position,
        seat,
        difficulty,
        state,
        this.#rng,
        fixedDeltaSeconds,
      );
      if (direction >= 0) ask(this.#position, seat, direction);
      return;
    }
    const direction = this.#humanDirection(seat, input);
    if (direction >= 0) ask(this.#position, seat, direction);
  }

  /**
   * Which way a person is asking to go, or −1.
   *
   * A **relative drag**, as in Snake Clash and Robot Arena and for the same reason: the
   * shell splits a shared surface into two pointer zones, so a thumb can only be in its own
   * seat's half and could not point at a tile in the far one anyway. Pull the way you want
   * to go from wherever your thumb happens to be.
   *
   * Keys give the same four answers directly. Neither family has a rate in it — the step
   * cooldown is the only pace there is — so a mashed key and a held one skate identically.
   */
  #humanDirection(seat: SeatId, input: InputState): number {
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;

    if (pointer === null) {
      this.#dragOrigin[seat] = null;
      return directionOf(seatInput.move.x, seatInput.move.y);
    }

    let origin = this.#dragOrigin[seat];
    if (origin === null || seatInput.actionPressed) {
      origin = vec2();
      origin.x = pointer.x;
      origin.y = pointer.y;
      this.#dragOrigin[seat] = origin;
    }
    const dx = pointer.x - origin.x;
    const dy = pointer.y - origin.y;
    if (Math.hypot(dx, dy) <= DRAG_DEADZONE) {
      return directionOf(seatInput.move.x, seatInput.move.y);
    }
    return directionOf(dx, dy);
  }

  getActiveSeat(): SeatId | null {
    // Never: both skaters run at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.p1Rounds,
      p2: this.#position.p2Rounds,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    this.#winner = null;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_WATER);
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      this.#drawFloor(renderer, seat);
      this.#drawSkater(renderer, seat);
      this.#drawRounds(renderer, seat);
    }
  }

  /**
   * The floor, with each tile's remaining life drawn as **size and cracks**, not as shade.
   *
   * A tile shrinks as it wears and gains a crack for each unit gone, so how much is left is
   * readable in greyscale and from the far side of a phone — which is the only information
   * in the game and the one a player is reading while running.
   */
  #drawFloor(renderer: Renderer, seat: SeatId): void {
    const floor = floorOf(this.#position, seat);
    const top = floorTopOf(seat);
    renderer.strokeRect(FLOOR_LEFT - 6, top - 6, FLOOR_SIZE + 12, FLOOR_SIZE + 12, 3, COLOUR_MUTED);

    for (let tile = 0; tile < TILES; tile += 1) {
      const strength = floor[tile] ?? 0;
      if (strength <= 0) continue;
      const left = FLOOR_LEFT + columnOf(tile) * TILE;
      const rowTop = top + rowOf(tile) * TILE;
      const wear = Math.max(0, Math.min(1, strength / TILE_STRENGTH));
      const inset = 4 + (1 - wear) * 14;
      const size = TILE - inset * 2;

      renderer.rect(
        left + inset,
        rowTop + inset,
        size,
        size,
        wear > 0.5 ? COLOUR_ICE_FULL : COLOUR_ICE_THIN,
      );

      // One crack per unit of wear, drawn corner to corner so they are countable.
      const cracks = Math.min(2, Math.ceil(TILE_STRENGTH - strength));
      for (let i = 0; i < cracks; i += 1) {
        const offset = 12 + i * 16;
        renderer.line(
          left + inset,
          rowTop + inset + offset,
          left + inset + offset,
          rowTop + inset,
          2,
          COLOUR_CRACK,
        );
      }
    }
  }

  /**
   * Rule 7: p1 is a disc with a ring, p2 a square with a bar. Two skaters on two floors are
   * rarely confused, but a screenshot in greyscale still has to say which is which — and
   * the seat colours are the same two everywhere else in the product.
   */
  #drawSkater(renderer: Renderer, seat: SeatId): void {
    const skater = skaterOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    tileCentre(seat, skater.at, this.#point);
    const x = this.#point.x;
    const y = this.#point.y;
    const colour = skater.alive ? palette.base : palette.soft;

    if (seat === 'p1') {
      renderer.circle(x, y, 22, colour);
      renderer.strokeCircle(x, y, 13, 4, palette.deep);
    } else {
      renderer.rect(x - 21, y - 21, 42, 42, colour);
      renderer.rect(x - 21, y - 4, 42, 8, palette.deep);
    }

    if (skater.alive) return;
    // Gone through: a cross where they were.
    renderer.line(x - 20, y - 20, x + 20, y + 20, 5, COLOUR_ICE_FULL);
    renderer.line(x + 20, y - 20, x - 20, y + 20, 5, COLOUR_ICE_FULL);
  }

  /** Rounds won, as pips on that player's own outer edge. */
  #drawRounds(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const won = seat === 'p1' ? this.#position.p1Rounds : this.#position.p2Rounds;
    const y = seat === 'p1' ? BOARD_HEIGHT - 26 : 26;
    for (let i = 0; i < TARGET_ROUNDS; i += 1) {
      const x = BOARD_WIDTH / 2 + (i - (TARGET_ROUNDS - 1) / 2) * 44;
      const filled = i < won;
      if (seat === 'p1') renderer.circle(x, y, 11, filled ? palette.base : COLOUR_MUTED);
      else renderer.rect(x - 10, y - 10, 20, 20, filled ? palette.base : COLOUR_MUTED);
    }
  }
}

/**
 * Turn a push into one of the four directions, or −1 for neutral.
 *
 * The dominant axis wins, so a diagonal is read as whichever way the player pushed further
 * rather than being rejected. `ROWS` is square with `COLUMNS`, so nothing here needs to know
 * which floor it is looking at.
 */
export function directionOf(x: number, y: number): number {
  const deadzone = 0.4;
  if (Math.abs(x) < deadzone && Math.abs(y) < deadzone) return -1;
  if (Math.abs(y) >= Math.abs(x)) return y < 0 ? 0 : 2;
  return x < 0 ? 1 : 3;
}

/** Exported so a test can assert the floors are square without recomputing the layout. */
export { COLUMNS, ROWS };
