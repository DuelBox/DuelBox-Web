import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  HOLE_RADIUS,
  NET_RADIUS,
  NET_SPEED,
  SPAWNS,
  STAR_RADIUS,
  TARGET_STARS,
  botTarget,
  createBotState,
  createGame,
  driveNet,
  netOf,
  resetBotState,
  resetGame,
  starsOf,
  step,
  takenBy,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Star Catcher — two skies holding the same numbers, raced side by side.
 *
 * The rules module works in one field's coordinates, 640 by 460, and knows nothing about
 * there being two of them. This file places that field twice: the near seat's the right way
 * up, the far seat's turned half a turn about the centre of the board, so each player reads
 * their own sky upright with nothing rotated at draw time.
 */

export const BOARD_WIDTH = 640;
export const BOARD_HEIGHT = 1000;

/** Where each field's top-left corner sits on the board. */
const MARGIN_Y = (BOARD_HEIGHT / 2 - FIELD_HEIGHT) / 2;
const P1_TOP = BOARD_HEIGHT / 2 + MARGIN_Y;
const P2_TOP = MARGIN_Y;

const COLOUR_SPACE = '#080b14';
const COLOUR_SKY = '#111828';
const COLOUR_RULE = 'rgba(226, 232, 248, 0.14)';
const COLOUR_MUTED = 'rgba(226, 232, 248, 0.45)';
const COLOUR_STAR = '#ffd66b';
const COLOUR_STAR_INK = '#3a2a05';
const COLOUR_HOLE = '#1b1030';
const COLOUR_HOLE_RIM = '#7d5bd6';

/** A drag shorter than this is a rest, not a steer. */
export const DRAG_DEADZONE = 12;

/**
 * A point in one seat's field, placed on the board.
 *
 * The far seat's field is the near one turned half a turn, which is exactly how the far
 * player is turned — so both read their own sky the same way up and the renderer never
 * pushes a rotation.
 */
export function toBoard(seat: SeatId, x: number, y: number, out: { x: number; y: number }): void {
  if (seat === 'p1') {
    out.x = x;
    out.y = P1_TOP + y;
    return;
  }
  out.x = FIELD_WIDTH - x;
  out.y = P2_TOP + (FIELD_HEIGHT - y);
}

/** A point on the board, read back into one seat's field. The inverse of `toBoard`. */
export function toField(seat: SeatId, x: number, y: number, out: { x: number; y: number }): void {
  if (seat === 'p1') {
    out.x = x;
    out.y = y - P1_TOP;
    return;
  }
  out.x = FIELD_WIDTH - x;
  out.y = FIELD_HEIGHT - (y - P2_TOP);
}

export class StarCatcherGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #point = { x: 0, y: 0 };
  readonly #target = { x: 0, y: 0 };

  /**
   * Two streams, and the split is load-bearing.
   *
   * **The sky must not depend on how anybody played it.** Both bots draw from the game's
   * generator, and the number of *decisions* a tier makes depends on its reaction — `hard`
   * looks seven times as often as `easy` — so a shared stream means a different pairing
   * deals a different sky. Measured: the same tier scored 10.3 stars a match against one
   * opponent and 9.5 against another, purely from where the spawn draws landed. That also
   * means a human against a bot would fly a different sky from two bots, which makes every
   * balance number a fiction.
   *
   * `#skyRng` is seeded once from the context's generator, so it is still a pure function of
   * the match seed and nothing else. Fruit Duel's constant-draws-per-decision rule is not
   * enough on its own here: it fixes the *count* per decision, and what varies is the
   * *number of decisions*.
   */
  #skyRng = new Rng(1);
  #botRng: Record<SeatId, Rng> = { p1: new Rng(2), p2: new Rng(3) };
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    // Two independent streams from the one seed the shell gave us.
    this.#skyRng = new Rng(context.rng.next() | 0);
    this.#botRng = {
      p1: new Rng(context.rng.next() | 0),
      p2: new Rng(context.rng.next() | 0),
    };
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drive(seat, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#skyRng);
    this.#winner = winnerOf(this.#position);
  }

  #drive(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const net = netOf(this.#position, seat);
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      botTarget(
        this.#position,
        seat,
        difficulty,
        state,
        this.#botRng[seat],
        fixedDeltaSeconds,
        this.#target,
      );
      driveNet(net, this.#target.x, this.#target.y, fixedDeltaSeconds);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // An **absolute** point, not a relative drag — and it can be here because the split is
      // horizontal: each seat owns a full-width band and every part of its own sky is
      // directly under its own thumb. `driveNet` rate-limits the result, so a finger that
      // jumps across the field does not teleport the net after it.
      toField(seat, pointer.x, pointer.y, this.#point);
      driveNet(net, this.#point.x, this.#point.y, fixedDeltaSeconds);
      return;
    }

    // Keys steer at the net's own speed, so a key held down and a finger dragged cross the
    // sky in the same time.
    const move = seatInput.move;
    if (move.x === 0 && move.y === 0) return;
    const length = Math.hypot(move.x, move.y) || 1;
    const reach = NET_SPEED * fixedDeltaSeconds * 2;
    driveNet(
      net,
      net.x + (move.x / length) * reach,
      net.y + (move.y / length) * reach,
      fixedDeltaSeconds,
    );
  }

  getActiveSeat(): SeatId | null {
    // Never: both nets fly at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return { p1: this.#position.p1Stars, p2: this.#position.p2Stars, winner: this.#winner };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_SPACE);
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      this.#drawSky(renderer, seat);
      this.#drawDrifters(renderer, seat);
      this.#drawNet(renderer, seat);
      this.#drawStars(renderer, seat);
    }
    renderer.line(0, BOARD_HEIGHT / 2, BOARD_WIDTH, BOARD_HEIGHT / 2, 2, COLOUR_RULE);
  }

  #drawSky(renderer: Renderer, seat: SeatId): void {
    const top = seat === 'p1' ? P1_TOP : P2_TOP;
    renderer.rect(0, top, FIELD_WIDTH, FIELD_HEIGHT, COLOUR_SKY);
  }

  #drawDrifters(renderer: Renderer, seat: SeatId): void {
    const taken = takenBy(this.#position, seat);
    for (let i = 0; i < this.#position.drifters.length; i += 1) {
      const drifter = this.#position.drifters[i];
      if (drifter === undefined || !drifter.active || taken[i] === true) continue;
      toBoard(seat, drifter.x, drifter.y, this.#point);
      const x = this.#point.x;
      const y = this.#point.y;

      if (drifter.hole) {
        // Rule 7: a hole is a *ring* with a dark middle and a star is a solid burst, so the
        // thing you must not touch differs from the thing you want by shape and by size.
        renderer.circle(x, y, HOLE_RADIUS, COLOUR_HOLE);
        renderer.strokeCircle(x, y, HOLE_RADIUS - 4, 5, COLOUR_HOLE_RIM);
        renderer.strokeCircle(x, y, HOLE_RADIUS - 15, 3, COLOUR_HOLE_RIM);
        continue;
      }
      renderer.circle(x, y, STAR_RADIUS, COLOUR_STAR);
      // Four short spikes, so it reads as a star rather than a dot at a glance.
      for (let spike = 0; spike < 4; spike += 1) {
        const angle = (spike / 4) * Math.PI * 2;
        renderer.line(
          x + Math.cos(angle) * STAR_RADIUS,
          y + Math.sin(angle) * STAR_RADIUS,
          x + Math.cos(angle) * (STAR_RADIUS + 9),
          y + Math.sin(angle) * (STAR_RADIUS + 9),
          4,
          COLOUR_STAR,
        );
      }
      renderer.circle(x, y, 5, COLOUR_STAR_INK);
    }
  }

  /** p1's net is a ring, p2's a square frame — rule 7, and the same two seat colours. */
  #drawNet(renderer: Renderer, seat: SeatId): void {
    const net = netOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    toBoard(seat, net.x, net.y, this.#point);
    const x = this.#point.x;
    const y = this.#point.y;
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, NET_RADIUS - 3, 6, palette.base);
      renderer.strokeCircle(x, y, NET_RADIUS - 16, 3, palette.deep);
    } else {
      renderer.strokeRect(
        x - NET_RADIUS,
        y - NET_RADIUS,
        NET_RADIUS * 2,
        NET_RADIUS * 2,
        6,
        palette.base,
      );
      renderer.strokeRect(
        x - NET_RADIUS + 13,
        y - NET_RADIUS + 13,
        (NET_RADIUS - 13) * 2,
        (NET_RADIUS - 13) * 2,
        3,
        palette.deep,
      );
    }
  }

  /** Stars caught, as pips on that player's own outer edge, plus what is left to come. */
  #drawStars(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const stars = starsOf(this.#position, seat);
    const y = seat === 'p1' ? BOARD_HEIGHT - 22 : 22;
    const spacing = (BOARD_WIDTH - 160) / TARGET_STARS;
    for (let i = 0; i < TARGET_STARS; i += 1) {
      const x = 80 + i * spacing;
      const filled = i < stars;
      if (seat === 'p1') renderer.circle(x, y, 10, filled ? palette.base : COLOUR_RULE);
      else renderer.rect(x - 9, y - 9, 18, 18, filled ? palette.base : COLOUR_RULE);
    }
    // How much sky is left, as a bar on the halfway line. One object, shared.
    if (seat !== 'p1') return;
    const left = Math.max(0, 1 - this.#position.spawned / SPAWNS);
    renderer.rect(0, BOARD_HEIGHT / 2 - 3, BOARD_WIDTH * left, 6, COLOUR_MUTED);
  }
}

/** Re-exported so tests can place a point without duplicating the layout. */
export { FIELD_WIDTH, FIELD_HEIGHT, NET_RADIUS };
