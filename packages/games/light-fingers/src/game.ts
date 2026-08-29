import { SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOT_PROFILES,
  SLOT_COUNT,
  botIntent,
  commit,
  createBotIntent,
  createBotState,
  createState,
  handOf,
  nudge,
  reach,
  resetBotState,
  resetState,
  slotCentreX,
  slotForX,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotIntent, BotState, Hand, State } from './rules.js';

/**
 * Light Fingers — five pedestals, one diamond, and two hands that both take time to move.
 *
 * The case goes dark, the diamond is moved, the lights come up, and the first hand to
 * close on the right pedestal takes the point. Committing early is allowed and is a
 * one-in-five gamble; closing on the wrong pedestal trips the alarm and freezes that hand
 * for most of the round. Neither mashing nor waiting wins on its own.
 */

/** Each seat owns half the logical box, split across the middle. */
export const HALF_HEIGHT = 500;

/**
 * Everything is measured **from the divider**, into the seat's own half.
 *
 * The two players are reaching into one case and the divider is where the case is, so a
 * depth of 130 means "130 towards the other player" for both of them without either
 * needing to know which way up its half is drawn. Measuring from each seat's outer edge
 * put the pedestals at the far end of the half and the hands beyond them, which read as
 * two people reaching away from the thing they were stealing.
 */
const PEDESTAL_NEAR = 130;
const PEDESTAL_FAR = 170;
const GEM_DEPTH = 105;
const GEM_RADIUS = 22;
const COUNTER_DEPTH = 370;
const HAND_REST_DEPTH = 320;
const HAND_CLOSE_DEPTH = 215;
const HAND_RADIUS = 34;
const STATUS_DEPTH = 412;
const ROLE_DEPTH = 460;

const PEDESTAL_WIDTH = 76;
const PEDESTAL_HEIGHT = PEDESTAL_FAR - PEDESTAL_NEAR;

const COLOUR_BACKGROUND = '#0c1018';
const COLOUR_PANEL = '#161d2c';
const COLOUR_CASE = '#1f2a3f';
const COLOUR_PEDESTAL = '#2b3448';
const COLOUR_EDGE = 'rgba(226, 236, 250, 0.28)';
const COLOUR_DIM = 'rgba(226, 236, 250, 0.45)';
const COLOUR_GEM = '#9fe8ff';
const COLOUR_LIVE = '#5ef2a0';
const COLOUR_ALARM = '#ff8a5c';
const COLOUR_INK = '#0b1220';

const STATUS_SIZE = 40;
const ROLE_SIZE = 28;

/** How far a direction has to lean before it counts as a nudge, for an analogue source. */
const AIM_DEADZONE = 0.35;

/** Per-seat controller state, allocated once. */
interface SeatRuntime {
  readonly bot: BotState;
  readonly intent: BotIntent;
  /** True while this seat's action is down, so a hold is one commit. */
  held: boolean;
}

function createRuntime(): SeatRuntime {
  return { bot: createBotState(), intent: createBotIntent(), held: false };
}

/** The y of a seat's half, top edge. p1 sits at the bottom. */
export function halfTop(seat: SeatId): number {
  return seat === 'p1' ? HALF_HEIGHT : 0;
}

export class LightFingersGame implements Game {
  readonly #state: State = createState();
  readonly #runtimeP1: SeatRuntime = createRuntime();
  readonly #runtimeP2: SeatRuntime = createRuntime();

  #context: GameContext | null = null;
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  /** Read-only view for the harness and the tests. */
  get state(): Readonly<State> {
    return this.#state;
  }

  init(context: GameContext): void {
    this.#context = context;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    resetState(this.#state, context.rng);
    for (const runtime of [this.#runtimeP1, this.#runtimeP2]) {
      resetBotState(runtime.bot);
      runtime.held = false;
    }
    this.#winner = null;
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    const context = this.#context;
    if (context === null || this.#winner !== null) return;

    this.#driveSeat('p1', this.#runtimeP1, this.#botP1, input, fixedDeltaSeconds, context);
    this.#driveSeat('p2', this.#runtimeP2, this.#botP2, input, fixedDeltaSeconds, context);

    step(this.#state, fixedDeltaSeconds, context.rng);
    this.#winner = winnerOf(this.#state);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawHalf(renderer, 'p1');
    this.#drawHalf(renderer, 'p2');
    renderer.line(0, HALF_HEIGHT, manifest.logical.width, HALF_HEIGHT, 3, COLOUR_EDGE);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // An action still down across a pause must not read as a fresh commit on the way back,
    // or a paused player returns having grabbed at a dark case and lost the round to it.
    this.#settle();
  }

  getScore(): MatchScore {
    return { p1: this.#state.p1, p2: this.#state.p2, winner: this.#winner };
  }

  destroy(): void {
    this.#context = null;
    this.#botP1 = null;
    this.#botP2 = null;
    resetState(this.#state);
    for (const runtime of [this.#runtimeP1, this.#runtimeP2]) {
      resetBotState(runtime.bot);
      runtime.held = false;
    }
    this.#winner = null;
  }

  #settle(): void {
    // Marked as held rather than released: the next step sees an action already down and
    // waits for a genuine release before believing the next press.
    this.#runtimeP1.held = true;
    this.#runtimeP2.held = true;
  }

  #driveSeat(
    seat: SeatId,
    runtime: SeatRuntime,
    difficulty: BotDifficulty | null,
    input: InputState,
    dt: number,
    context: GameContext,
  ): void {
    if (difficulty !== null) {
      const intent = runtime.intent;
      botIntent(this.#state, runtime.bot, BOT_PROFILES[difficulty], seat, dt, context.rng, intent);
      if (intent.aim >= 0) reach(this.#state, seat, intent.aim);
      if (intent.commit) commit(this.#state, seat);
      return;
    }

    const seatInput = input.seat(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // A thumb names the pedestal outright. The hand still walks there at its own pace,
      // so this is a shorter *gesture* than holding a key, never a faster hand.
      reach(this.#state, seat, slotForX(pointer.x));
    } else {
      const lean = seatInput.move.x;
      nudge(this.#state, seat, Math.abs(lean) < AIM_DEADZONE ? 0 : lean);
    }

    const down = seatInput.actionHeld || seatInput.actionPressed;
    // One press, one commit. A held action must not re-arm every step: after an alarm
    // that would hand the round to whoever leant on the button hardest.
    const pressed = down && !runtime.held;
    runtime.held = down;
    if (pressed) commit(this.#state, seat);
  }

  /**
   * One seat's half.
   *
   * The rail itself is drawn in device orientation for both seats — a row of five
   * pedestals reads the same either way up, and drawing it identically means a pointer x
   * names the same pedestal for both seats with no per-seat mapping to get wrong. Only the
   * *words* are turned, since those genuinely have a way up.
   */
  #drawHalf(renderer: Renderer, seat: SeatId): void {
    const flipped = this.#presentation === 'shared-screen' && seat !== this.#localSeat;
    const state = this.#state;
    const hand = handOf(state, seat);
    const palette = SEAT_PALETTE[seat];
    const width = manifest.logical.width;

    const fromMiddle = (depth: number): number =>
      seat === 'p1' ? HALF_HEIGHT + depth : HALF_HEIGHT - depth;
    const bandTop = (near: number, far: number): number =>
      seat === 'p1' ? fromMiddle(near) : fromMiddle(far);

    renderer.rect(0, halfTop(seat), width, HALF_HEIGHT, COLOUR_PANEL);
    renderer.rect(0, bandTop(0, COUNTER_DEPTH), width, COUNTER_DEPTH, COLOUR_CASE);
    renderer.line(0, fromMiddle(COUNTER_DEPTH), width, fromMiddle(COUNTER_DEPTH), 4, COLOUR_EDGE);

    this.#drawPedestals(renderer, fromMiddle, bandTop);
    this.#drawHand(renderer, seat, hand, fromMiddle, palette.base);
    this.#drawLabels(renderer, seat, hand, fromMiddle, flipped);
  }

  #drawPedestals(
    renderer: Renderer,
    fromMiddle: (depth: number) => number,
    bandTop: (near: number, far: number) => number,
  ): void {
    const diamond = this.#state.diamond;
    const top = bandTop(PEDESTAL_NEAR, PEDESTAL_FAR);
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const centre = slotCentreX(slot);
      const left = centre - PEDESTAL_WIDTH / 2;
      renderer.rect(left, top, PEDESTAL_WIDTH, PEDESTAL_HEIGHT, COLOUR_PEDESTAL);
      const lit = slot === diamond;
      renderer.strokeRect(
        left,
        top,
        PEDESTAL_WIDTH,
        PEDESTAL_HEIGHT,
        lit ? 6 : 2,
        lit ? COLOUR_GEM : COLOUR_EDGE,
      );
      if (!lit) continue;
      // The diamond is a shape on top of a pedestal, not a colour on it: in greyscale the
      // lit pedestal is still the only one wearing a gem and a heavy outline (rule 7).
      const gemY = fromMiddle(GEM_DEPTH);
      renderer.circle(centre, gemY, GEM_RADIUS, COLOUR_GEM);
      renderer.strokeCircle(centre, gemY, GEM_RADIUS - 7, 4, COLOUR_INK);
    }
  }

  /**
   * One seat's hand.
   *
   * p1's is a disc and p2's is a block, so whose hand is whose survives greyscale — and
   * the two states that change the game are shapes too: a committed hand wears a ring and
   * reaches forward, a hand the alarm has caught wears a cross and cannot move.
   */
  #drawHand(
    renderer: Renderer,
    seat: SeatId,
    hand: Readonly<Hand>,
    fromMiddle: (depth: number) => number,
    colour: string,
  ): void {
    const x = slotCentreX(hand.slot);
    const locked = hand.lock > 0;
    const y = fromMiddle(hand.armed && !locked ? HAND_CLOSE_DEPTH : HAND_REST_DEPTH);

    if (seat === 'p1') {
      renderer.circle(x, y, HAND_RADIUS, colour);
      renderer.strokeCircle(x, y, HAND_RADIUS - 6, 5, COLOUR_INK);
      if (hand.armed) renderer.strokeCircle(x, y, HAND_RADIUS + 9, 4, COLOUR_LIVE);
    } else {
      renderer.rect(x - HAND_RADIUS, y - HAND_RADIUS, HAND_RADIUS * 2, HAND_RADIUS * 2, colour);
      renderer.strokeRect(
        x - HAND_RADIUS + 6,
        y - HAND_RADIUS + 6,
        HAND_RADIUS * 2 - 12,
        HAND_RADIUS * 2 - 12,
        5,
        COLOUR_INK,
      );
      if (hand.armed) {
        const outer = HAND_RADIUS + 9;
        renderer.strokeRect(x - outer, y - outer, outer * 2, outer * 2, 4, COLOUR_LIVE);
      }
    }

    if (locked) {
      const arm = HAND_RADIUS + 4;
      renderer.line(x - arm, y - arm, x + arm, y + arm, 6, COLOUR_ALARM);
      renderer.line(x - arm, y + arm, x + arm, y - arm, 6, COLOUR_ALARM);
    }

    // A marker on the rail for where the hand is headed, so a player can see their aim
    // arrive rather than guessing why the hand is moving.
    if (hand.want !== hand.slot) {
      const wantX = slotCentreX(hand.want);
      const markerY = fromMiddle(HAND_REST_DEPTH + HAND_RADIUS + 16);
      renderer.line(wantX - 22, markerY, wantX + 22, markerY, 5, colour);
    }
  }

  /**
   * What this seat is being told, in words.
   *
   * `pushSeatRotation` turns the whole logical box about its centre rather than about one
   * half, so a label drawn at the far seat's own coordinates lands in the *near* seat's
   * half and on the wrong side of the rail. Mirroring both axes through the centre first
   * puts it back where it belongs once the rotation is applied.
   */
  #drawLabels(
    renderer: Renderer,
    seat: SeatId,
    hand: Readonly<Hand>,
    fromMiddle: (depth: number) => number,
    flipped: boolean,
  ): void {
    const width = manifest.logical.width;
    const height = manifest.logical.height;
    const status = this.#statusLabel(seat, hand);
    const colour =
      hand.lock > 0 ? COLOUR_ALARM : this.#state.phase === 'open' ? COLOUR_LIVE : COLOUR_DIM;
    const mirrorX = (x: number): number => (flipped ? width - x : x);
    const mirrorY = (y: number): number => (flipped ? height - y : y);

    renderer.pushSeatRotation(flipped);
    renderer.text(
      status,
      mirrorX(width / 2),
      mirrorY(fromMiddle(STATUS_DEPTH)),
      STATUS_SIZE,
      colour,
      'centre',
    );
    renderer.text(
      seat === 'p1' ? 'P1 · DISC' : 'P2 · BLOCK',
      mirrorX(width / 2),
      mirrorY(fromMiddle(ROLE_DEPTH)),
      ROLE_SIZE,
      COLOUR_DIM,
      'centre',
    );
    renderer.popSeatRotation();
  }

  #statusLabel(seat: SeatId, hand: Readonly<Hand>): string {
    const state = this.#state;
    if (state.phase === 'settling') {
      if (state.outcome === 'bust') return 'CASE SHUT';
      if (state.scorer === 'both') return 'SPLIT!';
      return state.scorer === seat ? 'STOLE IT' : 'TOO SLOW';
    }
    if (hand.lock > 0) return 'ALARM';
    if (state.phase === 'open') return hand.armed ? 'REACHING' : 'GRAB IT';
    return hand.armed ? 'COMMITTED' : 'LIGHTS OUT';
  }
}

const gameModule = {
  manifest,
  create: (): Game => new LightFingersGame(),
};

export default gameModule;
