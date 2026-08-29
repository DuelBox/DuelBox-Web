import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARENA,
  BLADE_HALF_LENGTH,
  BLADE_HALF_WIDTH,
  CENTRE,
  FLOOR_RADIUS,
  LASER_HALF_WIDTH,
  ROBOT_RADIUS,
  SHOT_RADIUS,
  TARGET_ROUNDS,
  botIntent,
  createBotState,
  createGame,
  driveRobot,
  resetBotState,
  resetGame,
  robotOf,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Robot Arena — one floor, two robots, and everything on it wants both of them dead.
 *
 * The board is point-symmetric and so is every hazard on it, which means there is nothing
 * to rotate: the picture is already identical from either side of the device. That is why
 * this game has no `SeatFlip` and never reads the presentation.
 */

/** A drag shorter than this is a rest, not a run. */
export const DRAG_DEADZONE = 20;

const COLOUR_VOID = '#0a0c10';
const COLOUR_FLOOR = '#171c25';
const COLOUR_RIM = '#2f3a4c';
const COLOUR_GRID = 'rgba(120, 140, 170, 0.12)';
const COLOUR_BLADE = '#c8d2e2';

const COLOUR_WARN = 'rgba(232, 97, 60, 0.42)';
const COLOUR_FIRE = '#ff7a4d';
const COLOUR_SHOT = '#e8e2c8';
const COLOUR_MUTED = 'rgba(226, 232, 244, 0.45)';

export class RobotArenaGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  /** Pre-allocated, so a step allocates nothing. */
  readonly #intent = { x: 0, y: 0 };
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
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    for (const seat of ['p1', 'p2'] as SeatId[]) {
      this.#drive(seat, input, fixedDeltaSeconds);
    }
    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  #drive(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      botIntent(
        this.#position,
        seat,
        difficulty,
        state,
        fixedDeltaSeconds,
        this.#rng,
        this.#intent,
      );
    } else {
      this.#humanIntent(seat, input);
    }
    driveRobot(robotOf(this.#position, seat), this.#intent.x, this.#intent.y, fixedDeltaSeconds);
  }

  /**
   * How a person runs.
   *
   * The **direction of the drag**, not the position of the finger — the same idiom as
   * Snake Clash, and for the same reason. The shell divides a shared board into two
   * pointer zones, so each player owns half the screen, and a robot in the far half could
   * not be pointed at. A relative drag works from anywhere in your own half, which is the
   * only place your thumb can be.
   *
   * Keys give the same thing directly, and `driveRobot` normalises both, so a diagonal is
   * not faster than a straight line for either family.
   */
  #humanIntent(seat: SeatId, input: InputState): void {
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    this.#intent.x = 0;
    this.#intent.y = 0;

    if (pointer === null) {
      this.#dragOrigin[seat] = null;
      this.#intent.x = seatInput.move.x;
      this.#intent.y = seatInput.move.y;
      return;
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
      this.#intent.x = seatInput.move.x;
      this.#intent.y = seatInput.move.y;
      return;
    }
    this.#intent.x = dx;
    this.#intent.y = dy;
  }

  getActiveSeat(): SeatId | null {
    // Never: both robots run at once, so the shell keeps its two pointer zones.
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
    resetGame(this.#position);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_VOID);
    this.#drawFloor(renderer);
    this.#drawLasers(renderer);
    this.#drawBlade(renderer);
    this.#drawShots(renderer);
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drawRobot(renderer, seat);
    this.#drawRounds(renderer);
  }

  #drawFloor(renderer: Renderer): void {
    renderer.circle(CENTRE, CENTRE, FLOOR_RADIUS, COLOUR_FLOOR);
    renderer.strokeCircle(CENTRE, CENTRE, FLOOR_RADIUS - 3, 6, COLOUR_RIM);
    // Plating, as concentric rings. Radial marks would give the blade a resting place to
    // hide against; rings are always across it.
    for (let i = 1; i <= 3; i += 1) {
      renderer.strokeCircle(CENTRE, CENTRE, (FLOOR_RADIUS * i) / 4, 2, COLOUR_GRID);
    }
  }

  #drawLasers(renderer: Renderer): void {
    for (const laser of this.#position.lasers) {
      if (!laser.active) continue;
      const width = laser.firing ? LASER_HALF_WIDTH * 2 : 6;
      const colour = laser.firing ? COLOUR_FIRE : COLOUR_WARN;
      if (laser.horizontal) renderer.rect(0, laser.at - width / 2, ARENA, width, colour);
      else renderer.rect(laser.at - width / 2, 0, width, ARENA, colour);
    }
  }

  #drawBlade(renderer: Renderer): void {
    const cos = Math.cos(this.#position.bladeAngle);
    const sin = Math.sin(this.#position.bladeAngle);
    renderer.line(
      CENTRE - cos * BLADE_HALF_LENGTH,
      CENTRE - sin * BLADE_HALF_LENGTH,
      CENTRE + cos * BLADE_HALF_LENGTH,
      CENTRE + sin * BLADE_HALF_LENGTH,
      BLADE_HALF_WIDTH * 2,
      COLOUR_BLADE,
    );
    renderer.circle(CENTRE, CENTRE, 30, COLOUR_RIM);
    renderer.strokeCircle(CENTRE, CENTRE, 20, 5, COLOUR_BLADE);
  }

  #drawShots(renderer: Renderer): void {
    for (const shot of this.#position.shots) {
      if (!shot.active) continue;
      renderer.circle(shot.x, shot.y, SHOT_RADIUS, COLOUR_SHOT);
      renderer.strokeCircle(shot.x, shot.y, SHOT_RADIUS - 5, 3, COLOUR_VOID);
    }
  }

  /**
   * Rule 7: p1 is a round robot with a single eye, p2 a square one with two.
   *
   * Two identical shapes in a shared arena, both of them running, is the case where colour
   * alone fails hardest — and a player who has just been hit needs to know at a glance
   * whether it was them.
   */
  #drawRobot(renderer: Renderer, seat: SeatId): void {
    const robot = robotOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const colour = robot.alive ? palette.base : palette.soft;

    if (seat === 'p1') {
      renderer.circle(robot.x, robot.y, ROBOT_RADIUS, colour);
      renderer.circle(robot.x, robot.y, 8, palette.deep);
    } else {
      renderer.rect(
        robot.x - ROBOT_RADIUS,
        robot.y - ROBOT_RADIUS,
        ROBOT_RADIUS * 2,
        ROBOT_RADIUS * 2,
        colour,
      );
      renderer.circle(robot.x - 9, robot.y, 6, palette.deep);
      renderer.circle(robot.x + 9, robot.y, 6, palette.deep);
    }

    // A wrecked robot gets a cross through it, so being out is legible without colour.
    if (robot.alive) return;
    renderer.line(
      robot.x - ROBOT_RADIUS,
      robot.y - ROBOT_RADIUS,
      robot.x + ROBOT_RADIUS,
      robot.y + ROBOT_RADIUS,
      5,
      palette.deep,
    );
    renderer.line(
      robot.x + ROBOT_RADIUS,
      robot.y - ROBOT_RADIUS,
      robot.x - ROBOT_RADIUS,
      robot.y + ROBOT_RADIUS,
      5,
      palette.deep,
    );
  }

  /**
   * Rounds won, as pips on each player's own side of the rim.
   *
   * Point-symmetric like everything else: p1's sit below the floor, p2's above, so each
   * player's own count is the one nearest them whichever way up they are reading it.
   */
  #drawRounds(renderer: Renderer): void {
    const spacing = 44;
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const palette = SEAT_PALETTE[seat];
      const won = seat === 'p1' ? this.#position.p1Rounds : this.#position.p2Rounds;
      const y = seat === 'p1' ? ARENA - 40 : 40;
      for (let i = 0; i < TARGET_ROUNDS; i += 1) {
        const x = CENTRE + (i - (TARGET_ROUNDS - 1) / 2) * spacing;
        const filled = i < won;
        if (seat === 'p1') renderer.circle(x, y, 13, filled ? palette.base : COLOUR_MUTED);
        else renderer.rect(x - 12, y - 12, 24, 24, filled ? palette.base : COLOUR_MUTED);
      }
    }
  }
}

export { ARENA as BOARD_WIDTH, ARENA as BOARD_HEIGHT };
