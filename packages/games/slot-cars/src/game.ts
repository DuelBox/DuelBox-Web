import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  LAPS,
  LAP_LENGTH,
  MAX_SPEED,
  TRACK,
  botThrottle,
  carOf,
  createBotState,
  createGame,
  lapOf,
  resetBotState,
  resetGame,
  safeSpeedAt,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Slot Cars — one button each, and a lap to learn.
 *
 * The rules module knows nothing about shape: it holds a distance and a speed. This file
 * turns that into a circuit, by integrating the same curvature profile once at load into a
 * polyline and then looking cars up along it by arc length.
 *
 * That happens **once, at module scope**, not per frame — a track is a constant, and
 * rebuilding it sixty times a second would be the largest allocation in the game.
 */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** How far apart the sampled points of the track are. Smaller is smoother and larger. */
const SAMPLE = 12;
/** The two lanes are drawn this far either side of the centreline. Purely a drawing device. */
const LANE_OFFSET = 17;
const ROAD_HALF_WIDTH = 30;
const CAR_LENGTH = 26;
const CAR_HALF_WIDTH = 11;

const COLOUR_GRASS = '#122018';
const COLOUR_ROAD = '#2b3038';
const COLOUR_KERB = '#e6eaf2';
const COLOUR_SLOT = 'rgba(230, 234, 242, 0.22)';
const COLOUR_MUTED = 'rgba(230, 234, 242, 0.45)';
const COLOUR_DANGER = '#e0554f';
const COLOUR_SAFE = '#3ec98a';

interface Point {
  readonly x: number;
  readonly y: number;
  /** Unit normal, pointing left of travel. Used to place lanes and kerbs. */
  readonly nx: number;
  readonly ny: number;
}

/**
 * The circuit as points, integrated from the curvature profile.
 *
 * Built once and then centred and scaled to the logical box, so the rules module never has
 * to know the board is 600 by 1000 — rule 8 in its cleanest form. The scale is chosen from
 * the integrated extent rather than assumed, so changing a corner radius in `rules.ts`
 * cannot leave the drawing hanging off the edge.
 */
const TRACK_POINTS: readonly Point[] = buildPoints();

function buildPoints(): Point[] {
  const raw: { x: number; y: number; heading: number }[] = [];
  let x = 0;
  let y = 0;
  let heading = -Math.PI / 2;
  for (const segment of TRACK) {
    const steps = Math.max(2, Math.round(segment.length / SAMPLE));
    for (let i = 0; i < steps; i += 1) {
      const ds = segment.length / steps;
      raw.push({ x, y, heading });
      x += Math.cos(heading) * ds;
      y += Math.sin(heading) * ds;
      heading += segment.curvature * ds;
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of raw) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const margin = ROAD_HALF_WIDTH + 34;
  const scale = Math.min(
    (BOARD_WIDTH - margin * 2) / (maxX - minX),
    (BOARD_HEIGHT - margin * 2) / (maxY - minY),
  );
  const offsetX = BOARD_WIDTH / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = BOARD_HEIGHT / 2 - ((minY + maxY) / 2) * scale;

  return raw.map((point) => ({
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
    nx: Math.cos(point.heading - Math.PI / 2),
    ny: Math.sin(point.heading - Math.PI / 2),
  }));
}

/** The point on the drawn circuit at a distance round the lap. */
function pointAt(distance: number): Point {
  let along = distance % LAP_LENGTH;
  if (along < 0) along += LAP_LENGTH;
  const index = Math.floor((along / LAP_LENGTH) * TRACK_POINTS.length) % TRACK_POINTS.length;
  return TRACK_POINTS[index] as Point;
}

export class SlotCarsGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#rng = context.rng;
    resetGame(this.#position);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    const p1 = this.#throttleFor('p1', input, fixedDeltaSeconds);
    const p2 = this.#throttleFor('p2', input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds, p1, p2);
    this.#winner = winnerOf(this.#position);
  }

  /**
   * Whether a seat is asking for power.
   *
   * **Held, never tapped.** A repeated tap is won by whichever instrument repeats fastest,
   * which is the trap Road Dodge had to declare `sameInputClassOnly` for; a held key and a
   * held finger are the same signal with no rate in it at all. `actionHeld` covers both,
   * and a pointer resting anywhere in the seat's own half counts as holding.
   */
  #throttleFor(seat: SeatId, input: InputState, fixedDeltaSeconds: number): boolean {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      return botThrottle(this.#position, seat, difficulty, state, fixedDeltaSeconds, this.#rng);
    }
    const seatInput = input.seat(seat);
    return seatInput.actionHeld || seatInput.pointer !== null;
  }

  getActiveSeat(): SeatId | null {
    // Never: both cars run at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    // Laps completed, which is the number a spectator would call out.
    return {
      p1: lapOf(this.#position.p1) - 1,
      p2: lapOf(this.#position.p2) - 1,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_GRASS);
    this.#drawRoad(renderer);
    this.#drawStartLine(renderer);
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drawCar(renderer, seat);
    this.#drawGauges(renderer);
  }

  #drawRoad(renderer: Renderer): void {
    // The road, as overlapping discs along the centreline. Cheaper than a stroked path and
    // it gives the corners a rounded outside for free.
    for (const point of TRACK_POINTS) {
      renderer.circle(point.x, point.y, ROAD_HALF_WIDTH, COLOUR_ROAD);
    }
    // The two slots, so the lanes are visible as slots rather than as paint.
    for (const point of TRACK_POINTS) {
      for (const side of [-1, 1]) {
        renderer.circle(
          point.x + point.nx * LANE_OFFSET * side,
          point.y + point.ny * LANE_OFFSET * side,
          2,
          COLOUR_SLOT,
        );
      }
    }
  }

  #drawStartLine(renderer: Renderer): void {
    const point = TRACK_POINTS[0] as Point;
    renderer.line(
      point.x + point.nx * ROAD_HALF_WIDTH,
      point.y + point.ny * ROAD_HALF_WIDTH,
      point.x - point.nx * ROAD_HALF_WIDTH,
      point.y - point.ny * ROAD_HALF_WIDTH,
      6,
      COLOUR_KERB,
    );
  }

  /**
   * Rule 7: p1's car is a rounded body with a single roundel, p2's a squared one with a
   * stripe down it. Two cars a few units apart on the same corner is exactly where colour
   * alone stops being enough.
   */
  #drawCar(renderer: Renderer, seat: SeatId): void {
    const car = carOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const point = pointAt(car.distance);
    const side = seat === 'p1' ? 1 : -1;
    const x = point.x + point.nx * LANE_OFFSET * side;
    const y = point.y + point.ny * LANE_OFFSET * side;
    // Along the track, which is the normal turned a quarter.
    const ax = -point.ny;
    const ay = point.nx;
    const colour = car.off > 0 ? palette.soft : palette.base;

    renderer.line(
      x - ax * CAR_LENGTH * 0.4,
      y - ay * CAR_LENGTH * 0.4,
      x + ax * CAR_LENGTH * 0.4,
      y + ay * CAR_LENGTH * 0.4,
      CAR_HALF_WIDTH * 2,
      colour,
    );
    if (seat === 'p1') renderer.circle(x, y, 5, palette.deep);
    else {
      renderer.line(
        x - ax * CAR_LENGTH * 0.4,
        y - ay * CAR_LENGTH * 0.4,
        x + ax * CAR_LENGTH * 0.4,
        y + ay * CAR_LENGTH * 0.4,
        4,
        palette.deep,
      );
    }

    // A car off the slot gets a cross, so being out is legible without colour.
    if (car.off <= 0) return;
    renderer.line(x - 13, y - 13, x + 13, y + 13, 4, COLOUR_DANGER);
    renderer.line(x + 13, y - 13, x - 13, y + 13, 4, COLOUR_DANGER);
  }

  /**
   * Each seat's own gauge, on its own edge of the board.
   *
   * It shows speed against the **safe speed where the car is about to be**, not where it
   * is — which is the only version of the number that is any use, because by the time a
   * corner is under you it is too late. The bar changes shape as well as colour when the
   * car is over the limit, so it survives greyscale.
   */
  #drawGauges(renderer: Renderer): void {
    const width = BOARD_WIDTH - 120;
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const car = carOf(this.#position, seat);
      const palette = SEAT_PALETTE[seat];
      const y = seat === 'p1' ? BOARD_HEIGHT - 44 : 44;

      const ahead = safeSpeedAt(car.distance + Math.max(60, car.speed * 0.8));
      const over = car.speed > ahead;
      const fraction = Math.max(0, Math.min(1, car.speed / MAX_SPEED));

      renderer.rect(60, y - 9, width, 18, COLOUR_ROAD);
      renderer.rect(60, y - 9, width * fraction, 18, over ? COLOUR_DANGER : palette.base);
      // The safe mark, where it exists. On a straight there is nothing to mark.
      if (Number.isFinite(ahead)) {
        const mark = 60 + Math.min(1, ahead / MAX_SPEED) * width;
        renderer.rect(mark - 2, y - 15, 4, 30, over ? COLOUR_DANGER : COLOUR_SAFE);
      }
      // Over the limit the bar grows a spike above it: a shape change, not only a colour.
      if (over) renderer.rect(60 + width * fraction - 8, y - 18, 16, 8, COLOUR_DANGER);

      // Laps, as pips beside the gauge.
      for (let lap = 0; lap < LAPS; lap += 1) {
        const x = 26 + lap * 14;
        const done = lap < lapOf(car) - 1;
        renderer.rect(x - 4, y - 5, 8, 10, done ? palette.base : COLOUR_MUTED);
      }
    }
  }
}
