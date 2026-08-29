import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARENA,
  CRATE_ARMOUR,
  CRATE_HALF,
  LIVES,
  LOAD_FULL,
  SHELLS,
  SHELL_RADIUS,
  TANK_RADIUS,
  botIntent,
  createBotState,
  createGame,
  resetBotState,
  resetGame,
  setIntent,
  step,
  tankOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position, Intent } from './rules.js';

/**
 * Tanks — one yard, two tanks, and cover that is spent as it is used.
 *
 * The rules module holds the whole simulation in yard units. What lives here is how a
 * person expresses an order through it, and how the yard is drawn.
 *
 * **Nothing is rotated at draw time and nothing needs to be.** The yard is point-symmetric,
 * so the picture is already the same from either side of the device, and the two things
 * that are not symmetric — the tanks — are each drawn in their own orientation because a
 * tank's heading is what the player is reading. That is why this file never touches
 * `pushRotation` and never reads the presentation.
 */

/** A drag shorter than this on an axis is a resting thumb, not an order. */
export const DRAG_DEADZONE = 26;

const SEATS: readonly SeatId[] = ['p1', 'p2'];

const COLOUR_GROUND = '#141b16';
const COLOUR_YARD = '#1d2720';
const COLOUR_LINE = 'rgba(214, 232, 219, 0.12)';
const COLOUR_MUTED = 'rgba(214, 232, 219, 0.4)';
const COLOUR_CRATE = '#7a6134';
const COLOUR_CRATE_DEEP = '#4a3a1c';
const COLOUR_CRACK = '#20180a';
const COLOUR_SHELL = '#ffe6a3';
const COLOUR_INK = '#0d120f';

/** Render-only: how long a barrel is drawn, as a multiple of the hull. */
const BARREL = 1.5;

export class TanksGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  /** Pre-allocated, so a step allocates nothing. */
  readonly #intent: Intent = { turn: 0, throttle: 0 };
  readonly #dragOrigin: Record<SeatId, Vec2 | null> = { p1: null, p2: null };

  /**
   * Three streams, and the split is load-bearing in two different ways.
   *
   * **The yard must not depend on how anybody played it.** The crate deal and every respawn
   * pad come from `#worldRng`, seeded once from the match seed, so what a player is dealt is
   * a function of the seed and nothing else. On a stream shared with the bots it would not
   * be: the number of *decisions* a tier makes depends on its reaction — `hard` looks about
   * five times as often as `easy` — so a different pairing would deal a different yard, and
   * a human against a bot would fight in a yard none of the balance figures were measured
   * in.
   *
   * **And each seat has a stream of its own**, which is the half that is easy to miss.
   * Drawing a constant number of values per decision fixes the *count* and not the *order*:
   * whichever seat is polled first still takes the earlier value from a shared stream every
   * time. With a stream each, the poll order is not observable at all, and `rules.test.ts`
   * asserts exactly that by running the two calls in both orders and comparing bit for bit.
   */
  #worldRng = new Rng(1);
  #botRng: Record<SeatId, Rng> = { p1: new Rng(2), p2: new Rng(3) };
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    // Three independent streams from the one seed the shell gave us, drawn in a fixed
    // order so the match still replays exactly.
    this.#worldRng = new Rng(context.rng.next() | 0);
    this.#botRng = {
      p1: new Rng(context.rng.next() | 0),
      p2: new Rng(context.rng.next() | 0),
    };
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#dragOrigin.p1 = null;
    this.#dragOrigin.p2 = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#worldRng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    for (const seat of SEATS) this.#order(seat, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, this.#worldRng);
    this.#winner = winnerOf(this.#position);
  }

  #order(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      botIntent(
        this.#position,
        seat,
        difficulty,
        seat === 'p1' ? this.#botP1State : this.#botP2State,
        this.#botRng[seat],
        fixedDeltaSeconds,
        this.#intent,
      );
    } else {
      this.#humanIntent(seat, input);
    }
    setIntent(this.#position, seat, this.#intent.turn, this.#intent.throttle);
  }

  /**
   * How a person gives an order, and why the two instruments cannot be told apart.
   *
   * A key gives a direction; a thumb gives the **direction of a drag**, not the position of
   * a finger. Relative rather than absolute for the reason every shared-board game in this
   * collection is: the shell divides one surface into two pointer zones, so a thumb is only
   * ever in its own half and the tank it is driving is as likely as not in the other one.
   *
   * Both then collapse to the same pair of signs. That is the whole of rule 10 here, and it
   * is why the parity test can assert an *equality* between a key-driven match and a
   * thumb-driven one rather than a tolerance: there is no gesture either instrument can make
   * that the other cannot, and no order finer than turn-left, turn-right, forward, back.
   *
   * An absolute pointer would have broken it outright. Pointing at a spot on the yard would
   * let a thumb stop the gun exactly on a bearing, where a key can only stop it by letting
   * go at the right moment — worth roughly a fifth of a second of reaction, which at 2.4
   * radians a second is thirty degrees of aim a keyboard could never match.
   */
  #humanIntent(seat: SeatId, input: InputState): void {
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer === null) {
      this.#dragOrigin[seat] = null;
      this.#intent.turn = seatInput.move.x;
      this.#intent.throttle = -seatInput.move.y;
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
    const turn = Math.abs(dx) > DRAG_DEADZONE ? Math.sign(dx) : 0;
    const throttle = Math.abs(dy) > DRAG_DEADZONE ? -Math.sign(dy) : 0;
    if (turn === 0 && throttle === 0) {
      // A thumb resting inside the deadzone is not an order, so it must not silence the
      // keys — one player may well be using both.
      this.#intent.turn = seatInput.move.x;
      this.#intent.throttle = -seatInput.move.y;
      return;
    }
    this.#intent.turn = turn;
    this.#intent.throttle = throttle;
  }

  getActiveSeat(): SeatId | null {
    // Never: both tanks roll at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    // Lives *taken*, so the number a player watches goes up. Lives remaining would read
    // backwards on the shell's scoreboard, which counts up for everything else.
    return {
      p1: LIVES - this.#position.p2.lives,
      p2: LIVES - this.#position.p1.lives,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position, this.#worldRng);
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
    renderer.clear(COLOUR_GROUND);
    renderer.rect(0, 0, ARENA, ARENA, COLOUR_YARD);
    // The centre line, which is the only mark that says the yard is point-symmetric.
    renderer.line(0, ARENA / 2, ARENA, ARENA / 2, 2, COLOUR_LINE);
    renderer.strokeCircle(ARENA / 2, ARENA / 2, 40, 2, COLOUR_LINE);
    this.#drawCrates(renderer);
    this.#drawShells(renderer);
    for (const seat of SEATS) this.#drawTank(renderer, seat);
    for (const seat of SEATS) this.#drawTally(renderer, seat);
  }

  /**
   * A crate reads by shape and by size, never by shade: it shrinks as it is knocked about
   * and gains one countable crack for each shell it has taken. Rule 7, and it is also the
   * only information a player has to read while driving.
   */
  #drawCrates(renderer: Renderer): void {
    for (const crate of this.#position.crates) {
      if (crate.armour <= 0) continue;
      const worn = (CRATE_ARMOUR - crate.armour) / CRATE_ARMOUR;
      const half = CRATE_HALF * (1 - worn * 0.22);
      renderer.rect(crate.x - half, crate.y - half, half * 2, half * 2, COLOUR_CRATE);
      renderer.strokeRect(crate.x - half, crate.y - half, half * 2, half * 2, 4, COLOUR_CRATE_DEEP);
      for (let i = 0; i < CRATE_ARMOUR - crate.armour; i += 1) {
        const offset = (i + 1) * ((half * 2) / (CRATE_ARMOUR + 1)) - half;
        renderer.line(
          crate.x - half,
          crate.y + offset,
          crate.x + half,
          crate.y + offset - half * 0.5,
          5,
          COLOUR_CRACK,
        );
      }
    }
  }

  /** Seat one's shells are discs, seat two's are diamonds drawn as tilted bars. */
  #drawShells(renderer: Renderer): void {
    for (const shell of this.#position.shells) {
      if (!shell.active) continue;
      const palette = SEAT_PALETTE[shell.owner === 0 ? 'p1' : 'p2'];
      if (shell.owner === 0) {
        renderer.circle(shell.x, shell.y, SHELL_RADIUS, COLOUR_SHELL);
        renderer.circle(shell.x, shell.y, SHELL_RADIUS - 3, palette.deep);
      } else {
        renderer.rect(
          shell.x - SHELL_RADIUS,
          shell.y - SHELL_RADIUS,
          SHELL_RADIUS * 2,
          SHELL_RADIUS * 2,
          COLOUR_SHELL,
        );
        renderer.rect(
          shell.x - SHELL_RADIUS + 3,
          shell.y - SHELL_RADIUS + 3,
          (SHELL_RADIUS - 3) * 2,
          (SHELL_RADIUS - 3) * 2,
          palette.deep,
        );
      }
    }
  }

  /**
   * Seat one is a round hull, seat two a square one — rule 7, and the same two seat colours.
   * The barrel says which way the gun is pointing and the bar behind the hull says how much
   * is in it, both by shape rather than by shade.
   */
  #drawTank(renderer: Renderer, seat: SeatId): void {
    const tank = tankOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const nose = Math.cos(tank.heading);
    const rise = Math.sin(tank.heading);

    renderer.line(
      tank.x,
      tank.y,
      tank.x + nose * TANK_RADIUS * BARREL,
      tank.y + rise * TANK_RADIUS * BARREL,
      9,
      palette.deep,
    );
    if (seat === 'p1') {
      renderer.circle(tank.x, tank.y, TANK_RADIUS, palette.base);
      renderer.strokeCircle(tank.x, tank.y, TANK_RADIUS - 6, 3, COLOUR_INK);
    } else {
      renderer.rect(
        tank.x - TANK_RADIUS,
        tank.y - TANK_RADIUS,
        TANK_RADIUS * 2,
        TANK_RADIUS * 2,
        palette.base,
      );
      renderer.rect(tank.x - TANK_RADIUS + 6, tank.y - 3, (TANK_RADIUS - 6) * 2, 6, COLOUR_INK);
    }

    // How much is in the gun, as a bar across the back of the hull.
    const load = Math.min(1, tank.load / LOAD_FULL);
    if (load > 0) {
      const span = TANK_RADIUS * 1.6 * load;
      renderer.line(
        tank.x - rise * span - nose * TANK_RADIUS,
        tank.y + nose * span - rise * TANK_RADIUS,
        tank.x + rise * span - nose * TANK_RADIUS,
        tank.y - nose * span - rise * TANK_RADIUS,
        6,
        COLOUR_SHELL,
      );
    }
    // Respawn grace, as a ring nobody can mistake for the hull.
    if (tank.shield > 0) renderer.strokeCircle(tank.x, tank.y, TANK_RADIUS + 9, 3, COLOUR_MUTED);
  }

  /** Lives as pips on that player's own edge, and what is left in the ammunition rack. */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const tank = tankOf(this.#position, seat);
    const y = seat === 'p1' ? ARENA - 20 : 20;
    for (let i = 0; i < LIVES; i += 1) {
      const x = 30 + i * 34;
      const held = i < tank.lives;
      if (seat === 'p1') renderer.circle(x, y, 11, held ? palette.base : COLOUR_LINE);
      else renderer.rect(x - 10, y - 10, 20, 20, held ? palette.base : COLOUR_LINE);
    }
    const left = Math.max(0, tank.shells / SHELLS);
    const width = (ARENA - 200) * left;
    renderer.rect(seat === 'p1' ? 160 : ARENA - 160 - width, y - 4, width, 8, COLOUR_MUTED);
  }
}
