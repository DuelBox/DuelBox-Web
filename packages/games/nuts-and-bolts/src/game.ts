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
import { manifest } from './manifest.js';
import {
  BOLT_CAPACITY,
  BOLT_COUNT,
  EMPTY,
  MARK_P1,
  MARK_P2,
  MOVES_PER_SEAT,
  NO_MOVE,
  NUTS_PER_SEAT,
  TURN_SECONDS,
  applyMove,
  botMove,
  createBotRngs,
  createMatch,
  forfeitMove,
  isLegalMove,
  marksOn,
  moveOf,
  resetMatch,
} from './rules.js';
import type { BotDifficulty, Match } from './rules.js';

/**
 * Nuts and Bolts — a rack of bolts, one shared pile of nuts, and a mark on everything you
 * touch.
 *
 * ## The rack is centred, and the two margins are each other's half-turn
 *
 * The shell turns the whole world half a turn when the move changes hands, so anything drawn
 * off-centre would sit somewhere different for each player. The rack occupies the middle band
 * of the box and the two equal margins hold one seat's score, moves and clock each — seat
 * two's row is the exact half-turn of seat one's, so when the board turns, each player's own
 * counters arrive at the edge in front of them.
 *
 * ## What the half-turn does to a stack, and what is done about it
 *
 * A bolt has a head and a point, and nuts only come off at the point. That is a fact about the
 * rack and not about who is looking at it, so when the board turns, the point that was at the
 * top of the screen is at the bottom. Three drawn things carry it, and none of them is colour:
 * the **head** is a solid block with a flange, the **point** is a taper, and every bolt with a
 * nut that can move carries a **caret past its point** aimed off the end of the bolt. "The nut
 * under the caret is the one that moves" is true from either chair.
 */

/* ------------------------------------------------------------------ geometry */

const WIDTH = manifest.logical.width;
const HEIGHT = manifest.logical.height;
const CENTRE_X = WIDTH / 2;

/** Bolts are evenly spaced across the box, so bolt 3 sits dead centre and the row is symmetric. */
export const BOLT_PITCH = 120;
export const FIRST_BOLT_X = CENTRE_X - ((BOLT_COUNT - 1) / 2) * BOLT_PITCH;
/** Dead space between two columns, so a tap on the seam picks neither. */
const COLUMN_SEAM = 6;

/** Where the head of every bolt sits, and how the nuts stack away from it. */
const HEAD_Y = 626;
const HEAD_HALF_WIDTH = 44;
const HEAD_HALF_HEIGHT = 26;
const FLANGE_HALF_WIDTH = 52;
const FLANGE_HEIGHT = 12;
const SHAFT_HALF_WIDTH = 12;
const TIP_Y = 224;
export const NUT_PITCH = 92;
/** Centre of the nut nearest the head. */
const FIRST_NUT_Y = HEAD_Y - HEAD_HALF_HEIGHT - NUT_PITCH / 2;
export const NUT_RADIUS = 40;
const HOLE_RADIUS = 14;
const BADGE_RADIUS = 45;
/** Half-side of seat two's square badge, sized so it covers the same area as seat one's ring. */
const BADGE_HALF_SIDE = (BADGE_RADIUS * Math.sqrt(Math.PI)) / 2;
const BADGE_WIDTH = 5;

/** The two margins. Seat one reads the lower one; the upper one is its half-turn. */
const SCORE_ROW_Y = 722;
const MOVES_ROW_Y = 782;
const CLOCK_ROW_Y = 840;
const ROW_MARK_X = 60;
const ROW_MARK_RADIUS = 17;
const SCORE_PITCH = 58;
const SCORE_PIP_RADIUS = 16;
const MOVES_PITCH = 58;
const MOVES_PIP_HALF = 20;
const CLOCK_HALF_WIDTH = 280;
const CLOCK_HEIGHT = 18;
const CLOCK_TICKS = 4;

/** Every delay is converted to whole simulation steps, so 60 Hz and 144 Hz step alike. */
export const THINK_SECONDS = 0.4;
export const MOVE_SECONDS = 0.2;
/** How high a nut rides over the tips on its way across the rack. */
const FLIGHT_ARC = 150;

const COLOUR_BACKGROUND = '#0e1420';
const COLOUR_PLATE = '#1a2434';
const COLOUR_STEEL = '#5d6b80';
const COLOUR_STEEL_DEEP = '#38455a';
const COLOUR_THREAD = '#26303f';
const COLOUR_MUTED = '#2c374a';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

/**
 * The five kinds of nut.
 *
 * Colour and shape both, never colour alone: the glyph is what a player in greyscale reads,
 * and the five lightnesses are spread from near-white to near-black so that the colours agree
 * with the glyphs rather than doing the work on their own.
 */
const KIND_COLOUR: readonly string[] = ['#efe6c8', '#e0a13c', '#4fa87a', '#7346b8', '#2b3444'];
/** Ink for the glyph, dark on the light kinds and light on the dark ones. */
const KIND_INK: readonly string[] = ['#1b2130', '#241704', '#08201a', '#efe8ff', '#dfe7f2'];

const GLYPH_OFFSET = 21;
const GLYPH_REACH = 9;

/** Centre of a bolt's column. */
export function boltX(bolt: number): number {
  return FIRST_BOLT_X + bolt * BOLT_PITCH;
}

/** Centre of the nut standing at `level` on a bolt, counting from the head. */
export function nutY(level: number): number {
  return FIRST_NUT_Y - level * NUT_PITCH;
}

/**
 * The bolt a point in board space names, or -1 when it lands on a seam.
 *
 * Only `x` decides it. A bolt is a whole column of the rack from one edge of the box to the
 * other, which is the largest target the layout can offer a thumb — and the two margins hold
 * nothing else to tap, so there is nothing for a generous column to steal.
 */
export function boltAt(x: number): number {
  const offset = x - (FIRST_BOLT_X - BOLT_PITCH / 2);
  if (offset < 0 || offset >= BOLT_PITCH * BOLT_COUNT) return -1;
  const bolt = Math.floor(offset / BOLT_PITCH);
  const inside = offset - bolt * BOLT_PITCH;
  if (inside < COLUMN_SEAM || inside > BOLT_PITCH - COLUMN_SEAM) return -1;
  return bolt;
}

export class NutsandBoltsGame implements Game {
  readonly #match: Match = createMatch();
  readonly #flip = new SeatFlip();
  /** One cursor a seat, so each player keeps their own place on the rack. */
  readonly #cursorP1 = new GridCursor({ columns: BOLT_COUNT, rows: 1 });
  readonly #cursorP2 = new GridCursor({ columns: BOLT_COUNT, rows: 1 });
  readonly #pointerWorld: Vec2 = vec2();
  /** Render-only scratch. Written during render(), never read by the simulation. */
  readonly #scratch: Vec2 = vec2();

  #logical: LogicalSize = manifest.logical;
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #rngP1: Rng = new Rng(0);
  #rngP2: Rng = new Rng(0);

  /** The bolt whose top nut is lifted, or -1 when nothing is in hand. */
  #selected = -1;
  #lastActive: SeatId = 'p1';
  #moveSteps = 0;
  #moveTotal = 1;
  /** Negative until this turn's think delay has been sized in steps. */
  #thinkSteps = -1;
  #turnSteps = -1;
  #turnTotal = 1;
  #stepsPerSecond = 0;

  init(context: GameContext): void {
    this.#logical = context.manifest.logical;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    const rngs = createBotRngs(context.rng);
    this.#rngP1 = rngs.p1;
    this.#rngP2 = rngs.p2;

    // The opener comes from the shell, which alternates it across the rounds of a best-of.
    resetMatch(this.#match, context.rng, context.openingSeat);

    this.#cursorP1.reset();
    this.#cursorP2.reset();
    this.#selected = -1;
    this.#lastActive = this.#match.active;
    this.#moveSteps = 0;
    this.#moveTotal = 1;
    this.#thinkSteps = -1;
    this.#turnSteps = -1;
    this.#turnTotal = 1;
    this.#stepsPerSecond = 0;
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    // Stepped before the early return, so the rack finishes turning to face the winner rather
    // than freezing half way round.
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#match.winner !== null) return;

    if (this.#match.active !== this.#lastActive) {
      this.#lastActive = this.#match.active;
      this.#selected = -1;
      this.#thinkSteps = -1;
      this.#turnSteps = -1;
    }

    if (this.#moveSteps > 0) {
      this.#moveSteps -= 1;
      return;
    }

    const active = this.#match.active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;

    // The turn clock runs *above* the board flip, and that is deliberate. `seatView` reports
    // no rotation at all in single-seat play, so a clock frozen while the board turns would
    // expire on different steps in the two presentations and the two devices would disagree
    // about whose move it was. This is the defect three shipped games carry today.
    if (this.#turnSteps < 0) {
      this.#turnTotal = this.#stepsFor(TURN_SECONDS);
      this.#turnSteps = this.#turnTotal;
    }
    this.#turnSteps -= 1;
    if (this.#turnSteps <= 0) {
      forfeitMove(this.#match);
      this.#selected = -1;
      this.#turnSteps = -1;
      return;
    }

    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      const rng = active === 'p1' ? this.#rngP1 : this.#rngP2;
      // A bot never faces a rack with nothing legal on it — `judge` ends the match on the move
      // that jams it — but a bot that somehow offered an illegal move would otherwise sit here
      // until the turn clock ran out. Spending the move keeps the match moving either way.
      if (!this.#play(botMove(this.#match, rng, difficulty))) {
        forfeitMove(this.#match);
        this.#turnSteps = -1;
      }
      return;
    }

    // Nothing is accepted while the rack is part-way round: the nut under a finger is moving,
    // so a tap would name one the player did not mean.
    if (!this.#flip.acceptsInput) return;
    this.#takeHumanTurn(input, active, fixedDeltaSeconds);
  }

  #takeHumanTurn(input: InputState, active: SeatId, fixedDeltaSeconds: number): void {
    const seatInput = input.seat(active);
    const rotated = this.#flip.rotated;
    const cursor = active === 'p1' ? this.#cursorP1 : this.#cursorP2;
    cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, rotated);

    if (!seatInput.actionPressed) return;
    const pointer = seatInput.pointer;
    if (pointer === null) {
      this.#choose(cursor.index);
      return;
    }
    toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, rotated);
    this.#choose(boltAt(this.#pointerWorld.x));
  }

  /**
   * One press on one bolt.
   *
   * Lifting is free and reversible — it commits nothing, and pressing another bolt that has a
   * nut to give simply moves the choice. Only putting a nut down spends the turn, which is
   * what makes a key and a thumb the same instrument: every action in the game is one press on
   * one of seven columns, and neither can name a column more finely than the other.
   */
  #choose(bolt: number): void {
    if (bolt < 0) return;
    if (this.#selected < 0) {
      if (this.#canLift(bolt)) this.#selected = bolt;
      return;
    }
    if (bolt === this.#selected) {
      this.#selected = -1;
      return;
    }
    if (this.#play(moveOf(this.#selected, bolt))) return;
    if (this.#canLift(bolt)) this.#selected = bolt;
  }

  #canLift(bolt: number): boolean {
    return this.#match.locked[bolt] !== true && (this.#match.height[bolt] ?? 0) > 0;
  }

  #play(move: number): boolean {
    if (move === NO_MOVE) return false;
    if (!applyMove(this.#match, move)) return false;
    this.#moveTotal = this.#stepsFor(MOVE_SECONDS);
    this.#moveSteps = this.#moveTotal;
    this.#selected = -1;
    this.#thinkSteps = -1;
    this.#turnSteps = -1;
    return true;
  }

  #shouldRotate(): boolean {
    return seatRotated(this.#match.active, this.#presentation, this.#localSeat);
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  onPause(): void {}
  onResume(): void {}

  /** Marked nuts standing on finished bolts. A score that only ever climbs. */
  getScore(): MatchScore {
    return { p1: this.#match.p1Score, p2: this.#match.p2Score, winner: this.#match.winner };
  }

  /** Whose turn it is. The shell's turn indicator and seat flip both read this. */
  getActiveSeat(): SeatId {
    return this.#match.active;
  }

  destroy(): void {
    this.#match.winner = null;
    this.#match.active = 'p1';
    this.#match.turnMoves = 0;
    this.#match.p1Moves = 0;
    this.#match.p2Moves = 0;
    this.#match.p1Score = 0;
    this.#match.p2Score = 0;
    this.#match.lockedCount = 0;
    this.#match.movedFrom = -1;
    this.#match.movedTo = -1;
    this.#match.movedKind = EMPTY;
    this.#match.movedLevel = -1;
    for (let index = 0; index < this.#match.slots.length; index += 1) {
      this.#match.slots[index] = EMPTY;
      this.#match.marks[index] = 0;
    }
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      this.#match.height[bolt] = 0;
      this.#match.locked[bolt] = false;
    }
    this.#cursorP1.reset();
    this.#cursorP2.reset();
    this.#selected = -1;
    this.#moveSteps = 0;
    this.#thinkSteps = -1;
    this.#turnSteps = -1;
  }

  /** Read-only view of the match, for the tests and any harness. Never mutate through it. */
  get match(): Readonly<Match> {
    return this.#match;
  }

  /** The bolt whose nut is in hand, or -1. */
  get selected(): number {
    return this.#selected;
  }

  /** Steps left in the move animation; zero when nothing is in flight. */
  get moveCountdown(): number {
    return this.#moveSteps;
  }

  /** Steps left on the active seat's turn clock. */
  get turnCountdown(): number {
    return this.#turnSteps;
  }

  /* ---------------------------------------------------------------- drawing */

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks against
  // the class as well as against `Game`. Every delay here is counted in whole steps, so there
  // is nothing to interpolate and the implementation ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawRack(renderer);
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) this.#drawBolt(renderer, bolt);
    this.#drawHints(renderer);
    this.#drawFlight(renderer);
    this.#drawMargin(renderer, 'p1');
    this.#drawMargin(renderer, 'p2');
    renderer.popSeatRotation();
  }

  #drawRack(renderer: Renderer): void {
    renderer.rect(
      FIRST_BOLT_X - BOLT_PITCH / 2,
      HEAD_Y - HEAD_HALF_HEIGHT - 6,
      BOLT_PITCH * BOLT_COUNT,
      HEAD_HALF_HEIGHT * 2 + 12,
      COLOUR_PLATE,
    );
  }

  /** One bolt: the shank, the head, the point, its nuts and whether it is finished. */
  #drawBolt(renderer: Renderer, bolt: number): void {
    const x = boltX(bolt);
    const locked = this.#match.locked[bolt] === true;

    renderer.rect(
      x - SHAFT_HALF_WIDTH,
      TIP_Y,
      SHAFT_HALF_WIDTH * 2,
      HEAD_Y - TIP_Y,
      locked ? COLOUR_STEEL_DEEP : COLOUR_STEEL,
    );
    // Threads, so the shank reads as a bolt rather than as a bar.
    for (let tick = 0; tick < 6; tick += 1) {
      const y = TIP_Y + 26 + tick * 22;
      renderer.line(x - SHAFT_HALF_WIDTH, y, x + SHAFT_HALF_WIDTH, y + 6, 3, COLOUR_THREAD);
    }
    // The point. Two tapers meeting above the shank, so which end is open never depends on
    // which way up the board is being read.
    renderer.line(x - SHAFT_HALF_WIDTH, TIP_Y + 22, x, TIP_Y, 5, COLOUR_STEEL);
    renderer.line(x + SHAFT_HALF_WIDTH, TIP_Y + 22, x, TIP_Y, 5, COLOUR_STEEL);
    // The head: a block with a flange under it, at the closed end.
    renderer.rect(
      x - HEAD_HALF_WIDTH,
      HEAD_Y - HEAD_HALF_HEIGHT,
      HEAD_HALF_WIDTH * 2,
      HEAD_HALF_HEIGHT * 2,
      COLOUR_STEEL,
    );
    renderer.rect(
      x - FLANGE_HALF_WIDTH,
      HEAD_Y + HEAD_HALF_HEIGHT,
      FLANGE_HALF_WIDTH * 2,
      FLANGE_HEIGHT,
      COLOUR_STEEL_DEEP,
    );

    const tall = this.#match.height[bolt] ?? 0;
    const flying = this.#moveSteps > 0 && this.#match.movedTo === bolt;
    for (let level = 0; level < tall; level += 1) {
      if (flying && level === this.#match.movedLevel) continue;
      this.#drawNut(
        renderer,
        x,
        nutY(level),
        this.#match.slots[bolt * BOLT_CAPACITY + level] ?? EMPTY,
        this.#match.marks[bolt * BOLT_CAPACITY + level] ?? 0,
      );
    }

    if (!locked) return;
    // A finished bolt is out of the game, and the mark of whoever holds most of it is drawn
    // across the head so the rack shows who owns what without a number anywhere.
    const p1 = marksOn(this.#match, bolt, 'p1');
    const p2 = marksOn(this.#match, bolt, 'p2');
    renderer.line(
      x - HEAD_HALF_WIDTH,
      HEAD_Y,
      x + HEAD_HALF_WIDTH,
      HEAD_Y,
      6,
      p1 === p2 ? COLOUR_MUTED : p1 > p2 ? COLOUR_P1 : COLOUR_P2,
    );
  }

  /**
   * One nut: a ring of metal with the bolt through the middle of it.
   *
   * Rule 7 lives here, and it is load-bearing rather than decorative: the whole game is "which
   * of these nuts match" and "whose are they", and both questions would be colour alone if
   * this drew a plain disc.
   *
   * The **kind** is a glyph stamped twice on the face — a disc, a block, a triangle, a cross,
   * a bar — so which nuts match is a shape question before it is a colour one. Twice rather
   * than once because the two stamps sit either side of the shank, which makes a nut its own
   * half-turn: the rack turns between players and a nut looks the same to both of them.
   *
   * The **owner** is the outline: seat one's nuts are ringed and seat two's are boxed, sized so
   * the ring and the box cover the same area and neither reads as the bigger thing. Every nut
   * has an owner from the deal, so both seats' marks are on screen in every frame.
   */
  #drawNut(renderer: Renderer, x: number, y: number, kind: number, mark: number): void {
    if (kind === EMPTY) return;
    renderer.circle(x, y, NUT_RADIUS, KIND_COLOUR[kind] ?? COLOUR_MUTED);
    renderer.strokeCircle(x, y, NUT_RADIUS, 3, COLOUR_STEEL_DEEP);
    renderer.circle(x, y, HOLE_RADIUS, COLOUR_STEEL);
    const ink = KIND_INK[kind] ?? '#000000';
    this.#drawKindGlyph(renderer, kind, x - GLYPH_OFFSET, y, ink);
    this.#drawKindGlyph(renderer, kind, x + GLYPH_OFFSET, y, ink);
    if (mark === MARK_P1) renderer.strokeCircle(x, y, BADGE_RADIUS, BADGE_WIDTH, COLOUR_P1);
    else if (mark === MARK_P2) {
      renderer.strokeRect(
        x - BADGE_HALF_SIDE,
        y - BADGE_HALF_SIDE,
        BADGE_HALF_SIDE * 2,
        BADGE_HALF_SIDE * 2,
        BADGE_WIDTH,
        COLOUR_P2,
      );
    }
  }

  /** Five kinds, five silhouettes. Nothing here is told by colour. */
  #drawKindGlyph(renderer: Renderer, kind: number, x: number, y: number, ink: string): void {
    const reach = GLYPH_REACH;
    switch (kind) {
      case 0:
        renderer.circle(x, y, reach, ink);
        return;
      case 1:
        renderer.rect(x - reach, y - reach, reach * 2, reach * 2, ink);
        return;
      case 2:
        renderer.line(x - reach, y + reach, x + reach, y + reach, 4, ink);
        renderer.line(x - reach, y + reach, x, y - reach, 4, ink);
        renderer.line(x + reach, y + reach, x, y - reach, 4, ink);
        return;
      case 3:
        renderer.line(x - reach, y - reach, x + reach, y + reach, 4, ink);
        renderer.line(x + reach, y - reach, x - reach, y + reach, 4, ink);
        return;
      default:
        renderer.line(x - reach, y, x + reach, y, 7, ink);
    }
  }

  /**
   * What can move, what is in hand, and where it may go.
   *
   * Every one of the three is drawn rather than left to be worked out. Counting which bolts
   * show a matching kind is bookkeeping rather than skill, and it is bookkeeping a thumb and a
   * keyboard are not equally quick at — leaving it to the player quietly makes the game a test
   * of the peripheral. This is the same argument Reversi makes for marking its legal squares.
   */
  #drawHints(renderer: Renderer): void {
    if (this.#match.winner !== null || this.#moveSteps > 0) return;
    const colour = this.#match.active === 'p1' ? COLOUR_P1 : COLOUR_P2;

    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      const tall = this.#match.height[bolt] ?? 0;
      if (this.#match.locked[bolt] === true || tall === 0) continue;
      // A caret past the point of the bolt, over the nut that is free to come off. It aims
      // away from the head, so it says which way a nut leaves whichever chair is reading it.
      const x = boltX(bolt);
      const y = nutY(tall - 1) - NUT_RADIUS - 16;
      renderer.line(x - 14, y + 12, x, y, 4, COLOUR_STEEL);
      renderer.line(x + 14, y + 12, x, y, 4, COLOUR_STEEL);
    }

    // The keyboard cursor, drawn across the head of the bolt it is on — and drawn whether or
    // not a nut is already in hand, because choosing where a nut goes is the half of the turn
    // a player most needs to see their cursor for. It stays invisible until a key is pressed,
    // so a player who has only ever tapped never sees a highlight they did not summon.
    const cursor = this.#match.active === 'p1' ? this.#cursorP1 : this.#cursorP2;
    if (cursor.visible) {
      const x = boltX(cursor.index);
      renderer.strokeRect(x - 54, HEAD_Y - 18, 108, 44, 4, colour);
    }

    if (this.#selected < 0) return;
    const held = this.#selected;
    const heldTall = this.#match.height[held] ?? 0;
    renderer.strokeCircle(boltX(held), nutY(heldTall - 1), NUT_RADIUS + 14, 5, colour);
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      if (!isLegalMove(this.#match, moveOf(held, bolt))) continue;
      const level = this.#match.height[bolt] ?? 0;
      renderer.strokeCircle(boltX(bolt), nutY(level), 20, 4, colour);
    }
  }

  /** The nut in transit, riding over the tips of the bolts. */
  #drawFlight(renderer: Renderer): void {
    if (this.#moveSteps <= 0) return;
    const { movedFrom, movedTo, movedKind, movedLevel } = this.#match;
    if (movedFrom < 0 || movedTo < 0 || movedKind === EMPTY) return;
    const progress = 1 - this.#moveSteps / this.#moveTotal;
    const fromY = nutY(this.#match.height[movedFrom] ?? 0);
    const toY = nutY(movedLevel);
    const x = boltX(movedFrom) + (boltX(movedTo) - boltX(movedFrom)) * progress;
    const y = fromY + (toY - fromY) * progress - FLIGHT_ARC * 4 * progress * (1 - progress);
    set(this.#scratch, x, y);
    this.#drawNut(
      renderer,
      this.#scratch.x,
      this.#scratch.y,
      movedKind,
      this.#match.marks[movedTo * BOLT_CAPACITY + movedLevel] ?? 0,
    );
  }

  /**
   * One seat's margin: its mark, its score, its moves left and its clock.
   *
   * Seat two's row is the exact half-turn of seat one's, so each player's own counters arrive
   * in front of them when the rack turns. Every quantity here is countable — pips rather than
   * a bar to estimate — and every one of them carries the seat's own shape.
   */
  #drawMargin(renderer: Renderer, seat: SeatId): void {
    const mirror = seat === 'p2';
    const colour = mirror ? COLOUR_P2 : COLOUR_P1;
    const score = seat === 'p1' ? this.#match.p1Score : this.#match.p2Score;
    const left = seat === 'p1' ? this.#match.p1Moves : this.#match.p2Moves;

    this.#seatMark(
      renderer,
      seat,
      this.#mirrorX(ROW_MARK_X, mirror),
      this.#mirrorY(SCORE_ROW_Y, mirror),
      ROW_MARK_RADIUS,
      colour,
    );

    for (let pip = 0; pip < NUTS_PER_SEAT; pip += 1) {
      const x = this.#mirrorX(CENTRE_X + (pip - (NUTS_PER_SEAT - 1) / 2) * SCORE_PITCH, mirror);
      const y = this.#mirrorY(SCORE_ROW_Y, mirror);
      if (pip < score) this.#seatPip(renderer, seat, x, y, SCORE_PIP_RADIUS, colour);
      else renderer.strokeCircle(x, y, SCORE_PIP_RADIUS - 5, 2, COLOUR_MUTED);
    }

    for (let pip = 0; pip < MOVES_PER_SEAT; pip += 1) {
      const x = this.#mirrorX(CENTRE_X + (pip - (MOVES_PER_SEAT - 1) / 2) * MOVES_PITCH, mirror);
      const y = this.#mirrorY(MOVES_ROW_Y, mirror);
      const spent = pip >= left;
      renderer.rect(
        x - MOVES_PIP_HALF,
        y - 4,
        MOVES_PIP_HALF * 2,
        8,
        spent ? COLOUR_MUTED : COLOUR_STEEL,
      );
    }

    if (this.#match.active !== seat || this.#match.winner !== null) return;
    const fraction = this.#turnSteps < 0 ? 1 : Math.max(0, this.#turnSteps / this.#turnTotal);
    const y = this.#mirrorY(CLOCK_ROW_Y, mirror);
    renderer.strokeRect(
      CENTRE_X - CLOCK_HALF_WIDTH,
      y - CLOCK_HEIGHT / 2,
      CLOCK_HALF_WIDTH * 2,
      CLOCK_HEIGHT,
      2,
      COLOUR_MUTED,
    );
    renderer.rect(
      this.#mirrorX(CENTRE_X - CLOCK_HALF_WIDTH, mirror) -
        (mirror ? CLOCK_HALF_WIDTH * 2 * fraction : 0),
      y - CLOCK_HEIGHT / 2,
      CLOCK_HALF_WIDTH * 2 * fraction,
      CLOCK_HEIGHT,
      colour,
    );
    // Ticks in the bar, so the clock is readable as a quantity and not only as a length.
    for (let tick = 1; tick < CLOCK_TICKS; tick += 1) {
      const x = CENTRE_X - CLOCK_HALF_WIDTH + ((CLOCK_HALF_WIDTH * 2) / CLOCK_TICKS) * tick;
      renderer.line(x, y - CLOCK_HEIGHT / 2, x, y + CLOCK_HEIGHT / 2, 2, COLOUR_BACKGROUND);
    }
  }

  #mirrorX(x: number, mirror: boolean): number {
    return mirror ? WIDTH - x : x;
  }

  #mirrorY(y: number, mirror: boolean): number {
    return mirror ? HEIGHT - y : y;
  }

  /** A ring for seat one and a box for seat two, everywhere. Rule 7, in one place. */
  #seatMark(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    colour: string,
  ): void {
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, radius, 4, colour);
      return;
    }
    const half = (radius * Math.sqrt(Math.PI)) / 2;
    renderer.strokeRect(x - half, y - half, half * 2, half * 2, 4, colour);
  }

  #seatPip(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    colour: string,
  ): void {
    if (seat === 'p1') {
      renderer.circle(x, y, radius, colour);
      return;
    }
    const half = (radius * Math.sqrt(Math.PI)) / 2;
    renderer.rect(x - half, y - half, half * 2, half * 2, colour);
  }
}
