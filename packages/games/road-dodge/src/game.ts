import { SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  SeatInput,
} from '@duelbox/game-sdk';
import {
  BOT_PROFILES,
  CAR_Y,
  HIT_BAND,
  LANES,
  TRACK_LENGTH,
  botSteer,
  createBotState,
  createSeatState,
  resetBotState,
  resetSeatState,
  speedAt,
  steer,
  stepSeat,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, SeatState } from './rules.js';

/**
 * Road Dodge — the first `rt-race` game.
 *
 * Two roads side by side, one per seat, each scrolling towards its own driver. Obstacles
 * come faster and closer together the longer you last; the winner is whoever is still
 * driving when the other crashes. Neither seat can touch the other's traffic, so the two
 * share a screen without sharing a board — and because both roads run the same seeded
 * generator from the same seed, they face the identical sequence of obstacles.
 */

/** Each road occupies half the logical width, with a margin outside and a gap between. */
export const ROAD_MARGIN = 24;
export const ROAD_GAP = 28;
export const ROAD_WIDTH = (600 - ROAD_MARGIN * 2 - ROAD_GAP) / 2;
export const ROAD_TOP = 40;
export const ROAD_HEIGHT = 920;
export const LANE_WIDTH = ROAD_WIDTH / LANES;

/** Left edge of a seat's road, in logical units. p1 drives the left road. */
export function roadLeft(seat: SeatId): number {
  return seat === 'p1' ? ROAD_MARGIN : ROAD_MARGIN + ROAD_WIDTH + ROAD_GAP;
}

/**
 * Where a point on the track maps to on screen, for one seat.
 *
 * The track is {@link TRACK_LENGTH} long in its own units and the road is
 * {@link ROAD_HEIGHT} tall on screen, so this is the one place the two meet. A seat
 * reading the device upside down sees its road flow the same way it does the right way
 * up: towards the driver. Flipping the axis here rather than rotating the whole road is
 * what keeps both drivers' controls meaning the same thing.
 */
export function trackToScreenY(y: number, flipped: boolean): number {
  const t = y / TRACK_LENGTH;
  const along = flipped ? 1 - t : t;
  return ROAD_TOP + along * ROAD_HEIGHT;
}

const CAR_WIDTH = LANE_WIDTH * 0.56;
const CAR_HEIGHT = 74;
const OBSTACLE_INSET = LANE_WIDTH * 0.14;
const OBSTACLE_HEIGHT = HIT_BAND * 1.5;

/** How far a lane's worth of pointer travel counts as asking for that lane. */
const POINTER_DEADZONE = LANE_WIDTH * 0.25;

/** How far the movement axis must open before it reads as a lane change. */
const AXIS_THRESHOLD = 0.5;

const COLOUR_BACKGROUND = '#0d1220';
const COLOUR_ROAD = '#1b2233';
const COLOUR_EDGE = 'rgba(233, 240, 252, 0.34)';
const COLOUR_DASH = 'rgba(233, 240, 252, 0.16)';
const COLOUR_OBSTACLE = '#8a94ad';
const COLOUR_INK = '#0b1220';
/**
 * The cross painted over a wrecked car.
 *
 * Deliberately not a red flash: p1's own base colour is #ff5a4e, so a red crash marker
 * was invisible on exactly the seat most likely to need it — and rule 7 says colour is
 * never the only signal. A cross reads in greyscale, on either car, at a glance.
 */
const COLOUR_WRECK = '#f2f5fb';

/**
 * Dashes painted down each lane divider, so speed is legible without colour.
 *
 * Measured along the track rather than the screen, so they scroll at exactly the speed
 * the obstacles do — the same ramp drives both.
 */
const DASH_COUNT = 14;
const DASH_PITCH = TRACK_LENGTH / DASH_COUNT;
const DASH_TRACK_LENGTH = DASH_PITCH * 0.42;

/** Per-seat controller state. Allocated once, at construction. */
interface SeatRuntime {
  readonly bot: BotState;
  /** Movement axis last step, so a held key steers once rather than every step. */
  held: number;
  /** Lane the pointer last asked for, or -1. Latched so a drag does not re-fire. */
  pointerLane: number;
  /**
   * Set on resume: the next step adopts whatever the keys currently say without acting
   * on it.
   *
   * Clearing `held` instead was the bug, and it did the exact opposite of what the
   * comment above `onResume` promised: a player who paused mid-press came back, the
   * still-down key read as brand new, and the car changed lane before they had touched
   * anything. Re-syncing rather than clearing means a key held through a pause stays
   * held, and one released during the pause is noticed on the way back.
   */
  resync: boolean;
  /** Steps left of the crash flash. */
  crashSteps: number;
  /** The car's lane position before the last step, for render interpolation. */
  prevPosition: number;
  /**
   * Distance the road has scrolled, wrapped to one dash pitch.
   *
   * Render-only, so it lives here rather than on simulation state. Without it the lane
   * dashes stand still while the obstacles stream past, and a racing game whose road does
   * not move reads as broken.
   */
  scroll: number;
  /**
   * How far every obstacle moved on the last step.
   *
   * Obstacles all travel at one speed, set by the ramp, so a single number interpolates
   * the whole pool exactly — no per-obstacle previous position, and no extra field on
   * simulation state that exists only for drawing.
   */
  lastAdvance: number;
}

function createRuntime(): SeatRuntime {
  return {
    bot: createBotState(),
    held: 0,
    pointerLane: -1,
    resync: false,
    crashSteps: 0,
    prevPosition: 1,
    scroll: 0,
    lastAdvance: 0,
  };
}

function resetRuntime(runtime: SeatRuntime): void {
  resetBotState(runtime.bot);
  runtime.held = 0;
  runtime.pointerLane = -1;
  runtime.resync = false;
  runtime.crashSteps = 0;
  runtime.prevPosition = 1;
  runtime.scroll = 0;
  runtime.lastAdvance = 0;
}

/** Steps the crash marker flashes before settling. */
export const CRASH_FLASH_STEPS = 30;

function axis(value: number): number {
  if (value > AXIS_THRESHOLD) return 1;
  if (value < -AXIS_THRESHOLD) return -1;
  return 0;
}

export class RoadDodgeGame implements Game {
  readonly #p1: SeatState = createSeatState();
  readonly #p2: SeatState = createSeatState();
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  #context: GameContext | null = null;
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  seat(seat: SeatId): Readonly<SeatState> {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    this.#winner = null;
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null || this.#winner !== null) return;

    this.#driveSeat(
      'p1',
      this.#p1,
      this.#runtimeP1,
      this.#botP1,
      input,
      fixedDeltaSeconds,
      context,
    );
    this.#driveSeat(
      'p2',
      this.#p2,
      this.#runtimeP2,
      this.#botP2,
      input,
      fixedDeltaSeconds,
      context,
    );

    // Both seats step before either is judged, so a step in which both crash is the draw
    // it actually is rather than a win for whoever happened to be simulated first.
    this.#runtimeP1.prevPosition = this.#p1.position;
    this.#runtimeP2.prevPosition = this.#p2.position;
    this.#runtimeP1.lastAdvance = this.#p1.crashed
      ? 0
      : speedAt(this.#p1.elapsed) * fixedDeltaSeconds;
    this.#runtimeP2.lastAdvance = this.#p2.crashed
      ? 0
      : speedAt(this.#p2.elapsed) * fixedDeltaSeconds;

    this.#runtimeP1.scroll = (this.#runtimeP1.scroll + this.#runtimeP1.lastAdvance) % DASH_PITCH;
    this.#runtimeP2.scroll = (this.#runtimeP2.scroll + this.#runtimeP2.lastAdvance) % DASH_PITCH;

    stepSeat(this.#p1, fixedDeltaSeconds, context.rng);
    stepSeat(this.#p2, fixedDeltaSeconds, context.rng);

    if (this.#p1.crashed && this.#runtimeP1.crashSteps === 0) {
      this.#runtimeP1.crashSteps = CRASH_FLASH_STEPS;
    }
    if (this.#p2.crashed && this.#runtimeP2.crashSteps === 0) {
      this.#runtimeP2.crashSteps = CRASH_FLASH_STEPS;
    }
    if (this.#runtimeP1.crashSteps > 0) this.#runtimeP1.crashSteps -= 1;
    if (this.#runtimeP2.crashSteps > 0) this.#runtimeP2.crashSteps -= 1;

    this.#winner = winnerOf(this.#p1, this.#p2);
  }

  /**
   * Draws the state between the last two steps, `alpha` of the way along.
   *
   * Obstacles travel up to 900 logical units a second down a 1000-unit track — about
   * fifteen units per step at sixty steps a second — so without this they visibly stutter
   * on a 120Hz screen. Every obstacle in a seat's pool moves at the same ramped speed, so
   * one number per seat interpolates all twelve exactly, and the pool needs no
   * render-only field bolted onto simulation state.
   */
  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawRoad(renderer, 'p1', alpha);
    this.#drawRoad(renderer, 'p2', alpha);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // A key still down across a pause must not read as a fresh press on the first step
    // back, or a paused player returns to find their car already in another lane.
    this.#settle();
  }

  getScore(): MatchScore {
    return { p1: this.#p1.passed, p2: this.#p2.passed, winner: this.#winner };
  }

  destroy(): void {
    this.#context = null;
    this.#botP1 = null;
    this.#botP2 = null;
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    this.#winner = null;
  }

  #settle(): void {
    // The pointer latch is safe to drop — a finger cannot still be down on a paused
    // game — but the keys are not, so they are re-synced on the first step back instead.
    this.#runtimeP1.pointerLane = -1;
    this.#runtimeP2.pointerLane = -1;
    this.#runtimeP1.resync = true;
    this.#runtimeP2.resync = true;
  }

  /** True when this seat reads the device upside down and its controls must mirror. */
  #isFlipped(seat: SeatId): boolean {
    return this.#presentation === 'shared-screen' && seat !== this.#localSeat;
  }

  #driveSeat(
    seat: SeatId,
    state: SeatState,
    runtime: SeatRuntime,
    difficulty: BotDifficulty | null,
    input: InputState,
    dt: number,
    context: GameContext,
  ): void {
    if (state.crashed) return;

    if (difficulty !== null) {
      // Two draws, because one roll deciding both the direction and the mistake makes
      // them perfectly correlated. The bot sees exactly the road a human sees.
      const direction = botSteer(
        state,
        runtime.bot,
        BOT_PROFILES[difficulty],
        dt,
        context.rng.float(),
        context.rng.float(),
      );
      if (direction !== 0) steer(state, direction);
      return;
    }

    const seatInput = input.seat(seat);
    this.#steerFromKeys(seat, state, runtime, seatInput);
    this.#steerFromPointer(seat, state, runtime, seatInput);
  }

  /**
   * One lane per press, never per step.
   *
   * A held key must not slide the car across the road: the interaction is a discrete
   * change of lane, and repeating it while held is exactly the advantage over a
   * touchscreen that makes this archetype same-input-class only in the first place.
   */
  #steerFromKeys(seat: SeatId, state: SeatState, runtime: SeatRuntime, seatInput: SeatInput): void {
    const mirror = this.#isFlipped(seat) ? -1 : 1;
    const direction = axis(seatInput.move.x) * mirror;
    if (runtime.resync) {
      // First step back from a pause: adopt what the keys say, act on none of it.
      runtime.resync = false;
      runtime.held = direction;
      return;
    }
    if (direction !== 0 && direction !== runtime.held) steer(state, direction);
    runtime.held = direction;
  }

  /** A tap or drag asks for the lane under the finger, latched so a drag fires once. */
  #steerFromPointer(
    seat: SeatId,
    state: SeatState,
    runtime: SeatRuntime,
    seatInput: SeatInput,
  ): void {
    const pointer = seatInput.pointer;
    if (pointer === null) {
      runtime.pointerLane = -1;
      return;
    }
    const lane = this.#laneUnder(seat, pointer.x);
    if (lane < 0) {
      runtime.pointerLane = -1;
      return;
    }
    if (lane === runtime.pointerLane) return;
    runtime.pointerLane = lane;
    if (lane === state.lane) return;
    steer(state, lane > state.lane ? 1 : -1);
  }

  /**
   * Lane a logical x falls in on this seat's road, or -1 when it misses the road.
   *
   * A seat reading the device upside down has left and right reversed, so its road is
   * indexed from the other end — otherwise reaching for the lane on your right would move
   * the car to the lane on your left.
   */
  #laneUnder(seat: SeatId, x: number): number {
    const left = roadLeft(seat);
    const local = x - left;
    if (local < -POINTER_DEADZONE || local > ROAD_WIDTH + POINTER_DEADZONE) return -1;
    const clamped = local < 0 ? 0 : local > ROAD_WIDTH - 1 ? ROAD_WIDTH - 1 : local;
    const lane = Math.floor(clamped / LANE_WIDTH);
    const bounded = lane < 0 ? 0 : lane > LANES - 1 ? LANES - 1 : lane;
    return this.#isFlipped(seat) ? LANES - 1 - bounded : bounded;
  }

  #drawRoad(renderer: Renderer, seat: SeatId, alpha: number): void {
    const state = seat === 'p1' ? this.#p1 : this.#p2;
    const runtime = seat === 'p1' ? this.#runtimeP1 : this.#runtimeP2;
    const flipped = this.#isFlipped(seat);
    const left = roadLeft(seat);
    const palette = SEAT_PALETTE[seat];

    renderer.rect(left, ROAD_TOP, ROAD_WIDTH, ROAD_HEIGHT, COLOUR_ROAD);
    renderer.strokeRect(left, ROAD_TOP, ROAD_WIDTH, ROAD_HEIGHT, 3, palette.tint);

    // Lane dividers, dashed, so the road reads as moving even in a still screenshot.
    const scrolled = runtime.scroll + runtime.lastAdvance * alpha;
    for (let lane = 1; lane < LANES; lane += 1) {
      const x = left + lane * LANE_WIDTH;
      // One extra dash, because the wrap means one is always half off the near end.
      for (let dash = -1; dash < DASH_COUNT; dash += 1) {
        const head = dash * DASH_PITCH + scrolled;
        const tail = head + DASH_TRACK_LENGTH;
        if (tail < 0 || head > TRACK_LENGTH) continue;
        const y1 = trackToScreenY(head < 0 ? 0 : head, flipped);
        const y2 = trackToScreenY(tail > TRACK_LENGTH ? TRACK_LENGTH : tail, flipped);
        renderer.line(x, y1, x, y2, 3, COLOUR_DASH);
      }
    }
    renderer.line(left, ROAD_TOP, left, ROAD_TOP + ROAD_HEIGHT, 3, COLOUR_EDGE);
    const right = left + ROAD_WIDTH;
    renderer.line(right, ROAD_TOP, right, ROAD_TOP + ROAD_HEIGHT, 3, COLOUR_EDGE);

    for (const obstacle of state.obstacles) {
      if (obstacle.lane < 0) continue;
      const lane = flipped ? LANES - 1 - obstacle.lane : obstacle.lane;
      const x = left + lane * LANE_WIDTH + OBSTACLE_INSET;
      // Wind the obstacle back by the fraction of the last step still unplayed.
      const y = trackToScreenY(obstacle.y - runtime.lastAdvance * (1 - alpha), flipped);
      const width = LANE_WIDTH - OBSTACLE_INSET * 2;
      renderer.rect(x, y - OBSTACLE_HEIGHT / 2, width, OBSTACLE_HEIGHT, COLOUR_OBSTACLE);
      // A bar across the middle: the obstacle is still an obstacle in greyscale.
      renderer.rect(x, y - 3, width, 6, COLOUR_INK);
    }

    this.#drawCar(renderer, seat, state, runtime, left, flipped, alpha);
  }

  /**
   * p1 drives a pointed car, p2 a blunt one with a fin.
   *
   * Rule 7: the two cars differ in silhouette as well as colour, so the board is readable
   * in greyscale and to a colour-blind player.
   */
  #drawCar(
    renderer: Renderer,
    seat: SeatId,
    state: Readonly<SeatState>,
    runtime: SeatRuntime,
    left: number,
    flipped: boolean,
    alpha: number,
  ): void {
    const palette = SEAT_PALETTE[seat];
    const smoothed = runtime.prevPosition + (state.position - runtime.prevPosition) * alpha;
    const position = flipped ? LANES - 1 - smoothed : smoothed;
    const centreX = left + (position + 0.5) * LANE_WIDTH;
    const centreY = trackToScreenY(CAR_Y, flipped);
    const half = CAR_WIDTH / 2;
    const nose = flipped ? centreY + CAR_HEIGHT / 2 : centreY - CAR_HEIGHT / 2;
    const tail = flipped ? centreY - CAR_HEIGHT / 2 : centreY + CAR_HEIGHT / 2;
    const crashed = state.crashed;
    const body = crashed ? palette.deep : palette.base;

    renderer.rect(centreX - half, Math.min(nose, tail), CAR_WIDTH, CAR_HEIGHT, body);
    if (seat === 'p1') {
      // A pointed nose: two lines meeting ahead of the body.
      renderer.line(centreX - half, nose, centreX, nose - (flipped ? -18 : 18), 6, body);
      renderer.line(centreX + half, nose, centreX, nose - (flipped ? -18 : 18), 6, body);
    } else {
      // A blunt front and a tail fin.
      renderer.rect(centreX - half * 0.4, tail - (flipped ? 18 : 0), CAR_WIDTH * 0.4, 18, body);
    }
    renderer.rect(centreX - half * 0.55, centreY - 12, CAR_WIDTH * 0.55, 24, COLOUR_INK);
    if (!crashed) return;

    // Struck through, and thicker for the first half-second so the moment of the crash is
    // findable on a screen holding two races at once.
    const width = runtime.crashSteps > 0 ? 9 : 5;
    const reach = CAR_HEIGHT * 0.42;
    renderer.line(
      centreX - half,
      centreY - reach,
      centreX + half,
      centreY + reach,
      width,
      COLOUR_WRECK,
    );
    renderer.line(
      centreX - half,
      centreY + reach,
      centreX + half,
      centreY - reach,
      width,
      COLOUR_WRECK,
    );
  }
}
