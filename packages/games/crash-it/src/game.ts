import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARENA_HALF_WIDTH,
  ARENA_HEIGHT,
  BODY_HALF_HEIGHT,
  BODY_HALF_LENGTH,
  GROUND_X,
  GROUND_Y,
  HEAD_OFFSET_Y,
  HEAD_RADIUS,
  JUMP_COOLDOWN,
  MATCH_SECONDS,
  POINTS_TO_WIN,
  SETTLE_SECONDS,
  WHEEL_RADIUS,
  botDrive,
  bodyX,
  bodyY,
  carOf,
  clearMatch,
  createBotState,
  createMatch,
  groundY,
  headX,
  headY,
  otherOf,
  resetBotState,
  resetMatch,
  stepMatch,
  wheelX,
  wheelY,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Match } from './rules.js';

/**
 * Crash It — one pit, two cars, and two heads that must not be touched.
 *
 * The rules module holds the whole simulation. What lives here is how a person says
 * "over there" and "now" through two instruments, and how one pit is drawn twice so that
 * two people sitting on opposite sides of a device are looking at the same picture.
 */

const COLOUR_NIGHT = '#070a12';
const COLOUR_SKY = '#16233a';
const COLOUR_HAZE = '#1e3050';
const COLOUR_DIRT = '#2f2a22';
const COLOUR_CRUST = '#7d6a4a';
const COLOUR_BONE = '#eef2fb';
const COLOUR_INK = '#070a12';
const COLOUR_TYRE = '#12161f';
const COLOUR_STRIP = 'rgba(7, 10, 18, 0.72)';
const COLOUR_DIVIDER = '#eef2fb';
const COLOUR_FAINT = 'rgba(238, 242, 251, 0.34)';
const COLOUR_SHADOW = 'rgba(7, 10, 18, 0.4)';

export const BOX_WIDTH = 600;
export const BOX_HEIGHT = 1000;
/** Half the box: the line between the two seats' halves. */
export const BAND_TOP = BOX_HEIGHT / 2;
/** Where the pit starts inside a seat's half; the band above it is that seat's strip. */
export const ARENA_TOP = BOX_HEIGHT - ARENA_HEIGHT;
export const STRIP_HEIGHT = ARENA_TOP - BAND_TOP;

/**
 * How far up their own half a finger must travel to read as a jump, in logical units.
 *
 * A fifth of the depth of a seat's half: far enough that sliding across to steer never
 * reads as a flick, short enough to be one flick of a thumb. It is an input measurement in
 * the device's own frame, not a simulation value — the car never sees it (rule 8).
 */
export const SWIPE_RISE = 90;

/**
 * How near the finger the car has to be before it stops chasing it.
 *
 * A finger names a *place* — the ask is absolute, so it cannot get out of step with the
 * car the way a toggle can — and inside this many units the ask is "stay here".
 */
export const POINTER_SPAN = 36;

/** Ground fill is drawn in columns this wide where the ground is not level. */
const COLUMN = 8;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Where a point in the pit lands in the near seat's half. */
export function pitY(y: number): number {
  return ARENA_TOP + y;
}

/**
 * Where a point in the pit lands across the near seat's half.
 *
 * The pit is numbered from its middle so that the reflection between the two seats is exact
 * (see `ARENA_HALF_WIDTH`); the picture is numbered from its left edge, as every renderer
 * is. This is the one line that joins them, and it is a *drawing* conversion — no
 * simulation value passes through it.
 */
export function pitX(x: number): number {
  return ARENA_HALF_WIDTH + x;
}

/**
 * Where in the pit a seat's finger is pointing, along the pit's own axis.
 *
 * The far seat's half is drawn as the near seat's turned half a turn about the centre of
 * the box, so the far seat's finger has to come back through the same rotation. Both
 * players then see the identical picture the identical way up, and "the left-hand end of
 * the pit" is the same end of the same pit for both of them.
 */
export function pointerPitX(seat: SeatId, x: number): number {
  const own = (seat === 'p1' ? x : BOX_WIDTH - x) - ARENA_HALF_WIDTH;
  if (!Number.isFinite(own)) return Number.NaN;
  return own < -ARENA_HALF_WIDTH
    ? -ARENA_HALF_WIDTH
    : own > ARENA_HALF_WIDTH
      ? ARENA_HALF_WIDTH
      : own;
}

/**
 * How far *into their own half* a seat's finger is, in that seat's own frame.
 *
 * Zero at the edge of the device the player is sitting at and growing away from them, for
 * both seats — which is what makes "flick towards the middle" one line of code rather than
 * a mirror with a side to get wrong.
 */
export function pointerAlong(seat: SeatId, y: number): number {
  return seat === 'p1' ? BOX_HEIGHT - y : y;
}

/**
 * What one seat's instruments have said since the last step.
 *
 * Two latches, and both exist because a jump is an *event* while steering is a *place*. A
 * finger resting high up its half is not asking to jump; a finger that has just travelled
 * up there is. A key held down is not asking to jump on every one of the sixty steps it is
 * held for; the step it went down is.
 */
interface SeatFeel {
  fingerDown: boolean;
  /** The lowest point up their own half the finger has reached since the flick began. */
  swipeBase: number;
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

export class CrashItGame implements Game {
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
    resetMatch(this.#match);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    // Both seats are read before either car is stepped, so neither is answering a pit the
    // other has already moved.
    const p1Throttle = this.#throttleOf('p1', input, fixedDeltaSeconds);
    const p1Jump = this.#jumpOf('p1', input);
    const p2Throttle = this.#throttleOf('p2', input, fixedDeltaSeconds);
    const p2Jump = this.#jumpOf('p2', input);
    stepMatch(this.#match, fixedDeltaSeconds, p1Throttle, p1Jump, p2Throttle, p2Jump);
    this.#winner = winnerOf(this.#match);
  }

  /**
   * What one seat is asking of its car this step, as throttle in [-1, 1].
   *
   * **A finger names a place**, and the car drives to it — the genre's own instruction, and
   * an absolute ask that cannot drift out of step with the car. **A key names a direction**,
   * and needs no mirror: `D` is seat one's right and the right arrow is seat two's right
   * whichever way up either of them is sitting, and both seats are shown the pit the same
   * way up, so +x is to the right for both of them.
   *
   * The *sign* of the key axis is taken rather than the component, because the engine
   * normalises two keys held at once to 0.707 and a player asking to jump should not also
   * be driving three quarters as hard.
   *
   * There is no mode: while a finger is down it has the last word, because it names a place
   * and a key only names a sign.
   */
  #throttleOf(seat: SeatId, input: InputState, fixedDeltaSeconds: number): number {
    const tier = seat === 'p1' ? this.#p1Tier : this.#p2Tier;
    if (tier !== null) {
      const brain = seat === 'p1' ? this.#p1Brain : this.#p2Brain;
      botDrive(this.#match, seat, tier, brain, fixedDeltaSeconds, this.#rng);
      return brain.throttle;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      const want = pointerPitX(seat, pointer.x);
      if (Number.isFinite(want)) {
        const gap = want - carOf(this.#match, seat).x;
        return gap > POINTER_SPAN ? 1 : gap < -POINTER_SPAN ? -1 : gap / POINTER_SPAN;
      }
    }
    const x = seatInput.move.x;
    return x > 0 ? 1 : x < 0 ? -1 : 0;
  }

  /**
   * Whether one seat is asking to leave the ground this step.
   *
   * Every instrument says it and **none of them switches the others off**. A flick of the
   * finger towards the middle of the device is a jump; so is the step the up key goes down;
   * so is the step the action key goes down while no finger is on the glass. That last
   * condition is not fussiness: the engine reports a finger on the glass as the action held,
   * so without it every touch meant to steer would also jump.
   *
   * The finger's rule is a ratchet rather than a threshold: the base follows the finger back
   * down and only moves up when a jump has been taken, so a slow slide up the half costs one
   * jump and not thirty, and a finger resting anywhere at all asks for nothing.
   *
   * Called after {@link #throttleOf} for the same seat, which is what has already run the
   * bot for this step — so a bot's jump is the one it just planned rather than last step's.
   */
  #jumpOf(seat: SeatId, input: InputState): boolean {
    const tier = seat === 'p1' ? this.#p1Tier : this.#p2Tier;
    if (tier !== null) return (seat === 'p1' ? this.#p1Brain : this.#p2Brain).jump;

    const feel = seat === 'p1' ? this.#p1Feel : this.#p2Feel;
    const seatInput = input.seat(seat);
    let jump = false;

    const pointer = seatInput.pointer;
    if (pointer === null) {
      feel.fingerDown = false;
      // A key press only counts while no finger is down, because a finger *is* the action.
      if (seatInput.actionPressed) jump = true;
    } else {
      const along = pointerAlong(seat, pointer.y);
      if (!Number.isFinite(along)) {
        // A browser can hand us a coordinate that is not a number. Neither steer nor jump
        // on it, and leave the ratchet where it was so the next real reading still works.
        feel.fingerDown = false;
      } else if (!feel.fingerDown) {
        feel.fingerDown = true;
        feel.swipeBase = along;
      } else if (along - feel.swipeBase >= SWIPE_RISE) {
        jump = true;
        feel.swipeBase = along;
      } else if (along < feel.swipeBase) {
        feel.swipeBase = along;
      }
    }

    const up = seatInput.move.y < -0.5;
    if (up && !feel.upHeld) jump = true;
    feel.upHeld = up;
    return jump;
  }

  getActiveSeat(): SeatId | null {
    // Never: both cars are live at once, so the shell keeps a pointer zone for each seat.
    return null;
  }

  getScore(): MatchScore {
    return { p1: this.#match.p1Points, p2: this.#match.p2Points, winner: this.#winner };
  }

  /**
   * The gesture latches are dropped, and nothing else needs settling.
   *
   * A flick half taken when the menu opened must not fire on the first step back, and the
   * engine has forgotten the pointer by then anyway. The cars hold no intent of their own:
   * throttle is read fresh from the instrument every step and never latched.
   */
  onPause(): void {
    resetFeel(this.#p1Feel);
    resetFeel(this.#p2Feel);
  }

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
   * The interpolation alpha the contract offers is deliberately not read: every moving
   * thing here is a continuous value the simulation already carries at full resolution, so
   * a frame is the state as it stands rather than a guess between two of them.
   *
   * The far seat's half is the near seat's turned half a turn about the centre of the box,
   * which the renderer does itself. So the pit is authored **once**, in one frame, and both
   * players are shown the same cars in the same places the same way up — the two halves
   * differ only in which car each one marks as yours.
   */
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_NIGHT);
    this.#drawHalf(renderer, 'p1');
    renderer.pushSeatRotation(true);
    this.#drawHalf(renderer, 'p2');
    renderer.popSeatRotation();
    renderer.rect(0, BAND_TOP - 2, BOX_WIDTH, 4, COLOUR_DIVIDER);
  }

  #drawHalf(renderer: Renderer, own: SeatId): void {
    renderer.rect(0, BAND_TOP, BOX_WIDTH, BOX_HEIGHT - BAND_TOP, COLOUR_SKY);
    renderer.rect(0, pitY(0), BOX_WIDTH, 120, COLOUR_HAZE);
    this.#drawGround(renderer);
    this.#drawCar(renderer, 'p1');
    this.#drawCar(renderer, 'p2');
    this.#drawMarker(renderer, own);
    this.#drawStrip(renderer, own);
  }

  /**
   * The floor, as columns under a crust.
   *
   * A level segment is one rectangle; a sloped one is stepped in columns, because the
   * renderer draws rectangles, circles, lines and text and a filled polygon is not among
   * them. The crust is a thick line along the segment itself, so the surface a wheel
   * actually rests on is the line a player sees rather than the top of a staircase.
   */
  #drawGround(renderer: Renderer): void {
    for (let i = 0; i + 1 < GROUND_X.length; i += 1) {
      const ax = GROUND_X[i] ?? 0;
      const ay = GROUND_Y[i] ?? 0;
      const bx = GROUND_X[i + 1] ?? 0;
      const by = GROUND_Y[i + 1] ?? 0;
      if (ay === by) {
        renderer.rect(pitX(ax), pitY(ay), bx - ax, ARENA_HEIGHT - ay, COLOUR_DIRT);
      } else {
        for (let x = ax; x < bx; x += COLUMN) {
          const width = Math.min(COLUMN, bx - x);
          const top = groundY(x + width / 2);
          renderer.rect(pitX(x), pitY(top), width, ARENA_HEIGHT - top, COLOUR_DIRT);
        }
      }
      renderer.line(pitX(ax), pitY(ay), pitX(bx), pitY(by), 7, COLOUR_CRUST);
    }
  }

  /**
   * One car: a rotating body drawn as a thick line, two wheels, and the head on the roof.
   *
   * Rule 7: seat one drives a **wedge** with a pointed nose and a spine stripe and wears a
   * helmet with a **visor bar**; seat two drives a **blunt** car with a rear wing and a
   * three-square roof rack and wears a helmet with a **ring**. Two cars in one pit are the
   * place in the catalogue where telling them apart matters most, so they differ in
   * silhouette, in marking, and in colour — and the first two survive greyscale.
   */
  #drawCar(renderer: Renderer, seat: SeatId): void {
    const car = carOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    const nose = car.facing;

    // A shadow on the ground under the car, which is the cheapest way to read height.
    const shade = clamp01(1 - (groundY(car.x) - car.y) / 240);
    renderer.circle(pitX(car.x), pitY(groundY(car.x)) - 3, 22 * shade + 6, COLOUR_SHADOW);

    renderer.line(
      pitX(bodyX(car, -BODY_HALF_LENGTH, 0)),
      pitY(bodyY(car, -BODY_HALF_LENGTH, 0)),
      pitX(bodyX(car, BODY_HALF_LENGTH, 0)),
      pitY(bodyY(car, BODY_HALF_LENGTH, 0)),
      BODY_HALF_HEIGHT * 2,
      palette.base,
    );

    if (seat === 'p1') {
      // The wedge: a nose that narrows, and a stripe down the spine.
      renderer.line(
        pitX(bodyX(car, nose * BODY_HALF_LENGTH, -BODY_HALF_HEIGHT)),
        pitY(bodyY(car, nose * BODY_HALF_LENGTH, -BODY_HALF_HEIGHT)),
        pitX(bodyX(car, nose * (BODY_HALF_LENGTH + 14), 0)),
        pitY(bodyY(car, nose * (BODY_HALF_LENGTH + 14), 0)),
        7,
        palette.base,
      );
      renderer.line(
        pitX(bodyX(car, -BODY_HALF_LENGTH + 6, -BODY_HALF_HEIGHT + 4)),
        pitY(bodyY(car, -BODY_HALF_LENGTH + 6, -BODY_HALF_HEIGHT + 4)),
        pitX(bodyX(car, BODY_HALF_LENGTH - 6, -BODY_HALF_HEIGHT + 4)),
        pitY(bodyY(car, BODY_HALF_LENGTH - 6, -BODY_HALF_HEIGHT + 4)),
        5,
        COLOUR_INK,
      );
    } else {
      // The blunt one: a rear wing, and three squares along the roof.
      renderer.line(
        pitX(bodyX(car, -nose * (BODY_HALF_LENGTH - 2), -BODY_HALF_HEIGHT)),
        pitY(bodyY(car, -nose * (BODY_HALF_LENGTH - 2), -BODY_HALF_HEIGHT)),
        pitX(bodyX(car, -nose * (BODY_HALF_LENGTH - 2), -BODY_HALF_HEIGHT - 9)),
        pitY(bodyY(car, -nose * (BODY_HALF_LENGTH - 2), -BODY_HALF_HEIGHT - 9)),
        16,
        palette.base,
      );
      for (let i = -1; i <= 1; i += 1) {
        const rackX = pitX(bodyX(car, i * 15, -BODY_HALF_HEIGHT + 4));
        const rackY = pitY(bodyY(car, i * 15, -BODY_HALF_HEIGHT + 4));
        renderer.line(
          rackX - cos * 5,
          rackY - sin * 5,
          rackX + cos * 5,
          rackY + sin * 5,
          8,
          i === 0 ? COLOUR_BONE : COLOUR_INK,
        );
      }
    }

    for (let side = -1; side <= 1; side += 2) {
      const wx = pitX(wheelX(car, side));
      const wy = pitY(wheelY(car, side));
      renderer.circle(wx, wy, WHEEL_RADIUS, COLOUR_TYRE);
      if (seat === 'p1') renderer.circle(wx, wy, 5, COLOUR_BONE);
      else {
        renderer.line(wx - cos * 6, wy - sin * 6, wx + cos * 6, wy + sin * 6, 3, COLOUR_BONE);
        renderer.line(wx + sin * 6, wy - cos * 6, wx - sin * 6, wy + cos * 6, 3, COLOUR_BONE);
      }
    }

    const hx = pitX(headX(car));
    const hy = pitY(headY(car));
    // The neck, so the head reads as attached rather than as a ball over the roof.
    renderer.line(
      pitX(bodyX(car, 0, -BODY_HALF_HEIGHT + 2)),
      pitY(bodyY(car, 0, -BODY_HALF_HEIGHT + 2)),
      hx,
      hy,
      9,
      palette.deep,
    );
    renderer.circle(hx, hy, HEAD_RADIUS, COLOUR_BONE);
    if (seat === 'p1') {
      renderer.line(
        hx - cos * HEAD_RADIUS,
        hy - sin * HEAD_RADIUS,
        hx + cos * HEAD_RADIUS,
        hy + sin * HEAD_RADIUS,
        6,
        COLOUR_INK,
      );
    } else {
      renderer.strokeCircle(hx, hy, 6, 4, COLOUR_INK);
    }

    // A struck head is ringed, so the reason a point was given is on the screen for the
    // second the result is held rather than only in the score.
    if (this.#match.phase !== 'settling') return;
    const struck = this.#match.lastKo;
    if (struck !== seat && struck !== 'draw') return;
    renderer.strokeCircle(hx, hy, HEAD_RADIUS + 7, 4, SEAT_PALETTE[otherOf(seat)].base);
  }

  /**
   * Which of the two cars is yours, and whether your jump is ready.
   *
   * A chevron over your own car in your own half: closed when the jump is there to be
   * taken, and filling back up while the suspension settles. Both halves carry one, each
   * over its own seat's car, so neither player is shown anything the other is not.
   */
  #drawMarker(renderer: Renderer, own: SeatId): void {
    const car = carOf(this.#match, own);
    const palette = SEAT_PALETTE[own];
    const x = pitX(car.x);
    const y = pitY(car.y + HEAD_OFFSET_Y - HEAD_RADIUS - 20);
    const ready = car.grounded && car.jumpCooldown <= 0;
    renderer.line(x - 13, y - 12, x, y, 5, palette.base);
    renderer.line(x + 13, y - 12, x, y, 5, palette.base);
    if (ready) renderer.line(x - 13, y - 12, x + 13, y - 12, 5, palette.base);
    else {
      const left = clamp01(1 - car.jumpCooldown / JUMP_COOLDOWN);
      renderer.line(x - 13, y - 12, x - 13 + 26 * left, y - 12, 5, COLOUR_FAINT);
    }
  }

  /**
   * The seat's own strip, along the divider.
   *
   * Not a scoreboard — the shell prints both numbers already. What it cannot say is *how
   * far there is to go*: five pips a seat, filled from that seat's own end, so a player
   * reads "one more" without arithmetic. Seat one's pips are solid and seat two's are
   * open, so the two rows differ in pattern as well as in colour (rule 7).
   */
  #drawStrip(renderer: Renderer, own: SeatId): void {
    renderer.rect(0, BAND_TOP, BOX_WIDTH, STRIP_HEIGHT, COLOUR_STRIP);
    this.#drawPips(renderer, 'p1', 18);
    this.#drawPips(renderer, 'p2', BOX_WIDTH - 18 - 5 * 26 + 4);

    const left = Math.max(0, MATCH_SECONDS - this.#match.clock);
    renderer.text(String(Math.ceil(left)), BOX_WIDTH / 2, BAND_TOP + 26, 26, COLOUR_BONE, 'centre');
    renderer.text(
      own === 'p1' ? 'YOU ARE THE WEDGE' : 'YOU ARE THE RACK',
      BOX_WIDTH / 2,
      BAND_TOP + 52,
      15,
      COLOUR_FAINT,
      'centre',
    );

    if (this.#match.phase !== 'settling') return;
    const bar = clamp01(this.#match.hold / SETTLE_SECONDS);
    renderer.rect(BOX_WIDTH / 2 - 60, BAND_TOP + 62, 120 * bar, 4, COLOUR_BONE);
  }

  #drawPips(renderer: Renderer, seat: SeatId, x: number): void {
    const palette = SEAT_PALETTE[seat];
    const points = seat === 'p1' ? this.#match.p1Points : this.#match.p2Points;
    for (let i = 0; i < POINTS_TO_WIN; i += 1) {
      const at = x + i * 26;
      if (i < points) renderer.rect(at, BAND_TOP + 20, 18, 18, palette.base);
      else renderer.strokeRect(at + 1, BAND_TOP + 21, 16, 16, 3, COLOUR_FAINT);
      if (seat === 'p2' && i < points) renderer.rect(at + 5, BAND_TOP + 25, 8, 8, COLOUR_INK);
    }
  }
}
