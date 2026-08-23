import { Rng, SEAT_PALETTE } from '@duelbox/engine';
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
  PAW_DOWN_SECONDS,
  PAW_REACH,
  PAW_WARN_SECONDS,
  RACE_SECONDS,
  RAILS,
  TARGET_CHEESE,
  VIEW_AHEAD,
  VIEW_BACK,
  botDecide,
  clampRail,
  createBotState,
  createRace,
  pawIsDown,
  ratOf,
  resetBotState,
  resetRace,
  secondsUntilPawFalls,
  step,
  takenBy,
} from './rules.js';
import type { BotDifficulty, BotState, Race } from './rules.js';

/**
 * Rat Race — two rats, one burrow, and a cat that is not paying full attention.
 *
 * The rules module knows only a distance and a speed. This file gives that a shape: each seat
 * gets a band of the board showing the same window of the same burrow — {@link VIEW_BACK}
 * units behind and {@link VIEW_AHEAD} ahead — with its rat near the bottom of it and the
 * burrow flowing towards it.
 *
 * The far seat's band is drawn through a half turn, exactly as that player is turned, so both
 * people read their own band upright and the renderer never rotates anything at draw time.
 * That is also why steering needs no mirror: field left is that player's left, both ways up.
 */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** One seat's band: the same size for both, because neither may see more than the other. */
export const FIELD_LEFT = 20;
export const FIELD_WIDTH = 560;
export const FIELD_HEIGHT = 437;

/** Where each band sits. Symmetric about the halfway line, to the unit. */
export const P2_TOP = 32;
export const P1_TOP = BOARD_HEIGHT - FIELD_HEIGHT - P2_TOP;
const MIDLINE = BOARD_HEIGHT / 2;

/**
 * Course units to field units.
 *
 * The one place the burrow's units and the board's meet, and the only reason the number 0.46
 * appears anywhere: the band is exactly the window a rat can see, so what is drawn and what a
 * bot is allowed to read cannot drift apart.
 */
export const SCALE = FIELD_HEIGHT / (VIEW_AHEAD + VIEW_BACK);

export const RAIL_WIDTH = FIELD_WIDTH / RAILS;

/** Where the rat sits in its own band: at the window's origin, near the player's edge. */
export const RAT_FIELD_Y = VIEW_AHEAD * SCALE;

/** Floor boards, so the burrow visibly moves. Measured along the course, not the screen. */
const RUNG_PITCH = 95;

/** How far outside its band a finger may stray and still name a rail. */
const RAIL_DEADZONE = RAIL_WIDTH * 0.5;

/** How far the movement axis must open before it reads as a rail change. */
const AXIS_THRESHOLD = 0.5;

/** Steps a swat and a pickup stay marked, so a glance catches what just happened. */
export const FLASH_STEPS = 24;

/** How far a claw reaches in front of the pad it belongs to, in field units. */
const CLAW_LENGTH = 12;

const COLOUR_BACKGROUND = '#0a0e18';
const COLOUR_FLOOR = '#171d2c';
const COLOUR_RUNG = 'rgba(226, 232, 248, 0.09)';
const COLOUR_DIVIDER = 'rgba(226, 232, 248, 0.16)';
const COLOUR_MUTED = 'rgba(226, 232, 248, 0.4)';
const COLOUR_CHEESE = '#ffd35c';
const COLOUR_CHEESE_INK = '#4a3406';
const COLOUR_PAW = '#e7b3bf';
const COLOUR_PAW_INK = '#2b1620';
const COLOUR_CLAW = '#f6f7fb';
const COLOUR_WARN = 'rgba(231, 179, 191, 0.5)';
/** The flattened marker. White rather than red: p1 is already red, and rule 7. */
const COLOUR_FLAT = '#f2f5fb';

/** Scratch for the two corners a mapped rectangle needs. Never nested, never escapes. */
const cornerA = { x: 0, y: 0 };
const cornerB = { x: 0, y: 0 };
const pointerPoint = { x: 0, y: 0 };

const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** Where a seat's band starts on the board. */
export function bandTop(seat: SeatId): number {
  return seat === 'p1' ? P1_TOP : P2_TOP;
}

/**
 * A point in one seat's band, placed on the board.
 *
 * `flipped` is true for the seat reading the device upside down, and turns the band half a
 * turn about its own centre — the same half turn that player is sitting through.
 */
export function toBoard(
  seat: SeatId,
  flipped: boolean,
  fieldX: number,
  fieldY: number,
  out: { x: number; y: number },
): void {
  const top = bandTop(seat);
  if (flipped) {
    out.x = FIELD_LEFT + (FIELD_WIDTH - fieldX);
    out.y = top + (FIELD_HEIGHT - fieldY);
    return;
  }
  out.x = FIELD_LEFT + fieldX;
  out.y = top + fieldY;
}

/** The inverse of {@link toBoard}. A half turn is its own inverse, so it is the same map. */
export function toField(
  seat: SeatId,
  flipped: boolean,
  x: number,
  y: number,
  out: { x: number; y: number },
): void {
  const top = bandTop(seat);
  if (flipped) {
    out.x = FIELD_WIDTH - (x - FIELD_LEFT);
    out.y = FIELD_HEIGHT - (y - top);
    return;
  }
  out.x = x - FIELD_LEFT;
  out.y = y - top;
}

/** Where a point `relative` course units from the rat lands in its band. */
export function fieldYFor(relative: number): number {
  return (VIEW_AHEAD - relative) * SCALE;
}

/** The middle of a rail, in field units. Fractional rails are between rails, as drawn. */
export function railCentreX(rail: number): number {
  return (rail + 0.5) * RAIL_WIDTH;
}

/** Which rail a field x falls on, or -1 when the finger is nowhere near the burrow. */
export function railUnder(fieldX: number): number {
  if (fieldX < -RAIL_DEADZONE || fieldX > FIELD_WIDTH + RAIL_DEADZONE) return -1;
  return clampRail(Math.floor(fieldX / RAIL_WIDTH));
}

function axis(value: number): number {
  if (value > AXIS_THRESHOLD) return 1;
  if (value < -AXIS_THRESHOLD) return -1;
  return 0;
}

/** Per-seat controller state. Allocated once, at construction, and reset in place. */
interface SeatRuntime {
  readonly bot: BotState;
  /** What this seat is asking for this step: the two numbers `step` takes. */
  running: boolean;
  rail: number;
  /** Movement axis last step, so a held key changes one rail rather than sixty. */
  held: number;
  /**
   * Set on resume: the next step adopts whatever the keys currently say without acting on it.
   *
   * Clearing `held` instead would do the opposite of what it looks like — a player who paused
   * mid-press would come back to a key that reads as brand new and a rat that changes rail
   * before they have touched anything.
   */
  resync: boolean;
  /** Steps left of the swat and pickup marks. */
  flatSteps: number;
  grabSteps: number;
  /** Where the rat was before the last step, for render interpolation. */
  prevDistance: number;
  prevRail: number;
}

function createRuntime(): SeatRuntime {
  return {
    bot: createBotState(),
    running: false,
    rail: 1,
    held: 0,
    resync: false,
    flatSteps: 0,
    grabSteps: 0,
    prevDistance: 0,
    prevRail: 1,
  };
}

function resetRuntime(runtime: SeatRuntime): void {
  resetBotState(runtime.bot);
  runtime.running = false;
  runtime.rail = 1;
  runtime.held = 0;
  runtime.resync = false;
  runtime.flatSteps = 0;
  runtime.grabSteps = 0;
  runtime.prevDistance = 0;
  runtime.prevRail = 1;
}

export class RatRaceGame implements Game {
  readonly #race: Race = createRace();
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  /**
   * Three streams from the one seed, and the split is load-bearing.
   *
   * The burrow must not depend on who is running it. Both bots draw from the generator and a
   * tier's *number of decisions* depends on its reaction — `hard` looks four times as often as
   * `easy` — so on a shared stream the pairing would decide where the cheese lies, and every
   * balance number measured against one opponent would be a fiction against another.
   */
  #courseRng = new Rng(1);
  #botRng: Record<SeatId, Rng> = { p1: new Rng(2), p2: new Rng(3) };

  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  get race(): Readonly<Race> {
    return this.#race;
  }

  init(context: GameContext): void {
    this.#courseRng = new Rng(context.rng.next() | 0);
    this.#botRng = { p1: new Rng(context.rng.next() | 0), p2: new Rng(context.rng.next() | 0) };
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetRace(this.#race, this.#courseRng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    this.#drive('p1', this.#runtimeP1, this.#botP1, input, fixedDeltaSeconds);
    this.#drive('p2', this.#runtimeP2, this.#botP2, input, fixedDeltaSeconds);

    this.#runtimeP1.prevDistance = this.#race.p1.distance;
    this.#runtimeP1.prevRail = this.#race.p1.rail;
    this.#runtimeP2.prevDistance = this.#race.p2.distance;
    this.#runtimeP2.prevRail = this.#race.p2.rail;

    const report = step(
      this.#race,
      fixedDeltaSeconds,
      this.#runtimeP1.running,
      this.#runtimeP1.rail,
      this.#runtimeP2.running,
      this.#runtimeP2.rail,
    );

    if (this.#runtimeP1.flatSteps > 0) this.#runtimeP1.flatSteps -= 1;
    if (this.#runtimeP2.flatSteps > 0) this.#runtimeP2.flatSteps -= 1;
    if (this.#runtimeP1.grabSteps > 0) this.#runtimeP1.grabSteps -= 1;
    if (this.#runtimeP2.grabSteps > 0) this.#runtimeP2.grabSteps -= 1;
    for (const seat of report.swatted) this.#runtimeFor(seat).flatSteps = FLASH_STEPS;
    for (const seat of report.grabbed) this.#runtimeFor(seat).grabSteps = FLASH_STEPS;

    this.#winner = this.#race.winner;
  }

  getActiveSeat(): SeatId | null {
    // Never: both rats run at once, so the shell keeps its two pointer zones.
    return null;
  }

  getScore(): MatchScore {
    return { p1: this.#race.p1.cheese, p2: this.#race.p2.cheese, winner: this.#winner };
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    this.#settle();
  }

  destroy(): void {
    this.#botP1 = null;
    this.#botP2 = null;
    this.#winner = null;
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetRace(this.#race, this.#courseRng);
  }

  #settle(): void {
    // A finger cannot still be down on a paused game, but a key can be: it is re-synced on
    // the first step back rather than cleared, so a key held through a pause stays held.
    this.#runtimeP1.resync = true;
    this.#runtimeP2.resync = true;
    this.#runtimeP1.running = false;
    this.#runtimeP2.running = false;
  }

  #runtimeFor(seat: SeatId): SeatRuntime {
    return seat === 'p1' ? this.#runtimeP1 : this.#runtimeP2;
  }

  /** True when this seat reads the device upside down and its band is drawn through a turn. */
  #isFlipped(seat: SeatId): boolean {
    return this.#presentation === 'shared-screen' && seat !== this.#localSeat;
  }

  #drive(
    seat: SeatId,
    runtime: SeatRuntime,
    difficulty: BotDifficulty | null,
    input: InputState,
    fixedDeltaSeconds: number,
  ): void {
    if (difficulty !== null) {
      botDecide(
        this.#race,
        seat,
        BOT_PROFILES[difficulty],
        runtime.bot,
        fixedDeltaSeconds,
        this.#botRng[seat],
      );
      runtime.running = runtime.bot.running;
      runtime.rail = runtime.bot.rail;
      return;
    }
    this.#driveHuman(seat, runtime, input.seat(seat));
  }

  /**
   * One seat's keys and thumb, combined with no mode to switch between.
   *
   * The throttle is **held, never tapped**, which is what makes the two instruments the same
   * game: a held key and a finger resting on the glass are one signal with no repeat rate in
   * it, so nothing here can be won by whoever can drum fastest.
   */
  #driveHuman(seat: SeatId, runtime: SeatRuntime, seatInput: SeatInput): void {
    const direction = axis(seatInput.move.x);
    if (runtime.resync) {
      // First step back from a pause: adopt what the keys say, act on none of it.
      runtime.resync = false;
      runtime.held = direction;
    } else {
      if (direction !== 0 && direction !== runtime.held) {
        runtime.rail = clampRail(runtime.rail + direction);
      }
      runtime.held = direction;
    }

    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // Absolute, and it can be: the split is horizontal, so each seat owns a full-width band
      // and every rail of its own burrow is directly under its own thumb.
      toField(seat, this.#isFlipped(seat), pointer.x, pointer.y, pointerPoint);
      const rail = railUnder(pointerPoint.x);
      if (rail >= 0) runtime.rail = rail;
    }

    runtime.running = seatInput.actionHeld || pointer !== null;
  }

  render(renderer: Renderer, alpha: number): void {
    const blend = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    renderer.clear(COLOUR_BACKGROUND);
    for (const seat of SEATS) this.#drawBand(renderer, seat, blend);
    this.#drawClock(renderer);
  }

  #drawBand(renderer: Renderer, seat: SeatId, blend: number): void {
    const flipped = this.#isFlipped(seat);
    const runtime = this.#runtimeFor(seat);
    const rat = ratOf(this.#race, seat);
    const palette = SEAT_PALETTE[seat];
    const view = runtime.prevDistance + (rat.distance - runtime.prevDistance) * blend;

    renderer.rect(FIELD_LEFT, bandTop(seat), FIELD_WIDTH, FIELD_HEIGHT, COLOUR_FLOOR);
    renderer.strokeRect(FIELD_LEFT, bandTop(seat), FIELD_WIDTH, FIELD_HEIGHT, 3, palette.tint);

    this.#drawFloor(renderer, seat, flipped, view);
    this.#drawCheese(renderer, seat, flipped, view);
    this.#drawPaws(renderer, seat, flipped, view);
    this.#drawRat(renderer, seat, flipped, runtime, blend);
    this.#drawPips(renderer, seat);
  }

  /** Rails and floor boards. The boards are what make speed legible in a still frame. */
  #drawFloor(renderer: Renderer, seat: SeatId, flipped: boolean, view: number): void {
    for (let rail = 1; rail < RAILS; rail += 1) {
      this.#line(
        renderer,
        seat,
        flipped,
        rail * RAIL_WIDTH,
        0,
        rail * RAIL_WIDTH,
        FIELD_HEIGHT,
        2,
        COLOUR_DIVIDER,
      );
    }
    const from = Math.ceil((view - VIEW_BACK) / RUNG_PITCH);
    const to = Math.floor((view + VIEW_AHEAD) / RUNG_PITCH);
    for (let rung = from; rung <= to; rung += 1) {
      const y = fieldYFor(rung * RUNG_PITCH - view);
      this.#line(renderer, seat, flipped, 0, y, FIELD_WIDTH, y, 2, COLOUR_RUNG);
    }
  }

  /** A wedge of cheese: a round body with two holes bitten out of it. */
  #drawCheese(renderer: Renderer, seat: SeatId, flipped: boolean, view: number): void {
    const cheese = this.#race.course.cheese;
    const taken = takenBy(this.#race, seat);
    const rat = ratOf(this.#race, seat);
    for (let i = rat.cheeseHead; i < cheese.length; i += 1) {
      const piece = cheese[i];
      if (piece === undefined) break;
      const relative = piece.position - view;
      if (relative > VIEW_AHEAD) break;
      if (taken[i] === true || relative < -VIEW_BACK) continue;
      const x = railCentreX(piece.rail);
      const y = fieldYFor(relative);
      this.#circle(renderer, seat, flipped, x, y, 15, COLOUR_CHEESE);
      this.#circle(renderer, seat, flipped, x - 5, y - 3, 4, COLOUR_CHEESE_INK);
      this.#circle(renderer, seat, flipped, x + 6, y + 4, 3, COLOUR_CHEESE_INK);
    }
  }

  /**
   * The paws.
   *
   * Down, a paw is a solid pad with claws across the rails it covers. Up, it is an outline of
   * where it will land, and in the last {@link PAW_WARN_SECONDS} a shadow grows inside that
   * outline until the pad fills it. Nothing about a paw is signalled by colour alone: down is
   * filled, about to fall is a growing block, and idle is an empty frame.
   *
   * A paw is the one thing here with length along the burrow, so it is also the one thing that
   * can be half over the horizon — and a claw drawn past the top of the near seat's band lands
   * *inside the far seat's*, seven units of it, which is a paw appearing in a burrow it is not
   * in. Everything below is clipped to the band rather than trusted to fit.
   */
  #drawPaws(renderer: Renderer, seat: SeatId, flipped: boolean, view: number): void {
    const paws = this.#race.course.paws;
    const rat = ratOf(this.#race, seat);
    for (let i = rat.pawHead; i < paws.length; i += 1) {
      const paw = paws[i];
      if (paw === undefined) break;
      const relative = paw.position - view;
      if (relative - PAW_REACH > VIEW_AHEAD) break;
      if (relative + PAW_REACH < -VIEW_BACK) continue;

      const x = paw.rail * RAIL_WIDTH;
      const width = paw.span * RAIL_WIDTH;
      const edge = fieldYFor(relative + PAW_REACH);
      const top = Math.max(0, edge);
      const height = Math.min(FIELD_HEIGHT, edge + PAW_REACH * 2 * SCALE) - top;
      if (height <= 0) continue;
      const down = pawIsDown(paw, this.#race.elapsed);

      if (!down) {
        this.#rect(renderer, seat, flipped, x + 3, top, width - 6, height, COLOUR_FLOOR);
        this.#strokeRect(renderer, seat, flipped, x + 3, top, width - 6, height, 2, COLOUR_WARN);
        const warn = secondsUntilPawFalls(paw, this.#race.elapsed);
        if (warn < PAW_WARN_SECONDS) {
          // A block that grows out of the middle of the frame as the paw comes down.
          const grow = 1 - warn / PAW_WARN_SECONDS;
          const inset = (1 - grow) * 0.5;
          this.#rect(
            renderer,
            seat,
            flipped,
            x + 3 + (width - 6) * inset,
            top + height * inset,
            (width - 6) * grow,
            height * grow,
            COLOUR_WARN,
          );
        }
        continue;
      }

      this.#rect(renderer, seat, flipped, x + 3, top, width - 6, height, COLOUR_PAW);
      // Toes along the leading edge, and claws in front of them: a paw in silhouette. Only
      // once the leading edge is far enough down the band to hold them.
      const toes = paw.span * 2 + 1;
      const radius = PAW_REACH * 2 * SCALE * 0.24;
      if (edge >= CLAW_LENGTH + radius && edge + radius <= FIELD_HEIGHT) {
        for (let toe = 0; toe < toes; toe += 1) {
          const toeX = x + 3 + ((toe + 0.5) / toes) * (width - 6);
          this.#circle(renderer, seat, flipped, toeX, edge, radius, COLOUR_PAW);
          this.#line(
            renderer,
            seat,
            flipped,
            toeX,
            edge - CLAW_LENGTH,
            toeX,
            edge - 2,
            3,
            COLOUR_CLAW,
          );
        }
      }
      const ink = edge + PAW_REACH * 2 * SCALE * 0.42;
      if (ink >= 0 && ink + 4 <= FIELD_HEIGHT) {
        this.#rect(renderer, seat, flipped, x + 3, ink, width - 6, 4, COLOUR_PAW_INK);
      }
    }
  }

  /**
   * p1 runs a round-eared rat with a straight tail, p2 a square-eared one with a kinked tail.
   *
   * Rule 7: the two differ in silhouette as well as colour, so a greyscale screenshot still
   * says which band is whose — and both bands hold a rat at the same place, which is exactly
   * where colour alone stops being enough.
   */
  #drawRat(
    renderer: Renderer,
    seat: SeatId,
    flipped: boolean,
    runtime: SeatRuntime,
    blend: number,
  ): void {
    const rat = ratOf(this.#race, seat);
    const palette = SEAT_PALETTE[seat];
    const rail = runtime.prevRail + (rat.rail - runtime.prevRail) * blend;
    const x = railCentreX(rail);
    const y = RAT_FIELD_Y;
    const flat = rat.stun > 0;
    const body = flat ? palette.deep : palette.base;

    this.#rect(renderer, seat, flipped, x - 13, y - 17, 26, 34, body);
    this.#circle(renderer, seat, flipped, x, y - 19, 11, body);
    if (seat === 'p1') {
      this.#circle(renderer, seat, flipped, x - 9, y - 28, 6, body);
      this.#circle(renderer, seat, flipped, x + 9, y - 28, 6, body);
      this.#line(renderer, seat, flipped, x, y + 17, x, y + 40, 4, body);
    } else {
      this.#rect(renderer, seat, flipped, x - 15, y - 34, 10, 10, body);
      this.#rect(renderer, seat, flipped, x + 5, y - 34, 10, 10, body);
      this.#line(renderer, seat, flipped, x, y + 17, x + 10, y + 27, 4, body);
      this.#line(renderer, seat, flipped, x + 10, y + 27, x - 6, y + 38, 4, body);
    }
    // An eye, so the rat has a front even when it is standing still.
    this.#circle(renderer, seat, flipped, x, y - 22, 3, COLOUR_PAW_INK);
    if (runtime.grabSteps > 0) {
      this.#circle(renderer, seat, flipped, x, y - 42, 7, COLOUR_CHEESE);
    }
    if (!flat) return;

    // Struck through, thicker for the first half second, so the moment reads at a glance.
    const width = runtime.flatSteps > 0 ? 8 : 4;
    this.#line(renderer, seat, flipped, x - 18, y - 18, x + 18, y + 18, width, COLOUR_FLAT);
    this.#line(renderer, seat, flipped, x - 18, y + 18, x + 18, y - 18, width, COLOUR_FLAT);
  }

  /** Cheese carried, as pips along that seat's own outer edge. One pip per piece needed. */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const carried = ratOf(this.#race, seat).cheese;
    const y = seat === 'p1' ? BOARD_HEIGHT - P2_TOP / 2 : P2_TOP / 2;
    const spacing = FIELD_WIDTH / TARGET_CHEESE;
    for (let pip = 0; pip < TARGET_CHEESE; pip += 1) {
      const x = FIELD_LEFT + (pip + 0.5) * spacing;
      const filled = pip < carried;
      const colour = filled ? COLOUR_CHEESE : COLOUR_DIVIDER;
      if (seat === 'p1') renderer.circle(x, y, 8, colour);
      else renderer.rect(x - 7, y - 7, 14, 14, colour);
    }
    // A tick in the seat's own colour marks whose row of pips this is.
    renderer.rect(FIELD_LEFT - 12, y - 3, 8, 6, palette.base);
  }

  /** How much of the race is left, as one bar on the line between the two bands. */
  #drawClock(renderer: Renderer): void {
    const left = Math.max(0, 1 - this.#race.elapsed / RACE_SECONDS);
    renderer.line(0, MIDLINE, BOARD_WIDTH, MIDLINE, 2, COLOUR_DIVIDER);
    renderer.rect(0, MIDLINE - 3, BOARD_WIDTH * left, 6, COLOUR_MUTED);
  }

  #rect(
    renderer: Renderer,
    seat: SeatId,
    flipped: boolean,
    x: number,
    y: number,
    width: number,
    height: number,
    colour: string,
  ): void {
    toBoard(seat, flipped, x, y, cornerA);
    toBoard(seat, flipped, x + width, y + height, cornerB);
    renderer.rect(
      Math.min(cornerA.x, cornerB.x),
      Math.min(cornerA.y, cornerB.y),
      Math.abs(cornerB.x - cornerA.x),
      Math.abs(cornerB.y - cornerA.y),
      colour,
    );
  }

  #strokeRect(
    renderer: Renderer,
    seat: SeatId,
    flipped: boolean,
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    toBoard(seat, flipped, x, y, cornerA);
    toBoard(seat, flipped, x + width, y + height, cornerB);
    renderer.strokeRect(
      Math.min(cornerA.x, cornerB.x),
      Math.min(cornerA.y, cornerB.y),
      Math.abs(cornerB.x - cornerA.x),
      Math.abs(cornerB.y - cornerA.y),
      lineWidth,
      colour,
    );
  }

  #circle(
    renderer: Renderer,
    seat: SeatId,
    flipped: boolean,
    x: number,
    y: number,
    radius: number,
    colour: string,
  ): void {
    toBoard(seat, flipped, x, y, cornerA);
    renderer.circle(cornerA.x, cornerA.y, radius, colour);
  }

  #line(
    renderer: Renderer,
    seat: SeatId,
    flipped: boolean,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    lineWidth: number,
    colour: string,
  ): void {
    toBoard(seat, flipped, x1, y1, cornerA);
    toBoard(seat, flipped, x2, y2, cornerB);
    renderer.line(cornerA.x, cornerA.y, cornerB.x, cornerB.y, lineWidth, colour);
  }
}

/** Re-exported so a test can place a point without duplicating the layout. */
export { PAW_DOWN_SECONDS, PAW_REACH, RAILS, TARGET_CHEESE };
