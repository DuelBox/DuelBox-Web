import { SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELLS,
  CELL_SIZE,
  ROLLER_RADIUS,
  ROUND_SECONDS,
  TURN_RATE,
  botSteer,
  columnOf,
  countBare,
  countOwned,
  createGame,
  resetGame,
  rollerOf,
  rowOf,
  steer,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/** A drag shorter than this is a rest, not a steer. */
export const DRAG_DEADZONE = 20;

const COLOUR_BACKGROUND = '#14121b';
const COLOUR_BARE = '#26222f';
const COLOUR_BARE_ALT = '#2b2735';
const COLOUR_TEXT = '#f0edf6';
const COLOUR_MUTED = 'rgba(240, 237, 246, 0.6)';
const COLOUR_INK = '#14121b';

const SETTLE_SECONDS = 1.4;

export class PaintFightGame implements Game {
  readonly #position: Position = createGame();
  /** Where each seat's current drag began, or null when nothing is down. */
  readonly #dragOrigin: Record<SeatId, Vec2 | null> = { p1: null, p2: null };

  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #settleSteps = 0;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#settleSteps = 0;
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#position);
      return;
    }
    if (this.#position.phase === 'over') {
      this.#settleSteps = Math.max(1, Math.round(SETTLE_SECONDS * (this.#stepsPerSecond || 60)));
      return;
    }

    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
      const amount =
        difficulty !== null
          ? botSteer(this.#position, seat, difficulty)
          : this.#humanSteer(seat, input);
      steer(rollerOf(this.#position, seat), amount, fixedDeltaSeconds);
    }

    step(this.#position, fixedDeltaSeconds);
  }

  /**
   * How a person steers.
   *
   * The direction of the **drag**, as in Snake Clash and for the same reason: the shell
   * gives each player half the screen, so a player whose roller is in the far half could
   * not point ahead of it. A relative drag works from anywhere in your own half.
   */
  #humanSteer(seat: SeatId, input: InputState): number {
    const seatInput = input.seat(seat);
    const roller = rollerOf(this.#position, seat);
    const pointer = seatInput.pointer;

    if (pointer === null) {
      this.#dragOrigin[seat] = null;
      return seatInput.move.x;
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
    if (Math.hypot(dx, dy) <= DRAG_DEADZONE) return seatInput.move.x;

    let wanted = Math.atan2(dy, dx) - roller.heading;
    while (wanted > Math.PI) wanted -= Math.PI * 2;
    while (wanted < -Math.PI) wanted += Math.PI * 2;
    const amount = wanted / (TURN_RATE / 60);
    return amount < -1 ? -1 : amount > 1 ? 1 : amount;
  }

  getActiveSeat(): SeatId | null {
    // Never: both roll at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.p1.painted,
      p2: this.#position.p2.painted,
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    this.#matchWinner = null;
    this.#settleSteps = 0;
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawBoard(renderer);
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drawRoller(renderer, seat);
    this.#drawStatus(renderer);
  }

  /**
   * The board, one rectangle a cell.
   *
   * Rule 7: a seat's paint carries its colour **and** a pattern — p1's cells get a dot in
   * the corner, p2's a bar along the top. Two blocks of flat colour side by side are the
   * whole picture in this game, so telling them apart without the colour is not a detail.
   */
  #drawBoard(renderer: Renderer): void {
    for (let cell = 0; cell < CELLS; cell += 1) {
      const column = columnOf(cell);
      const row = rowOf(cell);
      const x = column * CELL_SIZE;
      const y = row * CELL_SIZE;
      const owner = this.#position.cells[cell];

      if (owner === undefined || owner === null) {
        renderer.rect(
          x,
          y,
          CELL_SIZE,
          CELL_SIZE,
          (column + row) % 2 === 0 ? COLOUR_BARE : COLOUR_BARE_ALT,
        );
        continue;
      }
      const palette = SEAT_PALETTE[owner];
      renderer.rect(x, y, CELL_SIZE, CELL_SIZE, palette.base);
      if (owner === 'p1') renderer.circle(x + 9, y + 9, 4, palette.deep);
      else renderer.rect(x, y, CELL_SIZE, 6, palette.deep);
    }
  }

  #drawRoller(renderer: Renderer, seat: SeatId): void {
    const roller = rollerOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    renderer.circle(roller.x, roller.y, ROLLER_RADIUS, palette.deep);
    renderer.strokeCircle(roller.x, roller.y, ROLLER_RADIUS - 5, 5, COLOUR_INK);
    if (seat === 'p1') {
      renderer.strokeCircle(roller.x, roller.y, ROLLER_RADIUS * 0.4, 5, COLOUR_TEXT);
    } else {
      renderer.rect(
        roller.x - ROLLER_RADIUS * 0.6,
        roller.y - 4,
        ROLLER_RADIUS * 1.2,
        8,
        COLOUR_TEXT,
      );
    }
    // Which way it is pointing, so a player can read their own heading at a glance.
    renderer.line(
      roller.x,
      roller.y,
      roller.x + Math.cos(roller.heading) * ROLLER_RADIUS * 1.7,
      roller.y + Math.sin(roller.heading) * ROLLER_RADIUS * 1.7,
      5,
      COLOUR_TEXT,
    );
  }

  /**
   * The score, as a single bar showing the share of the board.
   *
   * A pair of numbers is the wrong shape for a territory game: what a player needs to know
   * is who is ahead and by how much, which a bar says at a glance and two numbers do not.
   * The bare share is drawn between them, so it is clear how much is still to play for.
   */
  #drawStatus(renderer: Renderer): void {
    const p1 = countOwned(this.#position, 'p1');
    const p2 = countOwned(this.#position, 'p2');
    const bare = countBare(this.#position);
    const width = BOARD_WIDTH - 80;
    const y = BOARD_HEIGHT + 26;

    renderer.rect(40, y, width * (p1 / CELLS), 26, SEAT_PALETTE.p1.base);
    renderer.rect(40 + width * (p1 / CELLS), y, width * (bare / CELLS), 26, COLOUR_BARE);
    renderer.rect(
      40 + width * ((p1 + bare) / CELLS),
      y,
      width * (p2 / CELLS),
      26,
      SEAT_PALETTE.p2.base,
    );

    const left = Math.max(0, ROUND_SECONDS - this.#position.elapsed);
    renderer.text(
      this.#position.phase === 'over' ? 'Time' : `${left.toFixed(0)}s`,
      BOARD_WIDTH / 2,
      y + 66,
      34,
      COLOUR_MUTED,
      'centre',
    );
  }
}
