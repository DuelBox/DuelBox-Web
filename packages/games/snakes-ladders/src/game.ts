import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  COLUMNS,
  DICE,
  FIELDS,
  LADDERS,
  ROWS,
  SNAKES,
  START,
  boardColumn,
  boardRow,
  botDie,
  chooseDie,
  createPosition,
  destinationFor,
  dieAt,
  endTurn,
  fieldOf,
  hasBitten,
  landingFor,
  progressOf,
  resetPosition,
  roll,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Position } from './rules.js';

/** Board geometry in logical units. Exported because the tests need the same mapping. */
export const BOARD = 900;
export const CELL = 88;
export const BOARD_LEFT = (BOARD - COLUMNS * CELL) / 2;
export const BOARD_TOP = 72;
export const BOARD_BOTTOM = BOARD_TOP + ROWS * CELL;
export const TOKEN_RADIUS = 26;
/**
 * Two tokens share a field often, so each seat sits on its own diagonal of the one it is
 * on: seat one low and left, seat two high and right. Side by side alone left them touching
 * on a square that is only three token-widths across.
 */
export const TOKEN_OFFSET = 18;
export const TOKEN_STAGGER = 10;

export const DIE_SIZE = 88;
export const DIE_GAP = 40;
export const DIE_Y = 792;
/** Where the waiting tokens sit before the first roll, either side of the dice tray. */
export const START_Y = DIE_Y + DIE_SIZE / 2;
export const START_X: Readonly<Record<SeatId, number>> = Object.freeze({ p1: 170, p2: 730 });

const COLOUR_BACKGROUND = '#151a26';
const COLOUR_CELL_LIGHT = '#f4efe2';
const COLOUR_CELL_DARK = '#e0d8c4';
const COLOUR_CELL_EDGE = '#a99d82';
const COLOUR_FIELD_NUMBER = '#8b8069';
const COLOUR_LADDER = '#2f7d4f';
const COLOUR_SNAKE = '#a83c25';
const COLOUR_DIE_FACE = '#f7f4ec';
const COLOUR_INK = '#151a26';
const COLOUR_TEXT = '#eef1f8';
const COLOUR_MUTED = 'rgba(238, 241, 248, 0.5)';

/**
 * How long each beat of a turn lasts.
 *
 * Whole tenths, so every one of them is a whole number of steps at 60, 90 and 120 Hz and
 * the same match plays out identically on all three.
 */
const THINK_SECONDS = 0.4;
const MOVE_SECONDS = 0.3;
const JUMP_SECONDS = 0.6;
const SETTLE_SECONDS = 1.0;

const SEATS_IN_ORDER: readonly SeatId[] = Object.freeze(['p1', 'p2']);

/** How many straight pieces a snake's body is drawn from. Enough to read as a curve. */
const SNAKE_SEGMENTS = 8;

interface Spot {
  readonly x: number;
  readonly y: number;
}

const PIP_NEAR = 0.26;
const PIP_FAR = 0.74;
const PIP_MID = 0.5;

/** Pip positions per face, as fractions of the die box. A real die, written down once. */
const PIP_SPOTS: Readonly<Record<number, readonly Spot[]>> = Object.freeze({
  1: [{ x: PIP_MID, y: PIP_MID }],
  2: [
    { x: PIP_NEAR, y: PIP_NEAR },
    { x: PIP_FAR, y: PIP_FAR },
  ],
  3: [
    { x: PIP_NEAR, y: PIP_NEAR },
    { x: PIP_MID, y: PIP_MID },
    { x: PIP_FAR, y: PIP_FAR },
  ],
  4: [
    { x: PIP_NEAR, y: PIP_NEAR },
    { x: PIP_FAR, y: PIP_NEAR },
    { x: PIP_NEAR, y: PIP_FAR },
    { x: PIP_FAR, y: PIP_FAR },
  ],
  5: [
    { x: PIP_NEAR, y: PIP_NEAR },
    { x: PIP_FAR, y: PIP_NEAR },
    { x: PIP_MID, y: PIP_MID },
    { x: PIP_NEAR, y: PIP_FAR },
    { x: PIP_FAR, y: PIP_FAR },
  ],
  6: [
    { x: PIP_NEAR, y: PIP_NEAR },
    { x: PIP_FAR, y: PIP_NEAR },
    { x: PIP_NEAR, y: PIP_MID },
    { x: PIP_FAR, y: PIP_MID },
    { x: PIP_NEAR, y: PIP_FAR },
    { x: PIP_FAR, y: PIP_FAR },
  ],
});

/** The left edge of a die box in the tray. */
export function dieBoxX(index: number): number {
  return BOARD / 2 - DIE_SIZE - DIE_GAP / 2 + index * (DIE_SIZE + DIE_GAP);
}

export function fieldCentreX(field: number): number {
  return BOARD_LEFT + boardColumn(field) * CELL + CELL / 2;
}

export function fieldCentreY(field: number): number {
  return BOARD_BOTTOM - boardRow(field) * CELL - CELL / 2;
}

/** Where a seat's token is drawn, including before it has left the start. */
export function tokenX(seat: SeatId, field: number): number {
  if (field <= START) return START_X[seat];
  return fieldCentreX(field) + (seat === 'p1' ? -TOKEN_OFFSET : TOKEN_OFFSET);
}

export function tokenY(seat: SeatId, field: number): number {
  if (field <= START) return START_Y;
  return fieldCentreY(field) + (seat === 'p1' ? TOKEN_STAGGER : -TOKEN_STAGGER);
}

/** The same pair as an object, for tests and rendering. Never called from `update`. */
export function tokenCentre(seat: SeatId, field: number): { x: number; y: number } {
  return { x: tokenX(seat, field), y: tokenY(seat, field) };
}

export class SnakesandLaddersGame implements Game {
  readonly #position: Position = createPosition();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({ columns: DICE, rows: 1, startIndex: 0 });

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #resolveSteps = -1;
  #settleSteps = 0;

  get position(): Position {
    return this.#position;
  }

  get cursorDie(): number {
    return this.#cursor.index;
  }

  /**
   * Whose turn it is.
   *
   * The shell decides a game is turn-based by the *presence* of this method, and only
   * then does it hand the whole board to the active seat and map both keyboard halves
   * onto them. Leave it out of a `turn-*` game and the arrow keys drive the player who
   * is not playing, while half the device goes dead to a finger. Return the seat that may
   * act right now.
   */
  getActiveSeat(): SeatId {
    return this.#position.seat;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#resolveSteps = -1;
    this.#settleSteps = 0;
    resetPosition(this.#position);
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
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#position);
      return;
    }
    if (this.#position.phase === 'over') {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    // A slide has to be seen. The board turning round the instant a key is pressed looks
    // like the game skipped a turn, and a snake nobody watched looks like a bad die.
    if (this.#position.phase === 'resolving') {
      if (this.#resolveSteps < 0) {
        const jumped = this.#position.lastKind !== 'none';
        this.#resolveSteps = this.#stepsFor(jumped ? JUMP_SECONDS : MOVE_SECONDS);
      }
      this.#resolveSteps -= 1;
      if (this.#resolveSteps <= 0) {
        this.#resolveSteps = -1;
        endTurn(this.#position);
        this.#cursor.reset();
        this.#thinkSteps = -1;
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

  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;

    if (this.#position.phase === 'rolling') {
      roll(this.#position, this.#rng);
      return;
    }
    const index = botDie(this.#position, this.#rng, difficulty);
    if (index >= 0) {
      this.#cursor.moveTo(index);
      chooseDie(this.#position, index);
    }
  }

  #updateHuman(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    if (this.#position.phase === 'rolling') {
      if (!seatInput.actionPressed) return;
      roll(this.#position, this.#rng);
      return;
    }

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const picked = this.#dieFor(this.#pointerWorld.x, this.#pointerWorld.y);
      this.#cursor.moveTo(picked);
      chooseDie(this.#position, picked);
      return;
    }
    if (seatInput.actionPressed) chooseDie(this.#position, this.#cursor.index);
  }

  /**
   * The die a tap means.
   *
   * A tap inside a die box is that die. Anything else is read as "take me there": the die
   * whose landing — or whose snake or ladder destination — is nearest the finger. There is
   * no dead tap, because both dice are always legal, and refusing a tap in a game offering
   * exactly two choices only ever reads as the board ignoring somebody.
   */
  #dieFor(x: number, y: number): number {
    for (let index = 0; index < DICE; index += 1) {
      const left = dieBoxX(index);
      if (x < left - 10 || x > left + DIE_SIZE + 10) continue;
      if (y < DIE_Y - 10 || y > DIE_Y + DIE_SIZE + 10) continue;
      return index;
    }

    const seat = this.#position.seat;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < DICE; index += 1) {
      const landing = this.#distanceTo(x, y, seat, landingFor(this.#position, seat, index));
      const arrival = this.#distanceTo(x, y, seat, destinationFor(this.#position, seat, index));
      const near = landing < arrival ? landing : arrival;
      if (near < bestDistance) {
        bestDistance = near;
        best = index;
      }
    }
    return best;
  }

  /** Squared distance, because only the comparison is wanted and a square root is not. */
  #distanceTo(x: number, y: number, seat: SeatId, field: number): number {
    const dx = tokenX(seat, field) - x;
    const dy = tokenY(seat, field) - y;
    return dx * dx + dy * dy;
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return false;
    return this.#position.seat !== this.#localSeat;
  }

  getScore(): MatchScore {
    // How far up the board each seat has come, which is the race a player is watching.
    return {
      p1: progressOf(this.#position, 'p1'),
      p2: progressOf(this.#position, 'p2'),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetPosition(this.#position);
    this.#matchWinner = null;
    this.#thinkSteps = -1;
    this.#resolveSteps = -1;
    this.#settleSteps = 0;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawFields(renderer);
    this.#drawLadders(renderer);
    this.#drawSnakes(renderer);
    this.#drawGhosts(renderer);
    this.#drawTokens(renderer);
    this.#drawDice(renderer);
    this.#drawStatus(renderer);
    renderer.popSeatRotation();
  }

  #drawFields(renderer: Renderer): void {
    for (let field = 1; field <= FIELDS; field += 1) {
      const left = fieldCentreX(field) - CELL / 2;
      const top = fieldCentreY(field) - CELL / 2;
      const checker = (boardRow(field) + boardColumn(field)) % 2 === 0;
      renderer.rect(left, top, CELL, CELL, checker ? COLOUR_CELL_LIGHT : COLOUR_CELL_DARK);
      renderer.strokeRect(left, top, CELL, CELL, 2, COLOUR_CELL_EDGE);
      // Every field carries its number. It is how a player reads a ladder's destination
      // off the board, and it is the one label that survives the colour being removed.
      renderer.text(String(field), left + 8, top + 16, 18, COLOUR_FIELD_NUMBER, 'left');
    }
    const endX = fieldCentreX(FIELDS);
    const endY = fieldCentreY(FIELDS);
    renderer.strokeRect(endX - CELL / 2, endY - CELL / 2, CELL, CELL, 6, COLOUR_TEXT);
    renderer.text('END', endX, endY + 26, 20, COLOUR_INK, 'centre');
    renderer.text('START', BOARD / 2, START_Y - 54, 20, COLOUR_MUTED, 'centre');
  }

  /**
   * Ladders: two rails and four rungs, drawn from the foot to the head.
   *
   * Rule 7 pointed at the board rather than at the players — a ladder and a snake have to be
   * told apart with the colour removed, so one is a rigid pair of rails with rungs and the
   * other a single curved body with a head. The chevron and the destination number in the
   * foot square say it a third time, for anyone who cannot follow a line across the board.
   */
  #drawLadders(renderer: Renderer): void {
    for (const ladder of LADDERS) {
      const x1 = fieldCentreX(ladder.from);
      const y1 = fieldCentreY(ladder.from);
      const x2 = fieldCentreX(ladder.to);
      const y2 = fieldCentreY(ladder.to);
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const px = (-(y2 - y1) / length) * 10;
      const py = ((x2 - x1) / length) * 10;
      renderer.line(x1 + px, y1 + py, x2 + px, y2 + py, 5, COLOUR_LADDER);
      renderer.line(x1 - px, y1 - py, x2 - px, y2 - py, 5, COLOUR_LADDER);
      for (let rung = 1; rung <= 4; rung += 1) {
        const t = rung / 5;
        const rx = x1 + (x2 - x1) * t;
        const ry = y1 + (y2 - y1) * t;
        renderer.line(rx + px, ry + py, rx - px, ry - py, 4, COLOUR_LADDER);
      }
      this.#drawMarker(renderer, ladder.from, ladder.to, true, COLOUR_LADDER);
    }
  }

  #drawSnakes(renderer: Renderer): void {
    for (let index = 0; index < SNAKES.length; index += 1) {
      const snake = SNAKES[index];
      if (snake === undefined) continue;
      const x1 = fieldCentreX(snake.from);
      const y1 = fieldCentreY(snake.from);
      const x2 = fieldCentreX(snake.to);
      const y2 = fieldCentreY(snake.to);
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      const px = -(y2 - y1) / length;
      const py = (x2 - x1) / length;

      let lastX = x1;
      let lastY = y1;
      for (let step = 1; step <= SNAKE_SEGMENTS; step += 1) {
        const t = step / SNAKE_SEGMENTS;
        const wave = Math.sin(t * Math.PI * 3) * 16;
        const nextX = x1 + (x2 - x1) * t + px * wave;
        const nextY = y1 + (y2 - y1) * t + py * wave;
        renderer.line(lastX, lastY, nextX, nextY, 10, COLOUR_SNAKE);
        lastX = nextX;
        lastY = nextY;
      }
      renderer.circle(x1, y1, 15, COLOUR_SNAKE);
      renderer.circle(x1 + 5, y1 - 5, 4, COLOUR_CELL_LIGHT);
      this.#drawSpent(renderer, index, x1, y1);
      this.#drawMarker(renderer, snake.from, snake.to, false, COLOUR_SNAKE);
    }
  }

  /**
   * Which seats a snake has already eaten.
   *
   * The rule is per player, so the mark has to be too: a ring for seat one and a bar for
   * seat two, in that seat's colour, stacked at the corner of the head square. A player who
   * has been down a snake once can see that it can no longer touch them.
   */
  #drawSpent(renderer: Renderer, snake: number, x: number, y: number): void {
    let marked = 0;
    for (const seat of SEATS_IN_ORDER) {
      if (!hasBitten(this.#position, seat, snake)) continue;
      const markX = x + CELL / 2 - 16;
      const markY = y - CELL / 2 + 16 + marked * 22;
      if (seat === 'p1') renderer.strokeCircle(markX, markY, 9, 3, SEAT_PALETTE.p1.base);
      else renderer.rect(markX - 9, markY - 4, 18, 8, SEAT_PALETTE.p2.base);
      marked += 1;
    }
  }

  /** A chevron and the destination number, in the square the jump starts from. */
  #drawMarker(renderer: Renderer, from: number, to: number, up: boolean, colour: string): void {
    const cx = fieldCentreX(from);
    const cy = fieldCentreY(from) + 20;
    const tip = up ? cy - 8 : cy + 8;
    const tail = up ? cy + 4 : cy - 4;
    renderer.line(cx - 12, tail, cx, tip, 4, colour);
    renderer.line(cx + 12, tail, cx, tip, 4, colour);
    renderer.text(String(to), cx, cy + 24, 20, colour, 'centre');
  }

  /**
   * The two places this roll could put the seat to move, drawn on the board.
   *
   * Without them a player has to add a die to a field number in their head every turn and
   * the decision the whole game rests on becomes arithmetic. Both are shown rather than only
   * the one under the cursor, because the choice is *between* them.
   */
  #drawGhosts(renderer: Renderer): void {
    if (this.#position.phase !== 'choosing') return;
    const seat = this.#position.seat;
    const palette = SEAT_PALETTE[seat];
    for (let index = 0; index < DICE; index += 1) {
      const die = dieAt(this.#position, index);
      if (die < 1) continue;
      const landing = landingFor(this.#position, seat, index);
      const arrival = destinationFor(this.#position, seat, index);
      const chosen = this.#cursor.index === index;
      const lx = tokenX(seat, landing);
      const ly = tokenY(seat, landing);
      renderer.strokeCircle(lx, ly, TOKEN_RADIUS + 6, chosen ? 6 : 2, palette.base);
      renderer.text(String(die), lx, ly, 22, palette.deep, 'centre');
      if (arrival === landing) continue;
      const ax = tokenX(seat, arrival);
      const ay = tokenY(seat, arrival);
      renderer.line(lx, ly, ax, ay, chosen ? 5 : 2, palette.soft);
      renderer.strokeCircle(ax, ay, TOKEN_RADIUS + 2, chosen ? 5 : 2, palette.deep);
    }
  }

  /**
   * Rule 7: seat one's token is a disc with a ring, seat two's a disc with a bar, and the
   * seat to move carries a further ring so the board says whose turn it is on its own.
   */
  #drawTokens(renderer: Renderer): void {
    for (const seat of SEATS_IN_ORDER) {
      const field = fieldOf(this.#position, seat);
      const x = tokenX(seat, field);
      const y = tokenY(seat, field);
      const palette = SEAT_PALETTE[seat];
      renderer.circle(x, y, TOKEN_RADIUS, palette.base);
      if (seat === 'p1') renderer.strokeCircle(x, y, TOKEN_RADIUS * 0.5, 4, palette.deep);
      else renderer.rect(x - TOKEN_RADIUS, y - 4, TOKEN_RADIUS * 2, 8, palette.deep);
      if (seat === this.#position.seat) {
        renderer.strokeCircle(x, y, TOKEN_RADIUS + 7, 4, COLOUR_TEXT);
      }
    }
  }

  #drawDice(renderer: Renderer): void {
    const palette = SEAT_PALETTE[this.#position.seat];
    for (let index = 0; index < DICE; index += 1) {
      const left = dieBoxX(index);
      const die = dieAt(this.#position, index);
      if (die === 0) {
        renderer.strokeRect(left, DIE_Y, DIE_SIZE, DIE_SIZE, 4, COLOUR_MUTED);
        renderer.text('?', left + DIE_SIZE / 2, DIE_Y + DIE_SIZE / 2, 40, COLOUR_MUTED, 'centre');
        continue;
      }
      renderer.rect(left, DIE_Y, DIE_SIZE, DIE_SIZE, COLOUR_DIE_FACE);
      // The die that would be used is ringed in the seat's colour and drawn thicker, so a
      // keyboard player can see what the action key is about to do before pressing it.
      const chosen = this.#position.phase === 'choosing' && this.#cursor.index === index;
      renderer.strokeRect(
        left - 6,
        DIE_Y - 6,
        DIE_SIZE + 12,
        DIE_SIZE + 12,
        chosen ? 6 : 2,
        chosen ? palette.base : COLOUR_MUTED,
      );
      this.#drawPips(renderer, left, die);
    }
  }

  #drawPips(renderer: Renderer, left: number, die: number): void {
    const radius = DIE_SIZE * 0.085;
    const spots = PIP_SPOTS[die];
    if (spots === undefined) return;
    for (const spot of spots) {
      renderer.circle(left + spot.x * DIE_SIZE, DIE_Y + spot.y * DIE_SIZE, radius, COLOUR_INK);
    }
  }

  #drawStatus(renderer: Renderer): void {
    renderer.text(this.#statusLine(), BOARD / 2, 40, 34, COLOUR_TEXT, 'centre');
  }

  #statusLine(): string {
    const position = this.#position;
    if (position.phase === 'over') return 'Home!';
    if (position.phase === 'resolving') {
      if (position.lastKind === 'ladder') return `Ladder up to ${String(position.lastTo)}`;
      if (position.lastKind === 'snake') return `Snake down to ${String(position.lastTo)}`;
      if (position.lastKind === 'spent') return 'That snake has already eaten';
      return `Moved to ${String(position.lastTo)}`;
    }
    if (position.phase === 'choosing') return 'Pick a die';
    return 'Roll two dice';
  }
}
