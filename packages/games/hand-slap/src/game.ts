import { SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOT_PROFILES,
  SWING_SECONDS,
  botAction,
  createBotState,
  createState,
  defenderOf,
  dodge,
  handsAway,
  resetBotState,
  resetState,
  step,
  swing,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, State } from './rules.js';

/**
 * Hand Slap — one button each, and the whole game is *when* you press it.
 *
 * One seat holds their hands out and the other tries to slap them. The attacker scores by
 * connecting; the defender scores by making the attacker swing at nothing. A dodge with no
 * swing to dodge costs the defender a point, which is what stops either player winning by
 * mashing — and is why this is a bluff rather than a reaction test.
 */

/** Each seat owns half the logical box, split across the middle. */
export const HALF_HEIGHT = 500;
const CENTRE_X = 300;

/**
 * Distances are measured **from the divider**, into the seat's own half.
 *
 * Measuring from each seat's outer edge was the obvious first choice and it read wrongly:
 * the hands sat far from the middle and the attacker's arm swung *away* from them, so the
 * slap never appeared to reach anything. The two players' hands are together in the real
 * game, and the divider is where they meet.
 */
const HANDS_INSET = 130;
const DODGE_LIFT = 96;
const HAND_RADIUS = 62;
const HAND_GAP = 78;

/**
 * Where the attacker's arm starts, and how close to the divider it reaches.
 *
 * The half is 500 deep and everything has to fit inside it without overlapping: the arm
 * rests with its fist around 280–380, and the two labels sit beyond that, out at the
 * seat's own edge. The first version put the labels at 378 and 430, straight through the
 * fist.
 */
const ARM_ANCHOR = 330;
const ARM_REACH = 24;

/** Where each seat's two labels sit, measured from the divider. */
const STATUS_DEPTH = 425;
const ROLE_DEPTH = 470;

const COLOUR_BACKGROUND = '#101725';
const COLOUR_PANEL = '#1b2740';
const COLOUR_LINE = 'rgba(233, 240, 252, 0.3)';
const COLOUR_INK = '#0b1220';
const COLOUR_READY = 'rgba(233, 240, 252, 0.45)';
const COLOUR_LIVE = '#5ef2a0';

const LABEL_SIZE = 34;
const STATE_SIZE = 44;

/** Per-seat controller state, allocated once. */
interface SeatRuntime {
  readonly bot: BotState;
  /** True while this seat's button is down, so a hold is one press. */
  held: boolean;
}

function createRuntime(): SeatRuntime {
  return { bot: createBotState(), held: false };
}

/** The y of a seat's half, top edge. p1 sits at the bottom. */
export function halfTop(seat: SeatId): number {
  return seat === 'p1' ? HALF_HEIGHT : 0;
}

export class HandSlapGame implements Game {
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
    resetState(this.#state);
    resetBotState(this.#runtimeP1.bot);
    resetBotState(this.#runtimeP2.bot);
    this.#runtimeP1.held = false;
    this.#runtimeP2.held = false;
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

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawHalf(renderer, 'p1');
    this.#drawHalf(renderer, 'p2');
    renderer.line(0, HALF_HEIGHT, manifest.logical.width, HALF_HEIGHT, 3, COLOUR_LINE);
  }

  onPause(): void {
    this.#settle();
  }

  onResume(): void {
    // A button still down across a pause must not read as a fresh press on the way back,
    // or a paused player returns having swung at nothing and given away a point.
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
    resetBotState(this.#runtimeP1.bot);
    resetBotState(this.#runtimeP2.bot);
    this.#winner = null;
  }

  #settle(): void {
    // Marked as held, not released: the next step sees a button that is already down and
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
      const action = botAction(
        this.#state,
        runtime.bot,
        BOT_PROFILES[difficulty],
        seat,
        dt,
        context.rng.float(),
      );
      if (action === 'swing' && seat === this.#state.attacker) swing(this.#state);
      else if (action === 'dodge' && seat === defenderOf(this.#state)) dodge(this.#state);
      return;
    }

    const seatInput = input.seat(seat);
    const down = seatInput.actionHeld || seatInput.actionPressed;
    // One press, one action. A held button must not swing every step — that would make
    // holding it down the dominant strategy, and the game is about choosing a moment.
    const pressed = down && !runtime.held;
    runtime.held = down;
    if (!pressed) return;

    if (seat === this.#state.attacker) swing(this.#state);
    else dodge(this.#state);
  }

  /**
   * One seat's half.
   *
   * The seat opposite is drawn the other way up so each player reads their own hands
   * nearest to them, which is the whole reason the halves exist.
   */
  #drawHalf(renderer: Renderer, seat: SeatId): void {
    const flipped = this.#presentation === 'shared-screen' && seat !== this.#localSeat;
    const top = halfTop(seat);
    const palette = SEAT_PALETTE[seat];
    const attacking = seat === this.#state.attacker;

    renderer.rect(0, top, manifest.logical.width, HALF_HEIGHT, COLOUR_PANEL);

    // Distance from the divider into this seat's own half, so "towards the other player"
    // means the same thing for both of them without either needing to know which way up
    // it is drawn.
    const fromMiddle = (distance: number): number =>
      seat === 'p1' ? HALF_HEIGHT + distance : HALF_HEIGHT - distance;

    if (attacking) this.#drawArm(renderer, seat, fromMiddle, palette.base);
    else this.#drawHands(renderer, seat, fromMiddle, palette.base);

    this.#drawLabel(renderer, seat, fromMiddle, flipped, attacking);
  }

  #drawHands(
    renderer: Renderer,
    seat: SeatId,
    fromMiddle: (distance: number) => number,
    colour: string,
  ): void {
    // Pulled *back* from the divider when dodging, which is the whole gesture.
    const away = handsAway(this.#state);
    const y = fromMiddle(HANDS_INSET + (away ? DODGE_LIFT : 0));
    // p1's hands are discs, p2's are squares — rule 7, so whose hands are whose survives
    // greyscale.
    for (const offset of [-HAND_GAP, HAND_GAP]) {
      const x = CENTRE_X + offset;
      if (seat === 'p1') {
        renderer.circle(x, y, HAND_RADIUS, colour);
        renderer.strokeCircle(x, y, HAND_RADIUS - 5, 5, COLOUR_INK);
      } else {
        renderer.rect(x - HAND_RADIUS, y - HAND_RADIUS, HAND_RADIUS * 2, HAND_RADIUS * 2, colour);
        renderer.strokeRect(
          x - HAND_RADIUS + 5,
          y - HAND_RADIUS + 5,
          HAND_RADIUS * 2 - 10,
          HAND_RADIUS * 2 - 10,
          5,
          COLOUR_INK,
        );
      }
    }
  }

  #drawArm(
    renderer: Renderer,
    seat: SeatId,
    fromMiddle: (distance: number) => number,
    colour: string,
  ): void {
    // How far through the swing we are, so the arm actually travels rather than blinking.
    const progress =
      this.#state.phase === 'swinging'
        ? 1 - Math.max(0, Math.min(1, this.#state.timer / SWING_SECONDS))
        : 0;
    // Travels from deep in the attacker's own half to just short of the divider, so at
    // full extension the slap arrives where the other seat's hands are.
    const reach = ARM_ANCHOR - (ARM_ANCHOR - ARM_REACH) * progress;
    const from = fromMiddle(ARM_ANCHOR);
    const to = fromMiddle(reach);
    renderer.line(CENTRE_X, from, CENTRE_X, to, 26, colour);
    if (seat === 'p1') {
      renderer.circle(CENTRE_X, to, HAND_RADIUS * 0.8, colour);
    } else {
      const r = HAND_RADIUS * 0.8;
      renderer.rect(CENTRE_X - r, to - r, r * 2, r * 2, colour);
    }
  }

  /**
   * What this seat is being asked to do, in words.
   *
   * Colour alone could never carry "you are attacking this round" (rule 7), and a player
   * who cannot tell which role they have is not playing the game at all.
   */
  #drawLabel(
    renderer: Renderer,
    seat: SeatId,
    fromMiddle: (distance: number) => number,
    flipped: boolean,
    attacking: boolean,
  ): void {
    const phase = this.#state.phase;
    const role = attacking ? 'SLAP' : 'DODGE';
    const status =
      phase === 'ready' ? 'wait' : phase === 'settling' ? this.#settledLabel(seat) : 'now';
    const colour = phase === 'ready' ? COLOUR_READY : COLOUR_LIVE;

    // `pushSeatRotation` turns the whole logical box about its centre, not about this
    // half — so a label drawn at the seat's own coordinates would land in the *other*
    // seat's half. Mirroring the y through the centre first puts it back where it belongs
    // once the rotation is applied. The x needs the same treatment in principle, but the
    // labels are centred on the middle of the box, which maps to itself.
    const mirror = (y: number): number => (flipped ? manifest.logical.height - y : y);
    renderer.pushSeatRotation(flipped);
    // Out at the seat's own edge, well clear of the hands and the arm.
    renderer.text(role, CENTRE_X, mirror(fromMiddle(ROLE_DEPTH)), LABEL_SIZE, COLOUR_READY, 'centre');
    renderer.text(status, CENTRE_X, mirror(fromMiddle(STATUS_DEPTH)), STATE_SIZE, colour, 'centre');
    renderer.popSeatRotation();
  }

  #settledLabel(seat: SeatId): string {
    if (this.#state.scorer === null) return '';
    const mine = this.#state.scorer === seat;
    if (this.#state.outcome === 'flinch') return mine ? 'they flinched' : 'flinched';
    if (this.#state.outcome === 'dodged') return mine ? 'dodged' : 'missed';
    return mine ? 'hit' : 'ouch';
  }
}

const gameModule = {
  manifest,
  create: (): Game => new HandSlapGame(),
};

export default gameModule;
