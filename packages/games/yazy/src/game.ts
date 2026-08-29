import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CATEGORIES,
  DICE,
  ROLLS_PER_TURN,
  UPPER,
  UPPER_BONUS_THRESHOLD,
  botCategory,
  botHold,
  bonusFor,
  createGame,
  isTaken,
  resetGame,
  roll,
  score,
  scoreFor,
  sheetOf,
  toggleHold,
  totalFor,
  upperTotal,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Category, Game as Position } from './rules.js';

/**
 * Board geometry in logical units. Exported because working out what a finger is on is not
 * a rendering question — the tests need the same mapping the game uses.
 */
export const DIE_SIZE = 100;
export const DIE_GAP = 20;
export const DICE_ROW_WIDTH = DICE * DIE_SIZE + (DICE - 1) * DIE_GAP;
export const DICE_ORIGIN_X = (900 - DICE_ROW_WIDTH) / 2;
export const DICE_ORIGIN_Y = 104;

export const ROLL_WIDTH = 300;
export const ROLL_HEIGHT = 72;
export const ROLL_X = (900 - ROLL_WIDTH) / 2;
export const ROLL_Y = 232;

/**
 * The sheet is two columns of seven rows, not thirteen rows of one.
 *
 * Thirteen rows in the space available is 46 logical units each, which on a 320-pixel
 * phone is a fifteen-pixel row — below anything a thumb can hit and below anything a
 * person can read. Two columns halves the count and doubles the row.
 */
export const SHEET_ROWS = 7;
export const SHEET_COLUMNS = 2;
export const SHEET_ORIGIN_X = 46;
export const SHEET_ORIGIN_Y = 336;
export const SHEET_COLUMN_WIDTH = 404;
export const SHEET_COLUMN_GAP = 8;
export const SHEET_ROW_HEIGHT = 76;

const COLOUR_BACKGROUND = '#171a26';
const COLOUR_PANEL = '#212637';
const COLOUR_PANEL_TAKEN = '#2c3140';
const COLOUR_DIE = '#f4f1e8';
const COLOUR_DIE_HELD = '#ffd9a0';
const COLOUR_INK = '#171a26';
const COLOUR_TEXT = '#e8ecf6';
const COLOUR_MUTED = 'rgba(232, 236, 246, 0.55)';
const COLOUR_HINT = 'rgba(232, 236, 246, 0.42)';

const THINK_SECONDS = 0.55;
const SETTLE_SECONDS = 1.2;

/** What the cursor is on. */
export type Focus = 'dice' | 'sheet';

const LABELS: Readonly<Record<Category, string>> = Object.freeze({
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  'three-of-a-kind': 'Three of a kind',
  'four-of-a-kind': 'Four of a kind',
  'full-house': 'Full house',
  'small-straight': 'Small straight',
  'large-straight': 'Large straight',
  yatzy: 'Yatzy',
  chance: 'Chance',
});

/**
 * The category in a sheet cell, or null.
 *
 * The left column is the upper section and its seventh row is the bonus, which is shown
 * but never chosen — a player cannot spend a turn on it.
 */
export function categoryAt(row: number, column: number): Category | null {
  if (row < 0 || row >= SHEET_ROWS || column < 0 || column >= SHEET_COLUMNS) return null;
  if (column === 0) return row < UPPER.length ? (UPPER[row] ?? null) : null;
  const lower = CATEGORIES.slice(UPPER.length);
  return lower[row] ?? null;
}

export function sheetCellRect(
  row: number,
  column: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: SHEET_ORIGIN_X + column * (SHEET_COLUMN_WIDTH + SHEET_COLUMN_GAP),
    y: SHEET_ORIGIN_Y + row * SHEET_ROW_HEIGHT,
    w: SHEET_COLUMN_WIDTH,
    h: SHEET_ROW_HEIGHT,
  };
}

/** The sheet cell a point falls in, as [row, column], or null. */
export function sheetCellAt(x: number, y: number): [number, number] | null {
  const localY = y - SHEET_ORIGIN_Y;
  if (localY < 0 || localY >= SHEET_ROWS * SHEET_ROW_HEIGHT) return null;
  const row = Math.floor(localY / SHEET_ROW_HEIGHT);
  for (let column = 0; column < SHEET_COLUMNS; column += 1) {
    const rect = sheetCellRect(row, column);
    if (x >= rect.x && x <= rect.x + rect.w) return [row, column];
  }
  return null;
}

/** The die a point falls on, or -1. */
export function dieAt(x: number, y: number): number {
  if (y < DICE_ORIGIN_Y || y > DICE_ORIGIN_Y + DIE_SIZE) return -1;
  const local = x - DICE_ORIGIN_X;
  if (local < 0 || local > DICE_ROW_WIDTH) return -1;
  const slot = Math.floor(local / (DIE_SIZE + DIE_GAP));
  if (local - slot * (DIE_SIZE + DIE_GAP) > DIE_SIZE) return -1;
  return Math.min(DICE - 1, slot);
}

export function onRollButton(x: number, y: number): boolean {
  return x >= ROLL_X && x <= ROLL_X + ROLL_WIDTH && y >= ROLL_Y && y <= ROLL_Y + ROLL_HEIGHT;
}

export class YazyGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #sheetCursor = new GridCursor({ columns: SHEET_COLUMNS, rows: SHEET_ROWS });
  /** Six targets in a row: the five dice, then the roll control. */
  readonly #diceCursor = new GridCursor({ columns: DICE + 1, rows: 1, startIndex: DICE });
  readonly #botHeld: boolean[] = new Array<boolean>(DICE).fill(false);

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;
  #focus: Focus = 'dice';

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #settleSteps = 0;

  get position(): Position {
    return this.#position;
  }

  get focus(): Focus {
    return this.#focus;
  }

  /** 0..DICE-1 is a die, DICE is the roll control. */
  get diceIndex(): number {
    return this.#diceCursor.index;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#focus = 'dice';
    this.#thinkSteps = -1;
    this.#settleSteps = 0;
    resetGame(this.#position, context.openingSeat);
    this.#sheetCursor.reset();
    this.#diceCursor.reset();
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
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#position);
      return;
    }
    if (this.#position.phase === 'over') {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    const seat = this.#position.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#updateBot(difficulty);
      return;
    }

    if (!this.#flip.acceptsInput) return;
    this.#updateHuman(fixedDeltaSeconds, input.seat(seat));
  }

  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;

    if (this.#position.phase === 'rolling' && this.#position.rollsUsed < ROLLS_PER_TURN) {
      if (this.#position.rollsUsed > 0) {
        botHold(this.#botHeld, this.#position, difficulty);
        for (let i = 0; i < DICE; i += 1) this.#position.held[i] = this.#botHeld[i] === true;
      }
      roll(this.#position, this.#rng);
      return;
    }
    score(this.#position, botCategory(this.#position, difficulty));
  }

  #updateHuman(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const x = this.#pointerWorld.x;
      const y = this.#pointerWorld.y;

      if (onRollButton(x, y)) {
        this.#focus = 'dice';
        this.#diceCursor.moveTo(DICE);
        roll(this.#position, this.#rng);
        return;
      }
      const die = dieAt(x, y);
      if (die >= 0) {
        this.#focus = 'dice';
        this.#diceCursor.moveTo(die);
        toggleHold(this.#position, die);
        return;
      }
      const cell = sheetCellAt(x, y);
      if (cell !== null) {
        const [row, column] = cell;
        const category = categoryAt(row, column);
        if (category === null) return;
        this.#focus = 'sheet';
        this.#sheetCursor.moveTo(row * SHEET_COLUMNS + column);
        this.#spend(category);
      }
      return;
    }

    this.#moveCursor(fixedDeltaSeconds, seatInput);
    if (!seatInput.actionPressed) return;

    if (this.#focus === 'dice') {
      if (this.#diceCursor.index === DICE) roll(this.#position, this.#rng);
      else toggleHold(this.#position, this.#diceCursor.index);
      return;
    }
    const category = categoryAt(this.#sheetCursor.row, this.#sheetCursor.column);
    if (category !== null) this.#spend(category);
  }

  /**
   * One cursor for the dice row and one for the sheet, with up and down crossing between
   * them. Down from the dice enters the sheet at the top; up from the sheet's first row
   * returns to the roll control, which is where a turn starts.
   */
  #moveCursor(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const rotated = this.#flip.rotated;
    if (this.#focus === 'dice') {
      this.#diceCursor.step(seatInput.move.x, 0, fixedDeltaSeconds, rotated);
      if (seatInput.move.y > 0) {
        this.#focus = 'sheet';
        this.#sheetCursor.moveTo(0);
      }
      return;
    }

    const before = this.#sheetCursor.index;
    this.#sheetCursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, rotated);
    if (before === this.#sheetCursor.index && seatInput.move.y < 0 && this.#sheetCursor.row === 0) {
      this.#focus = 'dice';
      this.#diceCursor.moveTo(DICE);
    }
  }

  #spend(category: Category): void {
    if (!score(this.#position, category)) return;
    this.#focus = 'dice';
    this.#diceCursor.moveTo(DICE);
    this.#sheetCursor.reset();
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.#position.seat !== this.#localSeat;
  }

  getActiveSeat(): SeatId {
    return this.#position.seat;
  }

  getScore(): MatchScore {
    return {
      p1: totalFor(this.#position.sheetP1),
      p2: totalFor(this.#position.sheetP2),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    this.#matchWinner = null;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawStatus(renderer);
    this.#drawDice(renderer);
    this.#drawRollControl(renderer);
    this.#drawSheet(renderer);
    renderer.popSeatRotation();
  }

  #drawStatus(renderer: Renderer): void {
    const sheet = sheetOf(this.#position, this.#position.seat);
    const upper = upperTotal(sheet);
    const line =
      this.#position.rollsUsed === 0
        ? 'Roll to start your turn'
        : this.#position.phase === 'choosing'
          ? 'Spend the hand'
          : `Keep any dice, then roll again — ${String(ROLLS_PER_TURN - this.#position.rollsUsed)} left`;
    renderer.text(line, 450, 56, 34, COLOUR_TEXT, 'centre');
    renderer.text(
      `Upper ${String(upper)} / ${String(UPPER_BONUS_THRESHOLD)}`,
      450,
      92,
      24,
      COLOUR_MUTED,
      'centre',
    );
  }

  #drawDice(renderer: Renderer): void {
    for (let i = 0; i < DICE; i += 1) {
      const x = DICE_ORIGIN_X + i * (DIE_SIZE + DIE_GAP);
      const face = this.#position.dice[i];
      const held = this.#position.held[i] === true;
      if (face === undefined) {
        // Before the first roll: an empty slot, so the row does not appear from nowhere.
        renderer.strokeRect(x, DICE_ORIGIN_Y, DIE_SIZE, DIE_SIZE, 3, COLOUR_HINT);
        continue;
      }
      renderer.rect(x, DICE_ORIGIN_Y, DIE_SIZE, DIE_SIZE, held ? COLOUR_DIE_HELD : COLOUR_DIE);
      this.#drawPips(renderer, x, DICE_ORIGIN_Y, face);
      // Rule 7: a held die is marked with a bar as well as a warmer face.
      if (held) renderer.rect(x + 12, DICE_ORIGIN_Y + DIE_SIZE - 16, DIE_SIZE - 24, 8, COLOUR_INK);
      if (this.#focus === 'dice' && this.#diceCursor.index === i) {
        renderer.strokeRect(
          x - 5,
          DICE_ORIGIN_Y - 5,
          DIE_SIZE + 10,
          DIE_SIZE + 10,
          4,
          this.#accent(),
        );
      }
    }
  }

  /** Pips, not a numeral: a die a player has to read as a number is not a die. */
  #drawPips(renderer: Renderer, x: number, y: number, face: number): void {
    const near = DIE_SIZE * 0.26;
    const far = DIE_SIZE - near;
    const mid = DIE_SIZE / 2;
    const radius = DIE_SIZE * 0.085;
    const spots: readonly (readonly [number, number])[] =
      face === 1
        ? [[mid, mid]]
        : face === 2
          ? [
              [near, near],
              [far, far],
            ]
          : face === 3
            ? [
                [near, near],
                [mid, mid],
                [far, far],
              ]
            : face === 4
              ? [
                  [near, near],
                  [far, near],
                  [near, far],
                  [far, far],
                ]
              : face === 5
                ? [
                    [near, near],
                    [far, near],
                    [mid, mid],
                    [near, far],
                    [far, far],
                  ]
                : [
                    [near, near],
                    [far, near],
                    [near, mid],
                    [far, mid],
                    [near, far],
                    [far, far],
                  ];
    for (const [dx, dy] of spots) renderer.circle(x + dx, y + dy, radius, COLOUR_INK);
  }

  #drawRollControl(renderer: Renderer): void {
    const canRoll = this.#position.phase === 'rolling' && this.#position.rollsUsed < ROLLS_PER_TURN;
    const focused = this.#focus === 'dice' && this.#diceCursor.index === DICE;
    renderer.rect(
      ROLL_X,
      ROLL_Y,
      ROLL_WIDTH,
      ROLL_HEIGHT,
      canRoll ? this.#accent() : COLOUR_PANEL_TAKEN,
    );
    if (focused)
      renderer.strokeRect(
        ROLL_X - 5,
        ROLL_Y - 5,
        ROLL_WIDTH + 10,
        ROLL_HEIGHT + 10,
        4,
        COLOUR_TEXT,
      );
    renderer.text(
      canRoll
        ? `Roll (${String(ROLLS_PER_TURN - this.#position.rollsUsed)} left)`
        : 'No rolls left',
      450,
      ROLL_Y + 48,
      30,
      canRoll ? COLOUR_INK : COLOUR_MUTED,
      'centre',
    );
  }

  #drawSheet(renderer: Renderer): void {
    const sheet = sheetOf(this.#position, this.#position.seat);
    const hand = this.#position.dice;

    for (let row = 0; row < SHEET_ROWS; row += 1) {
      for (let column = 0; column < SHEET_COLUMNS; column += 1) {
        const rect = sheetCellRect(row, column);
        const category = categoryAt(row, column);

        if (category === null) {
          // The bonus row: shown, never chosen.
          if (column === 0) {
            renderer.rect(rect.x, rect.y, rect.w, rect.h, COLOUR_PANEL_TAKEN);
            renderer.text('Bonus at 63', rect.x + 16, rect.y + 48, 26, COLOUR_MUTED);
            renderer.text(
              String(bonusFor(sheet)),
              rect.x + rect.w - 20,
              rect.y + 48,
              30,
              COLOUR_TEXT,
              'right',
            );
          }
          continue;
        }

        const taken = isTaken(sheet, category);
        renderer.rect(rect.x, rect.y, rect.w, rect.h, taken ? COLOUR_PANEL_TAKEN : COLOUR_PANEL);
        renderer.text(
          LABELS[category],
          rect.x + 16,
          rect.y + 48,
          26,
          taken ? COLOUR_MUTED : COLOUR_TEXT,
        );

        if (taken) {
          renderer.text(
            String(sheet[category] ?? 0),
            rect.x + rect.w - 20,
            rect.y + 48,
            30,
            COLOUR_TEXT,
            'right',
          );
          // Rule 7: a spent row is struck through as well as dimmed.
          renderer.line(
            rect.x + 10,
            rect.y + rect.h - 10,
            rect.x + rect.w - 10,
            rect.y + 10,
            2,
            COLOUR_HINT,
          );
        } else if (hand.length > 0) {
          // What this hand would score here, which is the whole of the decision.
          renderer.text(
            String(scoreFor(category, hand)),
            rect.x + rect.w - 20,
            rect.y + 48,
            30,
            COLOUR_HINT,
            'right',
          );
        }

        if (
          this.#focus === 'sheet' &&
          this.#sheetCursor.row === row &&
          this.#sheetCursor.column === column
        ) {
          renderer.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, 4, this.#accent());
        }
      }
    }
  }

  #accent(): string {
    return SEAT_PALETTE[this.#position.seat].base;
  }
}
