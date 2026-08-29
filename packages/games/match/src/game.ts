import { Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  ROUND_SECONDS,
  SET_SIZE,
  TARGET_POINTS,
  botTouch,
  createBotState,
  createGame,
  foundOf,
  lockOf,
  resetBotState,
  resetGame,
  setOf,
  step,
  touch,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Position } from './rules.js';

/**
 * Match Rush — one puzzle, half of it each.
 *
 * The board is point-symmetric: seat one's set fills the near half and seat two's the far
 * half, and the two are the same arrangement turned half a turn. So the picture is already
 * the right way up for both players and there is nothing to rotate — the symbols themselves
 * are drawn without a top, which is what makes that possible.
 */

export const BOARD = 900;
const CENTRE = BOARD / 2;

/** Each set is a fan of five, centred in its own half. */
const SET_RADIUS = 155;
const SET_CENTRE_OFFSET = 190;
const SYMBOL_RADIUS = 62;

const COLOUR_BACKGROUND = '#0e1116';
const COLOUR_PANEL = '#171c25';
const COLOUR_RULE = 'rgba(226, 232, 244, 0.14)';
const COLOUR_MUTED = 'rgba(226, 232, 244, 0.45)';
const COLOUR_RIGHT = '#3ec98a';
const COLOUR_WRONG = '#e0554f';

/**
 * The twelve kinds, each a colour and a shape.
 *
 * **Shape first, colour second** — rule 7, and here it is load-bearing rather than a
 * courtesy: the entire game is telling two symbols apart at a glance, so a pair that
 * differed only in hue would be unplayable for one person in twelve and merely hard for
 * everybody else. Every kind has a distinct silhouette; the colours repeat across shapes on
 * purpose, so colour alone never identifies a kind.
 */
const KINDS: readonly { readonly shape: number; readonly colour: string }[] = Object.freeze([
  { shape: 0, colour: '#e8c14f' },
  { shape: 1, colour: '#4fb5e8' },
  { shape: 2, colour: '#e87a4f' },
  { shape: 3, colour: '#7ae84f' },
  { shape: 4, colour: '#c14fe8' },
  { shape: 5, colour: '#4fe8c1' },
  { shape: 0, colour: '#4fb5e8' },
  { shape: 1, colour: '#e87a4f' },
  { shape: 2, colour: '#7ae84f' },
  { shape: 3, colour: '#c14fe8' },
  { shape: 4, colour: '#4fe8c1' },
  { shape: 5, colour: '#e8c14f' },
]);

/** Where a slot sits in a seat's fan, in board coordinates. */
function slotPosition(seat: SeatId, slot: number, out: { x: number; y: number }): void {
  const near = seat === 'p1';
  const centreY = near ? CENTRE + SET_CENTRE_OFFSET : CENTRE - SET_CENTRE_OFFSET;
  // A ring of five, started from the point away from the middle so the fan opens toward
  // the player it belongs to.
  const angle = (slot / SET_SIZE) * Math.PI * 2 + (near ? Math.PI / 2 : -Math.PI / 2);
  out.x = CENTRE + Math.cos(angle) * SET_RADIUS;
  out.y = centreY + Math.sin(angle) * SET_RADIUS;
}

export class MatchRushGame implements Game {
  readonly #position: Position = createGame();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  /** Pre-allocated, so a step and a frame allocate nothing. */
  readonly #point = { x: 0, y: 0 };
  /**
   * Where each seat's keyboard cursor is sitting.
   *
   * A fan of five has no grid to move a cursor over, so the engine's `GridCursor` does not
   * fit: left and right walk *round the ring* instead, which is the only motion the shape
   * suggests. Up and down do the same thing, so a player who reaches for W or S is not met
   * with silence.
   */
  readonly #cursor: Record<SeatId, number> = { p1: 0, p2: 0 };
  /** Whether each seat's stick was pushed last step, so a held key moves one place. */
  readonly #held: Record<SeatId, boolean> = { p1: false, p2: false };

  #rng = new Rng(1);
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #winner: SeatId | 'draw' | null = null;

  get position(): Position {
    return this.#position;
  }

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#winner = null;
    this.#cursor.p1 = 0;
    this.#cursor.p2 = 0;
    this.#held.p1 = false;
    this.#held.p2 = false;
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    resetGame(this.#position, this.#rng);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#winner !== null) return;

    // Both seats are read before the step settles anything, so two players finding it on
    // the same step have both found it.
    this.#read('p1', input, fixedDeltaSeconds);
    this.#read('p2', input, fixedDeltaSeconds);

    step(this.#position, fixedDeltaSeconds, this.#rng);
    this.#winner = winnerOf(this.#position);
  }

  #read(seat: SeatId, input: InputState, fixedDeltaSeconds: number): void {
    const difficulty = seat === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      const state = seat === 'p1' ? this.#botP1State : this.#botP2State;
      const slot = botTouch(this.#position, seat, difficulty, state, this.#rng, fixedDeltaSeconds);
      if (slot >= 0) touch(this.#position, seat, slot);
      return;
    }

    const seatInput = input.seat(seat);

    // The keyboard: walk the ring, then confirm. Both halves are read every step so a
    // player may switch between a thumb and the keys without either locking the other out.
    const push =
      Math.abs(seatInput.move.x) > Math.abs(seatInput.move.y)
        ? Math.sign(seatInput.move.x)
        : Math.sign(seatInput.move.y);
    if (push === 0) this.#held[seat] = false;
    else if (!this.#held[seat]) {
      this.#held[seat] = true;
      this.#cursor[seat] = (this.#cursor[seat] + push + SET_SIZE) % SET_SIZE;
    }

    const pointer = seatInput.pointer;
    if (pointer !== null && seatInput.actionPressed) {
      const slot = this.#slotAt(seat, pointer);
      // A tap leaves the cursor where the finger went, so switching to keys carries on
      // from there rather than jumping back.
      if (slot >= 0) {
        this.#cursor[seat] = slot;
        touch(this.#position, seat, slot);
      }
      return;
    }
    if (pointer === null && seatInput.actionPressed) {
      touch(this.#position, seat, this.#cursor[seat]);
    }
  }

  /** Where a seat's keyboard cursor is, for the renderer and for tests. */
  cursorOf(seat: SeatId): number {
    return this.#cursor[seat];
  }

  /** Which of a seat's five symbols a finger landed on, or −1. */
  #slotAt(seat: SeatId, pointer: Readonly<Vec2>): number {
    for (let slot = 0; slot < SET_SIZE; slot += 1) {
      slotPosition(seat, slot, this.#point);
      if (Math.hypot(pointer.x - this.#point.x, pointer.y - this.#point.y) <= SYMBOL_RADIUS) {
        return slot;
      }
    }
    return -1;
  }

  getActiveSeat(): SeatId | null {
    // Never: both players search at once, so the shell keeps a pointer zone for each.
    return null;
  }

  getScore(): MatchScore {
    return {
      p1: this.#position.p1Points,
      p2: this.#position.p2Points,
      winner: this.#winner,
    };
  }

  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetGame(this.#position, this.#rng);
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#winner = null;
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    this.#drawPanels(renderer);
    for (const seat of ['p1', 'p2'] as SeatId[]) this.#drawSet(renderer, seat);
    this.#drawScores(renderer);
  }

  #drawPanels(renderer: Renderer): void {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const near = seat === 'p1';
      const y = near ? CENTRE + 20 : 20;
      renderer.rect(20, y, BOARD - 40, CENTRE - 40, COLOUR_PANEL);
    }
    renderer.line(0, CENTRE, BOARD, CENTRE, 2, COLOUR_RULE);

    // The search clock, as a bar shrinking from both ends toward the middle — so it is the
    // same object read the same way from either side of the device.
    if (this.#position.phase === 'searching') {
      const left = Math.max(0, Math.min(1, this.#position.timer / ROUND_SECONDS));
      const half = ((BOARD - 40) / 2) * left;
      renderer.rect(CENTRE - half, CENTRE - 3, half * 2, 6, COLOUR_MUTED);
    }
  }

  #drawSet(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const symbols = setOf(this.#position, seat);
    const found = foundOf(this.#position, seat);
    const locked = lockOf(this.#position, seat) > 0;
    const revealing = this.#position.phase !== 'searching';

    for (let slot = 0; slot < SET_SIZE; slot += 1) {
      slotPosition(seat, slot, this.#point);
      const x = this.#point.x;
      const y = this.#point.y;
      const kind = KINDS[symbols[slot] as number] as { shape: number; colour: string };

      // The tile. A locked-out player's tiles dim, which is the only feedback a penalty has.
      renderer.circle(x, y, SYMBOL_RADIUS, locked ? COLOUR_PANEL : COLOUR_BACKGROUND);
      this.#drawShape(renderer, kind.shape, x, y, locked ? COLOUR_MUTED : kind.colour);

      // The keyboard cursor, as a dashed outer ring. Drawn under the result rings so a
      // found symbol still reads as found.
      if (this.#cursor[seat] === slot && !revealing) {
        renderer.strokeCircle(x, y, SYMBOL_RADIUS + 6, 3, palette.base);
      }

      if (found === slot) {
        renderer.strokeCircle(x, y, SYMBOL_RADIUS - 4, 6, COLOUR_RIGHT);
      } else if (revealing && symbols[slot] === this.#position.common) {
        // At the reveal, the answer is ringed for whoever did not find it.
        renderer.strokeCircle(x, y, SYMBOL_RADIUS - 4, 6, palette.base);
      }
    }

    if (!locked) return;
    // A cross over the whole fan, so a lockout reads as a shape rather than a shade.
    const centreY = seat === 'p1' ? CENTRE + SET_CENTRE_OFFSET : CENTRE - SET_CENTRE_OFFSET;
    const reach = SET_RADIUS + SYMBOL_RADIUS;
    renderer.line(
      CENTRE - reach,
      centreY - reach,
      CENTRE + reach,
      centreY + reach,
      5,
      COLOUR_WRONG,
    );
    renderer.line(
      CENTRE + reach,
      centreY - reach,
      CENTRE - reach,
      centreY + reach,
      5,
      COLOUR_WRONG,
    );
  }

  /**
   * One symbol, drawn from primitives and without a top.
   *
   * Every shape here is symmetric under a half turn, which is what lets one board serve two
   * people sitting opposite each other with nothing rotated — and it is why a shape like an
   * arrow or a letter could not be one of the twelve.
   */
  #drawShape(renderer: Renderer, shape: number, x: number, y: number, colour: string): void {
    const r = SYMBOL_RADIUS * 0.62;
    switch (shape) {
      case 0: // Disc.
        renderer.circle(x, y, r, colour);
        break;
      case 1: // Square.
        renderer.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7, colour);
        break;
      case 2: // Ring.
        renderer.strokeCircle(x, y, r * 0.8, r * 0.42, colour);
        break;
      case 3: // Cross.
        renderer.rect(x - r, y - r * 0.28, r * 2, r * 0.56, colour);
        renderer.rect(x - r * 0.28, y - r, r * 0.56, r * 2, colour);
        break;
      case 4: // Bar.
        renderer.rect(x - r, y - r * 0.34, r * 2, r * 0.68, colour);
        break;
      default: {
        // A six-pointed burst: three bars through the centre.
        for (let i = 0; i < 3; i += 1) {
          const angle = (i / 3) * Math.PI;
          renderer.line(
            x - Math.cos(angle) * r,
            y - Math.sin(angle) * r,
            x + Math.cos(angle) * r,
            y + Math.sin(angle) * r,
            r * 0.4,
            colour,
          );
        }
      }
    }
  }

  /** Points, as pips along each player's own outer edge. */
  #drawScores(renderer: Renderer): void {
    const spacing = (BOARD - 160) / TARGET_POINTS;
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const palette = SEAT_PALETTE[seat];
      const points = seat === 'p1' ? this.#position.p1Points : this.#position.p2Points;
      const y = seat === 'p1' ? BOARD - 26 : 26;
      for (let i = 0; i < TARGET_POINTS; i += 1) {
        const x = 80 + i * spacing;
        const filled = i < points;
        if (seat === 'p1') renderer.circle(x, y, 9, filled ? palette.base : COLOUR_RULE);
        else renderer.rect(x - 8, y - 8, 16, 16, filled ? palette.base : COLOUR_RULE);
      }
    }
  }
}

/** Re-exported so tests can name the geometry without duplicating it. */
export { slotPosition, SYMBOL_RADIUS };
