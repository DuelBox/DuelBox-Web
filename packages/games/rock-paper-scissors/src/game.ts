import { Rng, SEAT_PALETTE, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOT_PROFILES,
  THROWS,
  WINDOW_SECONDS,
  botThrow,
  createMemory,
  remember,
  resetMemory,
  resolveRound,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotMemory, Throw } from './rules.js';

/**
 * Button geometry in logical units. Exported because aiming at a button is not a
 * rendering question — the tests need the same mapping the game uses.
 */
export const BUTTON_RADIUS = 78;
export const BUTTON_PITCH = 186;
export const BOARD_CENTRE_X = 300;
/** p1's row sits low and p2's high: each seat's buttons are under its own hands. */
export const P1_ROW_Y = 790;
export const P2_ROW_Y = 210;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_BUTTON = '#232c38';
const COLOUR_BUTTON_ARMED = '#33404f';
const COLOUR_GLYPH = '#e6e9ef';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_TRACK = '#1a212b';

const GLYPH_WIDTH = 7;
const CURSOR_WIDTH = 5;
/** The window bar, drawn across the middle so both seats read the same clock. */
const TRACK_Y = 500;
const TRACK_HEIGHT = 22;
const TRACK_INSET = 70;

const REVEAL_SECONDS = 1.1;

/** Where a seat's button for a throw sits. */
export function buttonCentre(out: Vec2, seat: SeatId, index: number): Vec2 {
  const y = seat === 'p1' ? P1_ROW_Y : P2_ROW_Y;
  return vec2ish(out, BOARD_CENTRE_X + (index - 1) * BUTTON_PITCH, y);
}

function vec2ish(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

const probe = vec2();

/** Which button a point falls on for a seat, or -1. */
export function buttonAt(seat: SeatId, x: number, y: number): number {
  for (let i = 0; i < THROWS.length; i += 1) {
    buttonCentre(probe, seat, i);
    const dx = probe.x - x;
    const dy = probe.y - y;
    if (dx * dx + dy * dy <= BUTTON_RADIUS * BUTTON_RADIUS) return i;
  }
  return -1;
}

type Phase = 'window' | 'reveal';

export class RockPaperScissorsGame implements Game {
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #memoryOfP1: BotMemory = createMemory();
  readonly #memoryOfP2: BotMemory = createMemory();

  #rng = new Rng(1);
  /**
   * No `localSeat` and no `presentation`.
   *
   * Nothing in this game rotates: both seats act at once and each seat's buttons sit
   * under its own hands, so there is no "active seat" whose view the board turns to face.
   * Holding them unused would imply a decision this game does not make.
   */
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #phase: Phase = 'window';
  /** What each seat has committed this round, or null while they have not. */
  #choiceP1: Throw | null = null;
  #choiceP2: Throw | null = null;
  /** Which button the keyboard has selected, per seat. */
  #cursorP1 = 0;
  #cursorP2 = 0;
  #cursorVisibleP1 = false;
  #cursorVisibleP2 = false;
  #heldP1 = 0;
  #heldP2 = 0;

  #tallyP1 = 0;
  #tallyP2 = 0;
  #lastOutcome: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #windowSteps = 0;
  #revealSteps = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    this.#tallyP1 = 0;
    this.#tallyP2 = 0;
    this.#lastOutcome = null;
    resetMemory(this.#memoryOfP1);
    resetMemory(this.#memoryOfP2);
    this.#beginWindow();
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    if (this.#windowSteps < 0) this.#windowSteps = this.#stepsFor(WINDOW_SECONDS);
    if (this.#matchWinner !== null) return;

    if (this.#phase === 'reveal') {
      this.#revealSteps -= 1;
      if (this.#revealSteps <= 0) {
        if (winnerOf({ p1: this.#tallyP1, p2: this.#tallyP2 }) !== null) {
          this.#matchWinner = winnerOf({ p1: this.#tallyP1, p2: this.#tallyP2 });
          return;
        }
        this.#beginWindow();
      }
      return;
    }

    // Both seats act at once. There is no active seat and nothing rotates: each seat's
    // buttons sit under its own hands, which is what makes a simultaneous game workable
    // on a shared device at all.
    this.#readSeat('p1', input);
    this.#readSeat('p2', input);

    this.#windowSteps -= 1;
    const bothCommitted = this.#choiceP1 !== null && this.#choiceP2 !== null;
    if (bothCommitted || this.#windowSteps <= 0) this.#resolve();
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawWindowTrack(renderer);
    this.#drawRow(renderer, 'p1');
    this.#drawRow(renderer, 'p2');
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#tallyP1, p2: this.#tallyP2, winner: this.#matchWinner };
  }

  /**
   * Deliberately absent: there is no active seat.
   *
   * The contract makes `getActiveSeat` optional precisely for this — a real-time game
   * where both players act at once has no turn, and returning one would make the shell's
   * turn indicator claim something untrue.
   */

  destroy(): void {
    resetMemory(this.#memoryOfP1);
    resetMemory(this.#memoryOfP2);
  }

  /** Read-only views for the tests and the harness. */
  get phase(): Phase {
    return this.#phase;
  }

  choiceOf(seat: SeatId): Throw | null {
    return seat === 'p1' ? this.#choiceP1 : this.#choiceP2;
  }

  get lastOutcome(): SeatId | 'draw' | null {
    return this.#lastOutcome;
  }

  cursorOf(seat: SeatId): number {
    return seat === 'p1' ? this.#cursorP1 : this.#cursorP2;
  }

  /**
   * Start a fresh window.
   *
   * `-1` means "not yet sized". The step rate is not known until the first `update` — the
   * loop tells the game its delta rather than the game assuming one — so sizing the window
   * in `init` gave the first round a window of a single step, and it resolved before
   * either player could touch anything. The other games avoid this with the same sentinel
   * for their think delays; this one needed it for the round itself.
   */
  #beginWindow(): void {
    this.#phase = 'window';
    this.#choiceP1 = null;
    this.#choiceP2 = null;
    this.#windowSteps = this.#stepsPerSecond === 0 ? -1 : this.#stepsFor(WINDOW_SECONDS);
  }

  #resolve(): void {
    const outcome = resolveRound(this.#choiceP1, this.#choiceP2);
    this.#lastOutcome = outcome;
    if (outcome === 'p1') this.#tallyP1 += 1;
    else if (outcome === 'p2') this.#tallyP2 += 1;

    // A bot learns from what it just saw, never from what is about to happen.
    if (this.#choiceP1 !== null) remember(this.#memoryOfP1, this.#choiceP1);
    if (this.#choiceP2 !== null) remember(this.#memoryOfP2, this.#choiceP2);

    this.#phase = 'reveal';
    this.#revealSteps = this.#stepsFor(REVEAL_SECONDS);
  }

  #readSeat(seat: SeatId, input: InputState): void {
    if (this.choiceOf(seat) !== null) return;

    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const profile = BOT_PROFILES[difficulty];
      const total = this.#stepsFor(WINDOW_SECONDS);
      const elapsed = total - this.#windowSteps;
      if (elapsed >= Math.round(total * profile.commitAt)) {
        // The bot reads the *other* seat's habits.
        const memory = seat === 'p1' ? this.#memoryOfP2 : this.#memoryOfP1;
        this.#commit(seat, botThrow(memory, profile, this.#rng.float()));
      }
      return;
    }

    const seatInput = input.seat(seat);
    this.#stepCursor(seat, seatInput.move.x);

    if (!seatInput.actionPressed) return;

    let index = this.cursorOf(seat);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // Nothing rotates in this game, so a tap needs no frame conversion — but it still
      // goes through `toWorld` with `rotated: false` rather than being used raw, so the
      // one place a coordinate becomes a board position stays the same everywhere.
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, false);
      const tapped = buttonAt(seat, this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      index = tapped;
      this.#setCursor(seat, tapped);
    }

    this.#commit(seat, THROWS[index] ?? 'rock');
  }

  #commit(seat: SeatId, thrown: Throw): void {
    if (seat === 'p1') this.#choiceP1 = thrown;
    else this.#choiceP2 = thrown;
  }

  #setCursor(seat: SeatId, index: number): void {
    if (seat === 'p1') this.#cursorP1 = index;
    else this.#cursorP2 = index;
  }

  #stepCursor(seat: SeatId, moveX: number): void {
    const x = moveX > 0.5 ? 1 : moveX < -0.5 ? -1 : 0;
    const held = seat === 'p1' ? this.#heldP1 : this.#heldP2;
    if (seat === 'p1') this.#heldP1 = x;
    else this.#heldP2 = x;
    if (x === 0 || x === held) return;

    if (seat === 'p1') this.#cursorVisibleP1 = true;
    else this.#cursorVisibleP2 = true;
    // Only three buttons, so a fresh press moves one and there is no repeat to configure.
    const next = clamp(this.cursorOf(seat) + x, 0, THROWS.length - 1);
    this.#setCursor(seat, next);
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  /**
   * The window as a bar across the middle.
   *
   * Both seats read the same clock from the same place, which matters: if each had its
   * own countdown, one could believe it had longer than the other.
   */
  #drawWindowTrack(renderer: Renderer): void {
    const width = this.#logical.width - TRACK_INSET * 2;
    renderer.rect(TRACK_INSET, TRACK_Y - TRACK_HEIGHT / 2, width, TRACK_HEIGHT, COLOUR_TRACK);
    if (this.#phase !== 'window') return;
    const total = this.#stepsFor(WINDOW_SECONDS);
    const fraction = Math.max(0, this.#windowSteps / total);
    renderer.rect(
      TRACK_INSET,
      TRACK_Y - TRACK_HEIGHT / 2,
      width * fraction,
      TRACK_HEIGHT,
      COLOUR_GLYPH,
    );
  }

  #drawRow(renderer: Renderer, seat: SeatId): void {
    const committed = this.choiceOf(seat);
    const seatColour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    const cursorVisible = seat === 'p1' ? this.#cursorVisibleP1 : this.#cursorVisibleP2;

    for (let i = 0; i < THROWS.length; i += 1) {
      buttonCentre(this.#scratch, seat, i);
      const option = THROWS[i] ?? 'rock';
      // While the window is open a seat's own choice is hidden from the other player —
      // the whole point of a simultaneous game. It is revealed when the round resolves.
      const showChoice = this.#phase === 'reveal';
      const isChosen = showChoice && committed === option;

      renderer.circle(
        this.#scratch.x,
        this.#scratch.y,
        BUTTON_RADIUS,
        isChosen ? COLOUR_BUTTON_ARMED : COLOUR_BUTTON,
      );
      if (isChosen) {
        renderer.strokeCircle(this.#scratch.x, this.#scratch.y, BUTTON_RADIUS - 4, 6, seatColour);
      }
      if (cursorVisible && this.cursorOf(seat) === i && committed === null) {
        renderer.strokeCircle(
          this.#scratch.x,
          this.#scratch.y,
          BUTTON_RADIUS + 8,
          CURSOR_WIDTH,
          seatColour,
        );
      }
      this.#drawGlyph(renderer, option, this.#scratch.x, this.#scratch.y);
    }

    // A committed seat shows a filled marker beside its row, so the other player knows a
    // choice has been made without learning what it is.
    if (committed !== null && this.#phase === 'window') {
      const y = seat === 'p1' ? P1_ROW_Y - BUTTON_RADIUS - 40 : P2_ROW_Y + BUTTON_RADIUS + 40;
      renderer.circle(BOARD_CENTRE_X, y, 16, seatColour);
    }
  }

  /**
   * Each throw as a distinct silhouette.
   *
   * Shape, not colour: the two seats use the same three symbols, so the symbols must be
   * separable from each other with no colour at all — and a player who cannot tell a
   * circle from a square cannot play.
   */
  #drawGlyph(renderer: Renderer, option: Throw, x: number, y: number): void {
    const r = BUTTON_RADIUS * 0.46;
    if (option === 'rock') {
      renderer.circle(x, y, r, COLOUR_GLYPH);
      return;
    }
    if (option === 'paper') {
      renderer.rect(x - r, y - r, r * 2, r * 2, COLOUR_GLYPH);
      return;
    }
    // Scissors: an open cross, which reads as blades and is neither disc nor square.
    renderer.line(x - r, y - r, x + r, y + r, GLYPH_WIDTH, COLOUR_GLYPH);
    renderer.line(x + r, y - r, x - r, y + r, GLYPH_WIDTH, COLOUR_GLYPH);
  }
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export default {
  manifest,
  create: (): Game => new RockPaperScissorsGame(),
};
