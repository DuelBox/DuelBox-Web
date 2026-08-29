import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOAT_OUT,
  CENTRE_X,
  CENTRE_Y,
  DART_RADIUS,
  DRIFTER_RADIUS,
  HOOK_RADIUS,
  MATCH_SECONDS,
  POND_HALF,
  ROW_OFFSETS,
  SEATS,
  TARGET_FISH,
  botCommand,
  createBotState,
  createCommand,
  createGame,
  laneOf,
  resetBotState,
  resetGame,
  rodOf,
  seatAxisSign,
  settleRod,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Command, Fish, Game as Pond } from './rules.js';

/**
 * Unfair Fishing — one pond, two boats, and a race to twenty-five fish.
 *
 * `rules.ts` holds the whole simulation in logical units. This file does three things and
 * nothing else: it turns a key or a finger into the single boolean {@link Command} the
 * rules read, it gives each bot seat its own generator, and it draws. It never adds to the
 * simulation — a test renders forty frames at two different alphas and asserts nothing
 * moved.
 *
 * There is no per-seat control mapping to undo when drawing and none to mirror when
 * reading, because the whole vocabulary is one press. A finger and a key spell it the same
 * way from either chair, so nothing in this file branches on the seat except the *shape*
 * it draws, which is rule 7 rather than a control decision.
 */

const COLOUR_SKY = '#0d2740';
const COLOUR_WATER = '#12405f';
const COLOUR_DEEP = '#0a2337';
const COLOUR_LANE = 'rgba(190, 224, 245, 0.13)';
const COLOUR_DECK = '#d9e6f2';
const COLOUR_INK = '#0a1b28';
const COLOUR_LINE = 'rgba(220, 236, 248, 0.7)';
const COLOUR_FISH = '#9fd8c2';
const COLOUR_FISH_DEEP = '#5aa48c';

/** Where the water starts and stops, as offsets from the middle. Drawn, never simulated. */
const WATER_HALF = 360;

export class UnfairFishingGame implements Game {
  readonly #pond: Pond = createGame();
  readonly #command: Record<SeatId, Command> = { p1: createCommand(), p2: createCommand() };
  readonly #botState: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };

  /**
   * A generator per seat, plus one for the pond, all seeded from the one the shell handed
   * us.
   *
   * The pond is stocked once, before the match, and after that the simulation draws
   * nothing at all — two humans play a match with no randomness in it anywhere. Only the
   * bots draw, and they draw from separate streams because the *number* of decisions a
   * tier makes depends on its thinking interval, so a shared stream would make one seat's
   * play a function of which tier was sitting opposite.
   */
  #rng: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
  #difficulty: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };
  /**
   * Whether the next press from this seat is a leftover from the pause menu.
   *
   * `InputManager.clear()` drops every key and pointer, so a finger still on the glass
   * when the match resumes arrives as a fresh `actionPressed` — which in this game is a
   * throw nobody asked for. The engine cannot yet tell a resumed hold from a new press
   * (`docs/input-idiom.md`, missing primitive 1), so one press per seat is swallowed on
   * the way in and on the way out of a pause. A test covers both directions.
   */
  #swallow: Record<SeatId, boolean> = { p1: false, p2: false };

  /** Read-only view for tests and the balance harness. Never mutate through it. */
  get pond(): Readonly<Pond> {
    return this.#pond;
  }

  init(context: GameContext): void {
    const water = new Rng(context.rng.next() | 0);
    this.#rng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#difficulty = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      resetBotState(this.#botState[seat]);
      this.#command[seat].press = false;
      this.#swallow[seat] = false;
    }
    resetGame(this.#pond, water);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#pond.winner !== null) return;
    for (let i = 0; i < SEATS.length; i += 1) {
      this.#read(SEATS[i] as SeatId, input, fixedDeltaSeconds);
    }
    step(this.#pond, fixedDeltaSeconds, this.#command.p1, this.#command.p2);
  }

  /**
   * One seat's intent for this step: a single boolean edge.
   *
   * `actionPressed` is true for exactly one step however many events arrived, and the
   * engine raises it identically for a key and for a thumb — `held` is
   * `keys.action || pointerDown`. So the two instruments are not merely equivalent here,
   * they are the same value read from the same field, and there is nothing else for this
   * game to read. Nothing consults `pointer.x`, `pointer.y` or `move`, which is the whole
   * of the cross-device fairness argument (#2478).
   */
  #read(seat: SeatId, input: InputState, dt: number): void {
    const command = this.#command[seat];
    const difficulty = this.#difficulty[seat];
    if (difficulty !== null) {
      botCommand(this.#pond, seat, difficulty, this.#botState[seat], this.#rng[seat], dt, command);
      return;
    }
    const pressed = input.seat(seat).actionPressed;
    if (pressed && this.#swallow[seat]) {
      this.#swallow[seat] = false;
      command.press = false;
      return;
    }
    command.press = pressed;
  }

  onPause(): void {
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#command[seat].press = false;
      this.#swallow[seat] = true;
      settleRod(this.#pond, seat);
    }
  }

  onResume(): void {
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#command[seat].press = false;
      this.#swallow[seat] = true;
      settleRod(this.#pond, seat);
    }
  }

  getScore(): MatchScore {
    return {
      p1: this.#pond.p1.caught,
      p2: this.#pond.p2.caught,
      winner: winnerOf(this.#pond),
    };
  }

  destroy(): void {
    resetGame(this.#pond, null);
    resetBotState(this.#botState.p1);
    resetBotState(this.#botState.p2);
    this.#command.p1.press = false;
    this.#command.p2.press = false;
    this.#swallow.p1 = false;
    this.#swallow.p2 = false;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    renderer.clear(COLOUR_SKY);
    this.#drawWater(renderer);
    this.#drawFish(renderer);
    for (let i = 0; i < SEATS.length; i += 1) {
      const seat = SEATS[i] as SeatId;
      this.#drawRod(renderer, seat, alpha);
      this.#drawBoat(renderer, seat);
      this.#drawTally(renderer, seat);
    }
    this.#drawClock(renderer);
  }

  /**
   * The pond, and the six lanes fish swim along.
   *
   * The lanes are drawn because they are the board: knowing where a row is is what turns
   * a throw into a plan, and a bot reads exactly these six numbers. They are the same six
   * from either chair, being symmetric about the middle of the device.
   */
  #drawWater(renderer: Renderer): void {
    renderer.rect(0, CENTRE_Y - WATER_HALF, BOARD_WIDTH, WATER_HALF * 2, COLOUR_WATER);
    renderer.rect(0, CENTRE_Y - WATER_HALF, BOARD_WIDTH, 5, COLOUR_DEEP);
    renderer.rect(0, CENTRE_Y + WATER_HALF - 5, BOARD_WIDTH, 5, COLOUR_DEEP);
    for (let i = 0; i < ROW_OFFSETS.length; i += 1) {
      const y = CENTRE_Y + (ROW_OFFSETS[i] as number);
      renderer.rect(CENTRE_X - POND_HALF, y - 1, POND_HALF * 2, 2, COLOUR_LANE);
    }
  }

  /**
   * The fish, told apart by shape rather than by colour.
   *
   * A `drifter` is a broad body with a forked tail; a `dart` is a chevron with no body at
   * all. The nose of both points the way it is swimming, so which way the current runs in
   * a lane is readable without watching it for a second first.
   */
  #drawFish(renderer: Renderer): void {
    const fish = this.#pond.fish;
    for (let i = 0; i < fish.length; i += 1) {
      const one = fish[i] as Fish;
      if (!one.active) continue;
      const x = CENTRE_X + one.cx;
      const y = CENTRE_Y + one.cy;
      const nose = one.dir;
      if (one.kind === 'drifter') {
        renderer.circle(x, y, DRIFTER_RADIUS, COLOUR_FISH);
        renderer.circle(x + nose * 6, y - 3, 3, COLOUR_INK);
        renderer.line(
          x - nose * DRIFTER_RADIUS,
          y,
          x - nose * (DRIFTER_RADIUS + 10),
          y - 9,
          3,
          COLOUR_FISH_DEEP,
        );
        renderer.line(
          x - nose * DRIFTER_RADIUS,
          y,
          x - nose * (DRIFTER_RADIUS + 10),
          y + 9,
          3,
          COLOUR_FISH_DEEP,
        );
      } else {
        renderer.line(
          x + nose * DART_RADIUS,
          y,
          x - nose * DART_RADIUS,
          y - DART_RADIUS,
          4,
          COLOUR_FISH,
        );
        renderer.line(
          x + nose * DART_RADIUS,
          y,
          x - nose * DART_RADIUS,
          y + DART_RADIUS,
          4,
          COLOUR_FISH,
        );
      }
    }
  }

  /**
   * One seat's line, from the boat to wherever the bait is.
   *
   * Rule 7: **the near seat is round and the far seat is square, everywhere in this
   * game** — the hull, the float on the end of the line and the milestone marks on the
   * tally. Two rods on one screen is the pair most likely to be confused, and the two seat
   * colours sit at 1.03:1 under deuteranopia
   * (`packages/engine/src/palette-vision.test.ts`), so the shape is not decoration.
   */
  #drawRod(renderer: Renderer, seat: SeatId, alpha: number): void {
    const rod = rodOf(this.#pond, seat);
    const palette = SEAT_PALETTE[seat];
    const sign = seatAxisSign(seat);
    const out = rod.prevOut + (rod.out - rod.prevOut) * alpha;
    const laneX = CENTRE_X + laneOf(seat);
    const boatY = CENTRE_Y + sign * BOAT_OUT;
    const baitY = CENTRE_Y + sign * (BOAT_OUT - out);
    if (rod.phase === 'ready') return;

    renderer.line(laneX, boatY, laneX, baitY, 2, COLOUR_LINE);
    if (rod.loaded >= 0) {
      const caught = this.#pond.fish[rod.loaded] as Fish;
      const span = caught.kind === 'drifter' ? DRIFTER_RADIUS : DART_RADIUS;
      renderer.strokeCircle(laneX, baitY, span + 8, 3, COLOUR_FISH);
    }
    if (seat === 'p1') {
      renderer.circle(laneX, baitY, HOOK_RADIUS - 6, palette.base);
      renderer.strokeCircle(laneX, baitY, HOOK_RADIUS - 2, 2, palette.deep);
    } else {
      const span = HOOK_RADIUS - 6;
      renderer.rect(laneX - span, baitY - span, span * 2, span * 2, palette.base);
      renderer.strokeRect(
        laneX - span - 4,
        baitY - span - 4,
        span * 2 + 8,
        span * 2 + 8,
        2,
        palette.deep,
      );
    }
  }

  /** A boat: a round hull for the near seat, a square one for the far seat. */
  #drawBoat(renderer: Renderer, seat: SeatId): void {
    const rod = rodOf(this.#pond, seat);
    const palette = SEAT_PALETTE[seat];
    const sign = seatAxisSign(seat);
    const laneX = CENTRE_X + laneOf(seat);
    const boatY = CENTRE_Y + sign * BOAT_OUT;
    renderer.rect(laneX - 46, boatY - 9, 92, 18, COLOUR_DECK);
    // The outline is in the seat's own darker shade rather than in ink, so that **each
    // seat has a primitive the other never draws** among its *coloured* marks and not only
    // among the ornaments on them: seat one owns `circle` and `strokeCircle`, seat two owns
    // `rect` and `strokeRect`, on every frame of every match. `greyscale.test.ts` can
    // attribute a neutral ornament to the mark it sits inside, but only steady evidence
    // survives a game where a rod spends part of its cycle with nothing in the water.
    if (seat === 'p1') {
      renderer.circle(laneX, boatY, 22, palette.base);
      renderer.strokeCircle(laneX, boatY, 17, 3, palette.deep);
      renderer.circle(laneX, boatY, 6, COLOUR_INK);
    } else {
      renderer.rect(laneX - 22, boatY - 22, 44, 44, palette.base);
      renderer.strokeRect(laneX - 17, boatY - 17, 34, 34, 3, palette.deep);
      renderer.rect(laneX - 6, boatY - 6, 12, 12, COLOUR_INK);
    }
    // The rod itself, leaning out over the water, so the boat says which way it fishes.
    renderer.line(laneX, boatY, laneX, boatY - sign * 46, 4, COLOUR_DECK);
    if (rod.flash > 0) {
      renderer.strokeCircle(laneX, boatY, 26 + rod.flash * 22, 3, palette.soft);
    }
  }

  /**
   * The race, as a bar along the player's own shore with three milestone marks.
   *
   * The marks are the seat's own shape and there are always exactly three of them, so they
   * read as a pattern rather than as a score — the fill is the score, and it is a length
   * rather than a number because this game draws no text at all.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const rod = rodOf(this.#pond, seat);
    const palette = SEAT_PALETTE[seat];
    const sign = seatAxisSign(seat);
    const y = CENTRE_Y + sign * (CENTRE_Y - 22);
    const left = 60;
    const width = BOARD_WIDTH - left * 2;
    const along = Math.max(0, Math.min(1, rod.caught / TARGET_FISH));
    renderer.rect(left, y - 4, width, 8, COLOUR_DEEP);
    renderer.rect(left, y - 4, width * along, 8, palette.base);
    for (let i = 1; i <= 3; i += 1) {
      const markX = left + (width * i) / 3;
      if (seat === 'p1') renderer.circle(markX, y, 7, palette.deep);
      else renderer.rect(markX - 7, y - 7, 14, 14, palette.deep);
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
    const left = Math.max(0, Math.min(1, this.#pond.clock / MATCH_SECONDS));
    renderer.rect(8, top, 7, length, COLOUR_DEEP);
    renderer.rect(8, CENTRE_Y - (length * left) / 2, 7, length * left, COLOUR_DECK);
  }
}
