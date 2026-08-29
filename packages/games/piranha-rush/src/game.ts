import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_Y,
  CORAL_RADIUS,
  LAGOON_HEIGHT,
  LAGOON_WIDTH,
  MOVE_DEADZONE,
  PIRANHA_RADIUS,
  SEATS,
  SWIM_RADIUS,
  SWIM_SPEED,
  botCommand,
  createBotState,
  createCommand,
  createGame,
  lagoonOf,
  lengthsOf,
  piranhaSpeed,
  resetBotState,
  resetGame,
  seatAxisSign,
  step,
  toBoardX,
  toBoardY,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Command, Coral, Game as Field, Piranha } from './rules.js';

/**
 * Piranha Rush — two lagoons, two swimmers, one shoal each and one reef between them.
 *
 * `rules.ts` holds the whole simulation, in lagoon-local units that both seats share.
 * This file does three things and nothing else: it turns a key or a finger into the
 * {@link Command} the rules read, it gives each bot seat its own generator, and it draws.
 * It never adds to the simulation — a test renders forty frames at five different alphas
 * and asserts nothing moved.
 *
 * ## The half-turn lives here, in two functions, and it costs each channel differently
 *
 * `toBoardX`/`toBoardY` place a lagoon-local point on the device, and they are the whole
 * of the seat rotation. Everything downstream falls out of that:
 *
 * - **The keyboard needs no mirroring at all.** `InputManager` reports `move` in device
 *   orientation and the far seat *means* the opposite of what the device saw, so the two
 *   flips cancel and the raw move vector is already a lagoon-local heading for both seats.
 * - **The pointer needs exactly one.** A finger names a point on the glass, which is the
 *   same point from either side, so the gap between it and the swimmer comes out in board
 *   units and is turned into the seat's own frame by {@link seatAxisSign}.
 *
 * Frozen Beaks needs the mirror image of that — a sign on the keys and none on the
 * pointer — because its birds are stored in board coordinates rather than in the seat's
 * own. Same half-turn, one layer down. `game.test.ts` drives the identical nine-heading
 * walk through a real `InputManager` on both instruments and on both seats and asserts the
 * four runs produce the same lagoon-local path.
 */

const COLOUR_WATER = '#0b2b3a';
const COLOUR_LAGOON = '#12455c';
const COLOUR_RIM = '#1d6a8a';
const COLOUR_INK = '#04161f';
const COLOUR_CORAL = '#e6b49d';
const COLOUR_CORAL_DEEP = '#b57f66';
const COLOUR_PIRANHA = '#d4dde3';
const COLOUR_GAUGE = 'rgba(233, 242, 251, 0.5)';
const COLOUR_GAUGE_TRACK = 'rgba(4, 22, 31, 0.55)';

/** Body lengths at which the shore tally is full. Presentation only; no rule reads it. */
const TALLY_FULL = 150;

/** Half the height of the shoal-speed gauge, in board units. */
const GAUGE_HALF = 300;

/** How far a swimmer's nose sticks out past its body. */
const NOSE = 12;

/** Spokes on a coral head, and how far a barb sits back along a piranha. */
const CORAL_SPOKES = 6;
const BARB = 0.75;

export class PiranhaRushGame implements Game {
  readonly #field: Field = createGame();
  readonly #command: Record<SeatId, Command> = { p1: createCommand(), p2: createCommand() };
  readonly #botState: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };

  /**
   * A generator per seat, plus one for the reef, all seeded from the one the shell gave us.
   *
   * The reef is drawn once, before the match, and after that the simulation draws nothing
   * at all — two humans play a match with no randomness in it anywhere. Only the bots
   * draw, and they draw from separate streams because the *number* of decisions a tier
   * makes depends on its thinking interval: `hard` looks 2.5 times as often as `easy`, so
   * a shared stream would make one seat's play a function of which tier sat opposite.
   *
   * Handing the two streams out in a fixed order is the only asymmetry in the whole
   * package, and it is a stream asymmetry rather than a seat one: exchanging the two
   * produces the exact swap of the same match, which `rules.test.ts` asserts board by
   * board and the balance table in SPEC.md shows as two exactly complementary columns.
   */
  #rng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #difficulty: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };

  /** Read-only view for tests and the balance harness. Never mutate through it. */
  get field(): Readonly<Field> {
    return this.#field;
  }

  init(context: GameContext): void {
    const layout = new Rng(context.rng.next() | 0);
    this.#rng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#difficulty = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      resetBotState(this.#botState[seat]);
      this.#command[seat].dirX = 0;
      this.#command[seat].dirY = 0;
    }
    resetGame(this.#field, layout);
    // `context.openingSeat` is deliberately not read. A real-time game has no opener and
    // the SDK contract says so outright; both swimmers start at the same point of the same
    // lagoon with the same shoal, so there is nothing for it to name and inventing
    // something would manufacture the first-mover advantage the shell alternates it to
    // remove. `apps/web/src/data/turn-seat.test.ts` requires the matching silence about
    // `getActiveSeat`, which this class does not implement.
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
   * Two spellings of one thing. A finger says **where** and the game takes the sign of the
   * gap on each axis; a key says **which way** and the game takes the sign of the move
   * vector on each axis. Both land on exactly the same nine values — eight compass points
   * and a standstill — and both swim at `SWIM_SPEED`, so neither instrument can name a
   * heading the other cannot or reach it any sooner.
   *
   * Taking the *sign* rather than the position is what keeps this inside
   * `docs/input-parity.md`: the pointer never contributes a continuous quantity, so the
   * precision envelope is not even load-bearing here — it only has to be coarse enough
   * that the deadzone is a real distance, which is why the deadzone is written in
   * envelopes.
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
    let dx: number;
    let dy: number;
    if (pointer !== null) {
      // Absolute, and it can be: a horizontal split gives each seat a full-width band, so
      // every point of its own lagoon is directly under its own thumb
      // (`docs/input-idiom.md`, `rt-split`). Inside the deadzone the answer is a
      // standstill, which in this game means tread water and score nothing.
      const swimmer = lagoonOf(this.#field, seat).swimmer;
      const axis = seatAxisSign(seat);
      const gapX = (pointer.x - toBoardX(seat, swimmer.x)) * axis;
      const gapY = (pointer.y - toBoardY(seat, swimmer.y)) * axis;
      dx = Math.abs(gapX) <= MOVE_DEADZONE ? 0 : gapX > 0 ? 1 : -1;
      dy = Math.abs(gapY) <= MOVE_DEADZONE ? 0 : gapY > 0 ? 1 : -1;
    } else {
      // No `seatAxisSign` here, and that is not an omission: see the class comment.
      const move = seatInput.move;
      dx = move.x > 0 ? 1 : move.x < 0 ? -1 : 0;
      dy = move.y > 0 ? 1 : move.y < 0 ? -1 : 0;
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
   * Pause and resume both drop the heading a swimmer was holding.
   *
   * `InputManager.clear()` releases every key and pointer, which arrives as a standstill on
   * the first step back, and `#read` overwrites the command every step anyway — so this is
   * belt and braces rather than a fix for an observed bug. It costs one step of drift at
   * most, and the alternative is a stale heading surviving a menu.
   */
  onPause(): void {
    this.#stopBoth();
  }

  onResume(): void {
    this.#stopBoth();
  }

  #stopBoth(): void {
    for (let i = 0; i < SEATS.length; i += 1) {
      const command = this.#command[SEATS[i] as SeatId];
      command.dirX = 0;
      command.dirY = 0;
    }
  }

  getScore(): MatchScore {
    return {
      p1: lengthsOf(this.#field.p1),
      p2: lengthsOf(this.#field.p2),
      winner: winnerOf(this.#field),
    };
  }

  destroy(): void {
    resetGame(this.#field, null);
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
    this.#stopBoth();
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    renderer.clear(COLOUR_WATER);
    this.#drawGauge(renderer);
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#drawLagoon(renderer, seat);
      this.#drawReef(renderer, seat);
      this.#drawShoal(renderer, seat, alpha);
      this.#drawSwimmer(renderer, seat, alpha);
      this.#drawTally(renderer, seat);
    }
  }

  /**
   * How fast the shoal is now, as a bar down the left edge growing from the middle.
   *
   * One object, drawn once, **symmetric about the centre line** — so it is unchanged by the
   * half-turn and neither player is reading a gauge the other cannot. The notch is where
   * the shoal matches a swimmer's own speed: past it nobody outruns anything, which is the
   * one fact a player needs and the only thing the bot reads that is not a position.
   */
  #drawGauge(renderer: Renderer): void {
    renderer.line(0, CENTRE_Y, BOARD_WIDTH, CENTRE_Y, 2, COLOUR_RIM);
    renderer.rect(6, CENTRE_Y - GAUGE_HALF, 7, GAUGE_HALF * 2, COLOUR_GAUGE_TRACK);
    const share = Math.min(1.5, piranhaSpeed(this.#field.elapsed) / SWIM_SPEED) / 1.5;
    const half = GAUGE_HALF * share;
    renderer.rect(6, CENTRE_Y - half, 7, half * 2, COLOUR_GAUGE);
    const notch = GAUGE_HALF / 1.5;
    renderer.line(3, CENTRE_Y - notch, 16, CENTRE_Y - notch, 3, COLOUR_RIM);
    renderer.line(3, CENTRE_Y + notch, 16, CENTRE_Y + notch, 3, COLOUR_RIM);
  }

  /**
   * One seat's water, and the band of its own colour along its own shore.
   *
   * The band is the shape that tells the two lagoons apart without colour: **one stripe for
   * seat one, two for seat two**, a fixed multiplicity that reads as a pattern rather than
   * as a score.
   */
  #drawLagoon(renderer: Renderer, seat: SeatId): void {
    const left = toBoardX(seat, seat === 'p1' ? 0 : LAGOON_WIDTH);
    const top = toBoardY(seat, seat === 'p1' ? 0 : LAGOON_HEIGHT);
    renderer.rect(left, top, LAGOON_WIDTH, LAGOON_HEIGHT, COLOUR_LAGOON);
    renderer.strokeRect(left + 2, top + 2, LAGOON_WIDTH - 4, LAGOON_HEIGHT - 4, 4, COLOUR_RIM);

    const palette = SEAT_PALETTE[seat];
    const shore = seat === 'p1' ? top + LAGOON_HEIGHT - 12 : top + 2;
    renderer.rect(left, shore, LAGOON_WIDTH, 9, palette.tint);
    if (seat === 'p2') renderer.rect(left, shore + 15, LAGOON_WIDTH, 9, palette.tint);
  }

  /**
   * The reef: one list of coral heads, drawn once into each lagoon.
   *
   * A head is a **six-spoked burst with a dark core**, never a disc — the one thing a
   * player must tell apart from their own swimmer at a glance while running, so the two are
   * different primitives rather than two colours. The spokes reach exactly `CORAL_RADIUS`,
   * so "how close can I cut it" is something a player can see.
   */
  #drawReef(renderer: Renderer, seat: SeatId): void {
    const corals = this.#field.corals;
    for (let i = 0; i < corals.length; i += 1) {
      const coral = corals[i] as Coral;
      const cx = toBoardX(seat, coral.x);
      const cy = toBoardY(seat, coral.y);
      for (let s = 0; s < CORAL_SPOKES; s += 1) {
        const angle = (s * Math.PI * 2) / CORAL_SPOKES + (i % 2 === 0 ? 0 : 0.4);
        const ax = Math.cos(angle);
        const ay = Math.sin(angle);
        renderer.line(
          cx + ax * 4,
          cy + ay * 4,
          cx + ax * CORAL_RADIUS,
          cy + ay * CORAL_RADIUS,
          7,
          COLOUR_CORAL,
        );
      }
      renderer.circle(cx, cy, 9, COLOUR_CORAL_DEEP);
    }
  }

  /**
   * The shoal, as arrowheads pointing the way they are coming.
   *
   * Three strokes each and no disc anywhere in them: a piranha, a coral head and a swimmer
   * are three different primitives on the board at once, which is rule 7 read as a
   * requirement about the *pieces* rather than only about the two seats. The heading comes
   * from the step just taken, so a player can read which of the four is closing on them
   * before it arrives.
   */
  #drawShoal(renderer: Renderer, seat: SeatId, alpha: number): void {
    const piranhas = lagoonOf(this.#field, seat).piranhas;
    for (let i = 0; i < piranhas.length; i += 1) {
      const piranha = piranhas[i] as Piranha;
      const localX = piranha.prevX + (piranha.x - piranha.prevX) * alpha;
      const localY = piranha.prevY + (piranha.y - piranha.prevY) * alpha;
      const x = toBoardX(seat, localX);
      const y = toBoardY(seat, localY);
      const axis = seatAxisSign(seat);
      let hx = (piranha.x - piranha.prevX) * axis;
      let hy = (piranha.y - piranha.prevY) * axis;
      const len = Math.hypot(hx, hy);
      if (len > 0) {
        hx /= len;
        hy /= len;
      } else {
        hx = 0;
        hy = 1;
      }
      const px = -hy;
      const py = hx;
      const noseX = x + hx * PIRANHA_RADIUS;
      const noseY = y + hy * PIRANHA_RADIUS;
      const backX = x - hx * PIRANHA_RADIUS * BARB;
      const backY = y - hy * PIRANHA_RADIUS * BARB;
      const wing = PIRANHA_RADIUS * 0.9;
      renderer.line(noseX, noseY, backX + px * wing, backY + py * wing, 5, COLOUR_PIRANHA);
      renderer.line(noseX, noseY, backX - px * wing, backY - py * wing, 5, COLOUR_PIRANHA);
      renderer.line(
        backX + px * wing,
        backY + py * wing,
        backX - px * wing,
        backY - py * wing,
        3,
        COLOUR_INK,
      );
    }
  }

  /**
   * A swimmer, or the shape it left behind.
   *
   * Rule 7: **seat one is round and seat two is square, everywhere in this game** — the
   * body, the ring it flashes when it hits coral, the marker where it was taken, and the
   * milestones on its tally. Two swimmers on one screen at once is the pair most likely to
   * be confused, and the two seat colours sit at 1.03:1 under deuteranopia
   * (`packages/engine/src/palette-vision.test.ts`), so the shape is not decoration.
   *
   * A taken swimmer keeps its own primitive and goes translucent, rather than being
   * replaced by something neutral: the picture after a lagoon has finished still has to say
   * whose lagoon it was.
   */
  #drawSwimmer(renderer: Renderer, seat: SeatId, alpha: number): void {
    const swimmer = lagoonOf(this.#field, seat).swimmer;
    const palette = SEAT_PALETTE[seat];
    const localX = swimmer.prevX + (swimmer.x - swimmer.prevX) * alpha;
    const localY = swimmer.prevY + (swimmer.y - swimmer.prevY) * alpha;
    const x = toBoardX(seat, localX);
    const y = toBoardY(seat, localY);
    const axis = seatAxisSign(seat);

    if (swimmer.flash > 0) {
      const swell = SWIM_RADIUS + 6 + swimmer.flash * 10;
      if (seat === 'p1') renderer.strokeCircle(x, y, swell, 4, palette.deep);
      else renderer.strokeRect(x - swell, y - swell, swell * 2, swell * 2, 4, palette.deep);
    }

    const body = swimmer.alive ? palette.base : palette.soft;
    if (seat === 'p1') {
      renderer.circle(x, y, SWIM_RADIUS, body);
      renderer.strokeCircle(x, y, SWIM_RADIUS - 4, 3, COLOUR_INK);
    } else {
      renderer.rect(x - SWIM_RADIUS, y - SWIM_RADIUS, SWIM_RADIUS * 2, SWIM_RADIUS * 2, body);
      renderer.strokeRect(
        x - SWIM_RADIUS + 4,
        y - SWIM_RADIUS + 4,
        SWIM_RADIUS * 2 - 8,
        SWIM_RADIUS * 2 - 8,
        3,
        COLOUR_INK,
      );
    }

    if (!swimmer.alive) {
      // Two ink strokes through the body: the same mark for both seats, because "taken" is
      // not a seat-owned fact and the seat is already carried by the shape underneath it.
      const reach = SWIM_RADIUS - 2;
      renderer.line(x - reach, y - reach, x + reach, y + reach, 5, COLOUR_INK);
      renderer.line(x - reach, y + reach, x + reach, y - reach, 5, COLOUR_INK);
      return;
    }

    // The nose points the way the swimmer is heading, or at its own shore when it is
    // treading water, so a committed direction is readable without colour.
    const still = swimmer.dirX === 0 && swimmer.dirY === 0;
    const dirX = (still ? 0 : swimmer.dirX) * axis;
    const dirY = (still ? 1 : swimmer.dirY) * axis;
    renderer.line(
      x + dirX * (SWIM_RADIUS - 6),
      y + dirY * (SWIM_RADIUS - 6),
      x + dirX * (SWIM_RADIUS + NOSE),
      y + dirY * (SWIM_RADIUS + NOSE),
      5,
      COLOUR_INK,
    );
  }

  /**
   * The distance swum, as a bar along the player's own shore with three seat-shaped
   * milestones on it.
   *
   * A length rather than a number — this game draws no text at all, and a test asserts it —
   * and the milestones are a fixed three so they read as a pattern rather than as a score.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const y = seat === 'p1' ? BOARD_HEIGHT - 11 : 5;
    const width = BOARD_WIDTH - 80;
    const along = Math.max(0, Math.min(1, lengthsOf(lagoonOf(this.#field, seat)) / TALLY_FULL));
    renderer.rect(40, y, width, 6, COLOUR_GAUGE_TRACK);
    renderer.rect(40, y, width * along, 6, palette.soft);
    for (let i = 1; i <= 3; i += 1) {
      const markX = 40 + (width * i) / 3;
      if (seat === 'p1') renderer.circle(markX, y + 3, 6, palette.base);
      else renderer.rect(markX - 6, y - 3, 12, 12, palette.base);
    }
  }
}
