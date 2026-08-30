import {
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  otherSeat,
  seatRotated,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOT_PROFILES,
  DOUBLE_INNER,
  DOUBLE_OUTER,
  INNER_BULL,
  OUTER_BULL,
  SECTORS,
  STARTING_SCORE,
  TRIPLE_INNER,
  TRIPLE_OUTER,
  botAim,
  createSeatState,
  resetSeatState,
  scatter,
  scoreAt,
  startTurn,
  throwDart,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, SeatState } from './rules.js';

/**
 * Board geometry in logical units. Exported because aiming is not a rendering question —
 * the tests need the same mapping the game uses.
 */
export const BOARD_CENTRE_X = 350;
export const BOARD_CENTRE_Y = 380;
export const BOARD_RADIUS = 290;

/** Where the aiming control sits: low, within thumb reach on a phone. */
export const AIM_CENTRE_X = 350;
export const AIM_CENTRE_Y = 810;
export const AIM_RADIUS = 120;

/**
 * How far the aim reticle travels for a full-radius drag.
 *
 * Deliberately less than 1: a drag to the edge of the control moves the reticle across
 * the board but not off it, so the whole board is reachable and the extremes are not
 * wasted on misses.
 */
const AIM_GAIN = 0.85;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_WIRE = '#0c0f14';
const COLOUR_ODD = '#f4f1e8';
const COLOUR_EVEN = '#1c222b';
const COLOUR_TRIPLE = '#2f9e5c';
const COLOUR_DOUBLE = '#d1493f';
const COLOUR_BULL_OUTER = '#2f9e5c';
const COLOUR_BULL_INNER = '#d1493f';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_CONTROL = '#2a323d';

const DART_RADIUS = 9;
const RETICLE_RADIUS = 22;
const RETICLE_WIDTH = 4;

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.7;
const FLIGHT_SECONDS = 0.28;
const SETTLE_SECONDS = 1.2;

/** Board units to logical units. */
function boardX(x: number): number {
  return BOARD_CENTRE_X + x * BOARD_RADIUS;
}

function boardY(y: number): number {
  return BOARD_CENTRE_Y + y * BOARD_RADIUS;
}

export class DartsGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #p1: SeatState = createSeatState();
  readonly #p2: SeatState = createSeatState();
  readonly #pointerWorld = vec2();
  readonly #aim = { x: 0, y: 0 };
  readonly #landed = { x: 0, y: 0 };
  readonly #flip = new SeatFlip();

  #rng = new Rng(1);
  #active: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  /** What the active seat's score was when its turn began, for the bust rule. */
  #turnStart = STARTING_SCORE;
  /** Darts already thrown this turn, kept as (x, y) board coordinates for drawing. */
  readonly #stuck: { x: number; y: number; seat: SeatId }[] = [];

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #flightSteps = 0;
  #settleSteps = 0;
  /** True once the reticle has been moved this turn, so the aim is deliberate. */
  #aimed = false;
  /**
   * Whether this throw is being aimed with a pointer.
   *
   * Needed because on the step the finger lifts, the pointer is already gone — so asking
   * "is there a pointer now" on the release step takes the keyboard branch and the throw
   * never happens. That bug shipped past the unit tests, whose fake input kept the
   * pointer set through the release; only driving it in a browser showed it.
   */
  #pointerAiming = false;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
    // The shell's opener, never a literal `p1` — the SDK alternates it across the rounds
    // of a best-of so first-mover advantage washes out (#2466), and a game that assumed
    // seat one would leave that rotation reaching nothing.
    this.#active = context.openingSeat;
    this.#turnStart = STARTING_SCORE;
    this.#stuck.length = 0;
    this.#thinkSteps = -1;
    this.#flightSteps = 0;
    this.#settleSteps = 0;
    this.#aimed = false;
    this.#pointerAiming = false;
    this.#aim.x = 0;
    this.#aim.y = 0;
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);

    // Input **edges** are read here, above the phase switch, and not down with the aiming
    // code that acts on them.
    //
    // `pointerCancelled` is true for exactly one step — the engine clears it on the next —
    // and the phases below return early. A cancel raised while a dart was in the air was
    // therefore over before the game next looked at the seat, and was silently dropped
    // (#2505). Reading it up here means every phase *observes* the edge and chooses to
    // ignore it, rather than never being offered it; the alternative, latching the bit
    // until somebody reads it, would change its meaning from "this step" to "since you
    // last looked" for every game in the catalogue.
    this.#readCancel(input);

    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#p1, this.#p2);
      return;
    }

    // A dart in flight: nothing is accepted until it lands, so a fast tapper cannot throw
    // three darts before the first is scored.
    if (this.#flightSteps > 0) {
      this.#flightSteps -= 1;
      if (this.#flightSteps === 0) this.#land();
      return;
    }

    const active = this.#active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      botAim(this.#aim, this.#stateOf(active).remaining);
      scatter(this.#landed, this.#aim.x, this.#aim.y, BOT_PROFILES[difficulty].spread, this.#rng);
      this.#flightSteps = this.#stepsFor(FLIGHT_SECONDS);
      return;
    }

    const seatInput = input.seat(active);
    if (!this.#flip.acceptsInput) return;

    // Drag to aim, release to throw — the pointer idiom for this archetype. Aiming and
    // committing are separate acts, so a player can take as long as they like over the
    // aim and the throw is never a surprise.
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const dx = (this.#pointerWorld.x - AIM_CENTRE_X) / AIM_RADIUS;
      const dy = (this.#pointerWorld.y - AIM_CENTRE_Y) / AIM_RADIUS;
      const distance = Math.hypot(dx, dy);
      // Clamped to the control, so a drag beyond it holds the aim at the edge rather than
      // flinging the reticle off the board.
      const scale = distance > 1 ? 1 / distance : 1;
      this.#aim.x = dx * scale * AIM_GAIN;
      this.#aim.y = dy * scale * AIM_GAIN;
      this.#aimed = true;
      this.#pointerAiming = true;
    }

    // Keys nudge the reticle. Rate-based rather than absolute, so the keyboard and the
    // pointer are comparable instruments rather than one being strictly finer.
    const move = seatInput.move;
    if (move.x !== 0 || move.y !== 0) {
      const speed = 1.1 * fixedDeltaSeconds;
      this.#aim.x = clamp(this.#aim.x + move.x * speed, -1, 1);
      this.#aim.y = clamp(this.#aim.y + move.y * speed, -1, 1);
      this.#aimed = true;
      this.#pointerAiming = false;
    }

    // A pointer commits on release so the aim can be adjusted while held; a key commits
    // on press, because there is nothing to preview while a key is down. Which of the two
    // applies is decided by how the aim was *made*, not by whether a pointer is present
    // on this step — by the time the finger lifts, it is not.
    const commit = this.#pointerAiming ? seatInput.actionReleased : seatInput.actionPressed;
    if (!commit) return;
    if (!this.#aimed) return;

    this.#landed.x = this.#aim.x;
    this.#landed.y = this.#aim.y;
    this.#flightSteps = this.#stepsFor(FLIGHT_SECONDS);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawStuckDarts(renderer);
    this.#drawAimControl(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  /**
   * The score the shell shows.
   *
   * Points *remaining*, not points scored, because that is the number a darts player
   * reads and the one the whole game is about. A HUD counting upwards would be telling
   * the player something true and useless.
   */
  getScore(): MatchScore {
    return { p1: this.#p1.remaining, p2: this.#p2.remaining, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    this.#stuck.length = 0;
    resetSeatState(this.#p1);
    resetSeatState(this.#p2);
  }

  /** Read-only views for the tests and the harness. */
  get activeSeat(): SeatId {
    return this.#active;
  }

  remainingFor(seat: SeatId): number {
    return this.#stateOf(seat).remaining;
  }

  get dartsThrownThisTurn(): number {
    return this.#stateOf(this.#active).thrown;
  }

  get stuckDartCount(): number {
    return this.#stuck.length;
  }

  /** Whether an aim has been made this turn, which is what a throw needs and a cancel drops. */
  get hasAimed(): boolean {
    return this.#aimed;
  }

  get aimX(): number {
    return this.#aim.x;
  }

  get aimY(): number {
    return this.#aim.y;
  }

  #stateOf(seat: SeatId): SeatState {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /**
   * A gesture taken away rather than let go: abandon the aim it was carrying.
   *
   * Per `docs/input-idiom.md` a cancel is the opposite of a release — it never arrives on
   * the same step as one — so nothing is committed and the reticle goes back to centre.
   * The next dart has to be aimed afresh, instead of inheriting a gesture that the player
   * never finished making and the game believes ended normally.
   *
   * A dart already committed is not recalled: it left the hand before the cancel.
   */
  #readCancel(input: InputState): void {
    if (!input.seat(this.#active).pointerCancelled) return;
    this.#aimed = false;
    this.#pointerAiming = false;
    this.#aim.x = 0;
    this.#aim.y = 0;
  }

  #land(): void {
    const seat = this.#active;
    const state = this.#stateOf(seat);
    const landing = scoreAt(this.#landed.x, this.#landed.y);
    this.#stuck.push({ x: this.#landed.x, y: this.#landed.y, seat });

    const result = throwDart(state, landing, this.#turnStart);
    if (result.outcome === 'won') {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }
    if (!result.turnOver) return;

    // The turn is over, by three darts or by a bust.
    this.#active = otherSeat(seat);
    this.#turnStart = this.#stateOf(this.#active).remaining;
    startTurn(this.#stateOf(this.#active));
    this.#stuck.length = 0;
    this.#thinkSteps = -1;
    this.#aimed = false;
    this.#pointerAiming = false;
    this.#aim.x = 0;
    this.#aim.y = 0;
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatRotated(this.#active, this.#presentation, this.#localSeat);
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #drawBoard(renderer: Renderer): void {
    const cx = BOARD_CENTRE_X;
    const cy = BOARD_CENTRE_Y;
    renderer.circle(cx, cy, BOARD_RADIUS * DOUBLE_OUTER, COLOUR_WIRE);

    // Alternating sector fills, then the scoring rings over them. Drawn as wedges by
    // stroking arcs would need an arc primitive the renderer does not have, so the
    // sectors are approximated by radial lines — enough to read the board's structure
    // without pretending to be a photograph of one.
    for (let i = 0; i < SECTORS.length; i += 1) {
      const angle = ((i + 0.5) / SECTORS.length) * Math.PI * 2;
      const inner = BOARD_RADIUS * OUTER_BULL;
      const outer = BOARD_RADIUS * DOUBLE_OUTER;
      renderer.line(
        cx + Math.sin(angle) * inner,
        cy - Math.cos(angle) * inner,
        cx + Math.sin(angle) * outer,
        cy - Math.cos(angle) * outer,
        2,
        COLOUR_WIRE,
      );
    }

    // The rings, outermost first so each sits on the one before.
    renderer.strokeCircle(
      cx,
      cy,
      BOARD_RADIUS * ((DOUBLE_INNER + DOUBLE_OUTER) / 2),
      BOARD_RADIUS * (DOUBLE_OUTER - DOUBLE_INNER),
      COLOUR_DOUBLE,
    );
    renderer.strokeCircle(
      cx,
      cy,
      BOARD_RADIUS * ((TRIPLE_INNER + TRIPLE_OUTER) / 2),
      BOARD_RADIUS * (TRIPLE_OUTER - TRIPLE_INNER),
      COLOUR_TRIPLE,
    );
    renderer.circle(cx, cy, BOARD_RADIUS * OUTER_BULL, COLOUR_BULL_OUTER);
    renderer.circle(cx, cy, BOARD_RADIUS * INNER_BULL, COLOUR_BULL_INNER);

    // A faint ring marks where the board ends, so a miss is legible as a miss.
    renderer.strokeCircle(cx, cy, BOARD_RADIUS * DOUBLE_OUTER, 3, COLOUR_ODD);
    renderer.strokeCircle(cx, cy, BOARD_RADIUS * 0.3, 1, COLOUR_EVEN);
  }

  #drawStuckDarts(renderer: Renderer): void {
    for (const dart of this.#stuck) {
      renderer.circle(
        boardX(dart.x),
        boardY(dart.y),
        DART_RADIUS,
        dart.seat === 'p1' ? COLOUR_P1 : COLOUR_P2,
      );
      renderer.strokeCircle(boardX(dart.x), boardY(dart.y), DART_RADIUS, 2, COLOUR_WIRE);
    }
  }

  /**
   * The aiming control, and the reticle showing where the dart will go.
   *
   * Placed low on purpose: on a phone shared by two people, the thing you drag has to be
   * within thumb reach without your hand covering the board you are aiming at.
   */
  #drawAimControl(renderer: Renderer): void {
    if (this.#matchWinner !== null) return;
    const colour = this.#active === 'p1' ? COLOUR_P1 : COLOUR_P2;
    renderer.strokeCircle(AIM_CENTRE_X, AIM_CENTRE_Y, AIM_RADIUS, 3, COLOUR_CONTROL);
    renderer.circle(
      AIM_CENTRE_X + (this.#aim.x / AIM_GAIN) * AIM_RADIUS,
      AIM_CENTRE_Y + (this.#aim.y / AIM_GAIN) * AIM_RADIUS,
      12,
      colour,
    );

    if (!this.#aimed) return;
    const x = boardX(this.#aim.x);
    const y = boardY(this.#aim.y);
    renderer.strokeCircle(x, y, RETICLE_RADIUS, RETICLE_WIDTH, colour);
    renderer.line(x - RETICLE_RADIUS - 8, y, x + RETICLE_RADIUS + 8, y, 2, colour);
    renderer.line(x, y - RETICLE_RADIUS - 8, x, y + RETICLE_RADIUS + 8, 2, colour);
  }
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export default {
  manifest,
  create: (): Game => new DartsGame(),
};
