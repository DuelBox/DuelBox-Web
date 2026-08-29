import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARM_X,
  ARM_Y,
  BAR,
  CAR_RADIUS,
  LORRY_HALF_LENGTH,
  LORRY_HALF_WIDTH,
  botAim,
  carOf,
  clearMatch,
  createBotState,
  createDirection,
  createMatch,
  lorryX,
  lorryY,
  resetBotState,
  resetMatch,
  stepMatch,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Car, Direction, Match } from './rules.js';

/**
 * Traffic Jam — one crossroads in open water, a car each, and lorries running the roads.
 *
 * The rules module holds the whole simulation. What lives here is how a person says "point
 * that way" through it, and how one shared island is drawn for two people sitting at
 * opposite ends of a device.
 *
 * **There is no per-seat view, and that is deliberate.** The other `rt-race` games give each
 * seat its own window on its own road; this one cannot, because the entire mechanic is that
 * the two cars can touch. One board, drawn once, read by both — which makes rule 9 a fact
 * about the picture rather than a property two halves have to be checked for.
 */

/** Where the junction sits in the logical box. The only place the two frames meet. */
export const CENTRE_X = ARENA_WIDTH / 2;
export const CENTRE_Y = ARENA_HEIGHT / 2;

/**
 * How far a thumb has to travel from where it landed before it is steering.
 *
 * The engine quantises every pointer onto a 3-unit lattice (its precision envelope), so this
 * is four or five of those: far enough that a still thumb is still, near enough that the
 * stick answers the moment it is meant to.
 */
export const STICK_DEADZONE = 14;

/** How far out the drawn knob may sit from the base. Picture only; the rule is direction. */
const STICK_RADIUS = 78;

const COLOUR_WATER = '#0d2233';
const COLOUR_WAVE = 'rgba(151, 196, 224, 0.22)';
const COLOUR_GHOST = 'rgba(151, 196, 224, 0.3)';
const COLOUR_KERB = '#e9eef5';
const COLOUR_TARMAC = '#2f3742';
const COLOUR_DASH = 'rgba(233, 238, 245, 0.55)';
const COLOUR_BOX = 'rgba(233, 196, 76, 0.85)';
const COLOUR_LORRY = '#c8ccd4';
const COLOUR_LORRY_DEEP = '#7c828e';
const COLOUR_INK = '#141922';
const COLOUR_BONE = '#f4f7fb';
const COLOUR_STICK = 'rgba(244, 247, 251, 0.22)';

/** The car, drawn: a 72 × 50 body around the 30-unit collision disc. */
const BODY_HALF_LENGTH = 36;
const BODY_WIDTH = 50;
const KERB_WIDTH = 7;
const DASH_PITCH = 78;
const DASH_LENGTH = 38;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Where in the logical box a point of the simulation lands.
 *
 * The junction is the origin of the simulation and the middle of the box in the picture, and
 * these two functions are the whole of the mapping — there is no scale factor, because the
 * island was sized in the units it is drawn in. Nothing in the rules knows about them.
 */
export function boxX(x: number): number {
  return CENTRE_X + x;
}

export function boxY(y: number): number {
  return CENTRE_Y + y;
}

/**
 * The direction a thumb is asking for, from where it went down to where it is now.
 *
 * A **floating stick**: the point the finger landed on is the base, wherever in that seat's
 * half it happens to be, and the direction is the drag away from it. That is the joystick the
 * genre's own rule names, and it is the only idiom that works here — an absolute "drive
 * towards my finger" cannot ask for a direction the seat's own half does not contain, so a
 * player whose car had crossed the midline could never steer it back.
 *
 * Length is read only against the deadzone. Beyond it a nudge and a full sweep say exactly
 * the same thing, which is what makes a thumb worth precisely what a key is worth: both name
 * a direction and nothing else.
 */
export function stickDirection(
  out: Direction,
  originX: number,
  originY: number,
  x: number,
  y: number,
): Direction {
  const dx = x - originX;
  const dy = y - originY;
  const distSq = dx * dx + dy * dy;
  if (!(distSq > STICK_DEADZONE * STICK_DEADZONE)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const inv = 1 / Math.sqrt(distSq);
  out.x = dx * inv;
  out.y = dy * inv;
  return out;
}

/** One seat's floating stick, latched when the finger lands and dropped when it lifts. */
interface Stick {
  down: boolean;
  originX: number;
  originY: number;
  x: number;
  y: number;
}

function createStick(): Stick {
  return { down: false, originX: 0, originY: 0, x: 0, y: 0 };
}

function releaseStick(stick: Stick): void {
  stick.down = false;
  stick.originX = 0;
  stick.originY = 0;
  stick.x = 0;
  stick.y = 0;
}

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class TrafficJamGame implements Game {
  readonly #match: Match = createMatch();
  readonly #p1Brain: BotState = createBotState();
  readonly #p2Brain: BotState = createBotState();
  readonly #p1Stick: Stick = createStick();
  readonly #p2Stick: Stick = createStick();
  readonly #p1Want: Direction = createDirection();
  readonly #p2Want: Direction = createDirection();
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };

  #rng = new Rng(1);
  #p1Tier: BotDifficulty | null = null;
  #p2Tier: BotDifficulty | null = null;

  /** Read-only view for the tests and the balance harness. Never mutate through it. */
  get match(): Match {
    return this.#match;
  }

  /** Read-only view of a seat's stick, so `game.test.ts` can assert the idiom. */
  stick(seat: SeatId): Readonly<Stick> {
    return seat === 'p1' ? this.#p1Stick : this.#p2Stick;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#p1Tier = context.botDifficulty('p1');
    this.#p2Tier = context.botDifficulty('p2');
    resetBotState(this.#p1Brain);
    resetBotState(this.#p2Brain);
    releaseStick(this.#p1Stick);
    releaseStick(this.#p2Stick);
    resetMatch(this.#match, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#match.winner !== null) return;

    // Both seats are read before either car moves, so neither ever acts on the other's
    // post-step position, and the two bots always draw in the same order.
    this.#steer('p1', input, fixedDeltaSeconds, this.#p1Want);
    this.#steer('p2', input, fixedDeltaSeconds, this.#p2Want);
    stepMatch(
      this.#match,
      fixedDeltaSeconds,
      this.#p1Want.x,
      this.#p1Want.y,
      this.#p2Want.x,
      this.#p2Want.y,
      this.#rng,
    );
  }

  /**
   * What one seat is asking of its car this step, as a direction to point in.
   *
   * The three sources say the same thing three ways and all three end at the same
   * `TURN_RATE`: a thumb names a direction by dragging, a key names one by being that
   * key, and a bot names one outright. None of them can point a car somewhere sooner,
   * further or finer than another, because there is nothing to point *with* except a
   * direction.
   *
   * **A finger down wins over a held key.** A player with a thumb on the glass is steering
   * with the thumb; a stick inside its deadzone is that player saying *hold this line*,
   * which is a real answer rather than an absence of one. With no finger at all the keys
   * have it, and with neither the car keeps driving the way it was pointed — a car in this
   * game is never not moving.
   *
   * **Neither seat's input is mirrored, and that is the point.** The board is shared and the
   * far seat reads it upside down, so what both players actually see is a thumb and a car
   * moving the same way across the same glass. A mirror would make the near seat's thumb
   * agree with the picture and the far seat's disagree with it.
   */
  #steer(seat: SeatId, input: InputState, fixedDeltaSeconds: number, out: Direction): void {
    const tier = seat === 'p1' ? this.#p1Tier : this.#p2Tier;
    if (tier !== null) {
      const brain = seat === 'p1' ? this.#p1Brain : this.#p2Brain;
      botAim(out, this.#match, seat, tier, brain, fixedDeltaSeconds, this.#rng);
      return;
    }

    const seatInput = input.seat(seat);
    const stick = seat === 'p1' ? this.#p1Stick : this.#p2Stick;
    const pointer = seatInput.pointer;
    if (pointer === null) {
      releaseStick(stick);
      out.x = seatInput.move.x;
      out.y = seatInput.move.y;
      return;
    }

    if (!stick.down) {
      stick.down = true;
      stick.originX = pointer.x;
      stick.originY = pointer.y;
    }
    stick.x = pointer.x;
    stick.y = pointer.y;
    stickDirection(out, stick.originX, stick.originY, pointer.x, pointer.y);
  }

  getActiveSeat(): SeatId | null {
    // Never: both cars are live at once, so the shell keeps a pointer zone for each seat.
    return null;
  }

  getScore(): MatchScore {
    this.#score.p1 = this.#match.p1Score;
    this.#score.p2 = this.#match.p2Score;
    this.#score.winner = winnerOf(this.#match);
    return this.#score;
  }

  /**
   * The sticks are dropped and nothing else is.
   *
   * A finger held through a pause is a finger the engine has already forgotten — it clears
   * its own pointers — so a base latched from before the pause would be measured against a
   * finger that landed somewhere else entirely, and the car would jerk on the first step
   * back. Everything else in this game is momentum, which is state rather than intent, and
   * resumes exactly as it stood.
   */
  onPause(): void {
    releaseStick(this.#p1Stick);
    releaseStick(this.#p2Stick);
  }

  onResume(): void {}

  destroy(): void {
    this.#p1Tier = null;
    this.#p2Tier = null;
    resetBotState(this.#p1Brain);
    resetBotState(this.#p2Brain);
    releaseStick(this.#p1Stick);
    releaseStick(this.#p2Stick);
    clearMatch(this.#match);
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
  }

  /**
   * Draws the state as it stands.
   *
   * The interpolation alpha the contract offers is deliberately not read. Every moving thing
   * here — both cars, every lorry, the water's edge — is a continuous value the simulation
   * already carries at full resolution, so a frame is the state as it stands rather than a
   * guess between two of them.
   */
  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_WATER);
    this.#drawWater(renderer);
    this.#drawRoad(renderer);
    this.#drawTraffic(renderer);
    // The far seat's car first, so a pile-up in the junction never hides the near seat's.
    this.#drawCar(renderer, 'p2');
    this.#drawCar(renderer, 'p1');
    this.#drawStick(renderer, 'p1');
    this.#drawStick(renderer, 'p2');
  }

  /**
   * The water, and a ghost of the road at rest.
   *
   * The ghost is the only thing on screen that says how much road has already gone, and it
   * says it in shape rather than in colour: the live kerb is a hard bright edge and the
   * outline it has retreated from is a thin one. Both seats read the same two edges.
   *
   * The wave rows are laid down **in mirrored pairs either side of the junction**, so the
   * water is invariant under the same half turn the island is (`rules.ts`, `onRoad`) and the
   * far seat is looking at the same sea rather than at a different one. The stagger is read
   * off the row index: taking it from `y` instead — `(y / 52) % 2 === 0` on rows starting at
   * 26 — is never true, which quietly gave every row the same inset and no stagger at all.
   */
  #drawWater(renderer: Renderer): void {
    for (let row = 0; 26 + row * 52 <= CENTRE_Y; row += 1) {
      const offset = 26 + row * 52;
      const inset = row % 2 === 0 ? 18 : 62;
      this.#waveRow(renderer, CENTRE_Y - offset, inset);
      this.#waveRow(renderer, CENTRE_Y + offset, inset);
    }
    if (this.#match.flood <= 0) return;
    renderer.strokeRect(boxX(-ARM_X), boxY(-BAR), ARM_X * 2, BAR * 2, 2, COLOUR_GHOST);
    renderer.strokeRect(boxX(-BAR), boxY(-ARM_Y), BAR * 2, ARM_Y * 2, 2, COLOUR_GHOST);
  }

  /** One row of waves, drawn the same distance in from each side of the box. */
  #waveRow(renderer: Renderer, y: number, inset: number): void {
    renderer.line(inset, y, inset + 74, y, 3, COLOUR_WAVE);
    renderer.line(ARENA_WIDTH - inset - 74, y, ARENA_WIDTH - inset, y, 3, COLOUR_WAVE);
  }

  /**
   * The island: kerbs, tarmac, lane markings and the box junction.
   *
   * Both carriageways are laid down twice — once oversize in kerb white, once at their true
   * size in tarmac — so the bright edge that appears is exactly the outline of the union of
   * the two, and the losing line a player reads is the line `onRoad` tests. Drawing an
   * outline instead would have to trace six corners and get every one of them right as the
   * flood moves them.
   */
  #drawRoad(renderer: Renderer): void {
    const arena = this.#match.arena;
    const armX = arena.armX;
    const armY = arena.armY;
    const bar = arena.bar;
    const k = KERB_WIDTH;
    renderer.rect(boxX(-armX - k), boxY(-bar - k), (armX + k) * 2, (bar + k) * 2, COLOUR_KERB);
    renderer.rect(boxX(-bar - k), boxY(-armY - k), (bar + k) * 2, (armY + k) * 2, COLOUR_KERB);
    renderer.rect(boxX(-armX), boxY(-bar), armX * 2, bar * 2, COLOUR_TARMAC);
    renderer.rect(boxX(-bar), boxY(-armY), bar * 2, armY * 2, COLOUR_TARMAC);

    // Lane markings down the middle of each carriageway, stopping short of the junction.
    for (let along = bar + 18; along + DASH_LENGTH < armY; along += DASH_PITCH) {
      renderer.line(boxX(0), boxY(along), boxX(0), boxY(along + DASH_LENGTH), 5, COLOUR_DASH);
      renderer.line(boxX(0), boxY(-along), boxX(0), boxY(-along - DASH_LENGTH), 5, COLOUR_DASH);
    }
    for (let along = bar + 18; along + DASH_LENGTH < armX; along += DASH_PITCH) {
      renderer.line(boxX(along), boxY(0), boxX(along + DASH_LENGTH), boxY(0), 5, COLOUR_DASH);
      renderer.line(boxX(-along), boxY(0), boxX(-along - DASH_LENGTH), boxY(0), 5, COLOUR_DASH);
    }

    // The box junction, hatched. A pattern rather than a tint, so the middle of the island
    // is still the middle of the island in greyscale.
    const span = bar * 2;
    renderer.strokeRect(boxX(-bar), boxY(-bar), span, span, 3, COLOUR_BOX);
    for (let step = -bar + 26; step < bar; step += 34) {
      renderer.line(boxX(step), boxY(-bar), boxX(-bar), boxY(step), 2, COLOUR_BOX);
      renderer.line(boxX(bar), boxY(step), boxX(step), boxY(bar), 2, COLOUR_BOX);
    }
  }

  /**
   * The lorries.
   *
   * Rule 7: a lorry is not a coloured box. It is a pale slab with a dark cab at the end it is
   * driving towards and three hazard bars down its back, so which way it is going is legible
   * in silhouette — and it can never be mistaken for a car, which is a rounded body with a
   * bright nose and a seat mark on its roof.
   */
  #drawTraffic(renderer: Renderer): void {
    const traffic = this.#match.traffic;
    for (let i = 0; i < traffic.length; i += 1) {
      const lorry = traffic[i];
      if (lorry === undefined || !lorry.active) continue;
      const vertical = lorry.axis === 1;
      const halfX = vertical ? LORRY_HALF_WIDTH : LORRY_HALF_LENGTH;
      const halfY = vertical ? LORRY_HALF_LENGTH : LORRY_HALF_WIDTH;
      const cx = lorryX(lorry);
      const cy = lorryY(lorry);
      renderer.rect(boxX(cx - halfX), boxY(cy - halfY), halfX * 2, halfY * 2, COLOUR_LORRY);

      const ahead = lorry.speed < 0 ? -1 : 1;
      const cabDepth = 22;
      if (vertical) {
        const front = cy + ahead * halfY;
        renderer.rect(
          boxX(cx - halfX),
          boxY(ahead > 0 ? front - cabDepth : front),
          halfX * 2,
          cabDepth,
          COLOUR_INK,
        );
        for (let stripe = 1; stripe <= 3; stripe += 1) {
          const at = cy - ahead * (halfY - stripe * 22);
          renderer.line(
            boxX(cx - halfX),
            boxY(at),
            boxX(cx + halfX),
            boxY(at),
            5,
            COLOUR_LORRY_DEEP,
          );
        }
      } else {
        const front = cx + ahead * halfX;
        renderer.rect(
          boxX(ahead > 0 ? front - cabDepth : front),
          boxY(cy - halfY),
          cabDepth,
          halfY * 2,
          COLOUR_INK,
        );
        for (let stripe = 1; stripe <= 3; stripe += 1) {
          const at = cx - ahead * (halfX - stripe * 22);
          renderer.line(
            boxX(at),
            boxY(cy - halfY),
            boxX(at),
            boxY(cy + halfY),
            5,
            COLOUR_LORRY_DEEP,
          );
        }
      }
    }
  }

  /**
   * A car, driving or going under.
   *
   * Rule 7, twice over. The two seats differ by **shape**: player one carries a chevron on
   * the roof pointing the way it is facing, player two two bars across it. And a car in the
   * water differs from a car on the road by shape too — it shrinks, gains a ring of ripples
   * and is struck through — rather than by turning a different colour.
   */
  #drawCar(renderer: Renderer, seat: SeatId): void {
    const car: Readonly<Car> = carOf(this.#match, seat);
    const palette = SEAT_PALETTE[seat];
    const sunk = clamp01(car.sink);
    const scale = 1 - sunk * 0.55;
    const cos = Math.cos(car.heading) * scale;
    const sin = Math.sin(car.heading) * scale;
    const cx = boxX(car.x);
    const cy = boxY(car.y);

    if (car.inWater) {
      const ring = CAR_RADIUS + sunk * 46;
      renderer.strokeCircle(cx, cy, ring, 3, COLOUR_BONE);
      renderer.strokeCircle(cx, cy, ring * 0.62, 2, COLOUR_BONE);
    }

    const half = BODY_HALF_LENGTH * scale;
    const width = BODY_WIDTH * scale;
    renderer.line(
      cx - cos * half,
      cy - sin * half,
      cx + cos * half,
      cy + sin * half,
      width,
      car.inWater ? palette.deep : palette.base,
    );
    // The nose: a bright bar across the front, so which way a car is pointing never depends
    // on telling two similar colours apart.
    const nose = half * 0.82;
    const flank = width * 0.5;
    renderer.line(
      cx + cos * nose - -sin * flank,
      cy + sin * nose - cos * flank,
      cx + cos * nose + -sin * flank,
      cy + sin * nose + cos * flank,
      6,
      COLOUR_BONE,
    );

    if (seat === 'p1') {
      // A chevron pointing forward.
      const tip = half * 0.42;
      const back = -half * 0.2;
      const arm = width * 0.32;
      renderer.line(
        cx + cos * back + -sin * -arm,
        cy + sin * back + cos * -arm,
        cx + cos * tip,
        cy + sin * tip,
        6,
        COLOUR_INK,
      );
      renderer.line(
        cx + cos * back + -sin * arm,
        cy + sin * back + cos * arm,
        cx + cos * tip,
        cy + sin * tip,
        6,
        COLOUR_INK,
      );
    } else {
      // Two bars across the roof. Unrolled rather than looped over an array: a literal
      // array here would be one allocation per car per frame.
      const arm = width * 0.34;
      this.#roofBar(renderer, cx, cy, cos, sin, -half * 0.24, arm);
      this.#roofBar(renderer, cx, cy, cos, sin, half * 0.16, arm);
    }

    if (!car.inWater) return;
    renderer.line(cx - 22, cy - 22, cx + 22, cy + 22, 6, COLOUR_BONE);
    renderer.line(cx - 22, cy + 22, cx + 22, cy - 22, 6, COLOUR_BONE);
  }

  #roofBar(
    renderer: Renderer,
    cx: number,
    cy: number,
    cos: number,
    sin: number,
    at: number,
    arm: number,
  ): void {
    renderer.line(
      cx + cos * at + sin * arm,
      cy + sin * at - cos * arm,
      cx + cos * at - sin * arm,
      cy + sin * at + cos * arm,
      6,
      COLOUR_INK,
    );
  }

  /**
   * The stick, while a thumb is on the glass.
   *
   * Drawn where the finger landed rather than in a fixed corner, because that is where it
   * is: a base a player cannot see is a base they cannot aim from. Clamped into the box so a
   * thumb resting on the bezel still shows one.
   */
  #drawStick(renderer: Renderer, seat: SeatId): void {
    const stick = seat === 'p1' ? this.#p1Stick : this.#p2Stick;
    if (!stick.down) return;
    const baseX = clampBox(stick.originX, ARENA_WIDTH);
    const baseY = clampBox(stick.originY, ARENA_HEIGHT);
    let dx = clampBox(stick.x, ARENA_WIDTH) - baseX;
    let dy = clampBox(stick.y, ARENA_HEIGHT) - baseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STICK_RADIUS) {
      dx = (dx / dist) * STICK_RADIUS;
      dy = (dy / dist) * STICK_RADIUS;
    }
    renderer.strokeCircle(baseX, baseY, STICK_RADIUS, 3, COLOUR_STICK);
    renderer.strokeCircle(baseX, baseY, STICK_DEADZONE, 2, COLOUR_STICK);
    renderer.circle(baseX + dx, baseY + dy, 22, SEAT_PALETTE[seat].soft);
  }
}

/** Keep a drawn point inside the box, so a finger on the bezel still has a stick. */
function clampBox(value: number, limit: number): number {
  if (!Number.isFinite(value)) return limit / 2;
  return value < 0 ? 0 : value > limit ? limit : value;
}
