import {
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  otherSeat,
  seatView,
  set,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  P1_STORE,
  P2_STORE,
  PITS_PER_SIDE,
  bestMove,
  createBoard,
  firstPitOf,
  isOver,
  legalMoves,
  resetBoard,
  sow,
  sweepRemaining,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { Board, BotDifficulty } from './rules.js';

/**
 * Board geometry in logical units. Exported because aiming at a pit is not a rendering
 * question — the tests need the same mapping the game uses.
 */
export const PIT_PITCH = 118;
export const PIT_RADIUS = 48;
export const BOARD_LEFT = 150;
/** p1's row sits low, p2's high, matching who reads the board from which end. */
export const P1_ROW_Y = 560;
export const P2_ROW_Y = 340;
export const STORE_RADIUS = 62;
export const P1_STORE_X = BOARD_LEFT + PIT_PITCH * PITS_PER_SIDE;
export const P2_STORE_X = BOARD_LEFT - PIT_PITCH;
export const STORE_Y = (P1_ROW_Y + P2_ROW_Y) / 2;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_WOOD = '#2b2118';
const COLOUR_PIT = '#1a1410';
const COLOUR_STONE = '#e8dcc6';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

const STONE_RADIUS = 9;
const CURSOR_WIDTH = 5;
/** Stones are drawn in a ring inside a pit; beyond this many, the ring just gets denser. */
const MAX_DRAWN_STONES = 18;

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.55;
const SETTLE_SECONDS = 1.2;

/** Where a slot sits, in logical units. */
export function slotCentre(out: Vec2, slot: number): Vec2 {
  if (slot === P1_STORE) return set(out, P1_STORE_X, STORE_Y);
  if (slot === P2_STORE) return set(out, P2_STORE_X, STORE_Y);
  if (slot < P1_STORE) {
    // p1's row runs left to right along the bottom, the direction of sowing.
    return set(out, BOARD_LEFT + slot * PIT_PITCH, P1_ROW_Y);
  }
  // p2's row runs right to left along the top, so the ring is continuous.
  const index = slot - firstPitOf('p2');
  return set(out, BOARD_LEFT + (PITS_PER_SIDE - 1 - index) * PIT_PITCH, P2_ROW_Y);
}

const probe = vec2();

/** The slot a point falls in, or -1 if it is none. */
export function slotAt(x: number, y: number): number {
  for (let slot = 0; slot < P2_STORE + 1; slot += 1) {
    slotCentre(probe, slot);
    const radius = slot === P1_STORE || slot === P2_STORE ? STORE_RADIUS : PIT_RADIUS;
    const dx = probe.x - x;
    const dy = probe.y - y;
    if (dx * dx + dy * dy <= radius * radius) return slot;
  }
  return -1;
}

export class MancalaGame implements Game {
  readonly #board: Board = createBoard();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  readonly #moveBuffer: number[] = new Array<number>(PITS_PER_SIDE).fill(0);

  #rng = new Rng(1);
  #active: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  /** Which of the active seat's pits the keyboard has selected. */
  #cursor = 0;
  #cursorVisible = false;
  #heldX = 0;
  #repeatIn = 0;

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #settleSteps = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetBoard(this.#board);
    this.#active = 'p1';
    this.#thinkSteps = -1;
    this.#settleSteps = 0;
    this.#cursor = 0;
    this.#cursorVisible = false;
    this.#heldX = 0;
    this.#repeatIn = 0;
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
      if (this.#settleSteps === 0) {
        // Every stone left on the board goes to whoever's side it sits on. Missing this
        // sweep is the classic Mancala bug: the game ends with stones stranded and the
        // final score is simply wrong.
        sweepRemaining(this.#board);
        this.#matchWinner = winnerOf(this.#board);
      }
      return;
    }

    if (isOver(this.#board)) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
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
      this.#play(bestMove(this.#board, active, this.#rng, difficulty), active);
      return;
    }

    const seatInput = input.seat(active);
    if (!this.#flip.acceptsInput) return;

    this.#stepCursor(seatInput.move.x, fixedDeltaSeconds);

    if (!seatInput.actionPressed) return;

    let slot = firstPitOf(active) + this.#cursor;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = slotAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      slot = tapped;
      const local = tapped - firstPitOf(active);
      if (local >= 0 && local < PITS_PER_SIDE) this.#cursor = local;
    }

    this.#play(slot, active);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawCursor(renderer);
    this.#drawStones(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    const { p1, p2 } = tallyOf(this.#board);
    return { p1, p2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    resetBoard(this.#board);
  }

  /** Read-only views for the tests and the harness. */
  get activeSeat(): SeatId {
    return this.#active;
  }

  stonesIn(slot: number): number {
    return this.#board[slot] ?? 0;
  }

  get cursorPit(): number {
    return this.#cursor;
  }

  #play(slot: number, seat: SeatId): void {
    const result = sow(this.#board, slot, seat);
    if (result.lastSlot < 0) return;
    this.#thinkSteps = -1;
    // Ending in your own store grants another turn. This one rule is what makes the game
    // about chaining rather than about alternating.
    if (!result.extraTurn) {
      this.#active = otherSeat(seat);
      this.#cursor = this.#firstNonEmptyPit(this.#active);
    } else {
      this.#cursor = this.#firstNonEmptyPit(seat);
    }
    if (isOver(this.#board)) this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  /** Keeps the cursor on a pit that can actually be played. */
  #firstNonEmptyPit(seat: SeatId): number {
    const count = legalMoves(this.#moveBuffer, this.#board, seat);
    if (count === 0) return 0;
    return (this.#moveBuffer[0] as number) - firstPitOf(seat);
  }

  /**
   * The cursor moves along one row, so only the horizontal axis matters.
   *
   * A `GridCursor` would work but would be a one-row grid, and the far seat's row is drawn
   * right-to-left — so "left" for that player is a different direction along the array.
   * Handling that here is clearer than configuring it there.
   */
  #stepCursor(moveX: number, fixedDeltaSeconds: number): void {
    const x = moveX > 0.5 ? 1 : moveX < -0.5 ? -1 : 0;
    if (x === 0) {
      this.#heldX = 0;
      this.#repeatIn = 0;
      return;
    }
    const changed = x !== this.#heldX;
    this.#heldX = x;
    if (!changed) {
      this.#repeatIn -= fixedDeltaSeconds;
      if (this.#repeatIn > 0) return;
      this.#repeatIn = 0.14;
    } else {
      this.#repeatIn = 0.4;
    }
    this.#cursorVisible = true;
    // p2's row is drawn right to left, so its player's "right" walks the array backwards.
    const direction = this.#active === 'p1' ? x : -x;
    this.#cursor = clamp(this.#cursor + direction, 0, PITS_PER_SIDE - 1);
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatView(this.#active, this.#presentation, this.#localSeat).rotated;
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #drawBoard(renderer: Renderer): void {
    const width = PIT_PITCH * (PITS_PER_SIDE + 1) + STORE_RADIUS * 2;
    renderer.rect(
      P2_STORE_X - STORE_RADIUS - 24,
      P2_ROW_Y - PIT_RADIUS - 34,
      width + 48,
      P1_ROW_Y - P2_ROW_Y + PIT_RADIUS * 2 + 68,
      COLOUR_WOOD,
    );
    for (let slot = 0; slot <= P2_STORE; slot += 1) {
      slotCentre(this.#scratch, slot);
      const isStore = slot === P1_STORE || slot === P2_STORE;
      renderer.circle(
        this.#scratch.x,
        this.#scratch.y,
        isStore ? STORE_RADIUS : PIT_RADIUS,
        COLOUR_PIT,
      );
      if (isStore) {
        // Each store is ringed in its owner's colour, so whose bank is whose needs no
        // label — and the ring is a shape as well as a colour.
        renderer.strokeCircle(
          this.#scratch.x,
          this.#scratch.y,
          STORE_RADIUS - 3,
          5,
          slot === P1_STORE ? COLOUR_P1 : COLOUR_P2,
        );
      }
    }
  }

  #drawCursor(renderer: Renderer): void {
    if (!this.#cursorVisible) return;
    if (this.#matchWinner !== null) return;
    slotCentre(this.#scratch, firstPitOf(this.#active) + this.#cursor);
    renderer.strokeCircle(
      this.#scratch.x,
      this.#scratch.y,
      PIT_RADIUS + 6,
      CURSOR_WIDTH,
      this.#active === 'p1' ? COLOUR_P1 : COLOUR_P2,
    );
  }

  #drawStones(renderer: Renderer): void {
    for (let slot = 0; slot <= P2_STORE; slot += 1) {
      const count = this.#board[slot] ?? 0;
      if (count === 0) continue;
      slotCentre(this.#scratch, slot);
      const isStore = slot === P1_STORE || slot === P2_STORE;
      const spread = (isStore ? STORE_RADIUS : PIT_RADIUS) - STONE_RADIUS - 6;
      const drawn = Math.min(count, MAX_DRAWN_STONES);
      for (let i = 0; i < drawn; i += 1) {
        // A deterministic spiral rather than random scatter: the same board always draws
        // the same way, which matters because a game may be replayed from a seed.
        const t = drawn === 1 ? 0 : i / drawn;
        const angle = t * Math.PI * 6;
        const radius = spread * Math.sqrt(t);
        renderer.circle(
          this.#scratch.x + Math.cos(angle) * radius,
          this.#scratch.y + Math.sin(angle) * radius,
          STONE_RADIUS,
          COLOUR_STONE,
        );
      }
    }
  }
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export default {
  manifest,
  create: (): Game => new MancalaGame(),
};
