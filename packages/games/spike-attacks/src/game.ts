import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BODY_RADIUS,
  LEFT,
  LIVES,
  POCKET,
  RIGHT,
  ROW_LENGTH,
  SLOTS,
  STONE_HALF_WIDTH,
  TARGET_ROUNDS,
  bearingOf,
  botAsk,
  clearGame,
  createBotState,
  createGame,
  fieldOf,
  isUp,
  resetBotState,
  resetGame,
  shelterAt,
  step,
  winnerOf,
} from './rules.js';
import type {
  Ask,
  Bearing,
  BotDifficulty,
  BotState,
  Game as Position,
  Side,
  Stone,
} from './rules.js';

/**
 * Spike Attacks — a row of stones each, and spikes coming down it from one end.
 *
 * The rules module holds the whole simulation and knows only about a row: one number a
 * player stands at, nine stones on it, and which end the next volley comes from. What
 * lives here is how a person says "that way" through that, and how two rows are drawn one
 * above the other.
 *
 * The far seat's row is the near seat's turned **half a turn about the centre of the
 * board**, not mirrored, exactly as the far player is turned. Every shape below is authored
 * once in the near seat's frame and mapped through {@link flipX} and {@link flipY}, so each
 * player's row runs towards their own right and each player's ground is the edge of the
 * device nearest them. Nothing here reads `context.presentation` and nothing rotates the
 * renderer, because the board is already symmetric under the rotation a seat flip applies.
 */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** Half the box, which is one seat's ground. */
const HALF_HEIGHT = BOARD_HEIGHT / 2;

/** Everything below is in the near seat's frame. */
const ROW_X = (BOARD_WIDTH - ROW_LENGTH) / 2;
const GROUND_Y = 930;
/** The two rows of pocket bars, which is where the safe ground is drawn. */
const POCKET_LEFT_Y = GROUND_Y + 12;
const POCKET_RIGHT_Y = GROUND_Y + 24;
const POCKET_BAR = 7;
/** The height a whole stone stands, and what each remaining blow is worth of it. */
const STONE_BASE = 46;
const STONE_PER_HIT = 26;
const RUBBLE_HEIGHT = 13;
/** Where the volley flies, and how tall the wall of spikes is. */
const SPIKE_Y = GROUND_Y - 62;
const SPIKE_ROWS = 3;
const SPIKE_GAP = 26;
/** The strip nearest the divider, where the next volley is announced. */
const TELEGRAPH_Y = 556;
const TIMER_Y = 586;
const PIP_Y = BOARD_HEIGHT - 26;

const COLOUR_SKY = '#0a0e18';
/** The near seat's ground is the lighter of the two, so which half is yours survives grey. */
const COLOUR_GROUND_NEAR = '#1d2233';
const COLOUR_GROUND_FAR = '#121623';
const COLOUR_EARTH = '#2b3145';
const COLOUR_STONE = '#8d93a6';
const COLOUR_STONE_DEEP = '#565d73';
const COLOUR_RUBBLE = '#3d4457';
const COLOUR_SPIKE = '#f0e6cf';
const COLOUR_SPIKE_DEEP = '#8a7f63';
const COLOUR_SAFE = 'rgba(240, 230, 207, 0.5)';
const COLOUR_LINE = '#e9eefb';
const COLOUR_MUTED = 'rgba(233, 238, 251, 0.4)';

/** A finger this near the player is not asking for anything. Below one step's walk. */
const POINTER_DEADZONE = 8;

function flipX(seat: SeatId, x: number): number {
  return seat === 'p1' ? x : BOARD_WIDTH - x;
}

function flipY(seat: SeatId, y: number): number {
  return seat === 'p1' ? y : BOARD_HEIGHT - y;
}

function fillRect(
  renderer: Renderer,
  seat: SeatId,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): void {
  // A rect is anchored at its top-left corner, and half a turn moves that corner to the
  // far one — so the rotated origin is the opposite corner, not the mapped original.
  if (seat === 'p1') renderer.rect(x, y, width, height, colour);
  else renderer.rect(BOARD_WIDTH - x - width, BOARD_HEIGHT - y - height, width, height, colour);
}

function stroke(
  renderer: Renderer,
  seat: SeatId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  colour: string,
): void {
  renderer.line(flipX(seat, x1), flipY(seat, y1), flipX(seat, x2), flipY(seat, y2), width, colour);
}

function disc(
  renderer: Renderer,
  seat: SeatId,
  x: number,
  y: number,
  radius: number,
  colour: string,
): void {
  renderer.circle(flipX(seat, x), flipY(seat, y), radius, colour);
}

export class SpikeAttacksGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /** Read-only view for the tests and the balance harness. Never mutate through it. */
  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    const p1 = this.#askOf('p1', input, fixedDeltaSeconds);
    const p2 = this.#askOf('p2', input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, p1, p2, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  /**
   * Which way a seat is asking to walk.
   *
   * **A finger names a place, keys name a direction, and both come out as the same level.**
   * Only the sign of the ask survives, so neither family can walk faster than the other and
   * neither has a rate to win by repeating: a mashed key, a held key and a resting thumb
   * are worth exactly the same number of units a second. That is the whole of this game's
   * cross-family fairness, and it is why it need not declare `sameInputClassOnly`.
   *
   * The pointer is read in the seat's own frame, so each player's finger falls where they
   * see it fall. Keys need no such mapping — `D` is seat one's right and the right arrow is
   * seat two's right whichever way up either of them is sitting — which is what makes the
   * keyboard path two lines that cannot get the mirror wrong.
   */
  #askOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): Ask {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      return botAsk(this.#position, seat, difficulty, state, fixedDeltaSeconds, this.#rng);
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const wanted = seat === 'p1' ? pointer.x - ROW_X : BOARD_WIDTH - ROW_X - pointer.x;
      const gap = wanted - fieldOf(this.#position, seat).x;
      if (gap > POINTER_DEADZONE) return RIGHT;
      if (gap < -POINTER_DEADZONE) return LEFT;
      return 0;
    }

    const move = seatInput.move.x;
    if (move > 0) return RIGHT;
    if (move < 0) return LEFT;
    return 0;
  }

  getActiveSeat(): SeatId | null {
    // Never: both rows are live at once, so the shell keeps a pointer zone for each seat.
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
    this.#botP1 = null;
    this.#botP2 = null;
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    clearGame(this.#position);
  }

  /**
   * Draws the state as it stands.
   *
   * The interpolation alpha the contract offers is deliberately not read: a player's
   * position and the volley's timer are both continuous values the simulation already
   * carries at full resolution, so a frame is the state as it is rather than a guess
   * between two of them.
   */
  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SKY);
    this.#drawGround(renderer, 'p1');
    this.#drawGround(renderer, 'p2');
    // The two grounds meet here. Without a line the middle of the board reads as one very
    // tall sky rather than as two rows facing away from each other.
    renderer.rect(0, HALF_HEIGHT - 2, BOARD_WIDTH, 4, COLOUR_LINE);
  }

  #drawGround(renderer: Renderer, seat: SeatId): void {
    const field = fieldOf(this.#position, seat);
    const from = bearingOf(this.#position);

    fillRect(
      renderer,
      seat,
      0,
      HALF_HEIGHT,
      BOARD_WIDTH,
      HALF_HEIGHT,
      seat === 'p1' ? COLOUR_GROUND_NEAR : COLOUR_GROUND_FAR,
    );
    fillRect(renderer, seat, 0, GROUND_Y, BOARD_WIDTH, BOARD_HEIGHT - GROUND_Y, COLOUR_EARTH);

    this.#drawPockets(renderer, seat, from);
    for (let i = 0; i < SLOTS; i += 1) this.#drawStone(renderer, seat, field.stones[i] as Stone);
    this.#drawSpikes(renderer, seat, from);
    this.#drawPlayer(renderer, seat, from);
    this.#drawTelegraph(renderer, seat, from);
    this.#drawPips(renderer, seat);
  }

  /**
   * The ground that is safe, as bars under the row.
   *
   * One row of bars for the stones that hold off the left and a second for those that hold
   * off the right, drawn only for the ends this volley is actually coming from — so a
   * pincer draws both and the ground with **two** bars under it is the nook. That is the
   * whole tactical picture, told in position and count rather than in colour.
   */
  #drawPockets(renderer: Renderer, seat: SeatId, from: Bearing): void {
    const field = fieldOf(this.#position, seat);
    for (let i = 0; i < SLOTS; i += 1) {
      const stone = field.stones[i] as Stone;
      if (stone.hits <= 0) continue;
      if (stone.shields === LEFT ? from === RIGHT : from === LEFT) continue;
      const near = ROW_X + stone.x + (stone.shields === LEFT ? 0 : -POCKET);
      const y = stone.shields === LEFT ? POCKET_LEFT_Y : POCKET_RIGHT_Y;
      fillRect(renderer, seat, near, y, POCKET, POCKET_BAR, COLOUR_SAFE);
    }
  }

  /**
   * One stone.
   *
   * Rule 7 twice over, because both of a stone's facts are load-bearing and neither may
   * rest on hue. **Which end it holds off** is a buttress on that end — a shape, on a side,
   * and the only thing on the board that is not symmetric left to right. **How much of it
   * is left** is its height and the notches cut in its face, so a stone about to fail is
   * visibly shorter than a fresh one from across the room.
   */
  #drawStone(renderer: Renderer, seat: SeatId, stone: Readonly<Stone>): void {
    const x = ROW_X + stone.x;
    if (stone.hits <= 0) {
      fillRect(
        renderer,
        seat,
        x - STONE_HALF_WIDTH - 4,
        GROUND_Y - RUBBLE_HEIGHT,
        STONE_HALF_WIDTH * 2 + 8,
        RUBBLE_HEIGHT,
        COLOUR_RUBBLE,
      );
      return;
    }

    const height = STONE_BASE + STONE_PER_HIT * stone.hits;
    fillRect(
      renderer,
      seat,
      x - STONE_HALF_WIDTH,
      GROUND_Y - height,
      STONE_HALF_WIDTH * 2,
      height,
      COLOUR_STONE,
    );
    // The buttress, on the end this stone holds off.
    const side: Side = stone.shields;
    stroke(
      renderer,
      seat,
      x + side * (STONE_HALF_WIDTH + 17),
      GROUND_Y,
      x + side * STONE_HALF_WIDTH,
      GROUND_Y - height + 10,
      8,
      COLOUR_STONE_DEEP,
    );
    for (let i = 0; i < stone.hits; i += 1) {
      fillRect(renderer, seat, x - 5, GROUND_Y - 20 - i * 18, 10, 7, COLOUR_STONE_DEEP);
    }
  }

  /** The volley, sweeping the row from the end it was announced from. */
  #drawSpikes(renderer: Renderer, seat: SeatId, from: Bearing): void {
    const game = this.#position;
    const along = game.warn <= 0 ? 1 : 1 - game.timer / game.warn;
    if (from !== RIGHT) this.#drawVolley(renderer, seat, 1, along);
    if (from !== LEFT) this.#drawVolley(renderer, seat, -1, along);
  }

  #drawVolley(renderer: Renderer, seat: SeatId, heading: number, along: number): void {
    const travel = BOARD_WIDTH + 80;
    const x = heading > 0 ? -40 + along * travel : BOARD_WIDTH + 40 - along * travel;
    for (let i = 0; i < SPIKE_ROWS; i += 1) {
      const y = SPIKE_Y + i * SPIKE_GAP;
      stroke(renderer, seat, x - heading * 20, y, x + heading * 4, y, 9, COLOUR_SPIKE_DEEP);
      stroke(renderer, seat, x - heading * 4, y, x + heading * 18, y, 3, COLOUR_SPIKE);
    }
  }

  /**
   * The player.
   *
   * Rule 7: seat one is a **disc** with a chevron cut into it, seat two a **square** with
   * two bars. Two people watching one board from opposite ends both need to know which
   * figure is theirs at a glance, and a player who has just been hit needs to know whether
   * it was them — a cross says so without a word or a colour.
   *
   * A roof over the head marks a player who is currently sheltered from what is coming,
   * which is the one fact worth reading off the board at speed.
   */
  #drawPlayer(renderer: Renderer, seat: SeatId, from: Bearing): void {
    const field = fieldOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const x = ROW_X + field.x;
    const y = GROUND_Y - BODY_RADIUS - 4;
    const colour = isUp(field) ? palette.base : palette.soft;

    if (seat === 'p1') {
      disc(renderer, seat, x, y, BODY_RADIUS, colour);
      stroke(renderer, seat, x - 8, y + 4, x, y - 6, 4, palette.deep);
      stroke(renderer, seat, x, y - 6, x + 8, y + 4, 4, palette.deep);
    } else {
      fillRect(
        renderer,
        seat,
        x - BODY_RADIUS,
        y - BODY_RADIUS,
        BODY_RADIUS * 2,
        BODY_RADIUS * 2,
        colour,
      );
      fillRect(renderer, seat, x - 9, y - 7, 18, 4, palette.deep);
      fillRect(renderer, seat, x - 9, y + 3, 18, 4, palette.deep);
    }

    if (!isUp(field)) {
      stroke(renderer, seat, x - 18, y - 18, x + 18, y + 18, 5, palette.deep);
      stroke(renderer, seat, x + 18, y - 18, x - 18, y + 18, 5, palette.deep);
      return;
    }

    // Blows left, as ticks over the head: a player on their last one is carrying one tick,
    // which is a count rather than a shade and reads at a glance from either end.
    for (let i = 0; i < LIVES; i += 1) {
      const tx = x + (i - (LIVES - 1) / 2) * 13;
      fillRect(renderer, seat, tx - 4, y - 32, 8, 8, i < field.lives ? palette.base : COLOUR_MUTED);
    }

    const safeLeft = from === RIGHT || shelterAt(field, field.x, LEFT) >= 0;
    const safeRight = from === LEFT || shelterAt(field, field.x, RIGHT) >= 0;
    if (!safeLeft || !safeRight) return;
    stroke(renderer, seat, x - 15, y - 44, x, y - 56, 4, COLOUR_LINE);
    stroke(renderer, seat, x, y - 56, x + 15, y - 44, 4, COLOUR_LINE);
  }

  /**
   * What is coming, and how long there is.
   *
   * The chevrons sit at the end the spikes are coming from and point the way they travel,
   * so a pincer is two sets facing inwards and needs no legend. The bar beneath drains as
   * the volley closes — this game hides nothing and asks a decision rather than a reaction,
   * so a countdown is the honest thing to draw.
   */
  #drawTelegraph(renderer: Renderer, seat: SeatId, from: Bearing): void {
    const game = this.#position;
    if (from !== RIGHT) this.#drawChevrons(renderer, seat, 1);
    if (from !== LEFT) this.#drawChevrons(renderer, seat, -1);

    const left = ROW_X;
    const full = ROW_LENGTH;
    const share = game.warn <= 0 ? 0 : game.timer / game.warn;
    const width = share < 0 ? 0 : share > 1 ? full : share * full;
    fillRect(renderer, seat, left, TIMER_Y, full, 6, COLOUR_MUTED);
    fillRect(renderer, seat, left + (full - width) / 2, TIMER_Y, width, 6, COLOUR_SPIKE);
  }

  #drawChevrons(renderer: Renderer, seat: SeatId, heading: number): void {
    const base = heading > 0 ? ROW_X - 6 : ROW_X + ROW_LENGTH + 6;
    for (let i = 0; i < 3; i += 1) {
      const x = base + heading * i * 15;
      stroke(renderer, seat, x, TELEGRAPH_Y - 11, x + heading * 10, TELEGRAPH_Y, 4, COLOUR_SPIKE);
      stroke(renderer, seat, x + heading * 10, TELEGRAPH_Y, x, TELEGRAPH_Y + 11, 4, COLOUR_SPIKE);
    }
  }

  /** Rounds won, as pips on each player's own edge: discs for seat one, squares for seat two. */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const won = seat === 'p1' ? this.#position.p1Rounds : this.#position.p2Rounds;
    for (let i = 0; i < TARGET_ROUNDS; i += 1) {
      const x = BOARD_WIDTH / 2 + (i - (TARGET_ROUNDS - 1) / 2) * 38;
      const colour = i < won ? palette.base : COLOUR_MUTED;
      if (seat === 'p1') disc(renderer, seat, x, PIP_Y, 11, colour);
      else fillRect(renderer, seat, x - 10, PIP_Y - 10, 20, 20, colour);
    }
  }
}

/** Where the row is drawn in the near seat's frame. Exported so a test can aim a finger. */
export { ROW_X };
