import { Rng, SEAT_PALETTE, otherSeat, set, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, SeatId, Vec2 } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  WinCondition,
} from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  DEFAULT_COLUMNS,
  DEFAULT_PAIRS,
  MEMORY_SPAN,
  allMatched,
  botChoice,
  createCards,
  createDeck,
  createMemory,
  dealInto,
  flip,
  forgetAll,
  gridFor,
  hideCards,
  rememberCard,
  resolveFlip,
} from './rules.js';
import type { BotDifficulty, BotMemory, Card } from './rules.js';

/** The table this game ships. The rules take any size; the layout below is sized for this one. */
export const PAIRS = DEFAULT_PAIRS;
export const CARD_COUNT = PAIRS * 2;
const GRID = gridFor(PAIRS, DEFAULT_COLUMNS);

/**
 * Table geometry in logical units. Exported because aiming at a card is not a rendering
 * question: the tests and any pointer-driven harness need the same mapping the game uses.
 */
export const BOARD_ORIGIN_X = 60;
export const BOARD_ORIGIN_Y = 190;
export const CARD_PITCH = 170;
export const CARD_SIZE = 150;

/**
 * Every delay is converted to whole simulation steps before it is counted down, so a
 * replay of the same inputs produces the same match on a 60 Hz phone and a 144 Hz laptop.
 */
export const THINK_SECONDS = 0.5;
export const MATCH_SECONDS = 0.4;
export const MISMATCH_SECONDS = 0.9;

/** Distinct glyphs a card face can carry. A deck with more pairs repeats them. */
const GLYPH_COUNT = 8;

const COLOUR_BACKGROUND = '#101722';
const COLOUR_CARD_BACK = '#2a3546';
const COLOUR_CARD_BACK_EDGE = '#68768e';
const COLOUR_CARD_FACE = '#e8ecf4';
const COLOUR_CARD_CLAIMED = '#9aa7ba';
const COLOUR_CARD_EDGE = '#0b111b';
const COLOUR_INK = '#131a26';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

const CARD_EDGE_WIDTH = 4;
const BACK_HATCH_INSET = 34;
const BACK_HATCH_WIDTH = 6;
const GLYPH_RADIUS = 42;
const GLYPH_WIDTH = 10;
const OWNER_RADIUS = 16;
const OWNER_WIDTH = 5;
const OWNER_INSET = 28;
/** Half-diagonal of the cross, as a fraction of the ring's radius. */
const CROSS_REACH = 0.78;

function createOwners(): (SeatId | null)[] {
  const owners: (SeatId | null)[] = [];
  for (let i = 0; i < CARD_COUNT; i += 1) {
    owners.push(null);
  }
  return owners;
}

/** Centre of a card in logical units. Writes into `out` and allocates nothing. */
export function cardCentre(out: Vec2, index: number): Vec2 {
  const column = index % GRID.columns;
  const row = Math.floor(index / GRID.columns);
  return set(
    out,
    BOARD_ORIGIN_X + (column + 0.5) * CARD_PITCH,
    BOARD_ORIGIN_Y + (row + 0.5) * CARD_PITCH,
  );
}

/**
 * Card a point in board space falls on, or -1 when it misses.
 *
 * The gap between two cards is dead space rather than being rounded to the nearer card,
 * so a tap that lands between neighbours turns neither of them over.
 */
export function cardIndexAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN_X;
  const localY = y - BOARD_ORIGIN_Y;
  if (localX < 0 || localY < 0) return -1;
  if (localX >= GRID.columns * CARD_PITCH || localY >= GRID.rows * CARD_PITCH) return -1;

  const column = Math.floor(localX / CARD_PITCH);
  const row = Math.floor(localY / CARD_PITCH);
  const inset = (CARD_PITCH - CARD_SIZE) / 2;
  const offsetX = localX - column * CARD_PITCH;
  const offsetY = localY - row * CARD_PITCH;
  if (offsetX < inset || offsetX > CARD_PITCH - inset) return -1;
  if (offsetY < inset || offsetY > CARD_PITCH - inset) return -1;

  const index = row * GRID.columns + column;
  return index < CARD_COUNT ? index : -1;
}

export class MemoryMatchGame implements Game {
  readonly #cards: Card[] = createCards(PAIRS);
  readonly #owners: (SeatId | null)[] = createOwners();
  readonly #tally = { p1: 0, p2: 0 };
  /** The match ends when the last pair goes, and the larger pile takes it. */
  readonly #condition: WinCondition = { kind: 'highest-when-time-expires' };
  readonly #options = { timeExpired: false };
  readonly #pointerWorld: Vec2 = vec2();
  /** Render-only scratch. Written during render(), never read by the simulation. */
  readonly #scratch: Vec2 = vec2();

  #memoryP1: BotMemory = createMemory(0);
  #memoryP2: BotMemory = createMemory(0);
  #rng: Rng = new Rng(0);
  #logical: LogicalSize = manifest.logical;
  #sharedScreen = false;
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;

  #active: SeatId = 'p1';
  #first = -1;
  #second = -1;
  #winner: SeatId | 'draw' | null = null;

  #hideSteps = 0;
  #holdSteps = 0;
  /** Negative until this flip's think delay has been sized in steps. */
  #thinkSteps = -1;
  #stepsPerSecond = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#logical = context.manifest.logical;
    this.#sharedScreen = context.presentation === 'shared-screen';
    this.#localSeat = context.localSeat;
    const botP1 = context.botDifficulty('p1');
    const botP2 = context.botDifficulty('p2');
    this.#botP1 = botP1;
    this.#botP2 = botP2;
    // A seat a human holds gets a zero-capacity memory, which remembers nothing.
    this.#memoryP1 = createMemory(botP1 === null ? 0 : MEMORY_SPAN[botP1]);
    this.#memoryP2 = createMemory(botP2 === null ? 0 : MEMORY_SPAN[botP2]);

    dealInto(this.#cards, createDeck(PAIRS, this.#rng));
    for (let i = 0; i < CARD_COUNT; i += 1) {
      this.#owners[i] = null;
    }

    this.#tally.p1 = 0;
    this.#tally.p2 = 0;
    this.#options.timeExpired = false;
    this.#winner = null;
    this.#active = 'p1';
    this.#first = -1;
    this.#second = -1;
    this.#hideSteps = 0;
    this.#holdSteps = 0;
    this.#thinkSteps = -1;
    this.#stepsPerSecond = 0;
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    if (this.#winner !== null) return;

    if (this.#hideSteps > 0) {
      this.#hideSteps -= 1;
      if (this.#hideSteps === 0) {
        hideCards(this.#cards, this.#first, this.#second);
        this.#first = -1;
        this.#second = -1;
        this.#active = otherSeat(this.#active);
        this.#thinkSteps = -1;
      }
      return;
    }

    if (this.#holdSteps > 0) {
      this.#holdSteps -= 1;
      // A pair keeps the turn: only the picks are cleared, never the active seat.
      if (this.#holdSteps === 0) {
        this.#first = -1;
        this.#second = -1;
        this.#thinkSteps = -1;
      }
      return;
    }

    const active = this.#active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    let choice: number;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      const memory = active === 'p1' ? this.#memoryP1 : this.#memoryP2;
      choice = botChoice(this.#cards, memory, this.#rng, difficulty);
    } else {
      const seatInput = input.seat(active);
      if (!seatInput.actionPressed) return;
      const pointer = seatInput.pointer;
      if (pointer === null) return;
      // The table is drawn under the active seat's rotation, so a device-space tap has to
      // be turned into board space before it names a card.
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#isRotated());
      choice = cardIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
    }

    if (choice < 0) return;
    if (!flip(this.#cards, choice)) return;
    this.#reveal(choice);
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushSeatRotation(this.#isRotated());
    this.#drawCards(renderer);
    renderer.popSeatRotation();
  }

  // The shell stops stepping a paused match, and every delay here is counted in steps
  // rather than seconds, so there is nothing of its own to suspend or restart.
  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#tally.p1, p2: this.#tally.p2, winner: this.#winner };
  }

  /** Whose turn it is. The shell's HUD draws the turn indicator from this. */
  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    this.#clearTable();
    forgetAll(this.#memoryP1);
    forgetAll(this.#memoryP2);
    this.#tally.p1 = 0;
    this.#tally.p2 = 0;
    this.#options.timeExpired = false;
    this.#winner = null;
    this.#active = 'p1';
  }

  /** Seat whose turn it is. Read-only view for the HUD, the harness and the tests. */
  get activeSeat(): SeatId {
    return this.#active;
  }

  /** The card turned over so far this turn, or -1 when the seat has yet to pick. */
  get firstPick(): number {
    return this.#first;
  }

  /** Steps left before a mismatched pair turns back over, or 0 when none is showing. */
  get hideCountdown(): number {
    return this.#hideSteps;
  }

  /** Read-only view of a card. Never mutate through it. */
  cardAt(index: number): Readonly<Card> | null {
    return this.#cards[index] ?? null;
  }

  /** Seat that won the pair this card belongs to, or null while it is still in play. */
  ownerAt(index: number): SeatId | null {
    return this.#owners[index] ?? null;
  }

  #isRotated(): boolean {
    return this.#sharedScreen && this.#active !== this.#localSeat;
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #clearTable(): void {
    for (let i = 0; i < CARD_COUNT; i += 1) {
      const card = this.#cards[i];
      if (card !== undefined) {
        card.faceUp = false;
        card.matched = false;
      }
      this.#owners[i] = null;
    }
    this.#first = -1;
    this.#second = -1;
    this.#hideSteps = 0;
    this.#holdSteps = 0;
    this.#thinkSteps = -1;
  }

  #reveal(index: number): void {
    // A flip on a shared table is public, so it feeds both bots' memories whoever made it.
    rememberCard(this.#memoryP1, index);
    rememberCard(this.#memoryP2, index);
    this.#thinkSteps = -1;

    if (this.#first < 0) {
      this.#first = index;
      return;
    }
    this.#second = index;

    if (!resolveFlip(this.#cards, this.#first, this.#second)) {
      this.#hideSteps = this.#stepsFor(MISMATCH_SECONDS);
      return;
    }

    this.#owners[this.#first] = this.#active;
    this.#owners[this.#second] = this.#active;
    if (this.#active === 'p1') this.#tally.p1 += 1;
    else this.#tally.p2 += 1;
    this.#options.timeExpired = allMatched(this.#cards);
    this.#winner = resolve(this.#condition, this.#tally, this.#options);
    this.#holdSteps = this.#stepsFor(MATCH_SECONDS);
  }

  #drawCards(renderer: Renderer): void {
    const half = CARD_SIZE / 2;
    for (let i = 0; i < CARD_COUNT; i += 1) {
      const card = this.#cards[i];
      if (card === undefined) continue;
      cardCentre(this.#scratch, i);
      const x = this.#scratch.x;
      const y = this.#scratch.y;

      if (!card.faceUp && !card.matched) {
        renderer.rect(x - half, y - half, CARD_SIZE, CARD_SIZE, COLOUR_CARD_BACK);
        renderer.strokeRect(
          x - half,
          y - half,
          CARD_SIZE,
          CARD_SIZE,
          CARD_EDGE_WIDTH,
          COLOUR_CARD_BACK_EDGE,
        );
        // Two crossed rules: the back stays distinct from a blank face in greyscale.
        const reach = half - BACK_HATCH_INSET;
        const hatch = COLOUR_CARD_BACK_EDGE;
        renderer.line(x - reach, y - reach, x + reach, y + reach, BACK_HATCH_WIDTH, hatch);
        renderer.line(x + reach, y - reach, x - reach, y + reach, BACK_HATCH_WIDTH, hatch);
        continue;
      }

      const owner = this.#owners[i] ?? null;
      const face = owner === null ? COLOUR_CARD_FACE : COLOUR_CARD_CLAIMED;
      renderer.rect(x - half, y - half, CARD_SIZE, CARD_SIZE, face);
      renderer.strokeRect(
        x - half,
        y - half,
        CARD_SIZE,
        CARD_SIZE,
        CARD_EDGE_WIDTH,
        COLOUR_CARD_EDGE,
      );
      this.#drawGlyph(renderer, card.value, x, y);
      if (owner !== null) {
        this.#drawSeatMark(
          renderer,
          owner,
          x + half - OWNER_INSET,
          y - half + OWNER_INSET,
          OWNER_RADIUS,
          OWNER_WIDTH,
        );
      }
    }
  }

  /**
   * One distinct glyph per pair value, all in the same ink.
   *
   * The shape alone identifies a pair, so the table is playable in greyscale and by a
   * colour-blind player: colour is never asked to carry the match.
   */
  #drawGlyph(renderer: Renderer, value: number, x: number, y: number): void {
    const r = GLYPH_RADIUS;
    const w = GLYPH_WIDTH;
    switch (value % GLYPH_COUNT) {
      case 0:
        renderer.circle(x, y, r, COLOUR_INK);
        return;
      case 1:
        renderer.strokeCircle(x, y, r, w, COLOUR_INK);
        return;
      case 2:
        renderer.rect(x - r, y - r, r * 2, r * 2, COLOUR_INK);
        return;
      case 3:
        renderer.strokeRect(x - r, y - r, r * 2, r * 2, w, COLOUR_INK);
        return;
      case 4:
        renderer.line(x - r, y - r, x + r, y + r, w, COLOUR_INK);
        renderer.line(x + r, y - r, x - r, y + r, w, COLOUR_INK);
        return;
      case 5:
        renderer.line(x - r, y, x + r, y, w, COLOUR_INK);
        renderer.line(x, y - r, x, y + r, w, COLOUR_INK);
        return;
      case 6:
        renderer.line(x, y - r, x + r, y + r, w, COLOUR_INK);
        renderer.line(x + r, y + r, x - r, y + r, w, COLOUR_INK);
        renderer.line(x - r, y + r, x, y - r, w, COLOUR_INK);
        return;
      default:
        renderer.line(x, y - r, x + r, y, w, COLOUR_INK);
        renderer.line(x + r, y, x, y + r, w, COLOUR_INK);
        renderer.line(x, y + r, x - r, y, w, COLOUR_INK);
        renderer.line(x - r, y, x, y - r, w, COLOUR_INK);
        return;
    }
  }

  /**
   * A ring for p1 and a cross for p2, the same pairing the rest of the catalog uses. The
   * shapes carry the seat on their own, so a claimed pile is readable without colour.
   */
  #drawSeatMark(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    width: number,
  ): void {
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, radius, width, COLOUR_P1);
      return;
    }
    const reach = radius * CROSS_REACH;
    renderer.line(x - reach, y - reach, x + reach, y + reach, width, COLOUR_P2);
    renderer.line(x + reach, y - reach, x - reach, y + reach, width, COLOUR_P2);
  }
}
