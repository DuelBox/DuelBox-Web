import { GridCursor, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  CELLS,
  COLUMNS,
  MISS_CHANCE,
  ROWS,
  TARGET,
  botDive,
  botKick,
  cellAt,
  columnOf,
  createBotMemory,
  createGame,
  dive,
  keeperOf,
  kick,
  rememberRound,
  resetBotMemory,
  resetGame,
  resolve,
  rowOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotMemory, Game as Position } from './rules.js';

/**
 * Geometry in logical units.
 *
 * The goal fills the top of a portrait board and the two seats sit either side of the
 * halfway line, as `zoneSplit: 'horizontal'` divides them.
 */
export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;

/** The shared goal, in the middle. It shows the reveal and never a choice. */
export const GOAL_X = 90;
export const GOAL_Y = 395;
export const GOAL_W = BOARD_WIDTH - GOAL_X * 2;
export const GOAL_H = 220;
export const CELL_W = GOAL_W / COLUMNS;
export const CELL_H = GOAL_H / ROWS;

/**
 * Each seat's own selector, in its own half of the screen.
 *
 * **A cursor on the shared goal leaks the choice.** A keeper watching the kicker's cursor
 * knows where the ball is going before it is struck, and that ends the game — the whole
 * mechanic is that neither knows. The first draft drew both cursors on the goal and did
 * exactly that, which looking at it in a browser made obvious.
 *
 * The shell already divides a `horizontal` split into a bottom seat and a top one, so each
 * player has a half that is theirs. A selector there is as private as anything on a shared
 * screen gets — the same trust model as laying out a fleet in Sea Battle, and no worse than
 * being able to see your opponent's hand of cards if you lean over.
 */
export const SELECTOR_W = 300;
export const SELECTOR_H = 195;
export const SELECTOR_X = (BOARD_WIDTH - SELECTOR_W) / 2;
/** p1 is the bottom seat under a horizontal split; p2 is the top one. */
export const SELECTOR_Y: Readonly<Record<SeatId, number>> = Object.freeze({
  p1: 710,
  p2: 80,
});
export const SELECTOR_CELL_W = SELECTOR_W / COLUMNS;
export const SELECTOR_CELL_H = SELECTOR_H / ROWS;

const COLOUR_BACKGROUND = '#11301c';
const COLOUR_TURF = '#1c4a2b';
const COLOUR_TURF_ALT = '#1a4427';
const COLOUR_NET = 'rgba(233, 245, 236, 0.28)';
const COLOUR_POST = '#f2f7f3';
const COLOUR_BALL = '#f7f9f4';
const COLOUR_INK = '#11301c';
const COLOUR_TEXT = '#eaf4ec';
const COLOUR_MUTED = 'rgba(234, 244, 236, 0.6)';

const REVEAL_SECONDS = 1.6;
const SETTLE_SECONDS = 1.2;

/** The cell of the shared goal a point falls in, or -1. */
export function cellAtPoint(x: number, y: number): number {
  const localX = x - GOAL_X;
  const localY = y - GOAL_Y;
  if (localX < 0 || localY < 0 || localX >= GOAL_W || localY >= GOAL_H) return -1;
  const column = Math.min(COLUMNS - 1, Math.floor(localX / CELL_W));
  const row = Math.min(ROWS - 1, Math.floor(localY / CELL_H));
  return cellAt(column, row);
}

export function selectorRect(
  seat: SeatId,
  cell: number,
): { x: number; y: number; w: number; h: number } {
  // p2 sits at the top of the board facing down it, so their selector is turned about —
  // the left of the goal from where they are sitting is the right of it on screen.
  const column = seat === 'p1' ? columnOf(cell) : COLUMNS - 1 - columnOf(cell);
  const row = seat === 'p1' ? rowOf(cell) : ROWS - 1 - rowOf(cell);
  return {
    x: SELECTOR_X + column * SELECTOR_CELL_W,
    y: SELECTOR_Y[seat] + row * SELECTOR_CELL_H,
    w: SELECTOR_CELL_W,
    h: SELECTOR_CELL_H,
  };
}

/** The cell of a seat's own selector a point falls on, or -1. */
export function selectorCellAt(seat: SeatId, x: number, y: number): number {
  const top = SELECTOR_Y[seat];
  const localX = x - SELECTOR_X;
  const localY = y - top;
  if (localX < 0 || localY < 0 || localX >= SELECTOR_W || localY >= SELECTOR_H) return -1;
  let column = Math.min(COLUMNS - 1, Math.floor(localX / SELECTOR_CELL_W));
  let row = Math.min(ROWS - 1, Math.floor(localY / SELECTOR_CELL_H));
  if (seat === 'p2') {
    column = COLUMNS - 1 - column;
    row = ROWS - 1 - row;
  }
  return cellAt(column, row);
}

export function cellRect(cell: number): { x: number; y: number; w: number; h: number } {
  return {
    x: GOAL_X + columnOf(cell) * CELL_W,
    y: GOAL_Y + rowOf(cell) * CELL_H,
    w: CELL_W,
    h: CELL_H,
  };
}

export class PenaltyKicksGame implements Game {
  readonly #position: Position = createGame();
  readonly #memoryP1: BotMemory = createBotMemory();
  readonly #memoryP2: BotMemory = createBotMemory();
  readonly #cursor: Record<SeatId, GridCursor> = {
    // Different starting cells: identical ones put both markers in the same place, which
    // reads as one confused cursor rather than two players.
    p1: new GridCursor({ columns: COLUMNS, rows: ROWS, startIndex: 6 }),
    p2: new GridCursor({ columns: COLUMNS, rows: ROWS, startIndex: 8 }),
  };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #revealSteps = 0;
  #settleSteps = 0;
  #thinkSteps = -1;
  /** What the last resolved round did, for the message on screen. */
  #lastOutcome: 'goal' | 'save' | 'miss' | null = null;

  get position(): Position {
    return this.#position;
  }

  cursorFor(seat: SeatId): number {
    return this.#cursor[seat].index;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#revealSteps = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#lastOutcome = null;
    resetGame(this.#position);
    resetBotMemory(this.#memoryP1);
    resetBotMemory(this.#memoryP2);
    this.#cursor.p1.reset();
    this.#cursor.p2.reset();
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

    // The ball and the keeper are held on screen after both have committed. Both players
    // chose blind, and seeing what the other did is the entire payoff of the round.
    if (this.#revealSteps > 0) {
      this.#revealSteps -= 1;
      if (this.#revealSteps === 0) this.#finishRound();
      return;
    }
    if (this.#position.phase === 'over') {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    this.#collect('p1', fixedDeltaSeconds, input);
    this.#collect('p2', fixedDeltaSeconds, input);

    if (this.#position.shot >= 0 && this.#position.dive >= 0) {
      this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
    }
  }

  /**
   * Take one seat's choice.
   *
   * Both seats are collected every step, because **they are doing different things at the
   * same time** — one is placing a ball and the other is choosing where to throw
   * themselves, and neither may wait for the other. That simultaneity is the game.
   */
  #collect(seat: SeatId, fixedDeltaSeconds: number, input: InputState): void {
    const isKicker = this.#position.kicker === seat;
    const already = isKicker ? this.#position.shot : this.#position.dive;
    if (already >= 0) return;

    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      // A bot pauses before committing, so a human is not told the answer instantly — but
      // it decides on its own schedule, never waiting for the human.
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(0.45);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      const memory = seat === 'p1' ? this.#memoryP1 : this.#memoryP2;
      if (isKicker) kick(this.#position, botKick(memory, this.#rng, difficulty));
      else dive(this.#position, botDive(memory, this.#rng, difficulty));
      return;
    }

    const seatInput = input.seat(seat);
    const cursor = this.#cursor[seat];
    cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, false);

    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      // A seat taps its **own** selector, not the shared goal.
      const tapped = selectorCellAt(seat, pointer.x, pointer.y);
      if (tapped < 0) return;
      cursor.moveTo(tapped);
      if (isKicker) kick(this.#position, tapped);
      else dive(this.#position, tapped);
      return;
    }
    if (seatInput.actionPressed) {
      if (isKicker) kick(this.#position, cursor.index);
      else dive(this.#position, cursor.index);
    }
  }

  #finishRound(): void {
    const shot = this.#position.shot;
    const dived = this.#position.dive;
    const kicker = this.#position.kicker;

    // Each bot remembers what the *other* seat did, which is the only thing it knows that
    // a human could not know equally well.
    const kickerMemory = kicker === 'p1' ? this.#memoryP1 : this.#memoryP2;
    const keeperMemory = kicker === 'p1' ? this.#memoryP2 : this.#memoryP1;
    rememberRound(kickerMemory, -1, dived);
    rememberRound(keeperMemory, shot, -1);

    const result = resolve(this.#position, this.#rng);
    this.#lastOutcome = result.missed ? 'miss' : result.scored ? 'goal' : 'save';
    if (result.winner !== null) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
    }
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  getActiveSeat(): SeatId | null {
    // Never: both seats choose at the same time, so the shell keeps its two zones. A turn
    // indicator would be a lie and rotating would put one player upside down.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.scoreP1,
      p2: this.#position.scoreP2,
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotMemory(this.#memoryP1);
    resetBotMemory(this.#memoryP2);
    this.#matchWinner = null;
    this.#revealSteps = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#lastOutcome = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawPitch(renderer);
    this.#drawGoal(renderer);
    if (this.#revealSteps > 0) this.#drawReveal(renderer);
    else this.#drawChoosing(renderer);
    this.#drawStatus(renderer);
  }

  #drawPitch(renderer: Renderer): void {
    for (let i = 0; i < 6; i += 1) {
      const h = BOARD_HEIGHT / 6;
      renderer.rect(0, i * h, BOARD_WIDTH, h, i % 2 === 0 ? COLOUR_TURF : COLOUR_TURF_ALT);
    }
    // The spot, so the board reads as a penalty rather than a grid.
    renderer.circle(BOARD_WIDTH / 2, GOAL_Y + GOAL_H + 48, 7, COLOUR_POST);
  }

  #drawGoal(renderer: Renderer): void {
    renderer.rect(GOAL_X, GOAL_Y, GOAL_W, GOAL_H, 'rgba(0, 0, 0, 0.25)');
    for (let i = 1; i < COLUMNS; i += 1) {
      renderer.line(
        GOAL_X + i * CELL_W,
        GOAL_Y,
        GOAL_X + i * CELL_W,
        GOAL_Y + GOAL_H,
        2,
        COLOUR_NET,
      );
    }
    for (let i = 1; i < ROWS; i += 1) {
      renderer.line(
        GOAL_X,
        GOAL_Y + i * CELL_H,
        GOAL_X + GOAL_W,
        GOAL_Y + i * CELL_H,
        2,
        COLOUR_NET,
      );
    }
    renderer.strokeRect(GOAL_X, GOAL_Y, GOAL_W, GOAL_H, 8, COLOUR_POST);
  }

  /**
   * Each seat's selector, in that seat's own half.
   *
   * Nothing about either choice is drawn on the shared goal. A committed seat's selector
   * shows only that it has committed, never where — the other player must not see it, and
   * that is the whole of the hidden information in this game.
   */
  #drawChoosing(renderer: Renderer): void {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const isKicker = this.#position.kicker === seat;
      const committed = isKicker ? this.#position.shot >= 0 : this.#position.dive >= 0;
      const palette = SEAT_PALETTE[seat];

      for (let cell = 0; cell < CELLS; cell += 1) {
        const rect = selectorRect(seat, cell);
        renderer.rect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, 'rgba(0, 0, 0, 0.28)');
        const risk = MISS_CHANCE[cell] ?? 0;
        const ticks = risk > 0.2 ? 3 : risk > 0.1 ? 2 : risk > 0.05 ? 1 : 0;
        for (let i = 0; i < ticks; i += 1) {
          renderer.rect(rect.x + 8 + i * 9, rect.y + 8, 5, 5, COLOUR_MUTED);
        }
      }

      const label = isKicker ? 'kick' : 'dive';
      const anchorY = seat === 'p1' ? SELECTOR_Y.p1 - 18 : SELECTOR_Y.p2 + SELECTOR_H + 34;
      renderer.text(
        committed ? 'ready' : label,
        BOARD_WIDTH / 2,
        anchorY,
        26,
        committed ? palette.base : COLOUR_MUTED,
        'centre',
      );
      if (committed) continue;

      const rect = selectorRect(seat, this.#cursor[seat].index);
      renderer.strokeRect(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8, 5, palette.base);
      // Rule 7: p1's marker carries a ring, p2's a bar.
      if (seat === 'p1') {
        renderer.strokeCircle(rect.x + rect.w / 2, rect.y + rect.h / 2, 13, 4, palette.deep);
      } else {
        renderer.rect(rect.x + rect.w / 2 - 15, rect.y + rect.h / 2 - 4, 30, 8, palette.deep);
      }
    }
  }

  #drawReveal(renderer: Renderer): void {
    const shot = this.#position.shot;
    const dived = this.#position.dive;
    if (shot < 0 || dived < 0) return;

    const keeper = keeperOf(this.#position);
    const keeperRect = cellRect(dived);
    const keeperPalette = SEAT_PALETTE[keeper];
    renderer.rect(
      keeperRect.x + 4,
      keeperRect.y + 4,
      keeperRect.w - 8,
      keeperRect.h - 8,
      keeperPalette.base,
    );
    if (keeper === 'p1') {
      renderer.strokeCircle(
        keeperRect.x + keeperRect.w / 2,
        keeperRect.y + keeperRect.h / 2,
        22,
        5,
        keeperPalette.deep,
      );
    } else {
      renderer.rect(
        keeperRect.x + 16,
        keeperRect.y + keeperRect.h / 2 - 5,
        keeperRect.w - 32,
        10,
        keeperPalette.deep,
      );
    }

    // The ball where it went — or past the post, when it was skied.
    const shotRect = cellRect(shot);
    const ballX = shotRect.x + shotRect.w / 2;
    const ballY = this.#position.missed ? GOAL_Y - 46 : shotRect.y + shotRect.h / 2;
    renderer.circle(ballX, ballY, 20, COLOUR_BALL);
    renderer.rect(ballX - 13, ballY - 4, 26, 8, COLOUR_INK);
  }

  #drawStatus(renderer: Renderer): void {
    const line =
      this.#position.phase === 'over'
        ? 'Match over'
        : this.#revealSteps > 0
          ? this.#lastOutcome === 'goal'
            ? 'Goal'
            : this.#lastOutcome === 'miss'
              ? 'Wide'
              : 'Saved'
          : 'Pick your spot';
    renderer.text(line, BOARD_WIDTH / 2, GOAL_Y - 56, 36, COLOUR_TEXT, 'centre');

    renderer.text(
      `${String(this.#position.scoreP1)} — ${String(this.#position.scoreP2)}   first to ${String(TARGET)}`,
      BOARD_WIDTH / 2,
      GOAL_Y - 22,
      24,
      COLOUR_MUTED,
      'centre',
    );

    // Each selector is labelled "kick" or "dive" for its own seat, so a separate central
    // indicator would say the same thing twice — and it collided with both of them.
  }
}
