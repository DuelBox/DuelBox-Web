import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BUMP_KICK_MAX,
  BUMP_KICK_MIN,
  COURSE_LENGTH,
  FLIP_PITCH,
  LEAN_RATE,
  SECTORS,
  VISIBLE_AHEAD,
  WHEEL_DOWN_PITCH,
  botLean,
  createBotState,
  createGame,
  driveLean,
  holdingLean,
  resetBotState,
  resetGame,
  riderOf,
  sectorOf,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Wheelie — two lanes, one course, one control each.
 *
 * The rules module holds a distance, a speed and a pitch and knows nothing about there
 * being a side view or two of them. This file places one lane twice: the near seat's the
 * right way up, the far seat's turned half a turn about the centre of the board, so each
 * player reads their own lane upright and the renderer never pushes a rotation.
 *
 * The scale from lane units to board units is fixed by {@link VISIBLE_AHEAD}: exactly that
 * much course fits between the bike and the front edge of the lane. That is what makes the
 * bot's sight limit a real one rather than an assertion — it may look precisely as far as
 * the player can see, because both numbers are the same number.
 */

export const BOARD_WIDTH = 640;
export const BOARD_HEIGHT = 1000;

/** One lane, in board units. Two of them, stacked, with the same margin above and below. */
export const LANE_WIDTH = 640;
export const LANE_HEIGHT = 440;
const MARGIN_Y = (BOARD_HEIGHT / 2 - LANE_HEIGHT) / 2;
const P1_TOP = BOARD_HEIGHT / 2 + MARGIN_Y;
const P2_TOP = MARGIN_Y;

/** Where the rear axle sits across the lane, and where the ground is down it. */
const BIKE_X = 132;
const GROUND_Y = 322;
/** Board units per lane unit: the lane ahead of the bike shows exactly VISIBLE_AHEAD. */
const SCALE = (LANE_WIDTH - BIKE_X) / VISIBLE_AHEAD;

const WHEEL_RADIUS = 21;
const WHEELBASE = 74;
const RIDER_REACH = 46;

const COLOUR_NIGHT = '#0b1017';
const COLOUR_SKY = '#151d2b';
const COLOUR_GROUND = '#2a2118';
const COLOUR_DIRT = '#3d3122';
const COLOUR_RULE = 'rgba(232, 236, 245, 0.14)';
const COLOUR_MUTED = 'rgba(232, 236, 245, 0.4)';
const COLOUR_BUMP = '#8a6a3a';
const COLOUR_DANGER = '#e0554f';
const COLOUR_SAFE = '#3ec98a';

/**
 * A point in one seat's lane, placed on the board.
 *
 * The far seat's lane is the near one turned half a turn, which is exactly how the far
 * player is turned — so both read their own course running away from them in the same
 * direction, and neither is shown a mirror image of the other's.
 */
export function toBoard(seat: SeatId, x: number, y: number, out: { x: number; y: number }): void {
  if (seat === 'p1') {
    out.x = x;
    out.y = P1_TOP + y;
    return;
  }
  out.x = LANE_WIDTH - x;
  out.y = P2_TOP + (LANE_HEIGHT - y);
}

/** A point on the board, read back into one seat's lane. The inverse of `toBoard`. */
export function toLane(seat: SeatId, x: number, y: number, out: { x: number; y: number }): void {
  if (seat === 'p1') {
    out.x = x;
    out.y = y - P1_TOP;
    return;
  }
  out.x = LANE_WIDTH - x;
  out.y = LANE_HEIGHT - (y - P2_TOP);
}

/**
 * Where a thumb held in a seat's own half puts the lean, in [0, 1].
 *
 * High in your own lane is leaning back. It is an **absolute level** rather than a drag,
 * which the horizontal split earns: each seat owns a full-width band, so every lean the
 * game contains is somewhere your own thumb already is. `driveLean` rate-limits the
 * result, so a thumb that jumps to the top does not snap the rider back with it.
 */
export function leanForPointer(laneY: number): number {
  const level = 1 - laneY / GROUND_Y;
  return level < 0 ? 0 : level > 1 ? 1 : level;
}

export class WheelieGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #point = { x: 0, y: 0 };

  /**
   * Three streams, and every split is load-bearing.
   *
   * **The course must not depend on how anybody rode it.** The number of *decisions* a
   * tier makes depends on its reaction — `hard` looks nearly five times as often as
   * `easy` — so a course drawn from a stream the bots share is a different course for
   * every pairing, and every balance figure measured on it is a figure for a course
   * nobody else rides. Here the course is dealt once from `#worldRng` before anybody
   * moves and `step` draws nothing at all, so the lane is a function of the match seed and
   * of nothing else.
   *
   * **And each seat has its own generator**, which is the half that is easy to miss.
   * Drawing a constant number of values per decision is not enough: whichever seat is
   * polled first still takes the earlier value from a shared stream every single time.
   * With a stream each, the poll order inside `update` is not observable — 900 matches
   * replayed with the two calls reversed came back bit-identical.
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
    // Three independent streams from the one seed the shell gave us.
    this.#worldRng = new Rng(context.rng.next() | 0);
    this.#botRng = {
      p1: new Rng(context.rng.next() | 0),
      p2: new Rng(context.rng.next() | 0),
    };
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#worldRng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#lean(seat, input, fixedDeltaSeconds);
    step(this.#position, fixedDeltaSeconds);
    this.#winner = winnerOf(this.#position);
  }

  /**
   * Move one seat's weight.
   *
   * **A level, never a repeat rate.** `driveLean` moves the lean toward what is asked at a
   * fixed rate, so a thumb sliding up the lane and a key held down change it by the same
   * amount in the same time, and a *mashed* key can only arrive at a lean the held one
   * passed through on its way — later. That is rule 10 without a device branch anywhere:
   * there is no rate in the control for an instrument to win.
   */
  #lean(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const rider = riderOf(this.#position, seat);
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const wanted = botLean(
        this.#position,
        seat,
        difficulty,
        state,
        this.#botRng[seat],
        fixedDeltaSeconds,
      );
      driveLean(rider, wanted, fixedDeltaSeconds);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toLane(seat, pointer.x, pointer.y, this.#point);
      driveLean(rider, leanForPointer(this.#point.y), fixedDeltaSeconds);
      return;
    }

    // Keys give a direction rather than a level, and releasing them *holds* the lean where
    // it is. Holding a lean is the whole game, so a control that snapped back to nothing on
    // release would make the keyboard unplayable while the pointer was fine — and one seat
    // is on the keys whenever two people share a laptop.
    const up = seatInput.move.y < 0 || seatInput.actionHeld;
    const down = seatInput.move.y > 0;
    if (up === down) return;
    driveLean(rider, up ? 1 : 0, fixedDeltaSeconds);
  }

  getActiveSeat(): SeatId | null {
    // Never: both bikes run at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    // Marker posts passed, which is the number a spectator would call out.
    return {
      p1: sectorOf(this.#position.p1),
      p2: sectorOf(this.#position.p2),
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position, this.#worldRng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      this.#drawLane(renderer, seat);
      this.#drawCourse(renderer, seat);
      this.#drawBike(renderer, seat);
      this.#drawGauge(renderer, seat);
    }
    renderer.line(0, BOARD_HEIGHT / 2, BOARD_WIDTH, BOARD_HEIGHT / 2, 2, COLOUR_RULE);
  }

  #drawLane(renderer: Renderer, seat: SeatId): void {
    const top = seat === 'p1' ? P1_TOP : P2_TOP;
    renderer.rect(0, top, LANE_WIDTH, LANE_HEIGHT, COLOUR_SKY);
    renderer.rect(0, top + GROUND_Y, LANE_WIDTH, LANE_HEIGHT - GROUND_Y, COLOUR_GROUND);
    renderer.line(0, top + GROUND_Y, LANE_WIDTH, top + GROUND_Y, 3, COLOUR_DIRT);
  }

  /**
   * The course ahead: the bumps that are within sight, and the marker posts.
   *
   * A bump is drawn as high as it kicks hard, so how much to duck is read off the picture
   * rather than remembered — and its outline is a triangle against the posts' bars, so the
   * two never rely on colour to be told apart (rule 7).
   */
  #drawCourse(renderer: Renderer, seat: SeatId): void {
    const rider = riderOf(this.#position, seat);
    const top = seat === 'p1' ? P1_TOP : P2_TOP;
    const groundY = top + GROUND_Y;

    for (let post = 1; post <= SECTORS; post += 1) {
      const gap = (post * COURSE_LENGTH) / SECTORS - rider.distance;
      if (gap < -40 || gap > VISIBLE_AHEAD) continue;
      const x = BIKE_X + gap * SCALE;
      toBoard(seat, x, GROUND_Y - 54, this.#point);
      renderer.rect(this.#point.x - 3, Math.min(this.#point.y, groundY), 6, 54, COLOUR_MUTED);
    }

    for (let i = rider.nextBump; i < this.#position.bumps.length; i += 1) {
      const bump = this.#position.bumps[i];
      if (bump === undefined) continue;
      const gap = bump.position - rider.distance;
      if (gap > VISIBLE_AHEAD) break;
      const share = (bump.kick - BUMP_KICK_MIN) / (BUMP_KICK_MAX - BUMP_KICK_MIN);
      const height = 12 + share * 30;
      const half = 20 + share * 16;
      const x = BIKE_X + gap * SCALE;
      // A triangle, drawn as its two faces, so a bump reads as a ramp at a glance.
      toBoard(seat, x - half, GROUND_Y, this.#point);
      const leftX = this.#point.x;
      const leftY = this.#point.y;
      toBoard(seat, x, GROUND_Y - height, this.#point);
      const peakX = this.#point.x;
      const peakY = this.#point.y;
      toBoard(seat, x + half, GROUND_Y, this.#point);
      renderer.line(leftX, leftY, peakX, peakY, 5, COLOUR_BUMP);
      renderer.line(peakX, peakY, this.#point.x, this.#point.y, 5, COLOUR_BUMP);
    }
  }

  /**
   * The bike, turned about its rear axle by the pitch.
   *
   * Rule 7: p1's wheels are solid discs and its rider a circle; p2's wheels are rings and
   * its rider a square. A bike on its back gets a cross through it, so being down is legible
   * with no colour at all.
   */
  #drawBike(renderer: Renderer, seat: SeatId): void {
    const rider = riderOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const down = rider.down > 0;
    const pitch = down ? -0.5 : rider.pitch;
    const colour = down ? palette.soft : palette.base;

    toBoard(seat, BIKE_X, GROUND_Y - WHEEL_RADIUS, this.#point);
    const rearX = this.#point.x;
    const rearY = this.#point.y;
    // The lane is turned half a turn for the far seat, so its "along the ground" runs the
    // other way. One sign carries the whole difference.
    const facing = seat === 'p1' ? 1 : -1;
    const frontX = rearX + Math.cos(pitch) * WHEELBASE * facing;
    const frontY = rearY - Math.sin(pitch) * WHEELBASE * facing;
    const seatX = rearX - Math.cos(pitch) * 6 * facing - Math.sin(pitch) * RIDER_REACH * facing;
    const seatY = rearY + Math.sin(pitch) * 6 * facing - Math.cos(pitch) * RIDER_REACH * facing;

    renderer.line(rearX, rearY, frontX, frontY, 7, colour);
    renderer.line(rearX, rearY, seatX, seatY, 6, palette.deep);

    if (seat === 'p1') {
      renderer.circle(rearX, rearY, WHEEL_RADIUS, palette.deep);
      renderer.circle(rearX, rearY, WHEEL_RADIUS - 8, COLOUR_SKY);
      renderer.circle(frontX, frontY, WHEEL_RADIUS - 3, palette.deep);
      renderer.circle(seatX, seatY, 11, colour);
    } else {
      renderer.strokeCircle(rearX, rearY, WHEEL_RADIUS - 3, 6, palette.deep);
      renderer.strokeCircle(frontX, frontY, WHEEL_RADIUS - 6, 6, palette.deep);
      renderer.strokeRect(seatX - 10, seatY - 10, 20, 20, 5, colour);
    }

    if (!down) return;
    renderer.line(rearX - 20, rearY - 20, rearX + 20, rearY + 20, 5, COLOUR_DANGER);
    renderer.line(rearX + 20, rearY - 20, rearX - 20, rearY + 20, 5, COLOUR_DANGER);
  }

  /**
   * Each seat's own gauge, on its own edge of the board.
   *
   * It shows the pitch against the two things that matter about it: the balance point at
   * the far end, and the lean that would hold the angle the bike is at right now. The
   * second is what a rider learns by feel, and drawing it is what makes the game teachable
   * without a word of text. Over the mark the bar grows a spike as well as changing colour,
   * so it survives greyscale.
   */
  #drawGauge(renderer: Renderer, seat: SeatId): void {
    const rider = riderOf(this.#position, seat);
    const palette = SEAT_PALETTE[seat];
    const top = seat === 'p1' ? P1_TOP : P2_TOP;
    const y = seat === 'p1' ? top + LANE_HEIGHT - 26 : top + 26;
    const left = 84;
    const width = LANE_WIDTH - left - 28;

    const share = Math.max(0, Math.min(1, rider.pitch / FLIP_PITCH));
    const climbing = rider.pitchRate > 0.35;
    renderer.rect(left, y - 8, width, 16, COLOUR_RULE);
    renderer.rect(left, y - 8, width * share, 16, climbing ? COLOUR_DANGER : palette.base);
    // The balance point, at the far end: past this nothing saves you.
    renderer.rect(left + width - 3, y - 14, 6, 28, COLOUR_DANGER);
    // And where the front wheel is back on the ground, at the near end.
    renderer.rect(left + (WHEEL_DOWN_PITCH / FLIP_PITCH) * width - 2, y - 12, 4, 24, COLOUR_SAFE);
    // Coming up fast gets a spike as well as a colour, so it reads in greyscale.
    if (climbing) renderer.rect(left + width * share - 7, y - 17, 14, 8, COLOUR_DANGER);

    // The lean, as a short second bar under the first, with the lean that would hold this
    // angle marked on it. Lining the two up is the whole craft of the game.
    const leanWidth = width * 0.45;
    renderer.rect(left, y + 12, leanWidth, 7, COLOUR_RULE);
    renderer.rect(left, y + 12, leanWidth * rider.lean, 7, palette.deep);
    renderer.rect(left + leanWidth * holdingLean(rider.pitch) - 2, y + 9, 4, 13, COLOUR_SAFE);

    // Marker posts passed, as pips on the seat's own outer edge: discs for p1, blocks for
    // p2, so the two scoreboards differ by shape as well as by colour.
    for (let post = 0; post < SECTORS; post += 1) {
      const x = 20 + post * 11;
      const done = post < sectorOf(rider);
      if (seat === 'p1') renderer.circle(x, y, 4.5, done ? palette.base : COLOUR_RULE);
      else renderer.rect(x - 4, y - 4, 8, 8, done ? palette.base : COLOUR_RULE);
    }
  }
}

/** Re-exported so tests can place a point without duplicating the layout. */
export { LEAN_RATE, VISIBLE_AHEAD };
