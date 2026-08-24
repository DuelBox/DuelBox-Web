import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ACROSS_LIMIT,
  CLEAR,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  HOP_AIM,
  HOP_LENGTH,
  JAM,
  LANES,
  RACE_DISTANCE,
  ROAD_HALF_WIDTH,
  SETTLE_SECONDS,
  SPIN_SECONDS,
  TAXI_HALF_LENGTH,
  TAXI_HALF_WIDTH,
  TRAFFIC_HALF_LENGTH,
  TRAFFIC_HALF_WIDTH,
  VISIBLE_AHEAD,
  VISIBLE_CELLS,
  blocksOf,
  botDrive,
  canHop,
  cellOf,
  clearMatch,
  createBotState,
  createMatch,
  laneAcross,
  laneBlocked,
  maskAt,
  resetBotState,
  resetMatch,
  steerFor,
  stepMatch,
  taxiOf,
  trafficAlong,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Match, Taxi } from './rules.js';

/**
 * Taxi Race — a window on the same city road each, and two things to say to your taxi:
 * which lane to be in, and *now*.
 *
 * The rules module holds the whole simulation. What lives here is how a person says those
 * two things through three instruments, and how two windows on one road are drawn one above
 * the other.
 */

const COLOUR_NIGHT = '#06090f';
/** The near seat's verge is the lighter of the two, so which half is yours survives grey. */
const COLOUR_VERGE_NEAR = '#131c26';
const COLOUR_VERGE_FAR = '#0a1017';
const COLOUR_ROAD = '#242b36';
const COLOUR_KERB = '#eef3fa';
const COLOUR_KERB_ALT = '#77839a';
const COLOUR_LANE = 'rgba(238, 243, 250, 0.24)';
const COLOUR_TRAFFIC = '#8f9bb3';
const COLOUR_TRAFFIC_DEEP = '#59637a';
const COLOUR_GLASS = '#2e3646';
const COLOUR_LAMP = '#ffd23f';
const COLOUR_RAMP = '#ffd23f';
const COLOUR_RAMP_EDGE = '#8a6a10';
const COLOUR_DIVIDER = '#eef3fa';
const COLOUR_BONE = '#eef3fa';
const COLOUR_INK = '#06090f';
const COLOUR_SHADE = 'rgba(6, 9, 15, 0.55)';
const COLOUR_STRIP = 'rgba(6, 9, 15, 0.72)';

/** Half the box, which is one seat's window on the road. */
export const BAND_TOP = COURSE_HEIGHT / 2;
export const CENTRE_X = COURSE_WIDTH / 2;

/** Everything below is in the *near* seat's frame; {@link flipY} puts the far seat's in. */
export const ROAD_LEFT = CENTRE_X - ROAD_HALF_WIDTH;
export const ROAD_RIGHT = CENTRE_X + ROAD_HALF_WIDTH;

/** Where the taxi sits in the window. The road scrolls past it. */
export const TAXI_SCREEN_Y = 910;
/** The furthest point up the road the window reaches, just inside the divider. */
export const VIEW_TOP_Y = 510;

/**
 * Logical screen units per track unit, along the road.
 *
 * The one place the road's own axis meets the picture, and the only reason it is not 1:1 is
 * that a seat's window is four hundred units tall and has to hold {@link VISIBLE_AHEAD}
 * units of road. Nothing in the simulation knows this number — it is a mapping between two
 * sets of *logical* units, not a device measurement, and both seats get the identical one,
 * so neither ever sees more of the road than the other (rule 9).
 */
export const VIEW_SCALE = (TAXI_SCREEN_Y - VIEW_TOP_Y) / VISIBLE_AHEAD;

/** How much road behind the taxi still fits on screen, in track units. */
const VIEW_BEHIND = (COURSE_HEIGHT - TAXI_SCREEN_Y) / VIEW_SCALE;

/**
 * How far up their own half a finger must travel to read as a hop, in logical units.
 *
 * A fifth of the depth of a seat's band, which is far enough that sliding across to change
 * lane never reads as a flick and short enough to be one flick of a thumb. It is an input
 * measurement in the device's own logical frame, not a simulation value — the taxi never
 * sees it (rule 8).
 */
export const SWIPE_RISE = 90;

/** Kerb blocks and lane dashes, measured along the road so they scroll at road speed. */
const KERB_PITCH = 120;
const KERB_LENGTH = 60;
const KERB_WIDTH = 12;
const DASH_PITCH = 180;
const DASH_LENGTH = 90;

/** The taxi and the traffic, drawn. Lengths are foreshortened by {@link VIEW_SCALE}. */
const TAXI_WIDTH = TAXI_HALF_WIDTH * 2;
const TAXI_LENGTH = TAXI_HALF_LENGTH * 2 * VIEW_SCALE;
const TRAFFIC_WIDTH = TRAFFIC_HALF_WIDTH * 2;
const TRAFFIC_DEPTH = TRAFFIC_HALF_LENGTH * 2 * VIEW_SCALE;

/** How high a hop lifts the taxi off the picture, and how much bigger it draws at the top. */
const HOP_LIFT = 52;
const HOP_SWELL = 0.3;

/** The route strip along the seat's own edge, below its taxi. */
const STRIP_Y = 962;
const STRIP_HEIGHT = 22;
const STRIP_LEFT = 96;
const STRIP_RIGHT = COURSE_WIDTH - 24;
/** The hop pip, left of the strip: filled when a hop is there to be taken. */
const PIP_X = 30;
const PIP_WIDTH = 48;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The far seat reads the device upside down, so its window is the near seat's turned half a
 * turn about the centre of the box.
 *
 * Point symmetry rather than a mirror, and that is the whole of the seat handling: every
 * shape below is authored once in the near seat's frame and mapped through these. So each
 * player's taxi sits at the edge of the box nearest them, the road comes towards them, and
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
 * Every shape that scrolls — the road markings, the traffic, the finish line — is placed
 * from a taxi's distance and would otherwise run off the top of its own window and into the
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

/** Where a point on the road lands in a window whose taxi is at `distance`. */
export function trackToScreenY(along: number, distance: number): number {
  return TAXI_SCREEN_Y - (along - distance) * VIEW_SCALE;
}

/** Where across the road a seat's finger is pointing, in that seat's own frame. */
export function pointerAcross(seat: SeatId, x: number): number {
  const own = seat === 'p1' ? x - CENTRE_X : CENTRE_X - x;
  if (!Number.isFinite(own)) return 0;
  return own > ACROSS_LIMIT ? ACROSS_LIMIT : own < -ACROSS_LIMIT ? -ACROSS_LIMIT : own;
}

/**
 * How far *up their own road* a seat's finger is, in that seat's own frame.
 *
 * Zero at the edge of the device the player is sitting at and growing away from them, for
 * both seats — which is what makes "swipe up" one line of code rather than a mirror with a
 * side to get wrong. The two seats face each other, so the same gesture is a different
 * direction in device coordinates and the same direction in the game.
 */
export function pointerAlong(seat: SeatId, y: number): number {
  return seat === 'p1' ? COURSE_HEIGHT - y : y;
}

/**
 * What one seat's instruments have said since the last step.
 *
 * Two latches, and both exist because a hop is an *event* while steering is a *position*.
 * A finger that is merely resting somewhere high up its half is not asking to hop; a finger
 * that has just travelled up there is. A key that is being held down is not asking to hop
 * on every one of the sixty steps it is held for; the step it went down is.
 */
interface SeatFeel {
  /** Whether this seat had a finger on the glass at the end of the last step. */
  fingerDown: boolean;
  /** The lowest point up their own road the finger has reached since the flick began. */
  swipeBase: number;
  /** Whether the up key read as held at the end of the last step. */
  upHeld: boolean;
}

function createFeel(): SeatFeel {
  return { fingerDown: false, swipeBase: 0, upHeld: false };
}

function resetFeel(feel: SeatFeel): void {
  feel.fingerDown = false;
  feel.swipeBase = 0;
  feel.upHeld = false;
}

export class TaxiRaceGame implements Game {
  readonly #match: Match = createMatch();
  readonly #p1Brain: BotState = createBotState();
  readonly #p2Brain: BotState = createBotState();
  readonly #p1Feel: SeatFeel = createFeel();
  readonly #p2Feel: SeatFeel = createFeel();

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
    resetFeel(this.#p1Feel);
    resetFeel(this.#p2Feel);
    // The road is drawn from the generator before any bot has spent a draw on it, so two
    // matches on one seed face the identical traffic whoever is sitting in either seat.
    resetMatch(this.#match, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    // Both seats are read before either is stepped, so neither can be answering a road the
    // other has already moved.
    const p1Steer = this.#steerOf('p1', input, fixedDeltaSeconds);
    const p1Hop = this.#hopOf('p1', input);
    const p2Steer = this.#steerOf('p2', input, fixedDeltaSeconds);
    const p2Hop = this.#hopOf('p2', input);
    stepMatch(this.#match, fixedDeltaSeconds, p1Steer, p1Hop, p2Steer, p2Hop);
    this.#winner = winnerOf(this.#match);
  }

  /**
   * What one seat is asking of its taxi this step, as steering in [-1, 1].
   *
   * The three sources say the same thing in three ways and all three end at the same
   * `STEER_SPEED`: a finger and a bot name a point and go through {@link steerFor}, and a
   * key names a sign that goes straight into the same integrator. None of them can steer
   * harder, sooner or finer than another.
   *
   * **A finger names a point.** An absolute ask cannot get out of step with the taxi the way
   * a toggle can, and it is read in the seat's own frame, so each player's finger is under
   * their own taxi: the two are looking at the same road from opposite ends of the room. How
   * far up or down its own half the finger is never reaches the steering at all — that axis
   * belongs to the hop.
   *
   * **Keys name a direction, and need no mirror.** `D` is seat one's right and the right
   * arrow is seat two's right whichever way up either of them is sitting, and `across`
   * already means "towards this driver's own right" — so the keyboard path is one line for
   * both seats and cannot get the mirror wrong. The sign is taken rather than the raw
   * component, because holding a direction *and* the up key at the same time normalises the
   * vector, and a player who is asking to hop should not also be steering more weakly.
   */
  #steerOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): number {
    const taxi = taxiOf(this.#match, seat);
    const tier = seat === 'p1' ? this.#p1Tier : this.#p2Tier;
    if (tier !== null) {
      const brain = seat === 'p1' ? this.#p1Brain : this.#p2Brain;
      botDrive(this.#match, seat, tier, brain, fixedDeltaSeconds, this.#rng);
      return steerFor(taxi.across, brain.want);
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) return steerFor(taxi.across, pointerAcross(seat, pointer.x));
    const x = seatInput.move.x;
    return x > 0 ? 1 : x < 0 ? -1 : 0;
  }

  /**
   * Whether one seat is asking to leave the ground this step.
   *
   * Both instruments say it and **neither switches the other off** — there is no mode here,
   * and a player with a keyboard and a touchscreen may use whichever is nearer. A flick of
   * the finger up their own half is a hop, and so is the step the up key goes down.
   *
   * The finger's rule is a ratchet rather than a threshold: the base follows the finger
   * downwards and only ever moves up when a hop has been taken. So a slow slide up the half
   * costs one hop and not thirty, a slide back down arms the next one, and a finger resting
   * anywhere at all asks for nothing.
   *
   * Called after {@link #steerOf} for the same seat, which is what has already run the bot
   * for this step — so a bot's hop is the one it just planned rather than last step's.
   */
  #hopOf(seat: SeatId, input: InputState): boolean {
    const tier = seat === 'p1' ? this.#p1Tier : this.#p2Tier;
    if (tier !== null) return (seat === 'p1' ? this.#p1Brain : this.#p2Brain).hop;

    const feel = seat === 'p1' ? this.#p1Feel : this.#p2Feel;
    const seatInput = input.seat(seat);
    let hop = false;

    const pointer = seatInput.pointer;
    if (pointer === null) {
      feel.fingerDown = false;
    } else {
      const along = pointerAlong(seat, pointer.y);
      if (!Number.isFinite(along)) {
        // A browser can hand us a coordinate that is not a number. Neither steer nor hop on
        // it, and leave the ratchet where it was so the next real reading still works.
        feel.fingerDown = false;
      } else if (!feel.fingerDown) {
        feel.fingerDown = true;
        feel.swipeBase = along;
      } else if (along - feel.swipeBase >= SWIPE_RISE) {
        hop = true;
        feel.swipeBase = along;
      } else if (along < feel.swipeBase) {
        feel.swipeBase = along;
      }
    }

    const up = seatInput.move.y < -0.5;
    if (up && !feel.upHeld) hop = true;
    feel.upHeld = up;
    return hop;
  }

  getActiveSeat(): SeatId | null {
    // Never: both taxis are live at once, so the shell keeps a pointer zone for each seat.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: blocksOf(this.#match.p1),
      p2: blocksOf(this.#match.p2),
      winner: this.#winner,
    };
  }

  /**
   * Nothing to settle either way.
   *
   * Steering is read fresh from the instrument on every step and never latched, so there is
   * no held intent that could survive a pause and steer the taxi on the first step back. The
   * two hop latches are deliberately left exactly as they are: the engine drops its keys and
   * pointers on a pause, so the first step after a resume sees no finger and no key, which
   * arms nothing — whereas *clearing* the key latch would turn a key that was still held
   * down into a fresh press and hop a taxi nobody asked to hop. Both methods exist because
   * the contract asks for them.
   */
  onPause(): void {}

  onResume(): void {}

  destroy(): void {
    this.#p1Tier = null;
    this.#p2Tier = null;
    this.#winner = null;
    resetBotState(this.#p1Brain);
    resetBotState(this.#p2Brain);
    resetFeel(this.#p1Feel);
    resetFeel(this.#p2Feel);
    clearMatch(this.#match);
  }

  /**
   * Draws the state as it stands.
   *
   * The interpolation alpha the contract offers is deliberately not read. Every moving thing
   * here — the taxi's distance along the road, how far across it is, how much of a hop is
   * left — is already a continuous value the simulation carries at full resolution, so a
   * frame is the state as it stands rather than a guess between two of them.
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
    const taxi = taxiOf(this.#match, seat);
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

    this.#drawMarkings(renderer, seat, taxi);
    this.#drawTraffic(renderer, seat, taxi);
    this.#drawFinish(renderer, seat, taxi);
    this.#drawTaxi(renderer, seat, taxi);
    this.#drawStrip(renderer, seat);
  }

  /**
   * Kerb blocks down both edges and dashes down every lane line.
   *
   * Measured along the road rather than on screen, so they scroll at exactly the speed the
   * taxi is doing — the only thing in the picture that says how fast you are going, and it
   * says it in motion rather than in colour. A crashed taxi crawling is instantly legible
   * because the road nearly stops.
   */
  #drawMarkings(renderer: Renderer, seat: SeatId, taxi: Readonly<Taxi>): void {
    const from = taxi.distance - VIEW_BEHIND;
    const to = taxi.distance + VISIBLE_AHEAD;

    const firstKerb = Math.floor(from / KERB_PITCH);
    const lastKerb = Math.ceil(to / KERB_PITCH);
    for (let block = firstKerb; block <= lastKerb; block += 1) {
      const y = trackToScreenY(block * KERB_PITCH + KERB_LENGTH, taxi.distance);
      const height = KERB_LENGTH * VIEW_SCALE;
      const colour = (block & 1) === 0 ? COLOUR_KERB : COLOUR_KERB_ALT;
      bandRect(renderer, seat, ROAD_LEFT - KERB_WIDTH, y, KERB_WIDTH, height, colour);
      bandRect(renderer, seat, ROAD_RIGHT, y, KERB_WIDTH, height, colour);
    }

    const firstDash = Math.floor(from / DASH_PITCH);
    const lastDash = Math.ceil(to / DASH_PITCH);
    for (let dash = firstDash; dash <= lastDash; dash += 1) {
      const y = trackToScreenY(dash * DASH_PITCH + DASH_LENGTH, taxi.distance);
      const height = DASH_LENGTH * VIEW_SCALE;
      for (let line = 1; line < LANES; line += 1) {
        const x = CENTRE_X + (laneAcross(line) + laneAcross(line - 1)) / 2;
        bandRect(renderer, seat, x - 3, y, 6, height, COLOUR_LANE);
      }
    }
  }

  /**
   * The traffic inside this seat's window.
   *
   * Every car is placed from the taxi's own distance, so the road slides continuously rather
   * than stepping a cell at a time, and the window is the same depth for both seats.
   *
   * Rule 7: a jam is not simply "four of them rather than two". Its cars carry a hatched
   * roof no ordinary car has, and a striped ramp is painted across the road at the exact
   * point a hop has to leave from — which is the same number {@link botDrive} aims at, so
   * the picture is telling a player precisely what the bot knows and nothing more.
   */
  #drawTraffic(renderer: Renderer, seat: SeatId, taxi: Readonly<Taxi>): void {
    const first = cellOf(taxi.distance - VIEW_BEHIND) - 1;
    const last = cellOf(taxi.distance) + VISIBLE_CELLS + 1;
    for (let cell = first; cell <= last; cell += 1) {
      const mask = maskAt(this.#match.track, cell);
      if (mask === CLEAR) continue;
      const centre = trackToScreenY(trafficAlong(cell), taxi.distance);
      const top = centre - TRAFFIC_DEPTH / 2;
      if (top > COURSE_HEIGHT || top + TRAFFIC_DEPTH < BAND_TOP) continue;
      const jam = mask === JAM;

      if (jam) {
        // The launch ramp, at the middle of the window a hop has to leave from.
        const rampY = trackToScreenY(trafficAlong(cell) - HOP_AIM, taxi.distance);
        bandRect(renderer, seat, ROAD_LEFT, rampY - 7, ROAD_RIGHT - ROAD_LEFT, 14, COLOUR_RAMP);
        for (let x = ROAD_LEFT + 6; x < ROAD_RIGHT - 8; x += 34) {
          bandRect(renderer, seat, x, rampY - 7, 14, 14, COLOUR_RAMP_EDGE);
        }
      }

      for (let lane = 0; lane < LANES; lane += 1) {
        if (!laneBlocked(mask, lane)) continue;
        const x = CENTRE_X + laneAcross(lane) - TRAFFIC_WIDTH / 2;
        bandRect(renderer, seat, x, top, TRAFFIC_WIDTH, TRAFFIC_DEPTH, COLOUR_TRAFFIC);
        // A windscreen at the far end and two tail lights at the near one, so a car reads as
        // a car facing the same way as the taxi rather than as a coloured block.
        bandRect(renderer, seat, x + 8, top + 6, TRAFFIC_WIDTH - 16, 10, COLOUR_GLASS);
        bandRect(renderer, seat, x + 4, top + TRAFFIC_DEPTH - 8, 12, 5, COLOUR_TRAFFIC_DEEP);
        bandRect(
          renderer,
          seat,
          x + TRAFFIC_WIDTH - 16,
          top + TRAFFIC_DEPTH - 8,
          12,
          5,
          COLOUR_TRAFFIC_DEEP,
        );
        if (!jam) continue;
        for (let bar = 0; bar < 3; bar += 1) {
          bandRect(renderer, seat, x + 10 + bar * 18, top + 20, 8, TRAFFIC_DEPTH - 30, COLOUR_INK);
        }
      }
    }
  }

  /** The line, once it is in sight. Chequers rather than a word, so it needs no language. */
  #drawFinish(renderer: Renderer, seat: SeatId, taxi: Readonly<Taxi>): void {
    const y = trackToScreenY(RACE_DISTANCE, taxi.distance);
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
   * The taxi, driving, airborne or spinning.
   *
   * Rule 7: the near seat drives a cab with one narrow roof lamp and a solid stripe down its
   * spine; the far seat drives a cab with a wide roof lamp and a chequered flank. Two taxis
   * in two windows are rarely confused, but a screenshot in greyscale still has to say which
   * is which, and so does a player who cannot tell red from blue.
   *
   * A hop is said three times over, because "am I in the air?" is the one thing this game
   * asks a player to know: the cab lifts up its own window, it swells as it rises, and the
   * shadow it left on the road stays where the wheels would have been.
   */
  #drawTaxi(renderer: Renderer, seat: SeatId, taxi: Readonly<Taxi>): void {
    const palette = SEAT_PALETTE[seat];
    const x = CENTRE_X + taxi.across;
    const flying = taxi.hop > 0;
    // A parabola in how much of the hop is spent, so the cab rises and falls once.
    const spent = flying ? clamp01(1 - taxi.hop / HOP_LENGTH) : 0;
    const arc = flying ? 4 * spent * (1 - spent) : 0;
    const swell = 1 + HOP_SWELL * arc;
    const width = TAXI_WIDTH * swell;
    const length = TAXI_LENGTH * swell;
    const centreY = TAXI_SCREEN_Y - HOP_LIFT * arc;
    const left = x - width / 2;
    const nose = centreY - length / 2;
    const tail = centreY + length / 2;
    const body = taxi.spin > 0 ? palette.deep : palette.base;

    if (flying) {
      // The shadow the cab left behind, on the road where its wheels would be.
      fillRect(
        renderer,
        seat,
        x - TAXI_WIDTH / 2,
        TAXI_SCREEN_Y - TAXI_LENGTH / 2,
        TAXI_WIDTH,
        TAXI_LENGTH,
        COLOUR_SHADE,
      );
    }

    fillRect(renderer, seat, left, nose, width, length, body);
    // The windscreen, on both cabs, so they read as taxis before they read as seats.
    fillRect(renderer, seat, left + 9 * swell, nose + 8, width - 18 * swell, 11, COLOUR_GLASS);

    if (seat === 'p1') {
      fillRect(renderer, seat, x - 9 * swell, nose - 10, 18 * swell, 10, COLOUR_LAMP);
      fillRect(renderer, seat, x - 5 * swell, nose, 10 * swell, length, COLOUR_INK);
    } else {
      fillRect(renderer, seat, x - 17 * swell, nose - 10, 34 * swell, 10, COLOUR_LAMP);
      fillRect(renderer, seat, left, centreY - 9, 15 * swell, 9, COLOUR_INK);
      fillRect(renderer, seat, left + 15 * swell, centreY, 15 * swell, 9, COLOUR_INK);
      fillRect(renderer, seat, left + 30 * swell, centreY - 9, 15 * swell, 9, COLOUR_INK);
    }

    if (taxi.spin <= 0) return;

    // Struck through, and a bar beside it saying how long there is left of the spin. Being
    // out of control for a second is the single most important thing the screen ever has to
    // tell a driver, so it is said in colour, in shape and in length at once.
    stroke(renderer, seat, left, nose, x + width / 2, tail, 6, COLOUR_BONE);
    stroke(renderer, seat, left, tail, x + width / 2, nose, 6, COLOUR_BONE);
    const recovered = clamp01(1 - taxi.spin / SPIN_SECONDS);
    fillRect(renderer, seat, CENTRE_X - 60, nose - 34, 120, 9, COLOUR_STRIP);
    fillRect(renderer, seat, CENTRE_X - 60, nose - 34, 120 * recovered, 9, COLOUR_BONE);
  }

  /**
   * The route strip along this seat's own edge, and the hop pip beside it.
   *
   * The shell's HUD prints both block counts. What it cannot give a driver mid-corner is
   * *how close the race is* without reading two numbers, so each seat gets a strip with both
   * taxis on it — its own as a solid tab, its rival's as an open one, so the two differ by
   * pattern and not only by colour. Both seats are shown both, so neither reads anything the
   * other cannot (rule 9).
   *
   * The pip is the other half: a chevron that fills when a hop is available and empties
   * while the taxi is in the air or settling. Whether you may jump *right now* is the second
   * thing this game asks a player to know, and the taxi itself cannot say it.
   */
  #drawStrip(renderer: Renderer, seat: SeatId): void {
    const rival = seat === 'p1' ? 'p2' : 'p1';
    fillRect(
      renderer,
      seat,
      STRIP_LEFT,
      STRIP_Y,
      STRIP_RIGHT - STRIP_LEFT,
      STRIP_HEIGHT,
      COLOUR_STRIP,
    );
    for (let quarter = 1; quarter < 4; quarter += 1) {
      const x = STRIP_LEFT + ((STRIP_RIGHT - STRIP_LEFT) * quarter) / 4;
      fillRect(renderer, seat, x - 1, STRIP_Y + 4, 2, STRIP_HEIGHT - 8, COLOUR_LANE);
    }
    this.#drawTab(renderer, seat, seat, true);
    this.#drawTab(renderer, seat, rival, false);

    const taxi = taxiOf(this.#match, seat);
    const ready = canHop(taxi);
    const settling = taxi.settle > 0 ? clamp01(1 - taxi.settle / SETTLE_SECONDS) : 1;
    // An upward chevron: two strokes meeting above the strip, so the pip says *which way*
    // the gesture goes as well as whether it is armed.
    const tip = STRIP_Y - 4;
    const foot = STRIP_Y + STRIP_HEIGHT;
    const mid = PIP_X + PIP_WIDTH / 2;
    stroke(renderer, seat, PIP_X, foot, mid, tip, 6, ready ? COLOUR_LAMP : COLOUR_TRAFFIC_DEEP);
    stroke(
      renderer,
      seat,
      PIP_X + PIP_WIDTH,
      foot,
      mid,
      tip,
      6,
      ready ? COLOUR_LAMP : COLOUR_TRAFFIC_DEEP,
    );
    if (ready) return;
    fillRect(renderer, seat, PIP_X, foot - 4, PIP_WIDTH * settling, 4, COLOUR_TRAFFIC_DEEP);
  }

  #drawTab(renderer: Renderer, seat: SeatId, of: SeatId, own: boolean): void {
    const palette = SEAT_PALETTE[of];
    const span = STRIP_RIGHT - STRIP_LEFT - 14;
    const at = STRIP_LEFT + span * clamp01(taxiOf(this.#match, of).distance / RACE_DISTANCE);
    if (own) {
      fillRect(renderer, seat, at, STRIP_Y - 3, 14, STRIP_HEIGHT + 6, palette.base);
      return;
    }
    // Open rather than solid — rule 7 again, so the two tabs differ in pattern as well as in
    // colour and in which taxi they are following.
    fillRect(renderer, seat, at, STRIP_Y - 3, 14, 4, palette.base);
    fillRect(renderer, seat, at, STRIP_Y + STRIP_HEIGHT - 1, 14, 4, palette.base);
    fillRect(renderer, seat, at, STRIP_Y - 3, 4, STRIP_HEIGHT + 6, palette.base);
  }
}
