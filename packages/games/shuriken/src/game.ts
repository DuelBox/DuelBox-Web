import { Rng, SEAT_PALETTE, SeatFlip, seatRotated, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CANE_RADIUS,
  MAX_SPIN,
  MAX_THROWS,
  ROCKS,
  SHURIKEN_RADIUS,
  THROW_X,
  THROW_Y,
  addSpin,
  advanceArc,
  aimTowards,
  botTurn,
  createBotPlan,
  createState,
  hitsRock,
  offBoard,
  resetBotPlan,
  resetState,
  standingFor,
  step,
  throwShuriken,
  turnAim,
  winnerOf,
} from './rules.js';
import type { ArcPoint, BotDifficulty, BotPlan, Cane, State } from './rules.js';

/**
 * Shuriken — a grove of bamboo, a curve, and one blade at a time.
 *
 * The whole game is two numbers: where the throw points and how hard it is spun. A straight
 * throw reaches half of the other seat's canes; the rest stand behind a stone and have to be
 * come at around the outside. So the pointer idiom is the one the reference genre describes —
 * grab the blade, and the sideways travel of your finger is the spin — and the keyboard
 * spells the same two numbers with two axes.
 */

/** Radians a second the sight swings under a held direction key. */
const AIM_KEY_RATE = 1.15;
/** Radians a second, per second, that a held up or down key winds spin on. */
const SPIN_KEY_RATE = 2.6;
/**
 * Spin picked up per logical unit of sideways finger travel.
 *
 * A full hook wants about 320 units of drag — half the width of the board — so a deliberate
 * sweep spins the blade fully and a small correction of the aim barely touches it.
 */
const SPIN_PER_UNIT = 0.006;

/** How much of the flight the sight shows. Enough to read the curve, not enough to aim for you. */
const GUIDE_SECONDS = 0.34;
const GUIDE_DOTS = 11;

const COLOUR_BACKGROUND = '#101a14';
const COLOUR_GROUND = '#16241b';
const COLOUR_LANE = '#1b2c20';
const COLOUR_MIDLINE = 'rgba(206, 219, 200, 0.14)';
const COLOUR_ROCK = '#454b52';
const COLOUR_ROCK_TOP = '#5c646d';
const COLOUR_CANE_BODY = '#8dbe58';
const COLOUR_CANE_CORE = '#d7ecb3';
const COLOUR_STUMP = '#37472f';
const COLOUR_STEEL = '#e2e8f0';
const COLOUR_STEEL_EDGE = '#8d97a4';
const COLOUR_GUIDE = 'rgba(226, 232, 240, 0.45)';
const COLOUR_MUTED = 'rgba(206, 219, 200, 0.3)';

/** Blades on the shuriken. Four, and drawn from the hub, so the spin is legible in flight. */
const BLADES = 4;
const BLADE_LENGTH = 19;

export class ShurikenGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #state: State = createState();
  readonly #flip = new SeatFlip();
  readonly #p1Plan: BotPlan = createBotPlan();
  readonly #p2Plan: BotPlan = createBotPlan();
  readonly #pointerWorld: Vec2 = vec2();
  /** Scratch for the sight. Walked every frame, so it is allocated once here. */
  readonly #guide: ArcPoint = { x: 0, y: 0, heading: 0 };

  #rng = new Rng(1);
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /** Where the finger was last step, in world units, so its travel can become spin. */
  #lastPointerX = THROW_X;
  #pointerDown = false;
  /**
   * Whether this throw is being aimed with a pointer.
   *
   * Needed because on the step the finger lifts the pointer is already gone — so asking
   * "is there a pointer now" on the release step takes the keyboard branch and the throw
   * never happens. Darts shipped that bug past its unit tests; this is the same fix.
   */
  #pointerAiming = false;
  /** Counts down a flash after bamboo falls, in seconds. */
  #cutFlash = 0;

  /** Read-only view for the tests and the harness. */
  get state(): State {
    return this.#state;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#cutFlash = 0;
    this.#lastPointerX = THROW_X;
    this.#pointerDown = false;
    this.#pointerAiming = false;
    resetBotPlan(this.#p1Plan);
    resetBotPlan(this.#p2Plan);
    resetState(this.#state, this.#rng, context.openingSeat);
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#cutFlash > 0) this.#cutFlash -= fixedDeltaSeconds;
    if (this.#winner !== null) return;

    if (this.#state.phase === 'aiming') this.#takeThrow(input, fixedDeltaSeconds);

    const outcome = step(this.#state, fixedDeltaSeconds);
    if (outcome.cut > 0) this.#cutFlash = 0.4;
    if (outcome.handedOver) {
      // A fresh turn is a fresh instrument: whatever the last player was holding says
      // nothing about what this one has.
      this.#pointerAiming = false;
      this.#pointerDown = false;
    }
    this.#winner = winnerOf(this.#state);
  }

  #takeThrow(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#state.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#driveBot(active, difficulty, fixedDeltaSeconds);
      return;
    }

    // Nothing is accepted while the board is part-way round: the grove a player is reading
    // is moving under them, and a tap would name a direction they did not mean.
    if (!this.#flip.acceptsInput) return;
    const seatInput = input.seat(active);

    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const x = this.#pointerWorld.x;
      aimTowards(this.#state, x, this.#pointerWorld.y);
      // Sideways travel is the spin — the reference genre's own instruction, and the reason
      // the first frame of a touch adds none: a finger arriving has not travelled yet.
      if (this.#pointerDown) addSpin(this.#state, (x - this.#lastPointerX) * SPIN_PER_UNIT);
      this.#lastPointerX = x;
      this.#pointerDown = true;
      this.#pointerAiming = true;
    } else {
      this.#pointerDown = false;
    }

    // Keys swing the sight and wind the spin on. Rate-based rather than absolute, so the
    // keyboard and the thumb are comparable instruments rather than one being strictly finer.
    const move = seatInput.move;
    if (move.x !== 0) {
      turnAim(this.#state, move.x * AIM_KEY_RATE * fixedDeltaSeconds);
      this.#pointerAiming = false;
    }
    if (move.y !== 0) {
      addSpin(this.#state, move.y * SPIN_KEY_RATE * fixedDeltaSeconds);
      this.#pointerAiming = false;
    }

    // A finger commits on release, so the throw can be adjusted while it is held; a key
    // commits on press, because there is nothing to preview while a key is down. Which
    // applies is decided by how the throw was *aimed*, not by what is present this step.
    const commit = this.#pointerAiming ? seatInput.actionReleased : seatInput.actionPressed;
    if (!commit) return;
    if (!throwShuriken(this.#state, active)) return;
    this.#pointerAiming = false;
    this.#pointerDown = false;
  }

  /**
   * The bot's turn: look once, commit to a throw, and take a moment over it.
   *
   * It never consults the seat flip. That is a presentation detail, and a bot whose timing
   * depended on it would play a different match on one device than on another.
   */
  #driveBot(seat: SeatId, difficulty: BotDifficulty, fixedDeltaSeconds: number): void {
    const plan = seat === 'p1' ? this.#p1Plan : this.#p2Plan;
    if (!botTurn(this.#state, seat, difficulty, plan, this.#rng, fixedDeltaSeconds)) return;
    throwShuriken(this.#state, seat);
    resetBotPlan(plan);
  }

  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the board upside down.
    return seatRotated(this.#state.active, this.#presentation, this.#localSeat);
  }

  getActiveSeat(): SeatId {
    return this.#state.active;
  }

  getScore(): MatchScore {
    return {
      p1: standingFor(this.#state, 'p1'),
      p2: standingFor(this.#state, 'p2'),
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetState(this.#state, this.#rng);
    resetBotPlan(this.#p1Plan);
    resetBotPlan(this.#p2Plan);
    this.#winner = null;
    this.#cutFlash = 0;
    this.#pointerDown = false;
    this.#pointerAiming = false;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawGround(renderer);
    this.#drawRocks(renderer);
    this.#drawGrove(renderer);
    this.#drawSight(renderer);
    this.#drawHand(renderer);
    this.#drawBlade(renderer);
    renderer.popSeatRotation();
  }

  #drawGround(renderer: Renderer): void {
    renderer.rect(0, 120, BOARD_WIDTH, BOARD_HEIGHT - 240, COLOUR_GROUND);
    // Two lanes of raked gravel, symmetric about the centre so the half-turn moves nothing.
    renderer.rect(40, 180, BOARD_WIDTH - 80, 4, COLOUR_LANE);
    renderer.rect(40, BOARD_HEIGHT - 184, BOARD_WIDTH - 80, 4, COLOUR_LANE);
    // The centre line, which is the promise the whole layout rests on: your six and their
    // six are the same six reflected.
    renderer.line(THROW_X, 150, THROW_X, BOARD_HEIGHT - 150, 2, COLOUR_MIDLINE);

    if (this.#cutFlash > 0) {
      renderer.strokeRect(30, 130, BOARD_WIDTH - 60, BOARD_HEIGHT - 260, 5, COLOUR_MUTED);
    }

    // Throws left in the match, as a bar across the foot. It is the other way this ends.
    const left = Math.max(0, 1 - this.#state.throws / MAX_THROWS);
    renderer.rect(60, BOARD_HEIGHT - 34, (BOARD_WIDTH - 120) * left, 4, COLOUR_MUTED);
  }

  #drawRocks(renderer: Renderer): void {
    for (const rock of ROCKS) {
      renderer.circle(rock.x, rock.y, rock.radius, COLOUR_ROCK);
      renderer.circle(
        rock.x - rock.radius * 0.2,
        rock.y - rock.radius * 0.24,
        rock.radius * 0.5,
        COLOUR_ROCK_TOP,
      );
    }
  }

  #drawGrove(renderer: Renderer): void {
    for (const cane of this.#state.canes) this.#drawCane(renderer, cane);
  }

  /**
   * One cane, standing or cut.
   *
   * Rule 7: the seat is carried by three things at once. p1's canes wear a round collar and
   * a round pip, p2's a square collar and a square pip, and a cut cane is a dark stump with
   * a slash through it whoever owned it — so the board reads in greyscale and reads at a
   * glance which six are yours.
   */
  #drawCane(renderer: Renderer, cane: Readonly<Cane>): void {
    const palette = SEAT_PALETTE[cane.seat];
    if (!cane.standing) {
      renderer.circle(cane.x, cane.y, CANE_RADIUS - 6, COLOUR_STUMP);
      renderer.line(
        cane.x - CANE_RADIUS,
        cane.y - CANE_RADIUS,
        cane.x + CANE_RADIUS,
        cane.y + CANE_RADIUS,
        3,
        palette.soft,
      );
      if (cane.seat === 'p2') {
        renderer.line(
          cane.x - CANE_RADIUS,
          cane.y + CANE_RADIUS,
          cane.x + CANE_RADIUS,
          cane.y - CANE_RADIUS,
          3,
          palette.soft,
        );
      }
      return;
    }

    renderer.circle(cane.x, cane.y, CANE_RADIUS, COLOUR_CANE_BODY);
    renderer.circle(cane.x, cane.y, CANE_RADIUS - 7, COLOUR_CANE_CORE);
    if (cane.seat === 'p1') {
      renderer.strokeCircle(cane.x, cane.y, CANE_RADIUS - 2, 4, palette.base);
      renderer.circle(cane.x, cane.y, 6, palette.deep);
    } else {
      renderer.strokeRect(
        cane.x - CANE_RADIUS + 2,
        cane.y - CANE_RADIUS + 2,
        (CANE_RADIUS - 2) * 2,
        (CANE_RADIUS - 2) * 2,
        4,
        palette.base,
      );
      renderer.rect(cane.x - 6, cane.y - 6, 12, 12, palette.deep);
    }
  }

  /** The sight: where the blade would go for the first third of a second, and the spin gauge. */
  #drawSight(renderer: Renderer): void {
    if (this.#winner !== null) return;
    if (this.#state.phase !== 'aiming') return;
    const palette = SEAT_PALETTE[this.#state.active];

    this.#guide.x = THROW_X;
    this.#guide.y = THROW_Y;
    this.#guide.heading = this.#state.aim;
    const slice = GUIDE_SECONDS / GUIDE_DOTS;
    for (let i = 0; i < GUIDE_DOTS; i += 1) {
      advanceArc(this.#guide, this.#state.spin, slice);
      const x = this.#guide.x;
      const y = this.#guide.y;
      if (offBoard(x, y)) break;
      // The dots stop at stone, so a throw that cannot get out of the near lane says so
      // before it is thrown rather than after.
      if (hitsRock(x, y)) {
        renderer.strokeCircle(x, y, 9, 3, palette.base);
        break;
      }
      renderer.circle(x, y, 3 + i * 0.3, COLOUR_GUIDE);
    }

    // Spin, as a slider under the hand. The marker takes the active seat's own shape, so
    // which way the blade will bend is never carried by colour alone.
    const gaugeY = THROW_Y + 42;
    renderer.rect(THROW_X - 130, gaugeY - 3, 260, 6, COLOUR_LANE);
    renderer.rect(THROW_X - 1, gaugeY - 9, 2, 18, COLOUR_MUTED);
    const knob = THROW_X + (this.#state.spin / MAX_SPIN) * 130;
    if (this.#state.active === 'p1') renderer.circle(knob, gaugeY, 11, palette.base);
    else renderer.rect(knob - 10, gaugeY - 10, 20, 20, palette.base);
  }

  /** The hand at the near edge, holding the next blade, tinted for whoever is to throw. */
  #drawHand(renderer: Renderer): void {
    if (this.#state.phase === 'flying') return;
    const palette = SEAT_PALETTE[this.#state.active];
    renderer.rect(THROW_X - 36, THROW_Y + 6, 72, 12, palette.deep);
    if (this.#state.phase !== 'aiming') return;
    this.#drawShuriken(renderer, THROW_X, THROW_Y, palette.base);
  }

  #drawBlade(renderer: Renderer): void {
    if (this.#state.phase !== 'flying') return;
    const palette = SEAT_PALETTE[this.#state.active];
    this.#drawShuriken(renderer, this.#state.shot.x, this.#state.shot.y, palette.base);
  }

  /** Four blades and a hub, turned by the simulation's own blade angle. */
  #drawShuriken(renderer: Renderer, x: number, y: number, colour: string): void {
    for (let i = 0; i < BLADES; i += 1) {
      const angle = this.#state.blade + (i * Math.PI * 2) / BLADES;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      renderer.line(
        x + cos * SHURIKEN_RADIUS * 0.4,
        y + sin * SHURIKEN_RADIUS * 0.4,
        x + cos * BLADE_LENGTH,
        y + sin * BLADE_LENGTH,
        6,
        COLOUR_STEEL,
      );
      renderer.line(
        x + cos * SHURIKEN_RADIUS * 0.4,
        y + sin * SHURIKEN_RADIUS * 0.4,
        x + cos * BLADE_LENGTH,
        y + sin * BLADE_LENGTH,
        2,
        COLOUR_STEEL_EDGE,
      );
    }
    renderer.circle(x, y, SHURIKEN_RADIUS * 0.7, colour);
  }
}
