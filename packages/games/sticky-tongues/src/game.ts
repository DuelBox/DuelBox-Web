import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FLY_COUNT,
  FLY_MAX_Y,
  FLY_MIN_Y,
  FLY_RADIUS,
  FLY_RETURN_SECONDS,
  FROG_RADIUS,
  MARSH_BOTTOM,
  MARSH_LEFT,
  MARSH_RIGHT,
  MARSH_TOP,
  MATCH_SECONDS,
  STUN_SECONDS,
  TAP_RADIUS,
  TAP_SECONDS,
  TONGUE_HALF_WIDTH,
  WASTE_LIMIT,
  botDecide,
  createBotState,
  createState,
  driveFrog,
  frogOf,
  headingSign,
  resetBotState,
  resetState,
  secondsLeft,
  shoot,
  shotsLeft,
  step,
  threatLineOf,
  tipYOf,
  tongueOut,
} from './rules.js';
import type { BotDifficulty, BotState, Fly, Frog, State } from './rules.js';

/**
 * Sticky Tongues — one marsh, two banks, and everything in it drawn in board orientation.
 *
 * The marsh is common ground: both players read the same water the same way up, so nothing
 * here is rotated except the per-shot feedback, which belongs to one seat and is turned to
 * face it. `rules.ts` owns the whole simulation; this file reads it, puts a finger on it and
 * draws it.
 *
 * The one thing worth reading before the drawing code is {@link StickyTonguesGame.planSeat}
 * and the gesture state beside it. A tongue shot and a steer are two commands competing for
 * one hand, and the audit in `docs/input-idiom.md` records tennis and wrestle shipping with
 * them fused — both bind their discrete action to `actionPressed`, which a *steering* press
 * also raises, so beginning to move is also a jump. Here the two channels never touch.
 */

/* --------------------------------------------------------------------- shapes */

/**
 * Seat two's square half-side, chosen so the two frogs cover the **same area** as seat one's
 * disc: `radius * sqrt(pi) / 2`. Both are hit by the identical circular test at
 * `SLAP_RADIUS`, so the two silhouettes differ and nothing else about them does — neither
 * seat presents the bigger target and neither is easier to pick out.
 */
const FROG_SQUARE_HALF = FROG_RADIUS * (Math.sqrt(Math.PI) / 2);
/** The same rule for a tongue tip, so seat two's tongue reads as square at every size. */
const TIP_SQUARE_HALF = TONGUE_HALF_WIDTH * (Math.sqrt(Math.PI) / 2);

const PIP_RADIUS = 7;
const PIP_SQUARE_HALF = PIP_RADIUS * (Math.sqrt(Math.PI) / 2);
const PIP_GAP = 22;

/* -------------------------------------------------------------------- colours */

const COLOUR_GROUND = '#0b1a12';
const COLOUR_BANK = '#132a1d';
const COLOUR_WATER = '#12402f';
const COLOUR_AIR = '#175540';
const COLOUR_RIM = 'rgba(220, 246, 232, 0.22)';
const COLOUR_LINE = 'rgba(220, 246, 232, 0.14)';
const COLOUR_DANGER = 'rgba(246, 211, 101, 0.42)';
const COLOUR_CHALK = 'rgba(226, 246, 236, 0.5)';
const COLOUR_INK = '#05120c';
const COLOUR_FLY = '#f2f6e9';
const COLOUR_FLY_GHOST = 'rgba(242, 246, 233, 0.35)';
const COLOUR_LOSS = '#f6d365';

/* ------------------------------------------------------------------- feedback */

/** Steps a finished shot's tally stays beside the frog that took it. */
export const FEEDBACK_STEPS = 40;

/**
 * Labels for what a shot was worth, looked up rather than built, so `render` never allocates
 * a string. `-1` is a wasted shot; anything positive is dragonflies.
 */
const GAIN_FLOOR = -1;
const GAIN_LABELS: readonly string[] = Object.freeze(
  Array.from({ length: FLY_COUNT + 2 }, (_unused, i) => {
    const value = GAIN_FLOOR + i;
    return value > 0 ? `+${String(value)}` : String(value);
  }),
);

function gainLabel(gain: number): string {
  const index = gain - GAIN_FLOOR;
  if (index < 0 || index >= GAIN_LABELS.length) return '';
  return GAIN_LABELS[index] ?? '';
}

/** How far a key has to be open before it counts as a direction. */
const AXIS_THRESHOLD = 0.35;

function axis(value: number): number {
  if (value > AXIS_THRESHOLD) return 1;
  if (value < -AXIS_THRESHOLD) return -1;
  return 0;
}

/**
 * One seat's presentation-only state: the pointer gesture in progress, and the tally of the
 * last shot. Allocated once, at construction, and rewritten in place.
 */
interface SeatRuntime {
  /** True between a press and its release. Survives the release step, where the pointer is null. */
  gestureDown: boolean;
  /** Where the gesture started, so the tap radius is measured from the press and not the frog. */
  pressX: number;
  pressY: number;
  /** Seconds the gesture has lasted. */
  gestureSeconds: number;
  /**
   * True once the gesture has left the tap radius or outlasted the tap window.
   *
   * A latch, never re-derived: once a gesture is a steer it can never become a shot again, so
   * dragging back onto the press point at the last moment cannot fire the tongue.
   */
  steering: boolean;
  /** Net of the shot being shown, and how many steps it has left on screen. */
  gain: number;
  gainSteps: number;
  /** Whether the frog was mid-shot last step, so the end of one can be noticed. */
  wasShooting: boolean;
  /** What the frog had caught and wasted at the top of the step. */
  lastCaught: number;
  lastWasted: number;
}

function createRuntime(): SeatRuntime {
  return {
    gestureDown: false,
    pressX: 0,
    pressY: 0,
    gestureSeconds: 0,
    steering: false,
    gain: 0,
    gainSteps: 0,
    wasShooting: false,
    lastCaught: 0,
    lastWasted: 0,
  };
}

function resetRuntime(runtime: SeatRuntime): void {
  runtime.gestureDown = false;
  runtime.pressX = 0;
  runtime.pressY = 0;
  runtime.gestureSeconds = 0;
  runtime.steering = false;
  runtime.gain = 0;
  runtime.gainSteps = 0;
  runtime.wasShooting = false;
  runtime.lastCaught = 0;
  runtime.lastWasted = 0;
}

/** Forget a gesture without letting it fire. What a pause must do to a finger on the glass. */
function dropGesture(runtime: SeatRuntime): void {
  runtime.gestureDown = false;
  runtime.gestureSeconds = 0;
  runtime.steering = false;
}

export class StickyTonguesGame implements Game {
  readonly #state: State = createState();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  /**
   * This step's intent, per seat: index 0 is seat one, index 1 seat two.
   *
   * Written by {@link StickyTonguesGame.planSeat} for **both** seats before either is applied,
   * because a bot reads where the far frog is standing. Moving seat one before seat two looked
   * would hand seat two half a step of fresher information — a seat bias dressed up as a poll
   * order, and exactly the kind of thing the mirror test exists to find. Typed arrays, so
   * nothing here allocates per step.
   */
  readonly #dirX = new Float64Array(2);
  readonly #dirY = new Float64Array(2);
  readonly #fire = new Uint8Array(2);

  /** Where everything stood at the end of the previous step, for the render interpolation. */
  readonly #prevFlyX = new Float64Array(FLY_COUNT);
  readonly #prevFlyY = new Float64Array(FLY_COUNT);
  readonly #prevFrogX = new Float64Array(2);
  readonly #prevFrogY = new Float64Array(2);
  readonly #prevShotSeconds = new Float64Array(2);
  readonly #wasMidShot = new Uint8Array(2);

  /**
   * Three streams from the one seed the shell gives us.
   *
   * The marsh has its own, and it is drawn from exactly once — `resetState` lays the opening
   * out and nothing after it is random. Each seat's bot has its own for the other half of the
   * argument: with one stream, whichever seat is polled first takes the earlier value every
   * time, which is a seat bias dressed as chance.
   */
  #marshRng = new Rng(1);
  #botP1Rng = new Rng(2);
  #botP2Rng = new Rng(3);

  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #ready = false;

  /** Read-only view for the harness and the tests. Never mutate through it. */
  get state(): Readonly<State> {
    return this.#state;
  }

  init(context: GameContext): void {
    this.#marshRng = new Rng(context.rng.next() | 0);
    this.#botP1Rng = new Rng(context.rng.next() | 0);
    this.#botP2Rng = new Rng(context.rng.next() | 0);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    // `context.openingSeat` is deliberately not read. Both frogs act from step zero and no
    // object on the board belongs to a seat, so there is no opener here and nothing for the
    // shell's alternation to alternate. The contract says a real-time game may ignore it; see
    // SPEC.md, "There is no opening seat to read".
    this.#ready = true;
    resetBotState(this.#botP1State, 'p1');
    resetBotState(this.#botP2State, 'p2');
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetState(this.#state, this.#marshRng);
    // So the first frame drawn interpolates from where the match starts rather than from zero.
    this.#remember();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (!this.#ready) return;
    if (this.#state.winner !== null) return;

    // Taken before anything moves, so what render interpolates from is genuinely the state at
    // the end of the previous step — which is what the loop's `alpha` is measured against.
    this.#remember();

    // Both seats decide, then both seats move, then both seats shoot. Three passes rather
    // than two loops of one, so nothing a seat does this step can be read by the other.
    this.#planSeat('p1', input, fixedDeltaSeconds);
    this.#planSeat('p2', input, fixedDeltaSeconds);
    driveFrog(this.#state, 'p1', this.#dirX[0] ?? 0, this.#dirY[0] ?? 0, fixedDeltaSeconds);
    driveFrog(this.#state, 'p2', this.#dirX[1] ?? 0, this.#dirY[1] ?? 0, fixedDeltaSeconds);
    if (this.#fire[0] === 1) shoot(this.#state, 'p1');
    if (this.#fire[1] === 1) shoot(this.#state, 'p2');

    step(this.#state, fixedDeltaSeconds);

    this.#latchFeedback('p1', this.#runtimeP1);
    this.#latchFeedback('p2', this.#runtimeP2);
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_GROUND);
    this.#drawMarsh(renderer);
    this.#drawClock(renderer);
    this.#drawPips(renderer, 'p1');
    this.#drawPips(renderer, 'p2');
    this.#drawFlies(renderer, alpha);
    this.#drawFrog(renderer, 'p1', alpha);
    this.#drawFrog(renderer, 'p2', alpha);
    this.#drawFeedback(renderer, 'p1', this.#runtimeP1, alpha);
    this.#drawFeedback(renderer, 'p2', this.#runtimeP2, alpha);
  }

  onPause(): void {
    // A finger on the glass when the pause menu opens comes back as a release, and a release
    // of a gesture that never left the tap radius is a shot. Forget both gestures instead, so
    // opening the menu mid-drag cannot flick a tongue on the way out.
    dropGesture(this.#runtimeP1);
    dropGesture(this.#runtimeP2);
  }

  onResume(): void {
    dropGesture(this.#runtimeP1);
    dropGesture(this.#runtimeP2);
  }

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: this.#state.winner };
  }

  destroy(): void {
    this.#ready = false;
    this.#botP1 = null;
    this.#botP2 = null;
    resetBotState(this.#botP1State, 'p1');
    resetBotState(this.#botP2State, 'p2');
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetState(this.#state, this.#marshRng);
    this.#remember();
  }

  /* ------------------------------------------------------------------ driving */

  /** True when this seat reads the device upside down, so its keys mean the mirror image. */
  #isRotated(seat: SeatId): boolean {
    return this.#presentation === 'shared-screen' && seat !== this.#localSeat;
  }

  /**
   * Work out what one seat wants this step, without touching the simulation.
   *
   * **The two channels are separated before either is read, and they never meet again.**
   *
   * - A **key** steers with `move` and shoots with `actionPressed` *while no pointer is down*.
   *   Those are different hardware slots — `KEY_SLOTS` binds the four directions and the
   *   action separately — so a keyboard has never had this problem.
   * - A **finger** is the whole of the difficulty, because `actionHeld` is
   *   `keys.action || pointerDown`: putting a finger down to steer raises the action edge.
   *   Tennis and Wrestle both bind a jump to that edge and both therefore jump whenever the
   *   player begins to move, which `docs/input-idiom.md` records as a live defect. So this
   *   game never fires on a pointer press at all. It waits for the release and asks what kind
   *   of gesture it was: one that stayed inside {@link TAP_RADIUS} and ended inside
   *   {@link TAP_SECONDS} is a shot and steers nothing; anything else is a steer and can
   *   never fire. One latch, two disjoint channels, and `game.test.ts` drives a steering drag
   *   across the whole bank and asserts not one tongue leaves.
   */
  #planSeat(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const index = seat === 'p1' ? 0 : 1;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const bot = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const rng = seat === 'p1' ? this.#botP1Rng : this.#botP2Rng;
      const wants = botDecide(this.#state, seat, difficulty, bot, rng, fixedDeltaSeconds);
      this.#dirX[index] = bot.dirX;
      this.#dirY[index] = bot.dirY;
      this.#fire[index] = wants ? 1 : 0;
      return;
    }

    const frog = frogOf(this.#state, seat);
    const runtime = seat === 'p1' ? this.#runtimeP1 : this.#runtimeP2;
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    let dirX = 0;
    let dirY = 0;
    let fire = false;

    if (pointer !== null) {
      if (!runtime.gestureDown) {
        runtime.gestureDown = true;
        runtime.pressX = pointer.x;
        runtime.pressY = pointer.y;
        runtime.gestureSeconds = 0;
        runtime.steering = false;
      } else {
        runtime.gestureSeconds += fixedDeltaSeconds;
        const dx = pointer.x - runtime.pressX;
        const dy = pointer.y - runtime.pressY;
        if (dx * dx + dy * dy > TAP_RADIUS * TAP_RADIUS) runtime.steering = true;
        if (runtime.gestureSeconds > TAP_SECONDS) runtime.steering = true;
      }
      if (runtime.steering) {
        // Chase the finger, absolute and unmirrored: the marsh is one board drawn one way up,
        // so a finger is already over the water it means whichever side of the device its
        // owner sits on. The *answer* is only ever the sign of the gap on each axis, so a
        // thumb cannot name a heading a key cannot, and `driveFrog` rate-limits the rest.
        dirX = headingSign(pointer.x - frog.x);
        dirY = headingSign(pointer.y - frog.y);
      }
    }

    if (seatInput.actionReleased && runtime.gestureDown) {
      if (!runtime.steering) fire = true;
      dropGesture(runtime);
    }

    if (pointer === null) {
      // A key is a direction, and a seat reading the device upside down means the opposite
      // one. This is control mapping, which the two presentations are allowed to differ in;
      // nothing in the simulation reads the presentation.
      const mirror = this.#isRotated(seat) ? -1 : 1;
      dirX = axis(seatInput.move.x) * mirror;
      dirY = axis(seatInput.move.y) * mirror;
      // The action key, and only the action key: on a pointer press this edge is up too, and
      // firing on it is the tennis/wrestle defect. The pointer is guaranteed non-null on its
      // own press step (`pointerLatched` in `input.ts`), so this test is exact.
      if (seatInput.actionPressed) fire = true;
    }

    this.#dirX[index] = dirX;
    this.#dirY[index] = dirY;
    this.#fire[index] = fire ? 1 : 0;
  }

  /** Hold a finished shot's tally beside the frog that took it. */
  #latchFeedback(seat: SeatId, runtime: SeatRuntime): void {
    const frog = frogOf(this.#state, seat);
    if (runtime.gainSteps > 0) runtime.gainSteps -= 1;
    if (runtime.wasShooting && !frog.shooting) {
      const caught = frog.wasted > runtime.lastWasted ? -1 : this.#state[seat] - runtime.lastCaught;
      if (caught !== 0) {
        runtime.gain = caught;
        runtime.gainSteps = FEEDBACK_STEPS;
      }
    }
    if (!runtime.wasShooting && frog.shooting) {
      runtime.lastCaught = this.#state[seat];
      runtime.lastWasted = frog.wasted;
    }
    runtime.wasShooting = frog.shooting;
  }

  /* ------------------------------------------------------------ interpolation */

  /** Copy where everything stands into the previous-step arrays. Allocates nothing. */
  #remember(): void {
    for (let i = 0; i < this.#state.flies.length; i += 1) {
      const fly = this.#state.flies[i];
      if (fly === undefined) continue;
      this.#prevFlyX[i] = fly.x;
      this.#prevFlyY[i] = fly.y;
    }
    this.#prevFrogX[0] = this.#state.p1Frog.x;
    this.#prevFrogX[1] = this.#state.p2Frog.x;
    this.#prevFrogY[0] = this.#state.p1Frog.y;
    this.#prevFrogY[1] = this.#state.p2Frog.y;
    this.#prevShotSeconds[0] = this.#state.p1Frog.shotSeconds;
    this.#prevShotSeconds[1] = this.#state.p2Frog.shotSeconds;
    this.#wasMidShot[0] = this.#state.p1Frog.shooting ? 1 : 0;
    this.#wasMidShot[1] = this.#state.p2Frog.shooting ? 1 : 0;
  }

  /**
   * A dragonfly moves at most three units a step and a frog five, so anything bigger than this
   * is not motion — it is a replacement reappearing across the marsh or a frog knocked home,
   * and drawing the line between the two would streak it across the board.
   */
  static readonly #TELEPORT = 30;

  #lerp(previous: number, now: number, alpha: number): number {
    if (Math.abs(now - previous) > StickyTonguesGame.#TELEPORT) return now;
    return previous + (now - previous) * alpha;
  }

  #frogX(seat: SeatId, alpha: number): number {
    const frog = frogOf(this.#state, seat);
    return this.#lerp(this.#prevFrogX[seat === 'p1' ? 0 : 1] ?? frog.x, frog.x, alpha);
  }

  #frogY(seat: SeatId, alpha: number): number {
    const frog = frogOf(this.#state, seat);
    return this.#lerp(this.#prevFrogY[seat === 'p1' ? 0 : 1] ?? frog.y, frog.y, alpha);
  }

  /**
   * How far through its shot a frog is, part-way between two steps.
   *
   * Only interpolated *within* one shot. A shot that started or ended this step would run the
   * clock backwards through the whole profile, so those two frames are drawn where they are.
   * The tongue crosses the marsh at 2267 units a second — 38 units a step — so it is the one
   * object here that visibly strobes without this.
   */
  #shotSecondsOf(seat: SeatId, alpha: number): number {
    const frog = frogOf(this.#state, seat);
    const index = seat === 'p1' ? 0 : 1;
    if (!frog.shooting || this.#wasMidShot[index] !== 1) return frog.shotSeconds;
    const previous = this.#prevShotSeconds[index] ?? frog.shotSeconds;
    return previous + (frog.shotSeconds - previous) * alpha;
  }

  /* ------------------------------------------------------------------ drawing */

  #drawMarsh(renderer: Renderer): void {
    renderer.rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT, COLOUR_BANK);
    renderer.rect(
      MARSH_LEFT,
      MARSH_TOP,
      MARSH_RIGHT - MARSH_LEFT,
      MARSH_BOTTOM - MARSH_TOP,
      COLOUR_WATER,
    );

    // The air the dragonflies keep to, drawn as its own shade with a line at each edge. How
    // far forward a frog has to come to sweep the whole of it is the decision the game is made
    // of, so the picture says where it is rather than leaving it to be discovered.
    renderer.rect(
      MARSH_LEFT,
      FLY_MIN_Y,
      MARSH_RIGHT - MARSH_LEFT,
      FLY_MAX_Y - FLY_MIN_Y,
      COLOUR_AIR,
    );
    renderer.line(MARSH_LEFT, FLY_MIN_Y, MARSH_RIGHT, FLY_MIN_Y, 2, COLOUR_LINE);
    renderer.line(MARSH_LEFT, FLY_MAX_Y, MARSH_RIGHT, FLY_MAX_Y, 2, COLOUR_LINE);

    // The deepest each tongue can ever arrive in the other's bank. Past your own line you
    // cannot be hit at all; in front of it you can.
    for (const seat of ['p1', 'p2'] as const) {
      const y = threatLineOf(seat);
      renderer.line(MARSH_LEFT, y, MARSH_RIGHT, y, 3, COLOUR_DANGER);
    }

    renderer.strokeRect(
      MARSH_LEFT,
      MARSH_TOP,
      MARSH_RIGHT - MARSH_LEFT,
      MARSH_BOTTOM - MARSH_TOP,
      4,
      COLOUR_RIM,
    );
  }

  /**
   * Seconds left, as a bar on each side margin growing out from the middle of the board.
   *
   * One object, shared, and symmetric under the half-turn, so neither player is nearer to it
   * than the other. The clock is the game's own — the shell has no idea this match has one.
   */
  #drawClock(renderer: Renderer): void {
    const share = secondsLeft(this.#state) / MATCH_SECONDS;
    const half = ((MARSH_BOTTOM - MARSH_TOP) / 2) * share;
    const mid = BOARD_HEIGHT / 2;
    renderer.rect(4, mid - half, 8, half * 2, COLOUR_CHALK);
    renderer.rect(BOARD_WIDTH - 12, mid - half, 8, half * 2, COLOUR_CHALK);
  }

  /**
   * Shots left before this seat loses, as a row of pips on its own margin.
   *
   * Filled is a shot still in hand, hollow is one wasted. Seat one's are discs and seat two's
   * are squares of the same area, the same pair every object in this game uses — so a player
   * who cannot see colour still reads their own row at a glance, and a row that is running out
   * is a count of solid marks rather than a hue.
   */
  #drawPips(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const left = shotsLeft(this.#state, seat);
    const y = seat === 'p1' ? BOARD_HEIGHT - 11 : 11;
    const startX = BOARD_WIDTH / 2 - ((WASTE_LIMIT - 1) * PIP_GAP) / 2;
    for (let i = 0; i < WASTE_LIMIT; i += 1) {
      const x = startX + i * PIP_GAP;
      const spent = i >= left;
      if (seat === 'p1') {
        if (spent) renderer.strokeCircle(x, y, PIP_RADIUS, 2, COLOUR_LOSS);
        else renderer.circle(x, y, PIP_RADIUS, palette.base);
      } else {
        const h = PIP_SQUARE_HALF;
        if (spent) renderer.strokeRect(x - h, y - h, h * 2, h * 2, 2, COLOUR_LOSS);
        else renderer.rect(x - h, y - h, h * 2, h * 2, palette.base);
      }
    }
  }

  /**
   * A dragonfly: a small body with a pair of crossed wings.
   *
   * Neutral in colour and an X in silhouette — neither a disc nor a square, so it can never be
   * mistaken for either seat's frog with the colour taken away. A replacement that has not
   * settled yet is drawn hollow and growing, so "cannot be caught yet" is a fill rather than a
   * hue.
   */
  #drawFlies(renderer: Renderer, alpha: number): void {
    for (let i = 0; i < this.#state.flies.length; i += 1) {
      const fly = this.#state.flies[i];
      if (fly === undefined) continue;
      const x = fly.live ? this.#lerp(this.#prevFlyX[i] ?? fly.x, fly.x, alpha) : fly.x;
      const y = fly.live ? this.#lerp(this.#prevFlyY[i] ?? fly.y, fly.y, alpha) : fly.y;
      if (fly.live) this.#drawLiveFly(renderer, x, y);
      else this.#drawSettlingFly(renderer, fly, x, y);
    }
  }

  #drawLiveFly(renderer: Renderer, x: number, y: number): void {
    const w = FLY_RADIUS;
    renderer.line(x - w, y - w * 0.62, x + w, y + w * 0.62, 4, COLOUR_FLY);
    renderer.line(x - w, y + w * 0.62, x + w, y - w * 0.62, 4, COLOUR_FLY);
    renderer.circle(x, y, FLY_RADIUS * 0.42, COLOUR_FLY);
    renderer.circle(x, y, FLY_RADIUS * 0.2, COLOUR_INK);
  }

  #drawSettlingFly(renderer: Renderer, fly: Readonly<Fly>, x: number, y: number): void {
    const grown = 0.3 + 0.7 * (1 - fly.returnSeconds / FLY_RETURN_SECONDS);
    const w = FLY_RADIUS * grown;
    renderer.line(x - w, y - w * 0.62, x + w, y + w * 0.62, 2, COLOUR_FLY_GHOST);
    renderer.line(x - w, y + w * 0.62, x + w, y - w * 0.62, 2, COLOUR_FLY_GHOST);
  }

  /**
   * A frog, and its tongue if it has one out.
   *
   * Rule 7, and here it is the whole of the rules rather than a finish on them: the two frogs
   * share one marsh and the thing you are aiming at is the *other* one. **Seat one is round
   * throughout — round body, round eyes, round tongue tip, round pips — and seat two is square
   * throughout**, at equal area. Nothing about telling them apart needs colour.
   */
  #drawFrog(renderer: Renderer, seat: SeatId, alpha: number): void {
    const frog: Readonly<Frog> = frogOf(this.#state, seat);
    const palette = SEAT_PALETTE[seat];
    const x = this.#frogX(seat, alpha);
    const y = this.#frogY(seat, alpha);
    const sign = seat === 'p1' ? -1 : 1;
    const tipY = tipYOf(seat, y, this.#shotSecondsOf(seat, alpha));
    const out = tongueOut(frog);

    if (out) {
      renderer.line(x, y, x, tipY, TONGUE_HALF_WIDTH * 2, palette.deep);
    }

    if (seat === 'p1') {
      renderer.circle(x, y, FROG_RADIUS, palette.base);
      renderer.strokeCircle(x, y, FROG_RADIUS - 3, 4, palette.deep);
      renderer.circle(x - 13, y + sign * 14, 7, COLOUR_INK);
      renderer.circle(x + 13, y + sign * 14, 7, COLOUR_INK);
      if (frog.stunSeconds > 0) {
        const grown = FROG_RADIUS + 10 + 10 * (frog.stunSeconds / STUN_SECONDS);
        renderer.strokeCircle(x, y, grown, 3, COLOUR_LOSS);
      }
      if (out) renderer.circle(x, tipY, TONGUE_HALF_WIDTH, palette.base);
    } else {
      const h = FROG_SQUARE_HALF;
      renderer.rect(x - h, y - h, h * 2, h * 2, palette.base);
      renderer.strokeRect(x - h + 3, y - h + 3, (h - 3) * 2, (h - 3) * 2, 4, palette.deep);
      renderer.rect(x - 19, y + sign * 8, 12, 12, COLOUR_INK);
      renderer.rect(x + 7, y + sign * 8, 12, 12, COLOUR_INK);
      if (frog.stunSeconds > 0) {
        const grown = h + 10 + 10 * (frog.stunSeconds / STUN_SECONDS);
        renderer.strokeRect(x - grown, y - grown, grown * 2, grown * 2, 3, COLOUR_LOSS);
      }
      if (out) {
        const t = TIP_SQUARE_HALF;
        renderer.rect(x - t, tipY - t, t * 2, t * 2, palette.base);
      }
    }
  }

  /**
   * What the last shot was worth, beside the frog that took it.
   *
   * The only text on the board, and it is feedback rather than a game element: a signed number
   * needs no language and nothing in the marsh has to be read to play. It is turned half a
   * turn for the seat sitting opposite, so both players read their own tally the right way up.
   */
  #drawFeedback(renderer: Renderer, seat: SeatId, runtime: SeatRuntime, alpha: number): void {
    if (runtime.gainSteps === 0 || runtime.gain === 0) return;
    const label = gainLabel(runtime.gain);
    if (label === '') return;

    let x = this.#frogX(seat, alpha) + 74;
    if (x < 70) x = 70;
    if (x > BOARD_WIDTH - 70) x = BOARD_WIDTH - 70;
    const y = this.#frogY(seat, alpha) + (seat === 'p1' ? 4 : -4);

    const rotated = this.#isRotated(seat);
    renderer.pushSeatRotation(rotated);
    const drawX = rotated ? BOARD_WIDTH - x : x;
    const drawY = rotated ? BOARD_HEIGHT - y : y;
    const colour = runtime.gain > 0 ? SEAT_PALETTE[seat].base : COLOUR_LOSS;
    renderer.text(label, drawX, drawY, 40, colour, 'centre');
    renderer.popSeatRotation();
  }
}
