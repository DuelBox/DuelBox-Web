import {
  GridCursor,
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  seatRotated,
  set,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import {
  SHAPE,
  STACK_LIMIT,
  createBotRngs,
  createBotState,
  createGame,
  depthOf,
  driveBot,
  frontKind,
  rackOf,
  resetBotState,
  resetGame,
  setsOf,
  sizeOf,
  step,
  take,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game as Table } from './rules.js';

/**
 * Tap Match — one board, two racks, seven slots each.
 *
 * Everything here is placement and drawing. The board turns to face whoever is to move,
 * but each seat's rack stays on its own side of it: the half-turn puts your own seven
 * slots in front of you and your opponent's across the table, which is where they are
 * when two people play this with real cards.
 */

/* ------------------------------------------------------------------ geometry */

/** Logical units. Exported because "which pile did that tap land on" is not a drawing question. */
export const BOARD_WIDTH = 900;
export const BOARD_HEIGHT = 1000;

export const PILE_PITCH = 146;
export const PILE_ORIGIN_X = 12;
export const PILE_CENTRE_Y = 502;
export const CARD_WIDTH = 126;
export const CARD_HEIGHT = 176;

/** The two racks, at fixed ends of the board: p1's at the bottom, p2's at the top. */
export const SLOT_PITCH = 118;
export const SLOT_SIZE = 104;
const RACK_WIDTH = SLOT_PITCH * STACK_LIMIT;
const RACK_ORIGIN_X = (BOARD_WIDTH - RACK_WIDTH) / 2;
const P1_RACK_Y = 862;
const P2_RACK_Y = 138;
const P1_TALLY_Y = 962;
const P2_TALLY_Y = 38;

/**
 * Card edges drawn behind a pile to show how deep it still is.
 *
 * Capped rather than exact, and the cap is the point: a full pile and a nearly full one
 * look the same, and the count only becomes readable over the last few cards — which is
 * exactly when how many are left is worth anything to either player.
 */
const DEPTH_STEP = 8;
const MAX_DEPTH_EDGES = 6;

const CURSOR_MARGIN = 12;
const CURSOR_WIDTH = 6;
const PIP_RADIUS = 12;
const PIP_PITCH = 32;
const GLYPH_RADIUS = 34;
const RACK_GLYPH_RADIUS = 28;
const GLYPH_WIDTH = 8;
const RACK_GLYPH_WIDTH = 6;

const COLOUR_BACKGROUND = '#101720';
const COLOUR_FELT = '#17222e';
const COLOUR_CARD = '#e9edf3';
const COLOUR_CARD_EDGE = '#5d6b7d';
const COLOUR_BURIED = '#8d9aab';
const COLOUR_MUTED = 'rgba(210, 224, 238, 0.20)';

/**
 * One colour per kind — and one *shape* per kind, which is the part that matters.
 *
 * Rule 7: the glyph alone identifies a kind, so the table is playable in greyscale and by
 * a colour-blind player. None of these strings is a seat colour; a card belongs to a kind,
 * never to a player, and colouring one in a seat's palette would say the opposite.
 */
const KIND_COLOURS: readonly string[] = [
  '#d4a017',
  '#3f9d6a',
  '#8b5cf6',
  '#c2410c',
  '#0e8fa8',
  '#b8336a',
  '#5c7a1e',
  '#7a5c3e',
  '#4b5f9e',
];

/** Centre of a pile in board space. Writes into `out` and allocates nothing. */
export function pileCentre(out: Vec2, pile: number): Vec2 {
  return set(out, PILE_ORIGIN_X + (pile + 0.5) * PILE_PITCH, PILE_CENTRE_Y);
}

/**
 * Pile a point in board space falls on, or -1 when it misses.
 *
 * The gap between two piles is dead space rather than being rounded to the nearer one, so
 * a tap that lands between neighbours takes neither card. The target is deliberately
 * taller than the card it covers, because a pile that is nearly gone is drawn shorter than
 * a full one and its target must not shrink with it.
 */
export function pileIndexAt(x: number, y: number): number {
  const half = CARD_HEIGHT / 2 + MAX_DEPTH_EDGES * DEPTH_STEP;
  if (y < PILE_CENTRE_Y - half || y > PILE_CENTRE_Y + half) return -1;
  const local = x - PILE_ORIGIN_X;
  if (local < 0) return -1;
  const pile = Math.floor(local / PILE_PITCH);
  if (pile < 0 || pile >= SHAPE.piles) return -1;
  const offset = local - pile * PILE_PITCH;
  const inset = (PILE_PITCH - CARD_WIDTH) / 2;
  if (offset < inset || offset > PILE_PITCH - inset) return -1;
  return pile;
}

/**
 * Centre of one slot in a seat's rack. Writes into `out` and allocates nothing.
 *
 * Seat two's slots run the other way along the board on purpose. The board makes a half
 * turn between the seats, so laying both racks out left to right in *board* coordinates
 * would give one player an ascending row of cards and the other a descending one — the
 * two racks would not be images of each other, and a rack is the thing each player looks
 * at most. Mirroring the index makes seat one's slot `i` land exactly where seat two's
 * slot `i` lands after the turn, which a test asserts to the last bit.
 */
export function slotCentre(out: Vec2, seat: SeatId, index: number): Vec2 {
  const column = seat === 'p1' ? index : STACK_LIMIT - 1 - index;
  return set(
    out,
    RACK_ORIGIN_X + (column + 0.5) * SLOT_PITCH,
    seat === 'p1' ? P1_RACK_Y : P2_RACK_Y,
  );
}

/**
 * Where the eighth card lands when a rack goes out.
 *
 * Between the rack and the board rather than beyond the last slot, so that seven slots can
 * use the full width of the board and the card that ended the match still has somewhere
 * of its own to sit. Mirror images under the half-turn, like everything else here.
 */
export function overflowCentre(out: Vec2, seat: SeatId): Vec2 {
  return set(out, BOARD_WIDTH / 2, seat === 'p1' ? P1_RACK_Y - SLOT_PITCH : P2_RACK_Y + SLOT_PITCH);
}

/* ------------------------------------------------------------------ the game */

export class TapMatchGame implements Game {
  readonly #table: Table = createGame();
  readonly #flip = new SeatFlip();
  readonly #botP1State: BotState = createBotState();
  readonly #botP2State: BotState = createBotState();
  readonly #pointerWorld: Vec2 = vec2();
  /** Render-only scratch. Written during render(), never read by the simulation. */
  readonly #scratch: Vec2 = vec2();
  /**
   * The keyboard's way onto the board. Without it the game is pointer-only, and two
   * people sharing a laptop have one keyboard and no touchscreen.
   */
  readonly #cursor = new GridCursor({ columns: SHAPE.piles, rows: 1, startIndex: 0 });

  #botRng: { p1: Rng; p2: Rng } = { p1: new Rng(1), p2: new Rng(2) };
  #logical: LogicalSize = { width: BOARD_WIDTH, height: BOARD_HEIGHT };
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  /** The seat `#rotated` was last worked out for, or null before the first step. */
  #rotationSeat: SeatId | null = null;
  #rotated = false;

  /** Read-only view of the table, for the tests and the harness. */
  get table(): Readonly<Table> {
    return this.#table;
  }

  init(context: GameContext): void {
    // A generator per seat, both drawn from the match's own before the deal touches it.
    this.#botRng = createBotRngs(context.rng);
    this.#logical = context.manifest.logical;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#cursor.reset();
    this.#rotationSeat = null;
    // `openingSeat`, never `p1`: the shell alternates it across the rounds of a best-of so
    // that whatever first-pick advantage this board has washes out between them.
    resetGame(this.#table, context.rng, context.openingSeat);
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    // Stepped before the early return, so the board finishes turning to face the winner
    // rather than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (winnerOf(this.#table) !== null) return;

    this.#take(input, fixedDeltaSeconds);
    step(this.#table, fixedDeltaSeconds);
  }

  #take(input: InputState, fixedDeltaSeconds: number): void {
    const active = this.#table.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    if (difficulty !== null) {
      const state = active === 'p1' ? this.#botP1State : this.#botP2State;
      driveBot(this.#table, active, difficulty, state, this.#botRng[active], fixedDeltaSeconds);
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the pile under a finger is
    // moving, so a tap would take a card the player did not mean. It costs nothing here —
    // the rules' own ready freeze is longer than the flip, so no turn is being eaten, and
    // this game has no clock for the flip to steal from either.
    if (!this.#flip.acceptsInput) return;

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    if (!seatInput.actionPressed) return;
    const pointer = seatInput.pointer;
    let choice: number;
    if (pointer === null) {
      // Only a key raises a press with no pointer — a tap always carries its position.
      choice = this.#cursor.index;
    } else {
      // The board is drawn under the active seat's rotation, so a device-space tap has to
      // be turned into board space before it names a pile. The *settled* orientation,
      // which is the one on screen whenever input is open.
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      choice = pileIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (choice >= 0) this.#cursor.moveTo(choice);
    }
    if (choice < 0) return;
    take(this.#table, active, choice);
  }

  /**
   * The orientation the board should be in, which the flip tweens towards.
   *
   * `seatView` is the one definition of when a seat reads the board upside down, and no
   * game should re-derive that expression — three of them had, which is three chances to
   * disagree the day single-seat play gains a wrinkle. But it *allocates*, and its own
   * doc comment says it is "called on presentation changes, not per frame". Every game
   * in the catalogue calls it once a frame anyway, which is a small steady breach of rule
   * 5 in all of them. Asking it once a turn instead keeps the one definition and keeps
   * `update` allocation-free; `presentation` and `localSeat` are fixed at `init`, so
   * nothing else the answer depends on can change between two turns.
   */
  #shouldRotate(): boolean {
    const active = this.#table.active;
    if (active !== this.#rotationSeat) {
      this.#rotationSeat = active;
      this.#rotated = seatRotated(active, this.#presentation, this.#localSeat);
    }
    return this.#rotated;
  }

  /** Whose turn it is. The shell's turn indicator and seat flip are driven from this. */
  getActiveSeat(): SeatId {
    return this.#table.active;
  }

  getScore(): MatchScore {
    return { p1: this.#table.p1Sets, p2: this.#table.p2Sets, winner: winnerOf(this.#table) };
  }

  // The shell stops stepping a paused match and every clock here is counted off the fixed
  // delta, so there is nothing of its own to suspend or restart.
  onPause(): void {}
  onResume(): void {}

  destroy(): void {
    resetBotState(this.#botP1State);
    resetBotState(this.#botP2State);
    this.#cursor.reset();
    this.#rotationSeat = null;
    this.#table.left = 0;
    this.#table.p1Size = 0;
    this.#table.p2Size = 0;
    this.#table.p1Sets = 0;
    this.#table.p2Sets = 0;
    this.#table.phase = 'over';
    this.#table.winner = null;
    this.#table.p1Out = false;
    this.#table.p2Out = false;
    this.#table.eliminated.length = 0;
    for (let i = 0; i < this.#table.remaining.length; i += 1) this.#table.remaining[i] = 0;
    for (let i = 0; i <= STACK_LIMIT; i += 1) {
      this.#table.p1Rack[i] = -1;
      this.#table.p2Rack[i] = -1;
    }
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate between
  // fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    renderer.rect(20, 336, BOARD_WIDTH - 40, 300, COLOUR_FELT);
    this.#drawPiles(renderer);
    this.#drawCursor(renderer);
    this.#drawRack(renderer, 'p1');
    this.#drawRack(renderer, 'p2');
    this.#drawTally(renderer, 'p1');
    this.#drawTally(renderer, 'p2');
    renderer.popSeatRotation();
  }

  /**
   * The six piles.
   *
   * Only the front card of a pile is face up; the rest are edges stacked behind it, so how
   * deep a pile still runs is a count you can see and what is *in* it is not. Both seats
   * see exactly this, and so does the bot — see `BoardView`.
   */
  #drawPiles(renderer: Renderer): void {
    const halfW = CARD_WIDTH / 2;
    const halfH = CARD_HEIGHT / 2;
    for (let pile = 0; pile < SHAPE.piles; pile += 1) {
      pileCentre(this.#scratch, pile);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      const left = depthOf(this.#table, pile);
      if (left === 0) {
        renderer.strokeRect(x - halfW, y - halfH, CARD_WIDTH, CARD_HEIGHT, 3, COLOUR_MUTED);
        continue;
      }

      const buried = Math.min(left - 1, MAX_DEPTH_EDGES);
      for (let edge = buried; edge >= 1; edge -= 1) {
        const top = y - halfH - edge * DEPTH_STEP;
        renderer.rect(
          x - halfW + edge * 2,
          top,
          CARD_WIDTH - edge * 4,
          DEPTH_STEP + 2,
          COLOUR_BURIED,
        );
        renderer.strokeRect(
          x - halfW + edge * 2,
          top,
          CARD_WIDTH - edge * 4,
          DEPTH_STEP + 2,
          2,
          COLOUR_CARD_EDGE,
        );
      }

      renderer.rect(x - halfW, y - halfH, CARD_WIDTH, CARD_HEIGHT, COLOUR_CARD);
      renderer.strokeRect(x - halfW, y - halfH, CARD_WIDTH, CARD_HEIGHT, 4, COLOUR_CARD_EDGE);
      this.#drawGlyph(renderer, frontKind(this.#table, pile), x, y, GLYPH_RADIUS, GLYPH_WIDTH);
    }
  }

  /** Only once a key has been used, so a player who taps never sees a stray highlight. */
  #drawCursor(renderer: Renderer): void {
    if (!this.#cursor.visible) return;
    pileCentre(this.#scratch, this.#cursor.index);
    const x = this.#scratch.x;
    const y = this.#scratch.y;
    renderer.strokeRect(
      x - CARD_WIDTH / 2 - CURSOR_MARGIN,
      y - CARD_HEIGHT / 2 - CURSOR_MARGIN,
      CARD_WIDTH + CURSOR_MARGIN * 2,
      CARD_HEIGHT + CURSOR_MARGIN * 2,
      CURSOR_WIDTH,
      SEAT_PALETTE[this.#table.active].base,
    );
  }

  /**
   * One seat's seven slots.
   *
   * Rule 7, and the place it does the most work: **seat one's slots are circles and seat
   * two's are squares**, seven of each, on screen from the first frame to the last. The
   * shape is what says whose rack you are looking at; the colour only agrees with it. A
   * card sitting in a slot keeps its own kind glyph, because a card belongs to a kind
   * rather than to a player.
   */
  #drawRack(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const rack = rackOf(this.#table, seat);
    const size = sizeOf(this.#table, seat);
    const half = SLOT_SIZE / 2;

    for (let i = 0; i < STACK_LIMIT; i += 1) {
      slotCentre(this.#scratch, seat, i);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      const kind = i < size ? (rack[i] ?? -1) : -1;
      const colour = kind < 0 ? palette.soft : palette.base;
      if (seat === 'p1') {
        if (kind >= 0) renderer.circle(x, y, half - 4, palette.tint);
        renderer.strokeCircle(x, y, half, 5, colour);
      } else {
        if (kind >= 0)
          renderer.rect(x - half + 4, y - half + 4, SLOT_SIZE - 8, SLOT_SIZE - 8, palette.tint);
        renderer.strokeRect(x - half, y - half, SLOT_SIZE, SLOT_SIZE, 5, colour);
      }
      if (kind >= 0) {
        this.#drawGlyph(renderer, kind, x, y, RACK_GLYPH_RADIUS, RACK_GLYPH_WIDTH);
      }
    }

    // The eighth card, when a rack has just gone out: drawn between the rack and the board
    // so the reason the match ended is on the table rather than in a banner. It sits off
    // the row rather than past the last slot, which is what lets seven slots use the full
    // width of the board.
    if (size > STACK_LIMIT) {
      overflowCentre(this.#scratch, seat);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      if (seat === 'p1') renderer.strokeCircle(x, y, half, 5, palette.deep);
      else renderer.strokeRect(x - half, y - half, SLOT_SIZE, SLOT_SIZE, 5, palette.deep);
      const kind = rack[STACK_LIMIT] ?? -1;
      if (kind >= 0) {
        this.#drawGlyph(renderer, kind, x, y, RACK_GLYPH_RADIUS, RACK_GLYPH_WIDTH);
      }
    }
  }

  /**
   * Sets cleared, as pips on the owner's own edge of the board.
   *
   * Discs for seat one and squares for seat two, the same pairing as the slots, so the two
   * tallies are never told apart by colour alone either.
   */
  #drawTally(renderer: Renderer, seat: SeatId): void {
    const palette = SEAT_PALETTE[seat];
    const sets = setsOf(this.#table, seat);
    const y = seat === 'p1' ? P1_TALLY_Y : P2_TALLY_Y;
    for (let i = 0; i < sets; i += 1) {
      const x = BOARD_WIDTH / 2 + (i - (sets - 1) / 2) * PIP_PITCH;
      if (seat === 'p1') renderer.circle(x, y, PIP_RADIUS, palette.base);
      else
        renderer.rect(x - PIP_RADIUS, y - PIP_RADIUS, PIP_RADIUS * 2, PIP_RADIUS * 2, palette.base);
    }
  }

  /**
   * One distinct shape per kind.
   *
   * The shape alone says which kind a card is; the colour agrees with it and carries
   * nothing on its own, so three alike are three alike in greyscale.
   */
  #drawGlyph(renderer: Renderer, kind: number, x: number, y: number, r: number, w: number): void {
    if (kind < 0) return;
    const ink = KIND_COLOURS[kind % KIND_COLOURS.length] ?? '#000000';
    switch (kind % 9) {
      case 0:
        renderer.circle(x, y, r, ink);
        return;
      case 1:
        renderer.strokeCircle(x, y, r, w, ink);
        return;
      case 2:
        renderer.rect(x - r, y - r, r * 2, r * 2, ink);
        return;
      case 3:
        renderer.strokeRect(x - r, y - r, r * 2, r * 2, w, ink);
        return;
      case 4:
        // Triangle, point up.
        renderer.line(x, y - r, x + r, y + r, w, ink);
        renderer.line(x + r, y + r, x - r, y + r, w, ink);
        renderer.line(x - r, y + r, x, y - r, w, ink);
        return;
      case 5:
        renderer.line(x - r, y - r, x + r, y + r, w, ink);
        renderer.line(x + r, y - r, x - r, y + r, w, ink);
        return;
      case 6:
        renderer.line(x - r, y, x + r, y, w, ink);
        renderer.line(x, y - r, x, y + r, w, ink);
        return;
      case 7:
        // Diamond.
        renderer.line(x, y - r, x + r, y, w, ink);
        renderer.line(x + r, y, x, y + r, w, ink);
        renderer.line(x, y + r, x - r, y, w, ink);
        renderer.line(x - r, y, x, y - r, w, ink);
        return;
      default:
        // Chevron.
        renderer.line(x - r, y, x, y - r, w, ink);
        renderer.line(x, y - r, x + r, y, w, ink);
        renderer.line(x - r, y + r, x, y, w, ink);
        renderer.line(x, y, x + r, y + r, w, ink);
        return;
    }
  }
}
