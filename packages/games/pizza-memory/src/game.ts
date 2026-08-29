import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BELL_STATION,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EMPTY_SLOT,
  HAND_SPEED,
  KIND_COUNT,
  MATCH_SECONDS,
  PHASE_BUILD,
  PHASE_SERVE,
  PHASE_WATCH,
  RAIL_PITCH,
  STATION_COUNT,
  botStep,
  commit,
  counterOf,
  createBotState,
  createState,
  railX,
  resetBotState,
  resetState,
  revealedCount,
  secondsLeft,
  stationFromBoardX,
  steerHand,
  step,
} from './rules.js';
import type { BotDifficulty, BotState, Counter, State } from './rules.js';

/**
 * Pizza Memory — two counters facing each other, each drawn the right way up for the person
 * sitting at it.
 *
 * Seat two's counter is the exact half-turn image of seat one's, so nothing is ever rotated
 * and both players read their own pizza, their own rail and their own bell upright. `rules.ts`
 * owns the whole simulation; this file places a finger on it and draws it.
 *
 * ## Rule 7, which is the whole game here rather than a finish on it
 *
 * "Recompose the pizza exactly as you saw it" is unplayable if the ingredients differ only by
 * colour, and pizza toppings are the classic colour-only set. So:
 *
 * - **Every topping has its own silhouette** — a disc, a ring, a block, a wedge, a bar —
 *   drawn at the same size on the rail, on the pizza and in the reveal, so what a player
 *   memorises is a shape. Colour is a second, redundant channel, and the five colours are
 *   spaced in *luminance* as well as in hue, so they stay five distinguishable greys.
 * - **Every seat-owned object carries its seat's silhouette**: seat one's pizza, slots, rail
 *   plates, bell and hand are round, seat two's are square. Neither seat ever draws the
 *   other's outline primitive — seat one never strokes a rectangle and seat two never
 *   strokes a circle — which `greyscale.test.ts` in this package asserts directly.
 * - **No text anywhere.** Nothing on this counter has to be read.
 */

/* --------------------------------------------------------------------- geometry */

/** Seat one's pizza. Seat two's is at the half-turn image of this point. */
const PIZZA_CX = 300;
const PIZZA_CY = 690;
const PIZZA_R = 140;
/** Half the side of seat two's square pizza, at equal area: `sqrt(pi) / 2`. */
const PIZZA_HALF = PIZZA_R * (Math.sqrt(Math.PI) / 2);
const CRUST_WIDTH = 14;

/** How far a topping sits from the middle of the pizza. */
const SLOT_ORBIT = 82;
const SLOT_PLATE = 30;

/** Seat one's rail. */
const RAIL_Y = 930;
const STATION_PLATE = 34;
/** Where the hand marker rides, between the rail and the pizza. */
const HAND_Y = 872;
const HAND_R = 15;
const HAND_HALF = HAND_R * (Math.sqrt(Math.PI) / 2);

/** How big a topping is drawn, everywhere it is drawn. */
const GLYPH_R = 15;

/* --------------------------------------------------------------------- colours */

const COLOUR_FLOOR = '#161018';
const COLOUR_COUNTER = '#241a26';
const COLOUR_DOUGH = '#e8c98d';
const COLOUR_INK = '#12090f';
const COLOUR_CHALK = 'rgba(240, 228, 236, 0.42)';
const COLOUR_SPOILED = '#e2603f';

/**
 * One colour per topping, spaced in luminance as well as in hue.
 *
 * The shape is the signal and this is the confirmation, but a confirmation that collapses in
 * greyscale is not one: `greyscale.test.ts` measures the sRGB relative luminance of these
 * five and asserts a real gap between every neighbouring pair.
 */
export const KIND_COLOUR: readonly string[] = [
  '#c9433c',
  '#20272e',
  '#f0d071',
  '#4e9c5a',
  '#7a4a22',
];

/* --------------------------------------------------------------------- helpers */

/** How far a key has to be open before it counts as a direction. */
const AXIS_THRESHOLD = 0.35;

function axis(value: number): number {
  if (value > AXIS_THRESHOLD) return 1;
  if (value < -AXIS_THRESHOLD) return -1;
  return 0;
}

export class PizzaMemoryGame implements Game {
  readonly #state: State = createState();
  readonly #botP1: BotState = createBotState();
  readonly #botP2: BotState = createBotState();

  /**
   * Where each hand stood at the end of the previous step, for the render interpolation.
   *
   * The hand crosses a station in a fifth of a second, so on a display running above the
   * simulation rate it visibly strobes without this. Index 0 is seat one. Written in place at
   * the top of every step, so `update` allocates nothing.
   */
  readonly #prevHand = new Float64Array(2);

  /**
   * Three streams from the one seed the shell gives us.
   *
   * The ticket book has its own, so the orders a match deals are a function of the seed and
   * never of how the seats are filled. **The other two are handed out by role, not by seat**:
   * the opening seat gets stream A and the other gets stream B. Because the two counters are
   * otherwise exact half-turn images, that makes a seed's two openings *one match and its
   * mirror* — so seat one's share at equal skill is 50.0% by construction rather than by
   * sampling, which is what `rules.test.ts` asserts seed by seed.
   */
  #bookRng = new Rng(1);
  #streamA = new Rng(2);
  #streamB = new Rng(3);

  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #openingSeat: SeatId = 'p1';
  #difficultyP1: BotDifficulty | null = null;
  #difficultyP2: BotDifficulty | null = null;
  #ready = false;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  get state(): Readonly<State> {
    return this.#state;
  }

  init(context: GameContext): void {
    this.#bookRng = new Rng(context.rng.next() | 0);
    this.#streamA = new Rng(context.rng.next() | 0);
    this.#streamB = new Rng(context.rng.next() | 0);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    // A real-time game has no opener and the contract says it may ignore this. It is read
    // anyway, for the one thing it can buy here: which bot stream goes to which chair.
    this.#openingSeat = context.openingSeat;
    this.#difficultyP1 = context.botDifficulty('p1');
    this.#difficultyP2 = context.botDifficulty('p2');
    this.#ready = true;
    resetBotState(this.#botP1);
    resetBotState(this.#botP2);
    resetState(this.#state, this.#bookRng);
    this.#remember();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (!this.#ready) return;
    if (this.#state.winner !== null) return;

    this.#remember();
    // Both seats are driven before either counter is stepped, so neither is a step ahead of
    // the other. Nothing here is contested: the two counters share no object at all.
    this.#driveSeat('p1', input, fixedDeltaSeconds);
    this.#driveSeat('p2', input, fixedDeltaSeconds);
    step(this.#state, fixedDeltaSeconds);
  }

  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer, alpha = 0): void {
    renderer.clear(COLOUR_FLOOR);
    renderer.rect(0, BOARD_HEIGHT / 2, BOARD_WIDTH, BOARD_HEIGHT / 2, COLOUR_COUNTER);
    renderer.rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT / 2 - 3, COLOUR_COUNTER);
    this.#drawClock(renderer);
    this.#drawCounter(renderer, 'p1', alpha);
    this.#drawCounter(renderer, 'p2', alpha);
  }

  onPause(): void {}

  onResume(): void {
    // Nothing to settle: a commit is an edge the engine derives, so an action still down
    // across a pause cannot read as a fresh one.
  }

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: this.#state.winner };
  }

  destroy(): void {
    this.#ready = false;
    this.#difficultyP1 = null;
    this.#difficultyP2 = null;
    this.#openingSeat = 'p1';
    resetBotState(this.#botP1);
    resetBotState(this.#botP2);
    resetState(this.#state, this.#bookRng);
    this.#remember();
  }

  /* ------------------------------------------------------------------ driving */

  /** True when this seat reads the drawn board upside down, so its keys mean the mirror. */
  #isRotated(seat: SeatId): boolean {
    return this.#presentation === 'shared-screen' && seat !== this.#localSeat;
  }

  #driveSeat(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const counter = counterOf(this.#state, seat);
    const difficulty = seat === 'p1' ? this.#difficultyP1 : this.#difficultyP2;

    if (difficulty !== null) {
      const bot = seat === 'p1' ? this.#botP1 : this.#botP2;
      const rng = this.#openingSeat === seat ? this.#streamA : this.#streamB;
      // The bot commits through the same door a player does: `commit` reads the station the
      // hand is standing on, so a bot cannot place a topping it has not walked to.
      if (botStep(counter, bot, difficulty, rng, fixedDeltaSeconds) >= 0) commit(counter);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // Absolute, and rate-limited by `steerHand`: a thumb that lands on the bell cannot get
      // there faster than a held key can walk. The seat's own zone is the engine's business —
      // a pointer belongs to the seat it went down in — so this only has to read the x.
      steerHand(counter, stationFromBoardX(seat, pointer.x));
    } else {
      // A key is a direction, and a seat reading the device upside down means the opposite
      // one. This is control mapping, which the two presentations are allowed to differ on;
      // nothing in `rules.ts` reads the presentation.
      const boardDirection = axis(seatInput.move.x) * (this.#isRotated(seat) ? -1 : 1);
      // Seat two's rail runs the other way across the board, so its local axis is the board's
      // reversed — which is exactly what makes a mirrored touch land on the same station.
      const direction = seat === 'p1' ? boardDirection : -boardDirection;
      const wanted =
        direction === 0
          ? counter.hand
          : counter.hand + direction * HAND_SPEED * fixedDeltaSeconds * 2;
      steerHand(counter, wanted);
    }

    // The commit is a *release* — a key let go, a finger lifted — so it is one binary event
    // with a timestamp for every input family, and neither can express it more finely than
    // the other. See SPEC.md, "Placing is a release, never a tap".
    if (seatInput.actionReleased) commit(counter);
  }

  /* ------------------------------------------------------------ interpolation */

  #remember(): void {
    this.#prevHand[0] = this.#state.p1Counter.hand;
    this.#prevHand[1] = this.#state.p2Counter.hand;
  }

  #handAt(seat: SeatId, alpha: number): number {
    const counter = counterOf(this.#state, seat);
    const previous = this.#prevHand[seat === 'p1' ? 0 : 1] ?? counter.hand;
    return previous + (counter.hand - previous) * alpha;
  }

  /* ------------------------------------------------------------------ drawing */

  /** Seat two's counter is the half-turn image of seat one's, in both axes. */
  #mx(seat: SeatId, x: number): number {
    return seat === 'p1' ? x : BOARD_WIDTH - x;
  }

  #my(seat: SeatId, y: number): number {
    return seat === 'p1' ? y : BOARD_HEIGHT - y;
  }

  /**
   * Seconds left, as a bar on each side margin growing out from the middle of the board.
   *
   * One object, shared, and symmetric under the half-turn, so neither player is nearer to it
   * than the other. The clock is the game's own — the shell has no idea this match has one.
   */
  #drawClock(renderer: Renderer): void {
    const share = secondsLeft(this.#state) / MATCH_SECONDS;
    const half = (BOARD_HEIGHT / 2 - 40) * share;
    const mid = BOARD_HEIGHT / 2;
    renderer.rect(10, mid - half, 7, half * 2, COLOUR_CHALK);
    renderer.rect(BOARD_WIDTH - 17, mid - half, 7, half * 2, COLOUR_CHALK);
  }

  #drawCounter(renderer: Renderer, seat: SeatId, alpha: number): void {
    const counter = counterOf(this.#state, seat);
    this.#drawPizza(renderer, seat, counter);
    this.#drawRail(renderer, seat, counter);
    this.#drawHand(renderer, seat, alpha);
  }

  /** The pizza itself: the seat's own silhouette, its crust, and the seam at the first slot. */
  #drawPizza(renderer: Renderer, seat: SeatId, counter: Readonly<Counter>): void {
    const palette = SEAT_PALETTE[seat];
    const cx = this.#mx(seat, PIZZA_CX);
    const cy = this.#my(seat, PIZZA_CY);

    if (seat === 'p1') {
      renderer.circle(cx, cy, PIZZA_R, palette.tint);
      renderer.circle(cx, cy, PIZZA_R - CRUST_WIDTH, COLOUR_DOUGH);
      renderer.strokeCircle(cx, cy, PIZZA_R - CRUST_WIDTH / 2, CRUST_WIDTH, palette.base);
    } else {
      const half = PIZZA_HALF;
      const inner = half - CRUST_WIDTH;
      renderer.rect(cx - half, cy - half, half * 2, half * 2, palette.tint);
      renderer.rect(cx - inner, cy - inner, inner * 2, inner * 2, COLOUR_DOUGH);
      const mid = half - CRUST_WIDTH / 2;
      renderer.strokeRect(cx - mid, cy - mid, mid * 2, mid * 2, CRUST_WIDTH, palette.base);
    }

    // Where the order starts. A pizza is a ring and a ring has no beginning, so the seam is
    // drawn rather than left to be guessed at.
    const seamX = this.#slotX(seat, counter.length, 0);
    const seamY = this.#slotY(seat, counter.length, 0);
    renderer.line(cx, cy, seamX, seamY, 3, COLOUR_INK);

    const shown = revealedCount(counter);
    for (let slot = 0; slot < counter.length; slot += 1) {
      const x = this.#slotX(seat, counter.length, slot);
      const y = this.#slotY(seat, counter.length, slot);
      const revealing = counter.phase === PHASE_WATCH;
      const topping = revealing
        ? slot < shown
          ? (counter.order[slot] ?? EMPTY_SLOT)
          : EMPTY_SLOT
        : (counter.placed[slot] ?? EMPTY_SLOT);

      if (topping === EMPTY_SLOT) this.#seatOutline(renderer, seat, x, y, SLOT_PLATE, palette.soft);
      else {
        this.#seatOutline(renderer, seat, x, y, SLOT_PLATE, palette.deep);
        this.#drawTopping(renderer, topping, x, y);
      }
      // The slot the next topping goes in, marked in the seat's own outline so a player never
      // has to count round the ring to find their place.
      if (counter.phase === PHASE_BUILD && slot === counter.placedCount) {
        this.#seatOutline(renderer, seat, x, y, SLOT_PLATE + 8, palette.base);
      }
    }

    if (counter.phase === PHASE_SERVE) this.#drawVerdict(renderer, seat, counter, cx, cy);
  }

  /**
   * How the last ticket went, told by shape first.
   *
   * Served is a second ring outside the crust, in the seat's own outline. Spoiled is a cross
   * struck through the pizza. A player reads which of the two happened without any colour,
   * and without any word.
   */
  #drawVerdict(
    renderer: Renderer,
    seat: SeatId,
    counter: Readonly<Counter>,
    cx: number,
    cy: number,
  ): void {
    if (counter.lastVerdict > 0) {
      this.#seatOutline(renderer, seat, cx, cy, PIZZA_R + 16, SEAT_PALETTE[seat].base);
      return;
    }
    if (counter.lastVerdict < 0) {
      const reach = PIZZA_R * 0.72;
      renderer.line(cx - reach, cy - reach, cx + reach, cy + reach, 9, COLOUR_SPOILED);
      renderer.line(cx + reach, cy - reach, cx - reach, cy + reach, 9, COLOUR_SPOILED);
    }
  }

  /** The ingredient rail, and the bell at the end of it. */
  #drawRail(renderer: Renderer, seat: SeatId, counter: Readonly<Counter>): void {
    const palette = SEAT_PALETTE[seat];
    const y = this.#my(seat, RAIL_Y);
    const from = railX(seat, 0);
    const to = railX(seat, STATION_COUNT - 1);
    renderer.line(from, y, to, y, 4, palette.deep);

    for (let station = 0; station < STATION_COUNT; station += 1) {
      const x = railX(seat, station);
      this.#seatOutline(renderer, seat, x, y, STATION_PLATE, palette.deep);
      if (station === BELL_STATION) this.#drawBell(renderer, x, y, counter);
      else this.#drawTopping(renderer, station, x, y);
    }
  }

  /** A dome with a clapper under it. Ink only, so it is a shape and never a colour. */
  #drawBell(renderer: Renderer, x: number, y: number, counter: Readonly<Counter>): void {
    const ready = counter.phase === PHASE_BUILD && counter.placedCount === counter.length;
    const ink = ready ? COLOUR_DOUGH : COLOUR_INK;
    renderer.circle(x, y - 3, 13, ink);
    renderer.rect(x - 16, y + 6, 32, 5, ink);
    renderer.circle(x, y + 14, 4, ink);
  }

  /** The hand, riding between the rail and the pizza in the seat's own silhouette. */
  #drawHand(renderer: Renderer, seat: SeatId, alpha: number): void {
    const palette = SEAT_PALETTE[seat];
    const station = this.#handAt(seat, alpha);
    const localX = railX(seat, 0) + (seat === 'p1' ? 1 : -1) * RAIL_PITCH * station;
    const y = this.#my(seat, HAND_Y);
    if (seat === 'p1') renderer.circle(localX, y, HAND_R, palette.base);
    else
      renderer.rect(localX - HAND_HALF, y - HAND_HALF, HAND_HALF * 2, HAND_HALF * 2, palette.base);
    renderer.line(localX, y, localX, this.#my(seat, RAIL_Y), 3, palette.deep);
  }

  /**
   * A ring for seat one and a box for seat two, everywhere. Rule 7, in one place.
   *
   * Seat one never strokes a rectangle and seat two never strokes a circle, in this whole
   * file — which is what makes the two seats different *primitives* rather than two sizes of
   * one, the strongest evidence rule 7 names.
   */
  #seatOutline(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    colour: string,
  ): void {
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, radius, 4, colour);
      return;
    }
    const half = (radius * Math.sqrt(Math.PI)) / 2;
    renderer.strokeRect(x - half, y - half, half * 2, half * 2, 4, colour);
  }

  /** Where slot `slot` of a `length`-slot pizza sits: round the ring, starting at the seam. */
  #slotX(seat: SeatId, length: number, slot: number): number {
    const angle = -Math.PI / 2 + (slot / length) * Math.PI * 2;
    return this.#mx(seat, PIZZA_CX + Math.cos(angle) * SLOT_ORBIT);
  }

  #slotY(seat: SeatId, length: number, slot: number): number {
    const angle = -Math.PI / 2 + (slot / length) * Math.PI * 2;
    return this.#my(seat, PIZZA_CY + Math.sin(angle) * SLOT_ORBIT);
  }

  /**
   * Five toppings, five silhouettes: a disc, a ring, a block, a wedge and a bar.
   *
   * Nothing here is told by colour. The olive's hole is a second disc in the dough's own
   * shade rather than a stroked circle, so seat two never strokes a circle and seat one never
   * strokes a rectangle — see {@link PizzaMemoryGame.#seatOutline}.
   */
  #drawTopping(renderer: Renderer, kind: number, x: number, y: number): void {
    const colour = KIND_COLOUR[kind] ?? COLOUR_INK;
    const reach = GLYPH_R;
    switch (kind) {
      case 0:
        renderer.circle(x, y, reach, colour);
        return;
      case 1:
        renderer.circle(x, y, reach, colour);
        renderer.circle(x, y, reach * 0.45, COLOUR_DOUGH);
        return;
      case 2:
        renderer.rect(x - reach, y - reach, reach * 2, reach * 2, colour);
        return;
      case 3:
        renderer.line(x - reach, y + reach * 0.8, x + reach, y + reach * 0.8, 5, colour);
        renderer.line(x - reach, y + reach * 0.8, x, y - reach, 5, colour);
        renderer.line(x + reach, y + reach * 0.8, x, y - reach, 5, colour);
        return;
      default:
        renderer.line(x - reach, y, x + reach, y, 10, colour);
    }
  }

  /** Exported for the tests: how many topping kinds this file knows how to draw. */
  static get kindCount(): number {
    return KIND_COUNT;
  }
}
