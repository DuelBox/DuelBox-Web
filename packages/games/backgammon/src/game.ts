import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BAR,
  BEAR_OFF,
  CHECKERS,
  HOME_START,
  POINTS,
  applyMove,
  barOf,
  boardIndex,
  botMove,
  createPosition,
  legalMoves,
  moveDie,
  moveFrom,
  moveTo,
  offOf,
  ownAt,
  passTurn,
  pipsGained,
  resetPosition,
  roll,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Position } from './rules.js';

/**
 * Backgammon, on one board both players reach across.
 *
 * ## The board reads like two lines of text **[ours]**
 *
 * A traditional board runs one player's path round three sides in a horseshoe. This one
 * runs the twenty-four points left to right along the top and then left to right along the
 * bottom, and that is a deliberate trade. It costs the horseshoe; it buys **exact
 * rotational symmetry** — point `i` sits precisely where point `23 − i` sits after the half
 * turn, so when the board flips to face the other seat, that player sees their own position
 * drawn identically to how the first player saw theirs. Their home board is in the same
 * corner, their tray is in the same place, and the highlight walks the same way. On a phone
 * two people are passing back and forth, that is worth more than the shape being familiar.
 *
 * ## One aim, two instruments
 *
 * Everything a player does is "name a place, and the nearest legal move to it is played".
 * A finger names the place directly. The keyboard walks a cursor along the legal moves in
 * board order. Both end in the same commit, and the move that would be played is drawn
 * before it is played, so neither instrument is guessing.
 */

export const BOARD = 900;
export const COLUMNS = 12;
/** Where the top row of points is anchored; the bottom row mirrors it. */
export const TOP_BASE = 96;
export const BOTTOM_BASE = BOARD - TOP_BASE;
export const POINT_LENGTH = 282;
export const BAR_TOP = TOP_BASE + POINT_LENGTH;
export const BAR_BOTTOM = BOARD - BAR_TOP;
export const SIDE = 60;
/** The gap down the middle of each row, standing in for the bar of a real board. */
export const CENTRE_GAP = 24;
export const COLUMN_WIDTH = (BOARD - SIDE * 2 - CENTRE_GAP) / COLUMNS;
export const CHECKER_RADIUS = 26;
export const STACK_STEP = 48;
/** Checkers drawn before the stack turns into a number. */
export const STACK_SHOWN = 5;
export const TRAY_TOP = 26;
export const TRAY_HEIGHT = 56;
/** How far either side of the middle a seat's bar checkers wait. */
export const BAR_OFFSET = 190;
export const DIE_SIZE = 48;
export const DIE_STEP = 56;

/**
 * The keyboard cursor is a grid over the *legal moves*, not over the board.
 *
 * Over the board it would be unplayable: twenty-four points and at most a handful of them
 * movable means most presses would land on nothing, and a keyboard that mostly does nothing
 * is a game that cannot be played without a touchscreen. Over the moves, every press plays
 * something. Left and right step one move; up and down jump six, so a long list is crossed
 * in a couple of presses. Six by six is comfortably more than the thirty (fifteen points,
 * two dice) a position can offer.
 */
export const CURSOR_COLUMNS = 6;
export const CURSOR_ROWS = 6;
const CURSOR_CELLS = CURSOR_COLUMNS * CURSOR_ROWS;

const COLOUR_BACKGROUND = '#101a16';
const COLOUR_FRAME = '#1b2a23';
const COLOUR_BAR = '#0b120f';
const COLOUR_POINT_LIGHT = '#cbb994';
const COLOUR_POINT_DARK = '#5d7a68';
const COLOUR_TRAY = '#22322a';
const COLOUR_TEXT = '#e9f2ec';
const COLOUR_MUTED = 'rgba(233, 242, 236, 0.55)';
const COLOUR_DIE = '#f4f1e8';
const COLOUR_INK = '#101a16';
const COLOUR_HINT = 'rgba(255, 255, 255, 0.78)';

/** Slices per point. A triangle out of rectangles, because the renderer draws no polygons. */
const POINT_SLICES = 7;

/** Converted to whole steps before being counted, so a replay is exact at any frame rate. */
const THINK_SECONDS = 0.22;
const PASS_SECONDS = 0.7;
const SETTLE_SECONDS = 1.1;

/** The centre of a point's column. Exported because the tests check the same mapping. */
export function pointX(index: number): number {
  const column = index % COLUMNS;
  const gap = column >= COLUMNS / 2 ? CENTRE_GAP : 0;
  return SIDE + column * COLUMN_WIDTH + COLUMN_WIDTH / 2 + gap;
}

export function pointIsTop(index: number): boolean {
  return index < COLUMNS;
}

/** The line a point stands on: the top row hangs down from it, the bottom row stands up. */
export function pointBaseY(index: number): number {
  return pointIsTop(index) ? TOP_BASE : BOTTOM_BASE;
}

export function pointDirection(index: number): number {
  return pointIsTop(index) ? 1 : -1;
}

/** Where the `slot`-th checker on a point is drawn. Deeper stacks pile onto the last slot. */
export function stackY(index: number, slot: number): number {
  const capped = slot < STACK_SHOWN ? slot : STACK_SHOWN - 1;
  return pointBaseY(index) + pointDirection(index) * (CHECKER_RADIUS + 6 + capped * STACK_STEP);
}

export function trayX(seat: SeatId): number {
  return seat === 'p1' ? BOARD * 0.72 : BOARD - BOARD * 0.72;
}

export function trayY(seat: SeatId): number {
  const top = TRAY_TOP + TRAY_HEIGHT / 2;
  return seat === 'p1' ? BOARD - top : top;
}

export function barX(seat: SeatId): number {
  return BOARD / 2 + (seat === 'p1' ? BAR_OFFSET : -BAR_OFFSET);
}

/**
 * The point a move is aimed at, in board space.
 *
 * One function for both instruments and for the drawing, so what a finger is measured
 * against is exactly what the eye is shown.
 */
export function anchorX(seat: SeatId, travel: number): number {
  if (travel === BAR) return barX(seat);
  if (travel >= BEAR_OFF) return trayX(seat);
  return pointX(boardIndex(seat, travel));
}

export function anchorY(seat: SeatId, travel: number): number {
  if (travel === BAR) return BOARD / 2;
  if (travel >= BEAR_OFF) return trayY(seat);
  const index = boardIndex(seat, travel);
  return pointBaseY(index) + pointDirection(index) * POINT_LENGTH * 0.42;
}

function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export class BackgammonGame implements Game {
  readonly #position: Position = createPosition();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({
    columns: CURSOR_COLUMNS,
    rows: CURSOR_ROWS,
    startIndex: 0,
  });
  /** The legal moves of the seat to play, recomputed every step and never reallocated. */
  readonly #moves: number[] = [];

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #moveCount = 0;
  #selected = 0;
  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #passSteps = 0;
  #settleSteps = 0;

  get position(): Position {
    return this.#position;
  }

  /** The move a press would play right now, or -1 when there is none. */
  get selectedMove(): number {
    if (this.#moveCount === 0) return -1;
    return this.#moves[this.#selected] ?? -1;
  }

  get moveCount(): number {
    return this.#moveCount;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#passSteps = 0;
    this.#settleSteps = 0;
    resetPosition(this.#position, context.openingSeat);
    this.#cursor.reset();
    this.#selected = 0;
    this.#refresh();
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    this.#refresh();
    if (this.#matchWinner !== null) return;

    // The last move is left on the board for a beat before the shell is told who won.
    // Started and counted down in the same step, like every other delay here, so it lasts
    // exactly `stepsFor(SETTLE_SECONDS)` steps rather than one more than that.
    if (this.#position.phase === 'over') {
      if (this.#settleSteps === 0) this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#position);
      return;
    }

    // A roll with nothing to play is held on screen for a beat before the turn changes
    // hands. A turn that silently bounces back looks like the game ignored someone — and
    // being shut out on the bar is the most common way it happens, so it is the moment a
    // player most needs told what just did not happen.
    //
    // Checked where the position is read rather than where the dice are thrown: tying it to
    // the roll leaves a stuck state reachable by any other route into `moving`.
    if (this.#passSteps === 0 && this.#position.phase === 'moving' && this.#moveCount === 0) {
      this.#passSteps = this.#stepsFor(PASS_SECONDS);
    }
    if (this.#passSteps > 0) {
      this.#passSteps -= 1;
      if (this.#passSteps === 0) {
        passTurn(this.#position);
        this.#cursor.reset();
        this.#selected = 0;
        this.#refresh();
      }
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

  /**
   * The pause a bot takes before it acts, counted in steps rather than seconds.
   *
   * The step it acts on is the last step of the pause, not the one after it. Counting the
   * two separately cost `stepsFor(THINK_SECONDS) + 1` steps an action, and a constant one
   * added to a count taken from the frame rate does not scale with it: fourteen steps at
   * sixty is 0.233 s, twenty-seven at a hundred and twenty is 0.225 s, and two devices
   * stepping the same match drifted a move apart within ten seconds. Rule 8 is not only
   * about pixels — a delay expressed in frames is the same mistake.
   */
  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
    this.#thinkSteps -= 1;
    if (this.#thinkSteps > 0) return;
    this.#thinkSteps = -1;

    if (this.#position.phase === 'rolling') {
      roll(this.#position, this.#rng);
      this.#refresh();
      return;
    }
    const code = botMove(this.#position, this.#rng, difficulty);
    if (code < 0) return;
    applyMove(this.#position, code);
    this.#refresh();
  }

  #updateHuman(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const position = this.#position;
    if (position.phase === 'rolling') {
      if (!seatInput.actionPressed) return;
      roll(position, this.#rng);
      this.#cursor.reset();
      this.#selected = 0;
      this.#refresh();
      return;
    }
    if (this.#moveCount === 0) return;

    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // A finger names a place on the board, so the board it names is the one the player is
      // looking at: the flip owns that mapping, and the game asks it rather than repeating it.
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const nearest = this.#nearestMove(this.#pointerWorld.x, this.#pointerWorld.y);
      if (nearest >= 0) {
        this.#selected = nearest;
        // Keep the cursor where the finger left off, so picking the keyboard back up does
        // not throw the highlight somewhere unrelated.
        this.#cursor.moveTo(nearest < CURSOR_CELLS ? nearest : CURSOR_CELLS - 1);
      }
    } else {
      this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);
      this.#selected =
        this.#cursor.index < this.#moveCount ? this.#cursor.index : this.#moveCount - 1;
    }

    if (!seatInput.actionPressed) return;
    const code = this.#moves[this.#selected];
    if (code === undefined) return;
    applyMove(position, code);
    this.#refresh();
  }

  /**
   * The legal move nearest a point on the board.
   *
   * Nearest by the point it starts from, and then by where it lands — which is how a player
   * chooses a die with one finger: tap the checker to move it the short way, tap out towards
   * the landing point to move it the long way. Ties go to the earlier move in board order,
   * so the same tap always plays the same move.
   */
  #nearestMove(x: number, y: number): number {
    const seat = this.#position.seat;
    let best = -1;
    let bestSource = Infinity;
    let bestTarget = Infinity;
    for (let i = 0; i < this.#moveCount; i += 1) {
      const code = this.#moves[i] ?? 0;
      const from = moveFrom(code);
      const source = distanceSq(anchorX(seat, from), anchorY(seat, from), x, y);
      if (source > bestSource) continue;
      const to = moveTo(code);
      const target = distanceSq(anchorX(seat, to), anchorY(seat, to), x, y);
      if (source === bestSource && target >= bestTarget) continue;
      best = i;
      bestSource = source;
      bestTarget = target;
    }
    return best;
  }

  #refresh(): void {
    this.#moveCount = legalMoves(this.#moves, this.#position, this.#position.seat);
    if (this.#selected >= this.#moveCount) {
      this.#selected = this.#moveCount > 0 ? this.#moveCount - 1 : 0;
    }
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
    // Pips gained, which is the race both players are watching. Bearing off decides the
    // match; how far you have come is what the number in the HUD is for.
    return {
      p1: pipsGained(this.#position, 'p1'),
      p2: pipsGained(this.#position, 'p2'),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetPosition(this.#position);
    this.#moves.length = 0;
    this.#moveCount = 0;
    this.#selected = 0;
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#passSteps = 0;
    this.#settleSteps = 0;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawPoints(renderer);
    this.#drawTrays(renderer);
    this.#drawCheckers(renderer);
    this.#drawDice(renderer);
    this.#drawSelection(renderer);
    this.#drawStatus(renderer);
    renderer.popSeatRotation();
  }

  #drawBoard(renderer: Renderer): void {
    const left = SIDE - 18;
    const width = BOARD - left * 2;
    renderer.rect(left, TOP_BASE - 18, width, BOTTOM_BASE + 18 - (TOP_BASE - 18), COLOUR_FRAME);
    renderer.rect(left, BAR_TOP, width, BAR_BOTTOM - BAR_TOP, COLOUR_BAR);
    renderer.rect(
      BOARD / 2 - CENTRE_GAP / 2,
      TOP_BASE - 18,
      CENTRE_GAP,
      BOTTOM_BASE + 18 - (TOP_BASE - 18),
      COLOUR_BAR,
    );
  }

  /**
   * The twenty-four points, and a dot under each one a checker may leave this turn.
   *
   * The dots are the same idea as hollowing a dead token in Ludo, turned the right way up:
   * with twenty-four points and two dice, what a player needs shown is the short list of
   * places something *can* happen.
   */
  #drawPoints(renderer: Renderer): void {
    for (let index = 0; index < POINTS; index += 1) {
      const x = pointX(index);
      const base = pointBaseY(index);
      const direction = pointDirection(index);
      // Parity flipped on the bottom row so a point and its opposite share a shade, which
      // is what keeps the board identical for both seats through the half turn.
      const light = ((index % 2) ^ (index < COLUMNS ? 0 : 1)) === 0;
      const colour = light ? COLOUR_POINT_LIGHT : COLOUR_POINT_DARK;
      for (let slice = 0; slice < POINT_SLICES; slice += 1) {
        const from = slice / POINT_SLICES;
        const to = (slice + 1) / POINT_SLICES;
        const half = (COLUMN_WIDTH / 2 - 2) * (1 - from);
        const y0 = base + direction * POINT_LENGTH * from;
        const y1 = base + direction * POINT_LENGTH * to;
        renderer.rect(x - half, Math.min(y0, y1), half * 2, Math.abs(y1 - y0), colour);
      }
    }

    // The two home boards, tinted and marked so nobody has to be told which end is theirs.
    for (const seat of ['p1', 'p2'] as const) {
      for (let travel = HOME_START; travel < POINTS; travel += 1) {
        const index = boardIndex(seat, travel);
        const y = pointBaseY(index) - (pointIsTop(index) ? 12 : 0);
        renderer.rect(
          pointX(index) - COLUMN_WIDTH / 2,
          y,
          COLUMN_WIDTH,
          12,
          SEAT_PALETTE[seat].soft,
        );
      }
    }

    const seat = this.#position.seat;
    let lastFrom = BEAR_OFF;
    for (let i = 0; i < this.#moveCount; i += 1) {
      const from = moveFrom(this.#moves[i] ?? 0);
      if (from === lastFrom || from === BAR) continue;
      lastFrom = from;
      const index = boardIndex(seat, from);
      const y = pointBaseY(index) - pointDirection(index) * 10;
      renderer.circle(pointX(index), y, 5, COLOUR_HINT);
    }
  }

  #drawTrays(renderer: Renderer): void {
    for (const seat of ['p1', 'p2'] as const) {
      const top = seat === 'p1' ? BOARD - TRAY_TOP - TRAY_HEIGHT : TRAY_TOP;
      const left = seat === 'p1' ? BOARD / 2 + 20 : SIDE;
      renderer.rect(left, top, BOARD / 2 - 20 - SIDE, TRAY_HEIGHT, COLOUR_TRAY);
      renderer.strokeRect(
        left,
        top,
        BOARD / 2 - 20 - SIDE,
        TRAY_HEIGHT,
        2,
        SEAT_PALETTE[seat].soft,
      );

      const off = offOf(this.#position, seat);
      for (let i = 0; i < off; i += 1) {
        const x = seat === 'p1' ? 480 + i * 22 : BOARD - 490 - i * 22;
        renderer.rect(x, top + 10, 10, TRAY_HEIGHT - 20, SEAT_PALETTE[seat].base);
      }
      const label = `${String(off)}/${String(CHECKERS)}`;
      renderer.text(label, seat === 'p1' ? 815 : 85, trayY(seat), 26, COLOUR_MUTED, 'centre');
    }
  }

  #drawCheckers(renderer: Renderer): void {
    for (const seat of ['p1', 'p2'] as const) {
      for (let travel = 0; travel < POINTS; travel += 1) {
        const count = ownAt(this.#position, seat, travel);
        if (count === 0) continue;
        const index = boardIndex(seat, travel);
        const x = pointX(index);
        const shown = count < STACK_SHOWN ? count : STACK_SHOWN;
        for (let slot = 0; slot < shown; slot += 1) {
          this.#drawChecker(renderer, seat, x, stackY(index, slot), CHECKER_RADIUS);
        }
        if (count > STACK_SHOWN) {
          renderer.text(String(count), x, stackY(index, STACK_SHOWN - 1), 26, COLOUR_INK, 'centre');
        }
      }

      const onBar = barOf(this.#position, seat);
      const direction = seat === 'p1' ? 1 : -1;
      const shownBar = onBar < 3 ? onBar : 3;
      for (let i = 0; i < shownBar; i += 1) {
        this.#drawChecker(renderer, seat, barX(seat), BOARD / 2 + direction * (20 + i * 22), 18);
      }
      if (onBar > 3) {
        renderer.text(String(onBar), barX(seat), BOARD / 2, 24, COLOUR_TEXT, 'centre');
      }
    }
  }

  /**
   * Rule 7: p1's checkers carry a ring, p2's a bar. Told apart with the colour taken away,
   * on the board, on the bar and in the tray alike.
   */
  #drawChecker(renderer: Renderer, seat: SeatId, x: number, y: number, radius: number): void {
    const palette = SEAT_PALETTE[seat];
    renderer.circle(x, y, radius, palette.base);
    renderer.strokeCircle(x, y, radius, 3, palette.deep);
    if (seat === 'p1') renderer.strokeCircle(x, y, radius * 0.45, 4, palette.deep);
    else renderer.rect(x - radius * 0.62, y - 4, radius * 1.24, 8, palette.deep);
  }

  #drawDice(renderer: Renderer): void {
    const dice = this.#position.dice;
    if (this.#position.phase !== 'moving' || dice.length === 0) {
      for (let i = 0; i < 2; i += 1) {
        const x = BOARD / 2 + (i - 0.5) * DIE_STEP - DIE_SIZE / 2;
        renderer.strokeRect(x, BOARD / 2 - DIE_SIZE / 2, DIE_SIZE, DIE_SIZE, 3, COLOUR_MUTED);
      }
      return;
    }
    for (let i = 0; i < dice.length; i += 1) {
      const x = BOARD / 2 + (i - (dice.length - 1) / 2) * DIE_STEP - DIE_SIZE / 2;
      this.#drawDie(renderer, x, BOARD / 2 - DIE_SIZE / 2, dice[i] ?? 1);
    }
  }

  #drawDie(renderer: Renderer, x: number, y: number, value: number): void {
    renderer.rect(x, y, DIE_SIZE, DIE_SIZE, COLOUR_DIE);
    const near = DIE_SIZE * 0.27;
    const far = DIE_SIZE - near;
    const mid = DIE_SIZE / 2;
    const radius = DIE_SIZE * 0.09;
    // Written as a loop over the two axes rather than a table of spot positions: a die face
    // is a symmetric pattern, and the pattern is shorter than the table.
    if (value % 2 === 1) renderer.circle(x + mid, y + mid, radius, COLOUR_INK);
    if (value >= 2) {
      renderer.circle(x + near, y + near, radius, COLOUR_INK);
      renderer.circle(x + far, y + far, radius, COLOUR_INK);
    }
    if (value >= 4) {
      renderer.circle(x + far, y + near, radius, COLOUR_INK);
      renderer.circle(x + near, y + far, radius, COLOUR_INK);
    }
    if (value === 6) {
      renderer.circle(x + near, y + mid, radius, COLOUR_INK);
      renderer.circle(x + far, y + mid, radius, COLOUR_INK);
    }
  }

  /**
   * The move a press would play, drawn before it is played.
   *
   * Both instruments aim the same way, so both are shown the same thing: a ring on the
   * checker that would leave, a line to where it would land, and a hollow checker waiting
   * there. Nothing about this asks which device is being held.
   */
  #drawSelection(renderer: Renderer): void {
    if (this.#position.phase !== 'moving') return;
    const code = this.selectedMove;
    if (code < 0) return;
    const seat = this.#position.seat;
    const from = moveFrom(code);
    const to = moveTo(code);

    const sourceX = anchorX(seat, from);
    let sourceY = anchorY(seat, from);
    if (from !== BAR) {
      const index = boardIndex(seat, from);
      sourceY = stackY(index, ownAt(this.#position, seat, from) - 1);
    }
    renderer.strokeCircle(sourceX, sourceY, CHECKER_RADIUS + 7, 4, COLOUR_HINT);

    const targetX = anchorX(seat, to);
    let targetY = anchorY(seat, to);
    if (to < POINTS) {
      const index = boardIndex(seat, to);
      targetY = stackY(index, ownAt(this.#position, seat, to));
    }
    renderer.line(sourceX, sourceY, targetX, targetY, 3, COLOUR_HINT);
    renderer.strokeCircle(targetX, targetY, CHECKER_RADIUS, 4, SEAT_PALETTE[seat].base);
    renderer.text(String(moveDie(code)), targetX, targetY, 26, COLOUR_TEXT, 'centre');
  }

  #drawStatus(renderer: Renderer): void {
    const position = this.#position;
    const line =
      this.#passSteps > 0
        ? 'No move — the turn passes'
        : position.phase === 'rolling'
          ? 'Roll'
          : barOf(position, position.seat) > 0
            ? 'Enter from the bar'
            : 'Move';
    renderer.text(line, BOARD / 2, BAR_BOTTOM - 26, 26, COLOUR_TEXT, 'centre');
  }
}
