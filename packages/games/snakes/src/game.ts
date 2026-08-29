import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  HEAD_RADIUS,
  PELLET_RADIUS,
  PELLET_TARGET,
  ROUND_SECONDS,
  TURN_RATE,
  WALL,
  botSteer,
  callStalemate,
  createGame,
  headOf,
  normaliseAngle,
  resetGame,
  snakeOf,
  steer,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/** A drag shorter than this is a rest, not a steer. */
export const DRAG_DEADZONE = 22;

const COLOUR_BACKGROUND = '#0d1117';
const COLOUR_ARENA = '#151d29';
const COLOUR_WALL = '#2b3a4f';
const COLOUR_PELLET = '#ffd166';
const COLOUR_PELLET_INK = '#0d1117';
const COLOUR_TEXT = '#e6edf6';
const COLOUR_MUTED = 'rgba(230, 237, 246, 0.55)';

const SETTLE_SECONDS = 1.2;

export class SnakesGame implements Game {
  readonly #position: Position = createGame();
  /** Where each seat's current drag began, or null when nothing is down. */
  readonly #dragOrigin: Record<SeatId, Vec2 | null> = { p1: null, p2: null };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #settleSteps = 0;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#settleSteps = 0;
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    resetGame(this.#position, this.#rng);
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
      steer(snakeOf(this.#position, seat), amount, fixedDeltaSeconds);
    }

    step(this.#position, fixedDeltaSeconds, this.#rng);

    // Two cautious snakes circling their own halves would never meet, and nothing else
    // would end such a round: `roundSeconds` is read only by the catalogue card.
    if (this.#position.elapsed >= ROUND_SECONDS) callStalemate(this.#position);
  }

  /**
   * How a person steers.
   *
   * The direction of the **drag**, not the position of the finger. Put a thumb down
   * anywhere and pull the way you want to go; the snake turns toward that direction.
   *
   * Pointing at an absolute spot was the obvious first try and it does not work here: the
   * shell divides a shared board into two pointer zones, so each player owns half the
   * screen, and a player whose snake is in the far half could not point ahead of it. A
   * relative drag works from anywhere in your own half, which is the only place your
   * thumb can be.
   */
  #humanSteer(seat: SeatId, input: InputState): number {
    const seatInput = input.seat(seat);
    const snake = snakeOf(this.#position, seat);
    const pointer = seatInput.pointer;

    if (pointer === null) {
      this.#dragOrigin[seat] = null;
      // Keys steer directly: left and right turn, and that is the whole control.
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

    const wanted = normaliseAngle(Math.atan2(dy, dx) - snake.heading);
    const amount = wanted / (TURN_RATE / 60);
    return amount < -1 ? -1 : amount > 1 ? 1 : amount;
  }

  getActiveSeat(): SeatId | null {
    // Never: both snakes move at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.p1.eaten,
      p2: this.#position.p2.eaten,
      winner: this.#matchWinner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position, this.#rng);
    this.#matchWinner = null;
    this.#settleSteps = 0;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawArena(renderer);
    this.#drawPellets(renderer);
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drawSnake(renderer, seat);
    this.#drawStatus(renderer);
  }

  #drawArena(renderer: Renderer): void {
    renderer.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT, COLOUR_WALL);
    renderer.rect(WALL, WALL, ARENA_WIDTH - WALL * 2, ARENA_HEIGHT - WALL * 2, COLOUR_ARENA);
  }

  #drawPellets(renderer: Renderer): void {
    for (const pellet of this.#position.pellets) {
      renderer.circle(pellet.x, pellet.y, PELLET_RADIUS, COLOUR_PELLET);
      renderer.strokeCircle(pellet.x, pellet.y, PELLET_RADIUS - 4, 3, COLOUR_PELLET_INK);
    }
  }

  /**
   * Rule 7: p1 is a solid body with a ringed head, p2 is drawn with a bar across every
   * segment. Two snakes crossing each other have to be readable with the colour gone, and
   * they are the two things most likely to be tangled together on screen.
   */
  #drawSnake(renderer: Renderer, seat: SeatId): void {
    const snake = snakeOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const body = snake.body;

    for (let i = body.length - 1; i >= 1; i -= 1) {
      const point = body[i];
      if (point === undefined) continue;
      // Tapering, so which end is the head is never in doubt.
      const radius = HEAD_RADIUS * (0.55 + 0.35 * (1 - i / body.length));
      renderer.circle(point.x, point.y, radius, snake.alive ? palette.base : palette.soft);
      if (seat === 'p2') renderer.rect(point.x - radius, point.y - 2, radius * 2, 4, palette.deep);
    }

    const head = headOf(snake);
    renderer.circle(head.x, head.y, HEAD_RADIUS, snake.alive ? palette.base : palette.soft);
    if (seat === 'p1') renderer.strokeCircle(head.x, head.y, HEAD_RADIUS - 4, 4, palette.deep);
    else renderer.rect(head.x - HEAD_RADIUS, head.y - 4, HEAD_RADIUS * 2, 8, palette.deep);

    // Which way it is pointing, so a player can read their own heading at a glance.
    if (snake.alive) {
      renderer.line(
        head.x,
        head.y,
        head.x + Math.cos(snake.heading) * HEAD_RADIUS * 2.2,
        head.y + Math.sin(snake.heading) * HEAD_RADIUS * 2.2,
        3,
        palette.deep,
      );
    }
  }

  #drawStatus(renderer: Renderer): void {
    const p1 = this.#position.p1.eaten;
    const p2 = this.#position.p2.eaten;
    renderer.text(
      `${String(p1)} — ${String(p2)}   first to ${String(PELLET_TARGET)}`,
      ARENA_WIDTH / 2,
      WALL + 34,
      28,
      COLOUR_MUTED,
      'centre',
    );

    // The round clock, as a bar along the foot of the arena.
    const left = Math.max(0, Math.min(1, 1 - this.#position.elapsed / ROUND_SECONDS));
    const width = ARENA_WIDTH - WALL * 2;
    renderer.rect(WALL, ARENA_HEIGHT - WALL - 8, width * left, 6, COLOUR_TEXT);
  }
}
