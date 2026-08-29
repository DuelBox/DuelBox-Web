import { Rng, SEAT_PALETTE, SeatFlip, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BASE_HALF,
  BOARD_SIZE,
  BOARD_X,
  BOARD_Y,
  CENTRE_X,
  CENTRE_Y,
  FRAME,
  POCKETS,
  POCKET_MOUTH,
  PUCK_RADIUS,
  STRIKER_RADIUS,
  SURFACE_BOTTOM,
  SURFACE_LEFT,
  SURFACE_RIGHT,
  SURFACE_TOP,
  botAim,
  clamp,
  clampAim,
  createState,
  flick,
  forwardOf,
  otherOf,
  placeStriker,
  pottedCount,
  remaining,
  resetState,
  rightOf,
  settleShot,
  step,
  strikerOf,
  strikerSlide,
  strikerXFor,
  strikerYFor,
} from './rules.js';
import type { BotDifficulty, State } from './rules.js';

/** How far into the board a drag has to reach for a full-strength flick, in logical units. */
export const REACH_FOR_FULL_POWER = 300;
/** A drag shorter than this is a rest of the thumb rather than a shot, and is ignored. */
export const AIM_DEADZONE = 26;
/** Seconds of holding the action key for full power on a keyboard. */
export const HOLD_FOR_FULL_POWER = 0.9;
/** Radians per second the aim swings under a held key. */
export const AIM_TURN_RATE = 1.2;
/** Baseline slide per second under a held key, in seat-space units of the half-baseline. */
export const SLIDE_RATE = 0.9;
/** How long the board is left on screen once the frame is decided. */
export const SETTLE_SECONDS = 0.5;
/** How long a bot looks at the board before it plays. The same for every tier — see SPEC. */
export const THINK_SECONDS = 0.35;

const COLOUR_BACKGROUND = '#171310';
const COLOUR_FRAME = '#6b4526';
const COLOUR_FRAME_EDGE = '#4a2e18';
const COLOUR_BED = '#e8d5ae';
const COLOUR_BED_LINE = 'rgba(74, 46, 24, 0.45)';
const COLOUR_POCKET = '#20160e';
const COLOUR_STRIKER = '#f7f4ea';
const COLOUR_STRIKER_EDGE = '#7b6a4d';
const COLOUR_QUEEN = '#c3213c';
const COLOUR_QUEEN_MARK = '#ffe9ee';
const COLOUR_TEXT = '#f4ece0';
const COLOUR_MUTED = 'rgba(244, 236, 224, 0.62)';
const COLOUR_GUIDE = 'rgba(74, 46, 24, 0.55)';

export class CarromGame implements Game {
  readonly #state: State = createState();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #flip = new SeatFlip();

  #rng = new Rng(1);
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  /** Seat-space aim, zero being straight up the board. */
  #angle = 0;
  #power = 0;
  #stepsPerSecond = 0;
  #settleSteps = 0;
  #thinkSteps = -1;
  /** Everything potted by the stroke in progress, as indices. */
  readonly #potted: number[] = [];

  get state(): State {
    return this.#state;
  }

  get aimAngle(): number {
    return this.#angle;
  }

  get power(): number {
    return this.#power;
  }

  /**
   * Whose turn it is.
   *
   * The shell decides a game is turn-based by the presence of this method, and only then
   * does it hand the whole board to the active seat and map both keyboard halves onto them.
   */
  getActiveSeat(): SeatId {
    return this.#state.seat;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#angle = 0;
    this.#power = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#potted.length = 0;
    resetState(this.#state, context.openingSeat);
    placeStriker(this.#state);
    this.#flip.snap(this.#shouldRotate());
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) this.#matchWinner = this.#state.winner;
      return;
    }

    if (this.#state.phase === 'rolling') {
      const result = step(this.#state, fixedDeltaSeconds);
      for (const index of result.potted) this.#potted.push(index);
      if (result.settled) this.#finishShot();
      return;
    }
    if (this.#state.phase === 'over') return;

    // The striker sits on the baseline wherever the shooter has slid it, and stops against
    // anything resting in the way, so what is drawn is what will be flicked.
    placeStriker(this.#state);

    const seat = this.#state.seat;
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      this.#updateBot(difficulty);
      return;
    }
    if (!this.#flip.acceptsInput) return;
    this.#updateAim(fixedDeltaSeconds, input.seat(seat));
  }

  #updateBot(difficulty: BotDifficulty): void {
    if (this.#thinkSteps < 0) {
      this.#thinkSteps = Math.max(1, Math.round(THINK_SECONDS * (this.#stepsPerSecond || 60)));
    }
    if (this.#thinkSteps > 0) {
      this.#thinkSteps -= 1;
      return;
    }
    this.#thinkSteps = -1;
    // Two rolls for the whole stroke rather than one per step: a fresh error every step
    // averages to zero and every tier plays the same, which is the bug the SDK's
    // bot-judgement module was written to stop the next game repeating.
    const aim = botAim(this.#state, difficulty, this.#rng.float(), this.#rng.float());
    this.#state.offset = aim.offset;
    this.#angle = aim.angle;
    this.#power = aim.power;
    this.#potted.length = 0;
    flick(this.#state, aim.angle, aim.power);
  }

  /**
   * Placing and aiming.
   *
   * A finger behind your own line slides the striker along it, exactly where a hand would
   * rest. Carry the same finger forward into the board and it aims instead: the striker
   * leaves along the line from itself *to* your finger, and how far in you reached is how
   * hard it goes. Let go to flick.
   *
   * On a keyboard the two halves of the gesture are two axes — slide with A and D, swing the
   * aim with W and S — and power is built by holding the action key, so a player with no
   * pointing device can express all three numbers a stroke needs.
   *
   * Every value here is in **seat space**: `+1` right is the shooter's own right whichever
   * side of the device they sit on, so the two seats are mirror images rather than one being
   * asked to play the board upside down.
   */
  #updateAim(fixedDeltaSeconds: number, seatInput: ReturnType<InputState['seat']>): void {
    const seat = this.#state.seat;
    const striker = strikerOf(this.#state);
    const pointer = seatInput.pointer;

    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const relRight = (this.#pointerWorld.x - striker.x) * rightOf(seat);
      const relForward = (this.#pointerWorld.y - striker.y) * forwardOf(seat);
      if (relForward <= 0) {
        // Behind the line: this is a hand placing the striker, not aiming it.
        const along = (this.#pointerWorld.x - CENTRE_X) * rightOf(seat);
        this.#state.offset = clamp(along / BASE_HALF, -1, 1);
        this.#power = 0;
      } else {
        const reach = Math.hypot(relRight, relForward);
        if (reach > AIM_DEADZONE) {
          this.#angle = clampAim(Math.atan2(relRight, relForward));
          this.#power = clamp(reach / REACH_FOR_FULL_POWER, 0, 1);
        }
      }
    }

    const move = seatInput.move;
    if (Math.abs(move.x) > 0.2) {
      this.#state.offset = clamp(
        this.#state.offset + move.x * fixedDeltaSeconds * SLIDE_RATE,
        -1,
        1,
      );
    }
    if (Math.abs(move.y) > 0.2) {
      this.#angle = clampAim(this.#angle + move.y * fixedDeltaSeconds * AIM_TURN_RATE);
    }
    if (pointer === null && seatInput.actionHeld) {
      this.#power = clamp(seatInput.holdSeconds / HOLD_FOR_FULL_POWER, 0, 1);
    }

    // `flick` owns the rule that a stroke needs power behind it; re-checking it here would
    // be a second copy of the rule, and its return value is what says a stroke happened.
    if (seatInput.actionReleased && flick(this.#state, this.#angle, this.#power)) {
      this.#potted.length = 0;
      this.#power = 0;
    }
  }

  #finishShot(): void {
    const outcome = settleShot(this.#state, this.#potted);
    this.#potted.length = 0;
    this.#state.fouled = outcome.fouled;
    if (outcome.winner !== null) {
      this.#state.winner = outcome.winner;
      this.#state.phase = 'over';
      this.#settleSteps = Math.max(1, Math.round(SETTLE_SECONDS * (this.#stepsPerSecond || 60)));
      return;
    }
    this.#state.seat = outcome.next;
    this.#state.phase = 'aiming';
    // A carrom striker is lifted off the board and placed again for every stroke, so the
    // slide and the aim start from the middle each time rather than from where they ended.
    this.#state.offset = 0;
    this.#angle = 0;
    this.#power = 0;
    this.#thinkSteps = -1;
    placeStriker(this.#state);
  }

  /**
   * Whether the board is drawn turned about.
   *
   * Sharing one device, it faces whoever is to move. Alone on your own device it faces
   * *you*, always — seat two would otherwise be asked to shoot from the far edge of a board
   * drawn for seat one, which is the one presentation carrom cannot survive.
   */
  #shouldRotate(): boolean {
    if (this.#presentation === 'single-seat') return this.#localSeat === 'p2';
    return this.#state.seat !== this.#localSeat;
  }

  getScore(): MatchScore {
    return {
      p1: pottedCount(this.#state, 'p1'),
      p2: pottedCount(this.#state, 'p2'),
      winner: this.#matchWinner,
    };
  }

  onPause(): void {
    // Nobody comes back to a striker half flicked.
    this.#power = 0;
  }

  onResume(): void {}

  destroy(): void {
    resetState(this.#state);
    this.#matchWinner = null;
    this.#potted.length = 0;
    this.#settleSteps = 0;
    this.#thinkSteps = -1;
    this.#angle = 0;
    this.#power = 0;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawPucks(renderer);
    if (this.#state.phase !== 'over') this.#drawStriker(renderer);
    if (this.#state.phase === 'aiming') this.#drawAim(renderer);
    this.#drawReadouts(renderer);
    renderer.popSeatRotation();
  }

  #drawBoard(renderer: Renderer): void {
    renderer.rect(BOARD_X, BOARD_Y, BOARD_SIZE, BOARD_SIZE, COLOUR_FRAME);
    renderer.strokeRect(BOARD_X, BOARD_Y, BOARD_SIZE, BOARD_SIZE, 4, COLOUR_FRAME_EDGE);
    const bed = BOARD_SIZE - FRAME * 2;
    renderer.rect(SURFACE_LEFT, SURFACE_TOP, bed, bed, COLOUR_BED);

    // The rails, drawn as they behave: each one stops a pocket's width short of the corner,
    // so the four mouths a puck can drop through are visible rather than implied.
    const near = POCKET_MOUTH;
    for (const y of [SURFACE_TOP, SURFACE_BOTTOM]) {
      renderer.line(SURFACE_LEFT + near, y, SURFACE_RIGHT - near, y, 4, COLOUR_FRAME_EDGE);
    }
    for (const x of [SURFACE_LEFT, SURFACE_RIGHT]) {
      renderer.line(x, SURFACE_TOP + near, x, SURFACE_BOTTOM - near, 4, COLOUR_FRAME_EDGE);
    }

    // The centre circle and its ring, which is where the queen sits.
    renderer.strokeCircle(CENTRE_X, CENTRE_Y, 96, 3, COLOUR_BED_LINE);
    renderer.strokeCircle(CENTRE_X, CENTRE_Y, 30, 2, COLOUR_BED_LINE);

    for (const seat of ['p1', 'p2'] as const) {
      const palette = SEAT_PALETTE[seat];
      const y = strikerYFor(seat);
      const inner = y + 11 * forwardOf(seat);
      renderer.line(CENTRE_X - BASE_HALF, y, CENTRE_X + BASE_HALF, y, 3, palette.base);
      renderer.line(CENTRE_X - BASE_HALF, inner, CENTRE_X + BASE_HALF, inner, 3, palette.base);
      // The end circles of a carrom baseline, and the seat's own mark inside them: a ring
      // for seat one and a bar for seat two, so the two lines are told apart in greyscale.
      for (const side of [-1, 1]) {
        const x = CENTRE_X + side * BASE_HALF;
        renderer.strokeCircle(x, (y + inner) / 2, 16, 3, palette.base);
        if (seat === 'p1') renderer.strokeCircle(x, (y + inner) / 2, 7, 3, palette.deep);
        else renderer.rect(x - 9, (y + inner) / 2 - 3, 18, 6, palette.deep);
      }
    }

    for (const [px, py] of POCKETS) {
      const left = px < CENTRE_X ? px : px - POCKET_MOUTH;
      const top = py < CENTRE_Y ? py : py - POCKET_MOUTH;
      renderer.rect(left, top, POCKET_MOUTH, POCKET_MOUTH, COLOUR_POCKET);
      renderer.circle(px, py, POCKET_MOUTH * 0.7, COLOUR_POCKET);
      renderer.strokeCircle(px, py, POCKET_MOUTH, 3, COLOUR_BED_LINE);
    }
  }

  /**
   * Rule 7: a seat's pucks carry its colour **and** its shape — seat one a ring, seat two a
   * bar across the middle — so the two sides are told apart with the colour taken away. The
   * queen is the only puck marked with a cross, and the striker the only one with neither.
   */
  #drawPucks(renderer: Renderer): void {
    for (const b of this.#state.bodies) {
      if (b.potted || b.kind === 'striker') continue;
      if (b.kind === 'queen') {
        renderer.circle(b.x, b.y, PUCK_RADIUS, COLOUR_QUEEN);
        renderer.line(b.x - 8, b.y, b.x + 8, b.y, 3, COLOUR_QUEEN_MARK);
        renderer.line(b.x, b.y - 8, b.x, b.y + 8, 3, COLOUR_QUEEN_MARK);
        continue;
      }
      const palette = SEAT_PALETTE[b.kind];
      renderer.circle(b.x, b.y, PUCK_RADIUS, palette.base);
      if (b.kind === 'p1') renderer.strokeCircle(b.x, b.y, PUCK_RADIUS * 0.52, 3, palette.deep);
      else renderer.rect(b.x - PUCK_RADIUS, b.y - 4, PUCK_RADIUS * 2, 8, palette.deep);
    }
  }

  #drawStriker(renderer: Renderer): void {
    const striker = strikerOf(this.#state);
    if (striker.potted) return;
    const palette = SEAT_PALETTE[this.#state.seat];
    renderer.circle(striker.x, striker.y, STRIKER_RADIUS, COLOUR_STRIKER);
    renderer.strokeCircle(striker.x, striker.y, STRIKER_RADIUS - 3, 3, COLOUR_STRIKER_EDGE);
    // Whose stroke it is, read off the striker itself rather than off a banner.
    renderer.strokeCircle(striker.x, striker.y, STRIKER_RADIUS + 4, 3, palette.base);
  }

  #drawAim(renderer: Renderer): void {
    const striker = strikerOf(this.#state);
    if (striker.potted) return;
    const seat = this.#state.seat;
    const palette = SEAT_PALETTE[seat];
    const dirX = Math.sin(this.#angle) * rightOf(seat);
    const dirY = Math.cos(this.#angle) * forwardOf(seat);

    // The line the striker will take, drawn further the harder the stroke will be.
    const length = 120 + this.#power * 300;
    renderer.line(
      striker.x + dirX * (STRIKER_RADIUS + 6),
      striker.y + dirY * (STRIKER_RADIUS + 6),
      striker.x + dirX * length,
      striker.y + dirY * length,
      3,
      COLOUR_GUIDE,
    );
    // A pip at the far end, so the aim is visible when the power is nearly nothing.
    renderer.circle(striker.x + dirX * length, striker.y + dirY * length, 6, palette.base);

    // Where along the line the striker is standing, marked on the baseline itself: a slide
    // made with keys has to be as readable as one made with a thumb.
    const slide = strikerSlide(this.#state);
    const markX = strikerXFor(seat, slide);
    const markY = strikerYFor(seat) - 24 * forwardOf(seat);
    renderer.line(markX - 12, markY, markX + 12, markY, 4, palette.deep);
  }

  /**
   * A readout at each end of the board: how many pucks that seat still has to pot, in that
   * seat's own colour and mark, and the state of the queen.
   *
   * Both bands turn with the board, so each player reads their own count the right way up
   * and neither is shown more than the other.
   */
  #drawReadouts(renderer: Renderer): void {
    const seat = this.#state.seat;
    this.#drawSeatCount(renderer, seat, CENTRE_Y + 390 * -forwardOf(seat), 30);
    this.#drawSeatCount(renderer, otherOf(seat), CENTRE_Y + 390 * forwardOf(seat), 24);

    const near = CENTRE_Y + 432 * -forwardOf(seat);
    renderer.text(this.#statusLine(), CENTRE_X, near, 22, COLOUR_MUTED, 'centre');
  }

  #drawSeatCount(renderer: Renderer, seat: SeatId, y: number, size: number): void {
    const palette = SEAT_PALETTE[seat];
    const line = `${String(remaining(this.#state, seat))} to go`;
    renderer.text(line, CENTRE_X, y, size, COLOUR_TEXT, 'centre');
    const markX = CENTRE_X - 150;
    renderer.circle(markX, y, 14, palette.base);
    if (seat === 'p1') renderer.strokeCircle(markX, y, 7, 3, palette.deep);
    else renderer.rect(markX - 14, y - 4, 28, 8, palette.deep);
    if (this.#state.queenOwner === seat) {
      renderer.circle(CENTRE_X + 150, y, 12, COLOUR_QUEEN);
      renderer.line(CENTRE_X + 144, y, CENTRE_X + 156, y, 3, COLOUR_QUEEN_MARK);
      renderer.line(CENTRE_X + 150, y - 6, CENTRE_X + 150, y + 6, 3, COLOUR_QUEEN_MARK);
    }
  }

  #statusLine(): string {
    if (this.#state.phase === 'over') return 'Frame over';
    if (this.#state.queenPending) return 'Cover the queen';
    if (this.#state.fouled) return 'Foul — a puck goes back';
    if (this.#state.phase === 'rolling') return 'Running';
    if (this.#state.queenOwner === null && remaining(this.#state, this.#state.seat) === 1) {
      return 'The queen first';
    }
    return 'Slide, aim, flick';
  }
}
