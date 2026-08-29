import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BASELINE_P1,
  BASELINE_P2,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_Y,
  HEALTH,
  MATCH_SECONDS,
  MOVE_DEADZONE,
  STAGES,
  THROWER_RADIUS,
  WALL_HEALTH,
  WALL_Y,
  botCommand,
  createBotState,
  createCommand,
  createGame,
  firingSign,
  resetBotState,
  resetGame,
  stageFor,
  step,
  throwerOf,
  winnerOf,
} from './rules.js';
import type { Ball, BotDifficulty, BotState, Command, Game as Field, Stage } from './rules.js';

/**
 * Snowball Throw — one field, two ends, both players throwing at once.
 *
 * `rules.ts` holds the whole simulation in logical units. This file does three things and
 * nothing else: it turns a key or a finger into the two-field `Command` the rules read, it
 * gives each bot seat its own generator, and it draws. It never adds to the simulation — a
 * test renders forty frames at two different alphas and asserts nothing moved.
 *
 * The field is genuinely shared, so unlike a two-panel game there is no per-seat placement
 * to undo: the board is unchanged by the half-turn that separates the two players, and each
 * reads their own end as the near one. What does have to be mirrored is the movement axis —
 * the far player's left arrow is the device's right — and that happens in exactly one
 * place, {@link seatAxisSign}.
 */

const COLOUR_SNOW = '#eef3fb';
const COLOUR_GROUND = '#e2e9f4';
const COLOUR_TRACK = 'rgba(38, 52, 74, 0.14)';
const COLOUR_RULE = 'rgba(38, 52, 74, 0.30)';
const COLOUR_INK = '#26344a';
const COLOUR_ICE = '#b9cbe2';
const COLOUR_ICE_DEEP = '#7f96b4';
const COLOUR_BALL = '#ffffff';

/** Half the ice wall's drawn thickness. The simulation treats a wall as a line. */
const WALL_HALF = 8;

const SEATS: readonly SeatId[] = Object.freeze(['p1', 'p2']);

/**
 * Which way a seat's own movement axis points along the board.
 *
 * The far player sits at the top of the device and reads it upside down, so their left
 * arrow means the device's right. Every mirrored game in the catalogue does this and the
 * one that does not — pinball — has the far player's controls reversed. It applies to the
 * keys only: a finger names an **absolute** point on the glass, and a player pointing at a
 * spot means that spot whichever side of the device they are sitting on.
 */
export function seatAxisSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export class SnowballThrowGame implements Game {
  readonly #field: Field = createGame();
  readonly #command: Record<SeatId, Command> = { p1: createCommand(), p2: createCommand() };
  readonly #botState: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };

  /**
   * A generator per seat, seeded from the one the shell handed us.
   *
   * The simulation itself draws nothing at all — the field is fixed, there are no spawns,
   * and two humans play a match with no randomness in it anywhere. Only the bots draw, and
   * they draw from separate streams because the *number* of decisions a tier makes depends
   * on its reaction: `hard` looks four times as often as `easy`, so a shared stream would
   * make one seat's play a function of which tier it was sitting opposite. Star Catcher
   * measured that at 1.4 points of win rate.
   */
  #rng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #difficulty: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };

  /**
   * Swallow the release that a pause manufactures.
   *
   * `InputManager.clear()` drops every live pointer and key, which surfaces as an ordinary
   * `actionReleased` on the first step after the shell resumes — the engine cannot yet tell
   * a cancelled gesture from a deliberate lift (`docs/input-idiom.md`, missing primitive 1).
   * Without this, opening the pause menu mid-walk throws a snowball on the way back.
   */
  readonly #eatRelease: Record<SeatId, boolean> = { p1: false, p2: false };

  /** Read-only view for tests and the balance harness. Never mutate through it. */
  get field(): Readonly<Field> {
    return this.#field;
  }

  init(context: GameContext): void {
    this.#rng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#difficulty = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      resetBotState(this.#botState[seat]);
      this.#command[seat].dir = 0;
      this.#command[seat].release = false;
      this.#eatRelease[seat] = false;
    }
    resetGame(this.#field);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#field.winner !== null) return;
    for (let i = 0; i < SEATS.length; i += 1) {
      this.#read(SEATS[i] as SeatId, input, fixedDeltaSeconds);
    }
    step(this.#field, fixedDeltaSeconds, this.#command.p1, this.#command.p2);
    this.#eatRelease.p1 = false;
    this.#eatRelease.p2 = false;
  }

  /**
   * One seat's intent for this step.
   *
   * Two spellings of one thing. A finger says **where** to stand and the thrower walks
   * there at `MOVE_SPEED`; a key says **which way** and it walks at `MOVE_SPEED`. Neither
   * can move it faster than the other, and neither can name a position the other cannot —
   * the only quantity either produces is the sign of a gap.
   */
  #read(seat: SeatId, input: InputState, dt: number): void {
    const command = this.#command[seat];
    const difficulty = this.#difficulty[seat];
    if (difficulty !== null) {
      botCommand(this.#field, seat, difficulty, this.#botState[seat], this.#rng[seat], dt, command);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // Absolute, and it can be: a horizontal split gives each seat a full-width band, so
      // every point along its own line is directly under its own thumb.
      const gap = pointer.x - throwerOf(this.#field, seat).x;
      command.dir = Math.abs(gap) <= MOVE_DEADZONE ? 0 : gap > 0 ? 1 : -1;
    } else {
      const axis = seatInput.move.x * seatAxisSign(seat);
      command.dir = axis > 0 ? 1 : axis < 0 ? -1 : 0;
    }
    command.release = seatInput.actionReleased && !this.#eatRelease[seat];
  }

  onPause(): void {
    this.#eatRelease.p1 = true;
    this.#eatRelease.p2 = true;
  }

  onResume(): void {
    this.#eatRelease.p1 = true;
    this.#eatRelease.p2 = true;
  }

  getScore(): MatchScore {
    return { p1: this.#field.p1.health, p2: this.#field.p2.health, winner: winnerOf(this.#field) };
  }

  destroy(): void {
    resetGame(this.#field);
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    renderer.clear(COLOUR_SNOW);
    renderer.rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT, COLOUR_GROUND);
    this.#drawClock(renderer);
    this.#drawBaselines(renderer);
    this.#drawWalls(renderer);
    for (let i = 0; i < this.#field.balls.length; i += 1) {
      this.#drawBall(renderer, this.#field.balls[i] as Ball, alpha);
    }
    for (let i = 0; i < SEATS.length; i += 1) {
      this.#drawThrower(renderer, SEATS[i] as SeatId, alpha);
      this.#drawHealth(renderer, SEATS[i] as SeatId);
    }
  }

  /**
   * How much of the match is left, as a bar down the left edge that drains from both ends
   * toward the middle. One object, shared by both players and unchanged by the half-turn,
   * so neither of them is reading a clock the other cannot.
   */
  #drawClock(renderer: Renderer): void {
    const top = 40;
    const length = BOARD_HEIGHT - top * 2;
    const left = Math.max(0, Math.min(1, this.#field.clock / MATCH_SECONDS));
    renderer.rect(14, top, 7, length, COLOUR_TRACK);
    renderer.rect(14, CENTRE_Y - (length * left) / 2, 7, length * left, COLOUR_RULE);
  }

  /** One rule under the near line, two under the far one: the seats differ in greyscale. */
  #drawBaselines(renderer: Renderer): void {
    const p1 = SEAT_PALETTE.p1;
    const p2 = SEAT_PALETTE.p2;
    renderer.rect(0, BASELINE_P1 - 6, BOARD_WIDTH, BOARD_HEIGHT - BASELINE_P1 + 6, p1.tint);
    renderer.rect(0, 0, BOARD_WIDTH, BASELINE_P2 + 6, p2.tint);
    renderer.line(0, BASELINE_P1 + 44, BOARD_WIDTH, BASELINE_P1 + 44, 4, p1.deep);
    renderer.line(0, BASELINE_P2 - 44, BOARD_WIDTH, BASELINE_P2 - 44, 4, p2.deep);
    renderer.line(0, BASELINE_P2 - 56, BOARD_WIDTH, BASELINE_P2 - 56, 4, p2.deep);
  }

  /**
   * The ice, drawn as the blocks it has left.
   *
   * A wall's remaining ice is the count of solid blocks, not a colour and not a number, so
   * it survives greyscale. Both walls erode from the middle of the field outwards, which
   * keeps the picture symmetric under the half-turn.
   */
  #drawWalls(renderer: Renderer): void {
    for (let w = 0; w < this.#field.walls.length; w += 1) {
      const wall = this.#field.walls[w];
      if (wall === undefined) continue;
      const width = (wall.x2 - wall.x1) / WALL_HEALTH;
      for (let block = 0; block < WALL_HEALTH; block += 1) {
        // Block 0 is the end nearer the middle of the field for both walls.
        const fromCentre = wall.x1 < BOARD_WIDTH / 2 ? WALL_HEALTH - 1 - block : block;
        const x = wall.x1 + fromCentre * width;
        if (block < wall.chips) {
          renderer.rect(x + 1, WALL_Y - WALL_HALF, width - 2, WALL_HALF * 2, COLOUR_ICE);
          renderer.strokeRect(
            x + 1,
            WALL_Y - WALL_HALF,
            width - 2,
            WALL_HALF * 2,
            2,
            COLOUR_ICE_DEEP,
          );
        } else {
          renderer.strokeRect(x + 3, WALL_Y - 4, width - 6, 8, 2, COLOUR_TRACK);
        }
      }
    }
  }

  #drawBall(renderer: Renderer, ball: Readonly<Ball>, alpha: number): void {
    if (!ball.active) return;
    const size = STAGES[ball.stage] as Stage;
    const x = ball.prevX + (ball.x - ball.prevX) * alpha;
    const y = ball.prevY + (ball.y - ball.prevY) * alpha;
    this.#drawSnowball(renderer, x, y, ball.stage, ball.owner);
    // The hook, as a tick on the side the ball is curving toward. Drawn because the bot
    // reads the curve, and rule 6 says it may only read what a player can see.
    if (ball.ax !== 0) {
      const way = ball.ax > 0 ? 1 : -1;
      renderer.line(
        x + way * size.radius,
        y,
        x + way * (size.radius + 10),
        y,
        4,
        SEAT_PALETTE[ball.owner].deep,
      );
    }
  }

  /**
   * A snowball: white, with its size shown by its size and by the rings inside it, and its
   * thrower by the shape at its centre — round for the near seat, square for the far one.
   */
  #drawSnowball(renderer: Renderer, x: number, y: number, stage: number, owner: SeatId): void {
    const size = STAGES[stage] as Stage;
    const palette = SEAT_PALETTE[owner];
    renderer.circle(x, y, size.radius, COLOUR_BALL);
    renderer.strokeCircle(x, y, size.radius - 1, 3, COLOUR_INK);
    for (let ring = 0; ring < stage; ring += 1) {
      renderer.strokeCircle(x, y, size.radius - 5 - ring * 5, 2, COLOUR_INK);
    }
    if (owner === 'p1') renderer.circle(x, y, 4, palette.base);
    else renderer.rect(x - 4, y - 4, 8, 8, palette.base);
  }

  #drawThrower(renderer: Renderer, seat: SeatId, alpha: number): void {
    const thrower = throwerOf(this.#field, seat);
    const palette = SEAT_PALETTE[seat];
    const x = thrower.prevX + (thrower.x - thrower.prevX) * alpha;
    const y = seat === 'p1' ? BASELINE_P1 : BASELINE_P2;
    const sign = firingSign(seat);

    if (thrower.flash > 0) {
      renderer.strokeCircle(x, y, THROWER_RADIUS + 6 + thrower.flash * 40, 4, palette.deep);
    }

    // Rule 7: the near seat is round and the far seat is square, everywhere in this game —
    // on the thrower, on the mark inside every snowball it throws, and on its health pips.
    if (seat === 'p1') {
      renderer.circle(x, y, THROWER_RADIUS, palette.base);
      renderer.strokeCircle(x, y, THROWER_RADIUS - 2, 4, COLOUR_INK);
      renderer.strokeCircle(x, y, THROWER_RADIUS - 12, 3, COLOUR_INK);
    } else {
      renderer.rect(
        x - THROWER_RADIUS,
        y - THROWER_RADIUS,
        THROWER_RADIUS * 2,
        THROWER_RADIUS * 2,
        palette.base,
      );
      renderer.strokeRect(
        x - THROWER_RADIUS + 2,
        y - THROWER_RADIUS + 2,
        THROWER_RADIUS * 2 - 4,
        THROWER_RADIUS * 2 - 4,
        4,
        COLOUR_INK,
      );
      renderer.strokeRect(x - 12, y - 12, 24, 24, 3, COLOUR_INK);
    }

    this.#drawPacking(renderer, seat, x, y, sign);
  }

  /**
   * What is in this player's hands: the snowball they have packed so far, three pips for
   * the sizes reached, a bar for the progress to the next, and a chevron for the lean the
   * next throw would carry.
   *
   * All four are shapes. A player can read their own size, their opponent's size, and
   * which way each of them is about to hook, with no colour at all.
   */
  #drawPacking(renderer: Renderer, seat: SeatId, x: number, y: number, sign: number): void {
    const thrower = throwerOf(this.#field, seat);
    const stage = stageFor(thrower.ready);
    const held = y + sign * (THROWER_RADIUS + 20);

    if (stage < 0) {
      const first = STAGES[0] as Stage;
      const growing = Math.min(1, thrower.ready / first.windUp);
      renderer.circle(x, held, 3 + growing * (first.radius - 3), COLOUR_BALL);
      renderer.strokeCircle(x, held, 2 + growing * (first.radius - 3), 2, COLOUR_TRACK);
    } else {
      this.#drawSnowball(renderer, x, held, stage, seat);
      if (thrower.dir !== 0) {
        const size = STAGES[stage] as Stage;
        const way = thrower.dir;
        renderer.line(x, held, x + way * (size.radius + 14), held, 5, COLOUR_INK);
        renderer.line(
          x + way * (size.radius + 14),
          held,
          x + way * (size.radius + 4),
          held - 8,
          5,
          COLOUR_INK,
        );
        renderer.line(
          x + way * (size.radius + 14),
          held,
          x + way * (size.radius + 4),
          held + 8,
          5,
          COLOUR_INK,
        );
      }
    }

    // Three pips behind the thrower, filled up to the size in hand.
    const pipY = y - sign * (THROWER_RADIUS + 14);
    for (let i = 0; i < STAGES.length; i += 1) {
      const pipX = x - 20 + i * 20;
      if (i <= stage) renderer.circle(pipX, pipY, 5, COLOUR_INK);
      else renderer.strokeCircle(pipX, pipY, 5, 2, COLOUR_TRACK);
    }
    // And how far along to the next size, so waiting is a decision and not a guess.
    if (stage < STAGES.length - 1) {
      const from = stage < 0 ? 0 : (STAGES[stage] as Stage).windUp;
      const to = (STAGES[stage + 1] as Stage).windUp;
      const along = Math.max(0, Math.min(1, (thrower.ready - from) / (to - from)));
      renderer.rect(x - 30, pipY - sign * 12 - 2, 60, 4, COLOUR_TRACK);
      renderer.rect(x - 30, pipY - sign * 12 - 2, 60 * along, 4, COLOUR_INK);
    }
  }

  /** Health as pips on that player's own outer edge: circles for p1, squares for p2. */
  #drawHealth(renderer: Renderer, seat: SeatId): void {
    const thrower = throwerOf(this.#field, seat);
    const palette = SEAT_PALETTE[seat];
    const y = seat === 'p1' ? BOARD_HEIGHT - 22 : 22;
    const spacing = (BOARD_WIDTH - 120) / (HEALTH - 1);
    for (let i = 0; i < HEALTH; i += 1) {
      const x = 60 + i * spacing;
      const left = i < thrower.health;
      if (seat === 'p1') {
        if (left) renderer.circle(x, y, 9, palette.base);
        else renderer.strokeCircle(x, y, 8, 3, COLOUR_TRACK);
      } else if (left) {
        renderer.rect(x - 9, y - 9, 18, 18, palette.base);
      } else {
        renderer.strokeRect(x - 8, y - 8, 16, 16, 3, COLOUR_TRACK);
      }
    }
  }
}
