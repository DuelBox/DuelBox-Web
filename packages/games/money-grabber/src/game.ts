import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  GRAB_RADIUS,
  GRIP_SECONDS,
  HAND_SPEED,
  MATCH_SECONDS,
  MID_Y,
  NOTE_COUNT,
  NOTE_RADIUS,
  REACH_PAST_MID,
  SAFE_RADIUS,
  SAFE_X,
  TABLE_BOTTOM,
  TABLE_LEFT,
  TABLE_RIGHT,
  TABLE_TOP,
  botStep,
  contested,
  createBotState,
  createState,
  driveHand,
  handOf,
  resetBotState,
  resetState,
  safeYOf,
  secondsLeft,
  step,
} from './rules.js';
import type { BotDifficulty, BotState, Hand, Note, State } from './rules.js';

/**
 * Money Grabber — one table, a safe at each end, and everything on it drawn in board
 * orientation.
 *
 * The table is common ground: both players read the same felt the same way up, so nothing
 * here is rotated except the per-deposit tally, which belongs to one seat and is turned to
 * face it. `rules.ts` owns the whole simulation; this file reads it, puts a hand on it and
 * draws it.
 *
 * **Nothing in this file reads `actionPressed`, `actionHeld` or `holdSeconds`.** A hand is
 * steered and grips what it is over; there is no press anywhere in the game, which is what
 * makes a thumb and a key the same instrument here. See SPEC.md.
 */

/* --------------------------------------------------------------------- shapes */

/**
 * Half the side of a square drawn to the same area as a circle of the same nominal radius:
 * `sqrt(pi) / 2`. Seat one is round throughout and seat two square throughout, and this is
 * what keeps neither of them a visibly bigger object than the other (rule 7).
 */
const SQUARE = Math.sqrt(Math.PI) / 2;

const HAND_RADIUS = 30;
const KNUCKLE_RADIUS = 9;
const KNUCKLE_SPREAD = 19;
const TOKEN_RADIUS = 11;
/** Where a carried note sits relative to the palm holding it, in a two-row fan. */
const TOKEN_STEP = 24;

const NOTE_HALF_W = 26;
const NOTE_HALF_H = 15;

/* -------------------------------------------------------------------- colours */

const COLOUR_GROUND = '#0d1411';
const COLOUR_RAIL = '#182a22';
const COLOUR_FELT = '#12362a';
const COLOUR_FELT_CONTESTED = '#174934';
const COLOUR_RIM = 'rgba(226, 244, 232, 0.24)';
const COLOUR_LINE = 'rgba(226, 244, 232, 0.13)';
const COLOUR_CHALK = 'rgba(233, 246, 238, 0.5)';
const COLOUR_NOTE = '#d8e8c8';
const COLOUR_NOTE_EDGE = '#9dbb86';
const COLOUR_INK = '#0a1a12';
const COLOUR_CLASH = '#f6d365';

/* ------------------------------------------------------------------- feedback */

/** Steps a deposit's tally stays beside the safe that took it. */
export const FEEDBACK_STEPS = 45;

/**
 * Labels for a deposit, looked up rather than built.
 *
 * A hand holds at most six notes of at most three each, so the whole range fits in a frozen
 * table and `render` never allocates a string.
 */
const BANK_LABELS: readonly string[] = Object.freeze(
  Array.from({ length: 25 }, (_unused, i) => `+${String(i)}`),
);

function bankLabel(value: number): string {
  if (value < 0 || value >= BANK_LABELS.length) return '';
  return BANK_LABELS[value] ?? '';
}

/** Face values are 1 to 3, so the three labels a note can carry are a frozen table too. */
const VALUE_LABELS: readonly string[] = Object.freeze(['', '1', '2', '3']);

/** How far a key has to be open before it counts as a direction. */
const AXIS_THRESHOLD = 0.35;

function axis(value: number): number {
  if (value > AXIS_THRESHOLD) return 1;
  if (value < -AXIS_THRESHOLD) return -1;
  return 0;
}

/**
 * How far ahead of itself a key player's hand aims.
 *
 * Any value above one step's travel gives the same result, because `driveHand` moves at a
 * rate and clamps to the seat's reach: the target is a direction, not a distance. Twice the
 * fastest a hand can move in a step is comfortably above it.
 */
const KEY_LEAD = HAND_SPEED * 2;

/** One seat's presentation-only state. Allocated once, at construction. */
interface SeatRuntime {
  /** The deposit being shown, how many steps it has left, and the count it was latched at. */
  value: number;
  steps: number;
  banks: number;
}

function createRuntime(): SeatRuntime {
  return { value: 0, steps: 0, banks: 0 };
}

function resetRuntime(runtime: SeatRuntime): void {
  runtime.value = 0;
  runtime.steps = 0;
  runtime.banks = 0;
}

export class MoneyGrabberGame implements Game {
  readonly #state: State = createState();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  /**
   * Where everything stood at the end of the *previous* step, for the render interpolation.
   *
   * An empty hand crosses the table at 300 units a second, which is five units a step,
   * and it is the object a player is watching — uninterpolated it strobes on any display
   * running above the simulation rate. Typed arrays, allocated once here and written in place
   * at the top of every step, so `update` allocates nothing.
   */
  readonly #prevNoteX = new Float64Array(NOTE_COUNT);
  readonly #prevNoteY = new Float64Array(NOTE_COUNT);
  /** Index 0 is seat one, index 1 seat two. */
  readonly #prevHandX = new Float64Array(2);
  readonly #prevHandY = new Float64Array(2);

  /**
   * Three streams from the one seed the shell gives us.
   *
   * The table has its own, so the pile it deals is a function of the match seed and never of
   * how often a tier happened to look at it — `hard` looks three times as often as `easy`,
   * and on a shared stream that alone would deal the two pairings different tables. Each
   * seat's bot has its own for the other half of the same argument: with one stream,
   * whichever seat is polled first takes the earlier value every time, which is a seat bias
   * dressed as chance.
   */
  #tableRng = new Rng(1);
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
    this.#tableRng = new Rng(context.rng.next() | 0);
    this.#botP1Rng = new Rng(context.rng.next() | 0);
    this.#botP2Rng = new Rng(context.rng.next() | 0);
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    // `context.openingSeat` is deliberately not read. Both hands act from step zero and the
    // table is laid out as half-turn pairs of equal value, so there is no slot parity, no
    // deal and no draw order for an opener to decide — the contract says a real-time game may
    // ignore it, and here there is genuinely nothing for it to buy. `rules.test.ts` asserts
    // that a match is bit-identical under both openers rather than leaving that as a claim.
    this.#ready = true;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetState(this.#state, this.#tableRng);
    // So the first frame drawn interpolates from where the match starts rather than from zero.
    this.#remember();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (!this.#ready) return;
    if (this.#state.winner !== null) return;

    // Taken before anything moves, so what render interpolates from is genuinely the state at
    // the end of the previous step — which is what the loop's `alpha` is measured against.
    this.#remember();

    // Both seats are driven before the table is stepped, so neither is a step ahead of the
    // other and neither can reach a note first by being read first.
    this.#driveSeat('p1', input, fixedDeltaSeconds);
    this.#driveSeat('p2', input, fixedDeltaSeconds);

    step(this.#state, fixedDeltaSeconds);

    this.#latchFeedback('p1', this.#runtimeP1);
    this.#latchFeedback('p2', this.#runtimeP2);
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_GROUND);
    this.#drawTable(renderer);
    this.#drawSafes(renderer);
    this.#drawClock(renderer);
    this.#drawNotes(renderer, alpha);
    this.#drawHand(renderer, 'p1', alpha);
    this.#drawHand(renderer, 'p2', alpha);
    this.#drawFeedback(renderer, 'p1', this.#runtimeP1);
    this.#drawFeedback(renderer, 'p2', this.#runtimeP2);
  }

  onPause(): void {}

  onResume(): void {
    // Nothing to settle. The game reads no edges at all — a hand is steered towards a place
    // — so an input still held across a pause cannot read as a fresh anything.
  }

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: this.#state.winner };
  }

  destroy(): void {
    this.#ready = false;
    this.#botP1 = null;
    this.#botP2 = null;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetRuntime(this.#runtimeP1);
    resetRuntime(this.#runtimeP2);
    resetState(this.#state, this.#tableRng);
    this.#remember();
  }

  /* ------------------------------------------------------------------ driving */

  /** True when this seat reads the device upside down, so its keys mean the mirror image. */
  #isRotated(seat: SeatId): boolean {
    return this.#presentation === 'shared-screen' && seat !== this.#localSeat;
  }

  #driveSeat(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const bot = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const rng = seat === 'p1' ? this.#botP1Rng : this.#botP2Rng;
      botStep(this.#state, seat, difficulty, bot, rng, fixedDeltaSeconds);
      return;
    }

    const hand = handOf(this.#state, seat);
    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // Absolute, and no mirror: the table is one shared board drawn in one orientation, so a
      // finger is already over the felt it is pointing at whichever side of the device its
      // owner is sitting on. `driveHand` rate-limits and clamps it, so a thumb that jumps to
      // the far rail cannot drag the hand there faster than a held key would, and pointing
      // past the reach limit parks the hand on the limit rather than doing nothing.
      driveHand(this.#state, seat, pointer.x, pointer.y, fixedDeltaSeconds);
      return;
    }

    // A key is a direction, and a seat reading the device upside down means the opposite one.
    // This is control mapping, which the two presentations are allowed to differ in; nothing
    // in the simulation reads the presentation.
    const mirror = this.#isRotated(seat) ? -1 : 1;
    const dx = axis(seatInput.move.x) * mirror;
    const dy = axis(seatInput.move.y) * mirror;
    if (dx === 0 && dy === 0) {
      driveHand(this.#state, seat, hand.x, hand.y, fixedDeltaSeconds);
      return;
    }
    driveHand(this.#state, seat, hand.x + dx * KEY_LEAD, hand.y + dy * KEY_LEAD, fixedDeltaSeconds);
  }

  /** Hold a finished deposit's value beside the safe that took it, for a moment. */
  #latchFeedback(seat: SeatId, runtime: SeatRuntime): void {
    const hand = handOf(this.#state, seat);
    if (runtime.steps > 0) runtime.steps -= 1;
    if (hand.banks !== runtime.banks) {
      runtime.banks = hand.banks;
      runtime.value = hand.lastBank;
      runtime.steps = FEEDBACK_STEPS;
    }
  }

  /* ------------------------------------------------------------ interpolation */

  /** Copy where everything stands into the previous-step arrays. Allocates nothing. */
  #remember(): void {
    for (let i = 0; i < this.#state.notes.length; i += 1) {
      const note = this.#state.notes[i];
      if (note === undefined) continue;
      this.#prevNoteX[i] = note.x;
      this.#prevNoteY[i] = note.y;
    }
    this.#prevHandX[0] = this.#state.p1Hand.x;
    this.#prevHandY[0] = this.#state.p1Hand.y;
    this.#prevHandX[1] = this.#state.p2Hand.x;
    this.#prevHandY[1] = this.#state.p2Hand.y;
  }

  /**
   * A loose note moves at most a single unit a step and a hand nine, so anything bigger than
   * this is not motion — it is a note being snatched onto a palm, and drawing the line
   * between the two would streak it across the table.
   */
  static readonly #TELEPORT = 20;

  #interpolate(previous: number, current: number, alpha: number): number {
    if (Math.abs(current - previous) > MoneyGrabberGame.#TELEPORT) return current;
    return previous + (current - previous) * alpha;
  }

  #handX(seat: SeatId, alpha: number): number {
    const hand = handOf(this.#state, seat);
    const previous = this.#prevHandX[seat === 'p1' ? 0 : 1] ?? hand.x;
    return this.#interpolate(previous, hand.x, alpha);
  }

  #handY(seat: SeatId, alpha: number): number {
    const hand = handOf(this.#state, seat);
    const previous = this.#prevHandY[seat === 'p1' ? 0 : 1] ?? hand.y;
    return this.#interpolate(previous, hand.y, alpha);
  }

  /* ------------------------------------------------------------------ drawing */

  #drawTable(renderer: Renderer): void {
    renderer.rect(0, 0, BOARD_WIDTH, TABLE_TOP, COLOUR_RAIL);
    renderer.rect(0, TABLE_BOTTOM, BOARD_WIDTH, BOARD_HEIGHT - TABLE_BOTTOM, COLOUR_RAIL);
    renderer.rect(
      TABLE_LEFT,
      TABLE_TOP,
      TABLE_RIGHT - TABLE_LEFT,
      TABLE_BOTTOM - TABLE_TOP,
      COLOUR_FELT,
    );

    // The band both hands can reach, drawn as its own shade of felt with a line at each edge.
    // A note in here can be grabbed from both sides, so it is where the two hands race — and
    // where a full hand loses. The picture says where that is rather than leaving a player to
    // find it out by being beaten to a note.
    const near = MID_Y - REACH_PAST_MID - GRAB_RADIUS;
    const far = MID_Y + REACH_PAST_MID + GRAB_RADIUS;
    renderer.rect(TABLE_LEFT, near, TABLE_RIGHT - TABLE_LEFT, far - near, COLOUR_FELT_CONTESTED);
    renderer.line(TABLE_LEFT, near, TABLE_RIGHT, near, 2, COLOUR_LINE);
    renderer.line(TABLE_LEFT, far, TABLE_RIGHT, far, 2, COLOUR_LINE);

    renderer.strokeRect(
      TABLE_LEFT,
      TABLE_TOP,
      TABLE_RIGHT - TABLE_LEFT,
      TABLE_BOTTOM - TABLE_TOP,
      4,
      COLOUR_RIM,
    );
  }

  /**
   * The two safes: a **round** vault door for seat one and a **square** one for seat two, at
   * equal area and with the identical circular mouth.
   *
   * Rule 7 starts here, because the safes are the two things a player has to tell apart
   * before anything else on the board means anything. Everything else a seat owns repeats the
   * same pair — round hand, round knuckles, round tokens against square, square, square — so
   * "which of these is mine" has one answer everywhere and a greyscale board loses nothing.
   */
  #drawSafes(renderer: Renderer): void {
    const p1 = SEAT_PALETTE.p1;
    const y1 = safeYOf('p1');
    renderer.circle(SAFE_X, y1, SAFE_RADIUS, p1.tint);
    renderer.strokeCircle(SAFE_X, y1, SAFE_RADIUS - 3, 6, p1.base);
    renderer.strokeCircle(SAFE_X, y1, SAFE_RADIUS * 0.5, 6, p1.deep);

    const p2 = SEAT_PALETTE.p2;
    const y2 = safeYOf('p2');
    const h = SAFE_RADIUS * SQUARE;
    renderer.rect(SAFE_X - h, y2 - h, h * 2, h * 2, p2.tint);
    renderer.strokeRect(SAFE_X - h + 3, y2 - h + 3, (h - 3) * 2, (h - 3) * 2, 6, p2.base);
    const inner = h * 0.5;
    renderer.strokeRect(SAFE_X - inner, y2 - inner, inner * 2, inner * 2, 6, p2.deep);
  }

  /**
   * Seconds left, as a bar on each side margin growing out from the middle of the board.
   *
   * One object, shared, and symmetric under the half-turn, so neither player is nearer to it
   * than the other. The clock is the game's own — the shell has no idea this match has one.
   */
  #drawClock(renderer: Renderer): void {
    const share = secondsLeft(this.#state) / MATCH_SECONDS;
    const half = ((TABLE_BOTTOM - TABLE_TOP) / 2) * share;
    renderer.rect(10, MID_Y - half, 8, half * 2, COLOUR_CHALK);
    renderer.rect(BOARD_WIDTH - 18, MID_Y - half, 8, half * 2, COLOUR_CHALK);
  }

  /**
   * The pile. A loose note belongs to nobody, so it is drawn in nobody's colour: a plain
   * banknote with its face value on it. Value is a numeral rather than a hue, which is what
   * lets a greyscale player decide whether a note is worth the detour.
   */
  #drawNotes(renderer: Renderer, alpha: number): void {
    for (let i = 0; i < this.#state.notes.length; i += 1) {
      const note = this.#state.notes[i];
      if (note === undefined || note.banked || note.carriedBy !== null) continue;
      const x = this.#interpolate(this.#prevNoteX[i] ?? note.x, note.x, alpha);
      const y = this.#interpolate(this.#prevNoteY[i] ?? note.y, note.y, alpha);
      this.#drawNote(renderer, note, x, y);
    }
  }

  #drawNote(renderer: Renderer, note: Readonly<Note>, x: number, y: number): void {
    renderer.rect(x - NOTE_HALF_W, y - NOTE_HALF_H, NOTE_HALF_W * 2, NOTE_HALF_H * 2, COLOUR_NOTE);
    renderer.strokeRect(
      x - NOTE_HALF_W + 2,
      y - NOTE_HALF_H + 2,
      (NOTE_HALF_W - 2) * 2,
      (NOTE_HALF_H - 2) * 2,
      2,
      COLOUR_NOTE_EDGE,
    );
    renderer.text(VALUE_LABELS[note.value] ?? '', x, y, 20, COLOUR_INK, 'centre');

    // A grip in progress is drawn as a bar under the note, so a player can see that a note is
    // half-lifted rather than discovering it when it leaves.
    const grip = note.grip1 > note.grip2 ? note.grip1 : note.grip2;
    if (grip > 0) {
      const width = NOTE_HALF_W * 2 * Math.min(1, grip / GRIP_SECONDS);
      renderer.rect(x - NOTE_HALF_W, y + NOTE_HALF_H + 3, width, 4, COLOUR_CHALK);
    }
    if (contested(this.#state, note)) {
      // Both palms are on it and neither can have it while that lasts. A double ring, in a
      // colour neither seat owns, so the reason the note is not moving is on the board.
      renderer.strokeCircle(x, y, NOTE_RADIUS + 10, 4, COLOUR_CLASH);
      renderer.strokeCircle(x, y, NOTE_RADIUS + 18, 2, COLOUR_CLASH);
    }
  }

  /**
   * A hand, and the money in it.
   *
   * Seat one is round throughout — round palm, round knuckles, round tokens — and seat two is
   * square throughout, the same pair the safes use. The palm's grab radius is drawn as a ring
   * or a box around it, so "what would I pick up from here" is visible rather than learned.
   */
  #drawHand(renderer: Renderer, seat: SeatId, alpha: number): void {
    const hand: Readonly<Hand> = handOf(this.#state, seat);
    const palette = SEAT_PALETTE[seat];
    const x = this.#handX(seat, alpha);
    const y = this.#handY(seat, alpha);
    const round = seat === 'p1';

    // Where it is steering, marked in its own silhouette. Only while it is going somewhere.
    if (Math.abs(hand.targetX - hand.x) > 1 || Math.abs(hand.targetY - hand.y) > 1) {
      if (round) renderer.strokeCircle(hand.targetX, hand.targetY, 20, 3, palette.soft);
      else {
        const t = 20 * SQUARE;
        renderer.strokeRect(hand.targetX - t, hand.targetY - t, t * 2, t * 2, 3, palette.soft);
      }
    }

    if (round) {
      renderer.strokeCircle(x, y, GRAB_RADIUS, 2, palette.soft);
      renderer.circle(x, y, HAND_RADIUS, palette.base);
      renderer.circle(x - KNUCKLE_SPREAD, y - KNUCKLE_SPREAD, KNUCKLE_RADIUS, palette.deep);
      renderer.circle(x, y - KNUCKLE_SPREAD - 4, KNUCKLE_RADIUS, palette.deep);
      renderer.circle(x + KNUCKLE_SPREAD, y - KNUCKLE_SPREAD, KNUCKLE_RADIUS, palette.deep);
    } else {
      const g = GRAB_RADIUS * SQUARE;
      renderer.strokeRect(x - g, y - g, g * 2, g * 2, 2, palette.soft);
      const h = HAND_RADIUS * SQUARE;
      renderer.rect(x - h, y - h, h * 2, h * 2, palette.base);
      const k = KNUCKLE_RADIUS * SQUARE;
      renderer.rect(x - KNUCKLE_SPREAD - k, y + KNUCKLE_SPREAD - k, k * 2, k * 2, palette.deep);
      renderer.rect(x - k, y + KNUCKLE_SPREAD + 4 - k, k * 2, k * 2, palette.deep);
      renderer.rect(x + KNUCKLE_SPREAD - k, y + KNUCKLE_SPREAD - k, k * 2, k * 2, palette.deep);
    }

    this.#drawCarry(renderer, seat, hand, x, y, round, palette.base, palette.deep);
  }

  /**
   * The notes in a hand, fanned out beside it in that seat's own silhouette.
   *
   * Money in a hand is owned, unlike money on the table, so it takes the owner's shape. The
   * fan runs away from the table so it never covers the felt the player is reading, and its
   * length is the carry — which is also the player's own speed gauge, since every token in it
   * costs forty units a second.
   */
  #drawCarry(
    renderer: Renderer,
    seat: SeatId,
    hand: Readonly<Hand>,
    x: number,
    y: number,
    round: boolean,
    base: string,
    deep: string,
  ): void {
    if (hand.carryCount === 0) return;
    const away = seat === 'p1' ? 1 : -1;
    for (let i = 0; i < hand.carryCount; i += 1) {
      const column = i % 4;
      const row = Math.floor(i / 4);
      const tx = x + (column - 1.5) * TOKEN_STEP;
      const ty = y + away * (HAND_RADIUS + 16 + row * TOKEN_STEP);
      if (round) {
        renderer.circle(tx, ty, TOKEN_RADIUS, base);
        renderer.strokeCircle(tx, ty, TOKEN_RADIUS * 0.5, 3, deep);
      } else {
        const t = TOKEN_RADIUS * SQUARE;
        renderer.rect(tx - t, ty - t, t * 2, t * 2, base);
        const inner = t * 0.5;
        renderer.strokeRect(tx - inner, ty - inner, inner * 2, inner * 2, 3, deep);
      }
    }
  }

  /**
   * What the last deposit was worth, beside the safe that took it.
   *
   * The only text on the board besides the notes' own face values, and it is feedback rather
   * than a game element: a signed number needs no language, and nothing on the table has to
   * be read to play. It is turned half a turn for the seat sitting opposite, so both players
   * read their own tally the right way up.
   */
  #drawFeedback(renderer: Renderer, seat: SeatId, runtime: SeatRuntime): void {
    if (runtime.steps === 0 || runtime.value === 0) return;
    const label = bankLabel(runtime.value);
    if (label === '') return;

    const x = SAFE_X;
    const y = seat === 'p1' ? safeYOf('p1') - SAFE_RADIUS - 30 : safeYOf('p2') + SAFE_RADIUS + 30;
    const rotated = this.#isRotated(seat);
    renderer.pushSeatRotation(rotated);
    const drawX = rotated ? BOARD_WIDTH - x : x;
    const drawY = rotated ? BOARD_HEIGHT - y : y;
    renderer.text(label, drawX, drawY, 40, SEAT_PALETTE[seat].base, 'centre');
    renderer.popSeatRotation();
  }
}
