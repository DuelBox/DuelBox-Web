import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CATCH_RADIUS,
  CENTRE_Y,
  COIN_RADIUS,
  DRAG_DEADZONE,
  DRAG_LEASH,
  FLASH_SECONDS,
  HOME_BACK,
  MATCH_SECONDS,
  RUNNER_RADIUS,
  SEATS,
  VAULT_FAR,
  VAULT_INSET_X,
  VAULT_NEAR,
  WALL,
  botCommand,
  clamp,
  createBotState,
  createCommand,
  createGame,
  homeX,
  homeY,
  resetBotState,
  resetGame,
  runnerOf,
  seatAxisSign,
  sideOf,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Coin, Command, Game as Field } from './rules.js';

/**
 * Guard and Thief — two vaults, two runners, and one door between them.
 *
 * `rules.ts` holds the whole simulation in logical units. This file does three things and
 * nothing else: it turns a key or a finger into the {@link Command} the rules read, it
 * gives each bot seat its own generator, and it draws. It never adds to the simulation —
 * a test renders the same frame at five alphas and asserts nothing moved.
 *
 * ## The pointer is an anchored drag, and this is the one place the archetype's default
 * ## does not fit
 *
 * `docs/input-idiom.md` makes an absolute binding the default for `rt-split`, on the
 * stated grounds that a horizontal split gives each seat a full-width band so "every point
 * that seat may want to name is under its own thumb". In this game that premise is simply
 * false: a runner's whole job is to cross into the *other* seat's band, and a seat may
 * only start a gesture in its own. An absolute binding therefore has the reachability hole
 * the same document describes for `rt-arena` — a raiding player could never steer their
 * runner further away from themselves.
 *
 * So the binding is the exception the document permits: an anchored drag. What is new here
 * is that the anchor contributes nothing continuous. The displacement from the press point
 * is reduced to **the sign of the gap on each axis**, exactly as Frozen Beaks reduces an
 * absolute pointer, and lands on the identical nine headings a keyboard produces. See
 * SPEC.md.
 *
 * ## A direction on the glass is not mirrored; a key is
 *
 * The far seat reads the device upside down, so its own left arrow is the device's right
 * and `move` is multiplied by {@link seatAxisSign}. A *drag* is not, and the difference is
 * not an oversight: a key is a label and a drag is a physical displacement, and the far
 * player's hand is rotated by exactly the same half-turn their eyes are. Dragging away
 * from yourself means away from yourself for either player without anything being done to
 * it. A test drives both seats through a real `InputManager` and asserts each.
 */

const COLOUR_FLOOR = '#161b2a';
const COLOUR_VAULT = '#232b41';
const COLOUR_EDGE = '#3b4763';
const COLOUR_INK = '#e9edf7';
const COLOUR_TRACK = 'rgba(233, 237, 247, 0.20)';
const COLOUR_DOOR = 'rgba(233, 237, 247, 0.32)';
const COLOUR_COIN = '#f2c14e';
const COLOUR_COIN_EDGE = '#8a6410';

/** How many banked coins fill a tally bar. A length, never a number — this game draws no text. */
const TALLY_FULL = 30;

/** The most carry pips drawn over a head. Beyond it the stack stops growing, not the loot. */
const PIPS_SHOWN = 6;

/** How far the carry pips sit in front of a runner's head, toward the middle of the device. */
const PIP_LIFT = RUNNER_RADIUS + 13;

interface Anchor {
  x: number;
  y: number;
  active: boolean;
}

export class GuardandThiefGame implements Game {
  readonly #field: Field = createGame();
  readonly #command: Record<SeatId, Command> = { p1: createCommand(), p2: createCommand() };
  readonly #botState: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  /** Where each seat's drag began. Game-side state, because the engine keeps no origin. */
  readonly #anchor: Record<SeatId, Anchor> = {
    p1: { x: 0, y: 0, active: false },
    p2: { x: 0, y: 0, active: false },
  };

  /**
   * A generator per seat, plus one for the layout, all seeded from the one the shell gave
   * us.
   *
   * The restock cycle is drawn once, before the match, and after that the simulation draws
   * nothing at all — two humans play a match with no randomness in it anywhere. Only the
   * bots draw, and they draw from separate streams because the *number* of decisions a
   * tier makes depends on its thinking interval, so a shared stream would make one seat's
   * play a function of which tier was sitting opposite.
   *
   * It is also what keeps the seat balance structural rather than lucky: exchanging the
   * two seats' generators plays the exact mirror of the same match, so a paired seed
   * decides both seats once. See SPEC.md.
   */
  #rng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #difficulty: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };

  /** Read-only view for tests and the balance harness. Never mutate through it. */
  get field(): Readonly<Field> {
    return this.#field;
  }

  init(context: GameContext): void {
    const layout = new Rng(context.rng.next() | 0);
    // **The opening seat names which stream goes to which seat, and that is the whole use a
    // real-time game has for it.**
    //
    // The contract says a real-time game may ignore `openingSeat`, and there is nothing here
    // for an opener to name — both runners start on identical floors at mirror-image points,
    // and inventing a first move would manufacture the advantage the symmetry exists to
    // remove. But the SDK alternates it across the rounds of a best-of *so that any residual
    // seat asymmetry washes out*, and there is exactly one thing in this package that is not
    // already symmetric: which of the two generators a seat is handed.
    //
    // Binding it here makes a best-of give each seat each stream, and it makes the pair of
    // matches the balance harness plays from one seed **one match and its exact mirror**
    // rather than the same match twice. Seat one's share of the repository's own sweep is
    // therefore 50.0% by construction rather than by sampling, and `openerSwung` is 50 of 50
    // rather than 0 — see `apps/web/src/data/balance-aggregate.test.ts`, which ratchets the
    // number of games that ignore this.
    const first = new Rng(context.rng.next() | 0);
    const second = new Rng(context.rng.next() | 0);
    this.#rng =
      context.openingSeat === 'p1' ? { p1: first, p2: second } : { p1: second, p2: first };
    this.#difficulty = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      resetBotState(this.#botState[seat]);
      this.#command[seat].dirX = 0;
      this.#command[seat].dirY = 0;
      this.#anchor[seat].active = false;
    }
    resetGame(this.#field, layout);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#field.winner !== null) return;
    for (let i = 0; i < SEATS.length; i += 1) {
      this.#read(SEATS[i] as SeatId, input, fixedDeltaSeconds);
    }
    step(this.#field, fixedDeltaSeconds, this.#command.p1, this.#command.p2);
  }

  /**
   * One seat's intent for this step, as one of nine headings.
   *
   * Two spellings of one thing. A finger says **which way from where it pressed** and the
   * game takes the sign of that displacement on each axis; a key says **which way** and
   * the game takes the sign of the move vector on each axis. Both land on exactly the same
   * nine values, and both feed the same two speeds, so neither instrument can name a
   * heading the other cannot or reach anywhere sooner.
   *
   * The anchor is leashed to {@link DRAG_LEASH} so it re-centres behind a travelling
   * finger: a reversal costs 36 units of glass rather than however far the drag has gone,
   * which is what keeps a trackpad's re-clutch cheap.
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
    const anchor = this.#anchor[seat];
    let dx: number;
    let dy: number;
    if (pointer !== null) {
      if (!anchor.active) {
        anchor.active = true;
        anchor.x = pointer.x;
        anchor.y = pointer.y;
      } else {
        anchor.x = clamp(anchor.x, pointer.x - DRAG_LEASH, pointer.x + DRAG_LEASH);
        anchor.y = clamp(anchor.y, pointer.y - DRAG_LEASH, pointer.y + DRAG_LEASH);
      }
      const gapX = pointer.x - anchor.x;
      const gapY = pointer.y - anchor.y;
      dx = Math.abs(gapX) <= DRAG_DEADZONE ? 0 : gapX > 0 ? 1 : -1;
      dy = Math.abs(gapY) <= DRAG_DEADZONE ? 0 : gapY > 0 ? 1 : -1;
    } else {
      anchor.active = false;
      const axis = seatAxisSign(seat);
      const moveX = seatInput.move.x * axis;
      const moveY = seatInput.move.y * axis;
      dx = moveX > 0 ? 1 : moveX < 0 ? -1 : 0;
      dy = moveY > 0 ? 1 : moveY < 0 ? -1 : 0;
    }
    // A diagonal is normalised through the one constant the bot's headings use, so the two
    // producers of a heading are bit-identical and eight ways round is eight equal speeds
    // rather than four fast ones.
    if (dx !== 0 && dy !== 0) {
      command.dirX = dx * Math.SQRT1_2;
      command.dirY = dy * Math.SQRT1_2;
    } else {
      command.dirX = dx;
      command.dirY = dy;
    }
  }

  /**
   * Pause and resume both let go of every drag.
   *
   * `InputManager.clear()` drops every key and pointer, so the first step back reads a
   * standstill; a runner stops and nothing is committed, because this game has no
   * committing gesture at all. That is why `docs/input-idiom.md`'s missing
   * `pointerCancelled` primitive costs this package nothing: the worst a cancelled gesture
   * can do here is stop you for a step. The anchor is dropped so that the next press
   * re-anchors under the finger rather than against a point the player has forgotten.
   */
  onPause(): void {
    this.#letGo();
  }

  onResume(): void {
    this.#letGo();
  }

  #letGo(): void {
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#anchor[seat].active = false;
      this.#command[seat].dirX = 0;
      this.#command[seat].dirY = 0;
    }
  }

  getScore(): MatchScore {
    return {
      p1: this.#field.p1.runner.bank,
      p2: this.#field.p2.runner.bank,
      winner: winnerOf(this.#field),
    };
  }

  destroy(): void {
    resetGame(this.#field, null);
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
    this.#letGo();
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    renderer.clear(COLOUR_FLOOR);
    this.#drawClock(renderer);
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#drawVault(renderer, seat);
      this.#drawShore(renderer, seat);
    }
    this.#drawDoor(renderer);
    for (let i = 0; i < SEATS.length; i += 1) {
      this.#drawCoins(renderer, SEATS[i] as SeatId);
    }
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#drawRunner(renderer, seat, alpha);
      this.#drawTally(renderer, seat);
    }
  }

  /**
   * How much of the match is left, as a bar down the left edge that drains from both ends
   * toward the door. One object, shared by both players and unchanged by the half-turn, so
   * neither of them is reading a clock the other cannot.
   */
  #drawClock(renderer: Renderer): void {
    const top = 40;
    const length = BOARD_HEIGHT - top * 2;
    const left = clamp(this.#field.clock / MATCH_SECONDS, 0, 1);
    renderer.rect(6, top, 7, length, COLOUR_VAULT);
    renderer.rect(6, CENTRE_Y - (length * left) / 2, 7, length * left, COLOUR_TRACK);
  }

  /** The floor a seat is responsible for, and the plate its coins are set out on. */
  #drawVault(renderer: Renderer, seat: SeatId): void {
    const sign = seatAxisSign(seat);
    const near = CENTRE_Y + sign * VAULT_NEAR;
    const far = CENTRE_Y + sign * VAULT_FAR;
    const top = Math.min(near, far) - COIN_RADIUS * 2;
    const height = Math.abs(far - near) + COIN_RADIUS * 4;
    const left = VAULT_INSET_X - COIN_RADIUS * 2;
    const width = BOARD_WIDTH - left * 2;
    renderer.rect(left, top, width, height, COLOUR_VAULT);
    renderer.strokeRect(left, top, width, height, 3, COLOUR_EDGE);
  }

  /**
   * A seat's own back wall, and its door.
   *
   * Rule 7: **the near seat is round and the far seat is square, everywhere in this game**
   * — the runner, its doorway, the flash when it is involved in a catch, and the milestone
   * markers on its tally. Two runners on one screen at once is the pair most likely to be
   * confused, and the two seat colours sit at 1.03:1 under deuteranopia
   * (`packages/engine/src/palette-vision.test.ts`), so the shape is not decoration.
   *
   * On top of that the near seat's wall carries **one** stripe and the far seat's **two**,
   * a fixed multiplicity that reads as a pattern rather than as a score.
   */
  #drawShore(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const sign = seatAxisSign(seat);
    const wall = seat === 'p1' ? BOARD_HEIGHT - WALL - 10 : WALL;
    const width = BOARD_WIDTH - WALL * 2;
    renderer.rect(WALL, wall, width, 10, palette.tint);
    if (seat === 'p2') renderer.rect(WALL, wall + 16, width, 10, palette.tint);

    const doorX = homeX();
    const doorY = homeY(seat);
    if (seat === 'p1') {
      renderer.strokeCircle(doorX, doorY, RUNNER_RADIUS + 12, 3, palette.soft);
    } else {
      const reach = RUNNER_RADIUS + 12;
      renderer.strokeRect(doorX - reach, doorY - reach, reach * 2, reach * 2, 3, palette.soft);
    }
    // Which way out of your own door is, so the geography reads without colour.
    renderer.line(doorX, doorY, doorX, doorY - sign * (RUNNER_RADIUS + 24), 3, COLOUR_TRACK);
  }

  /** The door itself: a dashed line, one object, owned by neither seat. */
  #drawDoor(renderer: Renderer): void {
    for (let x = WALL; x < BOARD_WIDTH - WALL; x += 44) {
      renderer.line(x, CENTRE_Y, Math.min(x + 26, BOARD_WIDTH - WALL), CENTRE_Y, 3, COLOUR_DOOR);
    }
  }

  /** A coin is a ring: a disc with a hole, which is neither seat's shape and not a runner. */
  #drawCoins(renderer: Renderer, seat: SeatId): void {
    const vault = sideOf(this.#field, seat).vault;
    for (let i = 0; i < vault.length; i += 1) {
      const coin = vault[i] as Coin;
      if (!coin.active) continue;
      renderer.circle(coin.x, coin.y, COIN_RADIUS, COLOUR_COIN);
      renderer.strokeCircle(coin.x, coin.y, COIN_RADIUS / 2, 3, COLOUR_COIN_EDGE);
    }
  }

  /**
   * A runner, its role, and what it is carrying.
   *
   * The role is drawn rather than inferred from position: a guard wears a ring of ink at
   * arm's length — the reach it catches at — and a thief does not. That is the same
   * `CATCH_RADIUS` the rule uses, so "how close is too close" is a thing a player can see
   * rather than a number in a spec, and it is why the bot is allowed to reason about it.
   */
  #drawRunner(renderer: Renderer, seat: SeatId, alpha: number): void {
    const runner = runnerOf(this.#field, seat);
    const palette = SEAT_PALETTE[seat];
    const x = runner.prevX + (runner.x - runner.prevX) * alpha;
    const y = runner.prevY + (runner.y - runner.prevY) * alpha;
    const sign = seatAxisSign(seat);

    if (runner.flash > 0) {
      const swell = RUNNER_RADIUS + 6 + (FLASH_SECONDS - runner.flash) * 30;
      if (seat === 'p1') renderer.strokeCircle(x, y, swell, 3, COLOUR_TRACK);
      else renderer.strokeRect(x - swell, y - swell, swell * 2, swell * 2, 3, COLOUR_TRACK);
    }

    // A guard's reach, drawn at exactly the radius it catches at.
    if (runner.home) {
      if (seat === 'p1') renderer.strokeCircle(x, y, CATCH_RADIUS, 2, COLOUR_TRACK);
      else
        renderer.strokeRect(
          x - CATCH_RADIUS,
          y - CATCH_RADIUS,
          CATCH_RADIUS * 2,
          CATCH_RADIUS * 2,
          2,
          COLOUR_TRACK,
        );
    }

    if (seat === 'p1') {
      renderer.circle(x, y, RUNNER_RADIUS, palette.base);
      renderer.strokeCircle(x, y, RUNNER_RADIUS - 3, 3, COLOUR_INK);
    } else {
      renderer.rect(
        x - RUNNER_RADIUS,
        y - RUNNER_RADIUS,
        RUNNER_RADIUS * 2,
        RUNNER_RADIUS * 2,
        palette.base,
      );
      renderer.strokeRect(
        x - RUNNER_RADIUS + 3,
        y - RUNNER_RADIUS + 3,
        RUNNER_RADIUS * 2 - 6,
        RUNNER_RADIUS * 2 - 6,
        3,
        COLOUR_INK,
      );
    }

    // Which way it is going, so a committed run is readable before it arrives.
    const fx = runner.faceX === 0 && runner.faceY === 0 ? 0 : runner.faceX;
    const fy = runner.faceX === 0 && runner.faceY === 0 ? -sign : runner.faceY;
    renderer.line(
      x + fx * (RUNNER_RADIUS - 6),
      y + fy * (RUNNER_RADIUS - 6),
      x + fx * (RUNNER_RADIUS + 10),
      y + fy * (RUNNER_RADIUS + 10),
      5,
      COLOUR_INK,
    );

    this.#drawCarry(renderer, seat, x, y, sign);
  }

  /**
   * What a thief is holding, as pips over its head.
   *
   * Public on purpose. Whether a raid is worth interrupting depends on how much the
   * intruder is carrying, so both players — and the bot, which reads nothing else — are
   * looking at the same number. Rule 6 in a picture.
   */
  #drawCarry(renderer: Renderer, seat: SeatId, x: number, y: number, sign: number): void {
    const runner = runnerOf(this.#field, seat);
    const shown = Math.min(runner.carry, PIPS_SHOWN);
    if (shown === 0) return;
    const pipY = y - sign * PIP_LIFT;
    const start = x - ((shown - 1) * 13) / 2;
    for (let i = 0; i < shown; i += 1) {
      const pipX = start + i * 13;
      if (seat === 'p1') renderer.circle(pipX, pipY, 4.5, COLOUR_COIN);
      else renderer.rect(pipX - 4.5, pipY - 4.5, 9, 9, COLOUR_COIN);
    }
  }

  /**
   * What a seat has banked, as a bar along its own back wall with three milestone markers.
   *
   * The markers are the seat's own shape and there are always exactly three of them, so
   * they read as a pattern rather than as a score — the fill is the score, and it is a
   * length rather than a number because this game draws no text at all.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const runner = runnerOf(this.#field, seat);
    const palette = SEAT_PALETTE[seat];
    const y = seat === 'p1' ? BOARD_HEIGHT - HOME_BACK / 2 - 3 : HOME_BACK / 2 - 3;
    const width = BOARD_WIDTH - 160;
    const along = clamp(runner.bank / TALLY_FULL, 0, 1);
    renderer.rect(80, y, width, 6, COLOUR_VAULT);
    renderer.rect(80, y, width * along, 6, palette.soft);
    for (let i = 1; i <= 3; i += 1) {
      const markX = 80 + (width * i) / 3;
      if (seat === 'p1') renderer.circle(markX, y + 3, 6, palette.base);
      else renderer.rect(markX - 6, y - 3, 12, 12, palette.base);
    }
  }
}
