import { Rng, SEAT_PALETTE, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BLADE_HALF,
  BLADE_SPEED,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_X,
  CENTRE_Y,
  GUARD_V,
  MAX_THROWS,
  SWORD_SPEED,
  TARGETS_PER_SEAT,
  TARGET_RADIUS,
  TARGET_V,
  WALL_V,
  activeOf,
  aimTowards,
  botParry,
  botThrow,
  createParryPlan,
  createState,
  createThrowPlan,
  fighterOf,
  hitsFor,
  otherOf,
  resetParryPlan,
  resetState,
  resetThrowPlan,
  slideBlade,
  slideBladeTowards,
  step,
  throwSword,
  turnAim,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, ParryPlan, State, ThrowPlan } from './rules.js';

/**
 * Sword Throwing — one sword each, and it is both your weapon and your shield.
 *
 * On your turn you pivot the sword you are holding and let it go. The instant it leaves
 * your hand the arena belongs to the other player, who has about a second to carry their
 * own sword along their guard line and meet yours with it. Miss, and it buries itself in
 * their rack.
 *
 * That is the whole of the observed rule, split across the two halves of one turn — and it
 * is why the game asks each player for exactly one number at a time. Where your sword
 * points, or where your sword stands. A keyboard says it with two keys and a finger says
 * it by being somewhere, and neither can express anything the other cannot.
 */

/** Radians a second the sight swings under a held direction key. */
const AIM_KEY_RATE = 1.05;

/** How much of the flight the sight shows. Enough to read the line, not enough to aim for you. */
const GUIDE_SECONDS = 0.3;
const GUIDE_DOTS = 9;

/** How long the sword's visible streak is, in seconds of flight. */
const TRAIL_SECONDS = 0.07;

/** Seconds a hit or a parry is marked on the arena. */
const FLASH_SECONDS = 0.45;

const COLOUR_BACKGROUND = '#12161d';
const COLOUR_ARENA = '#1e2530';
const COLOUR_SAND = '#27303d';
const COLOUR_RAIL = 'rgba(214, 224, 236, 0.16)';
const COLOUR_MIDLINE = 'rgba(214, 224, 236, 0.24)';
const COLOUR_POST = '#3a2f24';
const COLOUR_TARGET = '#c2a06a';
const COLOUR_TARGET_CORE = '#e6d3ac';
const COLOUR_STEEL = '#dfe6ef';
const COLOUR_STEEL_EDGE = '#8b96a5';
const COLOUR_GRIP = '#4a3628';
const COLOUR_GUIDE = 'rgba(223, 230, 239, 0.4)';
const COLOUR_MUTED = 'rgba(214, 224, 236, 0.28)';

export class SwordThrowingGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #state: State = createState();
  readonly #throwPlans: Record<SeatId, ThrowPlan> = {
    p1: createThrowPlan(),
    p2: createThrowPlan(),
  };
  readonly #parryPlans: Record<SeatId, ParryPlan> = {
    p1: createParryPlan(),
    p2: createParryPlan(),
  };
  readonly #pointerWorld: Vec2 = vec2();

  #rng = new Rng(1);
  #bots: Record<SeatId, BotDifficulty | null> = { p1: null, p2: null };
  #winner: SeatId | 'draw' | null = null;

  /**
   * Whether the whole arena is drawn upside down.
   *
   * Never per turn. Both fighters stand at their own end of an arena that is its own
   * mirror, so on a shared screen each of them already reads their own end the right way
   * up and turning the board would only take that away from one of them. It is set once,
   * for single-seat play, where the local player owns the viewport and seat two would
   * otherwise be given a board with their own end at the top.
   */
  #flipped = false;

  /**
   * Whether this throw is being aimed with a pointer.
   *
   * Needed because on the step a finger lifts the pointer is already gone — so asking "is
   * there a pointer now" on the release step takes the keyboard branch and the throw never
   * happens. Darts shipped that bug past its unit tests; this is the same fix.
   */
  #pointerAiming = false;
  #flash = 0;

  /** Read-only view for the tests and the balance harness. */
  get state(): State {
    return this.#state;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#flipped = context.presentation === 'single-seat' && context.localSeat === 'p2';
    this.#bots = { p1: context.botDifficulty('p1'), p2: context.botDifficulty('p2') };
    this.#winner = null;
    this.#flash = 0;
    this.#pointerAiming = false;
    resetThrowPlan(this.#throwPlans.p1);
    resetThrowPlan(this.#throwPlans.p2);
    resetParryPlan(this.#parryPlans.p1);
    resetParryPlan(this.#parryPlans.p2);
    resetState(this.#state, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#flash > 0) this.#flash -= fixedDeltaSeconds;
    if (this.#winner !== null) return;

    const state = this.#state;
    const defender = otherOf(state.thrower);
    // Captured before anything moves it, so the parry can be read at the exact instant the
    // sword crosses the guard line rather than at the end of the step that contained it.
    const bladeBefore = fighterOf(state, defender).blade;

    if (state.phase === 'aiming') this.#takeThrow(input, fixedDeltaSeconds);
    else if (state.phase === 'flying') this.#takeParry(input, fixedDeltaSeconds, defender);

    const outcome = step(state, fixedDeltaSeconds, bladeBefore);
    if (outcome.landed) {
      this.#flash = FLASH_SECONDS;
      resetParryPlan(this.#parryPlans.p1);
      resetParryPlan(this.#parryPlans.p2);
    }
    if (outcome.handedOver) {
      // A fresh turn is a fresh instrument: whatever the last player was holding says
      // nothing about what this one has.
      this.#pointerAiming = false;
    }
    this.#winner = winnerOf(state);
  }

  /** The thrower's step: point the sword, and let it go. */
  #takeThrow(input: InputState, fixedDeltaSeconds: number): void {
    const seat = this.#state.thrower;
    const difficulty = this.#bots[seat];
    if (difficulty !== null) {
      const plan = this.#throwPlans[seat];
      if (!botThrow(this.#state, seat, difficulty, plan, this.#rng, fixedDeltaSeconds)) return;
      throwSword(this.#state, seat);
      resetThrowPlan(plan);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flipped);
      const sign = seat === 'p1' ? 1 : -1;
      aimTowards(
        this.#state,
        sign * (this.#pointerWorld.x - CENTRE_X),
        sign * (this.#pointerWorld.y - CENTRE_Y),
      );
      this.#pointerAiming = true;
    }

    // Keys swing the sight rather than naming an angle, so the keyboard and the thumb are
    // comparable instruments rather than one being strictly finer than the other.
    const move = seatInput.move;
    if (move.x !== 0) {
      turnAim(this.#state, this.#lateralSign(seat) * move.x * AIM_KEY_RATE * fixedDeltaSeconds);
      this.#pointerAiming = false;
    }

    // A finger commits on release, so the throw can be adjusted while it is held; a key
    // commits on press, because there is nothing to preview while a key is down. Which
    // applies is decided by how the throw was *aimed*, not by what is present this step.
    const commit = this.#pointerAiming ? seatInput.actionReleased : seatInput.actionPressed;
    if (!commit) return;
    if (throwSword(this.#state, seat)) this.#pointerAiming = false;
  }

  /** The defender's step: carry the blade to meet the throw. */
  #takeParry(input: InputState, fixedDeltaSeconds: number, defender: SeatId): void {
    const difficulty = this.#bots[defender];
    if (difficulty !== null) {
      botParry(
        this.#state,
        defender,
        difficulty,
        this.#parryPlans[defender],
        this.#rng,
        fixedDeltaSeconds,
      );
      return;
    }

    const seatInput = input.seat(defender);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flipped);
      const sign = defender === 'p1' ? 1 : -1;
      // The blade follows the finger at the same rate a key carries it. A finger that
      // named the place outright would be a strictly better instrument than a key, which
      // is the one thing rule 10 will not have.
      slideBladeTowards(
        this.#state,
        defender,
        sign * (this.#pointerWorld.x - CENTRE_X),
        BLADE_SPEED * fixedDeltaSeconds,
      );
    }
    const move = seatInput.move;
    if (move.x !== 0) {
      slideBlade(
        this.#state,
        defender,
        this.#lateralSign(defender) * move.x * BLADE_SPEED * fixedDeltaSeconds,
      );
    }
  }

  /**
   * Which way a seat's local `u` runs against a push to the right of the screen.
   *
   * Seat two's arena runs the other way, and a rotated single-seat view turns both of them
   * round again, so the two facts are multiplied rather than special-cased.
   */
  #lateralSign(seat: SeatId): number {
    return (seat === 'p1' ? 1 : -1) * (this.#flipped ? -1 : 1);
  }

  getActiveSeat(): SeatId {
    return activeOf(this.#state);
  }

  getScore(): MatchScore {
    return {
      p1: hitsFor(this.#state, 'p1'),
      p2: hitsFor(this.#state, 'p2'),
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetState(this.#state, this.#rng);
    resetThrowPlan(this.#throwPlans.p1);
    resetThrowPlan(this.#throwPlans.p2);
    resetParryPlan(this.#parryPlans.p1);
    resetParryPlan(this.#parryPlans.p2);
    this.#winner = null;
    this.#flash = 0;
    this.#pointerAiming = false;
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushSeatRotation(this.#flipped);
    this.#drawArena(renderer);
    this.#drawRack(renderer, 'p1');
    this.#drawRack(renderer, 'p2');
    this.#drawSight(renderer);
    this.#drawBlade(renderer, 'p1');
    this.#drawBlade(renderer, 'p2');
    this.#drawFlight(renderer);
    renderer.popSeatRotation();
  }

  /** World x of a point on a seat's own axis. The one place the mirror is spent. */
  #worldX(seat: SeatId, u: number): number {
    return CENTRE_X + (seat === 'p1' ? u : -u);
  }

  #worldY(seat: SeatId, v: number): number {
    return CENTRE_Y + (seat === 'p1' ? v : -v);
  }

  #drawArena(renderer: Renderer): void {
    const top = this.#worldY('p2', WALL_V);
    renderer.rect(30, top, BOARD_WIDTH - 60, this.#worldY('p1', WALL_V) - top, COLOUR_ARENA);
    // Two rakes of sand, one at each guard line, so both ends of the arena read alike.
    for (const seat of ['p1', 'p2'] as const) {
      const y = this.#worldY(seat, GUARD_V);
      renderer.rect(40, y - 2, BOARD_WIDTH - 80, 4, COLOUR_RAIL);
      renderer.rect(40, this.#worldY(seat, TARGET_V) + 46, BOARD_WIDTH - 80, 3, COLOUR_SAND);
    }
    renderer.line(46, CENTRE_Y, BOARD_WIDTH - 46, CENTRE_Y, 2, COLOUR_MIDLINE);

    // Throws left in the match, as a bar on the centre line: one object, shared by both
    // players, and the other way this ends.
    const left = Math.max(0, 1 - this.#state.throws / MAX_THROWS);
    renderer.rect(CENTRE_X - 130, CENTRE_Y - 5, 260 * left, 10, COLOUR_MUTED);
    renderer.strokeRect(CENTRE_X - 130, CENTRE_Y - 5, 260, 10, 1, COLOUR_RAIL);

    if (this.#flash > 0) {
      const defender = otherOf(this.#state.thrower);
      const marked = this.#state.lastOutcome === 'parried' ? defender : this.#state.thrower;
      renderer.strokeRect(
        26,
        top - 4,
        BOARD_WIDTH - 52,
        this.#worldY('p1', WALL_V) - top + 8,
        4,
        SEAT_PALETTE[marked].soft,
      );
    }
  }

  /**
   * One seat's rack of targets, with whatever the other seat has left in it.
   *
   * Rule 7: seat one's targets are round and wear a ring, seat two's are square and wear a
   * cross, so which rack is whose survives a greyscale screen — and so does the score,
   * because the swords standing in a rack are the other player's tally drawn on the board.
   */
  #drawRack(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const railY = this.#worldY(seat, TARGET_V);
    renderer.rect(50, this.#worldY(seat, WALL_V) - 6, BOARD_WIDTH - 100, 12, COLOUR_POST);
    for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
      const u = this.#state.slots[i] ?? 0;
      const x = this.#worldX(seat, u);
      renderer.circle(x, railY, TARGET_RADIUS, COLOUR_TARGET);
      renderer.circle(x, railY, TARGET_RADIUS - 11, COLOUR_TARGET_CORE);
      if (seat === 'p1') {
        renderer.strokeCircle(x, railY, TARGET_RADIUS - 4, 5, palette.base);
      } else {
        const side = (TARGET_RADIUS - 4) * 2;
        renderer.strokeRect(x - side / 2, railY - side / 2, side, side, 5, palette.base);
        renderer.line(x - 9, railY - 9, x + 9, railY + 9, 3, palette.deep);
        renderer.line(x - 9, railY + 9, x + 9, railY - 9, 3, palette.deep);
      }
      this.#drawStuck(renderer, seat, x, railY, i);
    }
  }

  /** The other seat's swords, standing in this target. Up to three, then they stack. */
  #drawStuck(renderer: Renderer, seat: SeatId, x: number, y: number, index: number): void {
    const count = fighterOf(this.#state, seat).struck[index] ?? 0;
    const enemy = SEAT_PALETTE[otherOf(seat)];
    const towards = seat === 'p1' ? -1 : 1;
    for (let n = 0; n < count && n < 3; n += 1) {
      const offset = (n - 1) * 15;
      renderer.line(x + offset, y, x + offset, y + towards * 40, 6, COLOUR_STEEL);
      renderer.line(x + offset, y + towards * 30, x + offset, y + towards * 46, 8, enemy.base);
    }
  }

  /** Where the throw would go, for the first third of a second of its flight. */
  #drawSight(renderer: Renderer): void {
    if (this.#winner !== null) return;
    if (this.#state.phase !== 'aiming') return;
    const seat = this.#state.thrower;
    const palette = SEAT_PALETTE[seat];
    const hand = fighterOf(this.#state, seat).blade;
    const du = Math.sin(this.#state.aim);
    const dv = -Math.cos(this.#state.aim);
    for (let i = 1; i <= GUIDE_DOTS; i += 1) {
      const at = (GUIDE_SECONDS * i) / GUIDE_DOTS;
      const u = hand + du * SWORD_SPEED * at;
      const v = GUARD_V + dv * SWORD_SPEED * at;
      const x = this.#worldX(seat, u);
      const y = this.#worldY(seat, v);
      if (x < 0 || x > BOARD_WIDTH || y < 0 || y > BOARD_HEIGHT) break;
      renderer.circle(x, y, 2.5 + i * 0.35, i === GUIDE_DOTS ? palette.soft : COLOUR_GUIDE);
    }
  }

  /**
   * A seat's own sword, held across their guard line.
   *
   * Hidden for the seat whose sword is in the air — you cannot parry with a sword you have
   * thrown, which is the whole reason a throw is a risk as well as a chance.
   */
  #drawBlade(renderer: Renderer, seat: SeatId): void {
    if (this.#state.phase === 'flying' && this.#state.thrower === seat) return;
    if (this.#state.phase === 'settling' && this.#state.thrower === seat) return;
    const palette = SEAT_PALETTE[seat];
    const u = fighterOf(this.#state, seat).blade;
    const x = this.#worldX(seat, u);
    const y = this.#worldY(seat, GUARD_V);
    renderer.rect(x - BLADE_HALF, y - 5, BLADE_HALF * 2, 10, COLOUR_STEEL);
    renderer.rect(x - BLADE_HALF, y - 5, BLADE_HALF * 2, 3, COLOUR_STEEL_EDGE);
    // The grip and the pommel carry the seat in shape as well as in colour.
    renderer.rect(x - 8, y - 12, 16, 24, COLOUR_GRIP);
    if (seat === 'p1') renderer.circle(x, y, 9, palette.base);
    else renderer.rect(x - 9, y - 9, 18, 18, palette.base);
  }

  /** The sword in the air, with the streak that lets a defender read its line. */
  #drawFlight(renderer: Renderer): void {
    const state = this.#state;
    if (state.phase !== 'flying' && state.phase !== 'settling') return;
    const shot = state.shot;
    const defender = otherOf(state.thrower);
    const palette = SEAT_PALETTE[state.thrower];
    const x = this.#worldX(defender, shot.u);
    const y = this.#worldY(defender, shot.v);
    const back = TRAIL_SECONDS * SWORD_SPEED;
    const tailU = shot.u - shot.du * back;
    const tailV = shot.v - shot.dv * back;
    renderer.line(
      this.#worldX(defender, tailU),
      this.#worldY(defender, tailV),
      x,
      y,
      3,
      palette.soft,
    );
    // The blade lies along the flight and tumbles about it, so a throw reads as a thrown
    // thing rather than a slid one.
    const swing = Math.cos(shot.tumble) * 16;
    const nu = -shot.dv;
    const nv = shot.du;
    renderer.line(
      this.#worldX(defender, shot.u - shot.du * 18 + nu * swing),
      this.#worldY(defender, shot.v - shot.dv * 18 + nv * swing),
      this.#worldX(defender, shot.u + shot.du * 18 - nu * swing),
      this.#worldY(defender, shot.v + shot.dv * 18 - nv * swing),
      7,
      COLOUR_STEEL,
    );
    renderer.circle(x, y, 6, palette.base);
  }
}
