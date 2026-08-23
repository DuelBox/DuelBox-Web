import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ACROSS_LIMIT,
  BARRIER_HALF_LENGTH,
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  CLEAR,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  RACE_DISTANCE,
  ROAD_HALF_WIDTH,
  SPIN_SECONDS,
  VISIBLE_AHEAD,
  VISIBLE_CELLS,
  barrierAlong,
  botAim,
  carOf,
  cellOf,
  clearMatch,
  createBotState,
  createMatch,
  gateAt,
  gateHalf,
  gateNarrow,
  gateSlot,
  postsOf,
  resetBotState,
  resetMatch,
  slotAcross,
  steerFor,
  stepMatch,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Car, Match } from './rules.js';

/**
 * Racing Cars — a road each, one track, and one thing to say to your car: where across the
 * road to be.
 *
 * The rules module holds the whole simulation. What lives here is how a person says "over
 * there" through it, and how two windows on the same track are drawn one above the other.
 */

const COLOUR_NIGHT = '#070a12';
/** The near seat's half is the lighter of the two, so which half is yours survives grey. */
const COLOUR_VERGE_NEAR = '#101a2c';
const COLOUR_VERGE_FAR = '#080e1a';
const COLOUR_ROAD = '#232c3f';
const COLOUR_KERB = '#e8eefb';
const COLOUR_KERB_ALT = '#7d8aa6';
const COLOUR_DASH = 'rgba(232, 238, 251, 0.26)';
const COLOUR_BARRIER = '#d8b26a';
const COLOUR_BARRIER_EDGE = '#8a6524';
const COLOUR_POST = '#f2f6ff';
const COLOUR_DIVIDER = '#eef2fb';
const COLOUR_BONE = '#eef2fb';
const COLOUR_INK = '#070a12';
const COLOUR_TRACK = 'rgba(7, 10, 18, 0.68)';

/** Half the box, which is one seat's window on the track. */
export const BAND_TOP = COURSE_HEIGHT / 2;
export const CENTRE_X = COURSE_WIDTH / 2;

/** Everything below is in the *near* seat's frame; {@link flipY} puts the far seat's in. */
export const ROAD_LEFT = CENTRE_X - ROAD_HALF_WIDTH;
export const ROAD_RIGHT = CENTRE_X + ROAD_HALF_WIDTH;

/** Where the car sits in the window. The track scrolls past it. */
export const CAR_SCREEN_Y = 906;
/** The furthest point up the road the window reaches, just inside the divider. */
export const VIEW_TOP_Y = 506;

/**
 * Logical screen units per track unit, along the road.
 *
 * The one place the track's own axis meets the picture, and the only reason it is not 1:1
 * is that a seat's window is four hundred units tall and has to hold {@link VISIBLE_AHEAD}
 * units of road. Nothing in the simulation knows this number — it is a mapping between two
 * sets of *logical* units, not a device measurement, and both seats get the identical one,
 * so neither ever sees more of the road than the other (rule 9).
 */
export const VIEW_SCALE = (CAR_SCREEN_Y - VIEW_TOP_Y) / VISIBLE_AHEAD;

/** How much road behind the car still fits on screen, in track units. */
const VIEW_BEHIND = (COURSE_HEIGHT - CAR_SCREEN_Y) / VIEW_SCALE;

/** Kerb blocks and centre dashes, measured along the track so they scroll at road speed. */
const KERB_PITCH = 120;
const KERB_LENGTH = 60;
const KERB_WIDTH = 12;
const DASH_PITCH = 160;
const DASH_LENGTH = 80;

/** The car, drawn. Its width is its own; its length is its collision length, foreshortened. */
const CAR_WIDTH = CAR_HALF_WIDTH * 2;
const CAR_LENGTH = CAR_HALF_LENGTH * 2 * VIEW_SCALE;
const BARRIER_DEPTH = BARRIER_HALF_LENGTH * 2 * VIEW_SCALE;

/** The two gauges down the margins either side of the road. */
const GAUGE_TOP_Y = 524;
const GAUGE_BOTTOM_Y = 976;
const GAUGE_WIDTH = 18;
const GAUGE_OWN_X = 6;
const GAUGE_RIVAL_X = COURSE_WIDTH - GAUGE_OWN_X - GAUGE_WIDTH;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The far seat reads the device upside down, so its window is the near seat's turned half a
 * turn about the centre of the box.
 *
 * Point symmetry rather than a mirror, and that is the whole of the seat handling: every
 * shape below is authored once in the near seat's frame and mapped through these. So each
 * player's car sits at the edge of the box nearest them, the road comes towards them, and
 * `across` means "towards my own right" for both of them — neither the simulation nor the
 * input mapping knows which presentation is running, because the board is symmetric under
 * the rotation.
 */
function flipX(seat: SeatId, x: number): number {
  return seat === 'p1' ? x : COURSE_WIDTH - x;
}

function flipY(seat: SeatId, y: number): number {
  return seat === 'p1' ? y : COURSE_HEIGHT - y;
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
  if (width <= 0 || height <= 0) return;
  if (seat === 'p1') renderer.rect(x, y, width, height, colour);
  // A rect is anchored at its top-left, and half a turn moves that corner to the far
  // one — so the rotated origin is the *opposite* corner, not the mapped original.
  else renderer.rect(COURSE_WIDTH - x - width, COURSE_HEIGHT - y - height, width, height, colour);
}

/**
 * A rect clipped to the near seat's own half before it is mapped.
 *
 * Every shape that scrolls — the road markings, the barriers, the finish line — is placed
 * from a car's distance and would otherwise run off the top of its own window and into the
 * other player's. Clipping here rather than at each call site is what makes "no seat ever
 * draws into the other's half" a property of the drawing rather than of remembering.
 */
function bandRect(
  renderer: Renderer,
  seat: SeatId,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string,
): void {
  const top = y < BAND_TOP ? BAND_TOP : y;
  const bottom = y + height > COURSE_HEIGHT ? COURSE_HEIGHT : y + height;
  fillRect(renderer, seat, x, top, width, bottom - top, colour);
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

/** Where a point on the track lands in a window whose car is at `distance`. */
export function trackToScreenY(along: number, distance: number): number {
  return CAR_SCREEN_Y - (along - distance) * VIEW_SCALE;
}

/** Where across the road a seat's finger is pointing, in that seat's own frame. */
export function pointerAcross(seat: SeatId, x: number): number {
  const own = seat === 'p1' ? x - CENTRE_X : CENTRE_X - x;
  if (!Number.isFinite(own)) return 0;
  return own > ACROSS_LIMIT ? ACROSS_LIMIT : own < -ACROSS_LIMIT ? -ACROSS_LIMIT : own;
}

export class RacingCarsGame implements Game {
  readonly #match: Match = createMatch();
  readonly #p1Brain: BotState = createBotState();
  readonly #p2Brain: BotState = createBotState();

  #rng = new Rng(1);
  #p1Tier: BotDifficulty | null = null;
  #p2Tier: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /** Read-only view for the tests and the balance harness. Never mutate through it. */
  get match(): Match {
    return this.#match;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#p1Tier = context.botDifficulty('p1');
    this.#p2Tier = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#p1Brain);
    resetBotState(this.#p2Brain);
    // The track is drawn from the generator before any bot has spent a draw on it, so two
    // matches on one seed race the identical road whoever is sitting in either seat.
    resetMatch(this.#match, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    const p1 = this.#steerOf('p1', input, fixedDeltaSeconds);
    const p2 = this.#steerOf('p2', input, fixedDeltaSeconds);
    stepMatch(this.#match, fixedDeltaSeconds, p1, p2);
    this.#winner = winnerOf(this.#match);
  }

  /**
   * What one seat is asking of its car this step, as steering in [-1, 1].
   *
   * The three sources say the same thing in three ways and all three end at the same
   * `STEER_SPEED`: a finger and a bot name a point and go through {@link steerFor},
   * and a key names a sign that goes straight into the same integrator. None of them can
   * steer harder, sooner or finer than another.
   *
   * How far up or down its own half a finger is does not matter and is never read. The one
   * thing this game asks is how far *across* the road to be, so a thumb resting low and a
   * thumb reaching high say exactly the same thing.
   *
   * **A finger names a point.** It is the genre's own instruction — move your finger to
   * drive the car — and an absolute ask cannot get out of step with the car the way a
   * toggle can. It is read in the seat's own frame, so each player's finger is under their
   * own car: the two are looking at the same road from opposite ends of the room.
   *
   * **Keys name a direction, and need no mirror.** That is the part worth noticing. `D` is
   * seat one's right and the right arrow is seat two's right whichever way up either of
   * them is sitting, and `across` already means "towards this driver's own right" — so the
   * keyboard path is one line for both seats and cannot get the mirror wrong.
   */
  #steerOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): number {
    const car = carOf(this.#match, seat);
    const tier = seat === 'p1' ? this.#p1Tier : this.#p2Tier;
    if (tier !== null) {
      const brain = seat === 'p1' ? this.#p1Brain : this.#p2Brain;
      const aim = botAim(this.#match, seat, tier, brain, fixedDeltaSeconds, this.#rng);
      return steerFor(car.across, aim);
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) return steerFor(car.across, pointerAcross(seat, pointer.x));
    return seatInput.move.x;
  }

  getActiveSeat(): SeatId | null {
    // Never: both cars are live at once, so the shell keeps a pointer zone for each seat.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: postsOf(this.#match.p1),
      p2: postsOf(this.#match.p2),
      winner: this.#winner,
    };
  }

  /**
   * Nothing to settle either way.
   *
   * Steering is read fresh from the instrument on every step and never latched, so there is
   * no held intent that could survive a pause and steer the car on the first step back. The
   * engine drops its own keys and pointers, and a car with nobody asking anything of it
   * simply holds its line. Both methods exist because the contract asks for them.
   */
  onPause(): void {}

  onResume(): void {}

  destroy(): void {
    this.#p1Tier = null;
    this.#p2Tier = null;
    this.#winner = null;
    resetBotState(this.#p1Brain);
    resetBotState(this.#p2Brain);
    clearMatch(this.#match);
  }

  /**
   * Draws the state as it stands.
   *
   * The interpolation alpha the contract offers is deliberately not read. Every moving
   * thing here — the car's distance along the track, how far across the road it is — is
   * already a continuous value the simulation carries at full resolution, so a frame is the
   * state as it stands rather than a guess between two of them.
   */
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    this.#drawWindow(renderer, 'p1');
    this.#drawWindow(renderer, 'p2');
    // The line between the two windows. Both seats' road runs away from their own edge of
    // the device, so without it the middle of the screen reads as one very long road.
    renderer.rect(0, BAND_TOP - 2, COURSE_WIDTH, 4, COLOUR_DIVIDER);
  }

  #drawWindow(renderer: Renderer, seat: SeatId): void {
    const car = carOf(this.#match, seat);
    fillRect(
      renderer,
      seat,
      0,
      BAND_TOP,
      COURSE_WIDTH,
      COURSE_HEIGHT - BAND_TOP,
      seat === 'p1' ? COLOUR_VERGE_NEAR : COLOUR_VERGE_FAR,
    );
    fillRect(
      renderer,
      seat,
      ROAD_LEFT,
      BAND_TOP,
      ROAD_RIGHT - ROAD_LEFT,
      COURSE_HEIGHT - BAND_TOP,
      COLOUR_ROAD,
    );

    this.#drawMarkings(renderer, seat, car);
    this.#drawBarriers(renderer, seat, car);
    this.#drawFinish(renderer, seat, car);
    this.#drawCar(renderer, seat, car);
    this.#drawGauges(renderer, seat);
  }

  /**
   * Kerb blocks down both edges and dashes down the middle.
   *
   * Measured along the track rather than on screen, so they scroll at exactly the speed the
   * car is doing — the only thing in the picture that says how fast you are going, and it
   * says it in motion rather than in colour. A crashed car crawling is instantly legible
   * because the road nearly stops.
   */
  #drawMarkings(renderer: Renderer, seat: SeatId, car: Readonly<Car>): void {
    const from = car.distance - VIEW_BEHIND;
    const to = car.distance + VISIBLE_AHEAD;
    const firstKerb = Math.floor(from / KERB_PITCH);
    const lastKerb = Math.ceil(to / KERB_PITCH);
    for (let block = firstKerb; block <= lastKerb; block += 1) {
      const head = block * KERB_PITCH;
      const y = trackToScreenY(head + KERB_LENGTH, car.distance);
      const height = KERB_LENGTH * VIEW_SCALE;
      const colour = (block & 1) === 0 ? COLOUR_KERB : COLOUR_KERB_ALT;
      bandRect(renderer, seat, ROAD_LEFT - KERB_WIDTH, y, KERB_WIDTH, height, colour);
      bandRect(renderer, seat, ROAD_RIGHT, y, KERB_WIDTH, height, colour);
    }

    const firstDash = Math.floor(from / DASH_PITCH);
    const lastDash = Math.ceil(to / DASH_PITCH);
    for (let dash = firstDash; dash <= lastDash; dash += 1) {
      const head = dash * DASH_PITCH;
      const y = trackToScreenY(head + DASH_LENGTH, car.distance);
      bandRect(renderer, seat, CENTRE_X - 3, y, 6, DASH_LENGTH * VIEW_SCALE, COLOUR_DASH);
    }
  }

  /**
   * The barriers inside this seat's window.
   *
   * Every one is placed from the car's own distance, so the road slides continuously rather
   * than stepping a cell at a time, and the window is the same depth for both seats.
   *
   * Rule 7: a barrier is not a coloured bar. Its two halves are hatched with vertical
   * teeth and the mouth of the gap is posted on both sides in bone white, so the way
   * through is legible in silhouette, in greyscale, and to a player who cannot tell the
   * barrier's colour from the road's.
   */
  #drawBarriers(renderer: Renderer, seat: SeatId, car: Readonly<Car>): void {
    const first = cellOf(car.distance - VIEW_BEHIND) - 1;
    const last = cellOf(car.distance) + VISIBLE_CELLS + 1;
    for (let cell = first; cell <= last; cell += 1) {
      const gate = gateAt(this.#match.track, cell);
      if (gate === CLEAR) continue;
      const centre = trackToScreenY(barrierAlong(cell), car.distance);
      const top = centre - BARRIER_DEPTH / 2;
      if (top > COURSE_HEIGHT || top + BARRIER_DEPTH < BAND_TOP) continue;

      const mouth = CENTRE_X + slotAcross(gateSlot(gate));
      const half = gateHalf(gate);
      const leftEnd = mouth - half;
      const rightEnd = mouth + half;
      bandRect(renderer, seat, ROAD_LEFT, top, leftEnd - ROAD_LEFT, BARRIER_DEPTH, COLOUR_BARRIER);
      bandRect(renderer, seat, rightEnd, top, ROAD_RIGHT - rightEnd, BARRIER_DEPTH, COLOUR_BARRIER);
      // Teeth, so a barrier reads as a hazard rather than as a stripe of paint.
      for (let tooth = ROAD_LEFT + 8; tooth < leftEnd - 4; tooth += 22) {
        bandRect(renderer, seat, tooth, top, 5, BARRIER_DEPTH, COLOUR_BARRIER_EDGE);
      }
      for (let tooth = rightEnd + 8; tooth < ROAD_RIGHT - 4; tooth += 22) {
        bandRect(renderer, seat, tooth, top, 5, BARRIER_DEPTH, COLOUR_BARRIER_EDGE);
      }
      // The posts either side of the gap, and a narrow gate carries a second pair inside
      // its own mouth so the two widths differ in shape and not only in span.
      bandRect(renderer, seat, leftEnd - 7, top, 7, BARRIER_DEPTH, COLOUR_POST);
      bandRect(renderer, seat, rightEnd, top, 7, BARRIER_DEPTH, COLOUR_POST);
      if (!gateNarrow(gate)) continue;
      bandRect(renderer, seat, leftEnd + 9, top, 4, BARRIER_DEPTH / 2, COLOUR_POST);
      bandRect(renderer, seat, rightEnd - 13, top, 4, BARRIER_DEPTH / 2, COLOUR_POST);
    }
  }

  /** The line, once it is in sight. Chequers rather than a word, so it needs no language. */
  #drawFinish(renderer: Renderer, seat: SeatId, car: Readonly<Car>): void {
    const y = trackToScreenY(RACE_DISTANCE, car.distance);
    if (y < BAND_TOP - 13 || y > COURSE_HEIGHT) return;
    const squares = 8;
    const width = (ROAD_RIGHT - ROAD_LEFT) / squares;
    for (let i = 0; i < squares; i += 1) {
      const shade = (i & 1) === 0 ? COLOUR_BONE : COLOUR_INK;
      const alt = shade === COLOUR_BONE ? COLOUR_INK : COLOUR_BONE;
      bandRect(renderer, seat, ROAD_LEFT + i * width, y - 13, width, 13, shade);
      bandRect(renderer, seat, ROAD_LEFT + i * width, y, width, 13, alt);
    }
  }

  /**
   * The car, driving or spinning.
   *
   * Rule 7: the near seat drives a pointed wedge with a stripe down its spine; the far seat
   * drives a blunt car with a rear wing and a chequered roof. Two cars in two windows are
   * rarely confused, but a screenshot in greyscale still has to say which is which, and so
   * does a player who cannot tell red from blue.
   */
  #drawCar(renderer: Renderer, seat: SeatId, car: Readonly<Car>): void {
    const palette = SEAT_PALETTE[seat];
    const x = CENTRE_X + car.across;
    const left = x - CAR_HALF_WIDTH;
    const nose = CAR_SCREEN_Y - CAR_LENGTH / 2;
    const tail = CAR_SCREEN_Y + CAR_LENGTH / 2;
    const body = car.spin > 0 ? palette.deep : palette.base;

    fillRect(renderer, seat, left, nose, CAR_WIDTH, CAR_LENGTH, body);
    if (seat === 'p1') {
      // A pointed nose: two lines meeting ahead of the body, and a spine stripe.
      stroke(renderer, seat, left, nose, x, nose - 17, 6, body);
      stroke(renderer, seat, x + CAR_HALF_WIDTH, nose, x, nose - 17, 6, body);
      fillRect(renderer, seat, x - 5, nose, 10, CAR_LENGTH, COLOUR_INK);
    } else {
      // A blunt front, a rear wing, and a chequered roof.
      fillRect(renderer, seat, left, nose - 8, CAR_WIDTH, 8, body);
      fillRect(renderer, seat, left - 5, tail - 10, CAR_WIDTH + 10, 10, body);
      fillRect(renderer, seat, x - 14, CAR_SCREEN_Y - 14, 14, 14, COLOUR_INK);
      fillRect(renderer, seat, x, CAR_SCREEN_Y, 14, 14, COLOUR_INK);
    }

    if (car.spin <= 0) return;

    // Struck through, and a bar beside it saying how long there is left of the spin. Being
    // out of control for a second is the single most important thing the screen ever has to
    // tell a driver, so it is said three times over — in colour, in shape, and in length.
    stroke(renderer, seat, left, nose, x + CAR_HALF_WIDTH, tail, 6, COLOUR_BONE);
    stroke(renderer, seat, left, tail, x + CAR_HALF_WIDTH, nose, 6, COLOUR_BONE);
    const recovered = clamp01(1 - car.spin / SPIN_SECONDS);
    fillRect(renderer, seat, CENTRE_X - 60, nose - 34, 120, 9, COLOUR_TRACK);
    fillRect(renderer, seat, CENTRE_X - 60, nose - 34, 120 * recovered, 9, COLOUR_BONE);
  }

  /**
   * How far along both cars are, as two gauges down this seat's own margins.
   *
   * The shell's HUD prints both numbers. What it cannot give a driver mid-corner is *how
   * close the race is* without reading two of them, so each seat gets its own gauge on its
   * left and its rival's on its right, both filling from that seat's own end of the box.
   * Both seats are shown both gauges, so neither reads anything the other cannot (rule 9).
   */
  #drawGauges(renderer: Renderer, seat: SeatId): void {
    this.#drawGauge(renderer, seat, GAUGE_OWN_X, seat, false);
    this.#drawGauge(renderer, seat, GAUGE_RIVAL_X, seat === 'p1' ? 'p2' : 'p1', true);
  }

  #drawGauge(renderer: Renderer, seat: SeatId, x: number, of: SeatId, hatched: boolean): void {
    const palette = SEAT_PALETTE[of];
    const span = GAUGE_BOTTOM_Y - GAUGE_TOP_Y;
    const filled = span * clamp01(carOf(this.#match, of).distance / RACE_DISTANCE);

    fillRect(renderer, seat, x, GAUGE_TOP_Y, GAUGE_WIDTH, span, COLOUR_TRACK);
    fillRect(renderer, seat, x, GAUGE_BOTTOM_Y - filled, GAUGE_WIDTH, filled, palette.base);
    if (hatched) {
      // Hatched rather than solid — rule 7 again, so the two gauges differ by pattern as
      // well as by colour and by which margin they are in.
      for (let y = GAUGE_BOTTOM_Y - filled + 4; y < GAUGE_BOTTOM_Y - 2; y += 12) {
        fillRect(renderer, seat, x, y, GAUGE_WIDTH, 4, COLOUR_INK);
      }
    }
    for (let quarter = 1; quarter < 4; quarter += 1) {
      const y = GAUGE_BOTTOM_Y - (span * quarter) / 4;
      stroke(renderer, seat, x - 3, y, x + GAUGE_WIDTH + 3, y, 2, COLOUR_DIVIDER);
    }
  }
}
